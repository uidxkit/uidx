<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { addressOf, resolve, type UidxDocument, type UidxNode, type UidxPatch } from '@uidx/format'

import { keyIntent } from './layer-keys'
import { LAYER_ICONS, STROKE_ICONS } from './layer-icons'
import {
  canContainChildren,
  moveFor,
  remapAddress,
  renameFor,
  type DropInstruction,
} from './layer-moves'
import { ancestorsOf, layerRows, visibleRows, type LayerRow } from './layer-rows'
import { ROW_HEIGHT, rowWindow, scrollTopFor } from './layer-window'

const props = defineProps<{
  doc: UidxDocument | null
  selection?: string[]
  vectorEditing?: string | null
  writable?: boolean
  /**
   * Every `<Component>` in the document, by global name (F3).
   *
   * The rail needs it for the same reason the canvas does: an `<Instance>`'s
   * children are the component's, and a name is global to the *document* while
   * this pane is handed one page. Absent, an instance is simply a leaf — which
   * is what the rail showed before instances existed.
   */
  components?: ReadonlyMap<string, UidxNode>
}>()

/**
 * `moved` is one event for both gestures that move an address, because a
 * rename and a reparent have identical fallout: every address beneath the node
 * changes, and the shell holds the selection as addresses. Emitting a second
 * event for the drag would mean two handlers that must never disagree.
 */
const emit = defineEmits<{
  select: [address: string]
  editVector: [address: string]
  patches: [patches: UidxPatch[]]
  moved: [oldAddress: string, newAddress: string]
}>()

/**
 * Expansion is keyed by address rather than by row index, so a save that
 * re-parses the file does not collapse the tree the author is working in.
 * Everything starts open: a contract is small, and a tree that hides the node
 * you just selected is worse than a long list.
 *
 * Unless it is not small. Past `AUTO_COLLAPSE_ROWS` rows the tree is a page
 * of screens or a generated world map, and opening all of it shows a wall of
 * `d1234` leaves nobody asked for. Then everything below the entities starts
 * closed, the way Figma opens a file — the page and its top-level frames or
 * components visible, their insides a chevron away. A selection made on the
 * canvas still opens its own path, as it always did.
 */
const collapsed = ref(new Set<string>())

/** Rows past which a tree opens closed below its top level. */
const AUTO_COLLAPSE_ROWS = 200
/** Depth from which rows start collapsed in a large tree: page 0, entity 1. */
const AUTO_COLLAPSE_DEPTH = 2

const all = computed(() => layerRows(props.doc, props.components))

/**
 * The addresses the auto-collapse has already decided about, so a save that
 * re-parses the file does not close a subtree the author opened since. Only
 * a row seen for the first time is closed; everything after that is theirs.
 */
const decided = new Set<string>()
watch(
  all,
  (rows) => {
    if (rows.length <= AUTO_COLLAPSE_ROWS) return
    let next: Set<string> | null = null
    for (const row of rows) {
      if (!row.hasChildren || row.depth < AUTO_COLLAPSE_DEPTH || decided.has(row.address)) continue
      decided.add(row.address)
      next ??= new Set(collapsed.value)
      next.add(row.address)
    }
    if (next) collapsed.value = next
  },
  { immediate: true },
)
const expanded = computed(
  () => new Set(all.value.filter((r) => !collapsed.value.has(r.address)).map((r) => r.address)),
)
const rows = computed(() => visibleRows(all.value, expanded.value))

/**
 * Only the rows near the viewport are in the DOM (see `layer-window.ts` for
 * why). `scrollEl` is the rail itself, which is the scroll container; the
 * spacer inside it is the full height of the list so the scrollbar is honest,
 * and the rendered slice is translated down to where it belongs.
 */
const scrollEl = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportHeight = ref(0)
const window_ = computed(() => rowWindow(rows.value.length, scrollTop.value, viewportHeight.value))
const rendered = computed(() => rows.value.slice(window_.value.start, window_.value.end))
const spacerStyle = computed(() => ({ height: `${rows.value.length * ROW_HEIGHT}px` }))
const windowStyle = computed(() => ({
  transform: `translateY(${window_.value.start * ROW_HEIGHT}px)`,
}))

