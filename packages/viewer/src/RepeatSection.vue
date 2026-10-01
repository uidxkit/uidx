<script setup lang="ts">
import { computed, ref } from 'vue'
import type { UidxDocument, UidxNode, UidxPatch } from '@uidx/format'
import type { ModelIndex } from '@uidx/schema'
import { setRepeat } from './contract-edits'
import { REPEAT_ICON } from './layer-icons'
import { itemCount } from './model-edits'
import ModelPickerPopup from './ModelPickerPopup.vue'
import { repeatOverModel } from './repeat-edits'
import { repeatView } from './repeat-view'

/**
 * Repeat, kept to the two choices a designer makes (ADR 0017 §2):
 *
 * 1. this layer repeats — a switch;
 * 2. for each item of which model — picked like a token.
 *
 * The layer and everything in it is then drawn once per item of the model,
 * and its texts and component properties are bound to the item's fields with
 * the same bind button tokens use. Which list prop carries the items is
 * bookkeeping for code, done here without asking.
 */
const props = defineProps<{
  doc: UidxDocument | null
  node: UidxNode
  components?: ReadonlyMap<string, UidxNode>
  models?: ModelIndex
  writable: boolean
  /** Inside the Slot panel, which has its own heading. */
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

const view = computed(() => repeatView(props.doc, props.node, props.components, props.models))
const own = computed(() => view.value?.own ?? null)
const allModels = computed(() =>
  [...(props.models?.values() ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
)
const currentModel = computed(() =>
  own.value?.model ? (props.models?.get(own.value.model) ?? null) : null,
)
/** The enclosing repeat this layer is drawn inside, nearest — it is part of that template. */
const inside = computed(() => view.value?.enclosing.at(-1) ?? null)

/** The switch is on while the layer repeats, or while a model is being chosen for it. */
const choosing = ref(false)
const on = computed(() => own.value !== null || choosing.value)
const trigger = ref<Element | null>(null)
const picking = ref(false)

function toggle(): void {
  if (own.value) {
    choosing.value = false
    send(setRepeat(props.node, null))
  } else {
    choosing.value = !choosing.value
    picking.value = choosing.value
  }
}

function pick(model: string): void {
  const current = view.value
  if (!current) return
  choosing.value = false
  send(repeatOverModel(current.component, props.node, model, current.lists, props.components))
}
</script>

<template>
  <section
    v-if="view"
    class="repeat-section"
    aria-label="Repeat"
    data-field="repeat"
    :data-set="own !== null"
  >
    <div class="head">
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path :d="REPEAT_ICON" fill="none" stroke="currentColor" stroke-width="1" />
      </svg>
      <span class="title">{{ forSlot ? 'Repeat for each item' : 'Repeat' }}</span>
      <button
        type="button"
        role="switch"
        class="switch"
        :aria-checked="on"
        :disabled="!writable"
        :aria-label="`Repeat ${node.name}`"
        @click="toggle"
      >
        <span class="knob" />
      </button>
    </div>

    <template v-if="on">
      <button
        ref="trigger"
        type="button"
        class="model-trigger"
        data-popup-trigger
        data-field="model"
        :disabled="!writable"
        :aria-expanded="picking"
        @click="picking = !picking"
      >
        <span class="glyph" aria-hidden="true">{ }</span>
        <span v-if="own?.model" class="model-name">{{ own.model }}</span>
        <span v-else-if="own" class="warn">{{ own.list }} · no model</span>
        <span v-else class="placeholder">Choose a model…</span>
        <span v-if="currentModel" class="count">{{ itemCount(currentModel) }} items</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
      <p v-if="own?.model" class="hint">
        Drawn once per {{ own.model }}. Bind texts and component properties inside to its fields
        with the bind button.
        <button type="button" class="link" @click="emit('openModel', own.model)">Edit items</button>
      </p>
      <ModelPickerPopup
        v-if="picking"
        :models="allModels"
        :current="own?.model ?? null"
        :trigger="trigger"
        @pick="pick"
        @manage="emit('openModel', own?.model ?? '')"
        @close="picking = false"
      />
    </template>

    <!-- A layer inside a repeated one is part of its template: say so, plainly. -->
    <p v-else-if="inside" class="hint" data-field="inside-repeat">
      Inside
      <button type="button" class="link" @click="emit('select', inside.address)">
        {{ inside.name }}</button
      >, repeated for each {{ inside.model ?? 'item' }}.
    </p>
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
  flex: 1;
  color: var(--text);
  font-weight: 600;
}
.switch {
  position: relative;
  width: 28px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: var(--raised);
  cursor: pointer;
  transition: background 120ms;
}
.switch[aria-checked='true'] {
  background: var(--accent);
}
.knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--text);
  transition: transform 120ms;
}
.switch[aria-checked='true'] .knob {
  background: var(--on-accent);
  transform: translateX(12px);
}
.model-trigger {
  display: flex;
  gap: var(--gap);
  align-items: center;
  height: var(--field-h);
  padding: 0 6px 0 4px;
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  background: var(--raised);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.model-trigger:hover:not(:disabled),
.model-trigger[aria-expanded='true'] {
  border-color: var(--accent);
}
.model-trigger svg {
  flex: none;
  color: var(--text-faint);
}
.glyph {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--bound) 16%, transparent);
  color: var(--bound);
  font-family: ui-monospace, monospace;
  font-size: 9px;
}
.model-name {
  flex: 1;
  font-weight: 500;
}
.placeholder {
  flex: 1;
  color: var(--text-faint);
}
.count {
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}
.hint {
  margin: 0;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
  line-height: 15px;
}
.warn {
  flex: 1;
  color: var(--warn);
}
.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
}
.link:hover {
  text-decoration: underline;
}
</style>
