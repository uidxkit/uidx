<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  colorToHex,
  cssColor,
  hexToColor,
  hsvToRgb,
  rgbToHsv,
  type Hsv,
  type Rgba,
} from './paint-edit'
import { FieldIcon } from './field-icons'
import VariableRow from './VariableRow.vue'
import type { VariableCandidate } from './variable-binding'

/**
 * Figma's colour dialog (story C9): SV area, hue and alpha, hex + opacity,
 * the eyedropper where the browser has one, and the document's own colours.
 * Continuous gestures preview; settling commits — the C4 discipline, which
 * is also why closing mid-drag loses nothing: previews were never patches.
 *
 * Task 12 adds a second tab: Custom (this dialog, unchanged) and Libraries,
 * the same collection-grouped variable list the assignment popup renders,
 * scoped by the host to COLOR variables. Only appears when there are any.
 */
const props = defineProps<{
  color: Rgba
  opacity: number
  swatches: Rgba[]
  editable: boolean
  libraries?: VariableCandidate[]
  currentToken?: string | null
}>()

const emit = defineEmits<{
  preview: [color: Rgba, opacity: number]
  commit: [color: Rgba, opacity: number]
  close: []
  pick: [address: string]
}>()

const tab = ref<'custom' | 'libraries'>(props.currentToken ? 'libraries' : 'custom')
const libraryQuery = ref('')
const libraryCollections = computed(() => {
  const groups = new Map<string, VariableCandidate[]>()
  for (const candidate of props.libraries ?? []) {
    if (!candidate.name.toLowerCase().includes(libraryQuery.value.trim().toLowerCase())) continue
    const list = groups.get(candidate.collection) ?? []
    list.push(candidate)
    groups.set(candidate.collection, list)
  }
  return [...groups]
})

const root = ref<HTMLElement | null>(null)
const hsv = ref<Hsv>(rgbToHsv(props.color))
const alpha = ref(props.color.a)
const dragging = ref(false)
const invalidHex = ref(false)

watch(
  () => props.color,
  (color) => {
    if (dragging.value) return
    hsv.value = rgbToHsv(color)
    alpha.value = color.a
  },
)

/**
 * Figma flips the dialog above the swatch when the panel has no room below.
 * Measured once on mount: the dialog's height does not change while open.
 */
const flipUp = ref(false)

/** The bottom edge the dialog has to fit inside — the nearest scroller, else the window. */
function boundaryBottom(el: HTMLElement): number {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return node.getBoundingClientRect().bottom
  }
  return window.innerHeight
}

/**
 * Dismissal, the two ways every popover owes: Escape, and a pointer landing
 * anywhere else. The swatch that opened the dialog is exempt — it owns the
 * toggle, and closing here first would let its own click reopen the dialog.
 */
function onDocumentKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}
function onDocumentPointer(event: Event): void {
  const target = event.target as HTMLElement | null
  if (target && (root.value?.contains(target) || target.closest?.('[data-picker-trigger]'))) return
  emit('close')
}

onMounted(() => {
  const el = root.value
  if (el) flipUp.value = el.getBoundingClientRect().bottom > boundaryBottom(el)
  document.addEventListener('keydown', onDocumentKey)
  document.addEventListener('pointerdown', onDocumentPointer, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocumentKey)
  document.removeEventListener('pointerdown', onDocumentPointer, true)
})

const current = (): Rgba => hsvToRgb(hsv.value, alpha.value)
const hueColor = computed(() => cssColor(hsvToRgb({ h: hsv.value.h, s: 1, v: 1 }, 1)))
/**
 * The hue track is the spectrum it picks from, so it is drawn from the colour
 * space itself rather than written down as literals in the stylesheet.
 */
const HUE_RAMP = `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360]
  .map((h) => `${cssColor(hsvToRgb({ h, s: 1, v: 1 }, 1))} ${((h / 360) * 100).toFixed(0)}%`)
  .join(', ')})`
/** The alpha track reads over a checkerboard, so it has to ramp the real colour. */
const alphaRamp = computed(() => {
  const opaque = hsvToRgb(hsv.value, 1)
  return `linear-gradient(to right, ${cssColor(opaque, 0)}, ${cssColor(opaque, 1)})`
})

function svFromPointer(event: PointerEvent, el: HTMLElement): void {
  const rect = el.getBoundingClientRect()
  const s = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  const v = 1 - Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
  hsv.value = { ...hsv.value, s, v }
}

