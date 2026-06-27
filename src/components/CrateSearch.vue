<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{
  search: [name: string, version: string]
}>()

const crateName = ref('')
const crateVersion = ref('')
const error = ref('')

function handleSearch() {
  const name = crateName.value.trim()
  const version = crateVersion.value.trim()
  if (!name) {
    error.value = '请输入包名'
    return
  }
  if (!version) {
    error.value = '请输入版本号'
    return
  }
  error.value = ''
  emit('search', name, version)
}
</script>

<template>
  <div class="crate-search">
    <div class="search-row">
      <div class="input-group">
        <label for="crate-name">包名</label>
        <input
          id="crate-name"
          v-model="crateName"
          type="text"
          placeholder="例如: serde, tokio, clap"
          @keyup.enter="handleSearch"
        />
      </div>
      <div class="input-group">
        <label for="crate-version">版本</label>
        <input
          id="crate-version"
          v-model="crateVersion"
          type="text"
          placeholder="例如: 1.0.219"
          @keyup.enter="handleSearch"
        />
      </div>
      <button class="btn-search" :disabled="!crateName.trim() || !crateVersion.trim()" @click="handleSearch">
        🔍 解析依赖
      </button>
    </div>
    <p v-if="error" class="error-msg">{{ error }}</p>
  </div>
</template>

<style scoped>
.crate-search { margin-bottom: 24px; }
.search-row { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
.input-group { display: flex; flex-direction: column; gap: 4px; }
.input-group label { font-size: 13px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
.input-group input {
  padding: 10px 14px; border: 2px solid #334155; border-radius: 8px;
  background: #1e293b; color: #e2e8f0; font-size: 15px; width: 220px;
  transition: border-color 0.2s; outline: none;
}
.input-group input:focus { border-color: #f59e0b; }
.input-group input::placeholder { color: #64748b; }

.btn-search {
  padding: 10px 24px; border: none; border-radius: 8px;
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #0f172a; font-size: 15px; font-weight: 700; cursor: pointer;
  transition: all 0.2s; height: 44px;
}
.btn-search:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4); }
.btn-search:disabled { opacity: 0.5; cursor: not-allowed; }
.error-msg { margin-top: 10px; color: #ef4444; font-size: 14px; }
</style>
