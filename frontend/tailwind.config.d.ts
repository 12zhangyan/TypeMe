/**
 * `tailwind.config.js` 的类型声明。
 *
 * 该配置文件被 `frontend/src/views/views.spec.ts` 动态 import 以断言断点容器上限（IM-6），
 * 没有声明文件会让 `vue-tsc --noEmit` 报 TS7016 并阻断 `npm run build`。
 *
 * 只声明测试实际读取的路径。
 */
declare const config: {
  theme: {
    extend: {
      maxWidth: Record<string, string>
      [key: string]: unknown
    }
    [key: string]: unknown
  }
  [key: string]: unknown
}

export default config
