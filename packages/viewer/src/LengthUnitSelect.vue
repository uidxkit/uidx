<script setup lang="ts">
import type { LengthUnit } from '@uidx/format'

defineProps<{ unit?: LengthUnit; disabled?: boolean; label: string }>()
const emit = defineEmits<{ change: [unit: LengthUnit] }>()
</script>

<template>
  <select
    v-if="unit"
    class="length-unit"
    :value="unit"
    :disabled="disabled"
    :aria-label="`${label} unit`"
    :title="unit === 'rem' ? 'Relative to the root font size' : 'Pixels'"
    @pointerdown.stop
    @keydown.stop
    @change="emit('change', ($event.target as HTMLSelectElement).value as LengthUnit)"
  >
    <option value="px">px</option>
    <option value="rem">rem</option>
  </select>
</template>

<style scoped>
.length-unit {
  appearance: none;
  flex: none;
  width: 28px;
  min-width: 0;
  height: 22px;
  padding: 0 2px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-dim);
  font: inherit;
  font-size: var(--ui-size-sm, 11px);
  cursor: pointer;
  text-align: center;
}
.length-unit:hover:not(:disabled) {
  background: var(--raised);
  border-color: var(--line);
  color: var(--text);
}
.length-unit:focus-visible {
  outline: 1px solid var(--accent);
}
.length-unit:disabled {
  opacity: 0.5;
  cursor: default;
}
.length-unit option {
  background: var(--panel);
  color: var(--text);
}
</style>
