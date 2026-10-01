<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { FieldSpec, JsonValue, ModelSpec, UidxPatch } from '@uidx/format'
import {
  addItem,
  addModel,
  fieldWith,
  itemFields,
  itemsOf,
  removeItem,
  setItemCell,
  isIdentifier,
  newField,
  parseSample,
  removeField,
  removeModel,
  setModelDescription,
  setField,
  PLACEHOLDER,
  type ModelCard,
} from './model-edits'

/**
 * The Models face (ADR 0015 §1): what each component receives, declared once
 * and edited here — a description, and a table of fields with their type,
 * key, optional, sample and words.
 *
 * Beside Tokens because it is the same kind of thing: shared declarations
 * the pages reference by name, gathered from every page and written back to
 * the one that declares each. The canvas draws a repeat from a model's
 * samples, so a sample changed here redraws every row that shows it, the
 * way a token changed on the Tokens face repaints every use.
 */
const props = defineProps<{
  cards: readonly ModelCard[]
  /** Models the contracts name and nobody declares yet, with the page naming each. */
  undeclared: readonly { name: string; file: string }[]
  /** Pages a new model may be declared on, the suggestion first. */
  pages: readonly { file: string; label: string; suggested: boolean }[]
  /** A model to scroll to and mark, when the author came from a repeat's row. */
  focus?: string | null
  writable: boolean
}>()

const emit = defineEmits<{
  /** Patches for one page, which the shell dispatches to that file. */
  edit: [file: string, patches: UidxPatch[]]
  /** Jump to a page, and to a component on it when named. */
  open: [file: string, component?: string]
  /** Renames that carry every type or binding naming them, across pages. */
  renameModel: [from: string, to: string]
  renameField: [model: string, from: string, to: string]
}>()

const renamingModel = ref<string | null>(null)
function commitModelName(card: ModelCard, event: Event): void {
  if (renamingModel.value !== card.name) return
  renamingModel.value = null
  const name = (event.target as HTMLInputElement).value.trim()
  if (name && name !== card.name) emit('renameModel', card.name, name)
}

const paneEl = ref<HTMLDivElement | null>(null)
const newName = ref('')
const newPage = ref('')
watch(
  () => props.pages,
  (pages) => {
    if (!pages.some((page) => page.file === newPage.value))
      newPage.value = pages.find((page) => page.suggested)?.file ?? pages[0]?.file ?? ''
  },
  { immediate: true },
)

const canAdd = computed(
  () =>
    props.writable &&
    isIdentifier(newName.value.trim()) &&
    newPage.value !== '' &&
    !props.cards.some((card) => card.name === newName.value.trim()),
)

function add(): void {
  if (!canAdd.value) return
  emit('edit', newPage.value, addModel(newName.value))
  newName.value = ''
}

/** Declare a model a contract already names, on the page that names it. */
function declare(entry: { name: string; file: string }): void {
  const file = props.pages.find((page) => page.suggested)?.file ?? entry.file
  emit('edit', file, addModel(entry.name))
}

const send = (card: ModelCard, patches: UidxPatch[]): void => {
  if (patches.length) emit('edit', card.file, patches)
}

function describe(card: ModelCard, text: string): void {
  send(card, setModelDescription(card.name, text))
}

function change(card: ModelCard, field: FieldSpec, next: Parameters<typeof fieldWith>[1]): void {
  send(card, setField(card.name, field.name, fieldWith(field, next)))
}

/** A rename keeps the field's place and carries the `{item.field}` bindings that read it. */
function rename(card: ModelCard, field: FieldSpec, to: string): void {
  const name = to.trim()
  if (name === field.name || !isIdentifier(name) || card.fields.some((f) => f.name === name)) return
  emit('renameField', card.name, field.name, name)
}

const isPlaceholder = (text: string): boolean => text.startsWith(PLACEHOLDER)

