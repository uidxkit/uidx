<script setup lang="ts">
import { computed } from 'vue'
import type { UidxDocument, UidxNode, UidxPatch } from '@uidx/format'
import {
  bindPart,
  contractView,
  setImplements,
  setPart,
  setRepeatCount,
  setRepeatSlot,
} from './contract-edits'
import type { HeadlessLibrary } from './headless'
import { LAYER_ICONS, STROKE_ICONS } from './layer-icons'

/**
 * The Contract tab: where the visual tree is bound to its code render
 * (ADR 0013 §3, ADR 0017 §2).
 *
 * The Design tab says what a thing looks like; this one says what it *is* to
 * the headless library — which element a component implements, which part a
 * layer draws, which slot a repeat multiplies. Figma keeps the same split
 * between its Design panel and the properties it links to code, and it binds
 * from both ends: a property is declared on the component and applied from
 * the layer. So does this. A part is bound from the component's list or from
 * the layer's own row, and both write the same attribute.
 *
 * Choices come from a list wherever one exists — the library's roots, the
 * root's parts, the contract's repeating slots — and from a text field only
 * when the document has no library to ask. Nothing here edits the contract's
 * prose; that is the file's, and the tab shows it so the binding can be read
 * against what it binds to.
 */
const props = defineProps<{
  doc: UidxDocument | null
  node: UidxNode | null
  library: HeadlessLibrary | null
  libraryError?: string
  writable: boolean
}>()

const emit = defineEmits<{
  patches: [patches: UidxPatch[]]
  /** Jump the selection to a layer the tab names, as clicking it in the rail would. */
  select: [address: string]
}>()

const view = computed(() => contractView(props.doc, props.node, props.library))

const boundCount = computed(() =>
  view.value.kind === 'component' ? view.value.parts.filter((row) => row.boundTo).length : 0,
)

const contract = computed(() =>
  view.value.kind === 'component' ? (view.value.component.spec?.contract ?? null) : null,
)

function send(patches: UidxPatch[]): void {
  if (patches.length) emit('patches', patches)
}

function chooseElement(tag: string): void {
  if (view.value.kind !== 'component') return
  send(setImplements(view.value.component, tag || null))
}

function bind(part: string, address: string): void {
  if (view.value.kind !== 'component' || !props.doc || !address) return
  send(bindPart(props.doc, view.value.component, part, address))
}

function unbind(address: string): void {
  if (!props.doc) return
  const node = findNode(props.doc.tree, address)
  if (node) send(setPart(node, null))
}

function choosePart(part: string): void {
  if (view.value.kind !== 'part') return
  send(setPart(view.value.node, part || null))
}

function chooseSlot(slot: string): void {
  if (view.value.kind !== 'repeat' || !slot) return
  const { patches, nextAddress } = setRepeatSlot(view.value.node, slot)
  send(patches)
  if (patches.length) emit('select', nextAddress)
}

function chooseCount(raw: string): void {
  if (view.value.kind !== 'repeat') return
  send(setRepeatCount(view.value.node, Number(raw)))
}

function findNode(root: UidxNode, address: string): UidxNode | null {
  if (root.address === address) return root
  for (const child of root.children) {
    const found = findNode(child, address)
    if (found) return found
  }
  return null
}

/** `'  '`-indented so the picker reads as the layer tree does. */
const indent = (depth: number): string => '  '.repeat(depth)

const typeOf = (prop: { type?: string; model?: string }): string => prop.model ?? prop.type ?? ''
</script>

