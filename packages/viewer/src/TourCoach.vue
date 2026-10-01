<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { finishTutorial, goToStep, stopTutorial, tourRun } from './tour'
import type { TourState } from './tutorials'

/**
 * The tutorial coach: a ring around the control to use next and a card
 * beside it saying what to do. It never blocks the editor — the dim and the
 * ring let clicks through — because the point is to do the step for real.
 * Each step is checked against the editor a few times a second; when the
 * document shows it done, the card ticks and the next step follows.
 */
const props = defineProps<{ state: () => TourState }>()

const run = tourRun
const step = computed(() => run.value?.tutorial.steps[run.value.index] ?? null)
const count = computed(() => run.value?.tutorial.steps.length ?? 0)
const index = computed(() => run.value?.index ?? 0)
const isLast = computed(() => index.value === count.value - 1)

const rect = ref<DOMRect | null>(null)
/** Popups the step opened — a picker, a menu — which the card must not cover. */
const popups = ref<DOMRect[]>([])
const done = ref(false)
const card = ref<HTMLElement | null>(null)
const cardSize = ref({ width: 320, height: 180 })

let timer: ReturnType<typeof setInterval> | undefined
let advancing: ReturnType<typeof setTimeout> | undefined
let dialogWasOpen = false
let scrolledFor = ''
const POPUPS =
  '.assign-popup, .model-popup, .slot-popup, .bind-popup, .picker-dialog, .font-picker, [role="menu"]'
const stepKey = (): string => (run.value ? `${run.value.tutorial.id}:${run.value.index}` : '')

/** The selector this step points at, now. */
function selector(): string | null {
  const current = step.value
  const active = run.value
  if (!current?.target || !active) return null
  return typeof current.target === 'string'
    ? current.target
    : current.target(props.state(), active.memory)
}

function tick(): void {
  const current = step.value
  const active = run.value
  if (!current || !active) return
  const state = props.state()

  // The control: the first match that is on screen.
  const target = selector()
  let found: DOMRect | null = null
  if (target) {
    for (const element of document.querySelectorAll(target)) {
      let box = element.getBoundingClientRect()
      if (box.width <= 0 || box.height <= 0) continue
      // Once per step, bring a control below the fold — Fill, far down the
      // panel — into view, rather than ringing something off screen.
      const off = box.bottom > window.innerHeight || box.top < 0
      if (off && scrolledFor !== stepKey()) {
        scrolledFor = stepKey()
        element.scrollIntoView({ block: 'center' })
        box = element.getBoundingClientRect()
      }
      found = box
      break
    }
  }
  rect.value = found
  popups.value = [...document.querySelectorAll(POPUPS)]
    .map((element) => element.getBoundingClientRect())
    .filter((box) => box.width > 0 && box.height > 0)

  // A modal dialog opened since the last tick: lift the card above it.
  const dialogOpen = document.querySelector('dialog[open]') !== null
  if (dialogOpen && !dialogWasOpen) raise()
  dialogWasOpen = dialogOpen

  if (current.done && !done.value && current.done(state, active.memory)) {
    done.value = true
    clearTimeout(advancing)
    advancing = setTimeout(() => goToStep(index.value + 1), 900)
  }
  if (card.value)
    cardSize.value = { width: card.value.offsetWidth, height: card.value.offsetHeight }
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
    done.value = false
    clearTimeout(advancing)
    // A step already satisfied on arrival — already on the Overview, say —
    // is passed straight away rather than asking for something done.
    const current = step.value
    const active = run.value
    if (current?.done && active && current.done(props.state(), active.memory)) {
      done.value = true
      advancing = setTimeout(() => goToStep(index.value + 1), 250)
    }
    tick()
  },
  { immediate: true },
)

onMounted(() => {
  raise()
  timer = setInterval(tick, 250)
  window.addEventListener('resize', tick)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  clearTimeout(advancing)
  window.removeEventListener('resize', tick)
})

/** The ring: the target, padded. */
const ring = computed(() => {
  const box = rect.value
  if (!box) return null
  const pad = 6
  return {
    left: `${box.left - pad}px`,
    top: `${box.top - pad}px`,
    width: `${box.width + pad * 2}px`,
    height: `${box.height + pad * 2}px`,
  }
})

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
  const avoid = [...(box ? [box] : []), ...popups.value]
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
    <div v-if="ring" class="tour-ring" :style="ring" aria-hidden="true" />
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
      <p v-if="step.done && !done" class="tour-waiting">
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
