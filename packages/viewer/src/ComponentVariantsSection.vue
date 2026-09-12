<script setup lang="ts">
import { computed, ref } from 'vue'
import { componentVariants, type UidxDocument, type UidxNode, type UidxPatch } from '@uidx/format'
import {
  addAxisValue,
  addVariant,
  emptyCombinations,
  instancesNaming,
  isAxisValueFree,
  removeAxisValue,
  removeVariant,
  renameAxisValue,
} from './variant-edits'

/**
 * A `<Component>`'s states, at the top of the inspector (story F9).
 *
 * Above the component's properties, because a state is the coarser fact —
 * *which* button this is, before what it says — and because it is the shape of
 * the thing the canvas is showing as a labelled set.
 *
 * Two things it deliberately cannot do, and the reason is the format's rather
 * than a preference: **adding, removing or renaming an axis** each need the
 * declaration on the `<Component>` and the coordinates on every `<Variant>` to
 * move together, and `applyPatches` re-parses between ops, so there is no
 * ordering where every intermediate document is valid. Renaming a *value* is
 * possible, and `renameAxisValue` is the widen-move-narrow that gets there.
 */
const props = defineProps<{
  doc: UidxDocument | null
  component: UidxNode
  /** Every page, for finding the instances a rename has to carry (F9). */
  pages?: ReadonlyMap<string, UidxDocument>
  /** The page this component is on — the file its own edits are addressed to. */
  file?: string
  writable: boolean
}>()

const emit = defineEmits<{
  patches: [patches: UidxPatch[]]
  /** An edit that lands in several files at once, one envelope per page. */
  remap: [byFile: ReadonlyMap<string, UidxPatch[]>]
  /** Why an edit was refused, in words meant for the author. */
  refused: [reason: string]
}>()

const axes = computed(() => [...componentVariants(props.component).axes])
const variants = computed(() => props.component.children.filter((c) => c.element === 'Variant'))
const empty = computed(() => emptyCombinations(props.component))

function send(patches: UidxPatch[] | null): void {
  if (patches) emit('patches', patches)
}

/** The two-outcome shape: patches, or a sentence saying why not. */
function decide(result: { patches: UidxPatch[] | null; refusal: string | null }): void {
  if (result.patches) emit('patches', result.patches)
  else if (result.refusal) emit('refused', result.refusal)
}

/* ------------------------------------------------------- adding a value */

const adding = ref<string | null>(null)
const draft = ref('')

const draftFree = computed(() => {
  const axis = axes.value.find(([name]) => name === adding.value)
  return axis ? isAxisValueFree(axis[1], draft.value) : false
})

function startAdd(axis: string): void {
  adding.value = axis
  draft.value = ''
}

function confirmAdd(): void {
  if (!props.doc || !adding.value || !draftFree.value) return
  send(addAxisValue(props.doc, props.component.address, adding.value, draft.value))
  adding.value = null
}

/* ---------------------------------------------------- renaming a value */

const renaming = ref<string | null>(null)
const renameDraft = ref('')

/**
 * Which value is being renamed, keyed `axis=value`.
 *
 * Two axes may each have a `default`, so the axis has to be part of the key —
 * and `=` is a safe separator by construction, since an axis name or value
 * carrying one is UIDX117.
 */
const keyOf = (axis: string, value: string) => `${axis}=${value}`

function startRename(axis: string, value: string): void {
  renaming.value = keyOf(axis, value)
  renameDraft.value = value
}

/**
 * A rename lands in every file that names the value.
 *
 * The component's page carries the declaration and the variants; each consuming
 * page carries its own instances. They go as separate envelopes because a patch
 * envelope is page-addressed and two pages do not share a revision — see
 * `commitAcrossPages`, which is where the honesty about that lives.
 */
function commitRename(axis: string, from: string): void {
  // Enter clears `renaming`, which unmounts the input, which fires `blur` —
  // so without this the same edit is sent twice. The second envelope is
  // written against a revision the first already moved, so it goes stale, its
  // targets are gone (the variant it named has been renamed), and the author
  // is told their edit "was not applied" about an edit that landed. Measured
  // live; the guard is that only the row still being renamed may commit.
  if (renaming.value !== keyOf(axis, from)) return
  const to = renameDraft.value
  renaming.value = null
  if (!props.doc || !props.file || to === from) return

  const own = renameAxisValue(props.doc, props.component.address, axis, from, to)
  if (!own) return

  const byFile = new Map<string, UidxPatch[]>([[props.file, own]])
  for (const [file, patches] of instancesNaming(
    props.pages ?? new Map(),
    props.component.name,
    axis,
    from,
    to,
  )) {
    byFile.set(file, [...(byFile.get(file) ?? []), ...patches])
  }
  emit('remap', byFile)
}
</script>

