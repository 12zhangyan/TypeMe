import { isLegalTypeCode } from './types'

/**
 * 四字母 → 四个精神活动过程的**纯推导镜像**（无 I/O、无存储、无副作用）。
 *
 * ## 这一层是「按框架规则推导」，不是测量
 *
 * `Si / Te / Fi / Ne` 这四个过程不是本次问卷测出来的另一个结果，而是**由四个字母
 * 按这套框架的规则算出来的结构**：J/P 说的是"对外部世界使用哪一种过程"，E/I 说的是
 * 主导过程朝外还是朝里，剩下的两个位置由"同族的另一个功能、方向取反"补齐。
 * 因此它随四字母**唯一确定**，没有第二个自由度 —— 页面必须把它写成"推导"，
 * 不能让读者误以为它是另一次测量。
 *
 * ## 它只用于本地的展示与测试
 *
 * 这里的结果用于答题过程中的本地预览、以及前端的一致性测试。
 *
 * ## 服务端 `report_json` 才是权威
 *
 * 报告的 `dynamics` / `processPlan` 两块**一律以服务端快照为准**：
 * {@link deriveTypeProcesses} 的结果**绝不允许覆盖**服务端结果，也不允许在服务端
 * 给出 null（TIED：没有四字母）时拿本地推导"补"出一份结构来 —— 那等于凭空制造
 * 一个报告里并不存在的确定性。服务端与本地不一致时，先当作契约问题查清楚，
 * 而不是改这里去迁就某一边。
 *
 * ## 两个真实踩过的坑（写在最显眼处，警示后人）
 *
 * 1. **内倾那一支不能写成"同族换方向"。** 内倾者的主导过程朝里，所以它是
 *    `inner`（判断族/感知族中**剩下那一族**朝里），而不是"对外那个过程翻个方向"。
 *    写成后者时 ISTP 会被推成 `Ni` 主导（正确是 `Ti`），16 型里有 8 型
 *    主导与辅助**整对错位** —— 而报告照样生成、页面照样渲染，没有一处会报错。
 * 2. **第三位不能只翻方向、不换功能。** 第三位是"辅助那一族的**另一个**功能、
 *    方向取反"（Te→Fi、Si→Ne）。若只翻方向（Te→Ti），四个过程里就会出现两个
 *    同一族的功能，`S / N / T / F` 四族再也覆盖不全，整层结构当场失去意义。
 *
 * 这两个坑靠"读代码小心一点"是守不住的，所以 16 型逐个钉在同一份共享夹具
 * （`__fixtures__/score-cases.json` 的 `typeProcesses`）上：Java、夹具、TypeScript
 * 三份实现必须给出同一张表。
 */

/**
 * 过程层推导算法版本。
 *
 * 与 Java `JungReportBuilder.DYNAMICS_VERSION`（以及 `report_json.dynamics.version`、
 * `methodology.dynamicsVersion`）保持同一个字符串：规则一旦变了，版本必须一起变，
 * 否则"旧报告是按旧规则推的"这件事就无处可查。
 */
export const DYNAMICS_VERSION = 'typeme-jung48-dynamics-v1'

/** 八个过程代号：功能族（S/N/T/F）+ 方向（i/e）。 */
export type ProcessToken = 'Si' | 'Se' | 'Ni' | 'Ne' | 'Ti' | 'Te' | 'Fi' | 'Fe'

/** 八个过程代号的权威顺序（仅用于校验/展示，不代表优先级）。 */
export const PROCESS_TOKENS: readonly ProcessToken[] = [
  'Si',
  'Se',
  'Ni',
  'Ne',
  'Ti',
  'Te',
  'Fi',
  'Fe',
]

/** 过程的功能族：感知（S/N）或判断（T/F）。 */
export type ProcessFunction = 'S' | 'N' | 'T' | 'F'

