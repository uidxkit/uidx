<script setup lang="ts">
import { focusEdit } from './focus-edit'
import { computed, ref } from 'vue'
import type { UidxNode, UidxNodeSpec } from '@uidx/format'
import type { DrawingTool } from './graphics-tools'
import { BLOCKS } from './insert-blocks'

/**
 * Builder's Insert tab, for this editor: drawing tools, ready-made blocks,
 * an image from disk, and every component in the document — the things you
 * add, in one place, rather than behind toolbar glyphs and a dialog.
 */
const props = defineProps<{
  components: ReadonlyMap<string, UidxNode>
  writable: boolean
  /** The tool armed on the canvas, shown as pressed. */
  tool: DrawingTool | null
  placing: string | null
}>()

const emit = defineEmits<{
  tool: [tool: DrawingTool]
  insert: [node: UidxNodeSpec]
  image: [file: File]
  place: [component: string]
}>()

const DRAW: { tool: DrawingTool; label: string; key: string; icon: string }[] = [
  { tool: 'Frame', label: 'Frame', key: 'F', icon: 'M5 1.5v13M11 1.5v13M1.5 5h13M1.5 11h13' },
  { tool: 'Text', label: 'Text', key: 'T', icon: 'M3 3.5h10M8 3.5v9.5M6 13h4' },
  { tool: 'Rectangle', label: 'Rectangle', key: 'R', icon: 'M2.5 3.5h11v9h-11z' },
  { tool: 'Ellipse', label: 'Ellipse', key: 'O', icon: 'M8 3a5.5 5 0 1 0 0 10A5.5 5 0 1 0 8 3z' },
  { tool: 'Line', label: 'Line', key: 'L', icon: 'M3 13L13 3' },
  { tool: 'Vector', label: 'Pen', key: 'P', icon: 'M3 13l1.5-5 6-6 3.5 3.5-6 6zM4.5 8l3.5 3.5' },
]

