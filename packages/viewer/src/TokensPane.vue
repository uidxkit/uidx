<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import {
  parseLength,
  isUnitLength,
  convertLength,
  writeLength,
  type LengthUnit,
  type JsonValue,
  type VariableType,
} from '@uidx/format'
import LengthUnitSelect from './LengthUnitSelect.vue'
import ColorPickerDialog from './ColorPickerDialog.vue'
import AssignPopup from './AssignPopup.vue'
import { FieldIcon } from './field-icons'
import type { VariableCandidate } from './variable-binding'
import type { Rgba } from './paint-edit'
import type {
  CollectionGroup,
  TokenCategory,
  TokenCell,
  TokenRow,
  TokenTier,
} from './tokens-view-model'
import TokenSpecimen from './TokenSpecimen.vue'
import {
  TOKEN_TIERS,
  TOKEN_TYPES,
  tierLabel,
  visualRole,
  hasLengthUnit,
} from './token-presentation'

/** A token library with explicit details navigation and compact, single-click
 * value controls. Binding uses the canvas inspector's shared token picker;
 * every edit still leaves as an intent for the shell's patch channel. */
const props = defineProps<{
  rootFontSize?: number
  groups: readonly CollectionGroup[]
  selection: readonly string[]
  /** Whether "+ New collection" is offered — true on the declaring page only. */
  canCreateCollections: boolean
  /** Compatible, resolved alias targets, previewed in the edited column’s mode. */
  aliasOptionsFor: (type: VariableType, selfAddress: string, mode: string) => VariableCandidate[]
}>()

export interface TokenEditIntent {
  row: TokenRow
  mode: string
  value: JsonValue
}

const emit = defineEmits<{
  select: [address: string]
  edit: [payload: TokenEditIntent]
  'add-token': [collection: string]
  'add-collection': []
  'remove-collection': [collection: string]
}>()

/**
 * The one cell being edited as text, if any. Shallow, and the draft text in a
 * ref of its own: a deep ref would send Vue's UnwrapRef down TokenRow's
 * recursive JsonValue and TS gives up (TS2589).
 */
const query = ref('')
const activeTier = ref<TokenTier | 'all'>('all')
const activeType = ref<TokenCategory | 'all'>('all')
const activeCollection = ref('all')
const paneEl = ref<HTMLDivElement | null>(null)
const toolbarEl = ref<HTMLDivElement | null>(null)
const createdCollection = ref<string | null>(null)

watch(
  () => props.groups.map((group) => group.name),
  (names) => {
    if (activeCollection.value !== 'all' && !names.includes(activeCollection.value)) resetFilters()
    if (createdCollection.value && !names.includes(createdCollection.value))
      createdCollection.value = null
    if (editing.value && !names.includes(editing.value.row.address.split('#')[0]!))
      editing.value = null
    if (binding.value && !names.includes(binding.value.row.address.split('#')[0]!))
      binding.value = null
    if (picking.value && !names.includes(picking.value.row.address.split('#')[0]!))
      picking.value = null
  },
)

/** Called only after the shell receives the collection's successful write. */
async function revealCollection(name: string): Promise<void> {
  resetFilters()
  editing.value = null
  picking.value = null
  binding.value = null
  createdCollection.value = name
  await nextTick()
  const pane = paneEl.value
  const section = Array.from(pane?.querySelectorAll<HTMLElement>('[data-collection]') ?? []).find(
    (element) => element.dataset.collection === name,
  )
  if (!pane || !section) {
    createdCollection.value = null
    return
  }
  // Scroll this pane only, leaving the app shell and details panel in place.
  pane.scrollTo({
    top:
      pane.scrollTop +
      section.getBoundingClientRect().top -
      pane.getBoundingClientRect().top -
      (toolbarEl.value?.offsetHeight ?? 0) -
      12,
  })
  section.querySelector<HTMLButtonElement>('.add')?.focus({ preventScroll: true })
}

function focusCollectionTools(): void {
  toolbarEl.value?.querySelector<HTMLButtonElement>('.root')?.focus({ preventScroll: true })
}

