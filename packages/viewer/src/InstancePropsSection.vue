<script setup lang="ts">
import { computed, ref } from 'vue'
import { type JsonValue, type UidxDocument, type UidxNode, type UidxPatch } from '@uidx/format'
import type { ModelIndex } from '@uidx/schema'
import ComponentThumb from './ComponentThumb.vue'
import { setReceives } from './contract-edits'
import { bindOptions, boundAlias, dataRows, itemScopes } from './instance-data'
import ItemBindPopup from './ItemBindPopup.vue'
import { LAYER_ICONS } from './layer-icons'
import SlotCardField from './SlotCardField.vue'
import { componentNote, fillContext, slotCards } from './slot-content'
import {
  clearInstanceProp,
  instancePropRows,
  setInstanceProp,
  unusedInstanceProps,
} from './instance-prop-edits'

/**
 * An instance's properties, at the top of the inspector (story F7).
 *
 * "Using a component is choosing its content rather than overriding its
 * insides" — so this is the first thing an author sees when they select an
 * instance, above the geometry, which is the only other thing they may change
 * about it.
 *
 * Everything written here lands on the `<Instance>`, which is on the page the
 * author has open. The component's own file is never touched by a use of it,
 * and that is the point of the mechanism.
 */
const props = defineProps<{
  doc: UidxDocument | null
  instance: UidxNode
  /** The component this is an instance of, if the document has it. */
  definition: UidxNode | undefined
  /** Every component in the document, for what a slot can be filled with. */
  components?: ReadonlyMap<string, UidxNode>
  /** Models across every page, for what a repeated slot hands each row. */
  models?: ModelIndex
  /** Every page, for each component's own description. */
  pages?: ReadonlyMap<string, UidxDocument>
  /** Which sample row the canvas previews a lone item component with. */
  previewIndex?: number
  writable: boolean
}>()

const emit = defineEmits<{
  patches: [patches: UidxPatch[]]
  select: [address: string]
  /** Open a component's definition, on whatever page declares it. */
  openComponent: [name: string]
  openModel: [name: string]
  /** Preview another sample row on the canvas. */
  preview: [index: number]
}>()

/** The definition's slots, what this instance put in each, and what each could hold. */
const cards = computed(() =>
  slotCards(props.instance, props.definition, props.components, props.models, props.pages),
)

/** The instance this one fills a slot of, when it does: injected content. */
const filling = computed(() =>
  props.doc
    ? fillContext(props.doc.tree, props.instance.address, props.components, props.models)
    : null,
)

const data = computed(() =>
  dataRows(
    props.doc,
    props.instance,
    props.definition,
    props.components,
    props.models,
    props.previewIndex ?? 0,
  ),
)

function step(index: number, count: number, by: number): void {
  emit('preview', (index + by + count) % count)
}

/** The prop whose bind popup is open, and the buttons the popups hang from. */
const binding = ref<string | null>(null)
const bindTriggers = new Map<string, Element>()
function setBindTrigger(prop: string, element: unknown): void {
  if (element instanceof Element) bindTriggers.set(prop, element)
}

/** Binds a prop to the item or one of its fields — or unbinds it — as a token is applied. */
function bind(prop: string, alias: string | null): void {
  if (props.writable) send(setReceives(props.instance, prop, alias))
}

/** The items in scope here: a repeat around the instance, or the repeated slot it fills. */
const scopes = computed(() => itemScopes(props.doc, props.instance, props.components, props.models))

/** A text or flag property bound to the item: its alias, else null. */
const rowBound = (name: string): string | null => boundAlias(props.instance, name)
const rowOptions = (type: string) =>
  bindOptions(scopes.value, type === 'BOOLEAN' ? 'boolean' : 'string')

const note = computed(() => componentNote(props.pages, componentName.value))
const summary = computed(() => {
  const definition = props.definition
  if (!definition) return ''
  const parts: string[] = []
  const properties = rows.value.length + (definition.spec?.contract?.props.length ?? 0)
  if (properties) parts.push(`${properties} propert${properties === 1 ? 'y' : 'ies'}`)
  if (cards.value.length)
    parts.push(`${cards.value.length} slot${cards.value.length === 1 ? '' : 's'}`)
  return parts.join(' · ') || 'Component'
})

