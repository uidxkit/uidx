<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { finishTutorial, goToStep, stopTutorial, tourRun } from './tour'
import { awaitingDocument, type TourState } from './tutorials'

/**
 * The tutorial coach: a ring around the control to use next and a card
 * beside it saying what to do. It never blocks the editor — the dim and the
 * ring let clicks through — because the point is to do the step for real.
 * Each step is checked against the editor a few times a second; when the
 * document shows it done, the card ticks and the next step follows — once
 * nothing the step opened is still in the way of the next one.
 */
const props = defineProps<{ state: () => TourState }>()

const run = tourRun
const step = computed(() => run.value?.tutorial.steps[run.value.index] ?? null)
const count = computed(() => run.value?.tutorial.steps.length ?? 0)
const index = computed(() => run.value?.index ?? 0)
const isLast = computed(() => index.value === count.value - 1)

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** The part of the target that shows — not under a sticky header, not scrolled out of its panel. */
const rect = ref<Box | null>(null)
/** Where the ring goes: around what shows, padded, but never past the edges that clip it. */
const ringBox = ref<Box | null>(null)
/** Popups open now — a picker, a menu — which the card must not cover. */
const popups = ref<{ box: Box; name: string }[]>([])
/** The popup lying over the target, by name: the ring would frame the popup, not the control. */
const covered = ref<string | null>(null)
const done = ref(false)
/** Drawn without easing while a panel scrolls, so the ring stays on the control. */
const following = ref(false)
const card = ref<HTMLElement | null>(null)
const cardSize = ref({ width: 320, height: 180 })

let timer: ReturnType<typeof setInterval> | undefined
let advancing: ReturnType<typeof setTimeout> | undefined
let frame = 0
let dialogWasOpen = false
/**
 * A step already satisfied on arrival — already on the Overview, say — is
 * passed straight away rather than asking for something done.
 */
let early = true

/**
 * Popups a step can leave open, by what the card calls them. A done step
 * waits for them to close: the colour picker stays open after the first
 * colour lands, and moving on under it would hide the next control.
 */
const POPUPS: readonly [selector: string, name: string][] = [
  ['.picker-dialog', 'color picker'],
  ['.font-picker', 'font picker'],
  ['.model-popup', 'model list'],
  ['.assign-popup', 'token list'],
  ['.bind-popup', 'binding list'],
  ['.slot-popup', 'content list'],
  ['[role="menu"]', 'menu'],
]

/*
 * Scrolling the control into view, without fighting the designer. The coach
 * scrolls whenever the control is cut off — again if the layout moves it —
 * until the designer scrolls its panel themselves; from then until the next
 * step it is theirs. Their scroll is a wheel or a touch on the panel, a press
 * on its scrollbar, or a scroll right after a key (Page Down, Tab to a field
 * below); the coach's own scrolls report themselves too, and are told apart
 * by when it made them.
 */
let byHand = false
/** The target element now, so scrolling some other panel — the layers — does not count. */
let aimed: Element | null = null
/** The selector scrolling was armed for: a new target within a step is a new thing to show. */
let armedFor: string | null = null
let ownScrollAt = -Infinity
let keyAt = -Infinity
let scrolledAt = -Infinity
/** A scroll this soon after the coach scrolled is the coach's own, arriving a frame late. */
const OWN_SCROLL_MS = 300
/** A scroll this soon after a key is the key's. */
const KEY_SCROLL_MS = 500
/** Still scrolling: the ring drops its easing until a scroll has been quiet this long. */
const SCROLLING_MS = 200

/** The selector this step points at, now. */
function selector(): string | null {
  const current = step.value
  const active = run.value
  if (!current?.target || !active) return null
  return typeof current.target === 'string'
    ? current.target
    : current.target(props.state(), active.memory)
}

/** Where two boxes overlap; null when they do not. */
function meet(a: Box, b: Box): Box | null {
  const box = {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  }
  return box.right > box.left && box.bottom > box.top ? box : null
}

const windowBox = (): Box => ({
  left: 0,
  top: 0,
  right: window.innerWidth,
  bottom: window.innerHeight,
})

const scrolls = (element: Element): boolean => {
  const { overflowY } = getComputedStyle(element)
  return overflowY === 'auto' || overflowY === 'scroll'
}

/**
 * Each box that clips an element, nearest first, as the part content shows
 * in: less any sticky header stuck to its top, which content scrolls under.
 * A sticky header only sits over its own parent's content, and is stuck over
 * what comes after it, so the ones that can cover the element are earlier
 * siblings of it or of an ancestor on the way up — found without searching
 * the whole panel. Stops at a fixed box (a modal, a teleported popup):
 * nothing outside it clips what is in it.
 */