defineExpose({ revealCollection, focusCollectionTools })
const allRows = computed(() => props.groups.flatMap((group) => group.rows))
const typeOptions = computed(() =>
  Object.entries(TOKEN_TYPES)
    .map(([id, type]) => ({
      id: id as TokenCategory,
      ...type,
      count: allRows.value.filter((row) => row.category === id).length,
    }))
    .filter((type) => type.count > 0),
)
const unassignedCount = computed(() =>
  props.groups
    .filter((group) => !group.tier || group.tier === 'unassigned')
    .reduce((sum, group) => sum + group.rows.length, 0),
)
const filteredGroups = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return props.groups
    .filter(
      (group) =>
        (activeTier.value === 'all' || (group.tier ?? 'unassigned') === activeTier.value) &&
        (activeCollection.value === 'all' || group.name === activeCollection.value),
    )
    .map((group) => ({
      ...group,
      rows: group.rows.filter(
        (row) =>
          (activeType.value === 'all' || row.category === activeType.value) &&
          (!needle ||
            [
              row.address,
              row.description,
              visualRole(row),
              ...row.cells.flatMap((cell) => [
                authoredText(cell),
                literalText(cell.resolved),
                ...cell.chain,
              ]),
            ]
              .join(' ')
              .toLowerCase()
              .includes(needle)),
      ),
    }))
    .filter((group) => group.rows.length || (!needle && activeType.value === 'all'))
})
const visibleCount = computed(() =>
  filteredGroups.value.reduce((sum, group) => sum + group.rows.length, 0),
)
const hasFilters = computed(
  () =>
    query.value !== '' ||
    activeTier.value !== 'all' ||
    activeType.value !== 'all' ||
    activeCollection.value !== 'all',
)
function resetFilters(): void {
  query.value = ''
  activeTier.value = 'all'
  activeType.value = 'all'
  activeCollection.value = 'all'
}
function tierCount(tier: TokenTier): number {
  return props.groups
    .filter((group) => group.tier === tier)
    .reduce((sum, group) => sum + group.rows.length, 0)
}

const editing = shallowRef<{ row: TokenRow; mode: string } | null>(null)
const draft = ref('')
const draftUnit = ref<LengthUnit>('px')
/** The one cell whose shared token picker is open, if any. */
const binding = shallowRef<{ row: TokenRow; cell: TokenCell; trigger: Element } | null>(null)
const inputError = ref('')
const pickerAnchor = ref({ left: '0px', top: '0px' })
const picking = shallowRef<{ row: TokenRow; mode: string; color: Rgba } | null>(null)
const editorEl = ref<HTMLInputElement | null>(null)

const aliasOptions = computed(() => {
  const editor = binding.value
  return editor ? props.aliasOptionsFor(editor.row.type, editor.row.address, editor.cell.mode) : []
})

function openBinding(row: TokenRow, cell: TokenCell, event: Event): void {
  const trigger = event.currentTarget as Element
  const same = binding.value?.trigger === trigger
  editing.value = null
  picking.value = null
  binding.value = same ? null : { row, cell, trigger }
}

function detach(row: TokenRow, cell: TokenCell): void {
  if (cell.resolved === null || cell.broken !== undefined) return
  binding.value = null
  emit('edit', { row, mode: cell.mode, value: cell.resolved })
}

function beginEdit(row: TokenRow, cell: TokenCell, event?: Event): void {
  const bounds = (event?.currentTarget as HTMLElement | undefined)?.getBoundingClientRect()
  binding.value = null
  inputError.value = ''
  picking.value = null
  editing.value = null
  if (row.type === 'BOOLEAN') {
    // The literal boolean control toggles in one click; aliases use the picker.
    emit('edit', { row, mode: cell.mode, value: !(cell.resolved === true) })
    return
  }
  if (row.type === 'COLOR' && !cellAliased(cell)) {
    pickerAnchor.value = {
      left: `${Math.max(8, Math.min(bounds?.left ?? 0, window.innerWidth - 212))}px`,
      top: `${bounds?.bottom ?? 0}px`,
    }
    picking.value = {
      row,
      mode: cell.mode,
      color: isColor(cell.resolved) ? cell.resolved : { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    }
    return
  }
  editing.value = { row, mode: cell.mode }
  const length = row.type === 'FLOAT' ? parseLength(cell.authored) : null
  draftUnit.value = length?.unit ?? 'px'
  draft.value = length ? String(length.value) : authoredText(cell)
  void nextTick(() => editorEl.value?.select())
}

function cellAliased(cell: TokenCell): boolean {
  return cell.chain.length > 0
}

function authoredText(cell: TokenCell): string {
  if (typeof cell.authored === 'string') return cell.authored
  return cell.authored === null ? '' : JSON.stringify(cell.authored)
}

function commitText(): void {
  const editor = editing.value
  if (!editor) return
  const text = editor.row.type === 'STRING' ? draft.value : draft.value.trim()
  if (text === '' && editor.row.type !== 'STRING') {
    inputError.value = 'Enter a number.'
    return
  }
  if (
    editor.row.type === 'FLOAT' &&
    !text.startsWith('{') &&
    !isUnitLength(text) &&
    !Number.isFinite(Number(text))
  ) {
    inputError.value = 'Enter a valid number.'
    return
  }
  editing.value = null
  inputError.value = ''
  const value: JsonValue = text.startsWith('{')
    ? text
    : editor.row.type === 'FLOAT'
      ? isUnitLength(text)
        ? text
        : hasLengthUnit(editor.row)
          ? writeLength(Number(text), draftUnit.value)
          : Number(text)
      : text
  const payload: TokenEditIntent = { row: editor.row, mode: editor.mode, value }
  const cell = editor.row.cells.find((item) => item.mode === editor.mode)
  if (JSON.stringify(cell?.authored) !== JSON.stringify(value)) emit('edit', payload)
}

function changeDraftUnit(unit: LengthUnit): void {
  const raw = draft.value.trim()
  if (!isUnitLength(raw) && !Number.isFinite(Number(raw))) return
  const value = convertLength(
    isUnitLength(raw) ? raw : writeLength(Number(raw), draftUnit.value),
    unit,
    props.rootFontSize ?? 16,
  )
  if (value === null) return
  draftUnit.value = unit
  draft.value = String(parseLength(value)!.value)
  void nextTick(() => editorEl.value?.focus())
}

function commitEditOutside(event: FocusEvent): void {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null))
    commitText()
}

