// ⚠️ 本文件由 scripts/gen-fallback-content.mjs 从后端 YAML 自动生成，请勿手改。
//
// 唯一真相在 backend/src/main/resources/ 下：
//   content/questionnaire-quick.yml / content/types.yml / content/method.yml
//   assessment-packages/<packageId>.yml（v2 内容包：题面 + 帮助 + 维度解释 + 报告文案）
// 改内容请改后端 YAML，然后在前端目录执行 `npm run build`（prebuild 会重新生成）。
// 手改这里会在下一次构建时被覆盖，并被 src/content/consistency.spec.ts 判红。

import type { Questionnaire } from '@/domain/types'

/**
 * 快速版题库（快速版）—— `GET /api/v1/questionnaires/quick` 的内置副本。
 *
 * 计分常量 EI 30 / SN 12 / TF 30 / JP 18，midpoint 24。
 * `direction` 是官方 OEJTS 1.2 公式的直接展开；`textLeft` 对应官方「圈 1」的一端。
 */
export const FALLBACK_QUESTIONNAIRE: Questionnaire = {
  version: 'quick',
  title: '快速版',
  questionCount: 32,
  estimatedMinutes: 5,
  scoring: {
    midpoint: 24,
    constants: {
      EI: 30,
      SN: 12,
      TF: 30,
      JP: 18,
    },
  },
  questions: [
    { id: 1, textLeft: '喜欢列清单', textRight: '凭记忆', dimension: 'JP', direction: 1 },
    { id: 2, textLeft: '习惯先怀疑', textRight: '愿意先相信', dimension: 'TF', direction: -1 },
    { id: 3, textLeft: '独处久了会无聊', textRight: '需要独处的时间', dimension: 'EI', direction: -1 },
    { id: 4, textLeft: '接受事物的现状', textRight: '不满足于事物的现状', dimension: 'SN', direction: 1 },
    { id: 5, textLeft: '房间保持整洁', textRight: '东西随手放', dimension: 'JP', direction: 1 },
    { id: 6, textLeft: '认为“像机器人”是贬义', textRight: '希望自己有一颗像机器一样精确的头脑', dimension: 'TF', direction: 1 },
    { id: 7, textLeft: '精力充沛', textRight: '平和沉静', dimension: 'EI', direction: -1 },
    { id: 8, textLeft: '更愿意做选择题', textRight: '更愿意做论述题', dimension: 'SN', direction: 1 },
    { id: 9, textLeft: '随性，有点乱', textRight: '有条理，按规矩放', dimension: 'JP', direction: -1 },
    { id: 10, textLeft: '容易被话伤到', textRight: '不太往心里去', dimension: 'TF', direction: 1 },
    { id: 11, textLeft: '在群体中状态最好', textRight: '独处时状态最好', dimension: 'EI', direction: -1 },
    { id: 12, textLeft: '关注当下', textRight: '关注未来', dimension: 'SN', direction: 1 },
    { id: 13, textLeft: '很早就做好计划', textRight: '事到临头才计划', dimension: 'JP', direction: 1 },
    { id: 14, textLeft: '希望被人敬重', textRight: '希望被人喜爱', dimension: 'TF', direction: -1 },
    { id: 15, textLeft: '社交聚会让我疲惫', textRight: '社交聚会让我兴奋', dimension: 'EI', direction: 1 },
    { id: 16, textLeft: '融入大家', textRight: '显得与众不同', dimension: 'SN', direction: 1 },
    { id: 17, textLeft: '保留各种可能', textRight: '确定下来', dimension: 'JP', direction: -1 },
    { id: 18, textLeft: '希望擅长修理东西', textRight: '希望擅长帮人解决问题', dimension: 'TF', direction: -1 },
    { id: 19, textLeft: '说得更多', textRight: '听得更多', dimension: 'EI', direction: -1 },
    { id: 20, textLeft: '讲一件事时，会说发生了什么', textRight: '讲一件事时，会说它意味着什么', dimension: 'SN', direction: 1 },
    { id: 21, textLeft: '立刻把事情做完', textRight: '习惯拖到最后', dimension: 'JP', direction: 1 },
    { id: 22, textLeft: '听从内心', textRight: '听从理智', dimension: 'TF', direction: 1 },
    { id: 23, textLeft: '待在家里', textRight: '出门去玩', dimension: 'EI', direction: 1 },
    { id: 24, textLeft: '想要看到整体', textRight: '想要看到细节', dimension: 'SN', direction: -1 },
    { id: 25, textLeft: '临场发挥', textRight: '事先准备', dimension: 'JP', direction: -1 },
    { id: 26, textLeft: '道德判断基于公正', textRight: '道德判断基于同情心', dimension: 'TF', direction: -1 },
    { id: 27, textLeft: '很难大声喊出来', textRight: '隔着老远喊人很自然', dimension: 'EI', direction: 1 },
    { id: 28, textLeft: '重理论', textRight: '重实证', dimension: 'SN', direction: -1 },
    { id: 29, textLeft: '工作起来很拼', textRight: '玩起来很拼', dimension: 'JP', direction: 1 },
    { id: 30, textLeft: '面对情绪不太自在', textRight: '很看重情绪', dimension: 'TF', direction: -1 },
    { id: 31, textLeft: '喜欢在人前表现', textRight: '尽量避免当众讲话', dimension: 'EI', direction: -1 },
    { id: 32, textLeft: '喜欢弄清“谁、什么、什么时候”', textRight: '喜欢弄清“为什么”', dimension: 'SN', direction: 1 },
  ],
}