const rows = computed(() => instancePropRows(props.instance, props.definition))
const unused = computed(() => unusedInstanceProps(props.instance, props.definition))
const undeclared = computed(() => unused.value.filter((u) => u.reason === 'undeclared'))
const mistyped = computed(() => unused.value.filter((u) => u.reason === 'mistyped'))

/** The slot glyph the layers rail draws. */
const SLOT_ICON = LAYER_ICONS.Slot

const componentName = computed(() => {
  const named = props.instance.attrs.component?.value
  return typeof named === 'string' ? named : ''
})

function send(patches: UidxPatch[] | null): void {
  if (patches) emit('patches', patches)
}

function assign(name: string, value: JsonValue): void {
  if (!props.doc) return
  send(setInstanceProp(props.doc, props.instance.address, props.definition, name, value))
}

/** How a declaration's type reads in a sentence about a value it refuses. */
function declarationOf(name: string): string {
  const type = rows.value.find((row) => row.name === name)?.declaration.type
  return type === 'BOOLEAN' ? 'true or false' : 'text'
}

function reset(name: string): void {
  if (!props.doc) return
  // A `remove` of the key rather than a write of the default: "does not choose"
  // follows the definition when it changes, and "chooses the same thing" does
  // not. `clearInstanceProp` decides that, not this.
  send(clearInstanceProp(props.doc, props.instance.address, name))
}
</script>