function chooseAlias(address: string): void {
  const editor = binding.value
  if (!editor) return
  binding.value = null
  if (editor.cell.authored !== `{${address}}`)
    emit('edit', { row: editor.row, mode: editor.cell.mode, value: `{${address}}` })
}

function commitColor(color: Rgba): void {
  const pick = picking.value
  if (!pick) return
  picking.value = null
  emit('edit', {
    row: pick.row,
    mode: pick.mode,
    value: { r: color.r, g: color.g, b: color.b, a: color.a },
  })
}

function isEditing(row: TokenRow, cell: TokenCell): boolean {
  return editing.value?.row.address === row.address && editing.value.mode === cell.mode
}

function categories(group: CollectionGroup): [string, TokenRow[]][] {
  const byCategory = new Map<string, TokenRow[]>()
  for (const row of group.rows) {
    const list = byCategory.get(row.category)
    if (list) list.push(row)
    else byCategory.set(row.category, [row])
  }
  return [...byCategory]
}

function isColor(value: JsonValue | null): value is { r: number; g: number; b: number; a: number } {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as { r?: unknown }).r === 'number'
  )
}

function css(color: { r: number; g: number; b: number; a: number }): string {
  const to255 = (c: number) => Math.round(c * 255)
  return `rgba(${to255(color.r)}, ${to255(color.g)}, ${to255(color.b)}, ${color.a})`
}

function literalText(value: JsonValue | null): string {
  if (value === null) return ''
  if (isColor(value)) {
    const hex = (c: number) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, '0')
    return `#${hex(value.r)}${hex(value.g)}${hex(value.b)}${value.a < 1 ? hex(value.a) : ''}`
  }
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function selected(row: TokenRow): boolean {
  return props.selection.includes(row.address)
}

function chainText(cell: TokenCell): string {
  return cell.chain.map((hop) => `→ ${hop}`).join(' ')
}
</script>

