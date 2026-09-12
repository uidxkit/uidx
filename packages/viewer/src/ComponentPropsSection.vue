<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  componentProps,
  PROPERTY_FIELD,
  type JsonValue,
  type PropertyType,
  type UidxDocument,
  type UidxNode,
  type UidxPatch,
} from '@uidx/format'
import { bindingSites, declareProperty, defaultFor, removeProperty } from './component-prop-edits'
import { rewriteInstanceProps } from './variant-edits'
import { editProperty } from './component-prop-edits'
import { FieldIcon } from './field-icons'
import PropertyDialog from './PropertyDialog.vue'

/**
 * A `<Component>`'s own properties, above the layer's (story F6).
 *
 * F6 warned about the naming collision this creates: this repo already calls a
 * scene attribute a "property" — `PROP_TABLE`, `prop-ui.ts`, every section C6
 * built. These are a different thing in the same panel, so they are named apart
 * everywhere they appear: "Component properties" here, "component-prop" in the
 * code, and the layer's own sections keep the bare word.
 *
 * Emits patches rather than the panel's `commit`, and that is not a shortcut:
 * `props` is in `STRUCTURAL_PROPS`, so `scenePropFor` stops it and it never
 * reaches a scene node. A declaration is a structural edit, and it travels the
 * route the layers rail's structural edits travel.
 */
const props = defineProps<{
  doc: UidxDocument | null
  component: UidxNode
  /**
   * Every page, so a rename can carry the instances that set the old name (F9).
   *
   * F6 shipped this rename carrying every *binding* inside the component and
   * noted that instance values would join the list when F7 built them. They
   * did, and this is that: the values sit on the consuming pages, which is why
   * it needed the page-addressed envelope F9 taught the shell to send.
   */
  pages?: ReadonlyMap<string, UidxDocument>
  /** The page this component is on — the file its own edits are addressed to. */
  file?: string
  writable: boolean
}>()

const emit = defineEmits<{
  patches: [patches: UidxPatch[]]
  /** A rename that reaches instances on other pages, one envelope per page. */
  remap: [byFile: ReadonlyMap<string, UidxPatch[]>]
}>()

const declared = computed(() => componentProps(props.component).declared)
const rows = computed(() =>
  [...declared.value].map(([name, declaration]) => ({
    name,
    ...declaration,
    fills: PROPERTY_FIELD[declaration.type],
    /**
     * How many layers read it. Shown because it is the difference between
     * "this is safe" and "this touches four layers", and the author should
     * know which they are about to do before renaming or removing.
     */
    uses: bindingSites(props.component, name).length,
  })),
)

function send(patches: UidxPatch[] | null): void {
  if (patches) emit('patches', patches)
}

/* ------------------------------------------------------------ adding one */

/**
 * `+` opens the same dialog a row's edit button does, with the type still to
 * pick — a declaration made here has no field implying one.
 */
const adding = ref(false)

function startAdd(): void {
  editing.value = null
  adding.value = true
}

function commitAdd(name: string, value: JsonValue, type: PropertyType): void {
  if (!props.doc) return
  const patches = declareProperty(props.doc, props.component.address, name, type, value)
  if (!patches) return
  adding.value = false
  emit('patches', patches)
}

/* ------------------------------------------------------- editing the rows */

/** The glyph a property wears, by type — Figma's `T`, eye and diamond. */
const TYPE_ICON = {
  TEXT: 'prop-text',
  BOOLEAN: 'prop-boolean',
  INSTANCE_SWAP: 'prop-instance',
} as const

/** How a default reads in a pill: Figma spells a boolean True/False. */
function shown(value: JsonValue): string {
  return value === true ? 'True' : value === false ? 'False' : String(value)
}

/** The property the dialog is editing, or null while it is closed. */
const editing = ref<string | null>(null)

const editingRow = computed(() => rows.value.find((row) => row.name === editing.value) ?? null)

/**
 * Rename and re-default together, through the one path a rename already takes.
 *
 * `editProperty` builds the single envelope, and the cross-page instance sweep
 * below is the same one `commitRename` needs — extracted rather than repeated,
 * because an instance left holding a key its component no longer declares is
 * exactly the debt F6 shipped with.
 */
function commitEdit(to: string, value: JsonValue): void {
  const from = editing.value
  if (!props.doc || !from) return
  const own = editProperty(props.doc, props.component.address, from, to, value)
  if (!own) return
  editing.value = null
  sendRenaming(from, to.trim(), own)
}

/**
 * Emit a rename, carrying every instance that set the old name.
 *
 * On this page they ride in the same envelope as the declaration; on any other
 * they need their own, because an envelope is page-addressed and two pages do
 * not share a revision.
 */
function sendRenaming(from: string, to: string, own: UidxPatch[]): void {
  const byFile = new Map<string, UidxPatch[]>([[props.file ?? '', own]])
  for (const [file, patches] of rewriteInstanceProps(
    props.pages ?? new Map(),
    props.component.name,
    (values) => {
      if (!values.has(from)) return false
      // Rebuilt rather than mutated in place, so the renamed key keeps the
      // position it had — a rename should not reshuffle the author's order.
      const next = [...values].map(([k, v]): [string, JsonValue] => [k === from ? to : k, v])
      values.clear()
      for (const [k, v] of next) values.set(k, v)
      return true
    },
  )) {
    byFile.set(file, [...(byFile.get(file) ?? []), ...patches])
  }

  if (props.file && byFile.size > 1) emit('remap', byFile)
  else emit('patches', byFile.get(props.file ?? '') ?? own)
}

