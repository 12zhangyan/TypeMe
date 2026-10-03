<script setup lang="ts">
import { computed } from 'vue'
import { buildDimensionFormulas, buildDimensionScales, dimensionOrderOf } from '@/domain/scoring'
import type { Questionnaire } from '@/domain/types'

/**
 * 计分事实块：把「区间 / 中点 / 每个维度的公式」全部从**当前题库**推导出来显示。
 *
 * ⚠️ 部署版**不再渲染**这个组件：方法与隐私页只讲用户需要知道的事，公式表属于维护向内容。
 * 组件与它的推导逻辑一并保留 —— 需要核对官方键值时把它挂回 `AboutView` 即可。
 *
 * 审查 MI-6：方法页原先硬编码「中点 24，区间 8–40」与四条写死题号的公式，
 * 换一份题库（比如 44 题标准版）这些数字与公式就会**静静地说错话**。
 * 这里改成从 `questionnaire` 推：常量、符号、题号、上下界、中点都跟着题库走。
 *
 * IPIP 大五接入后的泛化：维度数与顺序取自题库本身（OEJTS 4 维 / IPIP 5 维），
 * 「全部选 3 会怎样」这句结论也随量表而变 —— 类型量表会落到并列侧的字母，
 * 大五这类非类型量表只会得到「每个维度都落在中点、本次不给方向」。
 */
const props = defineProps<{
  questionnaire: Questionnaire | null
  /** 该量表是否产出类型码（决定「全部选 3」的后果怎么写） */
  hasTypeCode?: boolean
}>()

const scales = computed(() => {
  const questionnaire = props.questionnaire
  if (!questionnaire) return null
  let built: ReturnType<typeof buildDimensionScales>
  try {
    built = buildDimensionScales(questionnaire)
  } catch {
    return null
  }
  const order = dimensionOrderOf(questionnaire)
  if (order.length === 0) return null
  const list = order.map((dimension) => built[dimension]).filter(Boolean)
  if (list.length !== order.length) return null
  return list
})

const formulas = computed(() => {
  const questionnaire = props.questionnaire
  if (!questionnaire) return []
  try {
    return buildDimensionFormulas(questionnaire)
  } catch {
    return []
  }
})

const dimensionCount = computed(() => scales.value?.length ?? 0)

const rangeText = computed(() => {
  if (!scales.value) return null
  const all = scales.value
  const min = Math.min(...all.map((scale) => scale.min))
  const max = Math.max(...all.map((scale) => scale.max))
  const midpoint = all[0].midpoint
  const sameMidpoint = all.every((scale) => scale.midpoint === midpoint)
  return {
    min,
    max,
    midpoint,
    sameMidpoint,
    uniformRange: all.every((scale) => scale.min === min && scale.max === max),
  }
})
</script>

<template>
  <div v-if="rangeText" class="mt-3 space-y-3">
    <p class="prose-cn">
      按当前题库（{{ props.questionnaire?.questionCount ?? '?' }} 题）推导：得分区间
      <strong class="font-medium text-ink">{{ rangeText.min }}–{{ rangeText.max }}</strong>
      <template v-if="rangeText.uniformRange">（{{ dimensionCount }} 个维度相同）</template>
      ，中点
      <strong class="font-medium text-ink">{{ rangeText.midpoint }}</strong>
      <template v-if="rangeText.sameMidpoint">（{{ dimensionCount }} 个维度相同）</template>
      。拿全部选 3 举例：<template v-if="props.hasTypeCode"
        >每个维度都会恰好落在中点上，于是按并列规则归到低分侧字母，得到一个各维都没有偏移的参考组合。
        这不是"最像某个类型"，而是"所有维度都没有偏移"的直接后果。</template
      ><template v-else
        >每个维度都会恰好落在中点上，因此每个维度都显示「两侧相近」，本次不给出任何方向 ——
        大五量表没有类型码，也不会拿一组字母去代替方向。</template
      >
    </p>

    <pre
      v-if="formulas.length > 0"
      class="overflow-x-auto rounded-xl bg-paper-soft px-4 py-3 text-[12.5px] leading-relaxed text-ink-soft md:text-[13px]"
    ><code>{{ formulas.map((item) => item.formula).join('\n') }}</code></pre>

    <p class="text-[12.5px] leading-relaxed text-ink-faint">
      上面这 {{ formulas.length }} 条是从题库数据（每个维度的常数与逐题符号）<strong class="font-medium text-ink-soft">现算出来的</strong>，不是手抄的；
      换个题库，公式、区间与中点都会跟着变。<template v-if="props.hasTypeCode"
        >判定用的是「大于中点」而不是「大于等于」，所以刚好落在中点时归到低分侧字母。</template
      ><template v-else
        >判定用的是「离中点为 0 就保留未定」，所以刚好落在中点时这一维不给方向。</template
      >
    </p>
  </div>

  <p v-else class="mt-3 rounded-xl bg-paper-soft px-3 py-3 text-[12.5px] leading-relaxed text-ink-soft">
    题库还没有装载成功，暂时无法推导分值区间与公式。
  </p>
</template>
