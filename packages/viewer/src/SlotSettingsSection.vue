<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { declarationOf, type UidxDocument, type UidxNode, type UidxPatch } from '@uidx/format'
import type { ModelIndex } from '@uidx/schema'
import ComponentThumb from './ComponentThumb.vue'
import {
  contractView,
  declare,
  isPlaceholder,
  PLACEHOLDER,
  receivesFor,
  setRepeat,
  setRepeatAs,
} from './contract-edits'
import type { HeadlessLibrary } from './headless'
import { LAYER_ICONS } from './layer-icons'
import SlotContentPopup from './SlotContentPopup.vue'
import {
  acceptOptions,
  defaultContentPatches,
  definitionSlotCard,
  fitsAccepts,
  acceptedSet,
  type SlotPick,
} from './slot-content'

/**
 * A slot, as the author of its component sets it up — Builder's
 * `canHaveChildren` + `defaultChildren` + `childRequirements` and its
 * "Repeat for each" binding, in one place and in that order:
 *
 * 1. what the slot is for (its contract declaration),
 * 2. whether it is filled once or once per item of a list, and which list —
 *    which is what ties it to a model (ADR 0017 §2),
 * 3. what each filling receives, said the way code will (`renderItem`),
 * 4. what it draws when a use says nothing (its default content),
 * 5. what a use may put there (`accepts`, ADR 0017 §1).
 *
 * Every row writes the file the way the Contract tab's rows do; this is the
 * same document, gathered where a designer looks when the slot is selected.
 */
const props = defineProps<{
  doc: UidxDocument | null
  node: UidxNode
  components?: ReadonlyMap<string, UidxNode>
  models?: ModelIndex
  pages?: ReadonlyMap<string, UidxDocument>
  library?: HeadlessLibrary | null
  writable: boolean
}>()

const emit = defineEmits<{
  patches: [patches: UidxPatch[]]
  openModel: [name: string]
  select: [address: string]
}>()

const send = (patches: UidxPatch[]): void => {
  if (props.writable && patches.length) emit('patches', patches)
}

const view = computed(() =>
  contractView(props.doc, props.node, props.library ?? null, props.models, props.components),
)
const component = computed(() =>
  view.value.kind === 'slot' && view.value.component ? view.value.component : null,
)
const facet = computed(() => (view.value.kind === 'slot' ? view.value : null))
const repeat = computed(() => facet.value?.repeat ?? null)
const lists = computed(() => facet.value?.lists ?? [])

/** The slot's declaration, read from the file rather than the view, so edits keep its other attributes. */
const declaration = computed(() =>
  props.doc ? declarationOf(props.doc, 'slot', props.node.name) : null,
)
const accepts = computed(() => {
  const value = declaration.value?.attrs.accepts
  return typeof value === 'string' ? value : undefined
})

function redeclare(change: { accepts?: string | null; description?: string }): void {
  const attrs = { ...(declaration.value?.attrs ?? {}) }
  if (change.accepts !== undefined) {
    if (change.accepts) attrs.accepts = change.accepts
    else delete attrs.accepts
  }
  const description =
    change.description !== undefined
      ? change.description || `${PLACEHOLDER}the slot "${props.node.name}".`
      : (declaration.value?.description ?? `${PLACEHOLDER}the slot "${props.node.name}".`)
  send(declare('slot', props.node.name, { attrs, description }))
}

/* ---------------------------------------------------------- the list */

const propType = (name: string): string =>
  component.value?.spec?.contract?.props.find((prop) => prop.name === name)?.type ?? ''

const modelNames = computed(() => [...(props.models?.keys() ?? [])].sort())

/** The inline "new list" form: a list prop of a model, declared and repeated over in one edit. */
const creating = ref(false)
const newName = ref('items')
const newModel = ref('')
watch(creating, (open) => {
  if (!open) return
  newModel.value = newModel.value || modelNames.value[0] || ''
  const taken = new Set((component.value?.spec?.contract?.props ?? []).map((prop) => prop.name))
  let name = 'items'
  for (let n = 2; taken.has(name); n++) name = `items${n}`
  newName.value = name
})

function chooseMode(mode: 'once' | 'each'): void {
  if (mode === 'once') {
    creating.value = false
    send(setRepeat(props.node, null))
  } else if (lists.value.length) send(setRepeat(props.node, lists.value[0]!))
  else creating.value = true
}

function chooseList(value: string): void {
  if (value === ':new') creating.value = true
  else {
    creating.value = false
    send(setRepeat(props.node, value))
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
    ...setRepeat(props.node, name),
  ])
  creating.value = false
}

/** What code hands each filling, and the prop a use passes it through. */
const signature = computed(() => {
  const pascal = props.node.name.replace(/(^|[-_ ])(\w)/g, (_, __, c: string) => c.toUpperCase())
  if (!repeat.value) return `${props.node.name}?: ReactNode`
  const item = repeat.value.model ?? 'unknown'
  return `render${pascal}?: (${repeat.value.as}: ${item}, index: number) => ReactNode`
})

/* ---------------------------------------------------- default content */

