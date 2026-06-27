<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { DepTreeNode } from '@/services/crates'
import { downloadCrate } from '@/services/crates'
import { getCachedCrate, putCachedCrate } from '@/stores/cache'

const props = defineProps<{
  packages: DepTreeNode[]
  crateName: string
  crateVersion: string
}>()

const emit = defineEmits<{
  'cache-updated': []
}>()

interface DownloadProgress {
  name: string
  version: string
  status: 'pending' | 'cached' | 'downloading' | 'done' | 'error'
  size: number
  errorMsg?: string
}

const CONCURRENCY = 4 // download up to 4 crates simultaneously

const downloading = ref(false)
const progressItems = ref<DownloadProgress[]>([])
const overallProgress = ref('')
const zipReady = ref(false)
const zipBlob = ref<Blob | null>(null)
const downloadUrl = ref('')

// Deduplicate by name@version
const uniquePackages = computed(() => {
  const seen = new Map<string, DepTreeNode>()
  for (const p of props.packages) {
    const key = `${p.name}@${p.version}`
    if (!seen.has(key)) seen.set(key, p)
  }
  return Array.from(seen.values())
})

const totalCount = computed(() => uniquePackages.value.length)

const doneCount = computed(() =>
  progressItems.value.filter(p => p.status === 'done' || p.status === 'cached').length
)

const errorCount = computed(() =>
  progressItems.value.filter(p => p.status === 'error').length
)

const progressPercent = computed(() =>
  totalCount.value > 0 ? Math.round((doneCount.value / totalCount.value) * 100) : 0
)

// Reset state when packages change (new search)
watch(() => props.crateName + '@' + props.crateVersion, () => {
  zipReady.value = false
  zipBlob.value = null
  if (downloadUrl.value) {
    URL.revokeObjectURL(downloadUrl.value)
    downloadUrl.value = ''
  }
  progressItems.value = []
  overallProgress.value = ''
})

function formatSize(bytes: number): string {
  if (!bytes) return '?'
  const units = ['B', 'KB', 'MB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i++
  }
  return `${size.toFixed(1)} ${units[i]}`
}

async function downloadOne(item: DownloadProgress, zip: any): Promise<boolean> {
  // Check cache first
  const cached = await getCachedCrate(item.name, item.version)
  if (cached) {
    item.status = 'cached'
    item.size = cached.byteLength
    zip.file(`${item.name}-${item.version}.crate`, cached)
    return true
  }

  // Download
  item.status = 'downloading'
  try {
    const { data, actualVersion } = await downloadCrate(item.name, item.version)
    item.version = actualVersion
    item.status = 'done'
    item.size = data.byteLength
    // Cache it
    await putCachedCrate(item.name, item.version, data)
    zip.file(`${item.name}-${item.version}.crate`, data)
    return true
  } catch (e: any) {
    item.status = 'error'
    item.errorMsg = e.message || '下载失败'
    console.warn(`Failed to download ${item.name}@${item.version}:`, e)
    return false
  }
}

async function startDownload() {
  if (downloading.value) return

  downloading.value = true
  zipReady.value = false
  zipBlob.value = null
  if (downloadUrl.value) {
    URL.revokeObjectURL(downloadUrl.value)
    downloadUrl.value = ''
  }
  overallProgress.value = '准备下载...'

  // Initialize progress items
  progressItems.value = uniquePackages.value.map(p => ({
    name: p.name,
    version: p.version,
    status: 'pending' as const,
    size: 0,
  }))

  try {
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()

    const items = [...progressItems.value]
    let completedCount = 0
    let idx = 0

    // Concurrent download pool
    async function worker(): Promise<void> {
      while (idx < items.length) {
        const i = idx++
        const item = items[i]
        overallProgress.value = `下载中: ${item.name}@${item.version} (${completedCount}/${totalCount.value})`
        const ok = await downloadOne(item, zip)
        if (ok) completedCount++
      }
    }

    // Spawn CONCURRENCY workers
    const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => worker())
    await Promise.all(workers)

    overallProgress.value = '正在生成压缩包...'

    if (completedCount > 0) {
      const zipData = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      }, (metadata: { percent: number }) => {
        overallProgress.value = `打包中... ${metadata.percent.toFixed(0)}%`
      })

      zipBlob.value = zipData
      zipReady.value = true
      downloadUrl.value = URL.createObjectURL(zipData)
      overallProgress.value = `完成! ${completedCount}/${totalCount.value} 个包已打包`
    } else {
      overallProgress.value = '没有成功下载任何包'
    }

    emit('cache-updated')
  } catch (e: any) {
    overallProgress.value = `出错: ${e.message || '未知错误'}`
  } finally {
    downloading.value = false
  }
}