/** 任务顺序里用到的功能族固定序：感觉 → 直觉 → 思考 → 情感。 */
export const PROCESS_FUNCTIONS: readonly ProcessFunction[] = ['S', 'N', 'T', 'F']

/** 过程的方向：i = 朝里使用，e = 朝外使用（**不是**性格内向/外向）。 */
export type ProcessAttitude = 'i' | 'e'

/** 四个位置，顺序固定：主导 / 辅助 / 第三位 / 第四位。 */
export const PROCESS_SLOTS = ['dominant', 'auxiliary', 'tertiary', 'inferior'] as const

export type ProcessSlot = (typeof PROCESS_SLOTS)[number]

/** 某个四字母的四个过程。 */
export interface TypeProcesses {
  typeCode: string
  dominant: ProcessToken
  auxiliary: ProcessToken
  tertiary: ProcessToken
  inferior: ProcessToken
}

/**
 * 同族的**另一个**功能、方向取反：`Si↔Ne`、`Se↔Ni`、`Ti↔Fe`、`Te↔Fi`。
 *
 * 写成显式表而不是"取首字母的另一个 + 翻方向"的字符运算：字符运算看不出这条规则
 * 是"换族**并且**换方向"，而后半个动作漏掉时（见模块注释坑 2）结果依然是合法的
 * 四字母结构，错了也没人报错。表就在眼前，改错一眼能看出来。
 */
const OPPOSITE_PROCESS: Record<ProcessToken, ProcessToken> = {
  Si: 'Ne',
  Ne: 'Si',
  Se: 'Ni',
  Ni: 'Se',
  Ti: 'Fe',
  Fe: 'Ti',
  Te: 'Fi',
  Fi: 'Te',
}

/** 功能族 + 方向 → 过程代号；调用方保证两者都取自上面的字面量联合。 */
function tokenOf(fn: ProcessFunction, attitude: ProcessAttitude): ProcessToken {
  return `${fn}${attitude}` as ProcessToken
}

/**
 * 由四字母推导四个过程。
 *
 * 规则（与 Java `JungTypeDynamics`、`scripts/gen-jung-fixtures.mjs` **逐字一致**）：
 *
 * ```
 * outer     = (jp === 'J' ? tf : sn) + 'e'   // 对外使用的那一族
 * inner     = (jp === 'J' ? sn : tf) + 'i'   // 剩下那一族，朝里
 * dominant  = ei === 'E' ? outer : inner
 * auxiliary = ei === 'E' ? inner : outer
 * tertiary  = 辅助那一族的另一个功能、方向取反
 * inferior  = 主导那一族的另一个功能、方向取反
 * ```
 *
 * @param typeCode 四个字母（形如 `ISTJ`），只接受大写规范形
 * @throws 类型码非法时抛错 —— **不回退、不猜**。四字母都没有的时候（TIED）
 *         正确做法是"不推导"，而不是拿别的字母凑一个结构出来。
 */
export function deriveTypeProcesses(typeCode: string): TypeProcesses {
  if (!isLegalTypeCode(typeCode)) {
    throw new Error(
      `类型码「${String(typeCode)}」不是四个大写字母（形如 ISTJ），无法推导过程结构；` +
        '这里不猜、也不回退。',
    )
  }

  // isLegalTypeCode 已保证这四位分别是 EI / SN / TF / JP 之一的大写字母。
  const ei = typeCode.charAt(0)
  const sn = typeCode.charAt(1) as ProcessFunction
  const tf = typeCode.charAt(2) as ProcessFunction
  const jp = typeCode.charAt(3)

  const outer = tokenOf(jp === 'J' ? tf : sn, 'e')
  const inner = tokenOf(jp === 'J' ? sn : tf, 'i')

  const dominant = ei === 'E' ? outer : inner
  const auxiliary = ei === 'E' ? inner : outer

  return {
    typeCode,
    dominant,
    auxiliary,
    tertiary: OPPOSITE_PROCESS[auxiliary],
    inferior: OPPOSITE_PROCESS[dominant],
  }
}
