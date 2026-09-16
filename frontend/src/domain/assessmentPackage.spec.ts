import { describe, expect, it } from 'vitest'
import {
  assessmentPackageProblems,
  assessmentPackageSignature,
  assertAssessmentPackage,
  EXPECTED_INSTRUMENT,
  FORBIDDEN_HELP_FRAGMENTS,
  instrumentHasTypeCode,
  instrumentProfileOf,
  isValidAssessmentPackage,
  OFFICIAL_MIDPOINT,
  packageDimensionOrder,
  packageFormat,
  poleTokensOf,
  REPORT_COPY_FIELDS,
  PackageValidationError,
  type AssessmentPackage,
} from './assessmentPackage'
import { DEFAULT_PACKAGE_ID, FALLBACK_ASSESSMENT_PACKAGES } from '@/content/fallback'

/**
 * v2 内容包契约与校验 —— `docs/2026-09-15/TypeMe-内容包v2-字段规格.md`。
 *
 * 这些断言的价值在于：内置降级副本也必须**独立**通过完整契约校验。
 * 否则「接口挂了 → 用本地那份」这条路径上，符号被改反、帮助缺项都不会被发现。
 */

/**
 * 站点默认包已换成 IPIP-50；本文件里断言 OEJTS 官方符号与常量的用例显式指名 OEJTS 包。
 */
const OEJTS_PACKAGE_ID = 'oejts32-zh1-report2'

/** 站点当前默认包（IPIP-50 大五）：与仪器无关的通用契约用例仍走这一份。 */
const pkg = FALLBACK_ASSESSMENT_PACKAGES[DEFAULT_PACKAGE_ID] as AssessmentPackage

/** 断言 OEJTS 官方符号 / 常量 / 四维形状（32 题、每维 8 题、midpoint 24）的用例走这一份。 */
const oejtsPkg = FALLBACK_ASSESSMENT_PACKAGES[OEJTS_PACKAGE_ID] as AssessmentPackage

/** 以真实包为底做定点破坏，断言校验器确实拦得住。 */
function broken(patch: (draft: AssessmentPackage) => void): AssessmentPackage {
  const draft = structuredClone(pkg) as AssessmentPackage
  patch(draft)
  return draft
}

/** 同上，但底稿是 OEJTS 包（官方符号与常量的定点破坏）。 */
function brokenOejts(patch: (draft: AssessmentPackage) => void): AssessmentPackage {
  const draft = structuredClone(oejtsPkg) as AssessmentPackage
  patch(draft)
  return draft
}

