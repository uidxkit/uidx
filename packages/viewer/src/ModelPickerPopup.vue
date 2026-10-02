<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ModelSpec } from '@uidx/format'
import { FieldIcon } from './field-icons'
import { onListKeys } from './list-keys'
import { itemCount } from './model-edits'

/**
 * Choosing which model a layer repeats — the way a token is chosen: search on
 * top, then every model with how many items it holds and the fields an item
 * has, so the choice is made by what the content is rather than by a name.
 */
const props = defineProps<{
  models: readonly ModelSpec[]
  current: string | null
  trigger: Element | null
}>()
const emit = defineEmits<{ pick: [name: string]; manage: []; close: [] }>()

const query = ref('')
const search = ref<HTMLInputElement | null>(null)
const root = ref<HTMLElement | null>(null)
const placement = ref<Record<string, string>>({})

const shown = computed(() =>
  props.models.filter((model) =>
    model.name.toLowerCase().includes(query.value.trim().toLowerCase()),
  ),
)

function place(): void {
  const rect = props.trigger?.getBoundingClientRect()
  if (!rect) return
  const width = Math.min(280, window.innerWidth - 16)
  const below = window.innerHeight - rect.bottom - 8
  const flip = below < 260 && rect.top > below
  placement.value = {
    position: 'fixed',
    width: `${width}px`,
    left: `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`,
    top: flip ? 'auto' : `${rect.bottom + 4}px`,
    bottom: flip ? `${window.innerHeight - rect.top + 4}px` : 'auto',
    maxHeight: `${Math.max(160, Math.min(380, (flip ? rect.top : below) - 8))}px`,
  }
}

function onKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  if (query.value) query.value = ''
  else emit('close')
}
function onPointer(event: Event): void {
  const target = event.target as Node | null
  if (target && !root.value?.contains(target) && !props.trigger?.contains(target)) emit('close')
}
onMounted(() => {
  place()
  search.value?.focus({ preventScroll: true })
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('pointerdown', onPointer, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey, true)
  document.removeEventListener('pointerdown', onPointer, true)
})

function pick(name: string): void {
  emit('pick', name)
  emit('close')
}
</script>

<template>
  <div
    ref="root"
    class="model-popup"
    role="dialog"
    aria-label="Choose a model"
    :style="placement"
    @keydown="onListKeys($event, root, search)"
  >
    <div class="popup-search">
      <FieldIcon name="search" />
      <input
        ref="search"
        v-model="query"
        placeholder="Search models"
        aria-label="Search models"
        spellcheck="false"
      />
    </div>
    <div class="body">
      <p class="heading">Models</p>
      <button
        v-for="model in shown"
        :key="model.name"
        type="button"
        class="popup-row"
        :class="{ current: model.name === current }"
        :data-model="model.name"
        @click="pick(model.name)"
      >
        <span class="glyph" aria-hidden="true">{ }</span>
        <span class="text">
          <span class="name">{{ model.name }}</span>
          <span class="fields">{{ model.fields.map((field) => field.name).join(' · ') }}</span>
        </span>
        <span class="count">{{ itemCount(model) }} items</span>
      </button>
      <p v-if="!shown.length" class="empty">
        {{ models.length ? 'No model matches.' : 'No models yet.' }}
      </p>
    </div>
    <button type="button" class="popup-row manage" @click="emit('manage')">
      <span class="glyph" aria-hidden="true">＋</span>
      <span class="text"><span class="name">New or edit models…</span></span>
    </button>
  </div>
</template>

<style scoped>
.model-popup {
  z-index: 30;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: var(--shadow-float);
}
.popup-search {
  display: flex;
  gap: var(--gap-sm);
  align-items: center;
  height: var(--field-h);
  margin: var(--gap-sm);
  padding: 0 6px;
  border-radius: var(--radius);
  background: var(--raised);
  color: var(--text-faint);
}
.popup-search:focus-within {
  box-shadow: inset 0 0 0 1px var(--accent);
}
.popup-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  outline: none;
}
.popup-search input:focus-visible {
  outline: none;
}
.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 var(--gap-sm) var(--gap-sm);
}
.heading {
  margin: var(--gap-sm) 6px 2px;
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
  padding: 5px 6px;
  border: 0;
  border-radius: var(--radius-lg);
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
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--bound) 16%, transparent);
  color: var(--bound);
  font-family: ui-monospace, monospace;
  font-size: 10px;
}
.text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.name {
  font-weight: 500;
}
.fields {
  overflow: hidden;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.count {
  flex: none;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}
.manage {
  border-top: 1px solid var(--line);
  border-radius: 0;
}
.empty {
  margin: var(--gap) 6px;
  color: var(--text-faint);
}
</style>
