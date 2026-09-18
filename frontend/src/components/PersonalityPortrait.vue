<script setup lang="ts">
import { computed } from 'vue'
import portraits from '@/design/personalityPortraits.json'
import IllustrationFrame from './IllustrationFrame.vue'
const props = defineProps<{ code: string }>()
const portrait = computed(() => portraits.find(item => item.code === props.code))
const skin = computed(() => ['#BE8967', '#D5A580', '#AA7657', '#D7AF8C'][ (portrait.value?.index ?? 0) % 4 ])
</script>
<template>
  <IllustrationFrame v-if="portrait" :name="`type-${portrait.code.toLowerCase()}`" fit="contain" class="personality-portrait" aria-hidden="true">
    <svg viewBox="0 0 320 380" fill="none" class="portrait-vector">
      <circle cx="161" cy="172" r="118" :fill="portrait.background"/>
      <path d="M41 309H279" stroke="#5D7455" stroke-opacity=".22"/><ellipse cx="162" cy="333" rx="70" ry="9" fill="#244A36" opacity=".09"/>
      <path d="M135 246L127 315M179 246L193 314" stroke="#354F43" stroke-width="23" stroke-linecap="round"/>
      <path d="M127 316L111 326H138M193 315L213 325H187" stroke="#E1CEAD" stroke-width="13" stroke-linecap="round"/>
      <path d="M116 155Q156 133 196 155L204 256Q157 269 111 253Z" :fill="portrait.color"/>
      <path d="M145 150L157 201L173 149" fill="#F6EBD7"/><path d="M157 201V262" stroke="#F4ECD7" stroke-opacity=".35" stroke-width="2"/>
      <path d="M145 123V151Q159 163 174 150V123" :fill="skin"/>
      <ellipse cx="160" cy="105" rx="38" ry="43" :fill="skin"/>
      <path v-if="portrait.index % 3 === 0" d="M122 109Q103 42 155 49Q207 38 202 113L189 106L181 72Q153 102 122 109Z" fill="#34473B"/>
      <path v-else-if="portrait.index % 3 === 1" d="M122 112Q101 99 116 77Q100 51 134 50Q143 33 162 44Q192 32 198 59Q220 69 203 99L190 105L181 78Q164 87 139 78L131 110Z" fill="#4B4739"/>
      <path v-else d="M121 114Q110 79 129 61Q149 37 179 52Q202 62 200 111L190 110L184 76Q158 72 141 94L131 116Z" fill="#3C4038"/>
      <path d="M147 108H148M174 108H175" stroke="#324139" stroke-width="4" stroke-linecap="round"/>
      <path d="M154 126Q161 131 169 125" stroke="#885E48" stroke-width="2" stroke-linecap="round"/>
      <path d="M118 169L99 211L132 226M194 167L214 207L186 225" :stroke="portrait.color" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="133" cy="225" r="10" :fill="skin"/><circle cx="186" cy="225" r="10" :fill="skin"/>
      <g v-if="portrait.prop === 'book' || portrait.prop === 'map'">
        <path d="M128 205L158 209L194 199V240L159 248L128 242Z" :fill="portrait.prop === 'map' ? '#D7DDBB' : '#F0D4AF'"/>
        <path d="M158 209V247M135 218L149 220M169 217L185 213M169 225L184 221" stroke="#8B947A" stroke-width="2"/>
      </g>
      <g v-else-if="portrait.prop === 'model' || portrait.prop === 'blocks'" stroke="#8C876E" stroke-width="3"><path d="M135 239L156 202L184 230Z"/><circle cx="135" cy="239" r="13" fill="#DBBC8E"/><circle cx="156" cy="202" r="13" fill="#E8DFC5"/><circle cx="184" cy="230" r="13" fill="#ADBDA5"/></g>
      <g v-else-if="portrait.prop === 'plant' || portrait.prop === 'flower'"><path d="M162 232V171M162 209L145 194M162 190L180 178" stroke="#486E4E" stroke-width="4"/><ellipse cx="143" cy="192" rx="14" ry="7" fill="#85A479" transform="rotate(28 143 192)"/><ellipse cx="177" cy="177" rx="15" ry="8" fill="#A5B38A" transform="rotate(-32 177 177)"/><path d="M145 226H180L175 249H151Z" fill="#D1A47F"/></g>
      <g v-else-if="portrait.prop === 'lantern'"><path d="M145 205V195A17 17 0 0 1 179 195V205" stroke="#66745A" stroke-width="4"/><path d="M142 206H182L176 251H149Z" fill="#E5C28C"/><path d="M161 216V241" stroke="#FFF2C7" stroke-width="8" stroke-linecap="round"/></g>
      <g v-else-if="portrait.prop === 'table'"><path d="M113 244H211" stroke="#D4B288" stroke-width="8" stroke-linecap="round"/><path d="M135 216H160V240H138Z" fill="#F1D7B2"/><path d="M169 215H191V240H171Z" fill="#B7C7B5"/><path d="M136 217H130V232H139M190 218H197V231H190" stroke="#F3DFBA" stroke-width="3"/></g>
      <g v-else-if="portrait.prop === 'kite'"><path d="M160 236L179 177" stroke="#8F8265" stroke-width="3"/><path d="M179 177L153 160L162 186L185 202L197 177L181 153Z" fill="#DEC19B"/><path d="M179 177L162 186L185 202Z" fill="#96AD88"/><circle cx="179" cy="177" r="4" fill="#EEE3C8"/></g>
      <g v-else-if="portrait.prop === 'tool'"><path d="M136 246H186M162 242V198L181 190" stroke="#8EAA8B" stroke-width="5"/><path d="M162 207Q158 181 178 180Q197 180 198 204Z" fill="#EDCB9B"/><path d="M128 230L147 217" stroke="#DAB78B" stroke-width="5" stroke-linecap="round"/></g>
      <g v-else-if="portrait.prop === 'compass'"><circle cx="161" cy="222" r="24" fill="#ECD7AF"/><circle cx="161" cy="222" r="19" stroke="#948E6C"/><path d="M170 209L166 228L152 236L156 217Z" fill="#647B66"/></g>
      <g v-else><path d="M160 241L169 213" stroke="#D8B08B" stroke-width="7" stroke-linecap="round"/><ellipse cx="174" cy="199" rx="16" ry="22" transform="rotate(22 174 199)" fill="#D5A16F"/><path d="M160 198L183 207" stroke="#F3D7AF" stroke-width="5"/></g>
      <path d="M60 283Q58 247 79 230M60 262Q43 244 44 231M60 278Q84 268 88 253" stroke="#95A58A" stroke-width="3" stroke-linecap="round"/>
      <path d="M247 127L257 135L249 146M261 132L271 130" stroke="#BF9B72" stroke-width="2" stroke-linecap="round"/>
    </svg>
  </IllustrationFrame>
</template>
<style scoped>
.personality-portrait { aspect-ratio: 4/5; width: 100%; }.portrait-vector { display: block; width: 100%; height: 100%; }
</style>