<template>
  <div ref="paneEl" class="tokens-pane" @scroll.capture="picking = null">
    <div class="tokens-content">
      <header class="page-heading">
        <div>
          <div class="eyebrow">DESIGN SYSTEM / FOUNDATIONS</div>
          <h1>
            Design tokens <span>{{ allRows.length }}</span>
          </h1>
          <p>The values behind your visual language. Organized by purpose, understood by type.</p>
        </div>
      </header>

      <section class="architecture" aria-label="Token tiers">
        <div class="section-label">
          <span>ONE SYSTEM, THREE TIERS</span
          ><span>Raw value <i>→</i> Shared meaning <i>→</i> Specific use</span>
        </div>
        <div class="tier-grid">
          <button
            v-for="tier in TOKEN_TIERS"
            :key="tier.id"
            type="button"
            class="tier-card"
            :class="{ active: activeTier === tier.id }"
            :data-tier="tier.id"
            :aria-pressed="activeTier === tier.id"
            @click="activeTier = activeTier === tier.id ? 'all' : tier.id"
          >
            <span class="tier-top"
              ><span class="tier-number">{{ tier.number }}</span
              ><strong>{{ tier.label }}</strong
              ><span class="tier-count">{{ tierCount(tier.id) }}</span></span
            >
            <span class="tier-title">{{ tier.title }}</span>
            <span class="tier-description">{{ tier.description }}</span>
            <span class="tier-example"><span>e.g.</span> {{ tier.example }}</span>
          </button>
        </div>
      </section>

      <section class="token-library" aria-label="Token library">
        <div class="library-heading">
          <h2>Token library</h2>
          <span>A tier explains why. A type shows what changes.</span>
        </div>
        <div class="type-filters" aria-label="Filter by visual type">
          <button
            type="button"
            :class="{ active: activeType === 'all' }"
            :aria-pressed="activeType === 'all'"
            @click="activeType = 'all'"
          >
            All types <span>{{ allRows.length }}</span>
          </button>
          <button
            v-for="type in typeOptions"
            :key="type.id"
            type="button"
            :data-type-filter="type.id"
            :class="{ active: activeType === type.id }"
            :aria-pressed="activeType === type.id"
            :title="type.description"
            @click="activeType = type.id"
          >
            <i>{{ type.glyph }}</i
            >{{ type.label }} <span>{{ type.count }}</span>
          </button>
        </div>
        <div ref="toolbarEl" class="library-toolbar">
          <label class="search"
            ><svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="8.5" cy="8.5" r="5.5" />
              <path d="m13 13 4 4" /></svg
            ><input
              v-model="query"
              type="search"
              aria-label="Search tokens"
              placeholder="Search names, values, or purpose…"
          /></label>
          <select v-model="activeCollection" aria-label="Filter by collection">
            <option value="all">All collections</option>
            <option v-for="group in groups" :key="group.name" :value="group.name">
              {{ group.name }}
            </option>
          </select>
          <select v-model="activeTier" aria-label="Filter by tier">
            <option value="all">All tiers</option>
            <option v-for="tier in TOKEN_TIERS" :key="tier.id" :value="tier.id">
              {{ tier.label }}
            </option>
            <option v-if="unassignedCount" value="unassigned">
              No tier assigned ({{ unassignedCount }})
            </option>
          </select>
          <button v-if="hasFilters" type="button" class="clear-filters" @click="resetFilters">
            Clear
          </button>
          <button
            v-if="canCreateCollections"
            class="add root"
            type="button"
            @click="emit('add-collection')"
          >
            + New collection
          </button>
        </div>
        <div class="results-line" role="status">
          <span
            >{{ visibleCount }} of {{ allRows.length }} tokens
            <span v-if="activeType !== 'all'"
              >· {{ TOKEN_TYPES[activeType].description }}</span
            ></span
          ><span>Click a value to edit <kbd>↵</kbd> save</span>
        </div>

        <section
          v-for="group in filteredGroups"
          :key="group.name"
          class="collection"
          :class="{ 'just-created': createdCollection === group.name }"
          :data-collection="group.name"
        >
          <header class="collection-heading">
            <h3>{{ group.name }}</h3>
            <span v-if="createdCollection === group.name" class="created-label" role="status">
              Collection created
            </span>
            <span class="tier-badge" :data-tier="group.tier ?? 'unassigned'">{{
              tierLabel(group.tier)
            }}</span
            ><span class="collection-count">{{ group.rows.length }} tokens</span
            ><button
              class="add"
              type="button"
              :aria-label="`Add token to ${group.name}`"
              @click="emit('add-token', group.name)"
            >
              {{ group.rows.length ? '+ New token' : '+ Add first token' }}
            </button>
            <button
              v-if="canCreateCollections"
              class="remove-collection"
              type="button"
              :aria-label="`Remove collection ${group.name}`"
              title="Remove collection"
              @click="emit('remove-collection', group.name)"
            >
              <FieldIcon name="trash" />
            </button>
          </header>
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th class="name">Token</th>
                  <th class="purpose">Visual type / role</th>
                  <th v-for="mode in group.modes" :key="mode" class="value">
                    {{ group.modes.length > 1 ? mode : 'Value' }}
                  </th>
                  <th class="usage">Uses</th>
                  <th class="row-actions" aria-label="Details" />
                </tr>
              </thead>
              <tbody v-for="[category, rows] in categories(group)" :key="category">
                <tr class="category">
                  <td :colspan="4 + group.modes.length">
                    <span>{{ TOKEN_TYPES[category as TokenCategory].glyph }}</span>
                    {{ TOKEN_TYPES[category as TokenCategory].label }}
                    <span class="category-count">{{ rows.length }}</span>
                  </td>
                </tr>
                <tr
                  v-for="row in rows"
                  :key="row.address"
                  :data-row="row.address"
                  :class="{ selected: selected(row), deprecated: row.deprecated }"
                  :aria-selected="selected(row)"
                >
                  <td class="name">
                    <span class="token-name" :title="row.address">{{ row.name }}</span>
                    <span v-if="row.deprecated" class="badge">deprecated</span
                    ><span v-if="row.description" class="token-description">{{
                      row.description
                    }}</span>
                  </td>
                  <td class="purpose">
                    <div class="visual-role">
                      <TokenSpecimen :row="row" :root-font-size="rootFontSize" />
                      <div
                        :title="
                          row.inferredScopes
                            ? 'Visual type inferred from the collection or its aliases; no scope is declared.'
                            : row.scopes.join(', ')
                        "
                      >
                        <strong
                          >{{ TOKEN_TYPES[row.category].label
                          }}<small v-if="row.inferredScopes" class="inferred"
                            >inferred</small
                          ></strong
                        ><span>{{ visualRole(row) }}</span>
                      </div>
                    </div>
                  </td>
                  <td
                    v-for="cell in row.cells"
                    :key="cell.mode"
                    class="value"
                    :data-address="row.address"
                    :data-mode="cell.mode"
                  >
                    <div class="value-field">
                      <template v-if="cellAliased(cell)">
                        <button
                          class="binding-trigger"
                          type="button"
                          data-popup-trigger
                          :aria-label="`Change token for ${row.name}, ${cell.mode}`"
                          :aria-expanded="
                            binding?.row.address === row.address && binding.cell.mode === cell.mode
                          "
                          :title="chainText(cell)"
                          @click="openBinding(row, cell, $event)"
                        >
                          <FieldIcon name="variable" /><span class="chain">{{
                            cell.chain[0]?.split('#').pop()
                          }}</span>
                        </button>
                        <button
                          class="value-action detach-token"
                          type="button"
                          :aria-label="`Detach token from ${row.name}, ${cell.mode}`"
                          :title="`Use ${literalText(cell.resolved)} as a literal value`"
                          :disabled="cell.resolved === null || cell.broken !== undefined"
                          @click="detach(row, cell)"
                        >
                          <FieldIcon name="unlink-property" />
                        </button>
                      </template>
                      <template v-else>
                        <span
                          v-if="isEditing(row, cell)"
                          class="value-editor"
                          :class="{ invalid: inputError }"
                          @focusout="commitEditOutside"
                        >
                          <input
                            :ref="(el) => (editorEl = el as HTMLInputElement | null)"
                            v-model="draft"
                            :aria-label="`Edit ${row.name}, ${cell.mode}`"
                            :aria-invalid="!!inputError"
                            :title="inputError || 'Enter to save · Escape to cancel'"
                            @input="inputError = ''"
                            @keydown.enter.prevent="commitText"
                            @keydown.escape.stop.prevent="editing = null"
                          />
                          <LengthUnitSelect
                            v-if="hasLengthUnit(row) && !draft.startsWith('{')"
                            :unit="parseLength(draft)?.unit ?? draftUnit"
                            :label="row.name"
                            @change="changeDraftUnit"
                          />
                          <button
                            class="save-value"
                            type="button"
                            :aria-label="`Save ${row.name}, ${cell.mode}`"
                            title="Save value"
                            @click="commitText"
                          >
                            ✓
                          </button>
                        </span>
                        <button
                          v-else
                          class="value-trigger"
                          type="button"
                          :class="{ 'boolean-value': row.type === 'BOOLEAN' }"
                          :aria-label="`${row.type === 'BOOLEAN' ? 'Toggle' : 'Edit'} ${row.name}, ${cell.mode}`"
                          :title="`${literalText(cell.resolved)} · Click to ${row.type === 'BOOLEAN' ? 'toggle' : 'edit'}`"
                          @click="beginEdit(row, cell, $event)"
                        >
                          <span
                            v-if="isColor(cell.resolved)"
                            class="swatch"
                            :style="{ background: css(cell.resolved) }"
                          />
                          <span
                            v-if="row.type === 'BOOLEAN'"
                            class="boolean-dot"
                            :class="{ on: cell.resolved === true }"
                          />
                          <span class="literal"
                            >{{ literalText(cell.resolved) || 'Empty text'
                            }}<span
                              v-if="hasLengthUnit(row) && typeof cell.resolved === 'number'"
                              class="unit-label"
                            >
                              px</span
                            ></span
                          >
                          <svg
                            v-if="row.type !== 'BOOLEAN'"
                            class="edit-affordance"
                            viewBox="0 0 12 12"
                            fill="none"
                            aria-hidden="true"
                          >
                            <path d="m8 2 2 2-6 6H2V8zM7 3l2 2" />
                          </svg>
                        </button>
                        <button
                          class="value-action choose-token"
                          type="button"
                          data-popup-trigger
                          :aria-label="`Apply token to ${row.name}, ${cell.mode}`"
                          title="Apply token"
                          :aria-expanded="
                            binding?.row.address === row.address && binding.cell.mode === cell.mode
                          "
                          @pointerdown.prevent
                          @click="openBinding(row, cell, $event)"
                        >
                          <FieldIcon name="variables-grid" />
                        </button>
                      </template>
                    </div>
                    <span v-if="isEditing(row, cell) && inputError" class="finding" role="alert">{{
                      inputError
                    }}</span>
                    <span v-else-if="cell.broken !== undefined" class="finding">{{
                      cell.broken
                    }}</span>
                    <span v-else-if="cellAliased(cell)" class="resolved-value">
                      <span
                        v-if="isColor(cell.resolved)"
                        class="swatch"
                        :style="{ background: css(cell.resolved) }"
                      />
                      {{ literalText(cell.resolved) }}
                    </span>
                  </td>
                  <td class="usage" :title="`${row.dependents} references to this token`">
                    {{ row.dependents }}
                  </td>
                  <td class="row-actions">
                    <button
                      class="token-details-button"
                      type="button"
                      :aria-label="`Open details for ${row.name}`"
                      :aria-expanded="selected(row)"
                      @click="emit('select', row.address)"
                    >
                      Details
                      <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
                        <path d="m4 2 4 4-4 4" />
                      </svg>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="!group.rows.length" class="empty-collection">
            This collection is ready for its first token.
          </p>
        </section>
        <div v-if="groups.length === 0 || (visibleCount === 0 && hasFilters)" class="empty">
          <span class="empty-mark">◇</span>
          <h3>{{ groups.length ? 'No matching tokens' : 'Your foundations start here' }}</h3>
          <p>
            {{
              groups.length
                ? 'Try another name, type, collection, or tier.'
                : canCreateCollections
                  ? 'Create a collection to bring your design decisions together.'
                  : 'No tokens are used on this page yet.'
            }}
          </p>
          <button v-if="hasFilters" type="button" class="add" @click="resetFilters">
            Clear filters
          </button>
        </div>
      </section>
    </div>
  </div>
  <Teleport to="body">
    <AssignPopup
      v-if="binding"
      :candidates="null"
      :component-name="null"
      :variables="aliasOptions"
      :bound-to="binding.cell.chain[0] ?? null"
      :trigger="binding.trigger"
      icon="variable"
      @variable="chooseAlias"
      @close="binding = null"
    />
    <div v-if="picking" class="token-picker-anchor" :style="pickerAnchor">
      <ColorPickerDialog
        :color="picking.color"
        :opacity="1"
        :swatches="[]"
        :editable="true"
        @commit="commitColor"
        @close="picking = null"
      />
    </div>
  </Teleport>
