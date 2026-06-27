import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { resolve } from 'path'

export default defineConfig(({ mode }) => ({
  // CI: use repo name as base, Dev: relative path
  base: process.env.BASE || './',
  plugins: [
    vue(),
    // Enable singlefile for truly portable builds:
    // viteSingleFile(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    proxy: {
      '/crates-index': {
        target: 'https://mirrors.ustc.edu.cn',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/crates-index/, '/crates.io-index'),
      },
      '/crates-dl': {
        target: 'https://mirrors.ustc.edu.cn',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/crates-dl/, '/crates.io/crates'),
      },
      '/crates-dl2': {
        target: 'https://mirrors.tuna.tsinghua.edu.cn',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/crates-dl2/, '/crates.io/crates'),
      },
    },
  },
}))
