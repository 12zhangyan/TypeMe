<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { RouterLink } from 'vue-router'
import portraits from '@/design/personalityPortraits.json'
import PersonalityPortrait from './PersonalityPortrait.vue'
const selected = ref('INFP')
const current = computed(() => portraits.find(item => item.code === selected.value)!)
const detailId = `portrait-detail-${useId()}`
</script>
<template>
  <section class="personality-gallery" aria-labelledby="portrait-gallery-title" data-personality-gallery>
    <header class="portrait-gallery-heading"><div><p class="section-kicker">角色插画</p><h2 id="portrait-gallery-title">十六型<em>角色插画</em></h2></div></header>
    <div class="portrait-gallery-body">
      <article :id="detailId" class="portrait-spotlight" :style="{ '--portrait-tint': current.background }" aria-live="polite" aria-atomic="true">
        <div class="portrait-spotlight-art"><span class="portrait-big-code" aria-hidden="true">{{ current.code }}</span><PersonalityPortrait :code="current.code" /></div>
        <div class="portrait-spotlight-copy"><p class="section-kicker">{{ current.code }} · {{ current.traits }}</p><h3>{{ current.title }}</h3><span>原创插画角色，不是测评结果</span></div>
      </article>
      <div class="portrait-picker-panel"><p class="portrait-picker-hint">点选一个类型 <span aria-hidden="true">↓</span></p>
        <div class="portrait-picker" role="group" aria-label="选择人格插画">
          <button v-for="item in portraits" :key="item.code" type="button" :aria-pressed="selected === item.code" :aria-controls="detailId" :aria-label="`${item.code}，${item.title}`" @click="selected = item.code">
            <PersonalityPortrait :code="item.code" /><span>{{ item.code }}</span>
          </button>
        </div>
        <p class="portrait-picker-note">插画是角色想象，不代表测评结果、职业、性别或能力。</p>
        <RouterLink to="/instruments/jung48/method" class="portrait-method-link">了解十六型测评怎么看待这些偏好 <span aria-hidden="true">↗</span></RouterLink>
      </div>
    </div>
  </section>
</template>