function onSvDown(event: PointerEvent): void {
  if (!props.editable) return
  const el = event.currentTarget as HTMLElement
  dragging.value = true
  el.setPointerCapture?.(event.pointerId)
  svFromPointer(event, el)
  emit('preview', current(), props.opacity)
}
function onSvMove(event: PointerEvent): void {
  if (!dragging.value) return
  svFromPointer(event, event.currentTarget as HTMLElement)
  emit('preview', current(), props.opacity)
}
function onSvUp(event: PointerEvent): void {
  if (!dragging.value) return
  dragging.value = false
  ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
  emit('commit', current(), props.opacity)
}

function onHue(event: Event, done: boolean): void {
  hsv.value = { ...hsv.value, h: Number((event.target as HTMLInputElement).value) }
  if (done) emit('commit', current(), props.opacity)
  else emit('preview', current(), props.opacity)
}
function onAlpha(event: Event, done: boolean): void {
  alpha.value = Number((event.target as HTMLInputElement).value) / 100
  if (done) emit('commit', current(), props.opacity)
  else emit('preview', current(), props.opacity)
}
function onHex(event: Event): void {
  const parsed = hexToColor((event.target as HTMLInputElement).value, alpha.value)
  if (!parsed) {
    invalidHex.value = true
    return
  }
  invalidHex.value = false
  hsv.value = rgbToHsv(parsed)
  emit('commit', current(), props.opacity)
}
function onOpacity(event: Event): void {
  const pct = Number(String((event.target as HTMLInputElement).value).replace('%', ''))
  if (!Number.isFinite(pct)) return
  emit('commit', current(), Math.min(100, Math.max(0, pct)) / 100)
}

const hasEyeDropper = 'EyeDropper' in globalThis
async function onEyedrop(): Promise<void> {
  try {
    const Dropper = (globalThis as Record<string, unknown>).EyeDropper as new () => {
      open(): Promise<{ sRGBHex: string }>
    }
    const picked = await new Dropper().open()
    const color = hexToColor(picked.sRGBHex, alpha.value)
    if (!color) return
    hsv.value = rgbToHsv(color)
    emit('commit', current(), props.opacity)
  } catch {
    /* cancelled — nothing to do */
  }
}

function onSwatch(color: Rgba): void {
  hsv.value = rgbToHsv(color)
  alpha.value = color.a
  emit('commit', current(), props.opacity)
}
</script>

