import { describe, expect, it } from 'vitest'
import {
  CLARITY_LABEL,
  clarityFromDistance,
  clarityOfScore,
  distanceFromMidpoint,
  needsTieNotice,
} from './clarity'

/** 清晰度分级边界 —— `docs/需求文档.md` §4.3、`docs/任务拆解.md` B4。 */
describe('clarityFromDistance', () => {
  it('d >= 9 → A', () => {
    expect(clarityFromDistance(9)).toBe('A')
    expect(clarityFromDistance(16)).toBe('A')
    expect(clarityFromDistance(100)).toBe('A')
  })

  it('5 <= d < 9 → B', () => {
    expect(clarityFromDistance(8.9)).toBe('B')
    expect(clarityFromDistance(8)).toBe('B')
    expect(clarityFromDistance(5)).toBe('B')
  })

  it('2 <= d < 5 → C', () => {
    expect(clarityFromDistance(4.9)).toBe('C')
    expect(clarityFromDistance(4)).toBe('C')
    expect(clarityFromDistance(2)).toBe('C')
  })

  it('d <= 1 → D', () => {
    expect(clarityFromDistance(1)).toBe('D')
    expect(clarityFromDistance(0)).toBe('D')
  })

  it('取绝对值，负数距离等价', () => {
    expect(clarityFromDistance(-9)).toBe('A')
    expect(clarityFromDistance(-1)).toBe('D')
  })

  it('非有限数抛错', () => {
    expect(() => clarityFromDistance(Number.NaN)).toThrowError()
    expect(() => clarityFromDistance(Number.POSITIVE_INFINITY)).toThrowError()
  })
})

describe('clarityOfScore / distanceFromMidpoint', () => {
  it('中点 24：8/40 为 A，15 为 A，16..19 为 B，20..22 为 C，23..25 为 D', () => {
    expect(clarityOfScore(8, 24)).toBe('A')
    expect(clarityOfScore(40, 24)).toBe('A')
    expect(clarityOfScore(15, 24)).toBe('A')
    expect(clarityOfScore(16, 24)).toBe('B')
    expect(clarityOfScore(19, 24)).toBe('B')
    expect(clarityOfScore(20, 24)).toBe('C')
    expect(clarityOfScore(22, 24)).toBe('C')
    expect(clarityOfScore(23, 24)).toBe('D')
    expect(clarityOfScore(25, 24)).toBe('D')
    expect(distanceFromMidpoint(29, 24)).toBe(5)
  })

  it('C / D 需要压线提示，A / B 不需要', () => {
    expect(needsTieNotice('A')).toBe(false)
    expect(needsTieNotice('B')).toBe(false)
    expect(needsTieNotice('C')).toBe(true)
    expect(needsTieNotice('D')).toBe(true)
  })

  it('四级都有中文标签（缺任何一个都会让结果页出 undefined）', () => {
    for (const level of ['A', 'B', 'C', 'D'] as const) {
      expect(CLARITY_LABEL[level]).toBeTruthy()
    }
  })
})