/**
 * Which half of a model is open: its items (the content a repeat draws) or
 * its fields (the shape every item has). Items first once there are fields,
 * since filling in content is the everyday task; a new model starts on fields.
 */
const tabs = ref<Record<string, 'items' | 'fields'>>({})
const tabOf = (card: ModelCard): 'items' | 'fields' =>
  tabs.value[card.name] ?? (card.fields.length ? 'items' : 'fields')

const specOf = (card: ModelCard): ModelSpec => ({
  name: card.name,
  description: card.description,
  fields: card.fields,
  loc: { start: 0, end: 0 },
})

/** A cell as the input shows it: text as is, anything else as JSON, absent as empty. */
const showCell = (value: JsonValue | undefined): string =>
  value === undefined || value === null
    ? ''
    : typeof value === 'string'
      ? value
      : JSON.stringify(value)

/** A cell as typed, by its field's type: a number for a number, text otherwise. */
function readCell(field: FieldSpec, text: string): JsonValue {
  const type = field.type.trim()
  if (type === 'number') {
    const number = Number(text)
    return text.trim() === '' || Number.isNaN(number) ? null : number
  }
  if (type === 'string' || type === 'image' || type === 'date') return text
  return parseSample(text) ?? null
}

function cell(card: ModelCard, field: FieldSpec, index: number, value: JsonValue): void {
  send(card, setItemCell(specOf(card), field.name, index, value))
}

/* --------------------------------------------------- arriving at a model */
const marked = ref<string | null>(null)
watch(
  () => props.focus,
  async (name) => {
    marked.value = name ?? null
    if (!name) return
    await nextTick()
    const pane = paneEl.value
    const card = pane?.querySelector<HTMLElement>(`[data-model="${CSS.escape(name)}"]`)
    if (pane && card)
      pane.scrollTo({
        top:
          pane.scrollTop + card.getBoundingClientRect().top - pane.getBoundingClientRect().top - 16,
      })
  },
  { immediate: true },
)
</script>

