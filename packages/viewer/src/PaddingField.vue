<script setup lang="ts">
import LengthFieldRoot from './LengthFieldRoot.vue'
import LengthUnitSelect from './LengthUnitSelect.vue'
import { computed, ref, watch, inject } from 'vue'
import { parseLength, type JsonValue } from '@uidx/format'
import { LENGTH_FIELD_CONTEXT } from './length-field-context'
import TokenBinding from './TokenBinding.vue'
import type { TokenBindingSource, TokenDetachWrite } from './token-binding-source'
import { FieldIcon, type IconName } from './field-icons'
import { paddingModel, paddingWrites, type SideValues } from './edit-models'

/**
 * Figma's padding control (story C9): one box per axis while the pair agrees,
 * four the moment it does not. Whether it can collapse is `edit-models.ts`'s
 * arithmetic; this component only draws the answer and emits the writes it
 * names.
 *
 * A collapsed box emits two commits in the same tick, and `patch-burst`
 * makes them one envelope — so a symmetric padding edit is one revision.
 */
const props = defineProps<{
  values: SideValues
  editable: boolean
  tokenSource?: TokenBindingSource
}>()

const emit = defineEmits<{
  bind: [properties: string[], token: string]
  detach: [writes: TokenDetachWrite[]]
  /**
   * A scrub step or a keystroke: the writes a commit would make, shown on the
   * canvas and held in the field but never written to the file — so the
   * children reflow as the number moves rather than jumping on release.
   */
  preview: [writes: Array<{ prop: string; value: JsonValue }>]
  commit: [writes: Array<{ prop: string; value: JsonValue }>]
  hover: [prop: string | null]
}>()

const lengthContext = inject(LENGTH_FIELD_CONTEXT, undefined)
const unitOf = (prop: string) => parseLength(lengthContext?.valueFor(prop))?.unit ?? 'px'
const model = computed(() => paddingModel(props.values))
/** Sides that disagree cannot be shown as one number, so the control opens open. */
const forced = computed(
  () =>
    unitOf('paddingLeft') !== unitOf('paddingRight') ||
    unitOf('paddingTop') !== unitOf('paddingBottom') ||
    model.value.horizontal === null ||
    model.value.vertical === null ||
    props.tokenSource?.bindings.paddingLeft !== props.tokenSource?.bindings.paddingRight ||
    props.tokenSource?.bindings.paddingTop !== props.tokenSource?.bindings.paddingBottom,
)
const wanted = ref(false)
const expanded = computed(() => forced.value || wanted.value)

// A node whose sides disagree must not stay collapsed from the last selection.
watch(forced, (isForced) => {
  if (isForced) wanted.value = false
})

const AXES = [
  { axis: 'horizontal' as const, icon: 'padding-h' as IconName, label: 'horizontal padding' },
  { axis: 'vertical' as const, icon: 'padding-v' as IconName, label: 'vertical padding' },
]

const SIDES = [
  { side: 'left' as const, prop: 'paddingLeft', icon: 'padding-left' as IconName },
  { side: 'right' as const, prop: 'paddingRight', icon: 'padding-right' as IconName },
  { side: 'top' as const, prop: 'paddingTop', icon: 'padding-top' as IconName },
  { side: 'bottom' as const, prop: 'paddingBottom', icon: 'padding-bottom' as IconName },
]

const axisValue = (axis: 'horizontal' | 'vertical'): number =>
  (axis === 'horizontal' ? model.value.horizontal : model.value.vertical) ?? 0

/** The writes an axis edit makes, or null when it may not be made. */
function axisWrites(
  axis: 'horizontal' | 'vertical',
  value: JsonValue,
): Array<{ prop: string; value: JsonValue }> | null {
  if (!props.editable || !parseLength(value)) return null
  const writes = paddingWrites(axis, 0).map(({ prop }) => ({ prop, value }))
  if (writes.some(({ prop }) => props.tokenSource?.bindings[prop])) return null
  return writes
}

function previewAxis(axis: 'horizontal' | 'vertical', value: JsonValue): void {
  const writes = axisWrites(axis, value)
  if (writes) emit('preview', writes)
}

function commitAxis(axis: 'horizontal' | 'vertical', value: JsonValue): void {
  const writes = axisWrites(axis, value)
  if (writes) emit('commit', writes)
}

