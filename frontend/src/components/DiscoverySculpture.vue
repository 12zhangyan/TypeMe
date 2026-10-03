<script setup lang="ts">
import { useId } from 'vue'
const id = useId().replace(/:/g, '')
</script>

<template>
  <svg class="discovery-sculpture" viewBox="0 0 640 680" fill="none" aria-hidden="true">
    <defs>
      <linearGradient :id="`${id}-ribbon`" x1="130" y1="110" x2="475" y2="530" gradientUnits="userSpaceOnUse">
        <stop stop-color="#DCE7B7" /><stop offset=".2" stop-color="#9CB38B" />
        <stop offset=".45" stop-color="#375F46" /><stop offset=".64" stop-color="#133F2E" />
        <stop offset=".82" stop-color="#6C906C" /><stop offset="1" stop-color="#D4DFAB" />
      </linearGradient>
      <linearGradient :id="`${id}-edge`" x1="170" y1="150" x2="410" y2="450" gradientUnits="userSpaceOnUse">
        <stop stop-color="#F2F4D9" /><stop offset=".46" stop-color="#7F9B68" /><stop offset="1" stop-color="#173E2C" />
      </linearGradient>
      <radialGradient :id="`${id}-pearl`" cx=".3" cy=".2" r=".85">
        <stop stop-color="#FFF4D5" /><stop offset=".45" stop-color="#EBC391" /><stop offset="1" stop-color="#A16B45" />
      </radialGradient>
      <filter :id="`${id}-shadow`" x="-60%" y="-100%" width="220%" height="300%"><feGaussianBlur stdDeviation="18" /></filter>
      <filter :id="`${id}-soft`" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="4" dy="22" stdDeviation="16" flood-color="#183A2D" flood-opacity=".16" /></filter>
    </defs>
    <ellipse cx="332" cy="592" rx="165" ry="19" fill="#233F29" opacity=".18" :filter="`url(#${id}-shadow)`" />
    <g :filter="`url(#${id}-soft)`">
      <ellipse cx="310" cy="315" rx="133" ry="217" transform="rotate(-38 310 315)" :stroke="`url(#${id}-ribbon)`" stroke-width="83" />
      <ellipse cx="310" cy="315" rx="113" ry="217" transform="rotate(-38 310 315)" :stroke="`url(#${id}-edge)`" stroke-width="2" opacity=".8" />
      <ellipse cx="342" cy="315" rx="123" ry="213" transform="rotate(37 342 315)" :stroke="`url(#${id}-ribbon)`" stroke-width="63" />
      <ellipse cx="342" cy="315" rx="98" ry="213" transform="rotate(37 342 315)" :stroke="`url(#${id}-edge)`" stroke-width="2" opacity=".65" />
      <path d="M149 251C140 335 228 439 310 490" :stroke="`url(#${id}-ribbon)`" stroke-width="80" stroke-linecap="round" />
      <circle cx="411" cy="197" r="54" :fill="`url(#${id}-pearl)`" />
    </g>
    <path d="M509 416V450M492 433H526" stroke="#2D6652" stroke-width="1" />
    <circle cx="111" cy="171" r="5" fill="#D1A57B" />
  </svg>
</template>
