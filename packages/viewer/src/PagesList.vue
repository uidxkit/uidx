<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PageEntry } from './page-list'

/**
 * The document's pages, above the layers tree.
 *
 * The shell has held every page since G6 — a token or a component name resolves
 * against the whole document, so the server sends all of it — and `entry` has
 * always chosen which one the canvas draws. Nothing rendered a control for it,
 * which is why `design/preview.sh` starts one server per sheet to look at seven
 * pages. This is that control.
 *
 * Its own component rather than a section of `LayersPane`, which is already a
 * large tree with drag-and-drop, rename and keyboard navigation in it. The two
 * rails answer different questions — which page, and what is on it — and share
 * nothing but a column.
 */
const props = defineProps<{
  /**
   * The document's pages, already assembled.
   *
   * Handed in rather than derived here from the page map, and not for tidiness:
   * `pages` is a `shallowRef` mutated in place and republished with
   * `triggerRef`, so the Map's identity never changes. A child computed reading
   * it as a prop is therefore never invalidated — Vue compares props by
   * identity, sees the same Map, and leaves the child alone. Every row sat at
   * its first-render state for the life of the session. Deriving it in `App`,
   * where reading `pages.value` inside a computed subscribes to the ref itself,
   * is what `tokenIndex` and `components` already do for the same reason.
   */
  entries: readonly PageEntry[]
  /** The page the canvas is drawing. */
  open: string | null
}>()

const emit = defineEmits<{ open: [file: string]; home: [] }>()

/**
 * One page is not a choice. Hiding the rail entirely rather than showing a
 * single selected row keeps the single-file case exactly as it was.
 */
const shown = computed(() => (props.entries.length > 1 ? props.entries : []))

/**
 * Which row the arrow keys are on.
 *
 * Held apart from `open` on purpose: a listbox that opened whatever the arrows
 * landed on would rebuild the scene and refit the camera once per keypress.
 * Moving is free; Enter commits.
 */
const focused = ref<string | null>(null)

const tabbable = computed(() => focused.value ?? props.open ?? shown.value[0]?.file ?? null)

function choose(page: PageEntry): void {
  focused.value = page.file
  // Re-opening the page already on screen is a full rebuild and a camera refit
  // for no change at all.
  if (page.file === props.open) return
  emit('open', page.file)
}

function move(from: string, by: number, event: KeyboardEvent): void {
  const at = shown.value.findIndex((page) => page.file === from)
  const next = shown.value[Math.min(Math.max(at + by, 0), shown.value.length - 1)]
  if (!next || next.file === from) return
  event.preventDefault()
  focused.value = next.file
  rows.value.get(next.file)?.focus()
}

const rows = ref(new Map<string, HTMLElement>())

function setRow(file: string, el: Element | null): void {
  if (el instanceof HTMLElement) rows.value.set(file, el)
  else rows.value.delete(file)
}

function onKeyDown(event: KeyboardEvent, page: PageEntry): void {
  if (event.key === 'ArrowDown') move(page.file, 1, event)
  else if (event.key === 'ArrowUp') move(page.file, -1, event)
  else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    choose(page)
  }
}
</script>

<template>
  <div v-if="shown.length" class="pages">
    <div class="heading">
      <span>Pages</span>
      <span class="count">{{ shown.length }}</span>
    </div>
    <!--
      The way back to the dashboard, above the list it summarises.
      Deliberately not a row of the listbox below: that list is the document's
      pages and arrowing through it must not land on something that is not one.
      It never marks itself current, because the rail is not on screen when the
      dashboard is — the dashboard takes the whole width.
    -->
    <button type="button" class="row overview" @click="emit('home')">
      <svg class="icon" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path
          d="M1.5 1.5h4v4h-4zM6.5 1.5h4v4h-4zM1.5 6.5h4v4h-4zM6.5 6.5h4v4h-4z"
          fill="none"
          stroke="currentColor"
          stroke-width="1"
        />
      </svg>
      <span class="label">Overview</span>
    </button>
    <ul class="list" role="listbox" aria-label="Pages">
      <li
        v-for="page in shown"
        :key="page.file"
        :ref="(el) => setRow(page.file, el as Element | null)"
        class="row"
        role="option"
        :title="page.file"
        :data-file="page.file"
        :data-renderable="page.renderable ? 'true' : 'false'"
        :data-loaded="page.loaded ? 'true' : 'false'"
        :aria-selected="page.file === open"
        :tabindex="page.file === tabbable ? 0 : -1"
        @click="choose(page)"
        @keydown="onKeyDown($event, page)"
      >
        <!--
          Two glyphs, because the distinction is the one thing a row has to say
          beyond its name: a page of variables cannot be drawn, and finding that
          out by clicking it is the discovery this icon exists to prevent.
        -->
        <svg class="icon" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path
            v-if="page.renderable"
            d="M2.5 1.5h7v9h-7z"
            fill="none"
            stroke="currentColor"
            stroke-width="1"
          />
          <path
            v-else
            d="M2 3.5h8M2 6h8M2 8.5h8"
            fill="none"
            stroke="currentColor"
            stroke-width="1"
          />
        </svg>
        <span class="label">{{ page.label }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.pages {
  background: var(--panel);
  border-right: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  padding: var(--gap-sm) 0;
  user-select: none;
  /*
   * Capped rather than free: a fourteen-page document would otherwise push the
   * layers tree off the bottom of the rail, and the tree is what the author
   * works in once they have arrived at a page.
   */
  max-height: 30vh;
  overflow: auto;
  flex: none;
}
.heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--pad);
  height: var(--row-h);
  color: var(--text-faint);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.row {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  height: var(--row-h);
  padding: 0 var(--pad);
  color: var(--text);
  cursor: pointer;
}
.row:hover {
  background: var(--raised);
}
.overview {
  width: 100%;
  border: 0;
  background: none;
  font: inherit;
  text-align: left;
}
.row[aria-selected='true'] {
  background: var(--accent-dim);
  box-shadow: inset 2px 0 0 var(--accent);
}
/* Announced but not yet received — transient, and better dim than missing. */
.row[data-loaded='false'],
.row[data-renderable='false'] {
  color: var(--text-faint);
}
.row:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.icon {
  flex: none;
}
.label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.count {
  font-variant-numeric: tabular-nums;
}
</style>
