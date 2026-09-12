<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { JsonValue } from '@uidx/format'
import { FieldIcon, type IconName } from './field-icons'
import VariableRow from './VariableRow.vue'
import type { VariableCandidate } from './variable-binding'

/**
 * Figma's assignment popup (spec §3): search on top, the enclosing
 * component's same-type properties, then variables grouped by collection.
 * Holds no document knowledge — the host filtered both lists by the one type
 * this input takes, and turns a choice into patches.
 */
const props = defineProps<{
  /** Same-type properties, or null to hide the group (outside a component). */
  candidates: { name: string; declaration: { type: string; default: JsonValue } }[] | null
  componentName: string | null
  /** Already type-filtered by the host. */
  variables: VariableCandidate[]
  /** Current binding — a property name or a token address — for highlight. */
  boundTo: string | null
  /** The glyph property rows wear: the one type this input takes. */
  icon: IconName
  /**
   * The element whose click owns this popup's open/close toggle, exempted
   * from the outside-pointerdown close — precisely in place of the
   * `root.parentElement.parentElement` climb below.
   *
   * The climb assumes this popup's trigger is the only `[data-popup-trigger]`
   * within two ancestors of its root, which holds for `PropertyLink` (the
   * pill and its own popup share a `.field`/`.instance-swap-row` wrapper that
   * no sibling field reaches) but not for a compact paired row: `x` and `y`
   * render as two halves inside one shared `.field-pair` wrapper, so the
   * climb from either popup's root lands on ancestors *both* halves' glyphs
   * sit inside — exempting the other half's trigger too, and leaving two
   * popups open when the second glyph's click should have closed the first.
   * Passing this popup's own trigger element sidesteps the ambiguity: the
   * exemption becomes "this element" rather than "whatever the climb finds",
   * so it is precise regardless of what the row shares with a sibling field.
   * Omit it to keep the climb (Task 7's surfaces, unchanged).
   */
  trigger?: Element | null
}>()

const emit = defineEmits<{
  property: [name: string]
  variable: [address: string]
  create: []
  /** Open one listed property's declaration for editing — the row's ⚙. */
  edit: [name: string]
  close: []
}>()

const query = ref('')
const search = ref<HTMLInputElement | null>(null)
const root = ref<HTMLElement | null>(null)
const placement = ref<Record<string, string>>({})

/** Compact controls can be narrower than the popup; keep it in the viewport. */
function positionPopup(): void {
  const anchor =
    props.trigger ?? root.value?.parentElement?.parentElement?.querySelector('[data-popup-trigger]')
  if (!anchor) return
  const rect = anchor.getBoundingClientRect()
  const width = Math.min(240, window.innerWidth - 16)
  const below = window.innerHeight - rect.bottom - 8
  const above = rect.top - 8
  const flip = below < 240 && above > below
  placement.value = {
    position: 'fixed',
    width: `${width}px`,
    left: `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`,
    right: 'auto',
    top: flip ? 'auto' : `${rect.bottom + 4}px`,
    bottom: flip ? `${window.innerHeight - rect.top + 4}px` : 'auto',
    maxHeight: `${Math.max(80, Math.min(320, (flip ? above : below) - 4))}px`,
  }
}

const matches = (name: string): boolean =>
  name.toLowerCase().includes(query.value.trim().toLowerCase())

const properties = computed(() => (props.candidates ?? []).filter((c) => matches(c.name)))

/** Collection name -> its matching variables, in declaration order. */
const collections = computed(() => {
  const groups = new Map<string, VariableCandidate[]>()
  for (const candidate of props.variables) {
    if (!matches(candidate.name)) continue
    const list = groups.get(candidate.collection) ?? []
    list.push(candidate)
    groups.set(candidate.collection, list)
  }
  return [...groups]
})

const previewOf = (value: JsonValue): string =>
  typeof value === 'string' ? value : JSON.stringify(value)

/** Escape clears a live query first, then closes — Figma's order. */
function onKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  if (query.value) query.value = ''
  else emit('close')
}
/**
 * Outside pointerdown closes the popup — except this instance's own trigger,
 * which owns the open/close toggle and must not close-then-reopen in one
 * gesture. Every trigger in the panel carries `data-popup-trigger` (the pill
 * and the apply glyph alike), so a bare `closest` match would also exempt a
 * *different* field's trigger, leaving two popups open at once (spec §3: one
 * at a time).
 *
 * This popup's root always lands inside `.link-controls`, and that span's own
 * parent is the field-level wrapper (`.field`, `.instance-swap-row`,
 * `.section-link`) that also holds this same `PropertyLink`'s pill — its
 * sibling, not its child, which is why the check climbs one level past the
 * immediate parent rather than stopping at it.
 */
function onPointer(event: Event): void {
  const target = event.target as HTMLElement | null
  if (!target) return
  if (root.value?.contains(target)) return
  if (props.trigger) {
    if (props.trigger.contains(target)) return
    emit('close')
    return
  }
  const trigger = target.closest?.('[data-popup-trigger]')
  const ownScope = root.value?.parentElement?.parentElement
  if (trigger && ownScope?.contains(trigger)) return
  emit('close')
}

