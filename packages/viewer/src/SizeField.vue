<script setup lang="ts">
import LengthFieldRoot from './LengthFieldRoot.vue'
import LengthUnitSelect from './LengthUnitSelect.vue'
import { computed } from 'vue'
import type { JsonValue } from '@uidx/format'
import TokenBinding from './TokenBinding.vue'
import type { TokenBindingSource, TokenDetachWrite } from './token-binding-source'
import { FieldIcon } from './field-icons'

/**
 * The Width / Height box: the number and the Hug/Fixed state that governs it
 * — one control, because a designer reads a width and its sizing mode as one
 * fact. The letter that used to ride inside went with the CSS revision; the
 * caption above (DimensionsField's) names the box now.
 *
 * Which prop the mode writes is the caller's judgement, not this component's:
 * a frame states each axis separately (`primaryAxisSizingMode` /
 * `counterAxisSizingMode`, chosen by the layout direction) and a `<Text>`
 * states both at once in `textAutoResize`. So this emits the *mode* the
 * author picked and lets `size-model.ts` and the pane spell it.
 */
const props = defineProps<{
  dimension: 'width' | 'height'
  /** Null when the file does not author this dimension — a hug, or a derived box. */
  value: number | null
  /** This axis's state, in the panel's own vocabulary rather than any file's. */
  sizingMode: 'FIXED' | 'AUTO'
  /** The attribute the mode writes — for the hover hook and the tooltip. */
  sizingProp: string
  /**
   * The modes this box's menu offers, or null for a bare number. A plain
   * frame's menu holds Fixed alone — what it cannot do (hug) is absent from
   * the menu, not the menu from the box.
   */
  modes: Array<{ value: 'FIXED' | 'AUTO'; label: string }> | null
  editable: boolean
  tokenSource?: TokenBindingSource
}>()

const emit = defineEmits<{
  bind: [properties: string[], token: string]
  detach: [writes: TokenDetachWrite[]]
  preview: [prop: string, value: JsonValue]
  commit: [prop: string, value: JsonValue]
  /** The author picked a sizing state for this axis; the pane writes it. */
  sizing: [dimension: 'width' | 'height', mode: 'FIXED' | 'AUTO']
  hover: [prop: string | null]
}>()

/**
 * A dimension the file leaves out has no number to show. Printing `0` would
 * be a claim the document does not make, so the box shows a dash until an
 * edit gives it one — the number arrives the moment someone types it.
 */
const unset = computed(() => props.value === null)

const modeLabel = computed(() => (props.sizingMode === 'AUTO' ? 'Hug' : 'Fixed'))

function onPreview(value: JsonValue): void {
  if (!props.editable) return
  emit('preview', props.dimension, value)
}

function onCommit(value: JsonValue): void {
  if (!props.editable || props.tokenSource?.bindings[props.dimension]) return
  emit('commit', props.dimension, value)
}

function onMode(event: Event): void {
  if (!props.editable) return
  const picked = (event.target as HTMLSelectElement).value
  if (picked !== 'FIXED' && picked !== 'AUTO') return
  // Re-picking the current mode writes nothing: a single-option menu would
  // otherwise add sizing attributes the file never needed to state.
  if (picked === props.sizingMode) return
  emit('sizing', props.dimension, picked)
}
</script>

<template>
  <div
    class="size-field"
    :data-dimension="dimension"
    @mouseenter="emit('hover', dimension)"
    @mouseleave="emit('hover', null)"
  >
    <span class="size-box">
      <TokenBinding
        :properties="[dimension]"
        :label="dimension === 'width' ? 'Width' : 'Height'"
        :source="tokenSource"
        :editable="editable"
        @bind="(names, token) => emit('bind', names, token)"
        @detach="(writes) => emit('detach', writes)"
      >
        <LengthFieldRoot
          v-slot="{ attrs, actions, state, displayValue, draftValue, unit, selectUnit }"
          :model-value="value ?? 0"
          :length-property="dimension"
          :disabled="!editable"
          :label="dimension"
          :step="1"
          @update:model-value="onPreview"
          @commit="onCommit"
        >
          <span class="size-number">
            <span class="length-number-content" v-bind="attrs">
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
                :class="{ disabled: !editable, unset }"
                @pointerdown="actions.startScrub($event)"
                @dblclick="actions.startEdit()"
                >{{ unset ? '–' : displayValue }}</span
              >
            </span>
            <LengthUnitSelect
              :unit="unit"
              :disabled="!editable || unset"
              :label="dimension"
              @change="selectUnit"
            />
          </span>
        </LengthFieldRoot>
      </TokenBinding>
      <span v-if="modes" class="size-mode-slot">
        <span
          v-if="sizingMode === 'AUTO' && !tokenSource?.bindings[dimension]"
          class="size-mode-label"
          >{{ modeLabel }}</span
        >
        <FieldIcon name="chevron-down" class="size-chevron" />
        <select
          class="size-mode"
          :data-prop="sizingProp"
          :value="sizingMode"
          :disabled="!editable"
          :title="`${dimension} sizing (${sizingProp})`"
          :aria-label="`${dimension} sizing`"
          @change="onMode"
        >
          <option v-for="mode in modes" :key="mode.value" :value="mode.value">
            {{ mode.label }}
          </option>
        </select>
      </span>
    </span>
  </div>
</template>

<style scoped>
.size-field {
  display: flex;
  align-items: center;
  min-width: 0;
}
.size-number {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}
.size-box {
  display: flex;
  align-items: center;
  gap: 4px;
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
.size-box:hover {
  border-color: var(--line);
}
.size-box:focus-within {
  border-color: var(--accent);
}
.field-glyph {
  flex: none;
  min-width: 10px;
  color: var(--text-faint);
  cursor: ew-resize;
  user-select: none;
}
.field-glyph.disabled,
.scrub.disabled {
  cursor: default;
}
.scrub {
  flex: 1;
  min-width: 0;
  cursor: ew-resize;
  user-select: none;
}
.scrub.unset {
  color: var(--text-faint);
}
.number-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  padding: 0;
}
.number-input:focus {
  outline: none;
}
/*
 * The mode's half of the box: its label, the chevron, and the real select
 * laid over both at zero opacity. Sizing the slot from the label keeps the
 * hit target exactly the words it covers.
 */
.size-mode-slot {
  position: relative;
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
  min-width: 0;
  color: var(--text-faint);
}
.size-mode-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--ui-size-sm);
}
.size-chevron {
  flex: none;
}
.size-box:hover .size-mode-slot,
.size-mode:focus-visible + .size-mode-slot,
.size-mode-slot:hover {
  color: var(--text);
}
.size-mode {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  opacity: 0;
  cursor: pointer;
}
.size-mode:disabled {
  cursor: default;
}
select:disabled,
input:disabled {
  opacity: 0.5;
  cursor: default;
}
.size-mode-slot:has(.size-mode:disabled) {
  opacity: 0.5;
}
</style>
