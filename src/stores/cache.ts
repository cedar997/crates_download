/**
 * IndexedDB-based cache for downloaded .crate files.
 * Caches the raw ArrayBuffer keyed by "{crateName}-{version}".
 */

const DB_NAME = 'crates-downloader-cache'
const DB_VERSION = 1
const STORE_NAME = 'crate-files'

interface CacheEntry {
  id: string          // "{name}-{version}"
  crateName: string
  version: string
  data: ArrayBuffer
  size: number
  cachedAt: number    // timestamp
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function getCachedCrate(name: string, version: string): Promise<ArrayBuffer | null> {
  const db = await openDB()
  const id = `${name}-${version}`
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.get(id)
    req.onsuccess = () => {
      const entry = req.result as CacheEntry | undefined
      resolve(entry ? entry.data : null)
    }
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}

export async function putCachedCrate(name: string, version: string, data: ArrayBuffer): Promise<void> {
  const db = await openDB()
  const id = `${name}-${version}`
  const entry: CacheEntry = {
    id,
    crateName: name,
    version,
    data,
    size: data.byteLength,
    cachedAt: Date.now(),
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.put(entry)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => reject(tx.error)
  })
}

export async function getCacheStats(): Promise<{ count: number; totalSize: number; entries: { name: string; version: string; size: number; cachedAt: number }[] }> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.getAll()
    req.onsuccess = () => {
      const entries = req.result as CacheEntry[]
      resolve({
        count: entries.length,
        totalSize: entries.reduce((sum, e) => sum + e.size, 0),
        entries: entries.map(e => ({
          name: e.crateName,
          version: e.version,
          size: e.size,
          cachedAt: e.cachedAt,
        })),
      })
    }
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}

export async function clearCache(): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.clear()
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => reject(tx.error)
  })
}

export async function isCrateCached(name: string, version: string): Promise<boolean> {
  const data = await getCachedCrate(name, version)
  return data !== null
}
