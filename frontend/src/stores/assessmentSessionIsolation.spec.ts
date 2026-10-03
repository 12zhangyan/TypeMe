// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAssessmentStore } from './assessmentV3'
import { useAuthStore } from './auth'
import { useBigFiveStore } from './bigFiveV3'
import type { AttemptDetail } from '@/api/v3Assessment'
import type { AttemptView } from '@/api/platformV3'

const { fetchAttemptDetail, patchAnswers } = vi.hoisted(() => ({ fetchAttemptDetail: vi.fn(), patchAnswers: vi.fn() }))
const { fetchPlatformAttempt, patchPlatformAnswers, submitPlatformAttempt } = vi.hoisted(() => ({
  fetchPlatformAttempt: vi.fn(), patchPlatformAnswers: vi.fn(), submitPlatformAttempt: vi.fn(),
}))
vi.mock('@/api/v3Assessment', async () => ({
  ...await vi.importActual<typeof import('@/api/v3Assessment')>('@/api/v3Assessment'),
  fetchAttemptDetail, patchAnswers,
}))
vi.mock('@/api/platformV3', async () => ({
  ...await vi.importActual<typeof import('@/api/platformV3')>('@/api/platformV3'),
  fetchPlatformAttempt, patchPlatformAnswers, submitPlatformAttempt,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const detail = (attemptId: string): AttemptDetail => ({
  attemptId, packageId: 'v1', status: 'BASE_IN_PROGRESS', revision: 2,
  currentQuestionId: 'q1', clarificationDimensions: [], clarificationSkipped: false,
  startedAt: '2026-09-23T00:00:00Z', updatedAt: '2026-09-23T00:00:00Z', submittedAt: null,
  reportId: null, baseAttemptId: null, answers: [], coverage: [], packageView: null,
})
const user = (userId: string) => ({ userId, username: userId, nickname: null,
  createdAt: '2026-09-23T00:00:00Z', passwordChangedAt: null })
const bigDraft = (revision = 2): AttemptView => ({
  attemptId: 'big-draft', revision, status: 'BASE_IN_PROGRESS', answers: [], items: [],
  requiredCount: 50,
} as unknown as AttemptView)

describe('十六型异步响应的账号隔离', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

  it('刷新同一账号资料不会丢掉尚未同步的答案', () => {
    const auth = useAuthStore()
    auth.applyProfile(user('a'))
    const store = useAssessmentStore()
    store.applyDetail(detail('a-draft'))
    store.answers = { q1: { questionId: 'q1', kind: 'rating', rating: 5 } }
    store.unconfirmed = { ...store.answers }
    auth.applyProfile({ ...user('a'), nickname: '更新昵称' })
    expect(store.attemptId).toBe('a-draft')
    expect(store.unconfirmed.q1?.rating).toBe(5)
  })

  it('会话失效后原账号重登可保留未确认答案；另一账号不能读取它', async () => {
    const auth = useAuthStore()
    auth.applyProfile(user('a'))
    const store = useAssessmentStore()
    store.applyDetail(detail('a-draft'))
    store.answers = { q1: { questionId: 'q1', kind: 'rating', rating: 5 } }
    store.unconfirmed = { ...store.answers }
    auth.applyAnonymous('登录状态已过期')
    auth.applyProfile(user('a'))
    fetchAttemptDetail.mockResolvedValueOnce(detail('a-draft'))
    await store.load('a-draft')
    expect(store.unconfirmed.q1?.rating).toBe(5)
    auth.applyAnonymous('登录状态已过期')
    auth.applyProfile(user('b'))
    expect(store.attemptId).toBeNull()
    expect(store.unconfirmed).toEqual({})
  })

  it('原账号重登但服务端修订已变化时保留本地回答且不自动覆盖', async () => {
    const auth = useAuthStore()
    auth.applyProfile(user('a'))
    const store = useAssessmentStore()
    store.applyDetail(detail('a-draft'))
    store.answers = { q1: { questionId: 'q1', kind: 'rating', rating: 5 } }
    store.unconfirmed = { ...store.answers }
    auth.applyAnonymous('登录状态已过期')
    auth.applyProfile(user('a'))
    fetchAttemptDetail.mockResolvedValueOnce({ ...detail('a-draft'), revision: 4 })
    await store.load('a-draft')
    expect(store.conflict?.currentRevision).toBe(4)
    expect(store.unconfirmed.q1?.rating).toBe(5)
    expect(store.revision).toBe(2)
    expect(patchAnswers).not.toHaveBeenCalled()
    fetchAttemptDetail.mockResolvedValueOnce({ ...detail('a-draft'), revision: 4 })
    await store.reload()
    expect(store.conflict).toBeNull()
    expect(store.unconfirmed).toEqual({})
    expect(store.revision).toBe(4)
  })

  it('A 的详情晚到不能覆盖 B 的草稿', async () => {
    const auth = useAuthStore()
    auth.applyProfile(user('a'))
    const store = useAssessmentStore()
    const old = deferred<AttemptDetail>()
    fetchAttemptDetail.mockReturnValueOnce(old.promise).mockResolvedValueOnce(detail('b-draft'))
    const pending = store.load('a-draft')
    auth.applyProfile(user('b'))
    await store.load('b-draft')
    old.resolve(detail('a-draft'))
    await pending
    expect(store.attemptId).toBe('b-draft')
    expect(store.revision).toBe(2)
  })

  it('A 的 PATCH 晚到不能把 B 的未保存题目清空或误报已保存', async () => {
    const auth = useAuthStore()
    auth.applyProfile(user('a'))
    const store = useAssessmentStore()
    store.applyDetail(detail('a-draft'))
    store.answers = { q1: { questionId: 'q1', kind: 'rating', rating: 2 } }
    store.unconfirmed = { ...store.answers }
    const old = deferred<{ revision: number; status: string; clarificationDimensions: string[]; clarificationReset: boolean }>()
    patchAnswers.mockReturnValueOnce(old.promise)
    const pending = store.flush()
    auth.applyProfile(user('b'))
    store.applyDetail(detail('b-draft'))
    store.answers = { q2: { questionId: 'q2', kind: 'rating', rating: 5 } }
    store.unconfirmed = { ...store.answers }
    store.saveState = 'error'
    old.resolve({ revision: 3, status: 'BASE_IN_PROGRESS', clarificationDimensions: [], clarificationReset: false })
    await pending
    expect(store.attemptId).toBe('b-draft')
    expect(store.revision).toBe(2)
    expect(store.unconfirmed.q2?.rating).toBe(5)
    expect(store.saveState).toBe('error')
  })
})

describe('大五会话恢复的账号隔离', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

  it('原账号重新登录后，未确认答案仍在且可从原修订继续保存', async () => {
    const auth = useAuthStore()
    auth.applyProfile(user('a'))
    const store = useBigFiveStore()
    store.adopt(bigDraft())
    store.setAnswer('Q1', 'RATING', 5)
    auth.applyAnonymous('登录已过期')
    expect(store.unsavedCount).toBe(1)
    auth.applyProfile(user('a'))
    fetchPlatformAttempt.mockResolvedValueOnce(bigDraft())
    await store.load('big-draft')
    expect(store.answers.Q1?.rating).toBe(5)
    expect(store.unsavedCount).toBe(1)
    expect(store.conflict).toBe(false)
    expect(store.lastSaveError).toContain('请点击重新保存')
    patchPlatformAnswers.mockResolvedValueOnce({ revision: 3, status: 'BASE_IN_PROGRESS',
      answeredCount: 1, answerComplete: false, currentQuestionId: null })
    expect(await store.saveNow()).toBe(true)
    expect(patchPlatformAnswers).toHaveBeenCalledWith('big-draft', expect.objectContaining({
      expectedRevision: 2, responses: [{ questionId: 'Q1', kind: 'RATING', rating: 5 }],
    }))
  })

  it('服务端修订已变化时不自动覆盖；换账号不继承待同步答案', async () => {
    const auth = useAuthStore()
    auth.applyProfile(user('a'))
    const store = useBigFiveStore()
    store.adopt(bigDraft())
    store.setAnswer('Q1', 'UNKNOWN', null)
    auth.applyAnonymous('登录已过期')
    auth.applyProfile(user('a'))
    fetchPlatformAttempt.mockResolvedValueOnce(bigDraft(4))
    await store.load('big-draft')
    expect(store.conflict).toBe(true)
    expect(store.answers.Q1?.kind).toBe('UNKNOWN')
    expect(store.lastSaveError).toBeNull()
    expect(store.attempt?.revision).toBe(2)
    expect(await store.saveNow()).toBe(false)
    expect(patchPlatformAnswers).not.toHaveBeenCalled()
    auth.applyAnonymous('登录已过期')
    auth.applyProfile(user('b'))
    expect(store.attempt).toBeNull()
    expect(store.answers).toEqual({})
  })

  it('过期前仍在途的保存响应不能在恢复后误报已保存', async () => {
    const auth = useAuthStore()
    auth.applyProfile(user('a'))
    const store = useBigFiveStore()
    store.adopt(bigDraft())
    store.setAnswer('Q1', 'RATING', 4)
    const old = deferred<{ revision: number; status: string; answeredCount: number;
      answerComplete: boolean; currentQuestionId: null }>()
    patchPlatformAnswers.mockReturnValueOnce(old.promise)
    const saving = store.saveNow()
    auth.applyAnonymous('登录已过期')
    auth.applyProfile(user('a'))
    fetchPlatformAttempt.mockResolvedValueOnce(bigDraft(4))
    await store.load('big-draft')
    const retry = store.saveNow()
    expect(patchPlatformAnswers).toHaveBeenCalledTimes(1)
    old.resolve({ revision: 3, status: 'BASE_IN_PROGRESS', answeredCount: 1,
      answerComplete: false, currentQuestionId: null })
    expect(await saving).toBe(false)
    expect(await retry).toBe(false)
    expect(store.attempt?.revision).toBe(2)
    expect(store.unsavedCount).toBe(1)
    expect(store.conflict).toBe(true)
  })

  it('A 的提交响应晚到，不能将 B 的新草稿标成已提交', async () => {
    const auth = useAuthStore()
    auth.applyProfile(user('a'))
    const store = useBigFiveStore()
    store.adopt(bigDraft())
    const old = deferred<{ reportId: string; status: string; incompleteQuestionIds: string[] }>()
    submitPlatformAttempt.mockReturnValueOnce(old.promise)
    const submitting = store.submit()
    await vi.waitFor(() => expect(submitPlatformAttempt).toHaveBeenCalledTimes(1))
    auth.applyAnonymous('登录已过期')
    auth.applyProfile(user('b'))
    store.adopt({ ...bigDraft(), attemptId: 'b-draft' })
    old.resolve({ reportId: 'a-report', status: 'PROFILE', incompleteQuestionIds: [] })
    expect(await submitting).toBeNull()
    expect(store.attempt?.attemptId).toBe('b-draft')
    expect(store.attempt?.status).toBe('BASE_IN_PROGRESS')
    expect(store.submitResult).toBeNull()
  })
})