function panelsAround(element: Element): { panel: Element; view: Box }[] {
  const out: { panel: Element; view: Box }[] = []
  let sticky: Element[] = []
  for (let node = element; getComputedStyle(node).position !== 'fixed';) {
    const parent = node.parentElement
    if (!parent) break
    for (
      let sibling = node.previousElementSibling;
      sibling;
      sibling = sibling.previousElementSibling
    )
      if (getComputedStyle(sibling).position === 'sticky') sticky.push(sibling)
    const style = getComputedStyle(parent)
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
      const edge = parent.getBoundingClientRect()
      let top = edge.top
      for (const header of sticky) {
        const offset = parseFloat(getComputedStyle(header).top)
        const box = header.getBoundingClientRect()
        // Stuck at the panel's top edge, not waiting further down the flow.
        if (!Number.isNaN(offset) && box.top <= edge.top + offset + 1)
          top = Math.max(top, box.bottom)
      }
      out.push({
        panel: parent,
        view: { left: edge.left, top, right: edge.right, bottom: edge.bottom },
      })
      sticky = []
    }
    node = parent
  }
  return out
}

/** Where an element can show at all: the window, cut by every panel around it. */
function clipOf(element: Element): Box | null {
  let clip: Box | null = windowBox()
  for (const { view } of panelsAround(element)) clip = clip && meet(clip, view)
  return clip
}

/**
 * Whether the part of the target the card is about is cut off: all of it
 * when it fits, else its top — a section's heading — down as far as fits.
 */
function cutOff(box: Box, clip: Box): boolean {
  const height = Math.min(box.bottom - box.top, clip.bottom - clip.top)
  return box.top < clip.top - 1 || box.top + height > clip.bottom + 1
}

/**
 * Scrolls the panels around the target until it shows: centred below the
 * sticky header when it fits, else with its top at the header's foot, since
 * a section taller than the panel cannot be centred into view. Only panels
 * that scroll are moved — an `overflow: hidden` frame is not the coach's to
 * shift. True when anything moved.
 */
function reveal(element: Element): boolean {
  let moved = false
  for (const { panel, view } of panelsAround(element)) {
    const area = scrolls(panel) ? meet(view, windowBox()) : null
    // Measured afresh for each: an inner panel's scroll moves what an outer one sees.
    const box = element.getBoundingClientRect()
    if (!area || !cutOff(box, area)) continue
    const room = area.bottom - area.top
    const by =
      box.height > room
        ? box.top - area.top
        : (box.top + box.bottom) / 2 - (area.top + area.bottom) / 2
    const before = panel.scrollTop
    panel.scrollTop = before + by
    moved ||= panel.scrollTop !== before
  }
  return moved
}

type OpenPopup = { element: Element; box: Box; name: string }

/**
 * How an element shows: where it can show at all, the part of it that does,
 * and the popup lying over that part. A popup the element holds — Fill's own
 * colour picker — is part of it, not over it.
 */
function sight(element: Element, open: readonly OpenPopup[]) {
  const box = element.getBoundingClientRect()
  const clip = clipOf(element)
  const visible = clip && meet(box, clip)
  const over = open.find(
    (popup) =>
      !popup.element.contains(element) &&
      !element.contains(popup.element) &&
      visible !== null &&
      meet(visible, popup.box) !== null,
  )
  return { box, clip, visible, cover: over?.name ?? null }
}

/** Finds the target, scrolls it into view if it is cut off, and rings what shows. */
function measure(): void {
  if (!step.value || !run.value) return
  const target = selector()
  if (target !== armedFor) {
    armedFor = target
    byHand = false
  }
  const open: OpenPopup[] = POPUPS.flatMap(([query, name]) =>
    [...document.querySelectorAll(query)].map((element) => ({
      element,
      box: element.getBoundingClientRect(),
      name,
    })),
  ).filter(({ box }) => box.right > box.left && box.bottom > box.top)
  popups.value = open.map(({ box, name }) => ({ box, name }))

  // The control: the first match with a size.
  const element = target
    ? [...document.querySelectorAll(target)].find((candidate) => {
        const box = candidate.getBoundingClientRect()
        return box.width > 0 && box.height > 0
      })
    : undefined
  aimed = element ?? null
  let seen = element ? sight(element, open) : null
  // Under a popup it stays put: scrolling would carry the popup along with it.
  if (element && seen && !seen.cover && !byHand) {
    const cut = !seen.clip || cutOff(seen.box, seen.clip)
    if (cut && reveal(element)) {
      ownScrollAt = Date.now()
      seen = sight(element, open)
    }
  }
  rect.value = seen?.visible ?? null
  covered.value = seen?.cover ?? null
  const pad = 6
  const shown = seen?.visible
  ringBox.value =
    shown && seen?.clip
      ? meet(
          {
            left: shown.left - pad,
            top: shown.top - pad,
            right: shown.right + pad,
            bottom: shown.bottom + pad,
          },
          seen.clip,
        )
      : null
  following.value = Date.now() - scrolledAt < SCROLLING_MS

  // A modal dialog opened since the last check: lift the card above it.
  const dialogOpen = document.querySelector('dialog[open]') !== null
  if (dialogOpen && !dialogWasOpen) raise()
  dialogWasOpen = dialogOpen

  if (card.value)
    cardSize.value = { width: card.value.offsetWidth, height: card.value.offsetHeight }
}

