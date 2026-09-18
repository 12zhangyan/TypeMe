<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { useInstrumentsStore } from '@/stores/instrumentsV3'
import EditorialScene from './EditorialScene.vue'
import IllustrationFrame from './IllustrationFrame.vue'
import PersonalityGallery from './PersonalityGallery.vue'
import InstrumentCard from './InstrumentCard.vue'

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
      <div class="discovery-edition"><span>TypeMe / 自我探索手记</span><span>向内看，慢慢来。 <span aria-hidden="true">↙</span></span></div>
      <div class="discovery-copy">
        <p class="discovery-eyebrow">每个人，都是一整个世界。</p>
        <h1>不止一种<br /><span>可能的你</span><i aria-hidden="true">。</i></h1>
        <div class="discovery-caption"><span class="editorial-rule" /><p>你如何感受，如何选择，如何与世界相处。<br />给自己一点时间，看见那些还没被命名的部分。</p></div>
        <div class="discovery-actions">
          <button type="button" class="btn-primary" @click="exploreAssessments">找到适合我的测评 <span aria-hidden="true">↗</span></button>
          <RouterLink to="/assess" class="link-quiet">继续上次的探索</RouterLink>
        </div>
      </div>
      <div class="discovery-illustration atelier-cover" aria-hidden="true">
        <IllustrationFrame name="home-hero" eager class="atelier-cover-art"><EditorialScene /></IllustrationFrame>
        <span class="atelier-margin-note">A LITTLE CLOSER TO YOURSELF</span>
        <div class="atelier-cover-note"><span>一段留给自己的时间</span><p>向内探索。<br>向外生长。</p><span aria-hidden="true">↗</span></div>
      </div>
      <div class="discovery-baseline"><p>认识自己，从一个好问题开始。</p><span>自我探索参考 · 非心理诊断</span><span aria-hidden="true">SCROLL TO EXPLORE ↓</span></div>
    </header>

    <div id="available-assessments" class="catalog-heading" tabindex="-1">
      <div><p class="section-kicker">01 / 选择你的探索视角</p><h2>从好奇的地方，<br class="tablet:hidden" /><em>开始。</em></h2></div>
      <p>不同的测评，照见不同的侧面。<br />没有高低之分，只有更多理解。</p>
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
    <section class="atelier-reflection" aria-labelledby="manifesto-title">
      <IllustrationFrame name="reflection" class="atelier-reflection-art"><EditorialScene scene="reflection" /></IllustrationFrame>
      <div class="atelier-reflection-copy"><p class="section-kicker">03 / 给自己一点余地</p><h2 id="manifesto-title">了解自己，<br>是为了更自在地<br><em>成为自己。</em></h2>
        <p>测评是一种观察自己的方式。你可以认同，也可以保留不同意见。生活里的你，永远比一份报告更丰富。</p>
        <RouterLink to="/about" class="link">看看我们的测评方法与边界 ↗</RouterLink>
      </div>
    </section>
    <div class="atelier-reading-path"><p class="section-kicker">从好奇，到一点点理解</p><ol>
      <li><span>01</span><div><h3>选一个想了解的侧面</h3><p>看偏好，或看五种不同的倾向。</p></div></li>
      <li><span>02</span><div><h3>按真实的自己回答</h3><p>没有标准答案，拿不准也没关系。</p></div></li>
      <li><span>03</span><div><h3>把报告带回生活里</h3><p>先读解释，再观察哪些描述适合自己。</p></div></li>
    </ol></div>
  </section>
</template>
