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
  /**
   * 这里**没有**图片域名了（2026-09-20 起）。
   *
   * 插画地址的事实来源是数据库表 `illustration_asset`，前端启动时读
   * `GET /api/v3/platform/illustrations`（见 `stores/illustrationAssetsV3.ts`）。
   * 以前那个 `VITE_IMAGE_BASE_URL` 的毛病是：换一张图要重新构建并发布前端，
   * 而且少设一个环境变量就会静默退回本地素材。现在改库里的行即可生效。
   *
   * 上传用的 SecretId / SecretKey 依旧只存在于运维侧环境变量，
   * 前端构建不需要、也不应该拿到任何密钥。
   */
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
