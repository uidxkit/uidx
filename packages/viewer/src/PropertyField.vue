<script setup lang="ts">
import LengthFieldRoot from './LengthFieldRoot.vue'
import LengthUnitSelect from './LengthUnitSelect.vue'
import { computed, ref } from 'vue'
import { SegmentedControlItem, SegmentedControlRoot } from '@open-pencil/vue'
import { LENGTH_PROPS, type JsonValue } from '@uidx/format'
import { optionLabelFor, propUiFor, SEGMENTED_MAX_OPTIONS } from '@uidx/schema'
import type { EditableProp } from './editable'
import ConstraintsMatrix from './ConstraintsMatrix.vue'
import type { TokenIndex } from '@uidx/schema'
import PaintStackField from './PaintStackField.vue'
import EffectListField from './EffectListField.vue'
import DashPatternField from './DashPatternField.vue'
import TextResizeField from './TextResizeField.vue'
import FontFamilyField from './FontFamilyField.vue'
import type { Rgba } from './paint-edit'
import { propertyTypeForField } from './component-prop-edits'
import PropertyLink from './PropertyLink.vue'
import AssignPopup from './AssignPopup.vue'
import { FieldIcon, OPTION_ICON, PROP_ICON } from './field-icons'
import type { VariableCandidate } from './variable-binding'

/** Kinds that render their own label and span the full row. */
const STRUCTURED: ReadonlySet<string> = new Set([
  'constraints',
  'dashes',
  'paint',
  'effects',
  'text-resize',
])

/**
 * One field's markup — a label plus the control its `control` kind calls
 * for. Factored out of `PropertiesPane.vue` so it isn't repeated for a solo
 * field and for each half of a paired row (story C6).
 */
const props = defineProps<{
  field: EditableProp
  /**
   * The properties this field may be linked to, or null when it may not be.
   *
   * Null and empty are different answers: null is "no property type fills this
   * field, or this layer is inside no component", which shows no control at
   * all; empty is "nothing declared yet", which still offers Create.
   */
  candidates?: { name: string; declaration: { type: string; default: JsonValue } }[] | null
  /**
   * What a bound *number* row displays while scrubbing — number-typed
   * because only a number field ever scrubs. A token pill's own display and
   * detach use `tokenLiteral` below instead, which has an answer for any
   * JSON value.
   */
  resolvedValue: number | null
  /**
   * The value a gesture is showing, which the document does not have. The pane
   * holds it (see its `preview` ref) and hands it down; null at rest.
   */
  heldValue: number | null
  editable: boolean
  /**
   * Figma's paired-field look: no label column — a letter prefix sits inside
   * the box instead (X 0 | Y 0, W 600 | H 400). Only the paired geometry props
   * render this way; everything else keeps its full name in the label column.
   */
  compact?: boolean
  /** Match the content editor to the text layer's paragraph direction. */
  textDirection?: 'auto' | 'ltr' | 'rtl'
  /** Every distinct solid the document already uses — the picker's "on this page". */
  swatches?: Rgba[]
  /** The variables this field's control can read, or none. */
  variables?: VariableCandidate[]
  /** The enclosing component's name, for the popup's property-group heading. */
  componentName?: string | null
  /** Token address -> literal, so a paint row can show what an alias resolves to. */
  tokens?: ReadonlyMap<string, JsonValue>
  /** Declared token data, for the picker's scope filter (G8). */
  tokenIndex?: TokenIndex
}>()

/** The letter Figma puts inside the box. Only the paired props have one. */
const FIELD_PREFIX: Record<string, string> = { width: 'W', height: 'H' }

const prefix = (): string => FIELD_PREFIX[props.field.name] ?? props.field.name