function triggerDownload() {
  if (!downloadUrl.value) return
  const link = document.createElement('a')
  link.href = downloadUrl.value
  link.download = `${props.crateName}-${props.crateVersion}-deps.zip`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
</script>

<template>
  <div v-if="totalCount > 0" class="download-pack">
    <div class="pack-header">
      <h3>📥 一键打包下载</h3>
      <span class="pack-summary">{{ totalCount }} 个包打包为一个 .zip 文件</span>
    </div>

    <!-- Progress bar -->
    <div v-if="downloading || zipReady" class="progress-section">
      <div class="progress-bar-track">
        <div
          class="progress-bar-fill"
          :style="{ width: progressPercent + '%' }"
          :class="{ complete: progressPercent === 100 }"
        ></div>
      </div>
      <div class="progress-text">
        <span>{{ overallProgress }}</span>
        <span class="progress-count">{{ doneCount }}/{{ totalCount }}</span>
        <span v-if="errorCount > 0" class="error-count">⚠️ {{ errorCount }} 个失败</span>
      </div>
    </div>

    <!-- Download item list -->
    <div v-if="downloading" class="download-items">
      <div
        v-for="item in progressItems"
        :key="`${item.name}@${item.version}`"
        class="download-item"
        :class="item.status"
      >
        <span class="item-icon">
          <template v-if="item.status === 'cached'">📋</template>
          <template v-else-if="item.status === 'downloading'">⏳</template>
          <template v-else-if="item.status === 'done'">✅</template>
          <template v-else-if="item.status === 'error'">❌</template>
          <template v-else>⬜</template>
        </span>
        <span class="item-name">{{ item.name }}</span>
        <span class="item-version">@{{ item.version }}</span>
        <span class="item-size" v-if="item.size">{{ formatSize(item.size) }}</span>
        <span class="item-error" v-if="item.errorMsg" :title="item.errorMsg">{{ item.errorMsg }}</span>
        <span class="item-status-label">
          {{ item.status === 'cached' ? '缓存' : item.status === 'done' ? '已下载' : item.status === 'error' ? '失败' : item.status === 'downloading' ? '下载中...' : '等待' }}
        </span>
      </div>
    </div>

    <!-- Buttons -->
    <div class="pack-actions">
      <button
        class="btn-download"
        :disabled="downloading"
        @click="startDownload"
      >
        <template v-if="downloading">
          <span class="spinner"></span>
          打包中...
        </template>
        <template v-else-if="zipReady">
          📦 重新打包
        </template>
        <template v-else>
          📦 下载全部依赖 ({{ totalCount }} 个包)
        </template>
      </button>

      <button
        v-if="zipReady"
        class="btn-save"
        @click="triggerDownload"
      >
        💾 保存压缩包 ({{ formatSize(zipBlob?.size || 0) }})
      </button>
    </div>
  </div>
</template>

<style scoped>
.download-pack {
  background: linear-gradient(135deg, #1e293b, #0f172a);
  border: 2px solid #334155;
  border-radius: 12px;
  padding: 20px;
}

.pack-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 8px;
}

.pack-header h3 {
  margin: 0;
  font-size: 18px;
  color: #e2e8f0;
}

.pack-summary {
  font-size: 13px;
  color: #94a3b8;
}

.progress-section {
  margin-bottom: 16px;
}

.progress-bar-track {
  height: 8px;
  background: #334155;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 8px;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #f59e0b, #d97706);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.progress-bar-fill.complete {
  background: linear-gradient(90deg, #22c55e, #16a34a);
}

.progress-text {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: #94a3b8;
}

.progress-count {
  font-weight: 700;
  color: #e2e8f0;
}

.error-count {
  color: #ef4444;
  font-weight: 600;
}

.download-items {
  max-height: 300px;
  overflow-y: auto;
  margin-bottom: 16px;
  padding-right: 8px;
}

.download-items::-webkit-scrollbar {
  width: 6px;
}

.download-items::-webkit-scrollbar-track {
  background: #0f172a;
  border-radius: 3px;
}

.download-items::-webkit-scrollbar-thumb {
  background: #475569;
  border-radius: 3px;
}

.download-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 13px;
  transition: background 0.15s;
}

.download-item:hover {
  background: #1e293b;
}

.download-item.cached {
  opacity: 0.7;
}

.download-item.error {
  background: #ef444411;
}

.item-icon {
  width: 20px;
  text-align: center;
}

.item-name {
  color: #e2e8f0;
  font-weight: 600;
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.item-version {
  color: #f59e0b;
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.item-size {
  color: #64748b;
  font-size: 12px;
}

.item-error {
  color: #ef4444;
  font-size: 11px;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-status-label {
  margin-left: auto;
  font-size: 11px;
  color: #64748b;
}

.download-item.done .item-status-label {
  color: #22c55e;
}

.download-item.cached .item-status-label {
  color: #f59e0b;
}

.download-item.error .item-status-label {
  color: #ef4444;
}

.pack-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.btn-download,
.btn-save {
  padding: 12px 24px;
  border: none;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn-download {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #0f172a;
}

.btn-download:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
}

.btn-download:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-save {
  background: linear-gradient(135deg, #22c55e, #16a34a);
  color: #fff;
}

.btn-save:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(34, 197, 94, 0.4);
}

.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid transparent;
  border-top-color: #0f172a;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