<template>
  <section class="contract" aria-label="Contract">
    <!-- Nothing selected: what the tab is for, and whether a library is loaded. -->
    <template v-if="view.kind === 'page'">
      <p class="empty">
        Select a component to choose the headless element it implements, or a layer inside one to
        name the part it draws.
      </p>
    </template>

    <template v-else-if="view.kind === 'component'">
      <header class="head">
        <span class="title">Implements</span>
        <span class="of">{{ view.component.name }}</span>
      </header>
      <div class="row" data-field="implements" :data-set="view.implementsValue !== null">
        <span class="name" title="The headless element this component is a render of">
          Element
        </span>
        <select
          v-if="library"
          class="pick"
          :value="view.implementsValue ?? ''"
          :disabled="!writable"
          aria-label="Element"
          @change="chooseElement(($event.target as HTMLSelectElement).value)"
        >
          <option value="">None</option>
          <option v-for="option in view.rootOptions" :key="option.tag" :value="option.tag">
            {{ option.tag }}{{ option.known ? '' : ' · not in library' }}
          </option>
        </select>
        <input
          v-else
          class="text"
          :value="view.implementsValue ?? ''"
          :disabled="!writable"
          aria-label="Element"
          placeholder="e.g. hwc-button"
          @change="chooseElement(($event.target as HTMLInputElement).value.trim())"
        />
        <button
          v-if="view.implementsValue !== null"
          type="button"
          class="reset"
          :disabled="!writable"
          aria-label="Clear element"
          title="Implement nothing"
          @click="chooseElement('')"
        >
          ↺
        </button>
        <span v-else class="reset-spacer" />
      </div>
      <p v-if="view.element" class="hint">
        <template v-if="view.element.attributes.length">
          Attributes: {{ view.element.attributes.join(', ') }}.
        </template>
        <template v-if="view.element.events.length">
          Events: {{ view.element.events.join(', ') }}.
        </template>
      </p>

      <header class="head">
        <span class="title">Parts</span>
        <span v-if="view.parts.length" class="of"
          >{{ boundCount }} of {{ view.parts.length }} bound</span
        >
      </header>
      <p v-if="!view.parts.length" class="empty">
        <template v-if="view.implementsValue === null">
          Choose an element above to see the parts it offers.
        </template>
        <template v-else-if="!view.element">
          “{{ view.implementsValue }}” is not in the library, and the contract declares no parts.
        </template>
        <template v-else>“{{ view.implementsValue }}” has no parts to bind.</template>
      </p>
      <!--
        Bound from the component's side (Figma declares a property here) — each
        declared part is a row, and an unbound row is a picker over the layers
        that could draw it. A bound row names its layer and jumps to it.
      -->
      <div
        v-for="row in view.parts"
        :key="row.name"
        class="row"
        :data-part="row.name"
        :data-bound="row.boundTo !== null"
      >
        <span
          class="name"
          :title="
            `${row.name} · ` +
            (row.declaredBy === 'both'
              ? 'declared by the library and the contract'
              : row.declaredBy === 'library'
                ? 'declared by the library'
                : 'declared by the contract; the library does not know it')
          "
        >
          {{ row.name }}
          <span v-if="row.declaredBy === 'contract' && view.element" class="flag">?</span>
          <span
            v-if="row.kind === 'shadow'"
            class="pill"
            title="A shadow part: styled through ::part() and drawn by the library. What the bound layer holds stays design-only."
            >shadow</span
          >
        </span>
        <button
          v-if="row.boundTo"
          type="button"
          class="layer"
          :title="`Select ${row.boundTo.name}`"
          @click="emit('select', row.boundTo.address)"
        >
          <svg class="icon" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path
              :d="LAYER_ICONS[row.boundTo.element as keyof typeof LAYER_ICONS]"
              :fill="STROKE_ICONS.has(row.boundTo.element as never) ? 'none' : 'currentColor'"
              :stroke="STROKE_ICONS.has(row.boundTo.element as never) ? 'currentColor' : 'none'"
              stroke-width="1"
            />
          </svg>
          <span class="layer-name">{{ row.boundTo.name }}</span>
        </button>
        <select
          v-else
          class="pick unbound"
          value=""
          :disabled="!writable || !view.candidates.length"
          :aria-label="`Bind ${row.name}`"
          @change="bind(row.name, ($event.target as HTMLSelectElement).value)"
        >
          <option value="" disabled>
            {{ view.candidates.length ? 'Bind a layer…' : 'No layer to bind' }}
          </option>
          <option v-for="c in view.candidates" :key="c.address" :value="c.address">
            {{ indent(c.depth) }}{{ c.name }}
          </option>
        </select>
        <button
          v-if="row.boundTo"
          type="button"
          class="reset"
          :disabled="!writable"
          :aria-label="`Unbind ${row.name}`"
          :title="`Unbind ${row.boundTo.name} from ${row.name}`"
          @click="unbind(row.boundTo.address)"
        >
          ×
        </button>
        <span v-else class="reset-spacer" />
      </div>
      <p v-for="stray in view.strayParts" :key="stray.address" class="stale" role="status">
        “{{ stray.name }}” is bound to “{{ stray.part }}”, which nothing declares.
        <button type="button" class="stale-name" @click="emit('select', stray.address)">
          Show it
        </button>
      </p>

      <template v-if="view.slots.length">
        <header class="head"><span class="title">Slots</span></header>
        <div
          v-for="slot in view.slots"
          :key="slot.name"
          class="row"
          :data-slot="slot.name"
          :data-bound="slot.provided !== null"
        >
          <span class="name">
            {{ slot.name }}
            <span v-if="slot.repeats" class="pill" title="A repeating slot: one per item"
              >repeats</span
            >
          </span>
          <button
            v-if="slot.provided"
            type="button"
            class="layer"
            :title="`Select the ${slot.provided.kind}`"
            @click="emit('select', slot.provided.address)"
          >
            <svg class="icon" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path
                :d="LAYER_ICONS[slot.provided.kind === 'repeat' ? 'Repeat' : 'Slot']"
                fill="none"
                stroke="currentColor"
                stroke-width="1"
              />
            </svg>
            <span class="layer-name">
              {{
                slot.provided.kind === 'repeat'
                  ? `Repeat × ${slot.provided.count ?? '?'}`
                  : 'Slot in tree'
              }}
            </span>
          </button>
          <span v-else class="status">
            {{ slot.repeats ? 'No repeat in the tree yet' : 'No slot in the tree yet' }}
          </span>
          <span class="reset-spacer" />
        </div>
      </template>

      <template v-if="contract && (contract.props.length || contract.events.length)">
        <header class="head">
          <span class="title">Contract</span>
          <span class="of">from the file</span>
        </header>
        <div
          v-for="prop in contract.props"
          :key="prop.name"
          class="row read"
          :data-prop="prop.name"
        >
          <span class="name" :title="prop.description">{{ prop.name }}</span>
          <span class="type" :title="typeOf(prop)">{{ typeOf(prop) }}</span>
          <span class="reset-spacer" />
        </div>
        <div
          v-for="event in contract.events"
          :key="event.name"
          class="row read"
          :data-event="event.name"
        >
          <span class="name" :title="event.description">on {{ event.name }}</span>
          <span class="type">{{ event.detail ?? 'event' }}</span>
          <span class="reset-spacer" />
        </div>
      </template>
    </template>

    <template v-else-if="view.kind === 'part'">
      <header class="head">
        <span class="title">Part</span>
        <span class="of">of {{ view.component.name }}</span>
      </header>
      <p v-if="view.undeclared" class="empty">
        {{ view.component.name }} implements no element yet, so there is no part for this layer to
        draw.
        <button type="button" class="stale-name" @click="emit('select', view.component.address)">
          Select {{ view.component.name }}
        </button>
      </p>
      <!--
        Bound from the layer's side (Figma applies a property here). Parts held
        by another layer stay listed and say who has them: a part is bound once,
        and seeing where it went beats a list that silently shrinks.
      -->
      <div v-else class="row" data-field="part" :data-set="view.partValue !== null">
        <span class="name" title="The part of the headless element this layer draws">Draws</span>
        <select
          class="pick"
          :value="view.partValue ?? ''"
          :disabled="!writable"
          aria-label="Part"
          @change="choosePart(($event.target as HTMLSelectElement).value)"
        >
          <option value="">Nothing — design only</option>
          <option
            v-for="option in view.options"
            :key="option.name"
            :value="option.name"
            :disabled="option.takenBy !== null"
          >
            {{ option.name }}{{ option.kind === 'shadow' ? ' · shadow' : ''
            }}{{ option.takenBy ? ` · bound to ${option.takenBy}` : '' }}
          </option>
        </select>
        <button
          v-if="view.partValue !== null"
          type="button"
          class="reset"
          :disabled="!writable"
          aria-label="Clear part"
          title="Design only: draws no part"
          @click="choosePart('')"
        >
          ↺
        </button>
        <span v-else class="reset-spacer" />
      </div>
    </template>

    <template v-else-if="view.kind === 'repeat'">
      <header class="head">
        <span class="title">Repeat</span>
        <span v-if="view.child" class="of">{{ view.child.component || view.child.name }}</span>
      </header>
      <div class="row" data-field="slot" data-set="true">
        <span class="name" title="The repeating slot of the contract this multiplies">Slot</span>
        <select
          v-if="view.slotOptions.length"
          class="pick"
          :value="view.slotValue"
          :disabled="!writable"
          aria-label="Slot"
          @change="chooseSlot(($event.target as HTMLSelectElement).value)"
        >
          <option v-if="!view.slotOptions.includes(view.slotValue)" :value="view.slotValue">
            {{ view.slotValue }} · not declared
          </option>
          <option v-for="name in view.slotOptions" :key="name" :value="name">{{ name }}</option>
        </select>
        <input
          v-else
          class="text"
          :value="view.slotValue"
          :disabled="!writable"
          aria-label="Slot"
          @change="chooseSlot(($event.target as HTMLInputElement).value.trim())"
        />
        <span class="reset-spacer" />
      </div>
      <div class="row" data-field="count" data-set="true">
        <span class="name" title="How many sample rows the canvas draws">Count</span>
        <input
          class="text"
          type="number"
          min="0"
          step="1"
          :value="view.count"
          :disabled="!writable"
          aria-label="Count"
          @change="chooseCount(($event.target as HTMLInputElement).value)"
        />
        <span class="reset-spacer" />
      </div>
      <p v-if="!view.slotOptions.length" class="hint">
        {{
          view.component
            ? `${view.component.name}'s contract declares no repeating slot; add one under ## Contract.`
            : 'A repeat belongs inside a component.'
        }}
      </p>
      <p v-if="!view.child" class="stale" role="status">
        A repeat multiplies one instance; this one holds none.
      </p>
    </template>

    <template v-else-if="view.kind === 'slot'">
      <header class="head">
        <span class="title">Slot</span>
        <span v-if="view.component" class="of">of {{ view.component.name }}</span>
      </header>
      <p v-if="view.declared" class="hint">
        “{{ view.node.name }}” is declared by the contract<template v-if="view.declared.repeats">
          as repeating<template v-if="view.declared.accepts">
            ; each item is an {{ view.declared.accepts }}</template
          ></template
        >. Consumers fill it; what is inside is the placeholder.
      </p>
      <p v-else class="stale" role="status">
        The contract does not declare a slot called “{{ view.node.name }}”. Add it under
        <code>&lt;Slots&gt;</code>, or rename this one.
      </p>
    </template>

    <template v-else-if="view.kind === 'instance'">
      <p class="empty">
        An instance renders its component's contract. Select the component to change what it
        implements or how its parts are bound.
      </p>
    </template>

    <template v-else>
      <p class="empty">
        Only layers inside a component draw a part. Move this layer into a component, or make one
        from it.
      </p>
    </template>

    <!-- Where the choices come from, on every view: a fact the author can act on. -->
    <p v-if="libraryError" class="stale library" role="status">{{ libraryError }}</p>
    <p v-else-if="library" class="library">
      Library: {{ library.path }} · {{ library.roots.length }} elements
    </p>
    <p v-else class="library">
      No headless library. Add <code>"headless": "…/custom-elements.json"</code> to uidx.json to
      choose elements and parts from a list.
    </p>
  </section>
