// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readDegradedSections } from '@/api/v3'

/**
 * 「这次导出的备份完不完整」的判定（2026-09-17 第 15 轮新增）。
 *
 * 为什么值得单独测：账号页写着"注销会删除你的全部测评记录与报告，无法恢复……
 * 导出数据是唯一能把它们带走的办法"，而服务端在某个段落查询失败时会降级成空数组
 * 但仍返回 200。如果这里读不出"有段落没拿到"，页面就会对着一份不完整的文件说
 * "报告与 AI 分析记录都在里面"，用户按指引注销后那部分数据**永久丢失**。
 *
 * 所以这里断言的是"读得出"，不是"读不出时不崩"。
 */
describe('readDegradedSections', () => {
  it('服务端声明了降级段落时逐条读出来', () => {
    const payload = JSON.stringify({
      schemaVersion: 1,
      attempts: [],
      reports: [],
      degradedSections: [
        { section: 'reports', reason: '查询失败（DataAccessResourceFailureException）' },
      ],
    })

    expect(readDegradedSections(payload)).toEqual([
      { section: 'reports', reason: '查询失败（DataAccessResourceFailureException）' },
    ])
  })

  it('完整导出时为空数组（这时页面才敢说「都在里面」）', () => {
    const payload = JSON.stringify({ schemaVersion: 1, attempts: [], reports: [], degradedSections: [] })

    expect(readDegradedSections(payload)).toEqual([])
  })

  it('多个段落各自列出，不会被合并成一条', () => {
    const payload = JSON.stringify({
      degradedSections: [
        { section: 'reports', reason: '查询失败' },
        { section: 'aiJobs', reason: '数据表尚未就绪（部署未完成）' },
      ],
    })

    expect(readDegradedSections(payload).map((item) => item.section)).toEqual(['reports', 'aiJobs'])
  })

  it('旧版服务端没有这个字段时按「不额外警告」处理', () => {
    // 前端比后端新（灰度期间真实存在）。此时不能假定有失败，
    // 也不能因此把整次导出报成失败 —— 文件本身仍然可用。
    const payload = JSON.stringify({ schemaVersion: 1, reports: [] })

    expect(readDegradedSections(payload)).toEqual([])
  })

  it('正文不是 JSON 时不抛异常、不误报降级', () => {
    expect(readDegradedSections('<html>502 Bad Gateway</html>')).toEqual([])
    expect(readDegradedSections('')).toEqual([])
  })

  it('段落项缺 section 的脏数据被丢掉，不会渲染成空荡荡的警告', () => {
    const payload = JSON.stringify({
      degradedSections: [{ reason: '查询失败' }, { section: 'reports', reason: '查询失败' }, 'nonsense'],
    })

    expect(readDegradedSections(payload)).toEqual([{ section: 'reports', reason: '查询失败' }])
  })
})
