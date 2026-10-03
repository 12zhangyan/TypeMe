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
 *
 * ## 为什么必须绑世代 / 账号
 *
 * `resetAdminProbe()` 只能丢掉 **inflight 引用**，不能取消已经发出去的 HTTP。
 * 管理员探测还没回来就退出、再登录一个普通账号时：新账号的 403 可能先落地，
 * 旧的 200 随后写入模块级 `cached` —— 顶栏和账号页会把普通用户标成管理员。
 * 每次身份变化抬高世代，响应落地前核对世代与 userId，对不上就丢弃。
 */

let generation = 0
let ownerUserId: string | null = null
let inflight: Promise<boolean> | null = null
let inflightGeneration = -1
let cached: boolean | null = null

const isAdmin = ref(false)

function stillCurrent(startedGeneration: number, startedUserId: string | null): boolean {
  return startedGeneration === generation && startedUserId === ownerUserId
}

async function probe(startedGeneration: number, startedUserId: string | null): Promise<boolean> {
  let decided: boolean | null = null
  try {
    await fetchAdminAiSettings()
    decided = true
  } catch (error) {
    if (isForbidden(error)) {
      decided = false
    } else if (isSessionExpired(error)) {
      if (stillCurrent(startedGeneration, startedUserId)) isAdmin.value = false
      return false
    } else {
      return false
    }
  }
  if (!stillCurrent(startedGeneration, startedUserId) || decided === null) {
    return false
  }
  cached = decided
  isAdmin.value = decided
  return decided
}

/**
 * 问一次（或复用缓存）。返回的 ref 会在有结果后更新，页面直接 `v-if="isAdmin"`。
 *
 * 失败一律当作"没有入口"，但**不缓存失败** —— 后端恢复后刷新页面就能看到入口。
 * `userId` 用来绑定这次探测属于谁：账号切换后，上一个账号的响应不得写入缓存。
 */
export function useAdminProbe(): {
  isAdmin: typeof isAdmin
  refresh: (userId?: string) => Promise<boolean>
} {
  return {
    isAdmin,
    refresh: async (userId?: string) => {
      if (userId !== undefined) ownerUserId = userId
      if (cached !== null) {
        isAdmin.value = cached
        return cached
      }
      const startedGeneration = generation
      const startedUserId = ownerUserId
      if (!inflight || inflightGeneration !== startedGeneration) {
        inflightGeneration = startedGeneration
        inflight = probe(startedGeneration, startedUserId).finally(() => {
          if (inflightGeneration === startedGeneration) inflight = null
        })
      }
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
 * <p>所有"身份变了"的路径都汇到 `auth` 的 `applyAnonymous` / `applyProfile`。
 * `applyAnonymous` 每次都清；`applyProfile` **只在 userId 变了时清** ——
 * 同一人改昵称/改密也会 applyProfile，清了就会让顶栏「管理」消失。
 * 散在页面里写一定会漏（退出、注销、恢复密码、会话过期、换账号各是一条）。
 *
 * <p>清缓存会抬高世代：飞行中的旧请求回来时对不上，结果直接丢弃。
 */
export function resetAdminProbe(): void {
  generation += 1
  ownerUserId = null
  inflight = null
  cached = null
  isAdmin.value = false
}

/** 仅测试用：与 {@link resetAdminProbe} 同义，保留旧名字避免改动既有用例。 */
export function resetAdminProbeForTests(): void {
  resetAdminProbe()
}