</template>

<style scoped>
.contract {
  padding: var(--pad);
}
.head {
  display: flex;
  align-items: baseline;
  gap: var(--gap-sm);
  height: var(--row-h);
}
.head + .head,
.row + .head,
.hint + .head,
.empty + .head,
.stale + .head {
  margin-top: 8px;
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
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 24px;
  align-items: center;
  gap: var(--gap);
  min-height: var(--field-h);
  padding: 4px 0;
}
.name {
  display: inline-flex;
  align-items: center;
  gap: var(--gap-sm);
  overflow: hidden;
  color: var(--text-dim);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row[data-set='true'] .name,
.row[data-bound='true'] .name {
  color: var(--text);
}
.text,
.pick {
  height: var(--field-h);
  min-width: 0;
  padding: 0 6px;
  background: var(--raised);
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  color: var(--text);
  font: inherit;
}
.pick {
  width: 100%;
  cursor: pointer;
  color-scheme: dark;
}
.row[data-set='false'] .pick,
.row[data-set='false'] .text {
  color: var(--text-faint);
}
.pick.unbound {
  color: var(--text-faint);
  border-style: dashed;
  border-color: var(--line);
  background: none;
}
.layer {
  display: inline-flex;
  align-items: center;
  gap: var(--gap-sm);
  min-width: 0;
  height: var(--field-h);
  padding: 0 8px;
  background: var(--raised);
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  color: var(--bound);
  font: inherit;
  cursor: pointer;
}
.layer:hover {
  border-color: var(--bound);
}
.layer .icon {
  flex: none;
}
.layer-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.type,
.status {
  overflow: hidden;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row.read {
  min-height: var(--row-h);
  padding: 2px 0;
}
.pill {
  padding: 0 5px;
  border-radius: 999px;
  background: var(--raised);
  color: var(--text-dim);
  font-size: 10px;
  font-weight: 500;
}
.flag {
  color: var(--warn);
  font-size: 10px;
}
.reset,
.stale-name {
  min-width: 24px;
  min-height: 24px;
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
  width: 24px;
}
.stale-name {
  color: var(--warn);
  text-decoration: underline;
}
.empty,
.hint,
.stale,
.library {
  margin: 0;
  padding-top: var(--gap-sm);
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
  line-height: 1.5;
}
.stale {
  color: var(--warn);
}
.library {
  margin-top: 16px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}
code {
  font-family: var(--mono-font, ui-monospace, monospace);
  font-size: 10px;
}
</style>