function onScroll(): void {
  scrollTop.value = scrollEl.value?.scrollTop ?? 0
}

let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  const el = scrollEl.value
  if (!el) return
  viewportHeight.value = el.clientHeight
  // jsdom has no `ResizeObserver`; there the height is measured once, as zero,
  // and `rowWindow` answers with the whole list, which is what a test wants.
  if (typeof ResizeObserver === 'undefined') return
  resizeObserver = new ResizeObserver(() => {
    viewportHeight.value = el.clientHeight
  })
  resizeObserver.observe(el)
})
onUnmounted(() => resizeObserver?.disconnect())

/**
 * Bring a row into the window before anything asks for its element, which
 * for a row outside the rendered slice does not exist yet. The scroll is
 * `nearest`: the least move that shows the row, and none when it is already
 * on screen. Assigning `scrollTop` on the element fires a `scroll` event
 * later; setting the ref here as well is what makes the next render — the
 * one the caller is about to `nextTick` for — already hold the row.
 */
function scrollToRow(address: string): void {
  const el = scrollEl.value
  if (!el) return
  const index = rows.value.findIndex((r) => r.address === address)
  if (index === -1) return
  const next = scrollTopFor(index, el.scrollTop, el.clientHeight)
  if (next === el.scrollTop) return
  el.scrollTop = next
  scrollTop.value = next
}

function toggle(address: string): void {
  const next = new Set(collapsed.value)
  if (!next.delete(address)) next.add(address)
  collapsed.value = next
}

/**
 * The live `.row` element for each address, so keyboard nav and rename can
 * move real DOM focus and call `scrollIntoView` without a `document.querySelector`.
 * A plain `Map` rather than a `ref`, because it is write-only bookkeeping the
 * template drives — nothing here needs to react to it changing.
 */
const rowEls = new Map<string, HTMLElement>()
function setRowEl(address: string, el: Element | null): void {
  if (el) rowEls.set(address, el as HTMLElement)
  else rowEls.delete(address)
}

/**
 * A selection made on the canvas has to become visible here, which means
 * opening whatever the author collapsed above it. Figma does the same thing,
 * and without it clicking a nested node leaves the rail showing nothing.
 *
 * It also has to scroll into view, not just expand into view: opening the
 * path to a node in a long tree can still leave it off screen. This is the
 * same call for keyboard travel and a canvas-driven selection, since both
 * arrive here as the same prop change — building the scroll separately for
 * each would mean building it twice.
 */
watch(
  () => props.selection?.[0],
  (address) => {
    if (!address) return
    const next = new Set(collapsed.value)
    for (const ancestor of ancestorsOf(address)) next.delete(ancestor)
    collapsed.value = next
    // `flush: 'post'` below is what makes this safe to call synchronously: it
    // guarantees this callback runs after the newly-expanded row's element
    // has landed in the DOM (and in `rowEls`), rather than racing a `nextTick`
    // of our own against a caller's `await nextTick()` that was already
    // in flight — a race whichever one loses arbitrarily.
    //
    // Two steps, because only rows near the viewport have an element at all:
    // first the window is moved so the row is inside it, then the element the
    // next render produces gets the same `nearest` scroll every row got before
    // windowing — the row the post-flush already holds gets it synchronously.
    scrollToRow(address)
    const el = rowEls.get(address)
    if (el) el.scrollIntoView({ block: 'nearest' })
    else void nextTick(() => rowEls.get(address)?.scrollIntoView({ block: 'nearest' }))
  },
  { flush: 'post' },
)

const isSelected = (address: string): boolean => (props.selection ?? []).includes(address)

