/**
 * Crate index & download service.
 *
 * Dependency resolution: reads the USTC crate index (tiny JSON files).
 * Download .crate files: via Vite proxy → USTC mirror.
 * No crates.io API needed.
 */

// Dev: use Vite proxy (same-origin). Prod: direct URLs.
const IS_FILE = typeof window !== 'undefined' && window.location.protocol === 'file:'

const INDEX_BASE = IS_FILE
  ? 'https://mirrors.ustc.edu.cn/crates.io-index'
  : '/crates-index'

const DL_MIRRORS = IS_FILE
  ? [
      'https://mirrors.ustc.edu.cn/crates.io/crates',
      'https://mirrors.tuna.tsinghua.edu.cn/crates.io/crates',
    ]
  : ['/crates-dl', '/crates-dl2']

export interface DepTreeNode {
  name: string
  version: string
  versionReq: string
  kind: string
  optional: boolean
}

// ── Index path helpers ────────────────────────────────────────────

/**
 * Compute the index file path for a crate name.
 * crates.io index convention:
 *   1-char → 1/{name}
 *   2-char → 2/{name}
 *   3-char → 3/{name[0]}/{name}
 *   4+char → {name[0]}{name[1]}/{name[2]}{name[3]}/{name}
 */
function indexPath(name: string): string {
  const lower = name.toLowerCase()
  if (lower.length === 1) return `1/${lower}`
  if (lower.length === 2) return `2/${lower}`
  if (lower.length === 3) return `3/${lower[0]}/${lower}`
  return `${lower[0]}${lower[1]}/${lower[2]}${lower[3]}/${lower}`
}

// ── Index entry types ─────────────────────────────────────────────

interface IndexDep {
  name: string
  req: string
  optional: boolean
  default_features: boolean
  kind: string
}

interface IndexEntry {
  name: string
  vers: string
  deps: IndexDep[]
  yanked: boolean
  features: Record<string, string[]>
}

// ── In-memory index cache ─────────────────────────────────────────

// Cache index file contents: crate name → parsed version arrays
const indexCache = new Map<string, IndexEntry[]>()

/**
 * Fetch and parse the index file for a crate.
 * The index file contains one JSON line per version.
 */
async function fetchIndex(name: string): Promise<IndexEntry[]> {
  if (indexCache.has(name)) {
    return indexCache.get(name)!
  }

  const path = indexPath(name)
  const url = `${INDEX_BASE}/${path}`

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`索引不存在: ${name}`)
  }

  const text = await res.text()
  const entries: IndexEntry[] = []

  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const e = JSON.parse(trimmed)
      entries.push({
        name: e.name,
        vers: e.vers,
        deps: (e.deps || []).map((d: any) => ({
          name: d.name,
          req: d.req || '*',
          optional: d.optional || false,
          default_features: d.default_features !== false,
          kind: d.kind || 'normal',
        })),
        yanked: e.yanked || false,
        features: e.features || {},
      })
    } catch {
      // skip malformed lines
    }
  }

  // Sort by version descending (newest first) for resolution
  entries.sort((a, b) => compareVersions(b.vers, a.vers))

  indexCache.set(name, entries)
  return entries
}

// ── Semver helpers ────────────────────────────────────────────────

interface ParsedVersion {
  major: number
  minor: number
  patch: number
  pre: (string | number)[]   // e.g. ["pre", 1] for 0.21.0-pre.1
}

/** Parse a semver string like "1.2.3", "0.21.0-pre.1", "1.0.0-alpha.2+build" */
function parseVersion(v: string): ParsedVersion {
  // Strip build metadata (+xxx)
  const buildIdx = v.indexOf('+')
  const core = buildIdx >= 0 ? v.slice(0, buildIdx) : v

  // Split core and pre-release
  const preIdx = core.indexOf('-')
  const nums = (preIdx >= 0 ? core.slice(0, preIdx) : core).split('.')
  const preStr = preIdx >= 0 ? core.slice(preIdx + 1) : ''

  const pre: (string | number)[] = []
  if (preStr) {
    for (const id of preStr.split('.')) {
      const n = Number(id)
      pre.push(isNaN(n) ? id : n)
    }
  }

  return {
    major: Number(nums[0]) || 0,
    minor: Number(nums[1]) || 0,
    patch: Number(nums[2]) || 0,
    pre,
  }
}

/**
 * Compare two semver strings including pre-release tags.
 * Pre-release versions sort BEFORE normal versions.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 */
