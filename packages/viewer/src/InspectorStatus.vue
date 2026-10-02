<script setup lang="ts">
import { computed, reactive } from 'vue'

import { FieldIcon } from './field-icons'
import { shortPath, sortByTone, type MessageAction, type StatusItem } from './inspector-messages'

/**
 * The status line of the Contract, Connect and Code tabs: the one place a
 * tab says something is wrong. A 32px bar names the worst item and how many
 * more there are; opening it lists each with a short detail, the file it is
 * about, up to three rows and the actions that fix it. The server's own
 * words stay reachable behind "Details", never in the bar.
 *
 * It renders nothing while there is nothing to say, so a healthy tab starts
 * with its first section.
 */
const props = defineProps<{
  items: StatusItem[]
  /** Whether the list is expanded (`v-model:open`), so the shell keeps it per tab. */
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  act: [action: MessageAction]
}>()

/** Rows a status item shows before '+N more'. */
const ROWS = 3

const sorted = computed(() => sortByTone(props.items))
const top = computed(() => sorted.value[0])
const countText = computed(() => {
  const item = top.value
  if (!item) return ''
  if (item.count) return item.count
  return sorted.value.length > 1 ? `+${sorted.value.length - 1}` : ''
})
/** Worth opening: more than one item, or the one item has more than its title. */
const expandable = computed(() => {
  const item = top.value
  if (!item) return false
  return (
    sorted.value.length > 1 ||
    !!item.detail ||
    !!item.path ||
    !!item.rows?.length ||
    !!item.raw ||
    (item.actions?.length ?? 0) > 1
  )
})
const TONE_WORD = { danger: 'Error', warn: 'Warning', info: 'Note' } as const
const toneWord = computed(() => (top.value ? TONE_WORD[top.value.tone] : ''))

/** Items whose folded rows the reader asked to see. */
const more = reactive(new Set<string>())
const shown = (item: StatusItem) =>
  more.has(item.id) ? (item.rows ?? []) : (item.rows ?? []).slice(0, ROWS)
const hidden = (item: StatusItem): number =>
  more.has(item.id) ? 0 : Math.max(0, (item.rows?.length ?? 0) - ROWS)

function toggle(): void {
  if (expandable.value) emit('update:open', !props.open)
}

async function copyRaw(raw: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(raw)
  } catch {
    // No clipboard (insecure context, denied): the text is selectable in place.
  }
}
</script>