onMounted(() => {
  positionPopup()
  // Placement is applied on Vue's next render. Focusing the initial absolute
  // position must not scroll the document out from under its fixed app shell.
  search.value?.focus({ preventScroll: true })
  document.addEventListener('keydown', onKey)
  document.addEventListener('pointerdown', onPointer, true)
  window.addEventListener('resize', positionPopup)
  document.addEventListener('scroll', positionPopup, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  document.removeEventListener('pointerdown', onPointer, true)
  window.removeEventListener('resize', positionPopup)
  document.removeEventListener('scroll', positionPopup, true)
})
</script>

<template>
  <div ref="root" class="assign-popup" :style="placement">
    <div class="popup-search">
      <FieldIcon name="search" />
      <input ref="search" v-model="query" placeholder="Search" aria-label="search bindings" />
      <button v-if="query" type="button" class="popup-clear" aria-label="clear" @click="query = ''">
        <FieldIcon name="close" />
      </button>
    </div>

    <template v-if="candidates">
      <p class="popup-heading">Properties in {{ componentName ?? 'this component' }}</p>
      <!--
        The row is a div wearing button semantics rather than a <button>,
        because the edit glyph inside it is itself a button and buttons do not
        nest. Figma's own split: the row picks, the ⚙ on its trailing edge —
        shown on hover, exactly where the default preview sits at rest —
        opens the declaration for editing.
      -->
      <div
        v-for="option in properties"
        :key="option.name"
        role="button"
        tabindex="0"
        class="popup-row"
        :class="{ current: option.name === boundTo }"
        :aria-label="option.name"
        @click="emit('property', option.name)"
        @keydown.enter="emit('property', option.name)"
      >
        <FieldIcon :name="icon" class="prop-glyph" />
        <span class="row-name">{{ option.name }}</span>
        <span class="row-preview">{{ previewOf(option.declaration.default) }}</span>
        <button
          type="button"
          class="row-edit"
          :title="`edit ${option.name}`"
          :aria-label="`edit ${option.name}`"
          @click.stop="emit('edit', option.name)"
        >
          <FieldIcon name="edit-property" />
        </button>
      </div>
      <p v-if="!properties.length" class="popup-empty">Nothing declared yet</p>
      <button type="button" class="popup-create" @click="emit('create')">Create property…</button>
    </template>

    <template v-if="collections.length">
      <p class="popup-heading">Tokens</p>
      <template v-for="[collection, rows] in collections" :key="collection">
        <p class="popup-collection">{{ collection }}</p>
        <VariableRow
          v-for="candidate in rows"
          :key="candidate.address"
          :candidate="candidate"
          :current="candidate.address === boundTo"
          @pick="emit('variable', candidate.address)"
        />
      </template>
    </template>
    <p v-else class="popup-empty" role="status">
      {{
        query
          ? 'No matching tokens.'
          : 'No compatible tokens. Add a matching token to a token collection to use it here.'
      }}
    </p>
  </div>
</template>

<style scoped>
.assign-popup {
  position: absolute;
  top: calc(100% + 2px);
  right: 0;
  z-index: 20;
  width: 208px;
  max-height: 320px;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  padding: var(--gap-sm);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: var(--shadow);
}
.popup-search {
  display: flex;
  gap: var(--gap-sm);
  align-items: center;
  height: var(--field-h);
  margin-bottom: var(--gap-sm);
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
.popup-clear {
  display: inline-flex;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-faint);
  cursor: pointer;
}
.popup-heading {
  margin: var(--gap-sm) 0 2px;
  padding: 0 6px;
  color: var(--text);
  font-weight: 600;
}
.popup-collection {
  margin: 2px 0 0;
  padding: 0 6px;
  color: var(--text-faint);
}
.popup-empty {
  margin: 0;
  padding: 0 6px;
  color: var(--text-faint);
  line-height: var(--row-h);
}
/* The same row shape VariableRow draws, for the property rows this file owns. */
.popup-row {
  display: flex;
  gap: var(--gap-sm);
  align-items: center;
  width: 100%;
  height: var(--row-h);
  padding: 0 6px;
  border: 0;
  border-radius: var(--radius);
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.popup-row:hover {
  background: var(--raised);
}
/* The ⚙ takes the preview's place on hover: same trailing slot, one at a time. */
.row-edit {
  display: none;
  flex: none;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-faint);
  cursor: pointer;
}
.popup-row:hover .row-edit,
.popup-row:focus-within .row-edit {
  display: inline-flex;
}
.popup-row:hover .row-preview,
.popup-row:focus-within .row-preview {
  display: none;
}
.row-edit:hover {
  color: var(--text);
}
.popup-row.current {
  background: color-mix(in srgb, var(--accent) 25%, transparent);
}
.prop-glyph {
  color: var(--bound);
}
.row-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-preview {
  flex: none;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-faint);
}
.popup-create {
  display: block;
  width: 100%;
  margin-top: var(--gap-sm);
  padding: var(--gap-sm) 6px 0;
  border: 0;
  border-top: 1px solid var(--line);
  background: none;
  color: var(--text-dim);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.popup-create:hover {
  color: var(--text);
}
</style>