/**
 * Roving tabindex: exactly one row is a tab stop, and the arrow keys move
 * which one. It tracks the selection rather than a separate "focused row"
 * concept, because selection and focus are the same thing here — there is no
 * click-to-select-without-focusing gesture this rail offers.
 *
 * The selection is not always a visible row: `toggle` (a chevron click)
 * mutates `collapsed` without touching `selection`, and the watcher that
 * reconciles the two only runs when `selection[0]` *changes* — not when a
 * collapse hides the row it already points at. Select a leaf, then collapse
 * its parent, and nothing tells `selection` its target just vanished from
 * `rows`. Falling straight through to `rows.value[0]` in that case would
 * still produce a tab stop, but the wrong one — a bare "not visible" -> "top
 * of the tree" jump loses the author's place. Walking up `ancestorsOf` finds
 * the nearest row still on screen instead, which for a freshly-collapsed
 * parent is that parent itself. With nothing selected at all, the first row
 * is the entry point, or Tab would reach nothing.
 */
const tabbableAddress = computed(() => {
  const selected = props.selection?.[0]
  if (selected !== undefined) {
    if (rows.value.some((r) => r.address === selected)) return selected
    const visible = new Set(rows.value.map((r) => r.address))
    const ancestors = ancestorsOf(selected)
    for (let i = ancestors.length - 1; i >= 0; i -= 1) {
      const ancestor = ancestors[i]!
      if (visible.has(ancestor)) return ancestor
    }
  }
  return rows.value[0]?.address ?? ''
})

/**
 * Where focus lands after a rename closes, either by commit or by Escape —
 * and where keyboard travel lands, which can be a row the window has not
 * rendered yet (Home, End, a long run of Down).
 */
function focusRow(address: string): void {
  scrollToRow(address)
  void nextTick(() => rowEls.get(address)?.focus())
}

function onKeyDown(event: KeyboardEvent, row: LayerRow): void {
  // The rename input's own keydown handlers own Enter and Escape, but every
  // other key it doesn't claim still bubbles here — arrow keys inside a text
  // box are for moving the caret, not the tree. Without this guard, editing a
  // name and pressing Left to fix a typo collapses the row out from under it.
  if (editing.value === row.address) return
  const intent = keyIntent(rows.value, row.address, !collapsed.value.has(row.address), event.key)
  if (!intent) return
  event.preventDefault()
  switch (intent.kind) {
    case 'move':
      // Selection is the parent's to own — `select` is how it finds out —
      // but the parent's round trip through props is not what should move
      // real keyboard focus. Doing that here keeps arrow-key travel usable
      // even before `selection` comes back around.
      emit('select', intent.address)
      focusRow(intent.address)
      break
    case 'expand':
    case 'collapse':
      toggle(row.address)
      break
    case 'rename':
      startRename(row)
      break
  }
}

/**
 * Visibility is an ordinary property write, which is why the tree can do it
 * without any structural machinery. The only wrinkle is that an undeclared
 * `visible` has no span to replace, so hiding such a node is an `add`.
 */
function toggleVisible(row: LayerRow): void {
  if (row.generated) return
  emit('patches', [
    row.declaresVisible
      ? { op: 'set', address: row.address, prop: 'visible', value: !row.visible }
      : { op: 'add', address: row.address, prop: 'visible', value: false },
  ])
}

const editing = ref<string | null>(null)
const draft = ref('')
const invalid = ref<string | null>(null)

function startRename(row: LayerRow): void {
  // The root <Page>'s name is the frontmatter `id`, not a `name` attribute.
  if (row.address === '') return
  // An instance's child has no line in the file to rename (F3), and a
  // `<Variant>` has no name of its own to change — its coordinates spell one
  // (F8). Refused here rather than only hidden in the template, because Enter
  // reaches this too.
  if (row.generated || row.derived) return
  editing.value = row.address
  draft.value = row.name
  invalid.value = null
}

/**
 * `collapsed` is keyed by address exactly as the selection is, so anything that
 * moves an address has to move its keys too. Without this the moved subtree
 * springs open on the next round-trip — the opposite of what keying by address
 * is for.
 */
function remapCollapsed(oldAddress: string, newAddress: string): void {
  collapsed.value = new Set(
    [...collapsed.value].map((address) => remapAddress(oldAddress, newAddress, address)),
  )
}

