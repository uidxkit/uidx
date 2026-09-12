<script setup lang="ts">
import { computed, inject } from 'vue'
import { NumberFieldRoot } from '@open-pencil/vue'
import {
  DEFAULT_ROOT_FONT_SIZE,
  LENGTH_PROPS,
  parseLength,
  writeLength,
  convertLength,
  type JsonValue,
  type LengthUnit,
} from '@uidx/format'
import { LENGTH_FIELD_CONTEXT } from './length-field-context'

const props = withDefaults(
  defineProps<{
    modelValue: number
    disabled?: boolean
    label: string
    step?: number
    lengthProperty?: string
    lengthValue?: JsonValue
  }>(),
  { lengthValue: undefined, lengthProperty: undefined, step: undefined },
)
const emit = defineEmits<{
  'update:modelValue': [value: JsonValue]
  commit: [value: JsonValue]
}>()
const context = inject(LENGTH_FIELD_CONTEXT, undefined)
const rootSize = computed(() => context?.rootFontSize.value ?? DEFAULT_ROOT_FONT_SIZE)
const enabled = computed(
  () => props.lengthValue !== undefined || LENGTH_PROPS.has(props.lengthProperty ?? ''),
)
const authored = computed(() => context?.valueFor(props.lengthProperty ?? '') ?? props.lengthValue)
const unit = computed(() =>
  enabled.value ? (parseLength(authored.value)?.unit ?? 'px') : undefined,
)
const factor = computed(() => (unit.value === 'rem' ? rootSize.value : 1))
const shown = computed(() => Number((props.modelValue / factor.value).toFixed(6)))
const encode = (value: number): JsonValue => (unit.value ? writeLength(value, unit.value) : value)

function selectUnit(next: LengthUnit): void {
  if (props.disabled || !enabled.value || next === unit.value) return
  const value = convertLength(props.modelValue, next, rootSize.value)
  if (value !== null) emit('commit', value)
}
</script>

<template>
  <NumberFieldRoot
    v-slot="slot"
    :model-value="shown"
    :disabled="disabled"
    :aria-label="label"
    :step="unit === 'rem' ? 0.0625 : (step ?? 1)"
    @update:model-value="(value: number) => emit('update:modelValue', encode(value))"
    @commit="(value: number) => emit('commit', encode(value))"
  >
    <slot v-bind="{ ...slot, unit, selectUnit }" />
  </NumberFieldRoot>
</template>

<style>
/* Slot content shares one numerical hit target; the unit menu is its sibling. */
.length-number-content {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}
</style>