describe('内置内容包本身必须通过完整契约校验', () => {
  it('两个注册包都合法，且没有 problems', () => {
    for (const [id, value] of Object.entries(FALLBACK_ASSESSMENT_PACKAGES)) {
      expect(value.packageId, `${id} 的 packageId 必须等于键`).toBe(id)
      expect(assessmentPackageProblems(value), `${id} 不应有契约问题`).toEqual([])
      expect(isValidAssessmentPackage(value)).toBe(true)
    }
  })

  /**
   * 服务端（Jackson）把 YAML 里缺省的字段序列化成**显式 `null`**，
   * 而内置副本（TS）里那些字段是整个不存在。
   *
   * 踩过的坑：契约校验曾用 `!== undefined` 判断可选字段，于是
   * 「接口 200 + 显式 null」被当成「声明了 null」→ 整包判非法 →
   * 页面静默降级到内置副本，服务端内容其实一次都没被用上。
   * 这条用例把两种形态都钉成合法（并保持 `source==='api'` 可达）。
   */
  it('接口形态（可选字段为显式 null）与内置形态判定一致', () => {
    /** 把内置包改写成 Jackson 的线上形态：缺省字段 = 显式 null。 */
    const wireForm = (source: AssessmentPackage): Record<string, unknown> => {
      const clone = structuredClone(source) as unknown as Record<string, unknown>
      const questionnaire = clone.questionnaire as Record<string, unknown>
      const instrument = clone.instrument as Record<string, unknown>
      // 站点默认包（IPIP）与 OEJTS 包都要覆盖：两者的缺省字段不同
      questionnaire.format = questionnaire.format ?? null
      questionnaire.responseAnchors = questionnaire.responseAnchors ?? null
      questionnaire.dimensionOrder = questionnaire.dimensionOrder ?? null
      instrument.format = instrument.format ?? null
      instrument.hasTypeCode = instrument.hasTypeCode ?? null
      for (const question of questionnaire.questions as Record<string, unknown>[]) {
        question.text = question.text ?? null
        question.textLeft = question.textLeft ?? null
        question.textRight = question.textRight ?? null
      }
      return clone
    }

    for (const [id, value] of Object.entries(FALLBACK_ASSESSMENT_PACKAGES)) {
      const wire = wireForm(value)
      // 前置条件：这份改写确实造出了显式 null（否则用例会假通过）
      const instrument = wire.instrument as Record<string, unknown>
      const questionnaire = wire.questionnaire as Record<string, unknown>
      const optionalFields = [
        instrument.format,
        instrument.hasTypeCode,
        questionnaire.format,
        questionnaire.responseAnchors,
        questionnaire.dimensionOrder,
      ]
      expect(
        optionalFields.some((value) => value === null),
        `${id} 的线上形态必须至少新增一个 null 字段`,
      ).toBe(true)
      expect(assessmentPackageProblems(wire), `${id} 的接口形态不应有契约问题`).toEqual([])
      expect(isValidAssessmentPackage(wire)).toBe(true)
      // 判定结果必须与内置形态完全一致
      expect(assessmentPackageProblems(wire)).toEqual(assessmentPackageProblems(value))
    }
  })

  it('assertAssessmentPackage 对合法包返回原对象、对坏包抛出可读原因', () => {
    expect(assertAssessmentPackage(pkg)).toBe(pkg)
    expect(() => assertAssessmentPackage(broken((draft) => (draft.packageId = '')))).toThrowError(
      PackageValidationError,
    )
  })
})

describe('身份、版本与解释政策', () => {
  it('schemaVersion / locale / 修订标识 / 仪器身份必须齐全', () => {
    expect(oejtsPkg.schemaVersion).toBe(2)
    expect(oejtsPkg.locale).toBe('zh-CN')
    // 仪器身份：YAML 里声明 id/revision/scoringVersion；格式与是否产出类型码
    // 允许由本地仪器档案补齐（这样已锁定的 OEJTS 包一个字节都不用改）。
    expect(oejtsPkg.instrument.id).toBe(EXPECTED_INSTRUMENT.id)
    expect(oejtsPkg.instrument.revision).toBe(EXPECTED_INSTRUMENT.revision)
    expect(oejtsPkg.instrument.scoringVersion).toBe(EXPECTED_INSTRUMENT.scoringVersion)
    expect(packageFormat(oejtsPkg)).toBe(EXPECTED_INSTRUMENT.format)
    expect(instrumentHasTypeCode(oejtsPkg)).toBe(EXPECTED_INSTRUMENT.hasTypeCode)
    for (const field of ['localeRevision', 'helpRevision', 'copyRevision', 'title'] as const) {
      expect(oejtsPkg[field].length, `${field} 不能为空`).toBeGreaterThan(0)
    }
  })

  it('仪器档案提供维度顺序与两端记号（OEJTS 用 I/E…，IPIP 用 低/高）', () => {
    expect(packageDimensionOrder(oejtsPkg)).toEqual(['EI', 'SN', 'TF', 'JP'])
    expect(poleTokensOf(oejtsPkg, 'EI')).toEqual({ low: 'I', high: 'E' })
    expect(poleTokensOf(oejtsPkg, 'JP')).toEqual({ low: 'J', high: 'P' })
    // 缺省仪器（无档案）会被校验拒绝，而不是悄悄放行
    expect(
      assessmentPackageProblems(
        brokenOejts((draft) => {
          draft.instrument = {
            id: 'unknown-scale',
            revision: '0',
            scoringVersion: 'x',
            format: 'agreement',
            hasTypeCode: false,
          }
        }),
      ).join('；'),
    ).toContain('没有本地仪器档案')
  })

  it('解释政策的三个数字必须显式写在包里（前端逻辑只读它，不写死）', () => {
    expect(oejtsPkg.interpretation).toEqual({
      version: 'typeme-conservative-v2',
      minRatingsPerDimension: 8,
      typeMinDistance: 5,
      markedDistance: 9,
    })
  })

  it('estimatedMinutes 在 1–60 之间（落地页会原样显示成「约 N 分钟」）', () => {
    expect(pkg.estimatedMinutes).toBeGreaterThanOrEqual(1)
    expect(pkg.estimatedMinutes).toBeLessThanOrEqual(60)
  })
})