const emit = defineEmits<{
  preview: [prop: string, value: JsonValue]
  commit: [prop: string, value: JsonValue]
  /** Link this field to a declared property, or move the link to another. */
  link: [prop: string, name: string]
  /** Remove the link, leaving the property's default behind. */
  unlink: [prop: string]
  /** Declare a property for this field and link it, in one go. */
  create: [prop: string]
  /** Open one declared property for editing, named by the popup's row's ⚙. */
  edit: [name: string]
  /** Bind this field to a variable, chosen from the popup. */
  pickVariable: [prop: string, address: string]
  /**
   * Detach a token pill to its resolved literal — any JSON value, not just a
   * number. Kept apart from `commit`: the scene already renders the resolved
   * value, so a scene-routed commit would produce no change and no patch
   * (the same trap the paint-alias fix closed for fills). The pane routes
   * this one structurally instead.
   */
  detach: [prop: string, value: JsonValue]
}>()

/**
 * Props the file keeps as a 0–1 fraction and Figma shows as a percentage.
 * The control works in percent end to end — display, typing and scrub — and
 * only the value leaving it is a fraction again, so nothing else has to know.
 */
const PERCENT_PROPS: ReadonlySet<string> = new Set(['opacity', 'cornerSmoothing'])
const isLength = computed(() => LENGTH_PROPS.has(props.field.name))
const isPercent = computed(() => PERCENT_PROPS.has(props.field.name))

/**
 * An unset row whose prop has no meaningful default has nothing to show: an
 * unset `maxWidth` is no limit, not zero, and printing a number would state a
 * constraint the document does not set. The dash is the same admission
 * `SizeField` makes for a dimension the file leaves out (C7).
 */
const unset = computed(
  () => !props.field.authored && props.field.value === null && props.heldValue === null,
)

function numberValue(): number {
  const raw = props.heldValue ?? props.resolvedValue ?? 0
  return isPercent.value ? Math.round(raw * 100) : raw
}

/** Back to what the file holds. */
function fromShown(shown: JsonValue): JsonValue {
  return isPercent.value && typeof shown === 'number' ? shown / 100 : shown
}

function step(): number {
  return isPercent.value ? 1 : (propUiFor(props.field.name)?.step ?? 1)
}

function onNumberPreview(value: JsonValue): void {
  if (!props.editable) return
  emit('preview', props.field.name, fromShown(value))
}

function onNumberCommit(value: JsonValue): void {
  if (!props.editable || props.field.boundTo) return
  emit('commit', props.field.name, fromShown(value))
}

function onToggle(event: Event): void {
  if (!props.editable) return
  emit('commit', props.field.name, (event.target as HTMLInputElement).checked)
}

function onText(event: Event): void {
  if (!props.editable) return
  emit('commit', props.field.name, (event.target as HTMLInputElement | HTMLTextAreaElement).value)
}

function onEnum(value: string | string[] | undefined): void {
  if (!props.editable || typeof value !== 'string') return
  emit('commit', props.field.name, value)
}

/**
 * Whether this row's binding is a component property rather than a token.
 *
 * The two share one syntax (F6 settled that), and the difference is an address
 * fact rather than a sigil: a token's global name always contains `#`, and a
 * property name may not (`isPropertyNameFree` refuses one). So a bare target is
 * a property, and that is what decides which of the two bound rows draws.
 */
const propertyBound = computed(
  () => props.field.boundTo !== null && !props.field.boundTo.includes('#'),
)

/**
 * The token pill's literal, straight off the `tokens` map this component
 * already receives — any JSON value, not just a number. `resolvedValue`
 * (above) cannot serve this: it is number-typed for the number field's own
 * scrubbing, so a STRING- or BOOLEAN-bound pill had no answer through it and
 * could never detach.
 */
const tokenLiteral = computed<JsonValue | null>(() =>
  props.field.boundTo ? (props.tokens?.get(props.field.boundTo) ?? null) : null,
)

/** The pill's tooltip text: bare for a primitive, stringified otherwise. */
const tokenLiteralDisplay = computed<JsonValue | string>(() => {
  const literal = tokenLiteral.value
  if (literal === null) return '?'
  return typeof literal === 'object' ? JSON.stringify(literal) : literal
})

function onDetach(): void {
  if (!props.editable || tokenLiteral.value === null) return
  emit('detach', props.field.name, tokenLiteral.value)
}

/** The glyph the pill wears, by the type the field's one property must have. */
const propIcon = computed(() => {
  const type = propertyTypeForField(props.field.name)
  return type === 'TEXT'
    ? 'prop-text'
    : type === 'BOOLEAN'
      ? 'prop-boolean'
      : type === 'INSTANCE_SWAP'
        ? 'prop-instance'
        : null
})

