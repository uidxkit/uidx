<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ComponentThumb from './ComponentThumb.vue'
import { FieldIcon } from './field-icons'
import { LAYER_ICONS } from './layer-icons'
import { onListKeys } from './list-keys'
import type { SlotCard, SlotChoice, SlotPick } from './slot-content'

/**
 * What a slot of this instance holds — chosen from a list, the way Builder's
 * block picker and Figma's instance-swap menu offer content: search on top,
 * the components that fit first, then everything else, then plain content.
 *
 * "Fit" is the point of the order. A list's repeated slot hands each row its
 * item (ADR 0017 §2), so a component with a property of the item's model is
 * one that shows a different item on every row; anything else draws the same
 * thing on each.
 */
const props = withDefaults(
  defineProps<{
    card: SlotCard
    /** The trigger the popup hangs from, exempted from the outside-click close. */
    trigger: Element | null
    /** False where there is no default to go back to: the component's own content. */
    allowDefault?: boolean
  }>(),
  { allowDefault: true },
)

const emit = defineEmits<{ pick: [pick: SlotPick]; close: [] }>()

const query = ref('')
const search = ref<HTMLInputElement | null>(null)
const root = ref<HTMLElement | null>(null)
const placement = ref<Record<string, string>>({})

const matches = (choice: SlotChoice): boolean =>
  choice.name.toLowerCase().includes(query.value.trim().toLowerCase())
const suggested = computed(() => props.card.suggested.filter(matches))
const others = computed(() => props.card.others.filter(matches))
const basics = computed(() =>
  [
    { kind: 'text' as const, label: 'Text', hint: 'A line of copy to edit in place' },
    { kind: 'empty' as const, label: 'Nothing', hint: 'Leave the slot empty here' },
  ].filter((basic) => basic.label.toLowerCase().includes(query.value.trim().toLowerCase())),
)

const current = computed(() => {
  const content = props.card.content
  return content.kind === 'component' ? content.component : content.kind
})

const suggestedHeading = computed(() =>
  props.card.repeat?.model ? `Receives a ${props.card.repeat.model}` : 'Allowed here',
)

function positionPopup(): void {
  const anchor = props.trigger
  if (!anchor) return
  const rect = anchor.getBoundingClientRect()
  const width = Math.min(296, window.innerWidth - 16)
  const below = window.innerHeight - rect.bottom - 8
  const above = rect.top - 8
  const flip = below < 320 && above > below
  placement.value = {
    position: 'fixed',
    width: `${width}px`,
    left: `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`,
    top: flip ? 'auto' : `${rect.bottom + 4}px`,
    bottom: flip ? `${window.innerHeight - rect.top + 4}px` : 'auto',
    maxHeight: `${Math.max(160, Math.min(440, (flip ? above : below) - 4))}px`,
  }
}

function onKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  if (query.value) query.value = ''
  else emit('close')
}
const onListKey = (event: KeyboardEvent): void => onListKeys(event, root.value, search.value)

function onPointer(event: Event): void {
  const target = event.target as Node | null
  if (!target || root.value?.contains(target) || props.trigger?.contains(target)) return
  emit('close')
}

function pick(choice: SlotPick): void {
  emit('pick', choice)
  emit('close')
}

onMounted(() => {
  positionPopup()
  search.value?.focus({ preventScroll: true })
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('pointerdown', onPointer, true)
  window.addEventListener('resize', positionPopup)
  document.addEventListener('scroll', positionPopup, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey, true)
  document.removeEventListener('pointerdown', onPointer, true)
  window.removeEventListener('resize', positionPopup)
  document.removeEventListener('scroll', positionPopup, true)
})
</script>