<template>
  <section class="instance-props" aria-label="Instance properties">
    <!--
      The component this is a use of, as a card: its picture, what it is for,
      and the way to its definition — Builder's symbol header and Figma's
      "Go to main component" in one place, before anything to change.
    -->
    <div class="component-card" :data-missing="!definition || undefined">
      <ComponentThumb :name="componentName" />
      <span class="card-text">
        <span class="card-name">{{ componentName }}</span>
        <span class="card-note" :title="note || summary">{{ note || summary }}</span>
      </span>
      <button
        v-if="definition"
        type="button"
        class="icon-button"
        :title="`Go to ${componentName}`"
        :aria-label="`Go to ${componentName}`"
        @click="emit('openComponent', componentName)"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M4.5 2.5h5v5M9.5 2.5 3 9" fill="none" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
    </div>

    <p v-if="!definition" class="empty">
      This document has no component called “{{ componentName }}”, so there is nothing to fill in.
    </p>

    <!--
      Injected content says where it is injected: it is written on this page
      but drawn inside another component's slot — once per item when the slot
      repeats — which nothing else on screen would tell.
    -->
    <p v-if="filling" class="context" data-field="fill-context">
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path :d="SLOT_ICON" fill="none" stroke="currentColor" />
      </svg>
      <span>
        Fills
        <button type="button" class="context-link" @click="emit('select', filling.owner.address)">
          {{ filling.owner.name }}</button
        ><span class="context-slot"> › {{ filling.slot }}</span>
        <template v-if="filling.repeat">
          · drawn for each of its {{ filling.repeat.list }}
        </template>
      </span>
    </p>

    <template v-if="rows.length">
      <header class="head"><span class="title">Properties</span></header>
      <div
        v-for="row in rows"
        :key="row.name"
        class="row"
        :data-prop="row.name"
        :data-set="row.value !== undefined"
      >
        <span
          class="name"
          :title="
            row.domain
              ? `variant axis · ${row.domain.join(' | ')} · default ${row.declaration.default}`
              : `${row.declaration.type} · default ${row.declaration.default}`
          "
        >
          {{ row.name }}
        </span>

        <!--
          The control the type implies. An unset row shows the definition's
          default, dimmed — C7's treatment of an unset scene property, for C7's
          reason — and `data-set` is what dims it, so the two states are one
          control rather than two. An axis is a picker, because its values are
          stated (F8, ADR 0005 §2).
        -->
        <!-- Bound to the item, like a token: the binding shows instead of a value. -->
        <span v-if="rowBound(row.name)" class="control">
          <button
            :ref="(element) => setBindTrigger(row.name, element)"
            type="button"
            class="bind"
            data-popup-trigger
            data-bound
            :disabled="!writable"
            :aria-label="`Bind ${row.name}`"
            @click="binding = binding === row.name ? null : row.name"
          >
            <span class="glyph" aria-hidden="true">{ }</span>
            <span class="bound-name">{{ rowBound(row.name) }}</span>
          </button>
        </span>
        <select
          v-else-if="row.domain"
          class="pick"
          :value="row.resolved"
          :disabled="!writable"
          :aria-label="row.name"
          @change="assign(row.name, ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="value in row.domain" :key="value" :value="value">{{ value }}</option>
        </select>
        <input
          v-else-if="row.declaration.type === 'BOOLEAN'"
          type="checkbox"
          class="bool"
          :checked="row.resolved === true"
          :disabled="!writable"
          :aria-label="row.name"
          @change="assign(row.name, ($event.target as HTMLInputElement).checked)"
        />
        <input
          v-else
          class="text"
          :value="row.resolved"
          :disabled="!writable"
          :aria-label="row.name"
          @change="assign(row.name, ($event.target as HTMLInputElement).value)"
        />

        <!-- Inside a repeat, any of these can take a field of the item instead. -->
        <button
          v-if="scopes.length && !row.domain && !rowBound(row.name)"
          :ref="(element) => setBindTrigger(row.name, element)"
          type="button"
          class="bind-glyph"
          data-popup-trigger
          :disabled="!writable"
          :aria-label="`Bind ${row.name}`"
          title="Bind to a field of the item"
          @click="binding = binding === row.name ? null : row.name"
        >
          { }
        </button>
        <ItemBindPopup
          v-if="binding === row.name"
          :prop="row.name"
          :options="rowOptions(row.declaration.type)"
          :current="rowBound(row.name)"
          :trigger="bindTriggers.get(row.name) ?? null"
          @pick="bind(row.name, $event)"
          @close="binding = null"
        />
        <!-- Reset is only offered for a row that chose something. -->
        <button
          v-if="row.value !== undefined"
          type="button"
          class="reset"
          :disabled="!writable"
          :aria-label="`Reset ${row.name}`"
          :title="`Back to the default — ${row.declaration.default}`"
          @click="reset(row.name)"
        >
          ↺
        </button>
        <span v-else class="reset-spacer" />
      </div>
    </template>

    <!--
      Where each contract prop's value comes from here (ADR 0013, ADR 0017 §2)
      — Builder's Data tab, kept beside the content it feeds rather than on a
      tab of its own, because on a page there is only one answer to choose.
    -->
    <template v-if="data.length">
      <header class="head"><span class="title">Data</span></header>
      <div
        v-for="row in data"
        :key="row.prop"
        class="data-row"
        :data-data="row.prop"
        :data-source="row.source.kind"
      >
        <span class="name" :title="row.type">{{ row.prop }}</span>
        <span class="data-value">
          <template v-if="row.source.kind === 'bind'">
            <button
              :ref="(element) => setBindTrigger(row.prop, element)"
              type="button"
              class="bind"
              data-popup-trigger
              :data-bound="row.source.bound !== null || undefined"
              :disabled="!writable"
              :aria-label="`Bind ${row.prop}`"
              :aria-expanded="binding === row.prop"
              @click="binding = binding === row.prop ? null : row.prop"
            >
              <span class="glyph" aria-hidden="true">{ }</span>
              <span v-if="row.source.bound" class="bound-name">{{ row.source.bound }}</span>
              <span v-else class="unbound">Not bound</span>
            </button>
            <button
              v-if="row.source.bound"
              type="button"
              class="unbind"
              :disabled="!writable"
              :aria-label="`Unbind ${row.prop}`"
              title="Unbind"
              @click="bind(row.prop, null)"
            >
              ×
            </button>
            <ItemBindPopup
              v-if="binding === row.prop"
              :prop="row.prop"
              :options="row.source.options"
              :current="row.source.bound"
              :trigger="bindTriggers.get(row.prop) ?? null"
              @pick="bind(row.prop, $event)"
              @close="binding = null"
            />
          </template>
          <template v-else-if="row.source.kind === 'samples'">
            <span
              class="data-chip faint"
              :title="`The model's sample data: the canvas draws ${row.source.count} rows`"
              >{{ row.source.count }} sample rows</span
            >
          </template>
          <template v-else-if="row.source.kind === 'sample'">
            <span class="stepper" role="group" :aria-label="`Preview ${row.prop}`">
              <button
                type="button"
                class="step"
                :aria-label="`Previous ${row.prop}`"
                :disabled="row.source.count < 2"
                @click="step(row.source.index, row.source.count, -1)"
              >
                ‹
              </button>
              <span
                class="step-label"
                :title="`Sample ${row.source.index + 1} of ${row.source.count}`"
              >
                {{ row.source.label }}
              </span>
              <button
                type="button"
                class="step"
                :aria-label="`Next ${row.prop}`"
                :disabled="row.source.count < 2"
                @click="step(row.source.index, row.source.count, 1)"
              >
                ›
              </button>
            </span>
          </template>
          <span v-else class="data-chip faint">Not set</span>
        </span>
        <button
          v-if="row.model"
          type="button"
          class="type-chip"
          :title="`Open the ${row.model} model`"
          @click="emit('openModel', row.model)"
        >
          {{ row.type }}
        </button>
        <span v-else class="type-chip static">{{ row.type }}</span>
      </div>
    </template>

    <!--
      Each slot as a card: what fills it, chosen from a picker (the injection
      gesture of ADR 0007 and ADR 0017 §2), with what the slot does — repeat
      over a list — said on the card rather than discovered on the canvas.
    -->
    <template v-if="cards.length">
      <header class="head"><span class="title">Slots</span></header>
      <SlotCardField
        v-for="card in cards"
        :key="card.name"
        :card="card"
        :instance="instance"
        :writable="writable"
        @patches="emit('patches', $event)"
        @select="emit('select', $event)"
      />
    </template>

    <!--
      A value nothing consumes. Named rather than quietly kept: it is invisible
      in the canvas and reported by `uidx check` in a file the author may not
      have open. Neither kind can be produced by pressing anything here.
    -->
    <p v-if="undeclared.length" class="stale" role="status">
      {{ componentName }} no longer declares
      <template v-for="(u, i) in undeclared" :key="u.name">
        <button
          type="button"
          class="stale-name"
          :disabled="!writable"
          :title="`Remove ${u.name} from this instance`"
          @click="reset(u.name)"
        >
          {{ u.name }}</button
        ><span v-if="i < undeclared.length - 1">, </span>
      </template>
      — click to drop {{ undeclared.length === 1 ? 'it' : 'them' }}.
    </p>

    <!--
      The one the rows would otherwise lie about: a mistyped value draws as an
      unset row, because that is what the renderer does with it.
    -->
    <p v-for="u in mistyped" :key="u.name" class="stale mistyped" role="status">
      {{ u.name }} is set to {{ JSON.stringify(u.value) }}, which is not
      {{ declarationOf(u.name) }} — the default is showing instead.
      <button
        type="button"
        class="stale-name"
        :disabled="!writable"
        :title="`Remove ${u.name} from this instance`"
        @click="reset(u.name)"
      >
        Drop it
      </button>
    </p>
  </section>
