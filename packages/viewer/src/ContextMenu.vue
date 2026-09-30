<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

/**
 * The right-click menu over the canvas and the rail.
 *
 * Every entry is an action the toolbar already offers, with the shortcut
 * beside it the way Figma, Plasmic and Builder list theirs: the menu is how
 * a person who has not learnt the letters finds them. The shell owns the
 * actions and their predicates; this draws them at the pointer and closes on
 * a pick, Escape, or a click anywhere else.
 */
export type MenuItem =
  | { kind: 'separator' }
  | {
      kind?: 'item'
      label: string
      shortcut?: string
      disabled?: boolean
      danger?: boolean
      run: () => void
    }

const props = defineProps<{
  x: number
  y: number
  items: MenuItem[]
}>()
const emit = defineEmits<{ close: [] }>()
const el = ref<HTMLElement | null>(null)

/** Kept on screen: a menu opened near the bottom edge grows upward. */
const placed = ref<{ left: string; top: string }>({ left: `${props.x}px`, top: `${props.y}px` })
onMounted(() => {
  const box = el.value?.getBoundingClientRect()
  if (!box) return
  const left = Math.min(props.x, window.innerWidth - box.width - 8)
  const top = Math.min(props.y, window.innerHeight - box.height - 8)
  placed.value = { left: `${Math.max(8, left)}px`, top: `${Math.max(8, top)}px` }
  el.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
})

function onDocumentPointer(event: PointerEvent): void {
  if (el.value && !el.value.contains(event.target as Node)) emit('close')
}
function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
  }
}
onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointer, true)
  document.addEventListener('keydown', onKey, true)
})
onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocumentPointer, true)
  document.removeEventListener('keydown', onKey, true)
})

function pick(item: MenuItem): void {
  if (item.kind === 'separator' || item.disabled) return
  emit('close')
  item.run()
}
</script>

<template>
  <div ref="el" class="context-menu" role="menu" :style="placed" @contextmenu.prevent>
    <template v-for="(item, i) in items" :key="i">
      <hr v-if="item.kind === 'separator'" role="separator" />
      <button
        v-else
        type="button"
        role="menuitem"
        :disabled="item.disabled"
        :class="{ danger: item.danger }"
        @click="pick(item)"
      >
        <span class="label">{{ item.label }}</span>
        <kbd v-if="item.shortcut">{{ item.shortcut }}</kbd>
      </button>
    </template>
  </div>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 60;
  min-width: 200px;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  box-shadow: var(--shadow-md, 0 8px 24px rgba(0, 0, 0, 0.35));
}
.context-menu button {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 6px 10px;
  border: 0;
  border-radius: 5px;
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.context-menu button:hover:not(:disabled),
.context-menu button:focus-visible {
  background: var(--accent);
  color: #fff;
  outline: none;
}
.context-menu button:disabled {
  color: var(--text-faint);
  cursor: default;
}
.context-menu button.danger:not(:disabled) {
  color: var(--danger);
}
.context-menu button.danger:hover:not(:disabled) {
  background: var(--danger);
  color: #fff;
}
.context-menu kbd {
  font: inherit;
  font-size: 11px;
  color: var(--text-dim);
}
.context-menu button:hover:not(:disabled) kbd,
.context-menu button:focus-visible kbd {
  color: inherit;
}
.context-menu hr {
  margin: 4px 6px;
  border: 0;
  border-top: 1px solid var(--line);
}
</style>