function commitRename(row: LayerRow): void {
  if (!props.doc) return
  // Typing the name it already has is not a refusal — there is nothing to
  // write. `renameFor` returns null for that and for a duplicate alike, so
  // without this an unchanged name comes back painted red.
  if (draft.value.trim() === row.name) return cancelRename(row.address)

  const patch = renameFor(props.doc, row.address, draft.value)
  if (!patch) {
    // Refused before the write rather than after: the patcher would reject a
    // duplicate name too, but only once the edit had already left the rail.
    invalid.value = row.address
    return
  }

  const next = draft.value.trim()
  const parent = row.address.slice(0, row.address.length - row.name.length)
  const newAddress = parent + next

  remapCollapsed(row.address, newAddress)

  editing.value = null
  invalid.value = null
  emit('patches', [patch])
  emit('moved', row.address, newAddress)
  // The row still renders at its old address until the doc round-trips and
  // `rows` is recomputed from it — the parent hasn't answered yet, so this
  // tick's DOM node is still keyed by `row.address`, not `newAddress`. This is
  // where Enter dumped focus without it.
  focusRow(row.address)
}

/**
 * Escape, and the fallthrough from a commit that had nothing to write.
 *
 * Takes the address explicitly rather than reading `editing.value`, because
 * the caller already knows which row it came from and `editing` is about to
 * be cleared — reading it after would just be recovering what was passed in.
 */
function cancelRename(address: string): void {
  editing.value = null
  invalid.value = null
  focusRow(address)
}

/**
 * Clicking away commits, as Figma does — a name you typed and then clicked
 * out of is a name you meant. Enter and Escape both clear `editing` before the
 * input goes away, so a blur arriving after them has nothing left to commit.
 *
 * A blur that cannot commit reverts rather than leaving a red input the author
 * has already navigated away from.
 */
function blurRename(row: LayerRow): void {
  if (editing.value !== row.address) return
  const patch = props.doc ? renameFor(props.doc, row.address, draft.value) : null
  if (!patch && draft.value.trim() !== row.name) return cancelRename(row.address)
  commitRename(row)
}

/**
 * `autofocus` is not reliable on an element inserted after load, and a rename
 * box you have to click into is not a rename box.
 *
 * The `select()` is deferred for a subtler reason than it looks. Vue runs this
 * `@vue:mounted` hook *before* `v-model`'s own `mounted` hook — and for a plain
 * text `v-model` that directive hook is what assigns `el.value`. Selecting
 * synchronously would therefore select an empty string, and the assignment that
 * follows collapses the caret to the end of the name, which is precisely the
 * "typing appends instead of replacing" symptom. Deferring past the mount flush
 * lets the value land first. This is Vue's scheduling, not a browser quirk, so
 * the test below guards the real defect rather than an approximation of it.
 *
 * If the input unmounts before the timer fires — Escape or a commit inside the
 * same tick — the callback runs against a detached element and `select()` on it
 * is a harmless no-op.
 */
function focusRename(vnode: { el: HTMLInputElement }): void {
  vnode.el.focus()
  setTimeout(() => vnode.el.select(), 0)
}

/**
 * Spike (Task 7, Step 1): `useLayerDrag` in
 * `@open-pencil/vue/dist/index2.js` does not merely report a gesture — its
 * `monitorForElements({ onDrop })` handler calls
 * `editor.reorderChildWithUndo(...)` directly against the SDK `Editor`'s
 * scene graph. Using it would mean a graph mutation feeding back through
 * `patches` too: the exact double-write this rail is built to avoid, since
 * the tree here reads from the parsed document, not the scene graph. So the
 * hitboxes below are hand-rolled instead; `moveFor` decides everything that
 * matters, this only decides which of its three instructions applies.
 */
const dragging = ref<string | null>(null)
const dropTarget = ref<string | null>(null)
const dropAt = ref<DropInstruction | 'none'>('none')