<template>
  <section class="variants" aria-label="Variants">
    <header class="head">
      <span class="title">Variants</span>
      <span class="count"
        >{{ variants.length }} {{ variants.length === 1 ? 'state' : 'states' }}</span
      >
    </header>

    <div v-for="[axis, domain] in axes" :key="axis" class="axis" :data-axis="axis">
      <div class="axis-head">
        <span class="axis-name">{{ axis }}</span>
        <button
          type="button"
          class="add"
          :disabled="!writable"
          :aria-label="`Add a value to ${axis}`"
          :title="`Add a value to ${axis}`"
          @click="startAdd(axis)"
        >
          +
        </button>
      </div>

      <div class="values">
        <template v-for="value in domain" :key="value">
          <input
            v-if="renaming === keyOf(axis, value)"
            v-model="renameDraft"
            class="rename"
            :aria-label="`Rename ${value}`"
            @keydown.enter.stop="commitRename(axis, value)"
            @keydown.esc.stop="renaming = null"
            @blur="commitRename(axis, value)"
          />
          <span v-else class="value" :data-value="value" :data-default="value === domain[0]">
            <button
              type="button"
              class="value-name"
              :disabled="!writable"
              :title="
                value === domain[0]
                  ? 'The default — an instance that says nothing renders this'
                  : 'Rename, carrying every state and every instance with it'
              "
              @click="startRename(axis, value)"
            >
              {{ value }}
            </button>
            <button
              type="button"
              class="drop"
              :disabled="!writable"
              :aria-label="`Remove ${value}`"
              @click="doc && decide(removeAxisValue(doc, component.address, axis, value))"
            >
              ×
            </button>
          </span>
        </template>
      </div>

      <div v-if="adding === axis" class="adding">
        <input
          v-model="draft"
          class="rename"
          placeholder="value"
          :aria-label="`New value for ${axis}`"
          @keydown.enter.stop="confirmAdd"
          @keydown.esc.stop="adding = null"
        />
        <button type="button" class="confirm" :disabled="!draftFree" @click="confirmAdd">
          Add
        </button>
        <button type="button" class="drop" aria-label="Cancel" @click="adding = null">×</button>
      </div>
    </div>

    <!--
      The combinations this component could have and does not. Offered rather
      than filled in: sparseness is deliberate (ADR 0005 §2), so a
      `size=lg, state=disabled` nobody designed is a combination that does not
      exist, not a gap to be closed.
    -->
    <div v-if="empty.length" class="gaps">
      <p class="gaps-head">Not designed yet</p>
      <button
        v-for="cell in empty"
        :key="cell.name"
        type="button"
        class="gap"
        :disabled="!writable"
        :title="`Add ${cell.name}, copied from the closest state`"
        @click="doc && send(addVariant(doc, component.address, cell.coordinates))"
      >
        + {{ cell.name }}
      </button>
    </div>

    <div class="states">
      <div v-for="state in variants" :key="state.address" class="state" :data-state="state.name">
        <span class="state-name">{{ state.name }}</span>
        <button
          type="button"
          class="drop"
          :disabled="!writable"
          :aria-label="`Remove ${state.name}`"
          @click="doc && decide(removeVariant(doc, state.address))"
        >
          ×
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.variants {
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
  flex: 1;
  color: var(--text);
  font-weight: 600;
}
.count {
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}
.axis {
  padding-top: var(--gap-sm);
}
.axis-head {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  height: var(--row-h);
}
.axis-name {
  flex: 1;
  color: var(--text-dim);
}
.values {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.value {
  display: inline-flex;
  align-items: center;
  background: var(--raised);
  border-radius: var(--radius);
}
/* The first value of each axis is the default combination's — say so. */
.value[data-default='true'] {
  outline: 1px solid var(--accent);
}
.value-name,
.state-name {
  padding: 2px 4px;
  background: none;
  border: none;
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
.value-name:hover:not(:disabled) {
  color: var(--accent);
}
.add,
.drop,
.confirm,
.gap {
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
.confirm:hover:not(:disabled),
.gap:hover:not(:disabled) {
  background: var(--raised);
  color: var(--text);
}
.adding {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-top: 4px;
}
.rename {
  height: var(--field-h);
  min-width: 0;
  padding: 0 6px;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  color: var(--text);
  font: inherit;
}
.gaps {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding-top: var(--gap-sm);
}
.gaps-head {
  flex: 1 0 100%;
  margin: 0;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}
.gap {
  border: 1px dashed var(--line);
  color: var(--text-faint);
}
.states {
  padding-top: var(--gap-sm);
}
.state {
  display: flex;
  align-items: center;
  height: var(--row-h);
}
.state-name {
  flex: 1;
  cursor: default;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