const card = computed(() =>
  component.value
    ? definitionSlotCard(component.value, props.node, props.components, props.models, props.pages)
    : null,
)
const picking = ref(false)
const trigger = ref<Element | null>(null)

function pickDefault(pick: SlotPick): void {
  send(defaultContentPatches(props.node, pick))
}

/** How the default content takes the item: the prop it lands on, or why it does not. */
const defaultReceives = computed(() => {
  const content = card.value?.content
  if (!repeat.value || content?.kind !== 'component') return null
  const child = props.node.children[0]
  const definition = props.components?.get(content.component) ?? null
  if (!child || !definition) return null
  const rows = receivesFor(child, definition, component.value, props.models)
  const row = rows.find((candidate) => candidate.from === repeat.value!.as)
  return row
    ? {
        ok: true as const,
        text: `${content.component} receives each ${repeat.value.model ?? 'item'} as`,
        prop: row.prop,
      }
    : {
        ok: false as const,
        text: `${content.component} has no ${repeat.value.model ?? 'item'} property, so every row draws the same thing.`,
        prop: '',
      }
})

/* ------------------------------------------------------------- accepts */

const acceptChoices = computed(() =>
  // The library's elements nobody implements yet would be 50 dead options;
  // a slot can only usefully require what some component already is.
  acceptOptions(props.components, [], accepts.value),
)
const fitting = computed(() => acceptChoices.value.find((choice) => choice.tag === accepts.value))
/** The default content breaking the slot's own rule — what `uidx check` reports. */
const defaultRefused = computed(() => {
  const allowed = acceptedSet(accepts.value)
  const content = card.value?.content
  if (!allowed || content?.kind !== 'component') return null
  return fitsAccepts(props.components?.get(content.component), allowed) ? null : content.component
})
</script>

<template>
  <section v-if="component" class="slot-settings" aria-label="Slot settings">
    <header class="head">
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path :d="LAYER_ICONS.Slot" fill="none" stroke="currentColor" />
      </svg>
      <span class="title">Slot</span>
      <span class="of">of {{ component.name }}</span>
    </header>

    <!-- 1. What it is for -->
    <p v-if="!declaration" class="banner" role="status" data-field="undeclared">
      Not in {{ component.name }}'s contract yet, so uses cannot fill it and code does not expose
      it.
      <button type="button" class="link" :disabled="!writable" @click="redeclare({})">
        Declare slot
      </button>
    </p>
    <label v-else class="stack" data-field="description">
      <span class="label">Description</span>
      <textarea
        class="field area"
        rows="3"
        :value="isPlaceholder(declaration.description) ? '' : declaration.description"
        placeholder="What goes here, for the people using the component"
        :disabled="!writable"
        @change="redeclare({ description: ($event.target as HTMLTextAreaElement).value.trim() })"
      />
    </label>

    <!-- 2. Once, or once per item of a list -->
    <div class="group" data-field="repeat">
      <span class="label">Content</span>
      <div class="segmented" role="radiogroup" aria-label="How often the slot is filled">
        <button
          type="button"
          role="radio"
          :aria-checked="!repeat && !creating"
          :disabled="!writable"
          @click="chooseMode('once')"
        >
          Filled once
        </button>
        <button
          type="button"
          role="radio"
          :aria-checked="!!repeat || creating"
          :disabled="!writable"
          @click="chooseMode('each')"
        >
          For each item
        </button>
      </div>
    </div>

    <template v-if="repeat || creating">
      <div class="row" data-field="list">
        <span class="label">List</span>
        <select
          class="field"
          :value="creating ? ':new' : (repeat?.list ?? '')"
          :disabled="!writable"
          aria-label="Repeat over"
          @change="chooseList(($event.target as HTMLSelectElement).value)"
        >
          <option v-if="repeat && !lists.includes(repeat.list)" :value="repeat.list">
            {{ repeat.list }} · not a list here
          </option>
          <option v-for="list in lists" :key="list" :value="list">
            {{ list }}{{ propType(list) ? ` · ${propType(list)}` : '' }}
          </option>
          <option value=":new">＋ New list…</option>
        </select>
      </div>

      <!-- A list prop of a model, declared here: the slot is where a designer meets the need. -->
      <div v-if="creating" class="create" data-field="new-list">
        <p class="create-title">New list property</p>
        <div class="create-row">
          <input
            v-model="newName"
            class="field"
            aria-label="List name"
            placeholder="items"
            spellcheck="false"
            @keydown.enter="createList"
          />
          <span class="of-word">of</span>
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

      <template v-if="repeat && !creating">
        <div class="row" data-field="as">
          <span class="label" title="The item's name in bindings, like {item.name}">Item name</span>
          <input
            class="field"
            :value="repeat.as"
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
              v-if="repeat.model"
              type="button"
              class="chip model"
              :title="`Open ${repeat.model} on the Models face`"
              @click="emit('openModel', repeat.model)"
            >
              {{ repeat.model }} ↗
            </button>
            <span v-else class="warn">no model</span>
            <span class="faint">{{ repeat.rows }} sample rows on the canvas</span>
          </span>
        </div>
        <p v-if="repeat.unknownModel" class="warn-line" role="status">
          No page declares {{ repeat.model }}.
          <button type="button" class="link" @click="emit('openModel', repeat.model ?? '')">
            Declare it
          </button>
        </p>
      </template>
    </template>

    <!-- 3. What each filling receives — the render prop, said as code will say it -->
    <div v-if="!creating" class="receives" data-field="receives">
      <span class="label">{{ repeat ? 'Each filling receives' : 'A use passes' }}</span>
      <div v-if="repeat" class="chips">
        <span class="chip">{{ repeat.as }}: {{ repeat.model ?? 'unknown' }}</span>
        <span class="chip">index: number</span>
      </div>
      <code class="signature" :title="'The React prop a use fills this slot through'">{{
        signature
      }}</code>
    </div>

    <!-- 4. What it draws when a use says nothing -->
    <div v-if="card" class="group" data-field="default">
      <span class="label">Default content</span>
      <button
        ref="trigger"
        type="button"
        class="trigger"
        data-popup-trigger
        :disabled="!writable"
        :aria-expanded="picking"
        aria-label="Default content"
        @click="picking = !picking"
      >
        <ComponentThumb
          v-if="card.content.kind === 'component'"
          size="sm"
          :name="card.content.component"
        />
        <span v-else class="glyph" aria-hidden="true">{{
          card.content.kind === 'text' ? 'T' : card.content.kind === 'empty' ? '∅' : '≡'
        }}</span>
        <span class="trigger-label">{{
          card.content.kind === 'empty' ? 'Nothing — uses must fill it' : card.content.label
        }}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
      <p v-if="defaultReceives?.ok" class="ok-line" data-field="default-receives">
        ✓ {{ defaultReceives.text }} <code>{{ defaultReceives.prop }}</code>
      </p>
      <p v-else-if="defaultReceives" class="warn-line" role="status">{{ defaultReceives.text }}</p>
      <SlotContentPopup
        v-if="picking"
        :card="card"
        :trigger="trigger"
        :allow-default="false"
        @pick="pickDefault"
        @close="picking = false"
      />
    </div>

    <!-- 5. What a use may put there -->
    <div v-if="declaration" class="group" data-field="accepts">
      <span class="label">Allowed content</span>
      <select
        class="field"
        :value="accepts ?? ''"
        :disabled="!writable"
        aria-label="Allowed content"
        @change="redeclare({ accepts: ($event.target as HTMLSelectElement).value || null })"
      >
        <option value="">Any component</option>
        <option v-for="choice in acceptChoices" :key="choice.tag" :value="choice.tag">
          Components implementing {{ choice.tag
          }}{{ choice.fits.length ? ` (${choice.fits.length})` : '' }}
        </option>
      </select>
      <p v-if="accepts" class="hint">
        <template v-if="fitting?.fits.length">Fits: {{ fitting.fits.join(', ') }}.</template>
        <template v-else>No component implements {{ accepts }} yet.</template>
      </p>
      <p v-else class="hint">
        Uses may fill it with anything; the picker puts components that take the item first.
      </p>
      <p v-if="defaultRefused" class="warn-line" role="status">
        The default, {{ defaultRefused }}, does not implement {{ accepts }}.
      </p>
    </div>
  </section>