function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)

  if (pa.major !== pb.major) return pa.major - pb.major
  if (pa.minor !== pb.minor) return pa.minor - pb.minor
  if (pa.patch !== pb.patch) return pa.patch - pb.patch

  // Pre-release: no pre > has pre
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0
  if (pa.pre.length === 0) return 1    // a is normal, b is pre → a > b
  if (pb.pre.length === 0) return -1   // a is pre, b is normal → a < b

  // Both pre-release — compare identifiers
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const ai = pa.pre[i]
    const bi = pb.pre[i]
    if (ai === undefined) return -1
    if (bi === undefined) return 1

    if (typeof ai === 'number' && typeof bi === 'number') {
      if (ai !== bi) return ai - bi
    } else {
      const sa = String(ai)
      const sb = String(bi)
      if (sa !== sb) return sa < sb ? -1 : 1
    }
  }
  return 0
}

/**
 * Check if a version satisfies a semver requirement like "^1.2.3", "~1.2", ">=1.0, <2.0".
 * Handles pre-release versions correctly.
 */
function versionSatisfies(version: string, req: string): boolean {
  if (!req || req === '*' || req === '') return true

  const reqs = req.split(',').map(r => r.trim()).filter(Boolean)
  for (const r of reqs) {
    if (!singleReqSatisfies(version, r)) return false
  }
  return true
}

function singleReqSatisfies(version: string, req: string): boolean {
  const r = req.trim()
  if (r === '*' || r === '') return true

  const ver = parseVersion(version)

  // >= x.y.z(-pre?)
  let m = r.match(/^>=\s*(.+)$/)
  if (m) return compareVersions(version, m[1]) >= 0

  // > x.y.z(-pre?)
  m = r.match(/^>\s*(.+)$/)
  if (m) return compareVersions(version, m[1]) > 0

  // <= x.y.z(-pre?)
  m = r.match(/^<=\s*(.+)$/)
  if (m) return compareVersions(version, m[1]) <= 0

  // < x.y.z(-pre?)
  m = r.match(/^<\s*(.+)$/)
  if (m) return compareVersions(version, m[1]) < 0

  // = x.y.z(-pre?)
  m = r.match(/^=\s*(.+)$/)
  if (m) return compareVersions(version, m[1]) === 0

  // ^x.y.z(-pre?)
  m = r.match(/^\^\s*(\d+)\.(\d+)\.(\d+)(-.+)?$/)
  if (m) {
    const rMaj = +m[1], rMin = +m[2], rPat = +m[3]
    if (ver.major !== rMaj) return false

    if (rMaj === 0) {
      if (rMin === 0) {
        // ^0.0.z — exact match only
        return ver.minor === 0 && ver.patch === rPat
      }
      // ^0.y.z — same minor, >= patch
      if (ver.minor !== rMin) return false
      const minimum = `${rMaj}.${rMin}.${rPat}${m[4] || ''}`
      return compareVersions(version, minimum) >= 0 && ver.minor === rMin
    }
    // ^x.y.z — same major, >= version
    const minimum = `${rMaj}.${rMin}.${rPat}${m[4] || ''}`
    return compareVersions(version, minimum) >= 0 && ver.major === rMaj
  }

  // ^x.y
  m = r.match(/^\^\s*(\d+)\.(\d+)$/)
  if (m) return versionSatisfies(version, `^${m[1]}.${m[2]}.0`)

  // ~x.y.z(-pre?)
  m = r.match(/^~\s*(\d+)\.(\d+)\.(\d+)(-.+)?$/)
  if (m) {
    const rMaj = +m[1], rMin = +m[2]
    if (ver.major !== rMaj || ver.minor !== rMin) return false
    const minimum = `${rMaj}.${rMin}.${m[3]}${m[4] || ''}`
    return compareVersions(version, minimum) >= 0
  }

  // ~x.y
  m = r.match(/^~\s*(\d+)\.(\d+)$/)
  if (m) {
    if (ver.major !== +m[1]) return false
    return ver.minor >= +m[2] && ver.major === +m[1]
  }

  // Plain version: x.y.z(-pre?)
  m = r.match(/^(\d+)\.(\d+)\.(\d+)(-.+)?$/)
  if (m) return compareVersions(version, `${m[1]}.${m[2]}.${m[3]}${m[4] || ''}`) === 0

  // Plain major.minor: x.y
  m = r.match(/^(\d+)\.(\d+)$/)
  if (m) return ver.major === +m[1] && ver.minor === +m[2]

  return false
}

/**
 * Find the best (newest non-yanked) version that satisfies a requirement.
 * Versions MUST be sorted newest-first by caller.
 * For pre-release requirements, matches pre-release versions; for stable reqs, prefers stable.
 */