/** Open only while the author is choosing a variable for this number field. */
const pickingVariable = ref(false)
/**
 * The button that opens the popup, passed to `AssignPopup` as its `trigger`:
 * a compact pair (x/y, width/height) renders both halves inside one shared
 * `.field-pair` wrapper, so the popup's own default outside-close climb
 * cannot tell this field's glyph from its pair-mate's — see the prop's doc
 * comment on `AssignPopup` for the full reasoning.
 *
 * One ref serves two mutually exclusive templates: the unbound number
 * field's `.field-variables` glyph and the bound row's `.token-pill` are
 * `v-else-if` siblings in the same chain, so exactly one of them — never
 * both — is ever mounted for a given field, and Vue keeps this ref pointed
 * at whichever one that is.
 */
const variablesTrigger = ref<HTMLButtonElement | null>(null)
const showOptionText = computed(() =>
  ['layoutMode', 'layoutPositioning', 'layoutWrap'].includes(props.field.name),
)
const segmented = computed(
  () =>
    props.field.name !== 'strokeAlign' &&
    (props.field.options?.length ?? 0) <= SEGMENTED_MAX_OPTIONS,
)
</script>

<template>
  <label
    v-if="!compact && field.control !== 'boolean' && !STRUCTURED.has(field.control)"
    :for="`f-${field.name}`"
    class="field-caption"
    :class="{ bound: field.boundTo }"
    >{{ field.label }}</label
  >

  <!--
    A property binding shows the property and nothing else, the way Figma's
    pill does. No resolved value beside it: `resolvedValue` is number-typed for
    token scrubbing, so it has no answer for a TEXT property — which is exactly
    why the old detach button sat disabled here — and Figma shows none either.
  -->
  <PropertyLink
    v-if="propertyBound"
    :bound-to="field.boundTo"
    :candidates="candidates ?? null"
    :icon="propIcon ?? 'prop-text'"
    :editable="editable"
    :variables="variables"
    :component-name="componentName ?? null"
    @link="(name) => emit('link', field.name, name)"
    @unlink="emit('unlink', field.name)"
    @create="emit('create', field.name)"
    @edit="(name) => emit('edit', name)"
    @pick-variable="(a) => emit('pickVariable', field.name, a)"
  />

  <!--
    A token binding is Figma's variable pill: the name, the glyph, and nothing
    else in the box — the resolved value moves to the tooltip, typing waits for
    a detach (spec §4). Clicking the pill switches; the trailing icon detaches
    to the resolved literal.
  -->
  <div v-else-if="field.boundTo" class="value bound-value">
    <button
      ref="variablesTrigger"
      type="button"
      class="token-pill"
      data-popup-trigger
      :disabled="!editable"
      :title="`${field.boundTo} = ${tokenLiteralDisplay}`"
      @click="pickingVariable = !pickingVariable"
    >
      <FieldIcon name="variable" />
      {{ field.boundTo.split('#').pop() }}
    </button>
    <button
      type="button"
      class="icon-button token-detach"
      :disabled="!editable || tokenLiteral === null"
      :title="`replace the binding with ${tokenLiteralDisplay}`"
      @click="onDetach"
    >
      <FieldIcon name="unlink-property" />
    </button>
  </div>

  <!--
    `NumberFieldRoot` is headless: it owns scrubbing, expression parsing and
    the keyboard contract, and renders nothing. The markup below is the whole
    of what this component adds — a label to drag on and an input to type
    into, wired to the actions the primitive hands back.
  -->
  <LengthFieldRoot
    v-else-if="field.control === 'number'"
    v-slot="{ attrs, actions, state, displayValue, draftValue, unit, selectUnit }"
    :model-value="numberValue()"
    :length-property="field.name"
    :length-value="isLength ? field.value : undefined"
    :disabled="!editable"
    :label="field.name"
    :step="step()"
    @update:model-value="onNumberPreview"
    @commit="onNumberCommit"
  >
    <span class="value number" :data-field="field.name">
      <span class="number-control">
        <span class="length-number-content" v-bind="attrs">
          <span
            v-if="(compact && FIELD_PREFIX[field.name]) || PROP_ICON[field.name]"
            class="prefix field-glyph"
            :class="{ disabled: !editable }"
            :title="field.label"
            @pointerdown="actions.startScrub($event)"
          >
            <FieldIcon v-if="PROP_ICON[field.name]" :name="PROP_ICON[field.name]!" />
            <template v-else>{{ prefix() }}</template>
          </span>
          <input
            v-if="state.editing"
            :id="`f-${field.name}`"
            class="number-input"
            type="text"
            :value="draftValue"
            :disabled="!editable"
            @input="actions.input($event)"
            @keydown="actions.keydown($event)"
            @blur="actions.commitEdit($event)"
          />
          <template v-else>
            <!-- Drag here to scrub; click to type. Figma's own affordance. -->
            <span
              class="scrub"
              :class="{ disabled: !editable }"
              @pointerdown="actions.startScrub($event)"
              @dblclick="actions.startEdit()"
              >{{ unset ? '–' : displayValue }}{{ unset || !isPercent ? '' : '%' }}</span
            >
          </template>
        </span>
        <LengthUnitSelect
          :unit="unit"
          :disabled="!editable || unset"
          :label="field.name"
          @change="selectUnit"
        />
      </span>
      <button
        v-if="editable"
        ref="variablesTrigger"
        type="button"
        class="field-variables"
        data-popup-trigger
        :title="`Apply token to ${field.label}`"
        :aria-label="`Apply token to ${field.label}`"
        :aria-expanded="pickingVariable"
        @click="pickingVariable = !pickingVariable"
      >
        <FieldIcon name="variables-grid" />
      </button>
    </span>
  </LengthFieldRoot>

  <template v-else-if="field.control === 'boolean'">
    <input
      :id="`f-${field.name}`"
      class="value check"
      type="checkbox"
      :checked="field.value === true"
      :disabled="!editable"
      @change="onToggle"
    />
    <label :for="`f-${field.name}`" class="check-label">{{ field.label }}</label>
  </template>

  <textarea
    v-else-if="field.control === 'text' && field.name === 'characters'"
    :id="`f-${field.name}`"
    class="value text-content"
    :dir="textDirection ?? 'auto'"
    :value="field.value as string"
    :disabled="!editable"
    rows="3"
    @change="onText"
  />

  <FontFamilyField
    v-else-if="field.name === 'fontFamily' && field.control === 'text'"
    class="value"
    :model-value="String(field.value ?? 'Inter')"
    :disabled="!editable"
    @commit="emit('commit', field.name, $event)"
  />

  <input
    v-else-if="field.control === 'text'"
    :id="`f-${field.name}`"
    class="value"
    type="text"
    :value="field.value"
    :disabled="!editable"
    @change="onText"
  />

  <!-- Short enums (<=4 legal values) get segmented controls, the way Figma
       shows alignment, sizing and wrap. Long ones (blendMode, fontWeight)
       get a native select — a segmented row that long doesn't scan. -->
  <SegmentedControlRoot
    v-else-if="field.control === 'enum' && segmented"
    class="value enum-segmented"
    :aria-label="field.name"
    :disabled="!editable"
    :model-value="typeof field.value === 'string' ? field.value : undefined"
    @update:model-value="onEnum"
  >
    <SegmentedControlItem
      v-for="option in field.options"
      :key="option"
      :value="option"
      :disabled="!editable"
      :title="
        propUiFor(field.name)?.optionDescriptions?.[option] ?? optionLabelFor(field.name, option)
      "
      class="enum-item"
    >
      <FieldIcon
        v-if="OPTION_ICON[`${field.name}:${option}`]"
        :name="OPTION_ICON[`${field.name}:${option}`]!"
      />
      <span v-if="showOptionText || !OPTION_ICON[`${field.name}:${option}`]">{{
        optionLabelFor(field.name, option)
      }}</span>
    </SegmentedControlItem>
  </SegmentedControlRoot>

  <select
    v-else-if="field.control === 'enum'"
    :id="`f-${field.name}`"
    :aria-label="field.label"
    class="value enum-select"
    :disabled="!editable"
    :value="typeof field.value === 'string' ? field.value : ''"
    @change="onEnum(($event.target as HTMLSelectElement).value)"
  >
    <!-- The label is what reads; `:value` keeps the canonical spelling the
         file and every patch carry (ADR 0002). -->
    <option v-for="option in field.options" :key="option" :value="option">
      {{ optionLabelFor(field.name, option) }}
    </option>
  </select>

  <PaintStackField
    v-else-if="field.control === 'paint'"
    class="structured"
    :field="field"
    :editable="editable"
    :swatches="swatches ?? []"
    :tokens="tokens"
    :token-index="tokenIndex"
    @preview="(p, v) => emit('preview', p, v)"
    @commit="(p, v) => emit('commit', p, v)"
  />

  <EffectListField
    v-else-if="field.control === 'effects'"
    class="structured"
    :field="field"
    :editable="editable"
    :swatches="swatches ?? []"
    @preview="(p, v) => emit('preview', p, v)"
    @commit="(p, v) => emit('commit', p, v)"
  />

  <ConstraintsMatrix
    v-else-if="field.control === 'constraints'"
    :field="field"
    :editable="editable"
    @commit="(p, v) => emit('commit', p, v)"
  />

  <DashPatternField
    v-else-if="field.control === 'dashes'"
    :field="field"
    :editable="editable"
    @commit="(p, v) => emit('commit', p, v)"
  />

  <TextResizeField
    v-else-if="field.control === 'text-resize'"
    :field="field"
    :editable="editable"
    @commit="(p, v) => emit('commit', p, v)"
  />

  <span v-else class="value readonly" :title="field.readonlyReason ?? undefined">
    {{ field.raw }}
    <em class="why">{{ field.readonlyReason }}</em>
  </span>

  <button
    v-if="
      editable &&
      !field.boundTo &&
      ['text', 'boolean'].includes(field.control) &&
      !['characters', 'visible'].includes(field.name)
    "
    ref="variablesTrigger"
    type="button"
    class="field-variables scalar-token"
    data-popup-trigger
    :title="`Apply token to ${field.label}`"
    :aria-label="`Apply token to ${field.label}`"
    :aria-expanded="pickingVariable"
    @click="pickingVariable = !pickingVariable"
  >
    <FieldIcon name="variables-grid" />
  </button>

  <!--
    A wholly separate conditional, deliberately placed after the whole
    v-if/else-if/else chain above rather than beside `NumberFieldRoot`: a real
    element dropped between two `v-else-if` siblings breaks the chain (Vue
    requires them strictly adjacent), which silently turns every later branch
    — including the closing `v-else` — into a second, unrelated chain that
    renders for control kinds this popup has nothing to do with. Only a
    number field's own glyph ever sets `pickingVariable`, so this is safe
    wherever it sits; sitting after the chain is what keeps the chain itself
    intact.
  -->
  <AssignPopup
    v-if="pickingVariable"
    :candidates="null"
    :component-name="null"
    :variables="variables ?? []"
    :bound-to="field.boundTo"
    icon="variable"
    :trigger="variablesTrigger"
    @variable="
      (a) => {
        pickingVariable = false
        emit('pickVariable', field.name, a)
      }
    "
    @close="pickingVariable = false"
  />