</template>

<style scoped>
.tokens-pane {
  position: relative;
  height: 100%;
  min-height: 0;
  min-width: 0;
  flex: 1;
  overflow: auto;
  overscroll-behavior-y: contain;
  background: var(--bg);
  container-type: inline-size;
}
.tokens-content {
  max-width: 1600px;
  padding: 26px 36px 60px;
  margin: 0 auto;
}
button,
select,
input {
  font: inherit;
}
button {
  cursor: pointer;
}
button:focus-visible,
select:focus-visible,
input:focus-visible,
td.value:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
.page-heading {
  display: flex;
  gap: 20px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}
.eyebrow,
.section-label {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.1em;
  color: var(--text-faint);
}
h1 {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 13px 0 10px;
  font-size: 27px;
  line-height: 1.2;
  font-weight: 600;
  letter-spacing: -0.8px;
}
h1 > span {
  border: 1px solid var(--line);
  padding: 2px 7px;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
  letter-spacing: 0;
  color: var(--text-faint);
}
.page-heading p {
  margin: 0;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.6;
}
.add {
  flex: none;
  border: 1px solid var(--line);
  border-radius: 5px;
  color: var(--text-dim);
  background: var(--panel);
  font-size: 11px;
  padding: 6px 10px;
  white-space: nowrap;
}
.add:hover {
  color: var(--text);
  border-color: var(--text-faint);
}
.add.root {
  color: var(--text);
  padding: 9px 12px;
}
.architecture {
  margin-bottom: 24px;
}
.section-label {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}
.section-label > span:last-child {
  letter-spacing: 0;
  font-size: 11px;
  font-weight: 400;
}
.section-label i {
  font-style: normal;
  margin: 0 9px;
  color: var(--text-faint);
}
.tier-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.tier-card {
  --tier-color: var(--text-dim);
  text-align: left;
  display: flex;
  flex-direction: column;
  padding: 16px 17px 12px;
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  transition:
    border-color 0.12s,
    background 0.12s;
}
[data-tier='semantic'] {
  --tier-color: var(--bound);
}
[data-tier='component'] {
  --tier-color: var(--accent);
}
.tier-card:hover,
.tier-card.active {
  border-color: var(--tier-color);
  background: color-mix(in srgb, var(--tier-color) 6%, var(--panel));
}
.tier-top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tier-top strong {
  font-weight: 500;
  font-size: 12px;
}
.tier-number {
  display: grid;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--tier-color) 40%, transparent);
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: var(--tier-color);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.tier-count {
  margin-left: auto;
  color: var(--text-faint);
  font-size: 11px;
}
.tier-title {
  margin: 10px 0 5px;
  font-size: 13px;
  font-weight: 500;
}
.tier-description {
  display: block;
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.6;
  max-width: 290px;
  margin-bottom: 10px;
}
.tier-example {
  display: block;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  font:
    10px/1.6 ui-monospace,
    monospace;
  color: var(--text-dim);
}
.tier-example > span {
  color: var(--text-faint);
  margin-right: 5px;
  font-family: var(--ui-font);
}
.library-heading {
  display: flex;
  align-items: baseline;
  gap: 14px;
  margin-bottom: 17px;
}
h2 {
  font-size: 15px;
  font-weight: 500;
  margin: 0;
}
.library-heading > span {
  color: var(--text-faint);
  font-size: 11px;
}
.type-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 17px;
}
.type-filters button {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--text-dim);
  font-size: 11px;
}
.type-filters button:hover {
  background: var(--panel);
}
.type-filters button.active {
  color: var(--text);
  background: var(--raised);
  border-color: var(--line);
}
.type-filters button > span {
  color: var(--text-faint);
  font-size: 10px;
}
.type-filters i {
  font-style: normal;
  font-size: 13px;
  min-width: 14px;
  text-align: center;
}
.library-toolbar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  gap: 8px;
  padding: 10px 0;
  background: var(--bg);
  box-shadow: 0 1px 0 var(--line);
}
.search {
  display: flex;
  align-items: center;
  gap: 9px;
  flex: 1;
  min-width: 120px;
  border: 1px solid var(--line);
  background: var(--panel);
  border-radius: 5px;
  padding: 0 10px;
}
.search svg {
  width: 16px;
  height: 16px;
  flex: none;
  stroke: var(--text-faint);
  stroke-width: 1.4;
}
.search input {
  width: 100%;
  min-width: 0;
  padding: 9px 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 11px;
}
.search:focus-within {
  border-color: var(--accent);
}
.search input:focus {
  outline: none;
}
.search input::placeholder {
  color: var(--text-faint);
}
select {
  min-width: 115px;
  max-width: 190px;
  padding: 0 9px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--panel);
  color: var(--text-dim);
  font-size: 11px;
}
.clear-filters {
  border: 0;
  color: var(--text-dim);
  background: none;
}
.results-line {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin: 10px 0 14px;
  font-size: 10px;
  color: var(--text-faint);
  line-height: 1.6;
}
kbd {
  font: inherit;
  padding: 0 3px;
  margin-left: 4px;
  border: 1px solid var(--line);
  border-radius: 3px;
}
.collection {
  margin-bottom: 22px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--panel);
}
.collection.just-created {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 20%, transparent);
}
.created-label {
  color: var(--accent);
  font-size: 10px;
}
.collection-heading {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 13px 15px;
}
h3 {
  font-size: 12px;
  font-weight: 500;
  margin: 0;
}
.collection-heading .add {
  margin-left: auto;
  padding: 4px 8px;
  background: transparent;
}
.remove-collection {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  padding: 0;
  border-color: transparent;
  background: transparent;
  color: var(--text-faint);
}
.remove-collection:hover {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 8%, transparent);
  border-color: color-mix(in srgb, var(--danger) 20%, transparent);
}
.tier-badge {
  --tier-color: var(--text-dim);
  color: var(--tier-color);
  font-size: 9px;
  border: 1px solid color-mix(in srgb, var(--tier-color) 25%, transparent);
  background: color-mix(in srgb, var(--tier-color) 5%, transparent);
  border-radius: 4px;
  padding: 1px 5px;
  white-space: nowrap;
}
.tier-badge[data-tier='semantic'] {
  --tier-color: var(--bound);
}
.tier-badge[data-tier='component'] {
  --tier-color: var(--accent);
}
.collection-count {
  font-size: 10px;
  color: var(--text-faint);
}
.table-scroll {
  overflow-x: auto;
}
.token-picker-anchor {
  position: fixed;
  width: 200px;
  height: 0;
  z-index: 100;
}

