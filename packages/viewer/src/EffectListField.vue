<script setup lang="ts">
import LengthFieldRoot from './LengthFieldRoot.vue'
import LengthUnitSelect from './LengthUnitSelect.vue'
import { computed, ref, inject } from 'vue'
import { parseLength, lengthToPx, type LengthValue, type JsonValue } from '@uidx/format'
import { LENGTH_FIELD_CONTEXT } from './length-field-context'
import type { EditableProp } from './editable'
import ColorPickerDialog from './ColorPickerDialog.vue'
import { FieldIcon, type IconName } from './field-icons'
import {
  asEffects,
  colorToHex,
  cssColor,
  removeEffect,
  setEffectColor,
  setEffectField,
  setEffectType,
  toggleEffectVisible,
  type EffectLike,
  type Rgba,
} from './paint-edit'

/**
 * Figma's effects list (story C8): a row per effect — type, X / Y / blur /
 * spread, colour, eye, remove. The `+` whose first effect is Figma's default
 * drop shadow lives on the section header now (UI3 pass 3), Figma's own
 * placement. Same discipline as the paint stack: compute the next whole
 * value, emit it, let the write path decide everything else.
 */
const props = defineProps<{ field: EditableProp; editable: boolean; swatches: Rgba[] }>()

const emit = defineEmits<{
  preview: [prop: string, value: JsonValue]
  commit: [prop: string, value: JsonValue]
}>()

const EFFECT_TYPES = [
  'DROP_SHADOW',
  'INNER_SHADOW',
  'LAYER_BLUR',
  'BACKGROUND_BLUR',
  'FOREGROUND_BLUR',
] as const

const effects = (): EffectLike[] => asEffects(props.field.value) ?? []

/**
 * Finding 3: a non-empty `effects` value `asEffects` rejects is not "no
 * effects" — it is effects this panel cannot parse (an entry's `color` is a
 * variable alias, not a literal `Rgba`). Rendering nothing there reads as an
 * empty list, which is what made the header's `+` believe it was additive
 * rather than destructive. This tells the truth instead.
 */
const readOnly = computed(
  () =>
    Array.isArray(props.field.value) &&
    props.field.value.length > 0 &&
    asEffects(props.field.value) === null,
)

function commit(value: JsonValue): void {
  if (!props.editable) return
  emit('commit', props.field.name, value)
}

const lengthContext = inject(LENGTH_FIELD_CONTEXT, undefined)
const measured = (value: LengthValue) => lengthToPx(value, lengthContext?.rootFontSize.value) ?? 0

type NumKey = 'x' | 'y' | 'radius' | 'spread'

/** The four numbers, in Figma's order, with the glyph each one wears. */
const NUM_FIELDS: ReadonlyArray<{ key: NumKey; cls: string; icon?: IconName; letter?: string }> = [
  { key: 'x', cls: 'effect-x', letter: 'X' },
  { key: 'y', cls: 'effect-y', letter: 'Y' },
  { key: 'radius', cls: 'effect-radius', icon: 'blur' },
  { key: 'spread', cls: 'effect-spread', icon: 'spread' },
]

const numValue = (effect: EffectLike, key: NumKey): LengthValue =>
  key === 'x'
    ? effect.offset.x
    : key === 'y'
      ? effect.offset.y
      : key === 'radius'
        ? effect.radius
        : effect.spread

function previewNumber(index: number, key: NumKey, value: JsonValue): void {
  if (!props.editable || !parseLength(value)) return
  emit('preview', props.field.name, setEffectField(effects(), index, key, value as LengthValue))
}

function commitNumber(index: number, key: NumKey, value: JsonValue): void {
  if (!parseLength(value)) return
  commit(setEffectField(effects(), index, key, value as LengthValue))
}

/** Index of the effect whose colour dialog is open, or null. */
const openColor = ref<number | null>(null)

function previewColor(index: number, color: Rgba): void {
  if (!props.editable) return
  emit('preview', props.field.name, setEffectColor(effects(), index, color))
}

/** The dialog stays open across its own commits — see PaintStackField. */
function commitColor(index: number, color: Rgba): void {
  commit(setEffectColor(effects(), index, color))
}
</script>

