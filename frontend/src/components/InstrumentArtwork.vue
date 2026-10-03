<script setup lang="ts">
withDefaults(defineProps<{ kind?: 'jung' | 'big_five'; hero?: boolean }>(), { kind: 'jung', hero: false })
</script>

<template>
  <svg viewBox="0 0 320 280" fill="none" aria-hidden="true" class="instrument-artwork" :class="{ 'artwork-hero': hero }">
    <template v-if="kind === 'jung'">
      <path d="M160 140C69 140 56 58 105 49C144 41 160 99 160 140Z" fill="#6D9782" />
      <path d="M160 140C160 49 242 36 251 85C259 124 201 140 160 140Z" fill="#B8CBB0" />
      <path d="M160 140C251 140 264 222 215 231C176 239 160 181 160 140Z" fill="#E8BB88" />
      <path d="M160 140C160 231 78 244 69 195C61 156 119 140 160 140Z" fill="#315E4B" />
      <circle cx="160" cy="140" r="16" fill="#F7F8F2" />
      <circle cx="160" cy="140" r="108" stroke="#315E4B" stroke-opacity=".2" stroke-dasharray="2 7" />
      <path d="M38 140H62M258 140H282M160 18V38M160 242V262" stroke="#315E4B" stroke-opacity=".45" />
    </template>
    <template v-else>
      <ellipse cx="160" cy="94" rx="37" ry="68" fill="#B9CDD4" />
      <ellipse cx="160" cy="94" rx="37" ry="68" transform="rotate(72 160 140)" fill="#D9BD9B" />
      <ellipse cx="160" cy="94" rx="37" ry="68" transform="rotate(144 160 140)" fill="#99B5A4" />
      <ellipse cx="160" cy="94" rx="37" ry="68" transform="rotate(216 160 140)" fill="#738C9C" />
      <ellipse cx="160" cy="94" rx="37" ry="68" transform="rotate(288 160 140)" fill="#BCC3A2" />
      <circle cx="160" cy="140" r="22" fill="#F7F8F2" />
      <circle cx="160" cy="140" r="108" stroke="#315E4B" stroke-opacity=".2" stroke-dasharray="2 7" />
    </template>
  </svg>
</template>
