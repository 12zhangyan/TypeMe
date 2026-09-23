<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { useInstrumentsStore } from '@/stores/instrumentsV3'
import EditorialScene from './EditorialScene.vue'
import IllustrationFrame from './IllustrationFrame.vue'
import PersonalityGallery from './PersonalityGallery.vue'
import InstrumentCard from './InstrumentCard.vue'
import type { MyAttemptRow } from '@/api/platformV3'

withDefaults(defineProps<{ resume?: MyAttemptRow | { attemptId: string } | null; checkingDrafts?: boolean }>(), {
  resume: null,
  checkingDrafts: false,
})

const instruments = useInstrumentsStore()
onMounted(() => { void instruments.load() })

function exploreAssessments(): void {
  const heading = document.getElementById('available-assessments')
  heading?.scrollIntoView({ block: 'start' })
  heading?.focus({ preventScroll: true })
}
</script>

<template>
  <section data-platform-intro class="atelier-platform">
    <header class="discovery-hero">
      <div class="discovery-edition"><span>TypeMe / 自我探索手记</span></div>
      <div class="discovery-copy">
        <h1>了解你的<span>性格倾向</span></h1>
        <div class="discovery-caption"><p>十六型看四个方面的偏好，大五看五个方面的倾向。</p></div>
        <div class="discovery-actions">
          <button type="button" class="btn-primary" @click="exploreAssessments">选择测评 <span aria-hidden="true">↗</span></button>
          <RouterLink v-if="resume" :to="`/assess/${encodeURIComponent(resume.attemptId)}`" class="link-quiet" data-platform-resume>继续上次测评</RouterLink>
          <span v-else-if="checkingDrafts" class="discovery-pending" role="status">正在确认上次进度…</span>
          <RouterLink v-else to="/assess" class="link-quiet">查看我的测评</RouterLink>
        </div>
        <ul v-if="instruments.items.length" class="discovery-choices" aria-label="可选测评">
          <li v-for="card in instruments.items" :key="card.slug">
            <RouterLink :to="`/assess?instrument=${encodeURIComponent(card.slug)}`">
              <strong>{{ card.title }}</strong>
              <span>{{ card.hasTypeCode ? '四个方面的偏好' : '五个方面的倾向' }}</span>
            </RouterLink>
          </li>
        </ul>
      </div>
      <div class="discovery-illustration atelier-cover" aria-hidden="true">
        <IllustrationFrame name="home-hero" eager class="atelier-cover-art"><EditorialScene /></IllustrationFrame>
      </div>
    </header>

    <div id="available-assessments" class="catalog-heading" tabindex="-1">
      <div><h2>选择测评</h2></div>
    </div>

    <p v-if="instruments.loading" class="notice-info mt-5" role="status">正在载入可选测评…</p>
    <div v-else-if="instruments.error" class="notice-error mt-5" role="alert">
      <p>测评列表暂时没能载入：{{ instruments.error }}</p>
      <button class="btn-secondary btn-sm mt-3" type="button" @click="instruments.load(true)">重新载入测评列表</button>
    </div>
    <p v-else-if="instruments.items.length === 0" class="notice-neutral mt-5">暂时没有可开始的测评，请稍后再来。</p>
    <ul v-else class="assessment-grid" data-home-instruments>
      <li v-for="(card, index) in instruments.items" :key="card.slug">
        <InstrumentCard :instrument="card" :index="index">
          <RouterLink :to="`/assess?instrument=${encodeURIComponent(card.slug)}`" class="btn-primary btn-sm">选择这项测评 <span aria-hidden="true">↗</span></RouterLink>
          <RouterLink :to="`/instruments/${encodeURIComponent(card.slug)}/method`" class="btn-ghost btn-sm">先了解怎么测</RouterLink>
        </InstrumentCard>
      </li>
    </ul>
    <PersonalityGallery />
  </section>
</template>