function onDragStart(event: DragEvent, row: LayerRow): void {
  // A variant's position among its siblings is `arrangeVariants`, not the file
  // (F8), so there is nothing a drop here could write.
  if (row.generated || row.derived) {
    event.preventDefault()
    return
  }
  dragging.value = row.address
  // Firefox will not start a drag whose payload carries no data at all, so
  // without this the rail simply does not drag there.
  event.dataTransfer?.setData('text/plain', row.address)
}

/**
 * Which third of the row the pointer is in.
 *
 * Figma's own bands: the outer quarters reorder, the middle reparents. Reading
 * geometry here rather than from a drag library keeps the whole gesture in one
 * place, and the only thing it produces is a `DropInstruction` — the patch is
 * still `moveFor`'s to decide.
 */
function bandFor(event: DragEvent, el: HTMLElement): DropInstruction {
  const box = el.getBoundingClientRect()
  const offset = event.clientY - box.top
  if (offset < box.height / 4) return 'above'
  if (offset > (box.height * 3) / 4) return 'below'
  return 'into'
}

function onDragOver(event: DragEvent, row: LayerRow): void {
  event.preventDefault()
  if (!props.doc || !dragging.value) return

  const el = event.currentTarget as HTMLElement
  let instruction = bandFor(event, el)
  let patch = moveFor(props.doc, dragging.value, row.address, instruction)

  // A row that cannot take a child has no business owning a reparent band: it
  // would be half the row's height, refusing silently. Fall back to the nearer
  // edge so the whole row reorders, which is what a leaf row means.
  //
  // Gated on the target's own element rather than on `!patch`, because an
  // `into` that a real container refuses — a duplicate sibling name, say — is a
  // refusal the author meant to hit. Turning that into a reorder elsewhere
  // performs a gesture nobody asked for.
  if (!patch && instruction === 'into' && !canContainChildren(props.doc, row.address)) {
    const box = el.getBoundingClientRect()
    instruction = event.clientY - box.top < box.height / 2 ? 'above' : 'below'
    patch = moveFor(props.doc, dragging.value, row.address, instruction)
  }

  dropTarget.value = row.address
  // A refused drop shows no indicator at all, so the author never sees an
  // affordance for something that will not happen.
  dropAt.value = patch ? instruction : 'none'
}

/**
 * Leaving the list without crossing another row.
 *
 * `dragover` is the only thing that ever cleared the indicator, so dragging out
 * of the rail sideways left the last row still showing where a drop would land.
 * Moving onto a child of the same row also fires `dragleave`, which is why the
 * relatedTarget is tested rather than trusted.
 */
function onDragLeave(event: DragEvent, row: LayerRow): void {
  if (dropTarget.value !== row.address) return
  const to = event.relatedTarget as Node | null
  if (to && (event.currentTarget as HTMLElement).contains(to)) return
  dropTarget.value = null
  dropAt.value = 'none'
}

/**
 * A reparent moves an address exactly as a rename does — `container/icon`
 * dropped into `container/slot` becomes `container/slot/icon` — so the drop
 * reports the move for the same reasons the rename does. Without it the author
 * loses the selection on the node they just acted on, and the subtree they had
 * collapsed springs open beneath its new parent.
 *
 * The new address is the `move-node` patch's own arithmetic, read back through
 * `addressOf` so the entity boundary is decided in one place: a node dropped
 * onto the page becomes an entity and joins with nothing, one dropped into an
 * entity joins with `#`, and anything deeper joins with `/`.
 */
function onDrop(row: LayerRow): void {
  const dragged = dragging.value
  if (!props.doc || !dragged || dropAt.value === 'none') return reset()
  const patch = moveFor(props.doc, dragged, row.address, dropAt.value)
  if (patch?.op === 'move-node') {
    // The name comes from the document `moveFor` just resolved against, not
    // from a row lookup — a non-null patch implies the node resolves, so this
    // cannot miss, where a miss in the row list would have discarded the
    // author's edit silently. The patch is emitted regardless: whether the
    // rail can keep its own bookkeeping must never decide whether an edit
    // reaches the file.
    const name = resolve(props.doc.tree, dragged)?.name
    if (name !== undefined) {
      const newAddress = addressOf(patch.newParent, name)
      remapCollapsed(dragged, newAddress)
      emit('moved', dragged, newAddress)
    }
    emit('patches', [patch])
  }
  reset()
}

