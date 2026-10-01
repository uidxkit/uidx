<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { UidxDocument, UidxNode, UidxPatch } from '@uidx/format'
import type { ModelIndex } from '@uidx/schema'
import { declare, moveRepeatOnto, PLACEHOLDER, setRepeat, setRepeatAs } from './contract-edits'
import { REPEAT_ICON } from './layer-icons'
import { itemNameFor } from './repeat-edits'
import { repeatView } from './repeat-view'

/**
 * Repeat, for any layer inside a component (ADR 0017 §2) — Builder's
 * "Repeat for each", Plasmic's "repeat element", Vue's `v-for`.
 *
 * The layer and everything in it becomes the template, drawn once per item:
 * texts bind to the item's fields, a nested component receives the item, and
 * a list field of the item repeats again inside. So besides choosing the list
 * the section says what the template can bind to, what in it already does,
 * and which repeats this layer is itself part of.
 */
const props = defineProps<{
  doc: UidxDocument | null
  node: UidxNode
  components?: ReadonlyMap<string, UidxNode>
  models?: ModelIndex
  writable: boolean
  /** Inside the Slot panel: the slot's own words, "Filled once" / "For each item". */
  forSlot?: boolean
}>()

const emit = defineEmits<{
  patches: [patches: UidxPatch[]]
  select: [address: string]
  openModel: [name: string]
}>()

const send = (patches: UidxPatch[]): void => {
  if (props.writable && patches.length) emit('patches', patches)
}

/**
 * A first repeat names its item so it hides nothing (`tag` inside a row of
 * `item`s, `entry` in a component whose prop is `item`); changing the list of
 * an existing repeat keeps the name the author has.
 */
function repeatOver(list: string): UidxPatch[] {
  const component = view.value?.component
  if (own.value || !component) return setRepeat(props.node, list)
  const as = itemNameFor(component, props.node, list)
  return [...setRepeat(props.node, list), ...(as === 'item' ? [] : setRepeatAs(props.node, as))]
}

const view = computed(() => repeatView(props.doc, props.node, props.components, props.models))
const own = computed(() => view.value?.own ?? null)
const nestedLists = computed(() => view.value?.lists.filter((list) => list.nested) ?? [])
const propLists = computed(() => view.value?.lists.filter((list) => !list.nested) ?? [])
const modelNames = computed(() => [...(props.models?.keys() ?? [])].sort())

/* -------------------------------------------- a new list, declared here */

const creating = ref(false)
const newName = ref('items')
const newModel = ref('')
watch(creating, (open) => {
  if (!open) return
  newModel.value = newModel.value || modelNames.value[0] || ''
  const taken = new Set((view.value?.component.spec?.contract?.props ?? []).map((p) => p.name))
  let name = 'items'
  for (let n = 2; taken.has(name); n++) name = `items${n}`
  newName.value = name
})
watch(
  () => props.node.address,
  () => (creating.value = false),
)

function chooseMode(mode: 'once' | 'each'): void {
  if (mode === 'once') {
    creating.value = false
    send(setRepeat(props.node, null))
    return
  }
  // The nearest list first: an enclosing item's list field before the
  // contract's own, so a layer inside a row walks the row (a tree).
  const first = view.value?.lists[0]
  if (first) send(repeatOver(first.list))
  else creating.value = true
}

function chooseList(value: string): void {
  if (value === ':new') creating.value = true
  else {
    creating.value = false
    send(repeatOver(value))
  }
}

function createList(): void {
  const name = newName.value.trim()
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !newModel.value) return
  send([
    ...declare('prop', name, {
      attrs: { type: `${newModel.value}[]` },
      description: `${PLACEHOLDER}the prop "${name}".`,
    }),
    ...repeatOver(name),
  ])
  creating.value = false
}

function repeatRowInstead(): void {
  const wraps = view.value?.wrapsOne
  if (!wraps || !props.doc) return
  const row = props.node.children.find((child) => child.address === wraps.address)
  if (!row) return
  send(moveRepeatOnto(props.node, row))
  emit('select', row.address)
}

const nestOffer = computed(() =>
  !own.value && view.value?.scope ? view.value.scope.fields.filter((field) => field.list) : [],
)
</script>

