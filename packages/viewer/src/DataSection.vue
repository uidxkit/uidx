<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  aliasTarget,
  toAlias,
  type UidxDocument,
  type UidxNode,
  type UidxPatch,
} from '@uidx/format'
import { derivedTarget, modelOfType, type ModelIndex } from '@uidx/schema'
import { enclosingComponent } from './component-prop-edits'
import { fieldBindingCandidates, textBindingCandidates } from './contract-edits'
import InspectorSection from './InspectorSection.vue'
import InstancePropsSection from './InstancePropsSection.vue'
import ModelPickerPopup from './ModelPickerPopup.vue'
import PreviewDataSection from './PreviewDataSection.vue'
import RepeatSection from './RepeatSection.vue'

const props = defineProps<{
  doc: UidxDocument | null
  node: UidxNode | null
  selectionCount: number
  models?: ModelIndex
  components?: ReadonlyMap<string, UidxNode>
  pages?: ReadonlyMap<string, UidxDocument>
  previewIndex: number
  writable: boolean
  canMakeComponent?: boolean
}>()
const emit = defineEmits<{
  patches: [patches: UidxPatch[]]
  select: [address: string]
  openModel: [name: string]
  openComponent: [name: string]
  preview: [index: number]
  design: []
  makeComponent: []
}>()

