import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { patchPlatformAnswers, submitPlatformAttempt, type AttemptView } from '@/api/platformV3'
import { useBigFiveStore } from './bigFiveV3'

vi.mock('@/api/platformV3', () => ({
  createPlatformAttempt: vi.fn(), fetchPlatformAttempt: vi.fn(),
  patchPlatformAnswers: vi.fn(), submitPlatformAttempt: vi.fn(),
  isPlatformError: (error: { status?: number }) => error?.status !== undefined,
}))
vi.mock('@/api/v3', () => ({ describeError: () => ({ message: '保存失败' }) }))

function draft(answers: AttemptView['answers'] = [], attemptId = 'draft-1'): AttemptView {
  return { attemptId, revision: 2, status: 'BASE_IN_PROGRESS', answers, items: [], requiredCount: 50 } as unknown as AttemptView
}
function saved(revision = 3) {
  return { revision, status: 'BASE_IN_PROGRESS', answeredCount: 1, requiredCount: 50,
    answerComplete: false, currentQuestionId: null }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  vi.mocked(patchPlatformAnswers).mockResolvedValue(saved())
})

describe('大五草稿保存不丢改动', () => {
  it('恢复已有答案后，第一条新增或修改必须发送', async () => {
    const store = useBigFiveStore()
    store.adopt(draft([{ questionId: 'Q1', kind: 'RATING', rating: 3 }, { questionId: 'Q2', kind: 'UNKNOWN', rating: null }]))
    store.setAnswer('Q3', 'RATING', 5)
    expect(store.unsavedCount).toBe(1)
    await store.saveNow()
    expect(patchPlatformAnswers).toHaveBeenCalledWith('draft-1', expect.objectContaining({
      responses: [{ questionId: 'Q3', kind: 'RATING', rating: 5 }],
    }))
    expect(store.hasUnsaved).toBe(false)
  })

  it('在途改答仍未保存，旧响应返回后串行发送新答案', async () => {
    const first = deferred<ReturnType<typeof saved>>()
    const second = deferred<ReturnType<typeof saved>>()
    vi.mocked(patchPlatformAnswers).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const store = useBigFiveStore()
    store.adopt(draft())
    store.setAnswer('Q1', 'RATING', 1)
    const saving = store.saveNow()
    store.setAnswer('Q1', 'RATING', 5)
    const concurrent = store.saveNow()
    expect(patchPlatformAnswers).toHaveBeenCalledTimes(1)
    first.resolve(saved(3))
    await vi.waitFor(() => expect(patchPlatformAnswers).toHaveBeenCalledTimes(2))
    expect(store.unsavedCount).toBe(1)
    expect(patchPlatformAnswers).toHaveBeenLastCalledWith('draft-1', expect.objectContaining({
      expectedRevision: 3, responses: [{ questionId: 'Q1', kind: 'RATING', rating: 5 }],
    }))
    second.resolve(saved(4))
    expect(await saving).toBe(true)
    expect(await concurrent).toBe(true)
    expect(store.hasUnsaved).toBe(false)
    expect(store.attempt?.revision).toBe(4)
  })

  it('撤销已保存答案发送 CLEAR，失败后保留撤销并可重试', async () => {
    const store = useBigFiveStore()
    store.adopt(draft([{ questionId: 'Q1', kind: 'UNKNOWN', rating: null }]))
    store.clearAnswer('Q1')
    vi.mocked(patchPlatformAnswers).mockRejectedValueOnce(new Error('offline'))
    expect(await store.saveNow()).toBe(false)
    expect(store.unsavedCount).toBe(1)
    expect(await store.saveNow()).toBe(true)
    expect(patchPlatformAnswers).toHaveBeenLastCalledWith('draft-1', expect.objectContaining({
      responses: [{ questionId: 'Q1', kind: 'CLEAR', rating: null }],
    }))
    expect(store.hasUnsaved).toBe(false)
  })

  it('清空请求期间重新作答，不能被清空响应吞掉', async () => {
    const first = deferred<ReturnType<typeof saved>>()
    vi.mocked(patchPlatformAnswers).mockReturnValueOnce(first.promise)
    const store = useBigFiveStore()
    store.adopt(draft([{ questionId: 'Q1', kind: 'UNKNOWN', rating: null }]))
    store.clearAnswer('Q1')
    const saving = store.saveNow()
    store.setAnswer('Q1', 'RATING', 4)
    first.resolve(saved())
    await saving
    expect(patchPlatformAnswers).toHaveBeenLastCalledWith('draft-1', expect.objectContaining({
      responses: [{ questionId: 'Q1', kind: 'RATING', rating: 4 }],
    }))
    expect(store.answers.Q1.rating).toBe(4)
  })

  it('409 后停止保存，不获取新版本自动覆盖', async () => {
    vi.mocked(patchPlatformAnswers).mockRejectedValueOnce({ status: 409 })
    const store = useBigFiveStore()
    store.adopt(draft())
    store.setAnswer('Q1', 'RATING', 2)
    expect(await store.saveNow()).toBe(false)
    expect(await store.saveNow()).toBe(false)
    expect(store.conflict).toBe(true)
    expect(store.hasUnsaved).toBe(true)
    expect(patchPlatformAnswers).toHaveBeenCalledTimes(1)
  })

  it('换草稿后丢弃旧保存响应', async () => {
    const first = deferred<ReturnType<typeof saved>>()
    vi.mocked(patchPlatformAnswers).mockReturnValueOnce(first.promise)
    const store = useBigFiveStore()
    store.adopt(draft())
    store.setAnswer('Q1', 'RATING', 2)
    const saving = store.saveNow()
    store.reset()
    store.adopt(draft([], 'draft-2'))
    first.resolve(saved())
    expect(await saving).toBe(false)
    expect(store.attempt?.attemptId).toBe('draft-2')
    expect(store.attempt?.revision).toBe(2)
  })

  it('提交等待在途保存完成并使用确认后的版本', async () => {
    const first = deferred<ReturnType<typeof saved>>()
    vi.mocked(patchPlatformAnswers).mockReturnValueOnce(first.promise)
    vi.mocked(submitPlatformAttempt).mockResolvedValue({ reportId: 'report-1', status: 'PROFILE', incompleteQuestionIds: [] } as never)
    const store = useBigFiveStore()
    store.adopt(draft())
    store.setAnswer('Q1', 'RATING', 5)
    const saving = store.saveNow()
    const submitting = store.submit()
    expect(submitPlatformAttempt).not.toHaveBeenCalled()
    first.resolve(saved(7))
    await saving
    await submitting
    expect(submitPlatformAttempt).toHaveBeenCalledWith('draft-1', 7)
    expect(store.attempt?.revision).toBe(7)
  })
})