<template>
  <div
    v-if="top"
    class="inspector-status"
    :data-tone="top.tone"
    :role="top.tone === 'danger' ? 'alert' : 'status'"
    aria-live="polite"
  >
    <component
      :is="expandable ? 'button' : 'div'"
      class="status-bar"
      :type="expandable ? 'button' : undefined"
      :aria-expanded="expandable ? open : undefined"
      :aria-label="`${toneWord}: ${top.title}${countText ? ` (${countText})` : ''}`"
      @click="toggle"
    >
      <FieldIcon v-if="top.tone === 'danger'" class="mark danger" name="alert-circle" />
      <span v-else class="tone-dot" :data-tone="top.tone" />
      <span class="status-title" :title="top.title">{{ top.title }}</span>
      <span v-if="countText" class="status-count">{{ countText }}</span>
      <span class="grow" />
      <button
        v-if="!expandable && top.actions?.length === 1"
        type="button"
        class="link-button"
        @click.stop="emit('act', top.actions[0]!)"
      >
        {{ top.actions[0]!.label }}
      </button>
      <span v-if="expandable" class="chevron" aria-hidden="true">›</span>
    </component>
    <div v-if="expandable && open" class="status-list">
      <div v-for="item in sorted" :key="item.id" class="status-row" :data-status="item.id">
        <!-- With one item the bar already names it: the row keeps the gutter, not the title. -->
        <span class="mark-cell">
          <template v-if="sorted.length > 1">
            <FieldIcon v-if="item.tone === 'danger'" class="mark danger" name="alert-circle" />
            <span v-else class="tone-dot" :data-tone="item.tone" />
          </template>
        </span>
        <p v-if="sorted.length > 1" class="row-title">{{ item.title }}</p>
        <p v-if="item.detail" class="status-detail" :title="item.detail">{{ item.detail }}</p>
        <code v-if="item.path" class="path-chip" :title="item.pathTitle ?? item.path">{{
          shortPath(item.path)
        }}</code>
        <ul v-if="item.rows?.length" class="status-rows">
          <li v-for="(row, index) in shown(item)" :key="index" :title="row.full ?? row.label">
            <span class="row-label">{{ row.label }}</span>
            <button
              v-if="row.action"
              type="button"
              class="link-button row-action"
              @click="emit('act', row.action)"
            >
              {{ row.action.label }}
            </button>
            <span v-if="row.meta" class="row-meta">{{ row.meta }}</span>
          </li>
          <li v-if="hidden(item)">
            <button type="button" class="link-button" @click="more.add(item.id)">
              +{{ hidden(item) }} more
            </button>
          </li>
        </ul>
        <div v-if="item.actions?.length || item.raw" class="status-actions">
          <button
            v-for="action in item.actions"
            :key="action.label"
            type="button"
            class="link-button"
            @click="emit('act', action)"
          >
            {{ action.label }}
          </button>
          <details v-if="item.raw" class="status-raw">
            <summary>Details <span class="disclosure" aria-hidden="true">›</span></summary>
            <pre>{{ item.raw }}</pre>
            <button type="button" class="link-button" @click="copyRaw(item.raw)">Copy</button>
          </details>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.inspector-status {
  /* Full-bleed, like a section: the line is part of the tab, not a card on it. */
  margin: 0 calc(-1 * var(--section-pad));
  border-bottom: 1px solid var(--line);
  overflow-wrap: anywhere;
  min-width: 0;
}
.status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  min-height: 32px;
  padding: 0 var(--section-pad);
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
}
button.status-bar {
  cursor: pointer;
}
button.status-bar:hover {
  background: color-mix(in srgb, var(--raised) 50%, transparent);
}
.mark {
  flex: none;
  width: 12px;
  height: 12px;
}
.mark.danger {
  color: var(--danger);
}
.tone-dot {
  display: inline-block;
  flex: none;
  width: 6px;
  height: 6px;
  margin: 0 3px;
  border-radius: 50%;
  background: var(--text-faint);
}
.tone-dot[data-tone='warn'] {
  background: var(--warn);
}
.status-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--ui-size);
  font-weight: 500;
}
.status-count {
  flex: none;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
  white-space: nowrap;
}
.grow {
  flex: 1 1 0;
}
.status-bar > .link-button {
  flex: none;
  font-size: var(--ui-size-sm);
  font-weight: 500;
  white-space: nowrap;
}
.chevron {
  flex: none;
  color: var(--text-faint);
  transform: rotate(90deg);
  transition: transform 0.1s;
}
[aria-expanded='true'] > .chevron {
  transform: rotate(-90deg);
}
.status-list {
  padding: 0 var(--section-pad) 8px;
}
.status-row {
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr);
  column-gap: 8px;
  row-gap: 2px;
  padding: 6px 0;
}
.status-row > :not(.mark-cell) {
  grid-column: 2;
  min-width: 0;
}
.status-row + .status-row {
  border-top: 1px solid var(--line);
}
.mark-cell {
  display: flex;
  grid-row: 1;
  align-items: center;
  justify-content: center;
  height: 16px;
}
.row-title {
  margin: 0;
  font-size: var(--ui-size);
  line-height: 16px;
  color: var(--text);
}
.status-detail {
  margin: 0;
  font-size: var(--ui-size-sm);
  line-height: 15px;
  color: var(--text-dim);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.path-chip {
  justify-self: start;
  max-width: 100%;
}
.status-rows {
  margin: 2px 0 0;
  padding: 0;
  list-style: none;
}
.status-rows li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: 8px;
  padding: 1px 0;
  font-size: var(--ui-size-sm);
  line-height: 16px;
}
.row-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
.row-action {
  grid-column: 2;
  grid-row: 1;
  white-space: nowrap;
}
.row-meta {
  grid-column: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-faint);
  font-family: var(--mono-font);
}
.status-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
  margin-top: 4px;
  font-size: var(--ui-size-sm);
}
.status-actions > .link-button {
  font-weight: 500;
}
.status-raw {
  min-width: 0;
  max-width: 100%;
}
.status-raw[open] {
  flex-basis: 100%;
}
.status-raw > summary {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  list-style: none;
  color: var(--text-faint);
}
.status-raw > summary::-webkit-details-marker {
  display: none;
}
.status-raw > summary:hover {
  color: var(--text);
}
.disclosure {
  transition: transform 0.1s;
}
.status-raw[open] .disclosure {
  transform: rotate(90deg);
}
.status-raw pre {
  margin: 4px 0;
  max-height: 120px;
  overflow: auto;
  padding: 6px 8px;
  background: var(--bg);
  border-radius: var(--radius-lg);
  color: var(--text-dim);
  font: 11px/16px var(--mono-font);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
