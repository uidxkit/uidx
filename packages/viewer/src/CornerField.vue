<script setup lang="ts">
import LengthFieldRoot from './LengthFieldRoot.vue'
import LengthUnitSelect from './LengthUnitSelect.vue'
import { computed, ref, watch, inject } from 'vue'
import { parseLength, type JsonValue } from '@uidx/format'
import { LENGTH_FIELD_CONTEXT } from './length-field-context'
import TokenBinding from './TokenBinding.vue'
import type { TokenBindingSource, TokenDetachWrite } from './token-binding-source'
import { FieldIcon } from './field-icons'
import { cornerModel, cornerWrites, type SideValues } from './edit-models'

/**
 * Corner radius, Figma's way (story C9): one box while the four corners
 * agree, four boxes and a smoothing field when they do not.
 *
 * Which props a uniform edit writes depends on what the file already says.
 * A document that only ever wrote `cornerRadius` keeps writing
 * `cornerRadius` — expanding a shorthand into four longhand props behind the
 * author's back would be a diff they never asked for.
 */
const props = defineProps<{
  /** The four corners as the document resolves them. */
  corners: SideValues
  /** True once any per-corner prop is authored, which is what a uniform edit then writes. */
  perCorner: boolean
  smoothing: number
  editable: boolean
  tokenSource?: TokenBindingSource
}>()

const emit = defineEmits<{
  bind: [properties: string[], token: string]
  detach: [writes: TokenDetachWrite[]]
  /**
   * A scrub step or a keystroke: the same writes a commit would make, shown
   * on the canvas and held in the field, but never written to the file. The
   * pane routes these through the preview path `PropertyField` uses, so the
   * corners round as the number moves rather than jumping on release.
   */
  preview: [writes: Array<{ prop: string; value: JsonValue }>]
  commit: [writes: Array<{ prop: string; value: JsonValue }>]
  hover: [prop: string | null]
}>()

const CORNERS = [
  { side: 'top' as const, prop: 'topLeftRadius', label: 'top left', turn: 0 },
  { side: 'right' as const, prop: 'topRightRadius', label: 'top right', turn: 90 },
  { side: 'bottom' as const, prop: 'bottomRightRadius', label: 'bottom right', turn: 180 },
  { side: 'left' as const, prop: 'bottomLeftRadius', label: 'bottom left', turn: 270 },
]

const lengthContext = inject(LENGTH_FIELD_CONTEXT, undefined)
const model = computed(() => cornerModel(props.corners))
const forced = computed(
  () =>
    new Set(CORNERS.map((c) => parseLength(lengthContext?.valueFor(c.prop))?.unit ?? 'px')).size >
      1 ||
    model.value.uniform === null ||
    new Set(CORNERS.map((corner) => props.tokenSource?.bindings[corner.prop])).size > 1,
)
const wanted = ref(false)
const expanded = computed(() => forced.value || wanted.value)

watch(forced, (isForced) => {
  if (isForced) wanted.value = false
})

/** The writes a uniform edit makes, or null when it may not be made. */
function uniformWrites(value: JsonValue): Array<{ prop: string; value: JsonValue }> | null {
  if (!props.editable || !parseLength(value)) return null
  const writes = props.perCorner
    ? cornerWrites(0).map(({ prop }) => ({ prop, value }))
    : [{ prop: 'cornerRadius', value }]
  if (writes.some(({ prop }) => props.tokenSource?.bindings[prop])) return null
  return writes
}

function previewUniform(value: JsonValue): void {
  const writes = uniformWrites(value)
  if (writes) emit('preview', writes)
}

function commitUniform(value: JsonValue): void {
  const writes = uniformWrites(value)
  if (writes) emit('commit', writes)
}

function cornerWrite(
  prop: string,
  value: JsonValue,
): Array<{ prop: string; value: JsonValue }> | null {
  if (!props.editable || !parseLength(value) || props.tokenSource?.bindings[prop]) return null
  return [{ prop, value }]
}

function previewCorner(prop: string, value: JsonValue): void {
  const writes = cornerWrite(prop, value)
  if (writes) emit('preview', writes)
}

function commitCorner(prop: string, value: JsonValue): void {
  const writes = cornerWrite(prop, value)
  if (writes) emit('commit', writes)
}

function smoothingWrite(percent: JsonValue): Array<{ prop: string; value: JsonValue }> | null {
  if (
    typeof percent !== 'number' ||
    !props.editable ||
    !Number.isFinite(percent) ||
    props.tokenSource?.bindings.cornerSmoothing
  )
    return null
  return [{ prop: 'cornerSmoothing', value: Math.min(100, Math.max(0, percent)) / 100 }]
}

function previewSmoothing(percent: JsonValue): void {
  const writes = smoothingWrite(percent)
  if (writes) emit('preview', writes)
}

function commitSmoothing(percent: JsonValue): void {
  const writes = smoothingWrite(percent)
  if (writes) emit('commit', writes)
}
</script>