</template>

<style scoped>
.slot-settings {
  display: flex;
  flex-direction: column;
  gap: var(--gap);
  padding: var(--pad) 0 var(--section-pad);
  margin-bottom: var(--pad);
  border-bottom: 1px solid var(--line);
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
  color: var(--text-faint);
}
.label {
  color: var(--text-dim);
}
.stack,
.group {
  display: flex;
  flex-direction: column;
  gap: 4px;
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
.area {
  height: auto;
  padding: 6px;
  resize: vertical;
  line-height: var(--ui-line);
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
.create {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--pad);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--bg);
}
.create-title {
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
.of-word {
  color: var(--text-faint);
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
button.chip {
  cursor: pointer;
}
button.chip:hover {
  border-color: var(--bound);
}
.receives {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--pad);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--bound) 8%, transparent);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.signature {
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
  line-height: 14px;
  overflow-wrap: anywhere;
}
.trigger {
  display: flex;
  gap: var(--gap);
  align-items: center;
  height: 32px;
  padding: 0 6px 0 4px;
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  background: var(--raised);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.trigger:hover:not(:disabled),
.trigger[aria-expanded='true'] {
  border-color: var(--accent);
}
.trigger svg {
  flex: none;
  color: var(--text-faint);
}
.trigger-label {
  flex: 1;
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.glyph {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 22px;
  border: 1px dashed var(--line);
  border-radius: var(--radius-lg);
  color: var(--text-dim);
}
.hint,
.faint {
  margin: 0;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
  line-height: 14px;
}
.ok-line,
.warn-line,
.banner {
  margin: 0;
  font-size: var(--ui-size-sm);
  line-height: 14px;
}
.ok-line {
  color: var(--ok);
}
.warn-line,
.warn {
  color: var(--warn);
}
.banner {
  padding: 6px 8px;
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--warn) 14%, transparent);
  color: var(--text);
}
.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
