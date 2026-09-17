// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  ANALYSIS_TOPICS,
  AI_SCOPE_VERSION,
  aiFailureHint,
  isRetryable,
  isRunning,
  parseAnalysisResult,
  topicLabel,
  type AnalysisJob,
} from '@/api/v3Ai'

/**
 * AI 输出解析（2026-09-17 新增）。
 *
 * 为什么值得单独测：`parseAnalysisResult` 是**唯一**决定"用户看到什么"的地方，
 * 而它的输入是模型生成的、不可控的。这里的原则是"宁可少显示一段，并明说少显示了"
 * —— 绝不猜、不补默认值、不把读不懂的东西渲染成空壳。
 */

const VALID = {
  schemaVersion: '1',
  referenceType: 'ENFP',
  summary: '这是一段二十个字以上的整体印象摘要，用于通过长度检查。',
  sections: [
    { key: 'communication', title: '沟通方式', body: '正文一。' },
    { key: 'growth', title: '成长建议', body: '正文二。' },
  ],
  boundaryNotes: ['这条分析基于一次问卷，不构成诊断。'],
  actions: [{ title: '一个小做法', steps: ['第一步', '第二步'] }],
  reflectionQuestions: ['问题一是什么？', '问题二是什么？'],
}

describe('parseAnalysisResult', () => {
  it('完整输出：逐项读出来，没有问题列表', () => {
    const view = parseAnalysisResult(VALID)
    expect(view).not.toBeNull()
    expect(view!.problems).toEqual([])
    expect(view!.referenceType).toBe('ENFP')
    expect(view!.sections.map((section) => section.key)).toEqual(['communication', 'growth'])
    expect(view!.actions[0]!.steps).toEqual(['第一步', '第二步'])
    expect(view!.reflectionQuestions).toHaveLength(2)
  })

  it('未知 schemaVersion：不拒绝整份，但必须留下说明', () => {
    // 前端比后端旧时会发生这件事。整块吞掉用户就什么都看不到；
    // 只读能读的部分并说明版本不同，才是对用户有用的行为。
    const view = parseAnalysisResult({ ...VALID, schemaVersion: '2' })
    expect(view).not.toBeNull()
    expect(view!.sections).toHaveLength(2)
    expect(view!.problems.join('')).toContain('版本')
  })

  it('缺 summary：正文照常渲染，但要说明缺了哪一段', () => {
    const view = parseAnalysisResult({ ...VALID, summary: undefined })
    expect(view).not.toBeNull()
    expect(view!.summary).toBe('')
    expect(view!.problems.join('')).toContain('整体印象')
  })

  it('分节里缺 title / body 的条目被丢掉，不渲染半截内容', () => {
    const view = parseAnalysisResult({
      ...VALID,
      sections: [
        { key: 'communication', title: '沟通方式', body: '正文一。' },
        { key: 'bad', title: '只有标题' },
        { key: 'bad2', body: '只有正文' },
        'not-an-object',
      ],
    })
    expect(view!.sections).toHaveLength(1)
    expect(view!.sections[0]!.title).toBe('沟通方式')
  })

  it('完全读不出内容时返回 null（宁可显示"读不出来"，也不显示空壳）', () => {
    expect(parseAnalysisResult(null)).toBeNull()
    expect(parseAnalysisResult('一段字符串')).toBeNull()
    expect(parseAnalysisResult({ schemaVersion: '1', sections: [] })).toBeNull()
  })

  it('多余字段与多余分节不影响解析（服务端多给字段不该让页面坏掉）', () => {
    const view = parseAnalysisResult({ ...VALID, unexpected: { deep: true }, extra: 1 })
    expect(view).not.toBeNull()
    expect(view!.sections).toHaveLength(2)
  })
})

describe('主题', () => {
  it('四个主题都有中文名，未知主题原样回显而不是显示 undefined', () => {
    expect(ANALYSIS_TOPICS.map((topic) => topic.value)).toEqual([
      'overall',
      'communication',
      'studyWork',
      'growth',
    ])
    expect(topicLabel('studyWork')).toBe('学习工作方式')
    expect(topicLabel('somethingElse')).toBe('somethingElse')
  })

  it('scopeVersion 与后端一致（它进 request_hash，写错会破坏去重）', () => {
    expect(AI_SCOPE_VERSION).toBe('typeme-ai-scope-v2')
  })
})

