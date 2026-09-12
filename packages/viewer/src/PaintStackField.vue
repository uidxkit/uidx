<script setup lang="ts">
import { computed, ref } from 'vue'
import { FieldIcon } from './field-icons'
import type { JsonValue } from '@uidx/format'
import type { EditableProp } from './editable'
import ColorPickerDialog from './ColorPickerDialog.vue'
import AssignPopup from './AssignPopup.vue'
import type { TokenIndex } from '@uidx/schema'
import { variableCandidates } from './variable-binding'
import {
  asPaints,
  colorToHex,
  cssColor,
  hexToColor,
  paintColorAlias,
  paintRgba,
  removePaint,
  setPaintColor,
  setPaintColorAlias,
  setPaintOpacity,
  togglePaintVisible,
  type PaintLike,
  type Rgba,
} from './paint-edit'

/**
 * Figma's paint stack (story C8): one row per paint — swatch, hex, opacity,
 * eye, remove. Solid paints edit; gradient and image paints render labelled
 * and read-only but still hide and remove, because visibility and removal
 * are type-agnostic. The `+` that appends a solid lives on the section
 * header now (UI3 pass 3), Figma's own placement.
 *
 * Every edit computes the next whole value in `paint-edit.ts` and emits it;
 * add-vs-set, D4 and the burst batching all happen downstream, exactly as
 * they do for a number scrub.
 */
const props = defineProps<{
  field: EditableProp
  editable: boolean
  swatches: Rgba[]
  tokens?: ReadonlyMap<string, JsonValue>
  /** Declared token data, for the scope filter (G8). */
  tokenIndex?: TokenIndex
}>()

const emit = defineEmits<{
  preview: [prop: string, value: JsonValue]
  commit: [prop: string, value: JsonValue]
}>()

/** Index of the paint whose picker popover is open, or null. */
const open = ref<number | null>(null)
const openVariables = ref<number | null>(null)
const variablesTrigger = ref<Element | null>(null)
function pickTokens(index: number, event: MouseEvent): void {
  variablesTrigger.value = event.currentTarget as Element
  open.value = null
  openVariables.value = openVariables.value === index ? null : index
}

const paints = (): PaintLike[] => asPaints(props.field.value) ?? []

/** COLOR variables the Libraries tab lists, grouped by collection there. */
const colorVariables = computed(() =>
  variableCandidates(props.tokens, props.tokenIndex, 'COLOR', props.field.name),
)

/** What the swatch paints: the resolved colour, or transparent for an unresolvable alias. */
function swatchCss(paint: PaintLike): string {
  const rgba = paintRgba(paint, props.tokens)
  return rgba ? cssColor(rgba, paint.opacity ?? 1) : 'transparent'
}

const label = (paint: PaintLike): string =>
  paint.type === 'SOLID'
    ? ''
    : paint.type.startsWith('GRADIENT')
      ? 'Gradient'
      : paint.type.charAt(0) + paint.type.slice(1).toLowerCase()

/**
 * Row-level edits close the picker they came from; edits made *inside* the
 * dialog keep it open, because a colour is chosen by trying several.
 */
function commit(value: JsonValue, close = true): void {
  if (!props.editable) return
  if (close) {
    open.value = null
    openVariables.value = null
  }
  emit('commit', props.field.name, value)
}

function onHex(index: number, event: Event): void {
  // Only reached from the literal branch (an alias hides the hex input), so
  // the color read is narrow even though the type is now `Rgba | string`.
  const paint = paints()[index]
  const color = hexToColor(
    (event.target as HTMLInputElement).value,
    (paint?.color as Rgba | undefined)?.a ?? 1,
  )
  if (!color) return
  commit(setPaintColor(paints(), index, color))
}

/**
 * Colour and opacity arrive together from the dialog, but only the fields the
 * gesture actually moved may reach the file: a hue drag must not add
 * `opacity: 1` to a paint that never declared one — same normalize-before-you-
 * call-it-an-edit rule C8 settled on for fills.
 */
function nextPaints(index: number, color: Rgba, opacity: number): JsonValue {
  const current = paints()
  const withColor = asPaints(setPaintColor(current, index, color))!
  const held = current[index]?.opacity ?? 1
  return held === opacity
    ? (withColor as unknown as JsonValue)
    : setPaintOpacity(withColor, index, opacity)
}

function emitPreviewColor(index: number, color: Rgba, opacity: number): void {
  if (!props.editable) return
  emit('preview', props.field.name, nextPaints(index, color, opacity))
}

function commitColor(index: number, color: Rgba, opacity: number): void {
  commit(nextPaints(index, color, opacity), false)
}

function onOpacity(index: number, event: Event): void {
  const pct = Number((event.target as HTMLInputElement).value.trim().replace(/%$/, ''))
  if (!Number.isFinite(pct)) return
  commit(setPaintOpacity(paints(), index, Math.min(100, Math.max(0, pct)) / 100))
}
</script>