</template>

<style scoped>
.field-caption {
  display: block;
  margin-bottom: 4px;
  color: var(--text-dim);
}
.field-caption.bound {
  color: var(--bound);
}
.value {
  min-width: 0;
}
.value[type='text'],
.text-content,
.enum-select,
.number {
  display: block;
  width: 100%;
  height: var(--field-h);
  box-sizing: border-box;
  /* Figma's field look: a filled box with no border until you engage it —
     line on hover, accent while focused or scrubbing. */
  background: var(--raised);
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  color: var(--text);
  font-family: var(--ui-font);
  font-size: var(--ui-size);
  padding: 2px 6px;
}
.value[type='text']:hover:not(:disabled),
.text-content:hover:not(:disabled),
.enum-select:hover:not(:disabled),
.number:hover {
  border-color: var(--line);
}
.value[type='text']:focus,
.text-content:focus,
.enum-select:focus {
  outline: none;
  border-color: var(--accent);
}
.text-content {
  min-height: 76px;
  height: auto;
  resize: vertical;
  line-height: 1.6;
  padding: 6px 8px;
}
.number {
  display: flex;
  align-items: center;
  padding: 0;
}
.number-control {
  display: flex;
  flex: 1;
  align-items: center;
  min-width: 0;
  height: 100%;
}
.number:focus-within,
.number:has([data-scrubbing]) {
  border-color: var(--accent);
}
/* Keep the token action visible so a literal never looks unbindable. */
.field-variables {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-faint);
  cursor: pointer;
  opacity: 1;
}
.number:hover .field-variables,
.number:focus-within .field-variables,
.field-variables:focus-visible {
  opacity: 1;
}
.scalar-token {
  position: absolute;
  top: 0;
  right: 0;
  height: 20px;
}
.field-variables:hover {
  color: var(--text);
}
.prefix {
  flex: none;
  padding: 2px 0 2px 6px;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
  cursor: ew-resize;
  user-select: none;
}
.prefix.disabled {
  cursor: default;
}
/* The glyph sits on the baseline of the box, not the text — an icon and a
   letter must occupy the same slot so rows line up either way. */
