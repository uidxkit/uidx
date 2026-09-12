<script setup lang="ts">
import { computed, ref } from 'vue'
import AssignPopup from './AssignPopup.vue'
import { FieldIcon } from './field-icons'
import { variableCandidates } from './variable-binding'
import type { TokenBindingSource, TokenDetachWrite } from './token-binding-source'

/** A literal control with a visible token action, or its binding with explicit detach. */
const props = defineProps<{
  properties: string[]
  label: string
  source?: TokenBindingSource
  editable: boolean
}>()
const emit = defineEmits<{
  bind: [properties: string[], token: string]
  detach: [writes: TokenDetachWrite[]]
}>()
const picking = ref(false)
const trigger = ref<HTMLButtonElement | null>(null)
const boundTo = computed(() => props.source?.bindings[props.properties[0]!] ?? null)
const literal = computed(() =>
  boundTo.value ? props.source?.tokens?.get(boundTo.value) : undefined,
)
const variables = computed(() => {
  const lists = props.properties.map((name) =>
    variableCandidates(props.source?.tokens, props.source?.tokenIndex, 'FLOAT', name),
  )
  return (lists[0] ?? []).filter((item) =>
    lists.every((list) => list.some((candidate) => candidate.address === item.address)),
  )
})

function pick(token: string): void {
  if (!props.editable) return
  picking.value = false
  emit('bind', props.properties, token)
}
function detach(): void {
  if (!props.editable || literal.value === undefined) return
  picking.value = false
  emit(
    'detach',
    props.properties.map((prop) => ({ prop, value: literal.value! })),
  )
}
</script>

<template>
  <span class="token-binding" :data-token-properties="properties.join(' ')">
    <template v-if="boundTo">
      <button
        ref="trigger"
        class="token-pill"
        type="button"
        data-popup-trigger
        :disabled="!editable"
        :title="`${boundTo} = ${literal ?? 'unresolved'}`"
        :aria-label="`Change token for ${label}`"
        :aria-expanded="picking"
        @click="picking = !picking"
      >
        <FieldIcon name="variable" />
        <span>{{ boundTo.split('#').pop() }}</span>
      </button>
      <button
        class="token-detach"
        type="button"
        :disabled="!editable || literal === undefined"
        :title="`Detach token from ${label}`"
        :aria-label="`Detach token from ${label}`"
        @click="detach"
      >
        <FieldIcon name="unlink-property" />
      </button>
    </template>
    <template v-else>
      <slot />
      <button
        v-if="editable"
        ref="trigger"
        class="field-variables"
        type="button"
        data-popup-trigger
        :title="`Apply token to ${label}`"
        :aria-label="`Apply token to ${label}`"
        :aria-expanded="picking"
        @click="picking = !picking"
      >
        <FieldIcon name="variables-grid" />
      </button>
    </template>
    <AssignPopup
      v-if="picking"
      :candidates="null"
      :component-name="null"
      :variables="variables"
      :bound-to="boundTo"
      :trigger="trigger"
      icon="variable"
      @variable="pick"
      @close="picking = false"
    />
  </span>
</template>

<style scoped>
.token-binding {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  gap: 2px;
}
.field-variables,
.token-detach {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: var(--field-h);
  border: 0;
  padding: 0;
  border-radius: var(--radius);
  background: none;
  color: var(--text-dim);
  cursor: pointer;
}
.field-variables:hover,
.token-detach:hover:not(:disabled) {
  color: var(--text);
  background: var(--raised);
}
.token-pill {
  display: flex;
  align-items: center;
  flex: 1;
  gap: 4px;
  min-width: 0;
  height: var(--field-h);
  padding: 0 6px;
  border: 0;
  border-radius: var(--radius-lg);
  color: var(--bound);
  background: color-mix(in srgb, var(--bound) 12%, var(--raised));
  font: inherit;
  cursor: pointer;
}
.token-pill span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