describe('内嵌题库：官方符号与常量由前端独立再验一遍', () => {
  it('32 题、每维 8 题、midpoint 24、常量与官方一致', () => {
    expect(oejtsPkg.questionnaire.questions).toHaveLength(32)
    expect(oejtsPkg.questionnaire.scoring.midpoint).toBe(OFFICIAL_MIDPOINT)
    expect(oejtsPkg.questionnaire.scoring.constants).toEqual({ EI: 30, SN: 12, TF: 30, JP: 18 })
  })

  it('把任意一题的符号改反必须被判为问题（跑得通但全错，是这里拦住的）', () => {
    const problems = assessmentPackageProblems(
      brokenOejts((draft) => {
        draft.questionnaire.questions[2].direction = 1
      }),
    )
    expect(problems.join('；')).toContain('符号')
  })

  it('少一题 / 常量错 / midpoint 非 24 都被判为问题', () => {
    expect(
      assessmentPackageProblems(
        brokenOejts((draft) => {
          draft.questionnaire.questions.splice(0, 1)
        }),
      ).length,
    ).toBeGreaterThan(0)
    expect(
      assessmentPackageProblems(
        brokenOejts((draft) => {
          draft.questionnaire.scoring.constants.EI = 31
        }),
      ).join('；'),
    ).toContain('常量')
    expect(
      assessmentPackageProblems(
        brokenOejts((draft) => {
          draft.questionnaire.scoring.midpoint = 25
        }),
      ).join('；'),
    ).toContain('midpoint')
  })
})

describe('逐题帮助：全覆盖 + 内容红线', () => {
  it('键必须恰好是 "1".."32"', () => {
    expect(Object.keys(oejtsPkg.itemHelp).sort((a, b) => Number(a) - Number(b))).toHaveLength(32)
    expect(
      assessmentPackageProblems(
        brokenOejts((draft) => {
          delete draft.itemHelp['7']
        }),
      ).join('；'),
    ).toContain('itemHelp')
  })

  it('空释义被判为问题', () => {
    expect(
      assessmentPackageProblems(
        broken((draft) => {
          draft.itemHelp['3'].explanation = '   '
        }),
      ).join('；'),
    ).toContain('explanation')
  })

  it('开发者批注混进用户可见帮助必须被判为问题', () => {
    for (const fragment of FORBIDDEN_HELP_FRAGMENTS) {
      const problems = assessmentPackageProblems(
        broken((draft) => {
          draft.itemHelp['9'].explanation = `${draft.itemHelp['9'].explanation}${fragment}`
        }),
      )
      expect(problems.join('；'), `批注「${fragment}」必须被拦下`).toContain('开发者批注')
    }
  })

  it('riskCodes 只能包含 L / B / C，reviewStatus 必须是三档之一', () => {
    expect(
      assessmentPackageProblems(
        broken((draft) => {
          // 故意注入非法值：内容文件是外部输入，不能用 as 绕过校验
          ;(draft.itemHelp['1'] as { riskCodes: string[] }).riskCodes = ['X']
        }),
      ).join('；'),
    ).toContain('riskCodes')
    expect(
      assessmentPackageProblems(
        broken((draft) => {
          ;(draft.itemHelp['1'] as { reviewStatus: string }).reviewStatus = 'validated'
        }),
      ).join('；'),
    ).toContain('reviewStatus')
  })

  it('contentStatus 不得高于包内最低证据状态（含 draft 帮助就必须保持 draft）', () => {
    expect(pkg.contentStatus).toBe('draft')
    expect(
      assessmentPackageProblems(
        broken((draft) => {
          draft.contentStatus = 'reviewed'
        }),
      ).join('；'),
    ).toContain('contentStatus')
  })
})

