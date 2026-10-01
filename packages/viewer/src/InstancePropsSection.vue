<script setup lang="ts">
import { computed } from 'vue'
import {
  addressOf,
  slotFills,
  slots,
  type JsonValue,
  type UidxDocument,
  type UidxNode,
  type UidxNodeSpec,
  type UidxPatch,
} from '@uidx/format'
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
  writable: boolean
}>()

const emit = defineEmits<{ patches: [patches: UidxPatch[]]; select: [address: string] }>()

/**
 * The definition's slots and what this instance put in each (ADR 0007): a
 * filled slot names its content and can be emptied back to the default; an
 * empty one offers the components its contract accepts, or text.
 */
const slotRows = computed(() => {
  const definition = props.definition
  if (!definition) return []
  const fills = slotFills(props.instance).fills
  const accepts = new Map(
    (definition.spec?.contract?.slots ?? []).map((slot) => [slot.name, slot.accepts]),
  )
  return [...slots(definition).declared.keys()].map((name) => {
    const fill = fills.get(name)
    const accepted = accepts.get(name)
    const allowed = accepted
      ? new Set(accepted.split(/[|,]/).map((part) => part.trim().replace(/\[\]$/, '')))
      : null
    const choices = [...(props.components?.keys() ?? [])]
      .filter((candidate) => candidate !== definition.name)
      .filter((candidate) => !allowed || allowed.has(candidate))
      .sort()
    return {
      name,
      fill,
      summary: fill ? fill.children.map((child) => child.name).join(', ') || 'empty' : '',
      choices,
    }
  })
})

function fillSlot(slot: string, choice: string): void {
  if (!choice || !props.writable) return
  const content: UidxNodeSpec =
    choice === ':text'
      ? { element: 'Text', attrs: { name: 'text', characters: 'Text' } }
      : { element: 'Instance', attrs: { name: choice.toLowerCase(), component: choice } }
  emit('patches', [
    {
      op: 'insert-node',
      parent: props.instance.address,
      index: props.instance.children.length,
      node: { element: 'Slot', attrs: { name: slot }, children: [content] },
    },
  ])
}

function clearSlot(fill: UidxNode): void {
  if (props.writable) emit('patches', [{ op: 'remove-node', address: fill.address }])
}

const rows = computed(() => instancePropRows(props.instance, props.definition))
/** The definition's contract props (ADR 0013), which the Contract tab binds rather than this section. */
const contractProps = computed(() =>
  (props.definition?.spec?.contract?.props ?? []).map((prop) => prop.name),
)
const unused = computed(() => unusedInstanceProps(props.instance, props.definition))
const undeclared = computed(() => unused.value.filter((u) => u.reason === 'undeclared'))
const mistyped = computed(() => unused.value.filter((u) => u.reason === 'mistyped'))

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
    <header class="head">
      <span class="title">Properties</span>
      <span class="of">{{ componentName }}</span>
    </header>

    <p v-if="!definition" class="empty">
      This document has no component called “{{ componentName }}”, so there is nothing to fill in.
    </p>
    <p v-else-if="!rows.length && contractProps.length" class="empty">
      “{{ componentName }}” declares no component properties. What it receives —
      {{ contractProps.join(', ') }} — is bound on the Contract tab.
    </p>
    <p v-else-if="!rows.length" class="empty">
      “{{ componentName }}” declares no properties. Select it to add some.
    </p>

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
        control rather than two.
      -->
      <!--
        An axis is a picker, because its values are stated (F8, ADR 0005 §2).
        That is the difference declaring a domain buys over Figma's inferred
        axes: there is a list to choose from rather than a string to type.
      -->
      <select
        v-if="row.domain"
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

      <!--
        Reset is only offered for a row that chose something. C7's still-open
        "clear a set property back to unset" wants the same control; when it
        lands they should be one, not two that behave almost alike.
      -->
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

    <template v-if="slotRows.length">
      <header class="head"><span class="title">Slots</span></header>
      <div v-for="slot in slotRows" :key="slot.name" class="row" :data-slot="slot.name">
        <span class="name">{{ slot.name }}</span>
        <template v-if="slot.fill">
          <button
            type="button"
            class="fill-name"
            :title="`Select what fills ${slot.name}`"
            @click="emit('select', addressOf(slot.fill.address, slot.fill.children[0]?.name ?? ''))"
          >
            {{ slot.summary }}
          </button>
          <button
            type="button"
            class="reset"
            :disabled="!writable"
            :aria-label="`Empty slot ${slot.name}`"
            title="Back to the component's default content"
            @click="clearSlot(slot.fill)"
          >
            ↺
          </button>
        </template>
        <template v-else>
          <select
            class="pick"
            :disabled="!writable"
            :aria-label="`Fill slot ${slot.name}`"
            @change="fillSlot(slot.name, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">Default content</option>
            <option value=":text">Text</option>
            <option v-for="choice in slot.choices" :key="choice" :value="choice">
              {{ choice }}
            </option>
          </select>
          <span class="reset-spacer" />
        </template>
      </div>
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
      unset row, because that is what the renderer does with it, so without this
      the row would read "nothing chosen here" while the file says otherwise.
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
.fill-name {
  overflow: hidden;
  padding: 0 6px;
  font: inherit;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  background: var(--raised);
  border: 0;
  border-radius: var(--radius-lg);
  height: var(--field-h);
  cursor: pointer;
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
  grid-template-columns: 1fr 96px auto;
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