<template>
  <div
    ref="root"
    class="slot-popup"
    role="dialog"
    :aria-label="`Content for ${card.name}`"
    :style="placement"
    @keydown="onListKey"
  >
    <div class="popup-search">
      <FieldIcon name="search" />
      <input
        ref="search"
        v-model="query"
        placeholder="Search components"
        aria-label="Search components"
        spellcheck="false"
      />
      <button v-if="query" type="button" class="popup-clear" aria-label="clear" @click="query = ''">
        <FieldIcon name="close" />
      </button>
    </div>

    <div class="popup-body">
      <template v-if="suggested.length">
        <p class="popup-heading">
          {{ suggestedHeading }}
          <span v-if="card.repeat?.model" class="heading-hint">shows each item</span>
        </p>
        <button
          v-for="choice in suggested"
          :key="choice.name"
          type="button"
          class="popup-row choice"
          :class="{ current: current === choice.name }"
          :data-choice="choice.name"
          @click="pick({ kind: 'component', name: choice.name })"
        >
          <ComponentThumb :name="choice.name" />
          <span class="row-text">
            <span class="row-name">{{ choice.name }}</span>
            <span class="row-note">
              <template v-if="choice.receives">
                <span class="receives">{{ choice.receives }}: {{ card.repeat?.model }}</span>
              </template>
              {{ choice.note }}
            </span>
          </span>
          <span v-if="current === choice.name" class="row-check" aria-label="current">✓</span>
        </button>
      </template>

      <template v-if="others.length">
        <p class="popup-heading">
          {{ suggested.length ? 'Other components' : 'Components' }}
          <span v-if="card.repeat?.model" class="heading-hint">same on every row</span>
        </p>
        <button
          v-for="choice in others"
          :key="choice.name"
          type="button"
          class="popup-row choice"
          :class="{ current: current === choice.name }"
          :data-choice="choice.name"
          @click="pick({ kind: 'component', name: choice.name })"
        >
          <ComponentThumb :name="choice.name" />
          <span class="row-text">
            <span class="row-name">{{ choice.name }}</span>
            <span v-if="choice.note" class="row-note">{{ choice.note }}</span>
          </span>
          <span v-if="current === choice.name" class="row-check" aria-label="current">✓</span>
        </button>
      </template>

      <template v-if="basics.length">
        <p class="popup-heading">Basic</p>
        <button
          v-for="basic in basics"
          :key="basic.kind"
          type="button"
          class="popup-row choice"
          :class="{ current: current === basic.kind }"
          :data-choice="`:${basic.kind}`"
          @click="pick({ kind: basic.kind })"
        >
          <span class="basic-glyph" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path
                :d="basic.kind === 'text' ? LAYER_ICONS.Text : LAYER_ICONS.Slot"
                fill="none"
                stroke="currentColor"
              />
            </svg>
          </span>
          <span class="row-text">
            <span class="row-name">{{ basic.label }}</span>
            <span class="row-note">{{ basic.hint }}</span>
          </span>
          <span v-if="current === basic.kind" class="row-check" aria-label="current">✓</span>
        </button>
      </template>

      <p v-if="!suggested.length && !others.length && !basics.length" class="popup-empty">
        Nothing matches “{{ query }}”.
      </p>
    </div>

    <button
      v-if="allowDefault"
      type="button"
      class="popup-row popup-default"
      :class="{ current: card.content.kind === 'default' }"
      data-choice=":default"
      @click="pick({ kind: 'default' })"
    >
      <span class="default-glyph" aria-hidden="true">↺</span>
      <span class="row-text">
        <span class="row-name">Use default</span>
        <span class="row-note">{{ card.fallback.label }}, as the component draws it</span>
      </span>
      <span v-if="card.content.kind === 'default'" class="row-check" aria-label="current">✓</span>
    </button>
  </div>
</template>

<style scoped>
.slot-popup {
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
  flex: none;
  gap: var(--gap-sm);
  align-items: center;
  height: var(--field-h);
  margin: var(--gap-sm);
  padding: 0 6px;
  border-radius: var(--radius);
  background: var(--raised);
  color: var(--text-faint);
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
.popup-search:focus-within {
  box-shadow: inset 0 0 0 1px var(--accent);
}
/* The field's ring is drawn by its container, which also holds the glyph. */
.popup-search input:focus-visible {
  outline: none;
}
.popup-clear {
  display: inline-flex;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-faint);
  cursor: pointer;
}
.popup-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 var(--gap-sm) var(--gap-sm);
}
.popup-heading {
  display: flex;
  justify-content: space-between;
  margin: var(--gap) 0 2px;
  padding: 0 6px;
  color: var(--text-dim);
  font-size: var(--ui-size-sm);
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.heading-hint {
  color: var(--text-faint);
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
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
.row-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.row-name {
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-note {
  overflow: hidden;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.receives {
  margin-right: 4px;
  color: var(--bound);
}
.row-check {
  flex: none;
  color: var(--accent);
}
.basic-glyph,
.default-glyph {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 32px;
  border: 1px dashed var(--line);
  border-radius: var(--radius-lg);
  color: var(--text-dim);
}
.popup-default {
  flex: none;
  border-top: 1px solid var(--line);
  border-radius: 0;
  padding: 7px 10px;
}
.popup-empty {
  margin: var(--gap) 6px;
  color: var(--text-faint);
}
</style>