describe('维度解释与报告文案', () => {
  it('dimensionCopy 四维齐全，且每侧四个字段都非空', () => {
    expect(
      assessmentPackageProblems(
        brokenOejts((draft) => {
          delete (draft.dimensionCopy as Partial<AssessmentPackage['dimensionCopy']>).SN
        }),
      ).join('；'),
    ).toContain('dimensionCopy')
    expect(
      assessmentPackageProblems(
        brokenOejts((draft) => {
          draft.dimensionCopy.EI.negative.observation = ''
        }),
      ).join('；'),
    ).toContain('dimensionCopy.EI')
  })

  it('reportCopy 的 12 个字段一个都不能少', () => {
    expect(REPORT_COPY_FIELDS).toHaveLength(12)
    for (const field of REPORT_COPY_FIELDS) {
      expect(pkg.reportCopy[field].length, `reportCopy.${field}`).toBeGreaterThan(0)
      expect(
        assessmentPackageProblems(
          broken((draft) => {
            draft.reportCopy[field] = ''
          }),
        ).join('；'),
        `缺 ${field} 必须被判为问题`,
      ).toContain(field)
    }
  })

  it('nextSteps 至少 3 条，attribution 五项齐全', () => {
    expect(pkg.nextSteps.length).toBeGreaterThanOrEqual(3)
    expect(
      assessmentPackageProblems(
        broken((draft) => {
          draft.nextSteps = ['只有一条']
        }),
      ).join('；'),
    ).toContain('nextSteps')
    expect(
      assessmentPackageProblems(
        broken((draft) => {
          ;(draft.attribution as { license: string }).license = ''
        }),
      ).join('；'),
    ).toContain('attribution')
  })
})

/**
 * 包签名：用于会话恢复与分享产物失效判断。
 * 它必须覆盖**整个**快照——包括帮助与解释政策，而不只是题目。
 */
describe('包签名', () => {
  it('同一份内容得到同一签名，且与对象键顺序无关', () => {
    const reordered = Object.fromEntries(
      Object.entries(pkg).reverse(),
    ) as unknown as AssessmentPackage
    expect(assessmentPackageSignature(reordered)).toBe(assessmentPackageSignature(pkg))
  })

  it('只改帮助文字，签名也必须变化（否则「用新帮助解释旧作答」会静默发生）', () => {
    const changed = broken((draft) => {
      draft.itemHelp['5'].explanation = `${draft.itemHelp['5'].explanation}（补充一句）`
    })
    expect(assessmentPackageSignature(changed)).not.toBe(assessmentPackageSignature(pkg))
  })

  it('只改解释政策版本，签名也必须变化', () => {
    const changed = broken((draft) => {
      draft.interpretation.version = 'typeme-conservative-v3'
    })
    expect(assessmentPackageSignature(changed)).not.toBe(assessmentPackageSignature(pkg))
  })

  it('改题面文字同样会改变签名', () => {
    const changed = broken((draft) => {
      draft.questionnaire.questions[0].textLeft = '被改过的左端'
    })
    expect(assessmentPackageSignature(changed)).not.toBe(assessmentPackageSignature(pkg))
  })
})

/**
 * 新默认包：**IPIP-50 大五**（agreement 作答、五维、不产出四字母类型码）。
 *
 * 上面那些「32 题 / 每维 8 题 / midpoint 24 / OEJTS 官方常量」的用例已经显式指名
 * OEJTS 包；这里把**站点实际默认的那一份**自己的契约单独钉一遍 —— 默认包换成 IPIP-50
 * 之后，通用路径（整体校验、仪器档案、作答格式、极点记号）必须仍然成立。
 */
