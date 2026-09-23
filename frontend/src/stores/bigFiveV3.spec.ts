import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createPlatformAttempt, fetchPlatformAttempt, patchPlatformAnswers, submitPlatformAttempt, type AttemptView } from '@/api/platformV3'
import { useBigFiveStore } from './bigFiveV3'

vi.mock('@/api/platformV3', () => ({
  createPlatformAttempt: vi.fn(), fetchPlatformAttempt: vi.fn(),
  patchPlatformAnswers: vi.fn(), submitPlatformAttempt: vi.fn(),
  isPlatformError: (error: { status?: number }) => error?.status !== undefined,
}))
vi.mock('@/api/v3', () => ({ describeError: () => ({ message: '保存失败' }), newIdempotencyKey: () => 'intent-key' }))

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
  it('创建响应不确定时同一次意图复用键，并发触发共享请求', async () => {
    const pending = deferred<AttemptView>()
    vi.mocked(createPlatformAttempt).mockReturnValueOnce(pending.promise)
      .mockRejectedValueOnce(new Error('response parse failed'))
      .mockResolvedValueOnce(draft([], 'server-created'))
    const store = useBigFiveStore()
    const first = store.start()
    const duplicate = store.start()
    expect(createPlatformAttempt).toHaveBeenCalledTimes(1)
    pending.resolve(draft([], 'server-created'))
    expect((await first).attemptId).toBe('server-created')
    expect((await duplicate).attemptId).toBe('server-created')
    expect(store.createKey).toBeNull()

    await expect(store.start()).rejects.toThrow('response parse failed')
    expect(store.createKey).toBe('intent-key')
    expect((await store.start()).attemptId).toBe('server-created')
    expect(vi.mocked(createPlatformAttempt).mock.calls.map(([input]) => input.idempotencyKey))
      .toEqual(['intent-key', 'intent-key', 'intent-key'])
  })
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
    vi.mocked(patchPlatformAnswers).mockRejectedValueOnce({ status: 409, code: 'CONFLICT_REVISION' })
    const store = useBigFiveStore()
    store.adopt(draft())
    store.setAnswer('Q1', 'RATING', 2)
    expect(await store.saveNow()).toBe(false)
    expect(await store.saveNow()).toBe(false)
    expect(store.conflict).toBe(true)
    expect(store.hasUnsaved).toBe(true)
    expect(patchPlatformAnswers).toHaveBeenCalledTimes(1)
  })

  it('冲突核对只读服务端，用户选中本机题后才按最新 revision 重应用', async () => {
    vi.mocked(patchPlatformAnswers).mockRejectedValueOnce({ status: 409, code: 'CONFLICT_REVISION' })
    const store = useBigFiveStore()
    store.adopt(draft([{ questionId: 'Q1', kind: 'RATING', rating: 1 }]))
    store.setAnswer('Q1', 'RATING', 5)
    store.setAnswer('Q2', 'UNKNOWN', null)
    expect(await store.saveNow()).toBe(false)
    const server = { ...draft([
      { questionId: 'Q1', kind: 'RATING', rating: 2 },
      { questionId: 'Q2', kind: 'RATING', rating: 3 },
    ]), revision: 7 }
    vi.mocked(fetchPlatformAttempt).mockResolvedValueOnce(server)
      .mockResolvedValueOnce(server)
      .mockResolvedValueOnce({ ...server, revision: 8, answers: [
        { questionId: 'Q1', kind: 'RATING', rating: 5 },
        { questionId: 'Q2', kind: 'RATING', rating: 3 },
      ] })
    expect(await store.inspectConflict()).toBe(true)
    expect(store.attempt?.revision).toBe(2)
    expect(patchPlatformAnswers).toHaveBeenCalledTimes(1)
    expect(store.conflictChanges.map((row: { questionId: string }) => row.questionId)).toEqual(['Q1', 'Q2'])
    expect(await store.applyConflictChoices(['Q1'])).toBe(true)
    expect(patchPlatformAnswers).toHaveBeenLastCalledWith('draft-1', expect.objectContaining({
      expectedRevision: 7, responses: [{ questionId: 'Q1', kind: 'RATING', rating: 5 }],
    }))
    expect(store.answers.Q2.rating).toBe(3)
  })

  it('冲突详情迟到时切换草稿，不展示或应用旧账号答案', async () => {
    const pending = deferred<AttemptView>()
    vi.mocked(fetchPlatformAttempt).mockReturnValueOnce(pending.promise)
    const store = useBigFiveStore()
    store.adopt(draft())
    store.setAnswer('Q1', 'UNKNOWN', null)
    store.conflict = true
    const checking = store.inspectConflict()
    store.reset()
    store.adopt(draft([], 'another-draft'))
    pending.resolve(draft([{ questionId: 'Q1', kind: 'RATING', rating: 5 }]))
    expect(await checking).toBe(false)
    expect(store.conflictServer).toBeNull()
  })

  it('核对期间本机又改题时不能用旧核对快照覆盖新答案', async () => {
    const pending = deferred<AttemptView>()
    const store = useBigFiveStore()
    store.adopt(draft([{ questionId: 'Q1', kind: 'RATING', rating: 1 }]))
    store.setAnswer('Q1', 'RATING', 2)
    store.conflict = true
    const server = { ...draft([{ questionId: 'Q1', kind: 'RATING', rating: 3 }]), revision: 7 }
    vi.mocked(fetchPlatformAttempt).mockResolvedValueOnce(server).mockReturnValueOnce(pending.promise)
    expect(await store.inspectConflict()).toBe(true)
    const applying = store.applyConflictChoices(['Q1'])
    store.setAnswer('Q1', 'RATING', 5)
    pending.resolve(server)
    expect(await applying).toBe(false)
    expect(patchPlatformAnswers).not.toHaveBeenCalled()
    expect(store.answers.Q1.rating).toBe(5)
    expect(store.unsavedCount).toBe(1)
  })

  it('非修订冲突的 409 仍可重试，不能误报另一台设备修改', async () => {
    vi.mocked(patchPlatformAnswers).mockRejectedValueOnce({ status: 409, code: 'PACKAGE_UNAVAILABLE' })
    const store = useBigFiveStore()
    store.adopt(draft())
    store.setAnswer('Q1', 'UNKNOWN', null)
    expect(await store.saveNow()).toBe(false)
    expect(store.conflict).toBe(false)
    expect(store.unsavedCount).toBe(1)
    expect(await store.saveNow()).toBe(true)
    expect(patchPlatformAnswers).toHaveBeenCalledTimes(2)
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

  it('切账号或切草稿后旧详情/创建响应不得接管新状态', async () => {
    const oldLoad = deferred<AttemptView>()
    vi.mocked(fetchPlatformAttempt).mockReturnValueOnce(oldLoad.promise)
      .mockResolvedValueOnce(draft([], 'new-draft'))
    const store = useBigFiveStore()
    const first = store.load('old-draft')
    await store.load('new-draft')
    oldLoad.resolve(draft([], 'old-draft'))
    await first
    expect(store.attempt?.attemptId).toBe('new-draft')

    const oldCreate = deferred<AttemptView>()
    vi.mocked(createPlatformAttempt).mockReturnValueOnce(oldCreate.promise)
    const creating = store.start()
    store.reset()
    oldCreate.resolve(draft([], 'old-account-draft'))
    await expect(creating).rejects.toThrow('账号或草稿已切换')
    expect(store.attempt).toBeNull()
    expect(store.loading).toBe(false)
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
