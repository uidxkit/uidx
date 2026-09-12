<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { convertLength, parseLength, type LengthUnit, type JsonValue } from '@uidx/format'
import LengthUnitSelect from './LengthUnitSelect.vue'
import { LENGTH_FIELD_CONTEXT } from './length-field-context'
import type { EditableProp } from './editable'
import { formatDashPattern, parseDashPattern } from './paint-edit'

/**
 * Figma's dash field: comma-separated numbers, the array behind it. A string
 * that does not parse refuses, red, without writing — the rename pattern.
 */
const props = defineProps<{ field: EditableProp; editable: boolean }>()
const emit = defineEmits<{ commit: [prop: string, value: JsonValue] }>()

const draft = ref(formatDashPattern(props.field.value))
const invalid = ref(false)
const context = inject(LENGTH_FIELD_CONTEXT, undefined)
const unit = computed(() =>
  Array.isArray(props.field.value) ? parseLength(props.field.value[0])?.unit : undefined,
)

function changeUnit(unit: LengthUnit): void {
  if (!props.editable || !Array.isArray(props.field.value)) return
  const values = props.field.value.map((value) =>
    convertLength(value, unit, context?.rootFontSize.value),
  )
  if (values.some((value) => value === null)) return
  emit('commit', props.field.name, values)
}

watch(
  () => props.field.value,
  (value) => {
    draft.value = formatDashPattern(value)
    invalid.value = false
  },
)

function onChange(event: Event): void {
  if (!props.editable) return
  const text = (event.target as HTMLInputElement).value
  const parsed = parseDashPattern(text)
  if (!parsed) {
    invalid.value = true
    return
  }
  invalid.value = false
  emit('commit', props.field.name, parsed)
}
</script>

<template>
  <label class="field-caption" :for="`f-${field.name}`">{{ field.label }}</label>
  <span class="dash-input">
    <input
      :id="`f-${field.name}`"
      class="value"
      :class="{ invalid }"
      type="text"
      :value="draft"
      :disabled="!editable"
      placeholder="4, 2"
      @change="onChange"
    />
    <LengthUnitSelect
      :unit="unit"
      :disabled="!editable"
      label="Dash pattern"
      @change="changeUnit"
    />
  </span>
</template>

<style scoped>
.dash-input {
  display: flex;
  align-items: center;
  gap: 4px;
}
/* Matches `PropertyField`'s own `.field-caption` (a different SFC, so a
   shared class name alone would not reach across the style scope): the
   caption sits on its own line above the input — every other field's
   pattern — rather than beside it, which is what a bare inline `<label>`
   defaults to. */
.field-caption {
  display: block;
  margin-bottom: 4px;
  color: var(--text-dim);
}
input {
  display: block;
  width: 100%;
  height: var(--field-h);
  box-sizing: border-box;
  background: var(--raised);
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  color: var(--text);
  font-family: var(--ui-font);
  font-size: var(--ui-size);
  padding: 2px 6px;
}
input:hover:not(:disabled) {
  border-color: var(--line);
}
input:focus {
  outline: none;
  border-color: var(--accent);
}
input.invalid {
  border-color: var(--danger);
}
input:disabled {
  opacity: 0.5;
}
</style>