describe('站点默认包（IPIP-50 大五）的仪器契约', () => {
  const ipipPkg = FALLBACK_ASSESSMENT_PACKAGES['ipip50-zh1'] as AssessmentPackage
  const ipipProfile = instrumentProfileOf(ipipPkg)!

  it('新默认包就是 ipip50-zh1，且通过了完整契约校验（problems 为空数组）', () => {
    expect(DEFAULT_PACKAGE_ID).toBe('ipip50-zh1')
    expect(ipipPkg.packageId).toBe('ipip50-zh1')
    expect(assessmentPackageProblems(FALLBACK_ASSESSMENT_PACKAGES['ipip50-zh1'])).toEqual([])
    expect(isValidAssessmentPackage(FALLBACK_ASSESSMENT_PACKAGES['ipip50-zh1'])).toBe(true)
  })

  it('仪器档案是 IPIP 大五：五维顺序 E/A/C/ES/O、每维 10 题、中点 30、常量与官方一致', () => {
    expect(ipipProfile.id).toBe('ipip50')
    expect(ipipProfile.dimensionOrder).toEqual(['E', 'A', 'C', 'ES', 'O'])
    expect(ipipProfile.perDimension).toBe(10)
    expect(ipipProfile.midpoint).toBe(30)
    expect(ipipProfile.constants).toEqual({ E: 30, A: 24, C: 24, ES: 48, O: 18 })
    // 档案里的数字必须与包里真实的题库逐项对得上，而不是"档案自己说自己对"
    expect(packageDimensionOrder(ipipPkg)).toEqual(['E', 'A', 'C', 'ES', 'O'])
    expect(ipipPkg.questionnaire.questions).toHaveLength(ipipProfile.questionCount)
    expect(ipipPkg.questionnaire.scoring.midpoint).toBe(ipipProfile.midpoint)
    expect(ipipPkg.questionnaire.scoring.constants).toEqual({ ...ipipProfile.constants })
    for (const dimension of ipipProfile.dimensionOrder) {
      expect(
        ipipPkg.questionnaire.questions.filter((question) => question.dimension === dimension),
        `${dimension} 的题数必须等于档案里的 ${ipipProfile.perDimension}`,
      ).toHaveLength(ipipProfile.perDimension)
    }
  })

  it('作答格式是 agreement，且明确不产出四字母类型码', () => {
    expect(packageFormat(ipipPkg)).toBe('agreement')
    expect(instrumentHasTypeCode(ipipPkg)).toBe(false)
    expect(ipipProfile.format).toBe('agreement')
    expect(ipipProfile.hasTypeCode).toBe(false)
    // 题库自己也声明成 agreement（否则五档锚点会按双极格式渲染）
    expect(ipipPkg.questionnaire.format).toBe('agreement')
  })

  it('五个维度的两端记号都是 低/高（大五没有字母极点）', () => {
    expect(poleTokensOf(ipipPkg, 'E')).toEqual({ low: '低', high: '高' })
    for (const dimension of packageDimensionOrder(ipipPkg)) {
      expect(poleTokensOf(ipipPkg, dimension)).toEqual({ low: '低', high: '高' })
    }
  })
})

/**
 * 仪器档案对**新默认包**同样逐题核对：符号被改反、常量被改、中点被改，
 * 都必须被判为问题 —— 与上面 OEJTS 的那三条定点破坏一一对应。
 */
describe('IPIP-50：官方符号与常量同样由前端独立再验一遍', () => {
  const ipipPkg = FALLBACK_ASSESSMENT_PACKAGES['ipip50-zh1'] as AssessmentPackage

  it('把任意一题的符号改反必须被判为问题', () => {
    // Q1 在官方计分键里是 +1（E 维度），改成 -1 就是"符号被改反"
    expect(ipipPkg.questionnaire.questions[0].direction).toBe(1)
    const problems = assessmentPackageProblems(
      broken((draft) => {
        draft.questionnaire.questions[0].direction = -1
      }),
    )
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join('；')).toContain('符号')
  })

  it('改一个常量必须被判为问题', () => {
    const problems = assessmentPackageProblems(
      broken((draft) => {
        draft.questionnaire.scoring.constants.E = 31
      }),
    )
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join('；')).toContain('常量')
  })

  it('改 midpoint 必须被判为问题', () => {
    const problems = assessmentPackageProblems(
      broken((draft) => {
        draft.questionnaire.scoring.midpoint = 31
      }),
    )
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join('；')).toContain('midpoint')
  })
})