<template>
  <div ref="paneEl" class="models-pane">
    <div class="models-content">
      <header class="page-heading">
        <div>
          <div class="eyebrow">DESIGN SYSTEM / DATA</div>
          <h1>
            Models <span>{{ cards.length }}</span>
          </h1>
          <p>
            The data your components show. A model has fields — the shape of one item — and items,
            its content. Repeat a layer for each item of a model, then bind its texts and component
            properties to the item's fields.
          </p>
        </div>
      </header>

      <section class="new-model" aria-label="New model">
        <input
          v-model="newName"
          class="text"
          :disabled="!writable"
          aria-label="Model name"
          placeholder="Contact"
          @keydown.enter="add"
        />
        <label class="on">
          <span>on</span>
          <select
            v-model="newPage"
            class="pick"
            :disabled="!writable"
            aria-label="Page to declare it on"
          >
            <option v-for="page in pages" :key="page.file" :value="page.file">
              {{ page.label }}{{ page.suggested ? ' · shared' : '' }}
            </option>
          </select>
        </label>
        <button type="button" class="add root" :disabled="!canAdd" @click="add">+ New model</button>
        <p class="hint">
          Keep a model on the page of the component that shows it, or on a page called
          <code>models</code> when several pages share it.
        </p>
      </section>

      <section
        v-if="undeclared.length"
        class="undeclared"
        aria-label="Models named but not declared"
      >
        <div class="section-label"><span>NAMED BY A CONTRACT, DECLARED NOWHERE</span></div>
        <div class="chips">
          <button
            v-for="entry in undeclared"
            :key="entry.name"
            type="button"
            class="chip"
            :disabled="!writable"
            :title="`Declare ${entry.name}`"
            @click="declare(entry)"
          >
            + {{ entry.name }} <span class="chip-file">{{ entry.file }}</span>
          </button>
        </div>
      </section>

      <p v-if="!cards.length" class="empty">
        No models yet. Name one above — a list of contacts is a <code>Contact</code> model — then
        add its fields and items, and repeat a layer over it.
      </p>

      <section
        v-for="card in cards"
        :key="`${card.file}:${card.name}`"
        class="model"
        :data-model="card.name"
        :data-on-page="card.onPage"
        :data-marked="marked === card.name"
        :aria-label="`Model ${card.name}`"
      >
        <header class="model-heading">
          <input
            v-if="renamingModel === card.name"
            class="model-rename"
            :value="card.name"
            :aria-label="`Rename model ${card.name}`"
            @keydown.enter="commitModelName(card, $event)"
            @keydown.escape="renamingModel = null"
            @blur="commitModelName(card, $event)"
          />
          <h2 v-else @dblclick="writable && (renamingModel = card.name)">{{ card.name }}</h2>
          <button
            v-if="writable && renamingModel !== card.name"
            type="button"
            class="rename-model"
            :aria-label="`Rename model ${card.name}`"
            title="Rename; every prop and field typed by it follows"
            @click="renamingModel = card.name"
          >
            ✎
          </button>
          <button
            type="button"
            class="where"
            :title="`Declared on ${card.file}; open the page`"
            @click="emit('open', card.file)"
          >
            {{ card.onPage ? 'this page' : card.file }}
          </button>
          <span class="grow" />
          <span v-if="card.usedBy.length" class="uses" aria-label="Used by">
            <button
              v-for="use in card.usedBy"
              :key="`${use.file}:${use.component}:${use.prop}`"
              type="button"
              class="chip"
              :title="`${use.component} receives ${use.list ? 'a list of ' : 'one '}${card.name} as ${use.prop}`"
              @click="emit('open', use.file, use.component)"
            >
              {{ use.component }}.{{ use.prop }}{{ use.list ? '[]' : '' }}
            </button>
          </span>
          <span v-else class="unused">Nothing receives it yet</span>
          <button
            type="button"
            class="remove"
            :disabled="!writable || card.usedBy.length > 0"
            :aria-label="`Remove model ${card.name}`"
            :title="
              card.usedBy.length
                ? 'A model a contract names stays; retype the prop first'
                : 'Remove the model and its fields'
            "
            @click="send(card, removeModel(card.name))"
          >
            ×
          </button>
        </header>
        <input
          class="text words"
          :value="isPlaceholder(card.description) ? '' : card.description"
          :placeholder="card.description || 'What one of these is.'"
          :data-draft="isPlaceholder(card.description)"
          :disabled="!writable"
          aria-label="Description"
          @change="describe(card, ($event.target as HTMLInputElement).value)"
        />
        <div class="tabs" role="tablist" :aria-label="`${card.name} content or shape`">
          <button
            type="button"
            role="tab"
            :aria-selected="tabOf(card) === 'items'"
            data-tab="items"
            @click="tabs[card.name] = 'items'"
          >
            Items <span class="count">{{ itemsOf(card).length }}</span>
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="tabOf(card) === 'fields'"
            data-tab="fields"
            @click="tabs[card.name] = 'fields'"
          >
            Fields <span class="count">{{ card.fields.length }}</span>
          </button>
        </div>

        <!--
          The content: one row per item, one column per field — what a list that
          repeats this model draws, row for row, on the canvas.
        -->
        <template v-if="tabOf(card) === 'items'">
          <p v-if="!itemFields(card).length" class="empty">
            Add fields first: an item is a value for each field.
            <button type="button" class="inline-link" @click="tabs[card.name] = 'fields'">
              Go to fields
            </button>
          </p>
          <div v-else class="table-scroll">
            <table class="items" :aria-label="`${card.name} items`">
              <thead>
                <tr>
                  <th class="index">#</th>
                  <th v-for="field in itemFields(card)" :key="field.name" :title="field.type">
                    {{ field.name }}
                  </th>
                  <th class="tools"><span class="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(item, index) in itemsOf(card)" :key="index" :data-item="index">
                  <td class="index">{{ index + 1 }}</td>
                  <td v-for="field in itemFields(card)" :key="field.name">
                    <input
                      v-if="field.type.trim() === 'boolean'"
                      type="checkbox"
                      :checked="item[field.name] === true"
                      :disabled="!writable"
                      :aria-label="`${field.name} of item ${index + 1}`"
                      @change="
                        cell(card, field, index, ($event.target as HTMLInputElement).checked)
                      "
                    />
                    <input
                      v-else
                      class="text cell"
                      :value="showCell(item[field.name])"
                      :disabled="!writable"
                      :aria-label="`${field.name} of item ${index + 1}`"
                      @change="
                        cell(
                          card,
                          field,
                          index,
                          readCell(field, ($event.target as HTMLInputElement).value),
                        )
                      "
                    />
                  </td>
                  <td class="tools">
                    <button
                      type="button"
                      class="remove"
                      :disabled="!writable"
                      :aria-label="`Remove item ${index + 1}`"
                      @click="send(card, removeItem(specOf(card), index))"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <button
            v-if="itemFields(card).length"
            type="button"
            class="add"
            :disabled="!writable"
            @click="send(card, addItem(specOf(card)))"
          >
            + Add item
          </button>
        </template>

        <div v-if="tabOf(card) === 'fields'" class="table-scroll">
          <table class="fields">
            <thead>
              <tr>
                <th>Field</th>
                <th>Type</th>
                <th class="flag" title="Keys the rows of a repeat">Key</th>
                <th class="flag" title="May be absent; a null sample shows that layout">
                  Optional
                </th>
                <th>Description</th>
                <th class="tools"><span class="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="field in card.fields" :key="field.name" :data-field="field.name">
                <td>
                  <input
                    class="text name"
                    :value="field.name"
                    :disabled="!writable"
                    aria-label="Field name"
                    @change="rename(card, field, ($event.target as HTMLInputElement).value)"
                  />
                </td>
                <td>
                  <input
                    class="text type"
                    :value="field.type"
                    :disabled="!writable"
                    aria-label="Type"
                    list="model-field-types"
                    @change="
                      change(card, field, {
                        type: ($event.target as HTMLInputElement).value.trim() || field.type,
                      })
                    "
                  />
                </td>
                <td class="flag">
                  <input
                    type="checkbox"
                    :checked="field.key"
                    :disabled="!writable"
                    aria-label="Key"
                    @change="
                      change(card, field, { key: ($event.target as HTMLInputElement).checked })
                    "
                  />
                </td>
                <td class="flag">
                  <input
                    type="checkbox"
                    :checked="field.optional"
                    :disabled="!writable"
                    aria-label="Optional"
                    @change="
                      change(card, field, { optional: ($event.target as HTMLInputElement).checked })
                    "
                  />
                </td>
                <td>
                  <input
                    class="text words"
                    :value="isPlaceholder(field.description) ? '' : field.description"
                    :placeholder="field.description"
                    :data-draft="isPlaceholder(field.description)"
                    :disabled="!writable"
                    aria-label="Field description"
                    @change="
                      change(card, field, {
                        description: ($event.target as HTMLInputElement).value.trim(),
                      })
                    "
                  />
                </td>
                <td class="tools">
                  <button
                    type="button"
                    class="remove"
                    :disabled="!writable"
                    :aria-label="`Remove field ${field.name}`"
                    @click="send(card, removeField(card.name, field.name))"
                  >
                    ×
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <button
          v-if="tabOf(card) === 'fields'"
          type="button"
          class="add"
          :disabled="!writable"
          @click="
            send(
              card,
              newField({
                name: card.name,
                description: card.description,
                fields: card.fields,
                loc: { start: 0, end: 0 },
              }),
            )
          "
        >
          + Add field
        </button>
      </section>
      <datalist id="model-field-types">
        <option value="string" />
        <option value="number" />
        <option value="boolean" />
        <option value="image" />
        <option value="date" />
        <option v-for="card in cards" :key="card.name" :value="card.name" />
        <option v-for="card in cards" :key="`${card.name}[]`" :value="`${card.name}[]`" />
      </datalist>
    </div>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 2px;
  margin: 10px 0 6px;
  border-bottom: 1px solid var(--line);
}
.tabs button {
  padding: 6px 10px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--text-dim);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}
