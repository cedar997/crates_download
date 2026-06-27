<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { resolveDependencyTree, type DepTreeNode } from '@/services/crates'
import { isCrateCached } from '@/stores/cache'

const props = defineProps<{
  crateName: string
  crateVersion: string
  active: boolean
}>()

const emit = defineEmits<{
  'update:packages': [packages: DepTreeNode[]]
}>()

const loading = ref(false)
const error = ref('')
const depTree = ref<DepTreeNode[]>([])
const depth = ref(20) // deep recursion for offline use — index-based resolution is fast
const cacheStatus = ref<Record<string, boolean>>({})
const progress = ref('')

// Deduplicate by name@version
const uniqueDeps = computed(() => {
  const seen = new Map<string, DepTreeNode>()
  for (const dep of depTree.value) {
    const key = `${dep.name}@${dep.version}`
    if (!seen.has(key)) seen.set(key, dep)
  }
  return Array.from(seen.values())
})

const rootCrate = computed(() =>
  uniqueDeps.value.find(d => d.kind === 'root')
)
const depsOnly = computed(() =>
  uniqueDeps.value.filter(d => d.kind !== 'root')
)
const normalDeps = computed(() => depsOnly.value.filter(d => d.kind !== 'build'))
const buildDeps = computed(() => depsOnly.value.filter(d => d.kind === 'build'))

const totalCount = computed(() => uniqueDeps.value.length)
const cachedCount = computed(() =>
  Object.values(cacheStatus.value).filter(Boolean).length
)

watch(() => [props.crateName, props.crateVersion, props.active, depth.value], async () => {
  if (!props.active || !props.crateName || !props.crateVersion) return
  await loadDependencies()
}, { immediate: true })

async function loadDependencies() {
  loading.value = true
  error.value = ''
  depTree.value = []
  progress.value = ''

  try {
    const tree = await resolveDependencyTree(
      props.crateName,
      props.crateVersion,
      depth.value,
      new Set(),
      (msg) => { progress.value = msg },
    )
    depTree.value = tree
    emit('update:packages', tree)

    // Check cache
    await checkAllCacheStatus()
  } catch (e: any) {
    error.value = e.message || '解析依赖失败'
  } finally {
    loading.value = false
    progress.value = ''
  }
}

async function checkAllCacheStatus() {
  const statuses = await Promise.all(
    uniqueDeps.value.map(async (dep) => {
      const cached = await isCrateCached(dep.name, dep.version)
      return { key: `${dep.name}@${dep.version}`, cached }
    })
  )
  cacheStatus.value = {}
  for (const s of statuses) {
    cacheStatus.value[s.key] = s.cached
  }
}

function getDepKey(dep: DepTreeNode) {
  return `${dep.name}@${dep.version}`
}

function isCached(dep: DepTreeNode) {
  return cacheStatus.value[getDepKey(dep)] || false
}
</script>