table {
  border-collapse: collapse;
  width: 100%;
  font-size: 11px;
}
th {
  padding: 8px 15px;
  text-align: left;
  color: var(--text-faint);
  font-size: 10px;
  font-weight: 400;
  border-block: 1px solid var(--line);
  background: color-mix(in srgb, var(--bg) 55%, transparent);
}
td {
  padding: 12px 15px;
  border-top: 1px solid color-mix(in srgb, var(--line) 65%, transparent);
  vertical-align: middle;
}
tr.category td {
  padding: 6px 15px;
  color: var(--text-faint);
  font-size: 10px;
  background: color-mix(in srgb, var(--bg) 25%, transparent);
}
tr.category td > span:first-child {
  margin-right: 5px;
}
.category-count {
  margin-left: 5px;
  opacity: 0.7;
}
tbody tr:not(.category) {
  cursor: default;
}
tbody tr:not(.category):hover {
  background: var(--raised);
}
tr.selected,
tbody tr.selected:hover {
  background: color-mix(in srgb, var(--accent) 8%, var(--panel));
}
tr.selected td:first-child {
  box-shadow: inset 2px 0 var(--accent);
}
.name {
  min-width: 160px;
}
.token-name {
  color: var(--text);
  font-size: 11px;
  font-weight: 500;
  background: none;
  border: 0;
  text-align: left;
  padding: 0;
  overflow-wrap: anywhere;
}
.token-description {
  display: block;
  font-size: 10px;
  color: var(--text-faint);
  line-height: 1.5;
  max-width: 260px;
  margin-top: 4px;
}
tr.deprecated .token-name {
  text-decoration: line-through;
  color: var(--text-faint);
}
.badge {
  display: inline-block;
  border: 1px solid var(--line);
  border-radius: 3px;
  color: var(--text-faint);
  font-size: 9px;
  margin-left: 6px;
  padding: 0 4px;
}
.purpose {
  min-width: 200px;
}
.visual-role {
  display: flex;
  gap: 10px;
  align-items: center;
}
.visual-role :deep(.token-specimen) {
  width: 62px;
  height: 38px;
}
.visual-role > div {
  max-width: 170px;
}
.inferred {
  font-weight: 400;
  color: var(--text-faint);
  font-size: 8px;
  margin-left: 5px;
}
.visual-role strong {
  display: block;
  color: var(--text-dim);
  font-size: 10px;
  font-weight: 500;
}
.visual-role div > span {
  display: block;
  color: var(--text-faint);
  font-size: 10px;
  line-height: 1.5;
  margin-top: 2px;
}
.usage {
  text-align: right;
  font-variant-numeric: tabular-nums;
  width: 55px;
  color: var(--text-faint);
}
td.value {
  min-width: 186px;
  width: 190px;
  font-size: 11px;
}
.value-field {
  display: flex;
  align-items: center;
  gap: 3px;
  width: 156px;
}
.value-trigger,
.binding-trigger,
.value-editor {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 128px;
  height: 28px;
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--bg);
  color: var(--text-dim);
  font: inherit;
  text-align: left;
}
.value-trigger,
.binding-trigger {
  padding: 0 7px;
  cursor: pointer;
}
.value-trigger:hover {
  border-color: var(--text-faint);
  background: var(--raised);
}
.literal,
.chain {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  font:
    10px/1.6 ui-monospace,
    monospace;
}
.literal {
  flex: 1;
}
.unit-label {
  color: var(--text-faint);
}
.edit-affordance {
  width: 11px;
  height: 11px;
  flex: none;
  stroke: var(--text-faint);
  stroke-width: 1.1;
}
.value-editor {
  gap: 0;
  border-color: var(--accent);
}
.value-editor input {
  width: 0;
  min-width: 0;
  flex: 1;
  padding: 0 7px;
  height: 100%;
  border: 0;
  outline: none;
  background: none;
  color: var(--text);
  font:
    11px ui-monospace,
    monospace;
}
.value-editor input:focus-visible {
  outline: none;
}
.value-editor.invalid {
  border-color: var(--warn);
}
.value-action,
.save-value {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 25px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
}
.value-action:hover,
.save-value:hover {
  background: var(--raised);
  color: var(--text);
}
.save-value {
  width: 22px;
  height: 24px;
  color: var(--accent);
}
.value-action:disabled {
  opacity: 0.35;
  cursor: default;
}
.binding-trigger {
  color: var(--bound);
  border-color: color-mix(in srgb, var(--bound) 25%, var(--line));
  background: color-mix(in srgb, var(--bound) 10%, var(--bg));
}
.binding-trigger:hover {
  border-color: var(--bound);
}
.binding-trigger :deep(svg) {
  flex: none;
}
.resolved-value {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 7px 0;
  color: var(--text-faint);
  font:
    10px/1.5 ui-monospace,
    monospace;
}
.swatch {
  display: inline-block;
  flex: none;
  width: 14px;
  height: 14px;
  border: 1px solid color-mix(in srgb, var(--text) 15%, transparent);
  border-radius: 3px;
}
.resolved-value .swatch {
  width: 10px;
  height: 10px;
}
.boolean-dot {
  width: 16px;
  height: 9px;
  border-radius: 8px;
  background: var(--raised);
  border: 1px solid var(--text-faint);
}
.boolean-dot.on {
  background: var(--accent);
  border-color: var(--accent);
}
.finding {
  display: block;
  max-width: 156px;
  font-size: 10px;
  line-height: 1.5;
  color: var(--warn);
  margin-top: 4px;
  overflow-wrap: anywhere;
}
.row-actions {
  width: 80px;
  text-align: right;
}
.token-details-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 7px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  color: var(--text-faint);
  font-size: 10px;
  cursor: pointer;
}
.token-details-button:hover,
.token-details-button[aria-expanded='true'] {
  color: var(--text);
  background: var(--raised);
  border-color: var(--line);
}
.token-details-button svg {
  width: 10px;
  height: 10px;
  stroke: currentColor;
  stroke-width: 1.2;
}
.empty {
  text-align: center;
  padding: 45px 15px;
  border: 1px dashed var(--line);
  border-radius: 8px;
  color: var(--text-faint);
}
.empty-mark {
  font-size: 28px;
  display: block;
  margin-bottom: 10px;
}
.empty h3 {
  color: var(--text-dim);
  font-size: 14px;
}
.empty p {
  margin: 10px 0 18px;
}
.empty-collection {
  padding: 0 15px 12px;
  color: var(--text-faint);
}
@container (max-width: 900px) {
  .tokens-content {
    padding: 26px 22px 44px;
  }
  .tier-card {
    padding: 13px;
  }
  .results-line > span:last-child {
    display: none;
  }
  .purpose {
    min-width: 175px;
  }
  .visual-role {
    gap: 7px;
  }
  .visual-role :deep(.token-specimen) {
    width: 48px;
  }
  .collection-count {
    display: none;
  }
}
@container (max-width: 640px) {
  .tokens-content {
    padding: 22px 16px;
  }
  .page-heading {
    align-items: flex-start;
  }
  h1 {
    font-size: 23px;
  }
  .section-label > span:last-child {
    display: none;
  }
  .tier-grid {
    grid-template-columns: 1fr;
    gap: 6px;
  }
  .tier-card {
    display: grid;
    grid-template-columns: 150px 1fr;
    gap: 4px 12px;
  }
  .tier-top {
    grid-row: span 2;
  }
  .tier-title {
    margin: 0;
    font-size: 11px;
  }
  .tier-description {
    font-size: 10px;
    margin: 0;
    max-width: none;
  }
  .tier-example {
    display: none;
  }
  .library-heading {
    display: block;
  }
  .library-heading > span {
    display: block;
    margin-top: 6px;
  }
  .library-toolbar {
    flex-wrap: wrap;
  }
  .search {
    flex-basis: 100%;
  }
  select {
    flex: 1;
    max-width: none;
    padding: 7px;
  }
}
</style>
