<script setup lang="ts">
import { computed } from 'vue'
import { FieldIcon } from './field-icons'
import { lockedLayoutSummary, type LockedLayout } from './override-state'

/**
 * An instance's layout, read-only (ADR 0018 §1, §7).
 *
 * Direction, gap, alignment, wrap and clipping are the component's business,
 * so an instance shows them as one line rather than controls that would write
 * nothing the renderer reads. The way to change them is the component, which
 * the link opens.
 */
const props = defineProps<{
  /** The component's resting layout, as the instance's combination resolves it. */
  layout: LockedLayout
  component: string
}>()

const emit = defineEmits<{ openComponent: [name: string] }>()

const summary = computed(() => lockedLayoutSummary(props.layout))
</script>

<template>
  <div class="locked-layout" role="group" :aria-label="`Layout, from ${component}`">
    <span class="locked-glyph" title="Set by the component"><FieldIcon name="lock" /></span>
    <span class="locked-text" :title="`${summary} — edit ${component} to change its layout`">
      <span class="locked-summary">{{ summary }}</span>
      <span class="locked-from">— from {{ component }}</span>
    </span>
    <button type="button" class="locked-open" @click="emit('openComponent', component)">
      Edit component
    </button>
  </div>
</template>

<style scoped>
.locked-layout {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  min-height: var(--field-h);
  color: var(--text-dim);
}
.locked-glyph {
  display: inline-flex;
  flex: none;
  color: var(--text-faint);
}
.locked-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.locked-from {
  margin-left: 4px;
  color: var(--text-faint);
}
.locked-open {
  flex: none;
  padding: 0 4px;
  background: none;
  border: none;
  border-radius: var(--radius);
  color: var(--accent);
  font: inherit;
  cursor: pointer;
}
.locked-open:hover {
  background: var(--raised);
}
.locked-open:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
</style>
