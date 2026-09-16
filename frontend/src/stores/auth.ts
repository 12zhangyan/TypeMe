import { defineStore } from 'pinia'
import { clearCsrfToken } from '@/api/csrf'
import {
  changePassword as changePasswordRequest,
  describeError,
  exportAccountData,
  fetchMe,
  isV3ApiError,
  loginAccount,
  logoutAccount,
  recoverAccount,
  regenerateRecoveryCodes,
  registerAccount,
  requestAccountDeletion,
  updateNickname as updateNicknameRequest,
  UNAUTHENTICATED_CODE,
  type AccountProfile,
  type DeletionResult,
  type ErrorDisplay,
  type ExportResult,
  type RegisterResult,
} from '@/api/v3'

/**
 * 登录态 —— 契约 `02-数据模型与API-v1.md` §7.2、`03-AI与前端契约-v1.md` §7.1。
 *
 * 三条不能破的纪律：
 *
 *   1. **不存任何 token**。会话是 HttpOnly cookie，前端读不到也不该读；
 *      这个 store 里没有一个字段是"凭据"，localStorage 更是完全不碰。
 *      掉登录态的唯一方式是服务端说 401，或用户点了退出。
 *   2. **不把"没连上服务器"说成"没登录"**。两者要分开：
 *      `anonymous` 是服务端明确说未登录（401），`unavailable` 是压根没问到。
 *      后者如果当成"未登录"，用户会在后端抖动时看到自己"被退出"，然后去重新登录。
 *   3. **失败原样上报**。所有失败都整理成 {@link ErrorDisplay} 存进 `lastError`
 *      （含 `requestId`），页面直接渲染，不再自己拼错误文案。
 */

export type AuthStatus =
  /** 还没问过服务端 */
  | 'unknown'
  /** 服务端明确说未登录（401） */
  | 'anonymous'
  /** 已登录，profile 有效 */
  | 'authenticated'
  /** 没问到服务端（网络/5xx）：既不能说已登录，也不能说未登录 */
  | 'unavailable'

interface AuthState {
  status: AuthStatus
  profile: AccountProfile | null
  /** `unavailable` 时的一句话（页面低调提示，不要写成"登录失败"） */
  sessionNotice: string | null
  /** 最近一次失败，交给页面渲染；成功一次就清空 */
  lastError: ErrorDisplay | null
  /** 有请求在飞（按钮用它做 disabled，并给出原因） */
  busy: boolean
}

/**
 * 会话检查的合并：App 壳与路由守卫会在同一帧各要一次登录态，
 * 不合并就会打两次 `GET /me`。
 */