<template>
  <div ref="root" class="picker-dialog" :class="{ 'flip-up': flipUp }">
    <div v-if="libraries?.length" class="picker-tabs">
      <button
        type="button"
        class="picker-tab picker-tab-custom"
        :class="{ on: tab === 'custom' }"
        @click="tab = 'custom'"
      >
        Custom
      </button>
      <button
        type="button"
        class="picker-tab picker-tab-libraries"
        :class="{ on: tab === 'libraries' }"
        @click="tab = 'libraries'"
      >
        Libraries
      </button>
    </div>

    <template v-if="tab === 'custom'">
      <div
        class="picker-sv"
        :style="{
          background: `linear-gradient(to top, rgb(0 0 0), transparent),
            linear-gradient(to right, rgb(255 255 255), ${hueColor})`,
        }"
        @pointerdown="onSvDown"
        @pointermove="onSvMove"
        @pointerup="onSvUp"
      >
        <span
          class="picker-thumb"
          :style="{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            background: cssColor(current()),
          }"
        />
      </div>

      <div class="picker-row">
        <button
          v-if="hasEyeDropper"
          type="button"
          class="picker-eyedropper"
          title="pick a colour from the screen"
          aria-label="eyedropper"
          :disabled="!editable"
          @click="onEyedrop"
        >
          <FieldIcon name="droplet" />
        </button>
        <div class="picker-sliders">
          <input
            class="picker-hue"
            type="range"
            min="0"
            max="360"
            :style="{ '--hue-ramp': HUE_RAMP }"
            :value="hsv.h"
            :disabled="!editable"
            aria-label="hue"
            @input="onHue($event, false)"
            @change="onHue($event, true)"
          />
          <input
            class="picker-alpha"
            type="range"
            min="0"
            max="100"
            :style="{ '--alpha-ramp': alphaRamp }"
            :value="Math.round(alpha * 100)"
            :disabled="!editable"
            aria-label="alpha"
            @input="onAlpha($event, false)"
            @change="onAlpha($event, true)"
          />
        </div>
      </div>

      <div class="picker-row">
        <input
          class="picker-hex"
          :class="{ invalid: invalidHex }"
          type="text"
          :value="colorToHex(current())"
          :disabled="!editable"
          aria-label="hex"
          @change="onHex"
        />
        <input
          class="picker-opacity"
          type="text"
          :value="`${Math.round(opacity * 100)}%`"
          :disabled="!editable"
          aria-label="opacity"
          @change="onOpacity"
        />
      </div>

      <div v-if="swatches.length" class="picker-swatches" aria-label="on this page">
        <button
          v-for="(swatch, i) in swatches"
          :key="i"
          type="button"
          class="picker-swatch"
          :style="{ background: cssColor(swatch) }"
          :title="colorToHex(swatch)"
          :disabled="!editable"
          @click="onSwatch(swatch)"
        />
      </div>
    </template>
    <template v-else>
      <div class="library-search">
        <FieldIcon name="search" />
        <input v-model="libraryQuery" placeholder="Search" aria-label="search color variables" />
      </div>
      <div class="library-list">
        <template v-for="[collection, rows] in libraryCollections" :key="collection">
          <p class="library-collection">{{ collection }}</p>
          <VariableRow
            v-for="candidate in rows"
            :key="candidate.address"
            :candidate="candidate"
            :current="candidate.address === currentToken"
            @pick="emit('pick', candidate.address)"
          />
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.picker-dialog {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 10;
  width: 200px;
  display: flex;
  flex-direction: column;
  gap: var(--gap);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: var(--gap);
  box-shadow: var(--shadow);
}
.picker-dialog.flip-up {
  top: auto;
  bottom: 100%;
}
.picker-tabs {
  display: flex;
  gap: var(--gap-sm);
}
.picker-tab {
  flex: 1;
  height: var(--field-h);
  border: 0;
  border-radius: var(--radius);
  background: none;
  color: var(--text-dim);
  font: inherit;
  cursor: pointer;
}
.picker-tab.on {
  background: var(--raised);
  color: var(--text);
}
.library-search {
  display: flex;
  gap: var(--gap-sm);
  align-items: center;
  height: var(--field-h);
  padding: 0 6px;
  border-radius: var(--radius);
  background: var(--raised);
  color: var(--text-faint);
}
.library-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  outline: none;
}
.library-list {
  max-height: 240px;
  overflow-y: auto;
}
.library-collection {
  margin: 2px 0 0;
  padding: 0 6px;
  color: var(--text-faint);
}
.picker-sv {
  position: relative;
  width: 100%;
  height: 120px;
  border-radius: var(--radius);
  cursor: crosshair;
  touch-action: none;
}
.picker-thumb {
  position: absolute;
  width: 10px;
  height: 10px;
  border: 1.5px solid var(--text);
  border-radius: 999px;
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.picker-row {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
}
.picker-sliders {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
}
.picker-hue,
.picker-alpha {
  /* The native track would paint over the ramp, so the element draws its own. */
  appearance: none;
  -webkit-appearance: none;
  width: 100%;
  height: 10px;
  border-radius: var(--radius);
  cursor: pointer;
}
/* Both tracks have to show what they select, and both ramps are data — they
   come in as inline `:style` bindings, like the SV gradient. */
.picker-hue {
  background: var(--hue-ramp);
}
/* The alpha track is the one place a checkerboard belongs: it is the only way
   to read a colour's transparency against the panel. Data, not decoration. */
.picker-alpha {
  background:
    var(--alpha-ramp),
    conic-gradient(
        var(--text-faint) 0 25%,
        transparent 0 50%,
        var(--text-faint) 0 75%,
        transparent 0
      )
      0 0 / 8px 8px;
}
.picker-hue::-webkit-slider-thumb,
.picker-alpha::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border: 2px solid var(--text);
  border-radius: 999px;
  background: transparent;
  box-shadow: var(--shadow);
  cursor: grab;
}
.picker-hue::-moz-range-thumb,
.picker-alpha::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border: 2px solid var(--text);
  border-radius: 999px;
  background: transparent;
  box-sizing: border-box;
  cursor: grab;
}
.picker-hue:focus-visible,
.picker-alpha:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: 1px;
}
.picker-eyedropper {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 24px;
  height: 24px;
  background: var(--raised);
  border: 1px solid transparent;
  border-radius: var(--radius);
  color: var(--text-dim);
  cursor: pointer;
}
.picker-eyedropper:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--line);
}
.picker-hex {
  flex: 1;
  min-width: 0;
}
.picker-opacity {
  flex: none;
  width: 48px;
  text-align: right;
}
.picker-hex,
.picker-opacity {
  height: var(--field-h);
  box-sizing: border-box;
  background: var(--raised);
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  color: var(--text);
  font-family: var(--ui-font);
  font-size: var(--ui-size);
  padding: 2px 6px;
}
.picker-hex:focus,
.picker-opacity:focus {
  outline: none;
  border-color: var(--accent);
}
.picker-hex.invalid {
  border-color: var(--danger);
}
.picker-swatches {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: var(--gap-sm);
}
.picker-swatch {
  aspect-ratio: 1;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  cursor: pointer;
  padding: 0;
}
button:disabled,
input:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