<template>
  <div class="paints" :data-authored="field.authored">
    <div
      v-for="(paint, i) in paints()"
      :key="i"
      class="paint-row"
      :data-hidden="paint.visible === false"
    >
      <button
        type="button"
        class="paint-swatch"
        data-picker-trigger
        :style="{ background: swatchCss(paint) }"
        :disabled="!editable || paint.type !== 'SOLID'"
        :title="paint.type"
        :aria-label="`Edit ${field.label.toLowerCase()} color ${i + 1}`"
        @click="open = open === i ? null : i"
      />

      <template v-if="paint.type === 'SOLID' && !paintColorAlias(paint)">
        <input
          class="paint-hex"
          type="text"
          :value="paint.color ? colorToHex(paint.color as Rgba) : ''"
          :disabled="!editable"
          :title="`${field.name} hex`"
          :aria-label="`${field.name} hex`"
          @change="onHex(i, $event)"
        />
        <button
          v-if="editable"
          type="button"
          class="paint-variables"
          data-popup-trigger
          :title="`Apply token to ${field.label.toLowerCase()} color ${i + 1}`"
          :aria-label="`Apply token to ${field.label.toLowerCase()} color ${i + 1}`"
          :aria-expanded="openVariables === i"
          @click="pickTokens(i, $event)"
        >
          <FieldIcon name="variables-grid" />
        </button>
        <input
          class="paint-opacity"
          type="text"
          :value="`${Math.round((paint.opacity ?? 1) * 100)}%`"
          :disabled="!editable"
          :title="`${field.name} opacity`"
          :aria-label="`${field.name} opacity`"
          @change="onOpacity(i, $event)"
        />
      </template>
      <template v-else-if="paint.type === 'SOLID'">
        <button
          type="button"
          class="paint-token"
          data-picker-trigger
          :disabled="!editable"
          :title="paintColorAlias(paint)!"
          @click="open = open === i ? null : i"
        >
          {{ paintColorAlias(paint)!.split('#').pop() }}
        </button>
        <button
          type="button"
          class="paint-detach"
          :disabled="!editable || !paintRgba(paint, tokens)"
          title="replace the binding with its color"
          @click="commit(setPaintColor(paints(), i, paintRgba(paint, tokens)!))"
        >
          <FieldIcon name="unlink-property" />
        </button>
      </template>
      <span v-else class="paint-readonly">{{ label(paint) }}</span>

      <button
        type="button"
        class="paint-eye"
        :disabled="!editable"
        :title="paint.visible === false ? 'show' : 'hide'"
        :aria-label="`${paint.visible === false ? 'Show' : 'Hide'} ${field.label.toLowerCase()} ${i + 1}`"
        @click="commit(togglePaintVisible(paints(), i))"
      >
        <FieldIcon :name="paint.visible === false ? 'eye-off' : 'eye'" />
      </button>
      <button
        type="button"
        class="paint-remove"
        :disabled="!editable"
        title="remove"
        :aria-label="`Remove ${field.label.toLowerCase()} ${i + 1}`"
        @click="commit(removePaint(paints(), i))"
      >
        <FieldIcon name="close" />
      </button>

      <AssignPopup
        v-if="openVariables === i"
        :candidates="null"
        :component-name="null"
        :variables="colorVariables"
        :bound-to="paintColorAlias(paint)"
        :trigger="variablesTrigger"
        icon="variable"
        @variable="(address) => commit(setPaintColorAlias(paints(), i, address))"
        @close="openVariables = null"
      />
      <ColorPickerDialog
        v-if="open === i && paint.type === 'SOLID'"
        :color="paintRgba(paint, tokens) ?? { r: 0.5, g: 0.5, b: 0.5, a: 1 }"
        :opacity="paint.opacity ?? 1"
        :swatches="swatches"
        :editable="editable"
        :libraries="colorVariables"
        :current-token="paintColorAlias(paint)"
        @preview="(c, o) => emitPreviewColor(i, c, o)"
        @commit="(c, o) => commitColor(i, c, o)"
        @close="open = null"
        @pick="(a) => commit(setPaintColorAlias(paints(), i, a), false)"
      />
    </div>
  </div>
</template>

<style scoped>
.paints {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
}
.paint-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
}
.paint-row[data-hidden='true'] {
  opacity: 0.5;
}
.paint-swatch {
  flex: none;
  width: 24px;
  height: 24px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  cursor: pointer;
  padding: 0;
}
.paint-hex {
  flex: 1;
  min-width: 0;
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
.paint-opacity {
  flex: none;
  width: 52px;
  height: var(--field-h);
  box-sizing: border-box;
  background: var(--raised);
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  color: var(--text);
  font-family: var(--ui-font);
  font-size: var(--ui-size);
  padding: 2px 6px;
  text-align: right;
}
.paint-hex:hover:not(:disabled),
.paint-opacity:hover:not(:disabled) {
  border-color: var(--line);
}
.paint-hex:focus,
.paint-opacity:focus {
  outline: none;
  border-color: var(--accent);
}
.paint-readonly {
  flex: 1;
  color: var(--text-dim);
}
/* Mirrors .token-pill (PropertyField.vue): the raised, ellipsizing name box
   Figma draws for a bound value, sized here to sit beside the eye/remove. */
.paint-token {
  display: inline-flex;
  flex: 1;
  align-items: center;
  min-width: 0;
  height: var(--field-h);
  padding: 0 6px;
  border: 0;
  border-radius: var(--radius-lg);
  background: var(--raised);
  color: var(--text);
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.paint-token:hover:not(:disabled) {
  background: color-mix(in srgb, var(--raised) 80%, var(--text) 8%);
}
.paint-variables,
.paint-eye,
.paint-remove,
.paint-detach {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: var(--field-h);
  flex: none;
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: var(--ui-size-sm);
  padding: 0 2px;
}
.paint-variables:hover:not(:disabled),
.paint-eye:hover:not(:disabled),
.paint-remove:hover:not(:disabled),
.paint-detach:hover:not(:disabled) {
  color: var(--text);
}
button:disabled,
input:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
