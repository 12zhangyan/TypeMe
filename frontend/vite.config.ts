import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// 纯静态产物：base 用相对路径，便于放到任意子目录 / 单文件分发
export default defineConfig({
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // 本地开发时把 /api/v1 代理到后端（后端不可用时前端会静默降级到内置副本）
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_TARGET ?? 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
    watch: {
      // 编辑器/工具写文件时会先在同目录建 `.<name>.<pid>.<uuid>.tmpdir/<name>.tmp` 再替换。
      // chokidar 去 watch 这些临时文件时会在 Windows 上抛 EBUSY 并**整进程退出**
      // （本项目验收时真的被它打断过一次），所以显式忽略。
      ignored: ['**/.*.tmpdir/**', '**/*.tmp'],
    },
  },
  build: {
    target: 'es2019',
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    reporters: 'default',
  },
})