const owner = computed(() =>
  props.node?.element === 'Component'
    ? props.node
    : props.doc && props.node
      ? enclosingComponent(props.doc, props.node.address)
      : null,
)
const definition = computed(() => {
  const name = props.node?.attrs.component?.value
  return typeof name === 'string'
    ? (props.components?.get(name) ??
        props.doc?.tree.children.find((node) => node.element === 'Component' && node.name === name))
    : undefined
})
const derived = computed(() =>
  props.doc && props.node ? derivedTarget(props.doc, props.node.address) : null,
)
const models = computed(() =>
  [...(props.models?.values() ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
)
const sources = computed(() =>
  (owner.value?.spec?.contract?.props ?? []).flatMap((prop) => {
    const found = modelOfType(prop.type, owner.value?.spec, props.models)
    return found ? [{ prop: prop.name, ...found }] : []
  }),
)
const picking = ref(false)
const trigger = ref<Element | null>(null)

/** A component receives one item; choosing a repeat creates its list separately. */
function useModel(model: string): void {
  const component = props.node
  if (!props.writable || component?.element !== 'Component' || !props.models?.has(model)) return
  const declared = component.spec?.contract?.props ?? []
  if (declared.some((prop) => prop.type.trim() === model)) return
  const base = model.charAt(0).toLowerCase() + model.slice(1)
  let name = base
  for (let n = 2; declared.some((prop) => prop.name === name); n++) name = `${base}${n}`
  emit('patches', [
    {
      op: 'contract',
      kind: 'prop',
      name,
      declaration: { attrs: { type: model }, description: `The ${model} this component displays.` },
    },
  ])
}

const textOptions = computed(() =>
  props.node?.element === 'Text'
    ? textBindingCandidates(owner.value, props.node, props.models)
    : [],
)
const visibilityOptions = computed(() =>
  props.node &&
  owner.value &&
  props.node.element !== 'Component' &&
  props.node.element !== 'Instance'
    ? fieldBindingCandidates(owner.value, props.node, 'boolean', props.models)
    : [],
)
const bound = (prop: string) => aliasTarget(props.node?.attrs[prop]?.value ?? null) ?? ''
function bind(prop: string, alias: string): void {
  if (!props.writable || !props.node || !alias) return
  const options = prop === 'characters' ? textOptions.value : visibilityOptions.value
  if (!options.some((option) => option.alias === alias)) return
  emit('patches', [
    {
      op: props.node.attrs[prop] ? 'set' : 'add',
      address: props.node.address,
      prop,
      value: toAlias(alias),
    },
  ])
}

/** Select a visual first: even an unbound text is a way into field mapping. */
const layers = computed(() => {
  const out: { address: string; name: string; source: string | null; kind: string }[] = []
  const visit = (node: UidxNode): void => {
    if (node.element === 'Text')
      out.push({
        address: node.address,
        name: node.name,
        source: aliasTarget(node.attrs.characters?.value ?? null),
        kind: 'text',
      })
    if (node.element === 'Instance') {
      const values = node.attrs.props?.value
      const aliases =
        values && typeof values === 'object' && !Array.isArray(values)
          ? Object.values(values)
              .map(aliasTarget)
              .filter((value) => value && !value.includes('#'))
          : []
      out.push({
        address: node.address,
        name: node.name,
        source: aliases.join(', ') || null,
        kind: 'component',
      })
    } else node.children.forEach(visit)
  }
  props.node?.children.forEach(visit)
  return out
})
function manageModels(): void {
  picking.value = false
  emit('openModel', '')
}
</script>

<template>
  <div class="data-panel" aria-label="Layer data">
    <header class="intro">
      <strong>Data</strong>
      <button type="button" class="link" @click="emit('openModel', '')">Manage models</button>
    </header>
    <template v-if="!node">
      <p class="hint">
        {{
          selectionCount > 1
            ? 'Select one layer to connect its data.'
            : 'Select a component or a layer to connect it to data.'
        }}
      </p>
      <p class="hint">Models define the fields and sample items your designs display.</p>
    </template>
    <template v-else-if="derived">
      <p class="hint">This state uses the base layer’s data connections.</p>
      <button type="button" class="action" @click="emit('select', derived!.base.address)">
        Edit base layer
      </button>
    </template>
    <template v-else>
      <InspectorSection v-if="node.element === 'Component'" title="Model" :meta="node.name">
        <p v-if="!sources.length" class="hint">
          Choose a model to design this component around one item, such as a person or a product.
        </p>
        <div
          v-for="source in sources"
          :key="source.prop"
          class="source"
          :data-model="source.model.name"
        >
          <span
            ><strong>{{ source.model.name }}</strong
            ><small
              >{{ source.list ? 'List of items' : 'One item' }} · {{ source.prop }}</small
            ></span
          >
          <button type="button" class="link" @click="emit('openModel', source.model.name)">
            Edit sample data
          </button>
        </div>
        <button
          ref="trigger"
          type="button"
          class="action"
          :disabled="!writable"
          :aria-expanded="picking"
          @click="picking = !picking"
        >
          {{ sources.length ? 'Add another model…' : 'Choose a model…' }}
        </button>
        <ModelPickerPopup
          v-if="picking"
          :models="models"
          :current="null"
          :trigger="trigger"
          @pick="useModel"
          @manage="manageModels"
          @close="picking = false"
        />
        <p class="hint">To build a list, select the layer to copy and choose Repeat with data.</p>
      </InspectorSection>

      <RepeatSection
        v-if="owner && node.element !== 'Component'"
        :doc="doc"
        :node="node"
        :models="props.models"
        :components="components"
        :writable="writable"
        @patches="emit('patches', $event)"
        @select="emit('select', $event)"
        @open-model="emit('openModel', $event)"
      />

      <InstancePropsSection
        v-if="node.element === 'Instance'"
        view="data"
        :doc="doc"
        :instance="node"
        :definition="definition"
        :components="components"
        :models="props.models"
        :pages="pages"
        :preview-index="previewIndex"
        :writable="writable"
        @patches="emit('patches', $event)"
        @select="emit('select', $event)"
        @open-component="emit('openComponent', $event)"
        @open-model="emit('openModel', $event)"
        @preview="emit('preview', $event)"
      />

      <InspectorSection v-else-if="!owner" title="Connect this layer">
        <p class="hint">
          Data connections belong to a reusable component. Create a component from this selection to
          connect models and repeat its layers.
        </p>
        <button
          v-if="canMakeComponent"
          type="button"
          class="action"
          :disabled="!writable"
          @click="emit('makeComponent')"
        >
          Create component
        </button>
      </InspectorSection>

      <InspectorSection v-if="node.element === 'Text' && owner" title="Text content">
        <label class="field">
          <span>Show a field</span>
          <select
            :value="bound('characters')"
            :disabled="!writable || !textOptions.length"
            aria-label="Text content field"
            @change="bind('characters', ($event.target as HTMLSelectElement).value)"
          >
            <option value="" disabled>Choose a field…</option>
            <option
              v-if="
                bound('characters') &&
                !textOptions.some((option) => option.alias === bound('characters'))
              "
              :value="bound('characters')"
            >
              {{ bound('characters') }} · unavailable
            </option>
            <option v-for="option in textOptions" :key="option.alias" :value="option.alias">
              {{ option.label }}
            </option>
          </select>
        </label>
        <p v-if="!textOptions.length" class="hint">
          Choose a model on the component, or repeat a parent layer, to make fields available here.
        </p>
        <p class="hint">
          For fixed text,
          <button type="button" class="link" @click="emit('design')">edit Content in Design</button
          >.
        </p>
      </InspectorSection>

      <InspectorSection v-if="visibilityOptions.length" title="Visibility">
        <label class="field"
          ><span>Show when</span
          ><select
            :value="bound('visible')"
            :disabled="!writable"
            aria-label="Visibility field"
            @change="bind('visible', ($event.target as HTMLSelectElement).value)"
          >
            <option value="" disabled>Choose a true / false field…</option>
            <option
              v-if="
                bound('visible') &&
                !visibilityOptions.some((option) => option.alias === bound('visible'))
              "
              :value="bound('visible')"
            >
              {{ bound('visible') }} · unavailable
            </option>
            <option v-for="option in visibilityOptions" :key="option.alias" :value="option.alias">
              {{ option.label }}
            </option>
          </select></label
        >
      </InspectorSection>

      <InspectorSection
        v-if="layers.length && owner"
        title="Connect layers"
        :meta="String(layers.length)"
      >
        <p class="hint">Select text or a component instance to choose the data it displays.</p>
        <button
          v-for="text in layers"
          :key="text.address"
          type="button"
          class="text-layer"
          @click="emit('select', text.address)"
        >
          <span>{{ text.name }}</span
          ><span>{{
            text.source?.replaceAll('.', ' › ') ??
            (text.kind === 'text' ? 'Choose field →' : 'Choose data →')
          }}</span>
        </button>
      </InspectorSection>
      <PreviewDataSection
        v-if="node.element === 'Component'"
        :component="node"
        :models="props.models"
        :index="previewIndex"
        @preview="emit('preview', $event)"
        @open-model="emit('openModel', $event)"
      />
    </template>
  </div>
</template>

<style scoped>
.data-panel {
  min-width: 0;
}
.intro,
.source {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 0;
}
.intro {
  border-bottom: 1px solid var(--line);
}
.source {
  align-items: start;
}
.source > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.source small {
  display: block;
  color: var(--text-faint);
  margin-top: 4px;
}
.hint {
  margin: 8px 0;
  color: var(--text-dim);
  font-size: var(--ui-size-sm);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.link {
  border: 0;
  padding: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
}
.action {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--raised);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
.field {
  display: grid;
  gap: 6px;
  color: var(--text-dim);
}
select {
  width: 100%;
  min-width: 0;
  height: var(--field-h);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--raised);
  color: var(--text);
  font: inherit;
}
.text-layer {
  display: flex;
  width: 100%;
  gap: 8px;
  justify-content: space-between;
  padding: 8px 0;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.text-layer span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.text-layer span:last-child {
  color: var(--bound);
  font-size: var(--ui-size-sm);
}
.repeat-section {
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