<template>
  <p v-if="readOnly" class="effects-readonly">Authored with variables — edit in the file</p>
  <div v-else class="effects">
    <div
      v-for="(effect, i) in effects()"
      :key="i"
      class="effect-row"
      :data-hidden="!effect.visible"
    >
      <div class="effect-main">
        <button
          type="button"
          class="effect-swatch"
          data-picker-trigger
          :disabled="!editable"
          :style="{ background: cssColor(effect.color) }"
          :title="colorToHex(effect.color)"
          :aria-label="`effect colour ${colorToHex(effect.color)}`"
          @click="openColor = openColor === i ? null : i"
        />
        <ColorPickerDialog
          v-if="openColor === i"
          :color="effect.color"
          :opacity="effect.color.a"
          :swatches="swatches"
          :editable="editable"
          @preview="(c) => previewColor(i, c)"
          @commit="(c) => commitColor(i, c)"
          @close="openColor = null"
        />
        <select
          class="effect-type"
          :value="effect.type"
          :disabled="!editable"
          title="effect type"
          aria-label="effect type"
          @change="commit(setEffectType(effects(), i, ($event.target as HTMLSelectElement).value))"
        >
          <option v-for="t in EFFECT_TYPES" :key="t" :value="t">
            {{ t.charAt(0) + t.slice(1).toLowerCase().replaceAll('_', ' ') }}
          </option>
        </select>
        <button
          type="button"
          class="effect-eye"
          :disabled="!editable"
          :title="effect.visible ? 'hide' : 'show'"
          :aria-label="`${effect.visible ? 'Hide' : 'Show'} effect ${i + 1}`"
          @click="commit(toggleEffectVisible(effects(), i))"
        >
          <FieldIcon :name="effect.visible ? 'eye' : 'eye-off'" />
        </button>
        <button
          type="button"
          class="effect-remove"
          :disabled="!editable"
          title="remove"
          :aria-label="`Remove effect ${i + 1}`"
          @click="commit(removeEffect(effects(), i))"
        >
          <FieldIcon name="close" />
        </button>
      </div>
      <div class="effect-nums">
        <div v-for="f in NUM_FIELDS" :key="f.key" class="effect-number-field">
          <span class="effect-label">{{
            { x: 'X offset', y: 'Y offset', radius: 'Blur', spread: 'Spread' }[f.key]
          }}</span>
          <LengthFieldRoot
            v-slot="{ attrs, actions, state, displayValue, draftValue, unit, selectUnit }"
            :model-value="measured(numValue(effect, f.key))"
            :length-value="numValue(effect, f.key)"
            :disabled="!editable"
            :label="f.key"
            :step="1"
            @update:model-value="(v: JsonValue) => previewNumber(i, f.key, v)"
            @commit="(v: JsonValue) => commitNumber(i, f.key, v)"
          >
            <span class="effect-num" :class="f.cls">
              <span class="length-number-content" v-bind="attrs">
                <span
                  class="prefix field-glyph"
                  :class="{ disabled: !editable }"
                  :title="
                    {
                      x: 'Horizontal offset',
                      y: 'Vertical offset',
                      radius: 'Blur',
                      spread: 'Spread',
                    }[f.key]
                  "
                  @pointerdown="actions.startScrub($event)"
                >
                  <FieldIcon v-if="f.icon" :name="f.icon" />
                  <template v-else>{{ f.letter }}</template>
                </span>
                <input
                  v-if="state.editing"
                  class="number-input"
                  type="text"
                  :value="draftValue"
                  :disabled="!editable"
                  @input="actions.input($event)"
                  @keydown="actions.keydown($event)"
                  @blur="actions.commitEdit($event)"
                />
                <span
                  v-else
                  class="scrub"
                  :class="{ disabled: !editable }"
                  @pointerdown="actions.startScrub($event)"
                  @dblclick="actions.startEdit()"
                  >{{ displayValue }}</span
                >
              </span>
              <LengthUnitSelect
                :unit="unit"
                :disabled="!editable"
                :label="f.key"
                @change="selectUnit"
              />
            </span>
          </LengthFieldRoot>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.effects {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
}
.effects-readonly {
  margin: 0;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}
.effect-row {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
}
.effect-row[data-hidden='true'] {
  opacity: 0.5;
}
.effect-main {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
}
.effect-swatch {
  flex: none;
  width: 24px;
  height: 24px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 0;
  cursor: pointer;
}
.effect-type {
  flex: 1;
  min-width: 0;
  height: var(--field-h);
  background: var(--raised);
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  color: var(--text);
  font-family: var(--ui-font);
  font-size: var(--ui-size);
  padding: 2px 6px;
}
.effect-eye,
.effect-remove {
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
.effect-eye:hover:not(:disabled),
.effect-remove:hover:not(:disabled) {
  color: var(--text);
}
.effect-nums {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gap-sm);
}
.effect-number-field {
  min-width: 0;
}
.effect-label {
  display: block;
  color: var(--text-dim);
  margin: 4px 0;
  font-size: var(--ui-size-sm);
}
.effect-num {
  display: flex;
  align-items: center;
  gap: 4px;
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
.effect-num .field-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  min-width: 12px;
  color: var(--text-faint);
  cursor: ew-resize;
  user-select: none;
}
.effect-num .field-glyph.disabled,
.effect-num .scrub.disabled {
  cursor: default;
}
.effect-num .scrub {
  flex: 1;
  min-width: 0;
  cursor: ew-resize;
  user-select: none;
}
.effect-num .number-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  padding: 0;
}
.effect-num .number-input:focus {
  outline: none;
}
.effect-num:hover,
.effect-type:hover:not(:disabled) {
  border-color: var(--line);
}
.effect-num:focus-within,
.effect-type:focus {
  outline: none;
  border-color: var(--accent);
}
button:disabled,
input:disabled,
select:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