function reset(): void {
  dragging.value = null
  dropTarget.value = null
  dropAt.value = 'none'
}
</script>

<template>
  <div ref="scrollEl" class="layers" role="tree" @scroll.passive="onScroll">
    <div class="spacer" :style="spacerStyle">
      <div class="window" :style="windowStyle">
        <div
          v-for="row in rendered"
          :key="row.address"
          :ref="(el) => setRowEl(row.address, el as Element | null)"
          class="row"
          role="treeitem"
          :data-address="row.address"
          :data-selected="isSelected(row.address) ? 'true' : 'false'"
          :data-hidden="row.visible ? 'false' : 'true'"
          :data-invalid="invalid === row.address ? 'true' : 'false'"
          :data-generated="row.generated ? 'true' : 'false'"
          :data-derived="row.derived ? 'true' : 'false'"
          :style="{ '--depth': row.depth }"
          :draggable="editing === row.address || row.generated || row.derived ? 'false' : 'true'"
          :data-drop="dropTarget === row.address ? dropAt : 'none'"
          :aria-level="row.depth + 1"
          :aria-selected="isSelected(row.address)"
          :aria-expanded="row.hasChildren ? !collapsed.has(row.address) : undefined"
          :tabindex="row.address === tabbableAddress ? 0 : -1"
          @dragstart="onDragStart($event, row)"
          @dragover="onDragOver($event, row)"
          @dragleave="onDragLeave($event, row)"
          @drop.prevent="onDrop(row)"
          @dragend="reset"
          @keydown="onKeyDown($event, row)"
        >
          <button
            v-if="row.hasChildren"
            type="button"
            class="chevron"
            tabindex="-1"
            aria-hidden="true"
            :aria-expanded="!collapsed.has(row.address)"
            @click.stop="toggle(row.address)"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
              <path d="M2 1l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.2" />
            </svg>
          </button>
          <span v-else class="chevron-spacer" />

          <svg class="icon" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path
              :d="LAYER_ICONS[row.element]"
              :fill="STROKE_ICONS.has(row.element) ? 'none' : 'currentColor'"
              :stroke="STROKE_ICONS.has(row.element) ? 'currentColor' : 'none'"
              stroke-width="1"
            />
          </svg>

          <input
            v-if="editing === row.address"
            v-model="draft"
            class="rename-input"
            @vue:mounted="focusRename"
            @input="invalid = null"
            @keydown.enter.stop="commitRename(row)"
            @keydown.esc.stop="cancelRename(row.address)"
            @blur="blurRename(row)"
            @click.stop
          />
          <!--
        A generated row is shown and does nothing (F3). It has no line in the
        file, so selecting it would fill the inspector with properties no patch
        can write — the same refusal `isAddressable` makes for a deep click on
        the canvas, said the same way in the other pane.
      -->
          <span
            v-else
            class="label"
            @click="row.generated || emit('select', row.address)"
            @dblclick="startRename(row)"
          >
            {{ row.name }}
          </span>

          <button
            v-if="row.element === 'Vector' && !row.generated && isSelected(row.address)"
            type="button"
            class="vector-edit"
            :disabled="writable === false"
            :aria-label="`Edit vector ${row.name}`"
            :title="vectorEditing === row.address ? 'Editing vector points' : 'Edit vector points'"
            :data-active="vectorEditing === row.address"
            @click.stop="emit('editVector', row.address)"
          >
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <path :d="LAYER_ICONS.Vector" fill="none" stroke="currentColor" />
            </svg>
          </button>
          <!--
        Not on the root. The page has no visibility of its own, and when it is
        the synthetic `<Page>` a bare `<Component>` gets, its zero-width tag
        span has nowhere to write an attribute — `add visible false` computes an
        insertion point before the tag and splices into the prose. The patcher
        refuses the result, so the file is safe, but what the author sees is a
        UIDX003 about an ArrayBuffer. Refusing the gesture is `startRename`'s
        rule too; not offering it is better still.

        `aria-label` rather than `aria-pressed`: the icon is `aria-hidden`, so
        without a label the button announces with no name at all, and "pressed"
        on a visible layer announced the state backwards.
      -->
          <button
            v-if="row.address !== '' && !row.generated && !row.derived"
            type="button"
            class="eye"
            :aria-label="row.visible ? 'Hide layer' : 'Show layer'"
            @click.stop="toggleVisible(row)"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path
                d="M1 6s2-3.5 5-3.5S11 6 11 6s-2 3.5-5 3.5S1 6 1 6z"
                fill="none"
                stroke="currentColor"
              />
              <circle cx="6" cy="6" r="1.5" fill="currentColor" />
              <path v-if="!row.visible" d="M2 10L10 2" stroke="currentColor" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.layers {
  background: var(--panel);
  border-right: 1px solid var(--line);
  overflow: auto;
  padding: var(--gap-sm) 0;
  user-select: none;
}
/*
 * The spacer is the whole list's height, so the scrollbar describes the tree
 * rather than the slice of it in the DOM; `contain` tells the browser that
 * nothing outside it depends on its layout, which is what keeps a pan's
 * status-bar update from re-laying-out the rail.
 */
