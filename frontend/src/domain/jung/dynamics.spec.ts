import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DYNAMICS_VERSION,
  deriveTypeProcesses,
  PROCESS_FUNCTIONS,
  type ProcessFunction,
  type ProcessToken,
} from './dynamics'

/**
 * 过程层推导的**跨实现一致性测试**。
 *
 * 数据来源是共享夹具 `src/domain/__fixtures__/score-cases.json` 顶层的 `typeProcesses`
 * （16 项，一份 Java、夹具生成器与前端都必须认同的权威表；后端 fixtures 测试读的是
 * 同一份文件的另一份副本）。
 *
 * 这一层的错误有一个共同特征：**它不会报错**。把内倾那一支写反，16 型里有 8 型
 * 主导/辅助整对互换；第三位只翻方向不换功能，四个过程就覆盖不到四个功能族。
 * 两种情况下报告都照样生成、页面照样渲染，只有人来读才会觉得别扭。
 * 所以这里不抽样：16 行逐行严格相等，再补上几条结构不变量，让"写反"必然被抓住。
 */

interface TypeProcessRow {
  typeCode: string
  dominant: ProcessToken
  auxiliary: ProcessToken
  tertiary: ProcessToken
  inferior: ProcessToken
}

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '../__fixtures__/score-cases.json'), 'utf8'),
) as { dynamicsVersion: string; typeProcesses: TypeProcessRow[] }

/** 过程代号 → 功能族。夹具里的表必须是这张表的一个排列，否则结构不成立。 */
const FUNCTION_OF_TOKEN: Record<ProcessToken, ProcessFunction> = {
  Si: 'S',
  Se: 'S',
  Ni: 'N',
  Ne: 'N',
  Ti: 'T',
  Te: 'T',
  Fi: 'F',
  Fe: 'F',
}

/** 过程代号 → 方向。 */
const ATTITUDE_OF_TOKEN: Record<ProcessToken, 'i' | 'e'> = {
  Si: 'i',
  Se: 'e',
  Ni: 'i',
  Ne: 'e',
  Ti: 'i',
  Te: 'e',
  Fi: 'i',
  Fe: 'e',
}

describe('过程层推导：与共享夹具逐行一致', () => {
  it('夹具里的算法版本与本地常量是同一个字符串', () => {
    expect(fixture.dynamicsVersion).toBe(DYNAMICS_VERSION)
  })

  it('夹具给出全部 16 型，且类型码不重复', () => {
    expect(fixture.typeProcesses).toHaveLength(16)
    const codes = fixture.typeProcesses.map((row) => row.typeCode)
    expect(new Set(codes).size).toBe(16)
  })

  for (const row of fixture.typeProcesses) {
    it(`${row.typeCode}：主导 / 辅助 / 第三位 / 第四位 与夹具完全一致`, () => {
      expect(deriveTypeProcesses(row.typeCode)).toEqual(row)
    })
  }

  it('推导结果与夹具是同一张表（逐行、逐字段，不抽样）', () => {
    const derived = fixture.typeProcesses.map((row) => deriveTypeProcesses(row.typeCode))
    expect(derived).toEqual(fixture.typeProcesses)
  })
})

describe('过程层结构不变量（对每一型都成立）', () => {
  for (const row of fixture.typeProcesses) {
    describe(row.typeCode, () => {
      const processes = [row.dominant, row.auxiliary, row.tertiary, row.inferior]
      const functions = processes.map((token) => FUNCTION_OF_TOKEN[token])
      const attitudes = processes.map((token) => ATTITUDE_OF_TOKEN[token])

      it('主导与辅助的功能族不同、方向相反', () => {
        expect(FUNCTION_OF_TOKEN[row.dominant]).not.toBe(FUNCTION_OF_TOKEN[row.auxiliary])
        expect(ATTITUDE_OF_TOKEN[row.dominant]).not.toBe(ATTITUDE_OF_TOKEN[row.auxiliary])
      })

      it('四个过程恰好各占 S / N / T / F 之一（排序后与固定序相同）', () => {
        expect([...functions].sort()).toEqual([...PROCESS_FUNCTIONS].sort())
      })

      it('四个过程两两不同，且两个朝里、两个朝外', () => {
        expect(new Set(processes).size).toBe(4)
        expect(attitudes.filter((attitude) => attitude === 'i')).toHaveLength(2)
        expect(attitudes.filter((attitude) => attitude === 'e')).toHaveLength(2)
      })

      it('第三位 / 第四位分别是辅助 / 主导的同族另一功能、方向取反', () => {
        // 这条正是那个"不报错的坑"：只翻方向不换功能时（Te→Ti）会当场失败。
        expect(FUNCTION_OF_TOKEN[row.tertiary]).not.toBe(FUNCTION_OF_TOKEN[row.auxiliary])
        expect(ATTITUDE_OF_TOKEN[row.tertiary]).not.toBe(ATTITUDE_OF_TOKEN[row.auxiliary])
        expect(FUNCTION_OF_TOKEN[row.inferior]).not.toBe(FUNCTION_OF_TOKEN[row.dominant])
        expect(ATTITUDE_OF_TOKEN[row.inferior]).not.toBe(ATTITUDE_OF_TOKEN[row.dominant])
      })
    })
  }

  it('外倾型主导过程朝外、内倾型主导过程朝里（内倾那一支最容易写反）', () => {
    for (const row of fixture.typeProcesses) {
      const expected = row.typeCode.charAt(0) === 'E' ? 'e' : 'i'
      expect(ATTITUDE_OF_TOKEN[row.dominant], `${row.typeCode} 的主导过程方向`).toBe(expected)
      expect(ATTITUDE_OF_TOKEN[row.auxiliary], `${row.typeCode} 的辅助过程方向`).toBe(
        expected === 'e' ? 'i' : 'e',
      )
    }
  })
})

describe('非法类型码：抛错，不静默回退', () => {
  const illegal = ['istj', 'ISTI', 'IST', 'ISTJX', '', 'ENFP ', 'XXXX', '1234', 'ISTJ/ENFP']

  for (const value of illegal) {
    it(`「${value}」直接抛错`, () => {
      expect(() => deriveTypeProcesses(value)).toThrow(/类型码/)
    })
  }

  it('非字符串同样抛错（调用方可能拿到 undefined）', () => {
    expect(() => deriveTypeProcesses(undefined as unknown as string)).toThrow(/类型码/)
    expect(() => deriveTypeProcesses(null as unknown as string)).toThrow(/类型码/)
  })
})