/** Whether the editor shows the step done — never before a reload's pages arrive. */
function passes(): boolean {
  const current = step.value
  const active = run.value
  if (!current?.done || !active) return false
  const state = props.state()
  return !awaitingDocument(state, active) && current.done(state, active.memory)
}

/**
 * Ticks the step while the editor shows it done, and moves on 900ms later —
 * but not while a popup is open, and not before a reload's pages arrive.
 */
function judge(): void {
  if (!step.value?.done || !run.value) return
  const ok = passes()
  if (!ok) early = false
  done.value = ok
  if (!ok || popups.value.length > 0) {
    clearTimeout(advancing)
    advancing = undefined
  } else if (advancing === undefined) {
    advancing = setTimeout(
      () => {
        advancing = undefined
        // Looked at again as it ends: a popup opened, or the step undone,
        // since the last check holds it, and the next check waits afresh.
        measure()
        if (popups.value.length === 0 && passes()) goToStep(index.value + 1)
      },
      early ? 250 : 900,
    )
  }
}

function tick(): void {
  measure()
  judge()
}

/** The ring keeps up with a scroll, a frame at a time rather than on the next check. */
function follow(): void {
  if (!frame)
    frame = requestAnimationFrame(() => {
      frame = 0
      measure()
    })
}

/** Whether scrolling `scroller` moves the target: a panel around it, not the target itself. */
const carries = (scroller: unknown): boolean =>
  aimed !== null && scroller instanceof Element && scroller !== aimed && scroller.contains(aimed)

/**
 * A wheel or a touch over the panel holding the target. Walked up from where
 * it began: what it is over may not scroll, and the panel takes it then.
 */
function onWheelOrTouch(event: Event): void {
  let node = event.target instanceof Element ? event.target : null
  while (node && !(scrolls(node) && carries(node))) node = node.parentElement
  if (node) byHand = true
}
/** A press on a panel itself, not on anything in it: its scrollbar. */
function onPress(event: Event): void {
  if (event.target instanceof Element && scrolls(event.target) && carries(event.target))
    byHand = true
}
function onKey(): void {
  keyAt = Date.now()
}
/**
 * A scroll right after a key, not the coach's own, is the designer's — if
 * what scrolled holds the target. Only what scrolled: a field scrolling its
 * own text as you type leaves the panel where it was.
 */
function onScroll(event: Event): void {
  const now = Date.now()
  scrolledAt = now
  const scrolled = event.target instanceof Document ? event.target.scrollingElement : event.target
  if (now - keyAt < KEY_SCROLL_MS && now - ownScrollAt > OWN_SCROLL_MS && carries(scrolled))
    byHand = true
  follow()
}

/** Keep the card in the top layer, above a modal the step opened. */
function raise(): void {
  const element = card.value as
    (HTMLElement & { showPopover?: () => void; hidePopover?: () => void }) | null
  if (!element?.showPopover) return
  try {
    element.hidePopover?.()
  } catch {
    /* not shown yet */
  }
  try {
    element.showPopover()
  } catch {
    /* unsupported: the card stays where it is */
  }
}

watch(
  () => (run.value ? `${run.value.tutorial.id}:${run.value.index}` : ''),
  () => {
    // A fresh visit: nothing ticked, and the control scrolled to afresh —
    // Back and forward again shows it again, though the designer scrolled
    // away from it last time.
    done.value = false
    clearTimeout(advancing)
    advancing = undefined
    early = true
    byHand = false
    armedFor = null
    tick()
  },
  { immediate: true },
)