function drop(name: string): void {
  if (!props.doc) return
  // The default is baked in wherever the property was read, so the component
  // keeps looking exactly as it did — `removeProperty` decides that, not this.
  send(removeProperty(props.doc, props.component.address, name))
}
</script>

<template>
  <section class="component-props" aria-label="Component properties">
    <header class="head">
      <!--
        "Properties", Figma's word. F6 named it apart from the layer's own to
        stop every later conversation costing a paragraph of disambiguation —
        that concern was about the *code*, which still says `component-prop`
        throughout. On screen no other section is called this, so the longer
        name only made the panel read less like the tool it mirrors.
      -->
      <span class="title">Properties</span>
      <button
        type="button"
        class="add"
        :disabled="!writable"
        aria-label="Add component property"
        title="Add component property"
        @click="startAdd"
      >
        +
      </button>
    </header>

    <p v-if="!rows.length && !adding" class="empty">
      None yet. A property is what an instance may change without reaching inside.
    </p>

    <div v-for="row in rows" :key="row.name" class="row" :data-prop="row.name">
      <!--
        Name and value in one pill, the way Figma reads them: the pair is the
        fact — "label says Click" — and splitting it across a button, a type
        word and an input made three controls out of one sentence. Editing is
        behind the dialog now, so the row is a statement rather than a form.
      -->
      <button
        type="button"
        class="pill"
        :disabled="!writable"
        :title="`Fills ${row.fills} · read by ${row.uses} layer${row.uses === 1 ? '' : 's'}`"
        @click="editing = row.name"
      >
        <FieldIcon :name="TYPE_ICON[row.type]" />
        <span class="pill-name">{{ row.name }}</span>
        <span class="pill-sep">·</span>
        <span class="pill-value">{{ shown(row.default) }}</span>
      </button>

      <button
        type="button"
        class="edit"
        :disabled="!writable"
        :aria-label="`Edit ${row.name}`"
        title="Edit"
        @click="editing = row.name"
      >
        <FieldIcon name="apply-property" />
      </button>

      <button
        type="button"
        class="drop"
        :disabled="!writable"
        :aria-label="`Remove ${row.name}`"
        :title="
          row.uses
            ? `Remove — the ${row.uses} layer${row.uses === 1 ? '' : 's'} reading it keep this value`
            : 'Remove'
        "
        @click="drop(row.name)"
      >
        −
      </button>
    </div>

    <PropertyDialog
      v-if="editingRow"
      :key="editingRow.name"
      mode="edit"
      :type="editingRow.type"
      :name="editingRow.name"
      :value="editingRow.default"
      @submit="commitEdit"
      @close="editing = null"
    />

    <PropertyDialog
      v-if="adding"
      mode="create"
      :type="null"
      :value="defaultFor('TEXT')"
      @submit="commitAdd"
      @close="adding = false"
    />
  </section>
</template>

<style scoped>
.component-props {
  /* Anchors the add/edit dialog, which is absolutely positioned. */
  position: relative;
  padding: var(--pad);
  border-bottom: 1px solid var(--line);
}
.head {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  height: var(--row-h);
}
.title {
  flex: 1;
  color: var(--text);
  font-weight: 600;
}
.add,
.drop,
.confirm {
  height: var(--icon);
  min-width: var(--icon);
  padding: 0 4px;
  background: none;
  border: none;
  border-radius: var(--radius);
  color: var(--text-dim);
  font: inherit;
  line-height: 1;
  cursor: pointer;
}
.add:hover:not(:disabled),
.drop:hover:not(:disabled),
.confirm:hover:not(:disabled) {
  background: var(--raised);
  color: var(--text);
}
.row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 2px;
  height: var(--row-h);
}

/*
 * The property as one pill — glyph, name, value — because that is the sentence
 * the author reads. The controls beside it only appear on hover, so a list of
 * four properties is four statements rather than twelve controls.
 */
.pill {
  display: flex;
  gap: var(--gap-sm);
  align-items: center;
  min-width: 0;
  height: var(--field-h);
  padding: 0 6px;
  border: 0;
  border-radius: var(--radius);
  background: var(--raised);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.pill:hover:not(:disabled) {
  background: var(--line);
}
.pill:disabled {
  cursor: default;
}
.pill svg {
  flex: none;
  color: var(--text-faint);
}
.pill-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.pill-sep,
.pill-value {
  color: var(--text-faint);
}
.pill-value {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.edit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--row-h);
  height: var(--row-h);
  padding: 0;
  border: 0;
  border-radius: var(--radius);
  background: none;
  color: var(--text-dim);
  cursor: pointer;
  opacity: 0;
}
.row:hover .edit,
.row:hover .drop,
.edit:focus-visible,
.drop:focus-visible {
  opacity: 1;
}
.edit:hover:not(:disabled) {
  background: var(--raised);
  color: var(--text);
}
.drop {
  opacity: 0;
}
.row.adding {
  grid-template-columns: 1fr auto auto auto;
}
.name {
  padding: 0;
  background: none;
  border: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.name:hover:not(:disabled) {
  color: var(--accent);
}
.type {
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}
.rename,
.text,
.type-pick {
  height: var(--field-h);
  min-width: 0;
  padding: 0 6px;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  color: var(--text);
  font: inherit;
}
.bool {
  justify-self: start;
  margin: 0;
}
.empty {
  margin: 0;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}
</style>
