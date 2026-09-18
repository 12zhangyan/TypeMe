import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { installSessionExpiryBridge } from './stores/auth'
import './style.css'
import './design/atelier.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)

/**
 * 任何 `/api/v3` 请求收到 `UNAUTHENTICATED` 都要让本地登录态立刻失效。
 *
 * 必须在 pinia 装好之后调用：桥接里会取 store 实例。
 */
installSessionExpiryBridge()

app.mount('#app')
