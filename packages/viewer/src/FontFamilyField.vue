<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import FontPickerPopup from './FontPickerPopup.vue'
import { FieldIcon } from './field-icons'
defineOptions({ inheritAttrs: false })
const props = defineProps<{ modelValue: string; disabled?: boolean }>()
const emit = defineEmits<{ commit: [family: string] }>()
const open = ref(false)
const trigger = ref<HTMLButtonElement | null>(null)
function close(restoreFocus = true): void {
  open.value = false
  if (restoreFocus) void nextTick(() => trigger.value?.focus({ preventScroll: true }))
}
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) close(false)
  },
)
</script>
<template>
  <button
    v-bind="$attrs"
    id="f-fontFamily"
    ref="trigger"
    type="button"
    class="font-family"
    :disabled="disabled"
    aria-label="Font family"
    aria-haspopup="dialog"
    :aria-expanded="open"
    data-popup-trigger
    @click="open = !open"
    @keydown.down.prevent.stop="open = true"
    @keydown.up.prevent.stop="open = true"
  >
    <span>{{ modelValue || 'Inter' }}</span>
    <FieldIcon name="chevron-down" />
  </button>
  <FontPickerPopup
    v-if="open && trigger"
    :selected="modelValue"
    :trigger="trigger"
    @select="emit('commit', $event)"
    @close="close"
  />
</template>
<style scoped>
.font-family {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-width: 0;
  height: var(--field-h);
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  padding: 2px 8px;
  color: var(--text);
  background: var(--raised);
  font: var(--ui-size) var(--ui-font);
  text-align: left;
  cursor: pointer;
}
.font-family > span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.font-family > svg {
  flex: none;
  color: var(--text-faint);
}
.font-family:hover:not(:disabled),
.font-family[aria-expanded='true'] {
  border-color: var(--line);
}
.font-family:disabled {
  opacity: 0.5;
  cursor: default;
}
.font-family:focus-visible {
  outline: none;
  border-color: var(--accent);
}
</style>
