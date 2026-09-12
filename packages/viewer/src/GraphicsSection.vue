<script setup lang="ts">
import { computed } from 'vue'
import { parseSVGPath } from '@open-pencil/scene-graph/parse-path'
import type { JsonValue, UidxNode, UidxPatch } from '@uidx/format'
import { subpathsOf, type VectorAction, type VectorEditInfo } from './vertex-edit'

const props = defineProps<{
  node: UidxNode
  info?: VectorEditInfo | null
  writable: boolean
  canMakeComponent: boolean
}>()
const emit = defineEmits<{
  edit: [address: string]
  finish: []
  action: [action: VectorAction]
  makeComponent: []
  patches: [patches: UidxPatch[]]
}>()
const editing = computed(() => (props.info?.id === props.node.address ? props.info : null))
const paths = computed(() => {
  const value = props.node.attrs.vectorPaths?.value
  return Array.isArray(value)
    ? value.filter(
        (p): p is Record<string, JsonValue> =>
          !!p && typeof p === 'object' && !Array.isArray(p) && typeof p.data === 'string',
      )
    : []
})
const chains = computed(() =>
  paths.value.flatMap((path) => {
    try {
      return subpathsOf(parseSVGPath(path.data as string))
    } catch {
      return []
    }
  }),
)
const pointCount = computed(
  () => editing.value?.points ?? chains.value.reduce((n, p) => n + p.vertices.length, 0),
)
const pathCount = computed(() => editing.value?.paths ?? chains.value.length)
const fillRule = computed(() => {
  const rules = new Set(paths.value.map((p) => p.windingRule ?? 'NONZERO'))
  return rules.size > 1 ? 'mixed' : ([...rules][0] ?? 'NONZERO')
})
function setFillRule(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  if (!props.writable || (value !== 'NONZERO' && value !== 'EVENODD')) return
  // Keep the original path spelling: changing its fill is not a geometry edit.
  emit('patches', [
    {
      op: 'set',
      address: props.node.address,
      prop: 'vectorPaths',
      value: paths.value.map((path) => ({ ...path, windingRule: value })),
    },
  ])
}
</script>

<template>
  <section class="graphics-section" aria-label="Vector graphics">
    <div class="heading">
      <h3>Vector</h3>
      <span
        >{{ pointCount }} points · {{ pathCount }} {{ pathCount === 1 ? 'path' : 'paths' }}</span
      >
    </div>
    <button
      v-if="!editing"
      type="button"
      class="edit-vector"
      :disabled="!writable || !pointCount"
      title="Edit points and curves — Enter"
      @click="emit('edit', node.address)"
    >
      Edit vector <kbd>↵</kbd>
    </button>
    <template v-else>
      <div class="editing-heading">
        <span>Editing points</span><button type="button" @click="emit('finish')">Done</button>
      </div>
      <p class="hint">Select a point to refine it. Double-click a path to add a point.</p>
      <div class="point-actions">
        <button
          type="button"
          :disabled="!writable || !editing.selected"
          @click="emit('action', 'corner')"
        >
          Corner
        </button>
        <button
          type="button"
          :disabled="!writable || !editing.selected"
          @click="emit('action', 'smooth')"
        >
          Smooth
        </button>
        <button
          type="button"
          :disabled="!writable || !editing.selected"
          title="Add a point halfway along the adjacent segment"
          @click="emit('action', 'insert')"
        >
          Add point
        </button>
        <button
          type="button"
          :disabled="!writable || !editing.canDelete"
          @click="emit('action', 'delete')"
        >
          Delete point
        </button>
      </div>
      <button
        type="button"
        class="path-toggle"
        :disabled="!writable || editing.closed === null"
        @click="emit('action', 'toggle-closed')"
      >
        {{ editing.closed ? 'Open path' : 'Close path' }}
      </button>
    </template>
    <label class="fill-rule"
      >Fill rule
      <select
        aria-label="Vector fill rule"
        :value="fillRule"
        :disabled="!writable || !paths.length || !!editing"
        @change="setFillRule"
      >
        <option v-if="fillRule === 'mixed'" value="mixed" disabled>Mixed</option>
        <option value="NONZERO">Nonzero</option>
        <option value="EVENODD">Even-odd</option>
      </select>
    </label>
    <button
      v-if="!editing && canMakeComponent"
      type="button"
      class="reuse"
      :disabled="!writable"
      @click="emit('makeComponent')"
    >
      Make reusable component
    </button>
  </section>
</template>

<style scoped>
.graphics-section {
  margin: 0 calc(-1 * var(--section-pad));
  padding: 12px var(--section-pad);
  border-bottom: 1px solid var(--line);
}
.heading,
.editing-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
h3 {
  margin: 0;
  font-size: var(--ui-size);
  font-weight: 600;
}
.heading > span,
.hint {
  font-size: var(--ui-size-sm);
  color: var(--text-dim);
}
.hint {
  line-height: 1.6;
  margin: 8px 0;
}
button,
select {
  font: inherit;
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--raised);
  padding: 5px 8px;
}
button {
  cursor: pointer;
}
button:hover:not(:disabled) {
  border-color: var(--accent);
}
button:disabled,
select:disabled {
  opacity: 0.4;
  cursor: default;
}
.edit-vector {
  display: flex;
  justify-content: space-between;
  width: 100%;
  margin-top: 10px;
}
kbd {
  color: var(--text-dim);
  font: inherit;
}
.editing-heading {
  color: var(--accent);
  margin-top: 10px;
}
.point-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}
.path-toggle,
.reuse {
  width: 100%;
  margin-top: 6px;
}
.fill-rule {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
  color: var(--text-dim);
}
.fill-rule select {
  max-width: 128px;
}
</style>
