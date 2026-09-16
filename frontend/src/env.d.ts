/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
  /**
   * 构建期开关：置为 `'1'` 时，生产构建也保留 `#/quiz?seed=...` 的验收答卷种子。
   * 仅用于浏览器验收打包产物（见 `src/dev/seed.ts`），正式发布不要开。
   */
  readonly VITE_ENABLE_SEED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
