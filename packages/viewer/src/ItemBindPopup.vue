<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { onListKeys } from './list-keys'
import type { BindOption } from './instance-data'

/**
 * Binding a property to the item, as a token is bound: a short list of what
 * fits — the item, then each field of the right type — and one click.
 */
const props = defineProps<{
  prop: string
  options: readonly BindOption[]
  current: string | null
  trigger: Element | null
}>()
const emit = defineEmits<{ pick: [alias: string | null]; close: [] }>()

const root = ref<HTMLElement | null>(null)
const placement = ref<Record<string, string>>({})

function place(): void {
  const rect = props.trigger?.getBoundingClientRect()
  if (!rect) return
  const width = Math.min(240, window.innerWidth - 16)
  placement.value = {
    position: 'fixed',
    width: `${width}px`,
    left: `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`,
    top: `${rect.bottom + 4}px`,
  }
}
function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
  }
}
function onPointer(event: Event): void {
  const target = event.target as Node | null
  if (target && !root.value?.contains(target) && !props.trigger?.contains(target)) emit('close')
}
onMounted(() => {
  place()
  root.value?.querySelector<HTMLElement>('.popup-row')?.focus({ preventScroll: true })
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('pointerdown', onPointer, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey, true)
  document.removeEventListener('pointerdown', onPointer, true)
})
function pick(alias: string | null): void {
  emit('pick', alias)
  emit('close')
}
</script>

<template>
  <div
    ref="root"
    class="bind-popup"
    role="dialog"
    :aria-label="`Bind ${prop}`"
    :style="placement"
    @keydown="onListKeys($event, root, null)"
  >
    <p class="heading">From each row</p>
    <button
      v-for="option in options"
      :key="option.alias"
      type="button"
      class="popup-row"
      :class="{ current: option.alias === current }"
      :data-alias="option.alias"
      @click="pick(option.alias)"
    >
      <span class="glyph" aria-hidden="true">{ }</span>
      <span class="name">{{ option.label }}</span>
      <span class="type">{{ option.type }}</span>
    </button>
    <p v-if="!options.length" class="empty">Nothing in the item has this type.</p>
    <button v-if="current" type="button" class="popup-row unbind" @click="pick(null)">
      Unbind
    </button>
  </div>
</template>

<style scoped>
.bind-popup {
  z-index: 30;
  padding: var(--gap-sm);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: var(--shadow-float);
}
.heading {
  margin: 2px 6px 4px;
  color: var(--text-dim);
  font-size: var(--ui-size-sm);
  font-weight: 600;
  text-transform: uppercase;
}
.popup-row {
  display: flex;
  gap: var(--gap);
  align-items: center;
  width: 100%;
  height: var(--row-h);
  padding: 0 6px;
  border: 0;
  border-radius: var(--radius);
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.popup-row:hover,
.popup-row:focus-visible {
  background: var(--raised);
  outline: none;
}
.popup-row.current {
  background: var(--accent-dim);
}
.glyph {
  color: var(--bound);
  font-family: ui-monospace, monospace;
  font-size: 9px;
}
.name {
  flex: 1;
}
.type {
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}
.unbind {
  margin-top: 2px;
  border-top: 1px solid var(--line);
  border-radius: 0;
  color: var(--text-dim);
}
.empty {
  margin: 4px 6px;
  color: var(--text-faint);
}
</style>
