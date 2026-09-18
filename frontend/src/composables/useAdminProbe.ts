import { ref } from 'vue'
import { fetchAdminAiSettings } from '@/api/v3Admin'
import { isForbidden, isSessionExpired } from '@/api/v3'

/**
 * "当前登录账号是不是管理员" —— 契约里**故意没有**的地方。
 *
 * `/me` 不回 `role`（后端 `MeResponse` 的注释写明了理由：内部状态不进公开资料），
 * 所以这个问题唯一的答案是去问一个被保护的接口：拿到 200 就是，403 就不是。
 * 任何别的情况（网络失败、5xx、会话失效）都**不是**"不是管理员"——
 * 那只是"没问到"，这时正确答案是**什么都不显示**（不显示入口，也不显示
 * "你没有权限"的提示 —— 普通用户根本不该知道有后台这个东西）。
 *
 * ## 为什么要合并请求
 *
 * `AccountView` 与 `AdminView` 可能在同一次导航里都要问一次（例如从账号页点进去）。
 * 再加一次 `GET /admin/ai-settings` 没有意义，所以这里用模块级 promise 合并飞行中的请求，
 * 并在成功后缓存结果（角色在一次会话里几乎不会变）。
 */

let inflight: Promise<boolean> | null = null
let cached: boolean | null = null

const isAdmin = ref(false)

async function probe(): Promise<boolean> {
  try {
    await fetchAdminAiSettings()
    cached = true
  } catch (error) {
    if (isForbidden(error)) {
      cached = false
    } else if (isSessionExpired(error)) {
      // 会话失效：**不缓存**。这不是"这个账号不是管理员"，而是"这次没问到"。
      // 缓存 false 的后果是：用户在同一页里重新登录之后，后台入口仍然不出现
      // （页面不刷新就永远看不到），而本文件的注释一直写着"失败不缓存"（第 17 轮）。
      isAdmin.value = false
      return false
    } else {
      // 没问到：不缓存，下次再问。
      return false
    }
  }
  isAdmin.value = cached
  return cached
}

/**
 * 问一次（或复用缓存）。返回的 ref 会在有结果后更新，页面直接 `v-if="isAdmin"`。
 *
 * 失败一律当作"没有入口"，但**不缓存失败** —— 后端恢复后刷新页面就能看到入口。
 */
export function useAdminProbe(): { isAdmin: typeof isAdmin; refresh: () => Promise<boolean> } {
  return {
    isAdmin,
    refresh: async () => {
      if (cached !== null) {
        isAdmin.value = cached
        return cached
      }
      inflight ??= probe().finally(() => {
        inflight = null
      })
      return inflight
    },
  }
}

/**
 * 换账号 / 退出登录时清掉缓存（2026-09-18 第 17 轮）。
 *
 * <p><b>为什么必须清</b>：`cached` 是模块级的，一次会话里不会变——但"一次会话"结束后
 * 它就变成了**上一个账号的答案**。共用设备上管理员退出、普通用户登录之后，
 * `cached = true` 会让后台入口出现在普通用户面前；点进去虽然会 403，
 * 但这个入口存在本身就已经泄露了"这台站有后台"（本文件开头写明普通用户根本不该知道）。
 *
 * <p>所有"身份变了"的路径都汇到 `auth` 的 `applyAnonymous` / `applyProfile`，
 * 所以由它们调用；散在页面里写一定会漏（退出、注销、恢复密码、会话过期、换账号各是一条）。
 */
export function resetAdminProbe(): void {
  inflight = null
  cached = null
  isAdmin.value = false
}

/** 仅测试用：与 {@link resetAdminProbe} 同义，保留旧名字避免改动既有用例。 */
export function resetAdminProbeForTests(): void {
  resetAdminProbe()
}