.tabs button[aria-selected='true'] {
  border-bottom-color: var(--accent);
  color: var(--text);
}
.tabs .count {
  margin-left: 4px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.items th.index,
.items td.index {
  width: 32px;
  color: var(--text-faint);
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.items .cell {
  width: 100%;
  min-width: 120px;
}
.inline-link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
}
.rename-model {
  padding: 0 4px;
  font: inherit;
  color: var(--text-faint);
  background: none;
  border: 0;
  cursor: pointer;
}
.rename-model:hover {
  color: var(--text);
}
.model-rename {
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--accent);
  border-radius: 4px;
  padding: 1px 6px;
}
.models-pane {
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
.models-content {
  max-width: 1200px;
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
button:disabled {
  cursor: default;
  opacity: 0.5;
}
button:focus-visible,
select:focus-visible,
input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.page-heading {
  display: flex;
  gap: 20px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
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
.page-heading p,
.hint,
.empty {
  margin: 0;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.6;
}
code {
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 11px;
}
.new-model {
  display: grid;
  grid-template-columns: minmax(120px, 220px) auto auto;
  gap: 8px 10px;
  align-items: center;
  margin-bottom: 24px;
}
.new-model .hint {
  grid-column: 1 / -1;
}
.on {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-dim);
  font-size: 11px;
}
.text,
.pick {
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--panel);
  color: var(--text);
  font-size: 12px;
}
.text:disabled,
.pick:disabled {
  opacity: 0.6;
}
.text[data-draft='true'] {
  border-style: dashed;
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
.add:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-faint);
}
.add.root {
  color: var(--text);
  padding: 7px 12px;
}
.undeclared {
  margin-bottom: 24px;
}
.chips,
.uses {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.uses {
  margin-top: 0;
}
.chip {
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--panel);
  color: var(--text);
  font-size: 11px;
  padding: 3px 9px;
}
.chip:hover:not(:disabled) {
  border-color: var(--accent);
}
.chip-file {
  color: var(--text-faint);
  margin-left: 4px;
}
.model {
  margin-bottom: 20px;
  padding: 16px 18px 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
}
.model[data-marked='true'] {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
}
.model-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.model-heading h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.where {
  border: 0;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--raised);
  color: var(--text-dim);
  font-size: 10px;
}
.where:hover {
  color: var(--text);
}
.grow {
  flex: 1;
}
.unused {
  color: var(--text-faint);
  font-size: 11px;
}
.remove {
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--text-dim);
  font-size: 14px;
  line-height: 1;
}
.remove:hover:not(:disabled) {
  background: var(--raised);
  color: var(--text);
}
.words {
  width: 100%;
  margin-bottom: 10px;
}
.table-scroll {
  overflow-x: auto;
}
.fields,
.items {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.fields th,
.items th {
  padding: 4px 6px;
  text-align: left;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.06em;
  color: var(--text-faint);
  border-bottom: 1px solid var(--line);
}
.fields td,
.items td {
  padding: 4px 6px;
  vertical-align: middle;
}
.items tbody tr:hover {
  background: color-mix(in srgb, var(--raised) 50%, transparent);
}
.fields td .text {
  width: 100%;
}
.fields .name {
  min-width: 90px;
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 11px;
}
.fields .type {
  min-width: 90px;
}
.fields td.words,
.fields td .words {
  margin: 0;
  min-width: 180px;
}
.flag {
  width: 52px;
  text-align: center;
}
.tools {
  width: 28px;
}
.fields + .add,
.table-scroll + .add {
  margin-top: 8px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
