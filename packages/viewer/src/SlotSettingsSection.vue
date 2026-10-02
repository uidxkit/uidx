<script setup lang="ts">
import { computed, ref } from 'vue'
import { declarationOf, type UidxDocument, type UidxNode, type UidxPatch } from '@uidx/format'
import type { ModelIndex } from '@uidx/schema'
import ComponentThumb from './ComponentThumb.vue'
import { contractView, declare, isPlaceholder, PLACEHOLDER } from './contract-edits'
import type { HeadlessLibrary } from './headless'
import { COPY } from './inspector-messages'
import { LAYER_ICONS } from './layer-icons'
import RepeatSection from './RepeatSection.vue'
import SlotContentPopup from './SlotContentPopup.vue'
import { defaultContentPatches, definitionSlotCard, type SlotPick } from './slot-content'

/**
 * A slot, as the author of its component sets it up, in three choices:
 *
 * 1. what the slot is for (its contract declaration),
 * 2. whether it repeats for each item of a model — the same switch and model
 *    picker every layer has (ADR 0017 §2),
 * 3. what it draws when a use says nothing (its default content).
 *
 * What may fill it (`accepts`) stays on the Contract tab with the rest of the
 * contract; this panel is the everyday part.
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

/** The slot's declaration, read from the file rather than the view, so edits keep its other attributes. */
const declaration = computed(() =>
  props.doc ? declarationOf(props.doc, 'slot', props.node.name) : null,
)

function redeclare(change: { description?: string }): void {
  const attrs = { ...(declaration.value?.attrs ?? {}) }
  const description =
    change.description !== undefined
      ? change.description || `${PLACEHOLDER}the slot "${props.node.name}".`
      : (declaration.value?.description ?? `${PLACEHOLDER}the slot "${props.node.name}".`)
  send(declare('slot', props.node.name, { attrs, description }))
}

/* ---------------------------------------------------- default content */

const card = computed(() =>
  component.value
    ? definitionSlotCard(component.value, props.node, props.components, props.models, props.pages)
    : null,
)
const picking = ref(false)
const trigger = ref<Element | null>(null)

function pickDefault(pick: SlotPick): void {
  send(defaultContentPatches(props.node, pick, card.value ?? undefined))
}
</script>

<template>
  <section v-if="component" class="slot-settings" aria-label="Slot settings">
    <header class="head">
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path :d="LAYER_ICONS.Slot" fill="none" stroke="currentColor" />
      </svg>
      <span class="title">Slot</span>
      <span class="of" :title="`of ${component.name}`">of {{ component.name }}</span>
    </header>

    <!--
      1. What it is for. Undeclared, it is the inspector's one finding row:
      a dot, a short sentence, the action, as every other fault reads.
    -->
    <div v-if="!declaration" class="issue" role="status" data-field="undeclared">
      <span class="tone-dot" data-tone="warn" />
      <span>{{ COPY.slotUndeclared }}</span>
      <button type="button" class="link-button" :disabled="!writable" @click="redeclare({})">
        Declare slot
      </button>
    </div>
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

    <!-- 2. Repeat for each item of a model: the same switch any layer has. -->
    <div class="group">
      <RepeatSection
        :doc="doc"
        :node="node"
        :components="components"
        :models="models"
        :writable="writable"
        for-slot
        @patches="emit('patches', $event)"
        @select="emit('select', $event)"
        @open-model="emit('openModel', $event)"
      />
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
      <SlotContentPopup
        v-if="picking"
        :card="card"
        :trigger="trigger"
        :allow-default="false"
        @pick="pickDefault"
        @close="picking = false"
      />
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
/* One line at any width: a long component name ellipsises, the full name in its title. */
.head {
  display: flex;
  gap: 6px;
  align-items: center;
  min-width: 0;
  height: var(--row-h);
  color: var(--bound);
}
.head svg {
  flex: none;
}
.title {
  flex: none;
  color: var(--text);
  font-weight: 600;
}
.of {
  min-width: 0;
  overflow: hidden;
  color: var(--text-faint);
  text-overflow: ellipsis;
  white-space: nowrap;
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
.warn-line {
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
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