<template>
  <div v-if="active" class="dependency-list">
    <div class="list-header">
      <h2>
        📦 依赖列表
        <span v-if="totalCount" class="count-badge">{{ totalCount }} 个包</span>
      </h2>
      <div class="depth-control">
        <label>递归深度:</label>
        <select v-model.number="depth">
          <option :value="1">1 层</option>
          <option :value="2">2 层</option>
          <option :value="3">3 层</option>
          <option :value="5">5 层</option>
          <option :value="10">10 层</option>
          <option :value="20">全部 (20层)</option>
        </select>
        <span class="cache-info" v-if="totalCount">
          📋 已下载 {{ cachedCount }}/{{ totalCount }}
        </span>
      </div>
    </div>

    <div v-if="loading" class="loading-state">
      <span class="spinner"></span>
      <span>{{ progress || '正在解析依赖树...' }}</span>
      <span class="loading-hint">（通过下载 .crate 文件提取 Cargo.toml）</span>
    </div>

    <p v-if="error" class="error-msg">{{ error }}</p>

    <div v-if="!loading && totalCount > 0" class="dep-tree">
      <!-- Root crate -->
      <div v-if="rootCrate" class="dep-node root-node">
        <div class="dep-row">
          <span class="dep-icon">📦</span>
          <span class="dep-name">{{ rootCrate.name }}</span>
          <span class="dep-version">v{{ rootCrate.version }}</span>
          <span class="dep-kind root">主包</span>
          <span class="cache-badge" :class="{ cached: isCached(rootCrate) }">
            {{ isCached(rootCrate) ? '✅' : '⬜' }}
          </span>
        </div>
      </div>

      <template v-if="normalDeps.length">
        <div class="dep-section-title">📎 依赖 ({{ normalDeps.length }})</div>
        <div v-for="dep in normalDeps" :key="getDepKey(dep)" class="dep-node">
          <div class="dep-row">
            <span class="dep-icon">🔗</span>
            <span class="dep-name">{{ dep.name }}</span>
            <span class="dep-version">v{{ dep.version }}</span>
            <span class="dep-req" v-if="dep.versionReq !== dep.version">{{ dep.versionReq }}</span>
            <span class="cache-badge" :class="{ cached: isCached(dep) }">
              {{ isCached(dep) ? '✅' : '⬜' }}
            </span>
          </div>
        </div>
      </template>

      <template v-if="buildDeps.length">
        <div class="dep-section-title">🔧 构建依赖 ({{ buildDeps.length }})</div>
        <div v-for="dep in buildDeps" :key="getDepKey(dep)" class="dep-node build-dep">
          <div class="dep-row">
            <span class="dep-icon">🔩</span>
            <span class="dep-name">{{ dep.name }}</span>
            <span class="dep-version">v{{ dep.version }}</span>
            <span class="dep-req" v-if="dep.versionReq !== dep.version">{{ dep.versionReq }}</span>
            <span class="cache-badge" :class="{ cached: isCached(dep) }">
              {{ isCached(dep) ? '✅' : '⬜' }}
            </span>
          </div>
        </div>
      </template>
    </div>

    <div v-if="!loading && active && totalCount === 0 && !error" class="empty-state">
      没有依赖
    </div>
  </div>
</template>

<style scoped>
.dependency-list { background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
.list-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
.list-header h2 { margin: 0; font-size: 18px; color: #e2e8f0; display: flex; align-items: center; gap: 10px; }
.count-badge { font-size: 13px; background: #334155; color: #94a3b8; padding: 2px 10px; border-radius: 12px; }
.depth-control { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #94a3b8; }
.depth-control select { padding: 6px 10px; border: 1px solid #475569; border-radius: 6px; background: #0f172a; color: #e2e8f0; font-size: 13px; cursor: pointer; }
.cache-info { margin-left: 8px; font-size: 13px; color: #22c55e; }
.loading-state { display: flex; flex-direction: column; gap: 6px; align-items: center; color: #94a3b8; padding: 30px 20px; }
.loading-state .spinner { width: 24px; height: 24px; border: 3px solid #334155; border-top-color: #f59e0b; border-radius: 50%; animation: spin 0.6s linear infinite; margin-bottom: 8px; }
.loading-hint { font-size: 12px; color: #64748b; }
@keyframes spin { to { transform: rotate(360deg); } }
.error-msg { color: #ef4444; font-size: 14px; }
.dep-tree { max-height: 500px; overflow-y: auto; padding-right: 8px; }
.dep-tree::-webkit-scrollbar { width: 6px; }
.dep-tree::-webkit-scrollbar-track { background: #0f172a; border-radius: 3px; }
.dep-tree::-webkit-scrollbar-thumb { background: #475569; border-radius: 3px; }
.dep-node { margin-bottom: 2px; }
.dep-row { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 6px; transition: background 0.15s; }
.dep-row:hover { background: #0f172a; }
.dep-icon { font-size: 14px; width: 20px; text-align: center; }
.dep-name { color: #e2e8f0; font-weight: 600; font-size: 14px; font-family: 'SF Mono', 'Fira Code', monospace; }
.dep-version { color: #f59e0b; font-size: 13px; font-family: 'SF Mono', 'Fira Code', monospace; }
.dep-req { color: #64748b; font-size: 12px; }
.dep-kind.root { font-size: 11px; padding: 1px 6px; border-radius: 4px; background: #f59e0b22; color: #f59e0b; font-weight: 600; }
.cache-badge { margin-left: auto; font-size: 13px; padding: 2px 8px; border-radius: 4px; }
.cache-badge.cached { background: #22c55e22; }
.cache-badge:not(.cached) { background: #64748b22; color: #64748b; }
.dep-section-title { color: #94a3b8; font-size: 13px; font-weight: 600; padding: 10px 12px 6px; border-top: 1px solid #334155; margin-top: 4px; }
.build-dep .dep-row { opacity: 0.75; }
.empty-state { color: #64748b; padding: 20px; text-align: center; }
</style>