const LISTEN = { capture: true, passive: true } as const
onMounted(() => {
  raise()
  timer = setInterval(tick, 250)
  window.addEventListener('resize', tick)
  window.addEventListener('scroll', onScroll, LISTEN)
  window.addEventListener('wheel', onWheelOrTouch, LISTEN)
  window.addEventListener('touchmove', onWheelOrTouch, LISTEN)
  window.addEventListener('pointerdown', onPress, LISTEN)
  window.addEventListener('keydown', onKey, LISTEN)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  clearTimeout(advancing)
  cancelAnimationFrame(frame)
  aimed = null
  window.removeEventListener('resize', tick)
  window.removeEventListener('scroll', onScroll, LISTEN)
  window.removeEventListener('wheel', onWheelOrTouch, LISTEN)
  window.removeEventListener('touchmove', onWheelOrTouch, LISTEN)
  window.removeEventListener('pointerdown', onPress, LISTEN)
  window.removeEventListener('keydown', onKey, LISTEN)
})

/** The ring: around what shows of the target — hidden while a popup lies over it. */
const ring = computed(() => {
  const box = ringBox.value
  if (!box || covered.value) return null
  return {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.right - box.left}px`,
    height: `${box.bottom - box.top}px`,
  }
})

/** The popup a done step is waiting on, named for the card. */
const holding = computed(() => (done.value ? (popups.value[0]?.name ?? null) : null))

/**
 * The card: beside the target where there is room, else below or above it,
 * else bottom-centre — the first of those that covers neither the target nor
 * a popup the step opened, since covering the list to pick from would hide
 * the very thing the card asks for.
 */
const placement = computed(() => {
  const box = rect.value
  const { width, height } = cardSize.value
  const margin = 14
  const vw = window.innerWidth
  const vh = window.innerHeight
  const clampY = (y: number) => Math.max(12, Math.min(y, vh - height - 12))
  const clampX = (x: number) => Math.max(12, Math.min(x, vw - width - 12))
  const avoid = [...(box ? [box] : []), ...popups.value.map((popup) => popup.box)]
  const clear = (x: number, y: number): boolean =>
    avoid.every(
      (other) =>
        x + width <= other.left || x >= other.right || y + height <= other.top || y >= other.bottom,
    )
  const candidates: [number, number][] = []
  if (box) {
    if (box.left - width - margin > 12)
      candidates.push([box.left - width - margin, clampY(box.top)])
    if (box.right + width + margin < vw - 12) candidates.push([box.right + margin, clampY(box.top)])
    if (box.bottom + height + margin < vh - 12)
      candidates.push([clampX(box.left), box.bottom + margin])
    if (box.top - height - margin > 12)
      candidates.push([clampX(box.left), box.top - height - margin])
  }
  // Clear of everything at the edges: bottom-centre, then the four corners.
  candidates.push(
    [(vw - width) / 2, vh - height - 110],
    [12, vh - height - 12],
    [vw - width - 12, vh - height - 12],
    [12, 60],
    [vw - width - 12, 60],
  )
  const [x, y] = candidates.find(([cx, cy]) => clear(cx, cy)) ?? candidates[0]!
  return { left: `${x}px`, top: `${y}px` }
})

/** `code` and **bold** in a step's words. */
const parts = computed(() => {
  const body = step.value?.body ?? ''
  const out: { kind: 'text' | 'strong' | 'code'; text: string }[] = []
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g
  let last = 0
  for (const match of body.matchAll(pattern)) {
    if (match.index! > last) out.push({ kind: 'text', text: body.slice(last, match.index) })
    out.push(match[1] ? { kind: 'strong', text: match[1] } : { kind: 'code', text: match[2]! })
    last = match.index! + match[0].length
  }
  if (last < body.length) out.push({ kind: 'text', text: body.slice(last) })
  return out
})

function next(): void {
  if (isLast.value) finishTutorial()
  else goToStep(index.value + 1)
}
</script>

<template>
  <template v-if="run && step">
    <div v-if="ring" class="tour-ring" :class="{ following }" :style="ring" aria-hidden="true" />
    <section
      ref="card"
      class="tour-card"
      popover="manual"
      role="dialog"
      aria-live="polite"
      :aria-label="`${run.tutorial.title}, step ${index + 1} of ${count}`"
      :data-step="step.id"
      :data-done="done || undefined"
      :style="placement"
    >
      <header class="tour-head">
        <span class="tour-name">{{ run.tutorial.title }}</span>
        <span class="tour-count">{{ index + 1 }} / {{ count }}</span>
        <button type="button" class="tour-close" aria-label="Close tutorial" @click="stopTutorial">
          ×
        </button>
      </header>
      <div class="tour-progress" aria-hidden="true">
        <span :style="{ width: `${((index + (done ? 1 : 0)) / count) * 100}%` }" />
      </div>
      <h3 class="tour-title">
        <span v-if="done" class="tour-check" aria-hidden="true">✓</span>{{ step.title }}
      </h3>
      <p class="tour-body">
        <template v-for="(part, i) in parts" :key="i">
          <strong v-if="part.kind === 'strong'">{{ part.text }}</strong>
          <code v-else-if="part.kind === 'code'">{{ part.text }}</code>
          <template v-else>{{ part.text }}</template>
        </template>
      </p>
      <p v-if="holding" class="tour-waiting">
        <span class="dot" aria-hidden="true" />Done — close the {{ holding }} to continue.
      </p>
      <p v-else-if="covered" class="tour-waiting">
        <span class="dot" aria-hidden="true" />Close the {{ covered }} to see where this is.
      </p>
      <p v-else-if="step.done && !done" class="tour-waiting">
        <span class="dot" aria-hidden="true" />Waiting for you to do this…
      </p>
      <footer class="tour-actions">
        <button v-if="index > 0" type="button" class="ghost" @click="goToStep(index - 1)">
          Back
        </button>
        <span class="grow" />
        <button
          v-if="step.done && !done"
          type="button"
          class="ghost"
          title="Move on without doing this step"
          @click="next"
        >
          Skip step
        </button>
        <button v-else type="button" class="primary" @click="next">
          {{ isLast ? 'Finish' : 'Next' }}
        </button>
      </footer>
    </section>
  </template>
</template>

<style scoped>
.tour-ring {
  position: fixed;
  z-index: 900;
  border: 2px solid var(--accent);
  border-radius: 8px;
  box-shadow:
    0 0 0 4px color-mix(in srgb, var(--accent) 25%, transparent),
    0 0 0 9999px rgb(0 0 0 / 0.28);
  pointer-events: none;
  transition:
    left 160ms ease,
    top 160ms ease,
    width 160ms ease,
    height 160ms ease;
  animation: tour-pulse 1.6s ease-in-out infinite;
}
.tour-ring.following {
  transition: none;
}
@keyframes tour-pulse {
  50% {
    box-shadow:
      0 0 0 7px color-mix(in srgb, var(--accent) 18%, transparent),
      0 0 0 9999px rgb(0 0 0 / 0.28);
  }
}
.tour-card {
  position: fixed;
  inset: auto;
  z-index: 901;
  width: 320px;
  margin: 0;
  padding: 14px 16px 12px;
  overflow: visible;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
  box-shadow: var(--shadow-float);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  transition:
    left 160ms ease,
    top 160ms ease;
}
.tour-card[data-done] {
  border-color: var(--ok);
}
.tour-head {
  display: flex;
  gap: 8px;
  align-items: center;
  color: var(--text-faint);
  font-size: 11px;
}
.tour-name {
  flex: 1;
  color: var(--accent);
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.tour-close {
  padding: 0 4px;
  border: 0;
  background: none;
  color: var(--text-faint);
  font: inherit;
  font-size: 16px;
  cursor: pointer;
}
.tour-close:hover {
  color: var(--text);
}
.tour-progress {
  height: 3px;
  margin: 8px 0 10px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--raised);
}
.tour-progress span {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 300ms ease;
}
.tour-title {
  display: flex;
  gap: 6px;
  align-items: center;
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
}
.tour-check {
  color: var(--ok);
}
.tour-body {
  margin: 0;
  color: var(--text-dim);
}
.tour-body strong {
  color: var(--text);
  font-weight: 600;
}
.tour-body code {
  padding: 0 4px;
  border-radius: 3px;
  background: var(--raised);
  color: var(--text);
  font-family: ui-monospace, monospace;
  font-size: 11px;
}
.tour-waiting {
  display: flex;
  gap: 6px;
  align-items: center;
  margin: 8px 0 0;
  color: var(--text-faint);
  font-size: 11px;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  animation: tour-blink 1.2s ease-in-out infinite;
}
@keyframes tour-blink {
  50% {
    opacity: 0.25;
  }
}
.tour-actions {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 12px;
}
.grow {
  flex: 1;
}
.primary,
.ghost {
  height: 26px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.primary {
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
}
.ghost {
  background: none;
  color: var(--text-dim);
}
.ghost:hover {
  background: var(--raised);
  color: var(--text);
}
</style>
