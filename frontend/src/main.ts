import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { installSessionExpiryBridge } from './stores/auth'
import { useIllustrationAssetsStore } from './stores/illustrationAssetsV3'
import './style.css'
import './design/atelier.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)

/**
 * 任何 `/api/v3` 请求收到 `UNAUTHENTICATED` 都要让本地登录态立刻失效。
 *
 * 必须在 pinia 装好之后调用：桥接里会取 store 实例。
 */
installSessionExpiryBridge()

/**
 * 插画地址表**尽早**开始读（就在挂载之前），因为首屏第一张图要等它。
 *
 * `hydrate()` 是同步的（读上一次的 localStorage 缓存），所以重复访问时首帧就有地址；
 * `load()` 不 await：这里只负责"现在就发请求"，让它在路由与页面渲染的同时并行进行。
 */
const illustrations = useIllustrationAssetsStore(pinia)
illustrations.hydrate()
void illustrations.load()

app.mount('#app')
