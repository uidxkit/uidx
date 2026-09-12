<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { FieldIcon } from './field-icons'
import { openFontsKey, projectFonts, refreshFontLibrary } from './font-library'

const props = defineProps<{ selected: string; trigger: HTMLButtonElement }>()
const emit = defineEmits<{ select: [family: string]; close: [restoreFocus: boolean] }>()
const openFonts = inject(openFontsKey, undefined)
const root = ref<HTMLElement | null>(null)
const search = ref<HTMLInputElement | null>(null)
const query = ref('')
const active = ref(-1)
const error = ref('')
const placement = ref<Record<string, string>>({})
const listId = useId()
const families = computed(() => {
  const names = new Map<string, { name: string; available: boolean }>([
    ['inter', { name: 'Inter', available: true }],
  ])
  for (const font of projectFonts.value) {
    const key = font.family.toLowerCase()
    if (!names.has(key)) names.set(key, { name: font.family, available: true })
  }
  if (props.selected && !names.has(props.selected.toLowerCase()))
    names.set(props.selected.toLowerCase(), { name: props.selected, available: false })
  return [...names.values()]
    .filter((font) => font.name.toLowerCase().includes(query.value.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))
})
const current = (name: string): boolean =>
  name.toLowerCase() === (props.selected || 'Inter').toLowerCase()

watch(
  families,
  (fonts) => {
    const selected = fonts.findIndex((font) => font.available && current(font.name))
    active.value = selected >= 0 ? selected : fonts.findIndex((font) => font.available)
  },
  { immediate: true },
)

/** Match the token popup's size and placement, including fields near an edge. */
function positionPopup(): void {
  const rect = props.trigger.getBoundingClientRect()
  const width = Math.min(240, window.innerWidth - 16)
  const below = window.innerHeight - rect.bottom - 8
  const above = rect.top - 8
  const flip = below < 240 && above > below
  placement.value = {
    width: `${width}px`,
    left: `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`,
    top: flip ? 'auto' : `${rect.bottom + 4}px`,
    bottom: flip ? `${window.innerHeight - rect.top + 4}px` : 'auto',
    maxHeight: `${Math.max(80, Math.min(320, (flip ? above : below) - 4))}px`,
  }
}
function choose(index: number): void {
  const font = families.value[index]
  if (!font?.available) return
  emit('select', font.name)
  emit('close', true)
}
function clearSearch(): void {
  query.value = ''
  search.value?.focus({ preventScroll: true })
}
function move(direction: number): void {
  const options = families.value.flatMap((font, index) => (font.available ? [index] : []))
  if (!options.length) return
  const previous = options.indexOf(active.value)
  active.value = options[(previous + direction + options.length) % options.length]!
  void nextTick(() => {
    root.value
      ?.querySelector<HTMLElement>(`[id="${listId}-${active.value}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  })
}
function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    if (query.value) {
      query.value = ''
      search.value?.focus({ preventScroll: true })
    } else emit('close', true)
  } else if (event.target === search.value) {
    if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Enter') choose(active.value)
    else move(event.key === 'ArrowDown' ? 1 : -1)
  }
}
function outside(event: Event): void {
  const target = event.target as Node | null
  if (target && !root.value?.contains(target) && !props.trigger.contains(target))
    emit('close', false)
}
function onFocusOut(event: FocusEvent): void {
  if (
    event.relatedTarget &&
    !props.trigger.contains(event.relatedTarget as Node) &&
    !root.value?.contains(event.relatedTarget as Node)
  )
    emit('close', false)
}
function manage(): void {
  emit('close', false)
  openFonts?.()
}
async function refresh(): Promise<void> {
  error.value = ''
  try {
    await refreshFontLibrary()
  } catch {
    error.value = 'Could not refresh fonts.'
  }
}
onMounted(() => {
  positionPopup()
  search.value?.focus({ preventScroll: true })
  void refresh()
  document.addEventListener('pointerdown', outside, true)
  window.addEventListener('resize', positionPopup)
  document.addEventListener('scroll', positionPopup, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outside, true)
  window.removeEventListener('resize', positionPopup)
  document.removeEventListener('scroll', positionPopup, true)
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="root"
      class="font-picker"
      :style="placement"
      role="dialog"
      aria-label="Choose a font"
      @keydown="onKey"
      @focusout="onFocusOut"
    >
      <div class="font-search">
        <FieldIcon name="search" />
        <input
          ref="search"
          v-model="query"
          placeholder="Search fonts"
          aria-label="Search fonts"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          :aria-controls="listId"
          :aria-activedescendant="active >= 0 ? `${listId}-${active}` : undefined"
        />
        <button
          v-if="query"
          type="button"
          class="clear"
          aria-label="Clear search"
          @click="clearSearch"
        >
          <FieldIcon name="close" />
        </button>
      </div>
      <p class="heading">Project fonts</p>
      <div :id="listId" class="font-options" role="listbox" aria-label="Font families">
        <button
          v-for="(font, index) in families"
          :id="`${listId}-${index}`"
          :key="font.name"
          type="button"
          class="font-option"
          :class="{ current: current(font.name), active: index === active }"
          role="option"
          :aria-selected="current(font.name)"
          :disabled="!font.available"
          tabindex="-1"
          @pointermove="font.available && (active = index)"
          @mousedown.prevent
          @click="choose(index)"
        >
          <span class="check" aria-hidden="true">{{ current(font.name) ? '✓' : '' }}</span>
          <span class="family-name">{{ font.name }}</span>
          <span v-if="!font.available" class="hint">Missing</span>
          <span v-else-if="font.name === 'Inter'" class="hint">Bundled</span>
        </button>
        <p v-if="!families.length" class="empty" role="status">No matching fonts</p>
      </div>
      <div v-if="error" class="error" role="alert">
        <span>{{ error }}</span>
        <button type="button" @click="refresh">Retry</button>
      </div>
      <button v-if="openFonts" type="button" class="manage" @click="manage">
        <FieldIcon name="plus" />
        Manage fonts…
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.font-picker {
  position: fixed;
  z-index: 20;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: var(--gap-sm);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: var(--shadow);
  color: var(--text);
  font: var(--ui-size) / var(--ui-line) var(--ui-font);
}
.font-search {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--gap-sm);
  height: var(--field-h);
  padding: 0 6px;
  border-radius: var(--radius);
  background: var(--raised);
  color: var(--text-faint);
}
.font-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: none;
  color: var(--text);
  font: inherit;
}
.clear {
  display: flex;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-faint);
  cursor: pointer;
}
.heading {
  flex: none;
  margin: 8px 6px 4px;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}
.font-options {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior-y: contain;
}
.font-option {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: var(--field-h);
  padding: 0 6px;
  border: 0;
  border-radius: var(--radius);
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.font-option.active {
  background: var(--raised);
}
.font-option.current {
  background: var(--accent-dim);
}
.check {
  flex: none;
  width: 12px;
}
.family-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hint {
  flex: none;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}
.font-option:disabled {
  color: var(--text-faint);
  cursor: default;
}
.empty {
  margin: 0;
  padding: 8px 6px;
  color: var(--text-faint);
}
.manage {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  height: 32px;
  margin-top: var(--gap-sm);
  padding: 4px 6px 0;
  border: 0;
  border-top: 1px solid var(--line);
  background: none;
  color: var(--text-dim);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.manage:hover {
  color: var(--text);
  background: var(--raised);
}
.error {
  display: flex;
  flex: none;
  justify-content: space-between;
  gap: 6px;
  padding: 6px;
  color: var(--warn);
}
.error button {
  border: 0;
  padding: 0;
  background: none;
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
button:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}
</style>