const query = ref('')
const componentRows = computed(() => {
  const q = query.value.trim().toLowerCase()
  return [...props.components.values()]
    .filter((node) => !q || node.name.toLowerCase().includes(q))
    .map((node) => {
      const status = node.attrs.status?.value
      return {
        name: node.name,
        status: typeof status === 'string' ? status : null,
        summary: node.spec?.contract?.props.length
          ? `${node.spec.contract.props.length} prop${node.spec.contract.props.length === 1 ? '' : 's'}`
          : '',
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
})
const blocks = computed(() => {
  const q = query.value.trim().toLowerCase()
  return BLOCKS.filter((block) => !q || block.label.toLowerCase().includes(q))
})

const picker = ref<HTMLInputElement | null>(null)
function chosen(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) emit('image', file)
  ;(event.target as HTMLInputElement).value = ''
}
</script>

<template>
  <div class="insert" aria-label="Insert">
    <div class="search">
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.4" />
        <path
          d="M10.5 10.5 14 14"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
        />
      </svg>
      <!-- The caret is here when the panel opens: "Person" then a click, not a hunt. -->
      <input
        v-model="query"
        type="search"
        placeholder="Search"
        aria-label="Search"
        @vue:mounted="focusEdit"
      />
    </div>

    <section v-if="!query">
      <h3>Draw</h3>
      <div class="grid">
        <button
          v-for="item in DRAW"
          :key="item.tool"
          type="button"
          class="tile"
          :data-tool="item.tool"
          :aria-pressed="tool === item.tool"
          :disabled="!writable"
          :title="`${item.label} (${item.key}) — then drag on the canvas`"
          @click="emit('tool', item.tool)"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
            <path
              :d="item.icon"
              fill="none"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linejoin="round"
              stroke-linecap="round"
            />
          </svg>
          <span>{{ item.label }}</span>
        </button>
        <button
          type="button"
          class="tile"
          data-tool="image"
          :disabled="!writable"
          title="Choose a PNG, JPEG, GIF, WebP or AVIF; it is saved into assets/"
          @click="picker?.click()"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M2.5 3h11v10h-11zM2.5 11l3.5-3.5 3 3 2-2 2.5 2.5M10.5 6h.01"
              fill="none"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linejoin="round"
              stroke-linecap="round"
            />
          </svg>
          <span>Image</span>
        </button>
        <input
          ref="picker"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
          hidden
          @change="chosen"
        />
      </div>
    </section>

    <section v-if="blocks.length">
      <h3>Blocks</h3>
      <div class="list">
        <button
          v-for="block in blocks"
          :key="block.id"
          type="button"
          class="item"
          :data-block="block.id"
          :disabled="!writable"
          :title="block.hint"
          @click="emit('insert', block.node())"
        >
          <span class="thumb">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                :d="block.icon"
                fill="none"
                stroke="currentColor"
                stroke-width="1.3"
                stroke-linejoin="round"
                stroke-linecap="round"
              />
            </svg>
          </span>
          <span class="text">
            <span class="label">{{ block.label }}</span>
            <span class="hint">{{ block.hint }}</span>
          </span>
          <span class="add" aria-hidden="true">+</span>
        </button>
      </div>
    </section>

    <section>
      <h3>
        Components <span class="count">{{ components.size }}</span>
      </h3>
      <p v-if="!components.size" class="empty">
        No components yet. Select a frame and press ⌘⌥K, or create one from New file.
      </p>
      <p v-else-if="!componentRows.length" class="empty">Nothing matches “{{ query }}”.</p>
      <div class="list">
        <button
          v-for="row in componentRows"
          :key="row.name"
          type="button"
          class="item"
          :data-component="row.name"
          :aria-pressed="placing === row.name"
          :disabled="!writable"
          :title="`Place ${row.name}: click on the canvas where it goes`"
          @click="emit('place', row.name)"
        >
          <span class="thumb component">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M8 1.5 11 4.5 8 7.5 5 4.5zM8 8.5l3 3-3 3-3-3zM4.5 5 7.5 8l-3 3-3-3zM11.5 5l3 3-3 3-3-3z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linejoin="round"
              />
            </svg>
          </span>
          <span class="text">
            <span class="label">{{ row.name }}</span>
            <span class="hint">{{ row.summary || 'Component' }}</span>
          </span>
          <span v-if="row.status" class="status" :data-status="row.status">{{ row.status }}</span>
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.insert {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
  overflow: auto;
  padding: 12px;
}
.search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 10px;
  margin-bottom: 8px;
  color: var(--text-faint);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 8px;
}
.search:focus-within {
  border-color: var(--accent);
}
.search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 12px;
}
h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 0 8px;
  color: var(--text-faint);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.count {
  font-weight: 500;
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.tile {
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: 12px 4px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text-dim);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.tile:hover:not(:disabled),
.item:hover:not(:disabled) {
  border-color: var(--text-faint);
  color: var(--text);
}
.tile[aria-pressed='true'],
.item[aria-pressed='true'] {
  border-color: var(--accent);
  background: var(--accent-dim);
  color: var(--text);
}
.tile:disabled,
.item:disabled {
  opacity: 0.5;
  cursor: default;
}
.list {
  display: grid;
  gap: 4px;
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px 6px 6px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.item:hover:not(:disabled) {
  background: var(--raised);
}
.thumb {
  display: grid;
  flex: none;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 7px;
  background: var(--bg);
  border: 1px solid var(--line);
  color: var(--text-dim);
}
.thumb.component {
  color: var(--bound);
}
.text {
  display: grid;
  flex: 1;
  min-width: 0;
}
.label {
  overflow: hidden;
  font-size: 12px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hint {
  overflow: hidden;
  color: var(--text-faint);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.add {
  color: var(--text-faint);
  font-size: 16px;
  opacity: 0;
}
.item:hover .add {
  opacity: 1;
}
.status {
  padding: 1px 6px;
  border: 1px solid var(--line);
  border-radius: 10px;
  color: var(--text-dim);
  font-size: 9px;
}
.status[data-status='stable'] {
  border-color: var(--ok);
  color: var(--ok);
}
.status[data-status='draft'] {
  border-color: var(--warn);
  color: var(--warn);
}
.status[data-status='deprecated'] {
  border-color: var(--danger);
  color: var(--danger);
}
.empty {
  margin: 0 0 8px;
  color: var(--text-faint);
  font-size: 11px;
  line-height: 1.5;
}
button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
</style>
