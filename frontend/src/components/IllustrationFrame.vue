<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { illustrationAsset } from '@/design/illustrationAssets'
const props = withDefaults(defineProps<{ name: string; alt?: string; eager?: boolean; fit?: 'cover' | 'contain' }>(), { alt: '', eager: false, fit: 'cover' })
const failed = ref(false)
const src = computed(() => illustrationAsset(props.name))
watch(() => props.name, () => { failed.value = false })
</script>
<template>
  <div class="illustration-frame" :data-artwork="name" :data-artwork-source="src && !failed ? 'image' : 'vector'">
    <img v-if="src && !failed" :src="src" :alt="alt" :loading="eager ? 'eager' : 'lazy'" :fetchpriority="eager ? 'high' : 'auto'" decoding="async" :style="{ objectFit: fit }" @error="failed = true" />
    <slot v-else />
  </div>
</template>
<style scoped>
.illustration-frame { position: relative; min-width: 0; overflow: hidden; }
.illustration-frame > img { display: block; width: 100%; height: 100%; }
</style>