<template>
  <div class="corner-field" :data-expanded="expanded">
    <div class="corner-boxes" :data-count="expanded ? 4 : 1">
      <TokenBinding
        v-if="!expanded"
        :properties="perCorner ? CORNERS.map((corner) => corner.prop) : ['cornerRadius']"
        :label="'Corner radius'"
        :source="tokenSource"
        :editable="editable"
        @bind="(names, token) => emit('bind', names, token)"
        @detach="(writes) => emit('detach', writes)"
      >
        <LengthFieldRoot
          v-slot="{ attrs, actions, state, displayValue, draftValue, unit, selectUnit }"
          :model-value="model.uniform ?? 0"
          :length-property="perCorner ? 'topLeftRadius' : 'cornerRadius'"
          :disabled="!editable"
          label="cornerRadius"
          :step="1"
          @update:model-value="previewUniform"
          @commit="commitUniform"
        >
          <span
            class="corner-box"
            @mouseenter="emit('hover', 'cornerRadius')"
            @mouseleave="emit('hover', null)"
          >
            <span class="length-number-content" v-bind="attrs">
              <span
                class="prefix field-glyph"
                :class="{ disabled: !editable }"
                title="Corner radius"
                @pointerdown="actions.startScrub($event)"
              >
                <FieldIcon name="radius" />
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
              label="Radius"
              @change="selectUnit"
            />
          </span>
        </LengthFieldRoot>
      </TokenBinding>

      <TokenBinding
        v-for="corner in expanded ? CORNERS : []"
        :key="corner.prop"
        :properties="[corner.prop]"
        :label="corner.label + ' radius'"
        :source="tokenSource"
        :editable="editable"
        @bind="(names, token) => emit('bind', names, token)"
        @detach="(writes) => emit('detach', writes)"
      >
        <LengthFieldRoot
          v-slot="{ attrs, actions, state, displayValue, draftValue, unit, selectUnit }"
          :model-value="corners[corner.side]"
          :length-property="corner.prop"
          :disabled="!editable"
          :label="corner.prop"
          :step="1"
          @update:model-value="(v: JsonValue) => previewCorner(corner.prop, v)"
          @commit="(v: JsonValue) => commitCorner(corner.prop, v)"
        >
          <span
            class="corner-box"
            :data-corner="corner.side"
            @mouseenter="emit('hover', corner.prop)"
            @mouseleave="emit('hover', null)"
          >
            <span class="length-number-content" v-bind="attrs">
              <span
                class="prefix field-glyph"
                :class="{ disabled: !editable }"
                :title="corner.label"
                :style="{ transform: `rotate(${corner.turn}deg)` }"
                @pointerdown="actions.startScrub($event)"
              >
                <FieldIcon name="radius-corner" />
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
              label="Radius"
              @change="selectUnit"
            />
          </span>
        </LengthFieldRoot>
      </TokenBinding>
    </div>

    <button
      type="button"
      class="corner-expand"
      :data-active="expanded"
      :disabled="forced"
      :title="expanded ? 'radius per corner' : 'one radius'"
      :aria-label="expanded ? 'collapse corners' : 'expand corners'"
      :aria-pressed="expanded"
      @click="wanted = !wanted"
    >
      <FieldIcon name="expand" />
    </button>
  </div>

  <!-- Smoothing only means something once the corners are being tuned. -->
  <div v-if="expanded" class="corner-smoothing-row">
    <span class="smoothing-label">Corner smoothing</span>
    <TokenBinding
      :properties="['cornerSmoothing']"
      :label="'Corner smoothing'"
      :source="tokenSource"
      :editable="editable"
      @bind="(names, token) => emit('bind', names, token)"
      @detach="(writes) => emit('detach', writes)"
    >
      <LengthFieldRoot
        v-slot="{ attrs, actions, state, displayValue, draftValue }"
        :model-value="Math.round(smoothing * 100)"
        :disabled="!editable"
        label="cornerSmoothing"
        :step="1"
        @update:model-value="previewSmoothing"
        @commit="commitSmoothing"
      >
        <span class="corner-smoothing" v-bind="attrs">
          <span
            class="prefix field-glyph"
            :class="{ disabled: !editable }"
            title="Corner smoothing"
            @pointerdown="actions.startScrub($event)"
          >
            <FieldIcon name="radius" />
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
            >{{ displayValue }}%</span
          >
        </span>
      </LengthFieldRoot>
    </TokenBinding>
  </div>
</template>

<style scoped>
.smoothing-label {
  display: block;
  margin-bottom: 4px;
  color: var(--text-dim);
}
.corner-field {
  display: flex;
  align-items: start;
  gap: var(--gap-sm);
}
.corner-boxes {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--gap-sm);
}
.corner-boxes[data-count='1'] {
  grid-template-columns: 1fr 1fr;
}
.corner-smoothing-row {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--gap-sm);
  margin-top: var(--gap-sm);
}
.corner-box,
.corner-smoothing {
  flex: 1;
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
.corner-box:hover,
.corner-smoothing:hover {
  border-color: var(--line);
}
.corner-box:focus-within,
.corner-smoothing:focus-within {
  border-color: var(--accent);
}
.field-glyph {
  display: inline-flex;
  align-items: center;
  flex: none;
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
.corner-expand {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: var(--field-h);
  height: var(--field-h);
  background: none;
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  color: var(--text-faint);
  cursor: pointer;
  padding: 0;
}
.corner-expand:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--line);
}
.corner-expand[data-active='true'] {
  color: var(--accent);
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
