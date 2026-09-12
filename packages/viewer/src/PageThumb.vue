<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import type { PageCard } from './home-model'

/**
 * One page's tile.
 *
 * The tile owns *when* its picture is drawn, not how: it observes itself into
 * view and asks its parent for bytes. That split is what keeps a thirty-page
 * document cheap — the renderer never hears about a row nobody has scrolled to
 * — and it keeps the observer next to the element it observes rather than in a
 * pane managing thirty of them.
 */
const props = defineProps<{
  card: PageCard
  /**
   * Renders the page and resolves an image URL, or null when there is nothing
   * to draw. Injected rather than imported so a test can mount the grid without
   * CanvasKit, which cannot run under jsdom (spike S1).
   */
  render: (card: PageCard) => Promise<string | null>
  /**
   * A stamp for everything this page's picture depends on that is not in the
   * page itself — the component definitions it instances, the artwork it paints
   * with.
   *
   * The tile cannot compute this: both live in other files, and only the shell
   * sees the whole document. It cannot be left out either, which is what this
   * prop is here to fix — a tile that watches only its own revision never
   * redraws when a component or an image it draws through moves, because
   * neither of those touches this page's file and so neither moves its
   * revision.
   */
  stamp: string
  /** Marks the page the canvas would return to. */
  current: boolean
}>()

const emit = defineEmits<{ open: [file: string] }>()

const root = ref<HTMLElement | null>(null)
const url = ref<string | null>(null)

/**
 * Whether the tile has been looked at yet.
 *
 * Held as state rather than acted on the moment it becomes true, because being
 * on screen is only half of what a picture needs — the other half is the page
 * itself, which may not have arrived over the socket yet.
 */
const visible = ref(false)

/**
 * What the picture on screen was drawn from: this page's revision and the state
 * of everything outside it that the picture depends on.
 *
 * `undefined` means nothing has been drawn, which is distinct from a page drawn
 * before its first `file:changed` — the two would otherwise collide and the
 * first save would not redraw.
 */
let drawnAt: string | undefined = undefined

/** Everything that decides whether the picture on screen is still right. */
const drawKey = computed(() => `${props.card.revision ?? 'pending'}@${props.stamp}`)
/** Whether a render is in flight, so a second trigger does not start another. */
let drawing = false
/** Whether a render has been attempted, to tell "not yet" from "nothing to draw". */
const attempted = ref(false)
/** Whether the last attempt failed, which is not the same as having nothing to draw. */
const failed = ref(false)

/**
 * What the tile shows when there is no picture: why there is no picture.
 *
 * A `<Tokens>` page has no scene by definition and a broken one has no parse —
 * both are facts about the page worth stating, and neither is a failure of the
 * dashboard. An empty box with a spinner that never resolves would say the
 * opposite.
 */
const placeholder = computed(() => {
  if (props.card.errors > 0) return 'does not parse'
  if (props.card.kind === 'tokens') return 'variables, not a scene'
  if (props.card.kind === 'pending') return 'loading'
  if (failed.value) return 'could not be drawn'
  if (attempted.value && url.value === null) return 'empty page'
  return null
})

/**
 * Draw, if there is now both something to draw and a reason to.
 *
 * Written as one condition re-evaluated on every change rather than as a
 * sequence of triggers, because the two halves arrive in either order and the
 * bug is always the same: the tile mounts while its page is still in flight,
 * paints nothing because there is nothing to paint, and never asks again when
 * the page lands. A dashboard whose pictures depend on the socket having beaten
 * the first render is a dashboard that is empty exactly when the document is
 * large.
 */
async function paint(): Promise<void> {
  if (!visible.value || props.card.kind !== 'scene' || drawing) return
  // Already showing exactly this. Redrawing would be one raster for no change —
  // a recount alone must never cost a render.
  if (url.value !== null && drawnAt === drawKey.value) return

  drawing = true
  drawnAt = drawKey.value
  attempted.value = true
  try {
    url.value = await props.render(props.card)
    failed.value = false
  } catch {
    // Said on the tile rather than thrown onward: one page that will not render
    // must not take the dashboard down with it, and the author still needs to
    // know which page it was.
    url.value = null
    failed.value = true
  } finally {
    drawing = false
  }
}