<template>
  <section
    v-if="view"
    class="repeat-section"
    aria-label="Repeat"
    data-field="repeat"
    :data-set="own !== null"
  >
    <header v-if="!forSlot" class="head">
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path :d="REPEAT_ICON" fill="none" stroke="currentColor" stroke-width="1" />
      </svg>
      <span class="title">Repeat</span>
      <span v-if="own" class="of">× {{ own.rows }}</span>
    </header>

    <!-- The templates this layer is already part of, outermost first. -->
    <p v-if="view.enclosing.length" class="context" data-field="inside-repeat">
      <template v-for="(outer, index) in view.enclosing" :key="outer.address">
        <span v-if="index > 0" class="sep">›</span>
        Part of
        <button type="button" class="link" @click="emit('select', outer.address)">
          {{ outer.name }}</button
        >, drawn for each <code>{{ outer.as }}</code
        ><template v-if="outer.model"> ({{ outer.model }})</template> of
        <code>{{ outer.list }}</code>
      </template>
    </p>

    <div class="segmented" role="radiogroup" :aria-label="`How often ${node.name} is drawn`">
      <button
        type="button"
        role="radio"
        :aria-checked="!own && !creating"
        :disabled="!writable"
        @click="chooseMode('once')"
      >
        {{ forSlot ? 'Filled once' : 'Once' }}
      </button>
      <button
        type="button"
        role="radio"
        :aria-checked="!!own || creating"
        :disabled="!writable"
        @click="chooseMode('each')"
      >
        For each item
      </button>
    </div>

    <template v-if="own || creating">
      <div class="row" data-field="list">
        <span class="label">List</span>
        <select
          class="field"
          :value="creating ? ':new' : (own?.list ?? '')"
          :disabled="!writable"
          aria-label="Repeat over"
          @change="chooseList(($event.target as HTMLSelectElement).value)"
        >
          <option
            v-if="own && !view.lists.some((entry) => entry.list === own!.list)"
            :value="own.list"
          >
            {{ own.list }} · not a list here
          </option>
          <optgroup v-if="nestedLists.length" label="From the item it is inside">
            <option v-for="entry in nestedLists" :key="entry.list" :value="entry.list">
              {{ entry.list }}{{ entry.type ? ` · ${entry.type}` : '' }}
            </option>
          </optgroup>
          <optgroup v-if="propLists.length" :label="`Properties of ${view.component.name}`">
            <option v-for="entry in propLists" :key="entry.list" :value="entry.list">
              {{ entry.list }}{{ entry.type ? ` · ${entry.type}` : '' }}
            </option>
          </optgroup>
          <option value=":new">＋ New list property…</option>
        </select>
      </div>

      <div v-if="creating" class="create" data-field="new-list">
        <p class="create-title">New list property of {{ view.component.name }}</p>
        <div class="create-row">
          <input
            v-model="newName"
            class="field"
            aria-label="List name"
            placeholder="items"
            spellcheck="false"
            @keydown.enter="createList"
          />
          <span class="faint">of</span>
          <select v-if="modelNames.length" v-model="newModel" class="field" aria-label="Item model">
            <option v-for="model in modelNames" :key="model" :value="model">{{ model }}</option>
          </select>
        </div>
        <p v-if="!modelNames.length" class="hint">
          A list holds items of a model, and this project has none yet.
          <button type="button" class="link" @click="emit('openModel', '')">Create a model</button>
        </p>
        <div class="create-actions">
          <button type="button" class="ghost" @click="creating = false">Cancel</button>
          <button
            type="button"
            class="primary"
            :disabled="!writable || !newModel || !newName.trim()"
            @click="createList"
          >
            Create and repeat
          </button>
        </div>
      </div>

      <template v-if="own && !creating">
        <div class="row" data-field="as">
          <span class="label" title="The item's name in bindings, like {item.name}">Item name</span>
          <input
            class="field"
            :value="own.as"
            :disabled="!writable"
            aria-label="Item name"
            spellcheck="false"
            @change="send(setRepeatAs(node, ($event.target as HTMLInputElement).value))"
          />
        </div>
        <div class="row" data-field="model">
          <span class="label">Each item</span>
          <span class="model-line">
            <button
              v-if="own.model"
              type="button"
              class="chip"
              :title="`Open ${own.model} on the Models face`"
              @click="emit('openModel', own.model)"
            >
              {{ own.model }} ↗
            </button>
            <span v-else class="warn">no model</span>
            <span class="faint">{{ own.rows }} sample rows on the canvas</span>
          </span>
        </div>
        <p v-if="own.unknownModel" class="warn-line" role="status">
          No page declares {{ own.model }}.
          <button type="button" class="link" @click="emit('openModel', own.model ?? '')">
            Declare it
          </button>
        </p>
        <p v-if="view.wrapsOne" class="warn-line" role="status">
          This repeats the whole {{ node.name }} with {{ view.wrapsOne.name }} inside each copy.
          <button type="button" class="link" :disabled="!writable" @click="repeatRowInstead">
            Repeat {{ view.wrapsOne.name }} instead
          </button>
        </p>
      </template>
    </template>

    <!--
      The template: what a layer inside can bind to, and what already does.
      Shown for the item in scope here — this layer's own, else the nearest
      repeat it sits inside — because a child of a repeat is part of it too.
    -->
    <div v-if="view.scope && !creating && !forSlot" class="template" data-field="template">
      <p class="template-title">
        {{ own ? 'Inside each copy' : 'From the item' }}
        <code>{{ view.scope.as }}</code>
      </p>
      <div class="chips">
        <span
          v-for="field in view.scope.fields"
          :key="field.path"
          class="chip"
          :data-list="field.list || undefined"
          :title="field.list ? 'A list: repeat a layer inside over it' : `Bind as {${field.path}}`"
          >{{ field.path }}: {{ field.type }}</span
        >
      </div>
      <ul v-if="view.uses.length" class="uses">
        <li v-for="use in view.uses" :key="use.address + use.detail">
          <button type="button" class="link" @click="emit('select', use.address)">
            {{ use.name }}</button
          ><span class="faint"> · {{ use.detail }}</span>
        </li>
      </ul>
      <p v-else-if="own" class="hint">
        Nothing inside reads <code>{{ own.as }}</code> yet: bind a text to
        <code>{{ '{' + own.as + '.field}' }}</code
        >, or put in a component that takes a {{ own.model ?? 'item' }}.
      </p>
      <p v-if="nestOffer.length" class="hint">
        To nest, repeat this layer over
        <code v-for="field in nestOffer" :key="field.path">{{ field.path }}</code
        >.
      </p>
    </div>
  </section>
