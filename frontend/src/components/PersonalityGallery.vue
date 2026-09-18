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
    <header class="portrait-gallery-heading"><div><p class="section-kicker">02 / 人格生活图鉴</p><h2 id="portrait-gallery-title">十六种倾向，<br><em>不止十六种人生。</em></h2></div><p>有人把灵感写进手记，<br>有人把想法变成行动。<br>换个角度，看看彼此。</p></header>
    <div class="portrait-gallery-body">
      <article :id="detailId" class="portrait-spotlight" :style="{ '--portrait-tint': current.background }" aria-live="polite" aria-atomic="true">
        <div class="portrait-spotlight-art"><span class="portrait-big-code" aria-hidden="true">{{ current.code }}</span><PersonalityPortrait :code="current.code" /><span class="portrait-edition">TYPEME / CHARACTER STUDY</span></div>
        <div class="portrait-spotlight-copy"><p class="section-kicker">{{ current.code }} · {{ current.traits }}</p><h3>{{ current.title }}</h3><p>{{ current.caption }}</p><span>原创插画角色 · 不是测评结果</span></div>
      </article>
      <div class="portrait-picker-panel"><p class="portrait-picker-hint">选一个字母组合，翻看它的生活速写 <span aria-hidden="true">↓</span></p>
        <div class="portrait-picker" role="group" aria-label="选择人格插画">
          <button v-for="item in portraits" :key="item.code" type="button" :aria-pressed="selected === item.code" :aria-controls="detailId" :aria-label="`${item.code}，${item.title}`" @click="selected = item.code">
            <PersonalityPortrait :code="item.code" /><span>{{ item.code }}</span>
          </button>
        </div>
        <p class="portrait-picker-note">人物的名字、穿着与道具是创作设定，不代表这一型的人一定如此；类型偏好也不决定职业、性别或能力。</p>
        <RouterLink to="/instruments/jung48/method" class="portrait-method-link">了解十六型测评怎么看待这些偏好 <span aria-hidden="true">↗</span></RouterLink>
      </div>
    </div>
  </section>
</template>
