<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { UidxDocument, UidxNode, UidxPatch } from '@uidx/format'
import type { ModelIndex } from '@uidx/schema'
import { setRepeat } from './contract-edits'
import { REPEAT_ICON } from './layer-icons'
import { itemCount } from './model-edits'
import ModelPickerPopup from './ModelPickerPopup.vue'
import { repeatOverModel } from './repeat-edits'
import { repeatView } from './repeat-view'

/**
 * Choose a model before starting a repeat. When several reachable lists use
 * that model, ask which list to use before writing. Existing repeats name
 * their source; a child shows its inherited source before offering nesting.
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

const trigger = ref<Element | null>(null)
const picking = ref(false)
const nesting = ref(false)
const showControls = computed(() => !!own.value || !inside.value || nesting.value)
const pendingModel = ref<string | null>(null)
const sourceOptions = computed(() => {
  const model = pendingModel.value ?? own.value?.model
  return view.value?.lists.filter((entry) => entry.type.replace(/\s+/g, '') === `${model}[]`) ?? []
})
watch(
  () => props.node.address,
  () => {
    picking.value = false
    pendingModel.value = null
    nesting.value = false
  },
)

function stop(): void {
  picking.value = false
  pendingModel.value = null
  send(setRepeat(props.node, null))
}

function apply(model: string, list?: string): void {
  const current = view.value
  if (!current || !props.writable) return
  send(
    repeatOverModel(
      current.component,
      props.node,
      model,
      list ? current.lists.filter((entry) => entry.list === list) : current.lists,
      props.components,
    ),
  )
  pendingModel.value = null
  picking.value = false
}

function pick(model: string): void {
  const matching =
    view.value?.lists.filter((entry) => entry.type.replace(/\s+/g, '') === `${model}[]`) ?? []
  if (matching.length > 1) pendingModel.value = model
  else apply(model)
}

function pickSource(list: string): void {
  const model = pendingModel.value ?? own.value?.model
  if (model && sourceOptions.value.some((entry) => entry.list === list)) apply(model, list)
}
function manageModels(): void {
  picking.value = false
  emit('openModel', own.value?.model ?? '')
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
    <!-- A layer inside a repeated one is part of its template: say so, plainly. -->
    <p v-if="inside" class="hint" data-field="inside-repeat">
      Inside
      <button type="button" class="link" @click="emit('select', inside.address)">
        {{ inside.name }}</button
      >, repeated for each {{ inside.model ?? 'item' }}.
    </p>
    <button
      v-if="inside && !own && !nesting"
      type="button"
      class="link nested-repeat"
      :disabled="!writable"
      @click="nesting = true"
    >
      Repeat this layer too…
    </button>
    <div v-if="showControls" class="head">
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path :d="REPEAT_ICON" fill="none" stroke="currentColor" stroke-width="1" />
      </svg>
      <span class="title">{{ forSlot ? 'Repeat for each item' : 'Repeat with data' }}</span>
      <button v-if="own" type="button" class="link" :disabled="!writable" @click="stop">
        Stop repeating
      </button>
    </div>

    <template v-if="own">
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
        <span v-if="currentModel" class="count">{{ itemCount(currentModel) }} sample items</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
      <p v-if="own?.model" class="hint">
        {{ node.name }} is drawn once for each {{ own.model }} in {{ own.list }}.
        <button type="button" class="link" @click="emit('openModel', own.model)">
          Edit sample data
        </button>
      </p>
    </template>
    <button
      v-else-if="showControls"
      ref="trigger"
      type="button"
      class="model-trigger"
      :disabled="!writable"
      :aria-expanded="picking"
      @click="picking = !picking"
    >
      Choose data to repeat…
    </button>
    <p v-if="!own && !inside" class="hint">
      Choose a model. This layer and its contents become one item in the list.
    </p>
    <div v-if="pendingModel || sourceOptions.length > 1" class="source-choice">
      <label class="hint" for="repeat-source">{{
        pendingModel ? `Which ${pendingModel} list?` : 'List source'
      }}</label>
      <select
        id="repeat-source"
        :value="pendingModel ? '' : own?.list"
        :disabled="!writable"
        aria-label="Repeat list source"
        @change="pickSource(($event.target as HTMLSelectElement).value)"
      >
        <option value="" disabled>Choose a list…</option>
        <option v-for="entry in sourceOptions" :key="entry.list" :value="entry.list">
          {{ entry.list.replaceAll('.', ' › ') }}
        </option>
      </select>
      <button v-if="pendingModel" type="button" class="link" @click="pendingModel = null">
        Cancel
      </button>
    </div>
    <ModelPickerPopup
      v-if="picking"
      :models="allModels"
      :current="own?.model ?? null"
      :trigger="trigger"
      @pick="pick"
      @manage="manageModels"
      @close="picking = false"
    />
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
.source-choice {
  display: grid;
  gap: 6px;
}
.source-choice select {
  width: 100%;
  min-width: 0;
  height: var(--field-h);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--raised);
  color: var(--text);
  font: inherit;
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
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
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