.spacer {
  position: relative;
  contain: strict;
}
.window {
  will-change: transform;
}
.row {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  height: var(--row-h);
  padding-right: var(--pad);
  padding-left: calc(var(--pad) + var(--depth) * var(--indent));
  color: var(--text);
}
.row:hover {
  background: var(--raised);
}
.row[data-selected='true'] {
  background: var(--accent-dim);
  box-shadow: inset 2px 0 0 var(--accent);
}
.row[data-hidden='true'] {
  color: var(--text-faint);
}
/*
 * An instance's children (F3): shown so the rail matches the canvas, dimmed and
 * un-hoverable so it is obvious they are not the author's to edit. The cursor
 * is the affordance doing the work — the label offers no pointer, so a press is
 * never invited in the first place.
 */
.row[data-generated='true'] {
  color: var(--text-faint);
}
.row[data-generated='true'] .label {
  cursor: default;
}
.row:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.row[data-drop='above'] {
  box-shadow: inset 0 1px 0 var(--accent);
}
.row[data-drop='below'] {
  box-shadow: inset 0 -1px 0 var(--accent);
}
.row[data-drop='into'] {
  background: var(--accent-dim);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.chevron,
.chevron-spacer {
  width: var(--icon);
  height: var(--icon);
  flex: none;
}
.chevron {
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-dim);
  cursor: pointer;
  transition: transform 80ms ease;
}
.chevron[aria-expanded='true'] {
  transform: rotate(90deg);
}
.icon {
  flex: none;
  color: var(--text-dim);
}
.label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: default;
}
.eye {
  flex: none;
  display: grid;
  place-items: center;
  width: var(--icon);
  height: var(--icon);
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-dim);
  cursor: pointer;
  visibility: hidden;
}
.rename-input {
  flex: 1;
  min-width: 0;
  height: calc(var(--row-h) - 6px);
  padding: 0 var(--gap-sm);
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--text);
  font: inherit;
  outline: none;
}
.row[data-invalid='true'] .rename-input {
  border-color: var(--danger);
}
.row:hover .eye,
.row[data-hidden='true'] .eye {
  visibility: visible;
}
</style>

<style scoped>
.vector-edit {
  display: grid;
  place-items: center;
  padding: 2px;
  border: 0;
  border-radius: var(--radius);
  color: var(--text-dim);
  background: transparent;
  cursor: pointer;
}
.vector-edit:hover,
.vector-edit[data-active='true'] {
  background: var(--raised);
  color: var(--accent);
}
.vector-edit:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
