<script setup lang="ts">
import { computed } from 'vue'
import { buildReportView } from '@/domain/reportV3'
import { parseBigFiveReport, reportBodyOf, type ReportDetailView } from '@/api/platformV3'
const props = defineProps<{ detail: ReportDetailView }>()
const parsed = computed(() => {
  try {
    const body = reportBodyOf(props.detail.report)
    if (props.detail.reportKind === 'big_five_profile') return { bigFive: parseBigFiveReport(body) }
    if (props.detail.reportKind === 'jung_reference') return { jung: buildReportView(body) }
    return { error: '暂不支持这种报告，请联系维护人员。' }
  } catch { return { error: '这份报告的数据不完整，无法可靠展示。请联系维护人员。' } }
})
</script>
<template>
  <article class="admin-readout">
    <p class="section-kicker">只读报告 · {{ detail.instrumentTitle }}</p>
    <p class="caption">生成于 {{ new Date(detail.createdAt).toLocaleString() }}。内容来自当时保存的报告，不重新计分。</p>
    <p v-if="parsed.error" role="alert" class="notice-error">{{ parsed.error }}</p>
    <template v-if="parsed.jung">
      <h3>{{ parsed.jung.headline }}</h3><p>{{ parsed.jung.summary }}</p>
      <p v-if="parsed.jung.tieNotice" class="notice-uncertain">{{ parsed.jung.tieNotice }}</p>
      <p v-for="note in parsed.jung.boundaryNotes" :key="note">{{ note }}</p>
      <section v-for="row in parsed.jung.dimensionRows" :key="row.dimension">
        <h4>{{ row.name }} · {{ row.statusNote }}</h4>
        <p v-for="line in row.details" :key="line">{{ line }}</p>
        <ul><li v-for="line in row.dailySigns" :key="line">{{ line }}</li></ul>
      </section>
      <section v-if="parsed.jung.candidates.length"><h4>值得对照的方向</h4>
        <p v-for="item in parsed.jung.candidates" :key="item.typeCode">{{ item.typeCode }} · {{ item.differsText }}。{{ item.costText }}</p>
      </section>
      <section v-for="item in parsed.jung.typeSections" :key="item.key"><h4>{{ item.title }}</h4><p>{{ item.body }}</p></section>
      <section v-for="item in parsed.jung.nextActions" :key="item.title"><h4>{{ item.title }}</h4><ol><li v-for="step in item.steps" :key="step">{{ step }}</li></ol></section>
      <details v-if="parsed.jung.dynamics" class="mb-5"><summary>查看框架推导与行动建议</summary>
        <p class="notice-uncertain mt-3">{{ parsed.jung.dynamics.basis }} {{ parsed.jung.dynamics.notes.frameworkCaveat }}</p>
        <p>{{ parsed.jung.dynamics.rule }}</p>
        <section v-for="item in parsed.jung.dynamics.processes" :key="item.slot"><h4>{{ item.roleTitle }} · {{ item.nameCn }}</h4><p>{{ item.what }}</p><p>{{ item.reading }}</p></section>
        <p v-for="item in parsed.jung.dynamics.boundaryNotes" :key="item.dimension">{{ item.note }}</p>
        <template v-if="parsed.jung.processPlan">
          <p>{{ parsed.jung.processPlan.notes.developmentNote }}</p>
          <section v-for="item in parsed.jung.processPlan.developmentOrder" :key="item.order"><h4>{{ item.title }}</h4><p>{{ item.body }}</p><p v-for="process in item.processes" :key="process.process">{{ process.nameCn }}：{{ process.body }}</p></section>
          <h4>做决定时可以尝试</h4><p>{{ parsed.jung.processPlan.decisionIntro }}</p>
          <section v-for="item in parsed.jung.processPlan.decisionSteps" :key="item.order"><h4>{{ item.title }}</h4><p>{{ item.prompt }}</p><p>{{ item.how }}</p></section>
          <p>{{ parsed.jung.processPlan.decisionNote }}</p><p>{{ parsed.jung.processPlan.hardestStepsNote }}</p>
          <section v-for="item in parsed.jung.processPlan.opposites" :key="item.axis"><h4>{{ item.axisName }}</h4><p>{{ item.need }}</p><p>{{ item.supply }}</p></section>
          <section v-for="item in parsed.jung.processPlan.communicationRules" :key="item.axis"><h4>{{ item.title }}</h4><p>{{ item.body }}</p></section>
          <p>{{ parsed.jung.processPlan.notes.greyAreaNote }}</p>
        </template>
      </details>
      <p class="notice-uncertain">用于自我探索参考，不是诊断或官方 MBTI；类型描述不能用于招聘、职业或配对判定。</p>
    </template>
    <section v-if="typeof detail.selfReflection.note === 'string' || typeof detail.selfReflection.selfSelectedTypeCode === 'string'">
      <h4>成员写下的自我理解</h4><p class="caption">这是成员的个人记录，不改变问卷计分。</p>
      <p v-if="typeof detail.selfReflection.selfSelectedTypeCode === 'string'">自选方向：{{ detail.selfReflection.selfSelectedTypeCode }}</p>
      <p v-if="typeof detail.selfReflection.note === 'string'">{{ detail.selfReflection.note }}</p>
    </section>
    <template v-if="parsed.bigFive">
      <h3>{{ parsed.bigFive.profileTitle }}</h3><p>{{ parsed.bigFive.summary }}</p>
      <section v-for="row in parsed.bigFive.dimensions" :key="row.dimension">
        <h4>{{ row.name }} · {{ row.levelLabel }}</h4><p>{{ row.reading }}</p><p>{{ row.description }}</p>
        <ul><li v-for="line in row.dailySigns" :key="line">{{ line }}</li></ul>
        <p>{{ row.observation }}</p><p class="caption">{{ row.caution }}</p>
      </section>
      <p v-for="line in parsed.bigFive.limitations" :key="line" class="notice-uncertain">{{ line }}</p>
    </template>
  </article>
</template>
<style scoped>
.admin-readout { line-height: 1.85; overflow-wrap: anywhere; }
h3 { font-size: 1.7rem; font-family: SimSun, serif; margin: 1rem 0; }
h4 { font-weight: 600; margin-bottom: .5rem; }
section { border-top: 1px solid #d9ddd5; padding: 1.25rem 0; }
p { margin-bottom: .7rem; } ul, ol { padding-left: 1.4rem; list-style: revert; }
</style>