// `post`, so a card that changes in the same tick as the element appearing is
// read after the DOM has settled rather than before.
watch(
  () => [visible.value, props.card.kind, drawKey.value] as const,
  () => void paint(),
  { flush: 'post' },
)

/** A screen of margin, so a tile is drawn just before it is looked at. */
const MARGIN = 400

/** Whether the tile is on screen now, asked of the geometry rather than waited for. */
function onScreen(el: HTMLElement): boolean {
  const box = el.getBoundingClientRect()
  const height = window.innerHeight || document.documentElement.clientHeight
  const width = window.innerWidth || document.documentElement.clientWidth
  return (
    box.top < height + MARGIN &&
    box.bottom > -MARGIN &&
    box.left < width + MARGIN &&
    box.right > -MARGIN
  )
}

/**
 * Notice when the tile is looked at — but never *only* through an observer.
 *
 * `IntersectionObserver` is the right mechanism for a grid of thirty renders and
 * the wrong thing to make the picture depend on: it needs a rendering lifecycle
 * to deliver its first callback, and there are environments that do not drive
 * one — a headless browser (which is what spike S1 ran into), a tab backgrounded
 * at first paint, an embedded webview. There the observer never reports and the
 * dashboard sits at empty wells forever, which is far worse than drawing a tile
 * nobody scrolled to.
 *
 * So the first answer is measured directly, and the observer only carries the
 * tiles that arrive later by scrolling.
 */
let observer: IntersectionObserver | null = null
onMounted(() => {
  const el = root.value
  // `onMounted` rather than a watcher on the template ref: the ref is assigned
  // exactly once, during mount, and a watcher that misses that single assignment
  // leaves the tile with no picture forever.
  if (!el || typeof IntersectionObserver === 'undefined' || onScreen(el)) {
    visible.value = true
    return
  }

  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      stopObserving()
      visible.value = true
    },
    { rootMargin: `${MARGIN}px` },
  )
  observer.observe(el)
})

function stopObserving(): void {
  observer?.disconnect()
  observer = null
}

onUnmounted(stopObserving)
</script>

<template>
  <li
    ref="root"
    class="tile"
    role="option"
    :title="card.file"
    :data-file="card.file"
    :data-kind="card.kind"
    :data-drawn="url ? 'true' : 'false'"
    :aria-selected="current"
    tabindex="0"
    @click="emit('open', card.file)"
    @keydown.enter.prevent="emit('open', card.file)"
    @keydown.space.prevent="emit('open', card.file)"
  >
    <div class="well">
      <img v-if="url" class="shot" :src="url" :alt="`${card.label} thumbnail`" />
      <span v-else class="empty">{{ placeholder ?? '' }}</span>
    </div>

    <div class="caption">
      <span class="label">{{ card.label }}</span>
      <span v-if="card.errors > 0" class="badge" data-kind="error">{{ card.errors }}</span>
      <span v-else-if="card.revision !== null" class="rev">rev {{ card.revision }}</span>
    </div>

    <!--
      One line of counts, and only the ones this page actually has. A row of
      zeroes reads as a table to compare across, which is not what the number is
      for — it is here to say what is on the page.
    -->
    <div class="counts">
      <span v-if="card.nodes">{{ card.nodes }} nodes</span>
      <span v-if="card.components">{{ card.components }} components</span>
      <span v-if="card.instances">{{ card.instances }} instances</span>
    </div>
  </li>
</template>

<style scoped>
.tile {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
  padding: var(--gap);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--panel);
  cursor: pointer;
}
.tile:hover {
  background: var(--raised);
}
.tile[aria-selected='true'] {
  border-color: var(--accent);
}
.tile:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.well {
  display: flex;
  align-items: center;
  justify-content: center;
  /* The canvas ground, so a tile reads as a window onto the page. */
  background: var(--canvas-bg);
  border-radius: var(--radius);
  aspect-ratio: 16 / 10;
  overflow: hidden;
}
.shot {
  width: 100%;
  height: 100%;
  /* The render is already fitted and centred; this only handles a stale tile
     briefly showing at a size the grid has since changed. */
  object-fit: contain;
}
.empty {
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}
.caption {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
}
.label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rev {
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.badge {
  padding: 0 var(--gap-sm);
  border-radius: var(--radius);
  background: var(--danger);
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.counts {
  display: flex;
  gap: var(--gap);
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
  min-height: var(--ui-line);
}
</style>
