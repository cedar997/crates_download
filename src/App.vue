<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { DepTreeNode } from '@/services/crates'
import CrateSearch from '@/components/CrateSearch.vue'
import DependencyList from '@/components/DependencyList.vue'
import DownloadPack from '@/components/DownloadPack.vue'

const crateName = ref('')
const crateVersion = ref('')
const searched = ref(false)
const isFileProtocol = ref(false)

onMounted(() => {
  isFileProtocol.value = window.location.protocol === 'file:'
})
const packages = ref<DepTreeNode[]>([])

function handleSearch(name: string, version: string) {
  crateName.value = name
  crateVersion.value = version
  searched.value = true
}

function handlePackagesUpdate(pkgs: DepTreeNode[]) {
  packages.value = pkgs
}

function handleCacheUpdated() {
  // Trigger dependency list to refresh cache status
}
</script>

<template>
  <div class="app-container">
    <header class="app-header">
      <h1>🦀 Crates.io 打包下载器</h1>
      <p class="subtitle">搜索 Rust 包，一键打包下载所有依赖</p>
    </header>

    <main class="app-main">
      <div v-if="isFileProtocol" class="file-warning">
        ⚠️ 检测到 <code>file://</code> 协议，无法使用 Vite 代理。<br>
        外部请求会因跨域失败，请改用 <code>pnpm dev</code> 启动开发服务器。
      </div>
      <CrateSearch @search="handleSearch" />

      <template v-if="searched && crateName">
        <DependencyList
          :crate-name="crateName"
          :crate-version="crateVersion"
          :active="searched"
          @update:packages="handlePackagesUpdate"
        />

        <DownloadPack
          :packages="packages"
          :crate-name="crateName"
          :crate-version="crateVersion"
        />
      </template>

      <div v-if="!searched" class="welcome">
        <div class="welcome-icon">📦</div>
        <h2>开始使用</h2>
        <p>在上方输入 Rust 包名，查看其依赖关系并一键打包下载所有关联的包。</p>
        <div class="feature-list">
          <div class="feature-item">
            <span class="feature-icon">🔍</span>
            <span>搜索任意 crates.io 上的 Rust 包</span>
          </div>
          <div class="feature-item">
            <span class="feature-icon">🌳</span>
            <span>查看完整的依赖树</span>
          </div>
          <div class="feature-item">
            <span class="feature-icon">📦</span>
            <span>一键打包下载所有依赖</span>
          </div>
          <div class="feature-item">
            <span class="feature-icon">💾</span>
            <span>浏览器缓存，避免重复下载</span>
          </div>
        </div>
      </div>
    </main>

    <footer class="app-footer">
      <p>数据来源: <a href="https://crates.io" target="_blank">crates.io</a> | 使用 IndexedDB 本地缓存</p>
    </footer>
  </div>
</template>

<style>
/* Global styles */
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background: #0f172a;
  color: #e2e8f0;
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

a {
  color: #f59e0b;
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}
</style>

<style scoped>
.app-container {
  max-width: 900px;
  margin: 0 auto;
  padding: 20px;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-header {
  text-align: center;
  padding: 30px 0 20px;
}

.app-header h1 {
  font-size: 28px;
  color: #f1f5f9;
  margin-bottom: 6px;
}

.subtitle {
  color: #64748b;
  font-size: 14px;
}

.app-main {
  flex: 1;
}

.file-warning {
  background: #fbbf2422;
  border: 1px solid #f59e0b;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 16px;
  font-size: 14px;
  color: #fbbf24;
  line-height: 1.7;
}
.file-warning code {
  background: #0f172a;
  padding: 1px 6px;
  border-radius: 3px;
  color: #f59e0b;
}

.welcome {
  text-align: center;
  padding: 60px 20px;
  background: #1e293b;
  border-radius: 12px;
  margin-top: 20px;
}

.welcome-icon {
  font-size: 64px;
  margin-bottom: 16px;
}

.welcome h2 {
  font-size: 22px;
  margin-bottom: 8px;
  color: #e2e8f0;
}

.welcome p {
  color: #94a3b8;
  margin-bottom: 24px;
  font-size: 15px;
}

.feature-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  text-align: left;
  max-width: 600px;
  margin: 0 auto;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: #0f172a;
  border-radius: 8px;
  font-size: 14px;
  color: #cbd5e1;
}

.feature-icon {
  font-size: 20px;
}

.app-footer {
  text-align: center;
  padding: 20px 0;
  color: #475569;
  font-size: 12px;
  margin-top: auto;
}
</style>
