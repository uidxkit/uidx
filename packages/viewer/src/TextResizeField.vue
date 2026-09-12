<script setup lang="ts">
import { computed } from 'vue'
import { SegmentedControlItem, SegmentedControlRoot } from '@open-pencil/vue'
import type { JsonValue } from '@uidx/format'
import type { EditableProp } from './editable'
import { FieldIcon } from './field-icons'

/**
 * Figma's own 3-way switch for a `<Text>`'s box: Fixed size / Auto height /
 * Auto width. `textAutoResize` carries a fourth legal value the engine still
 * accepts, `TRUNCATE` — the old Figma API's fixed-and-truncates state — but
 * `textTruncation` (`DISABLED`/`ENDING`, its own row further down) is the
 * surface this codebase already settled on for that (`panel-figma-parity.md`
 * row 9). Offering `TRUNCATE` here too would be the same behaviour reachable
 * two ways, one of them a spelling nothing else in the panel uses — so a file
 * that already holds it still displays (as Fixed, the nearer of the three),
 * but this control never writes it, the same stance ADR 0002 takes on `FILL`.
 */
const props = defineProps<{ field: EditableProp; editable: boolean }>()
const emit = defineEmits<{ commit: [prop: string, value: JsonValue] }>()

const MODES = [
  { value: 'NONE', label: 'Fixed size', icon: 'resize-none' as const },
  { value: 'HEIGHT', label: 'Auto height', icon: 'resize-height' as const },
  { value: 'WIDTH_AND_HEIGHT', label: 'Auto width', icon: 'resize-both' as const },
]

const mode = computed<string | undefined>(() => {
  const value = props.field.value
  if (typeof value !== 'string') return undefined
  return value === 'TRUNCATE' ? 'NONE' : value
})

function onMode(value: string | string[] | undefined): void {
  if (!props.editable || typeof value !== 'string') return
  emit('commit', props.field.name, value)
}
</script>

<template>
  <label class="field-caption">{{ field.label }}</label>
  <SegmentedControlRoot
    class="value enum-segmented"
    :aria-label="field.name"
    :disabled="!editable"
    :model-value="mode"
    @update:model-value="onMode"
  >
    <SegmentedControlItem
      v-for="option in MODES"
      :key="option.value"
      :value="option.value"
      :disabled="!editable"
      :title="option.label"
      class="enum-item"
    >
      <FieldIcon :name="option.icon" />
    </SegmentedControlItem>
  </SegmentedControlRoot>
</template>

<style scoped>
/*
 * A near-duplicate of `PropertyField`'s own `.field-caption`/`.enum-segmented`
 * rules — a different SFC, so neither reaches here across the style scope
 * (`DashPatternField` hit the same wall). `SegmentedControlItem` compounds
 * it: it renders through the primitive's own layer, which drops even *this*
 * component's scope attribute from the button it produces, so the item rule
 * needs `:deep()` same as the original.
 */
.field-caption {
  display: block;
  margin-bottom: 4px;
  color: var(--text-dim);
}
.enum-segmented {
  display: flex;
  height: var(--field-h);
  box-sizing: border-box;
  gap: 1px;
  background: var(--raised);
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  padding: 2px;
}
.enum-segmented :deep(.enum-item) {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  background: none;
  border: 1px solid transparent;
  color: var(--text-dim);
  padding: 2px 4px;
  cursor: pointer;
  border-radius: var(--radius);
}
.enum-segmented :deep(.enum-item[data-state='on']) {
  /* The active segment is Figma's floating pill: lifted off the track. */
  background: var(--panel);
  border: 1px solid var(--line);
  color: var(--text);
}
.enum-segmented :deep([aria-disabled='true']) {
  opacity: 0.5;
  cursor: default;
}
</style>