.field-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 12px;
}
.field-glyph:hover:not(.disabled) {
  color: var(--text);
}
.check {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--accent);
}
.check-label {
  color: var(--text);
  cursor: pointer;
}
button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.number-input {
  border: none;
  background: none;
  width: 100%;
  height: 100%;
  padding: 2px 5px;
}
.scrub {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 2px 6px;
  cursor: ew-resize;
  user-select: none;
}
.scrub.disabled {
  cursor: default;
}
.enum-segmented {
  min-height: var(--field-h);
  display: flex;
  gap: 1px;
  background: var(--raised);
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  padding: 2px;
}
/*
 * `:deep()` because `SegmentedControlItem` renders through the primitive's
 * own component layer, which drops the parent scope attribute from the
 * button it produces — a plain scoped rule compiles to a selector that
 * matches nothing.
 */
.enum-segmented :deep(.enum-item) {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex: 1;
  /* Options share the row evenly and ellipsize rather than pushing the
     control past the pane edge — HORIZONTAL is wider than its fair share
     of a 240px rail. The full word is in the title. */
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
  background: none;
  border: none;
  color: var(--text-dim);
  font-family: var(--ui-font);
  font-size: var(--ui-size-sm);
  padding: 2px 4px;
  border: 1px solid transparent;
  cursor: pointer;
  border-radius: var(--radius);
}
.enum-segmented :deep(.enum-item[data-state='on']) {
  /* The active segment is Figma's floating pill: lifted off the track. */
  background: var(--panel);
  border: 1px solid var(--line);
  color: var(--text);
}
/* The scrub and prefix spans are the number control's whole face, so without
   them a disabled number looked identical to a live one apart from the
   cursor — greyed out has to actually grey out. */
input:disabled,
textarea:disabled,
select:disabled,
.scrub.disabled,
.prefix.disabled,
:deep([aria-disabled='true']) {
  opacity: 0.5;
}
.bound-value {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
}
.token-pill {
  display: inline-flex;
  flex: 1;
  gap: var(--gap-sm);
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
.token-pill:hover:not(:disabled) {
  background: color-mix(in srgb, var(--raised) 80%, var(--text) 8%);
}
.icon-button {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--field-h);
  height: var(--field-h);
  padding: 0;
  border: 0;
  border-radius: var(--radius);
  background: none;
  color: var(--text-faint);
  cursor: pointer;
}
.icon-button:hover:not(:disabled) {
  background: var(--raised);
  color: var(--text);
}
.icon-button:disabled {
  opacity: 0.4;
  cursor: default;
}
.readonly {
  color: var(--text-dim);
  word-break: break-all;
}
.why {
  display: block;
  color: var(--text-faint);
  font-style: normal;
  font-size: var(--ui-size-sm);
}
</style>
