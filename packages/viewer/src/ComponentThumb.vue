<script setup lang="ts">
import { inject, ref, watch } from 'vue'
import { componentPreviewKey } from './component-preview'
import { LAYER_ICONS } from './layer-icons'

/** A component's picture in a picker row, or its glyph while there is none. */
const props = defineProps<{ name: string; size?: 'sm' | 'md' }>()

const preview = inject(componentPreviewKey, null)
const url = ref<string | null>(null)

watch(
  () => props.name,
  (name) => {
    url.value = null
    if (!preview) return
    preview(name)
      .then((found) => {
        if (props.name === name) url.value = found
      })
      .catch(() => {})
  },
  { immediate: true },
)
</script>

<template>
  <span class="component-thumb" :data-size="size ?? 'md'" aria-hidden="true">
    <img v-if="url" :src="url" alt="" />
    <svg v-else width="12" height="12" viewBox="0 0 12 12">
      <path :d="LAYER_ICONS.Instance" fill="none" stroke="currentColor" />
    </svg>
  </span>
</template>

<style scoped>
.component-thumb {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 32px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--canvas-bg);
  color: var(--bound);
}
.component-thumb[data-size='sm'] {
  width: 28px;
  height: 22px;
}
img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
</style>