</template>

<style scoped>
.component-card {
  display: flex;
  gap: var(--gap);
  align-items: center;
  margin-bottom: var(--gap);
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--bg);
}
.card-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.card-name {
  overflow: hidden;
  color: var(--text);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-note {
  display: -webkit-box;
  overflow: hidden;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
  line-height: 14px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.icon-button {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--field-h);
  height: var(--field-h);
  padding: 0;
  border: 0;
  border-radius: var(--radius-lg);
  background: none;
  color: var(--text-dim);
  font: inherit;
  cursor: pointer;
}
.icon-button:hover:not(:disabled) {
  background: var(--raised);
  color: var(--text);
}
.context {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  margin: 0 0 var(--gap);
  padding: 6px 8px;
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--bound) 12%, transparent);
  color: var(--text-dim);
  font-size: var(--ui-size-sm);
  line-height: 14px;
}
.context svg {
  flex: none;
  margin-top: 1px;
  color: var(--bound);
}
.context-link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.context-link:hover {
  text-decoration: underline;
}
.context-slot {
  color: var(--text);
}
.control {
  display: flex;
  min-width: 0;
}
.bind {
  display: flex;
  flex: 1;
  gap: 6px;
  align-items: center;
  min-width: 0;
  height: 24px;
  padding: 0 8px;
  border: 1px dashed var(--line);
  border-radius: var(--radius-lg);
  background: none;
  color: var(--text-dim);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.bind[data-bound] {
  border: 0;
  background: color-mix(in srgb, var(--bound) 16%, transparent);
  color: var(--text);
}
.bind:hover:not(:disabled) {
  border-color: var(--bound);
}
.bind .glyph {
  flex: none;
  color: var(--bound);
  font-family: ui-monospace, monospace;
  font-size: 9px;
}
.bound-name {
  overflow: hidden;
  font-family: ui-monospace, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.unbound {
  color: var(--text-faint);
}
.unbind,
.bind-glyph {
  flex: none;
  padding: 0 4px;
  border: 0;
  border-radius: var(--radius);
  background: none;
  color: var(--text-faint);
  font: inherit;
  font-family: ui-monospace, monospace;
  font-size: 9px;
  cursor: pointer;
}
.unbind {
  font-family: inherit;
  font-size: inherit;
}
.unbind:hover:not(:disabled),
.bind-glyph:hover:not(:disabled) {
  background: var(--raised);
  color: var(--bound);
}
.data-row {
  display: grid;
  grid-template-columns: 72px 1fr auto;
  align-items: center;
  gap: var(--gap-sm);
  min-height: var(--field-h);
  margin-bottom: 2px;
}
.data-value {
  display: flex;
  min-width: 0;
}
.data-value .pick {
  width: 100%;
}
.data-chip {
  overflow: hidden;
  padding: 0 8px;
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--bound) 14%, transparent);
  color: var(--text);
  line-height: 24px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.data-chip.faint {
  background: var(--raised);
  color: var(--text-dim);
}
.type-chip {
  padding: 0 6px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: none;
  color: var(--bound);
  font: inherit;
  font-size: var(--ui-size-sm);
  line-height: 18px;
  cursor: pointer;
}
.type-chip:hover {
  border-color: var(--bound);
}
.type-chip.static {
  color: var(--text-faint);
  cursor: default;
}
.stepper {
  display: flex;
  flex: 1;
  align-items: center;
  min-width: 0;
  height: 24px;
  border-radius: var(--radius-lg);
  background: var(--raised);
}
.step {
  flex: none;
  width: 22px;
  height: 24px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-dim);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.step:hover:not(:disabled) {
  color: var(--text);
}
.step-label {
  flex: 1;
  overflow: hidden;
  color: var(--text);
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.instance-props {
  padding: var(--pad);
  border-bottom: 1px solid var(--line);
}
.head {
  display: flex;
  align-items: baseline;
  gap: var(--gap-sm);
  height: var(--row-h);
}
.title {
  color: var(--text);
  font-weight: 600;
}
.of {
  color: var(--bound);
  font-size: var(--ui-size-sm);
}
.row {
  display: grid;
  grid-template-columns: 1fr 112px auto auto;
  align-items: center;
  gap: var(--gap-sm);
  height: var(--row-h);
}
.name {
  overflow: hidden;
  color: var(--text-dim);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.text,
.pick {
  height: var(--field-h);
  min-width: 0;
  padding: 0 6px;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  color: var(--text);
  font: inherit;
}
/* Unset: showing the definition's default rather than a choice. */
.row[data-set='false'] .text,
.row[data-set='false'] .pick,
.row[data-set='false'] .bool {
  color: var(--text-faint);
  opacity: 0.7;
}
.row[data-set='true'] .name {
  color: var(--text);
}
.bool {
  justify-self: start;
  margin: 0;
}
.reset,
.stale-name {
  padding: 0 4px;
  background: none;
  border: none;
  border-radius: var(--radius);
  color: var(--text-dim);
  font: inherit;
  cursor: pointer;
}
.reset:hover:not(:disabled),
.stale-name:hover:not(:disabled) {
  background: var(--raised);
  color: var(--text);
}
.reset-spacer {
  width: var(--icon);
}
.stale-name {
  color: var(--warn);
  text-decoration: underline;
}
.empty,
.stale {
  margin: 0;
  padding-top: var(--gap-sm);
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}
.stale {
  color: var(--warn);
}
</style>