function sideWrite(
  prop: string,
  value: JsonValue,
): Array<{ prop: string; value: JsonValue }> | null {
  if (!props.editable || !parseLength(value) || props.tokenSource?.bindings[prop]) return null
  return [{ prop, value }]
}

function previewSide(prop: string, value: JsonValue): void {
  const writes = sideWrite(prop, value)
  if (writes) emit('preview', writes)
}

function commitSide(prop: string, value: JsonValue): void {
  const writes = sideWrite(prop, value)
  if (writes) emit('commit', writes)
}
</script>

<template>
  <div class="padding-field" :data-expanded="expanded">
    <div class="padding-boxes" :data-count="expanded ? 4 : 2">
      <template v-if="!expanded">
        <TokenBinding
          v-for="entry in AXES"
          :key="entry.axis"
          :properties="
            entry.axis === 'horizontal'
              ? ['paddingLeft', 'paddingRight']
              : ['paddingTop', 'paddingBottom']
          "
          :label="entry.label"
          :source="tokenSource"
          :editable="editable"
          @bind="(names, token) => emit('bind', names, token)"
          @detach="(writes) => emit('detach', writes)"
        >
          <LengthFieldRoot
            v-slot="{ attrs, actions, state, displayValue, draftValue, unit, selectUnit }"
            :model-value="axisValue(entry.axis)"
            :length-property="entry.axis === 'horizontal' ? 'paddingLeft' : 'paddingTop'"
            :disabled="!editable"
            :label="entry.label"
            :step="1"
            @update:model-value="(v: JsonValue) => previewAxis(entry.axis, v)"
            @commit="(v: JsonValue) => commitAxis(entry.axis, v)"
          >
            <span
              class="padding-box"
              :data-axis="entry.axis"
              @mouseenter="
                emit('hover', entry.axis === 'horizontal' ? 'paddingLeft' : 'paddingTop')
              "
              @mouseleave="emit('hover', null)"
            >
              <span class="length-number-content" v-bind="attrs">
                <span
                  class="prefix field-glyph"
                  :class="{ disabled: !editable }"
                  :title="entry.label"
                  @pointerdown="actions.startScrub($event)"
                >
                  <FieldIcon :name="entry.icon" />
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
                label="Padding"
                @change="selectUnit"
              />
            </span>
          </LengthFieldRoot>
        </TokenBinding>
      </template>

      <template v-else>
        <TokenBinding
          v-for="entry in SIDES"
          :key="entry.side"
          :properties="[entry.prop]"
          :label="entry.prop"
          :source="tokenSource"
          :editable="editable"
          @bind="(names, token) => emit('bind', names, token)"
          @detach="(writes) => emit('detach', writes)"
        >
          <LengthFieldRoot
            v-slot="{ attrs, actions, state, displayValue, draftValue, unit, selectUnit }"
            :model-value="values[entry.side]"
            :length-property="entry.prop"
            :disabled="!editable"
            :label="entry.prop"
            :step="1"
            @update:model-value="(v: JsonValue) => previewSide(entry.prop, v)"
            @commit="(v: JsonValue) => commitSide(entry.prop, v)"
          >
            <span
              class="padding-box"
              :data-side="entry.side"
              @mouseenter="emit('hover', entry.prop)"
              @mouseleave="emit('hover', null)"
            >
              <span class="length-number-content" v-bind="attrs">
                <span
                  class="prefix field-glyph"
                  :class="{ disabled: !editable }"
                  :title="entry.prop"
                  @pointerdown="actions.startScrub($event)"
                >
                  <FieldIcon :name="entry.icon" />
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
                label="Padding"
                @change="selectUnit"
              />
            </span>
          </LengthFieldRoot>
        </TokenBinding>
      </template>
    </div>

    <button
      type="button"
      class="padding-expand"
      :data-active="expanded"
      :disabled="forced"
      :title="expanded ? 'padding per side' : 'padding per axis'"
      :aria-label="expanded ? 'collapse padding' : 'expand padding'"
      :aria-pressed="expanded"
      @click="wanted = !wanted"
    >
      <FieldIcon name="expand" />
    </button>
  </div>
</template>

<style scoped>
.padding-field {
  display: flex;
  align-items: start;
  gap: var(--gap-sm);
}
.padding-boxes {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--gap-sm);
}
.padding-box {
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
.padding-box:hover {
  border-color: var(--line);
}
.padding-box:focus-within {
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
.padding-expand {
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
.padding-expand:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--line);
}
.padding-expand[data-active='true'] {
  color: var(--accent);
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
