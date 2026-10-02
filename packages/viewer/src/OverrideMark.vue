<script setup lang="ts">
import { resetTitle, shadowNote, type OverrideState } from './override-state'

/**
 * The mark beside an instance row's caption (ADR 0018 §7).
 *
 * Nothing while the row shows the component's value — that row is dimmed
 * instead, and a mark on every inherited row would be noise. A dot once the
 * use states a value, and a chip naming the state when a state the instance's
 * props select wins the property, so the author is not left wondering why
 * their colour does not show. Either way ↺ takes the use's value away.
 */
defineProps<{
  state: OverrideState
  /** The component the use inherits from. */
  component: string
  /** The component's value as text, for the reset's title. */
  inherited?: string | null
  /** The state that wins the property right now, for `shadowed`. */
  shadowedBy?: string | null
  /** The row's label, for the reset's accessible name. */
  label: string
  writable: boolean
}>()

const emit = defineEmits<{ reset: [] }>()
</script>

<template>
  <span v-if="state !== 'inherited'" class="override-mark" :data-override="state">
    <span
      v-if="state === 'set'"
      class="override-dot"
      role="img"
      :aria-label="`${label} overrides ${component}`"
      :title="`Overrides ${component}`"
    />
    <span v-else class="state-chip" :title="shadowNote(shadowedBy ?? 'current')">{{
      shadowedBy ?? 'state'
    }}</span>
    <button
      type="button"
      class="reset"
      :disabled="!writable"
      :aria-label="`Reset ${label}`"
      :title="resetTitle(component, inherited ?? null)"
      @click="emit('reset')"
    >
      ↺
    </button>
  </span>
</template>

<style scoped>
.override-mark {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.override-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}
.state-chip {
  padding: 0 4px;
  border: 1px solid var(--warn);
  border-radius: var(--radius);
  color: var(--warn);
  font-size: var(--ui-size-sm);
  line-height: 14px;
  white-space: nowrap;
}
/* InstancePropsSection's ↺ (its `.reset`), so a prop's reset and a box value's
   read as one control. Kept in step by override-mark.test.ts. */
.reset {
  padding: 0 4px;
  background: none;
  border: none;
  border-radius: var(--radius);
  color: var(--text-dim);
  font: inherit;
  cursor: pointer;
}
.reset:hover:not(:disabled) {
  background: var(--raised);
  color: var(--text);
}
.reset:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