describe('任务状态判断', () => {
  const base: AnalysisJob = {
    jobId: 'j',
    reportId: 'r',
    status: 'QUEUED',
    topic: 'overall',
    promptVersion: null,
    modelRequested: null,
    modelReturned: null,
    errorCode: null,
    attemptCount: 0,
    createdAt: null,
    finishedAt: null,
    result: null,
    resultProblems: [],
    mock: false,
  }

  it('QUEUED / RUNNING 视为进行中，其余不是', () => {
    expect(isRunning({ ...base, status: 'QUEUED' })).toBe(true)
    expect(isRunning({ ...base, status: 'RUNNING' })).toBe(true)
    expect(isRunning({ ...base, status: 'SUCCEEDED' })).toBe(false)
    expect(isRunning(null)).toBe(false)
  })

  it('只有 FAILED / UNKNOWN 可重试（契约 §2 的 retry 也只接受这两种）', () => {
    expect(isRetryable({ ...base, status: 'FAILED' })).toBe(true)
    expect(isRetryable({ ...base, status: 'UNKNOWN' })).toBe(true)
    expect(isRetryable({ ...base, status: 'SUCCEEDED' })).toBe(false)
    expect(isRetryable({ ...base, status: 'RUNNING' })).toBe(false)
  })
})

describe('aiFailureHint', () => {
  it('额度用完与未配置各有专门说法，且都点明基础报告不受影响', () => {
    const budget = aiFailureHint(null, {
      message: '原始英文/技术错误',
      code: 'BUDGET_EXCEEDED',
      serverMessage: null,
      fields: [],
      retryAfterSeconds: null,
      requestId: null,
      sessionExpired: false,
    })
    expect(budget).toContain('额度')
    expect(budget).toContain('基础报告不受影响')
    expect(budget).not.toContain('原始英文')
  })

  it('内容违规说明"没有采纳"，而不是把违规文本显示出来', () => {
    const hint = aiFailureHint('CONTENT_VIOLATION', null)
    expect(hint).toContain('没有采纳')
    expect(hint).toContain('重试')
  })

  it('未知错误码也给出"接下来做什么"，不显示原始码', () => {
    const hint = aiFailureHint('SOMETHING_NEW', null)
    expect(hint).toContain('重试')
    expect(hint).not.toContain('SOMETHING_NEW')
  })

  it('401/402 说清是服务端配置问题，不劝用户重试', () => {
    // 这两个码重试一万次也不会成功。兜底那句"可以重试一次"在这里是有害建议：
    // 用户会一直点重试，而真正该做的是管理员换 key / 充值。
    const key = aiFailureHint('UPSTREAM_401', null)
    expect(key).toContain('管理员')
    expect(key).not.toContain('可以重试一次')
    expect(key).toContain('基础报告不受影响')

    const balance = aiFailureHint('UPSTREAM_402', null)
    expect(balance).toContain('管理员')
    expect(balance).not.toContain('可以重试一次')
  })

  it('429/5xx/连不上 都是可重试，且不把上游细节暴露给用户', () => {
    for (const code of ['UPSTREAM_429', 'UPSTREAM_5XX', 'UPSTREAM_UNAVAILABLE']) {
      const hint = aiFailureHint(code, null)
      expect(hint).toContain('重试')
      // 不许把错误码本身或任何英文技术串显示出来。
      expect(hint).not.toContain(code)
      expect(hint).not.toMatch(/[A-Za-z]{4,}/)
    }
  })

  it('每个可能落库的错误码都有专门说法（与后端契约测试同一条不变量）', () => {
    // 后端 backend/src/test/java/com/typeme/contract/AiErrorCodeContractTest.java 从
    // 本文件的 case 分支反查覆盖度；这里再从"文案是否有区分度"这一侧兜一层：
    // 落到 default 的码必须能被我认出来，所以拿两个已知码的文案互不相等即可反证分支存在。
    const timeout = aiFailureHint('TIMEOUT', null)
    const truncated = aiFailureHint('TRUNCATED', null)
    const violation = aiFailureHint('CONTENT_VIOLATION', null)
    expect(new Set([timeout, truncated, violation]).size).toBe(3)
    for (const hint of [timeout, truncated, violation]) {
      expect(hint).not.toContain('这次生成没有成功')
    }
  })
})