let sessionCheck: Promise<void> | null = null

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    status: 'unknown',
    profile: null,
    sessionNotice: null,
    lastError: null,
    busy: false,
  }),

  getters: {
    isAuthenticated: (state): boolean => state.status === 'authenticated' && state.profile !== null,
    isAnonymous: (state): boolean => state.status === 'anonymous',
    isChecking: (state): boolean => state.status === 'unknown',
    /** 界面上的称法：优先昵称，退回用户名；都没登录就是空串。 */
    displayName: (state): string => state.profile?.nickname || state.profile?.username || '',
  },

  actions: {
    /** 记下一份有效资料（登录 / 注册 / 拉取 /me 都走这里）。 */
    applyProfile(profile: AccountProfile) {
      this.profile = profile
      this.status = 'authenticated'
      this.sessionNotice = null
    },

    /** 变成未登录。`notice` 用来解释"为什么突然要重新登录"。 */
    applyAnonymous(notice: string | null = null) {
      this.profile = null
      this.status = 'anonymous'
      this.sessionNotice = notice
    },

    /** 把失败整理好：存进 `lastError`，401 顺带把登录态清掉。 */
    captureError(error: unknown): ErrorDisplay {
      const display = describeError(error)
      this.lastError = display
      if (display.sessionExpired) this.applyAnonymous(display.message)
      return display
    },

    clearError() {
      this.lastError = null
    },

    /** 让 App 壳 / 页面把"会话检查失败"显示出来，而不是假装没登录。 */
    markCheckUnavailable(error: unknown) {
      const display = describeError(error)
      if (display.sessionExpired) {
        this.applyAnonymous(display.message)
        return
      }
      this.profile = null
      this.status = 'unavailable'
      this.sessionNotice = display.message
    },

    /**
     * 确认一次登录态。已经确认过就直接返回（`force` 时才重新问）。
     *
     * 401 之后返回 `anonymous`；连不上服务器返回 `unavailable` —— **绝不抛异常**：
     * 它会在路由守卫里被 await，抛出去会让整站导航失败。
     */
    async ensureLoaded(force = false): Promise<void> {
      if (!force && this.status !== 'unknown') return
      if (sessionCheck) {
        await sessionCheck
        return
      }
      sessionCheck = this.checkSession()
      try {
        await sessionCheck
      } finally {
        sessionCheck = null
      }
    },

    /** 单次会话检查（只由 `ensureLoaded` 调用，保证并发合并）。 */
    async checkSession(): Promise<void> {
      try {
        this.applyProfile(await fetchMe())
      } catch (error) {
        this.markCheckUnavailable(error)
      }
    },

    async refreshProfile(): Promise<AccountProfile | null> {
      try {
        const profile = await fetchMe()
        this.applyProfile(profile)
        return profile
      } catch (error) {
        this.captureError(error)
        throw error
      }
    },

    async login(username: string, password: string): Promise<AccountProfile> {
      this.busy = true
      this.lastError = null
      try {
        const profile = await loginAccount({ username, password })
        this.applyProfile(profile)
        // 登录会轮换会话 ID（会话固定防护），旧 CSRF token 必然失效：
        // 清掉它，下一个写操作会重新取一份（而不是先撞 403 再重试）。
        clearCsrfToken()
        return profile
      } catch (error) {
        this.captureError(error)
        throw error
      } finally {
        this.busy = false
      }
    },

    /**
     * 注册。成功即已登录（契约 §7.2），同时拿到**只此一次**的恢复码。
     * store 只负责把恢复码交给页面，不缓存、不落盘、不写日志。
     */
    async register(username: string, password: string, nickname?: string): Promise<RegisterResult> {
      this.busy = true
      this.lastError = null
      try {
        const result = await registerAccount({ username, password, nickname })
        this.applyProfile(result.profile)
        clearCsrfToken()
        return result
      } catch (error) {
        this.captureError(error)
        throw error
      } finally {
        this.busy = false
      }
    },

    /**
     * 退出。
     *
     * 即使服务端没答复，本地也一律清干净：让用户"点了退出却还是登录态"是更糟的失败。
     * 返回是否通知到了服务端，页面据此决定要不要提示。
     */
    async logout(): Promise<{ notifiedServer: boolean }> {
      this.busy = true
      let notifiedServer = true
      try {
        await logoutAccount()
      } catch (error) {
        const display = describeError(error)
        // "退出时发现会话本来就过期了"不算失败：结果正是我们想要的
        if (!display.sessionExpired) {
          notifiedServer = false
          console.warn('[typeme] 退出请求失败：', display.code, display.requestId)
        }
      } finally {
        clearCsrfToken()
        this.applyAnonymous()
        this.lastError = null
        this.busy = false
      }
      return { notifiedServer }
    },

    /**
     * 用恢复码重置密码（协议里不会自动登录）。
     *
     * 服务端会撤销该账号**全部**会话并作废其余恢复码，所以这里也把本地登录态清掉，
     * 让"拿新密码重新登录一次"成为验证新密码真的可用的最短路径。
     */
    async recover(username: string, recoveryCode: string, newPassword: string): Promise<void> {
      this.busy = true
      this.lastError = null
      try {
        await recoverAccount({ username, recoveryCode, newPassword })
        clearCsrfToken()
        this.applyAnonymous()
      } catch (error) {
        this.captureError(error)
        throw error
      } finally {
        this.busy = false
      }
    },

    async saveNickname(nickname: string): Promise<AccountProfile> {
      this.busy = true
      this.lastError = null
      try {
        const profile = await updateNicknameRequest(nickname)
        this.applyProfile(profile)
        return profile
      } catch (error) {
        this.captureError(error)
        throw error
      } finally {
        this.busy = false
      }
    },

    /** 改密：服务端会撤销**其他**会话，当前这个保留，所以本地登录态不动。 */
    async changePassword(currentPassword: string, newPassword: string): Promise<void> {
      this.busy = true
      this.lastError = null
      try {
        await changePasswordRequest({ currentPassword, newPassword })
        await this.refreshProfile()
      } catch (error) {
        this.captureError(error)
        throw error
      } finally {
        this.busy = false
      }
    },

    /** 重新生成恢复码：返回值**只出现这一次**，页面必须让用户抄下来。 */
    async issueRecoveryCodes(currentPassword: string): Promise<string[]> {
      this.busy = true
      this.lastError = null
      try {
        return await regenerateRecoveryCodes(currentPassword)
      } catch (error) {
        this.captureError(error)
        throw error
      } finally {
        this.busy = false
      }
    },

    /** 导出个人数据：只把文件交给页面，下载动作由页面做（才能给出可见反馈）。 */
    async exportData(): Promise<ExportResult> {
      this.busy = true
      this.lastError = null
      try {
        return await exportAccountData()
      } catch (error) {
        this.captureError(error)
        throw error
      } finally {
        this.busy = false
      }
    },

    /** 注销账号：受理后服务端立即禁止登录，本地也立刻变成未登录。 */
    async deleteAccount(password: string): Promise<DeletionResult> {
      this.busy = true
      this.lastError = null
      try {
        const result = await requestAccountDeletion({ password, confirm: 'DELETE' })
        clearCsrfToken()
        this.applyAnonymous()
        return result
      } catch (error) {
        this.captureError(error)
        throw error
      } finally {
        this.busy = false
      }
    },

    /** 供测试与"换账号"场景用：回到"还没问过服务端"。 */
    reset() {
      this.status = 'unknown'
      this.profile = null
      this.sessionNotice = null
      this.lastError = null
      this.busy = false
    },
  },
})

/** 供路由守卫与页面判断用：这个错误码表示"请重新登录"。 */
export function isUnauthenticated(error: unknown): boolean {
  return isV3ApiError(error) && error.code === UNAUTHENTICATED_CODE
}