function resolveVersion(entries: IndexEntry[], req: string): string | null {
  const hasPreReq = /[<>^~=]?\d+\.\d+\.\d+-/.test(req)

  for (const e of entries) {
    if (e.yanked) continue
    if (!versionSatisfies(e.vers, req)) continue

    // If requirement asks for pre-release, accept pre-release versions
    if (hasPreReq) return e.vers

    // For stable requirements, prefer stable versions (skip pre-release entries)
    if (!e.vers.includes('-')) return e.vers
  }

  // Fallback: if no stable version found (e.g., crate only has pre-releases), accept pre
  for (const e of entries) {
    if (e.yanked) continue
    if (versionSatisfies(e.vers, req)) return e.vers
  }

  return null
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Resolve the full dependency tree for a crate by reading the index.
 * Fast — only downloads small JSON index files, not .crate files.
 */
export async function resolveDependencyTree(
  name: string,
  version: string,
  maxDepth: number = 20,
  visited: Set<string> = new Set(),
  onProgress?: (msg: string) => void,
): Promise<DepTreeNode[]> {
  const result: DepTreeNode[] = []
  const key = `${name}@${version}`

  if (visited.has(key) || maxDepth <= 0) return result
  visited.add(key)

  onProgress?.(`获取索引: ${name}`)

  let entries: IndexEntry[]
  try {
    entries = await fetchIndex(name)
  } catch {
    console.warn(`No index for crate: ${name}`)
    return result
  }

  // Find the specific version entry to get its deps
  const versionEntry = entries.find(e => e.vers === version && !e.yanked)
  if (!versionEntry) {
    console.warn(`Version ${version} not found in index for ${name}`)
    result.push({ name, version, versionReq: version, kind: 'root', optional: false })
    return result
  }

  result.push({ name, version, versionReq: version, kind: 'root', optional: false })

  if (maxDepth <= 1) return result

  // Process dependencies
  for (const dep of versionEntry.deps) {
    if (dep.kind === 'dev') continue
    if (dep.optional) continue

    onProgress?.(`解析: ${dep.name} ${dep.req}`)

    let depEntries: IndexEntry[]
    try {
      depEntries = await fetchIndex(dep.name)
    } catch {
      result.push({ name: dep.name, version: dep.req, versionReq: dep.req, kind: dep.kind, optional: dep.optional })
      continue
    }

    const resolved = resolveVersion(depEntries, dep.req)
    if (!resolved) {
      result.push({ name: dep.name, version: dep.req, versionReq: dep.req, kind: dep.kind, optional: dep.optional })
      continue
    }

    const depKey = `${dep.name}@${resolved}`
    if (visited.has(depKey)) {
      result.push({ name: dep.name, version: resolved, versionReq: dep.req, kind: dep.kind, optional: dep.optional })
      continue
    }

    const children = await resolveDependencyTree(
      dep.name, resolved, maxDepth - 1, visited, onProgress,
    )
    result.push({ name: dep.name, version: resolved, versionReq: dep.req, kind: dep.kind, optional: dep.optional })
    for (const child of children) {
      result.push(child)
    }
  }

  return result
}

// ── Download .crate files ─────────────────────────────────────────

function downloadUrl(name: string, version: string, mirrorIdx: number): string {
  const mirror = DL_MIRRORS[mirrorIdx] || DL_MIRRORS[0]
  const encoded = encodeURIComponent(name)
  return `${mirror}/${encoded}/${encoded}-${encodeURIComponent(version)}.crate`
}

async function tryDownloadUrl(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url)
    if (res.ok) return res.arrayBuffer()
    return null
  } catch {
    return null
  }
}

/**
 * Download a .crate file from mirrors. Tries adjacent patch versions if exact match fails.
 */
export async function downloadCrate(
  name: string,
  version: string,
): Promise<{ data: ArrayBuffer; actualVersion: string }> {
  const versions = [version]

  // Add probe versions
  const parts = version.split('.')
  if (parts.length === 3) {
    const base = `${parts[0]}.${parts[1]}`
    const patch = parseInt(parts[2], 10)
    for (let p = patch + 1; p <= Math.min(patch + 5, 99); p++) versions.push(`${base}.${p}`)
    if (patch !== 0) versions.push(`${base}.0`)
    for (let p = patch - 1; p >= Math.max(patch - 3, 0); p--) versions.push(`${base}.${p}`)
  }

  for (const ver of versions) {
    for (let i = 0; i < DL_MIRRORS.length; i++) {
      const url = downloadUrl(name, ver, i)
      const data = await tryDownloadUrl(url)
      if (data) {
        if (ver !== version) console.log(`版本探测: ${name}@${version} → ${ver}`)
        return { data, actualVersion: ver }
      }
    }
  }

  throw new Error(`下载失败: "${name}@${version}"`)
}