</template>

<style scoped>
.repeat-section {
  display: flex;
  flex-direction: column;
  gap: var(--gap);
}
.head {
  display: flex;
  gap: 6px;
  align-items: center;
  height: var(--row-h);
  color: var(--bound);
}
.title {
  color: var(--text);
  font-weight: 600;
}
.of {
  color: var(--bound);
}
.label {
  color: var(--text-dim);
}
.row {
  display: grid;
  grid-template-columns: 80px 1fr;
  align-items: center;
  gap: var(--gap-sm);
}
.field {
  min-width: 0;
  height: var(--field-h);
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  background: var(--raised);
  color: var(--text);
  font: inherit;
}
.field:hover:not(:disabled) {
  border-color: var(--line);
}
.segmented {
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 2px;
  border-radius: var(--radius-lg);
  background: var(--raised);
}
.segmented button {
  height: 24px;
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--text-dim);
  font: inherit;
  cursor: pointer;
}
.segmented button[aria-checked='true'] {
  background: var(--panel);
  color: var(--text);
  box-shadow: var(--shadow-sm);
}
.context {
  margin: 0;
  padding: 6px 8px;
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--bound) 12%, transparent);
  color: var(--text-dim);
  font-size: var(--ui-size-sm);
  line-height: 15px;
}
.sep {
  margin: 0 4px;
  color: var(--text-faint);
}
.create {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--pad);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--bg);
}
.create-title,
.template-title {
  margin: 0;
  color: var(--text);
  font-weight: 600;
}
.create-row {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 6px;
}
.create-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.primary,
.ghost {
  height: 24px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-lg);
  font: inherit;
  cursor: pointer;
}
.primary {
  background: var(--accent);
  color: var(--on-accent);
}
.primary:disabled {
  opacity: 0.5;
  cursor: default;
}
.ghost {
  background: none;
  color: var(--text-dim);
}
.model-line {
  display: flex;
  gap: 6px;
  align-items: center;
  min-width: 0;
}
.template {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--pad);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--bound) 8%, transparent);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.chip {
  display: inline-flex;
  align-items: center;
  padding: 0 7px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: none;
  color: var(--bound);
  font: inherit;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--ui-size-sm);
  line-height: 18px;
  white-space: nowrap;
}
.chip[data-list] {
  border-style: dashed;
}
button.chip {
  cursor: pointer;
}
button.chip:hover {
  border-color: var(--bound);
}
.uses {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--ui-size-sm);
}
.hint,
.faint {
  margin: 0;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
  line-height: 14px;
}
.warn-line,
.warn {
  margin: 0;
  color: var(--warn);
  font-size: var(--ui-size-sm);
  line-height: 14px;
}
.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.link:hover {
  text-decoration: underline;
}
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.95em;
}
</style>
