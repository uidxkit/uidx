<script setup lang="ts">
import { ref } from 'vue'
import type { JsonValue } from '@uidx/format'
import { FieldIcon, type IconName } from './field-icons'
import AssignPopup from './AssignPopup.vue'
import type { VariableCandidate } from './variable-binding'

/**
 * The link controls a bindable input carries (F12, generalised by the parity
 * spec §4).
 *
 * Extracted from `PropertyField` so the instance-swap row can be the same
 * control rather than a lookalike. The three inputs a property can fill —
 * Content, Visible, and the component picker — differ in what they render
 * *unbound*; bound, and while choosing, they are identical, and that identity
 * is what makes the gesture the same wherever a Figma user meets it.
 *
 * Holds no document knowledge: the caller decides what may be linked and turns
 * a choice into patches.
 */
defineProps<{
  /** The property this input reads, or null when it holds a literal. */
  boundTo: string | null
  /**
   * What may be linked here, or null when nothing may.
   *
   * Null and empty differ: null renders no control at all, empty still offers
   * Create — a component that has declared nothing is exactly where creating
   * from the field is worth the most.
   */
  candidates: { name: string; declaration: { type: string; default: JsonValue } }[] | null
  /** The glyph of the one type this input takes. */
  icon: IconName
  editable: boolean
  /** The variables this input's type may bind to, or none. */
  variables?: VariableCandidate[]
  allowVariables?: boolean
  variableLabel?: string
  /** The enclosing component's name, for the popup's property-group heading. */
  componentName?: string | null
}>()

const emit = defineEmits<{
  link: [name: string]
  unlink: []
  create: []
  /** Open one property's declaration for editing, named by the popup's row. */
  edit: [name: string]
  pickVariable: [address: string]
}>()

/** Open only while the author is choosing; a choice or a removal closes it. */
const picking = ref(false)

function choose(name: string): void {
  picking.value = false
  emit('link', name)
}

function chooseVariable(address: string): void {
  picking.value = false
  emit('pickVariable', address)
}

function startCreate(): void {
  picking.value = false
  emit('create')
}

function startEdit(name: string): void {
  picking.value = false
  emit('edit', name)
}

function unlink(): void {
  picking.value = false
  emit('unlink')
}
</script>

<template>
  <!--
    A linked input shows the property and nothing else — Figma's pill. No
    resolved value beside it: the pane's resolver is number-typed for token
    scrubbing, so it has no answer for a TEXT or INSTANCE_SWAP property, and
    Figma shows none either.
  -->
  <button
    v-if="boundTo"
    type="button"
    class="property-pill"
    data-popup-trigger
    :disabled="!editable"
    :title="`linked to ${boundTo}`"
    @click="picking = !picking"
  >
    <FieldIcon :name="icon" />
    {{ boundTo }}
  </button>

  <!--
    One element, not three loose ones: the row that hosts this is a grid, and
    a button per control spilled onto a second grid line under the label —
    which is what made the row look broken. The popup rides along inside,
    absolutely positioned, so it costs the row no layout.
  -->
  <span v-if="candidates || allowVariables" class="link-controls">
    <!--
      One trigger per state, Figma's own split: unbound, the ◎ is the only
      affordance and opens the picker; bound, the pill above already *is* the
      trigger, and a second identical ◎ beside it read as a different control
      (it was mistaken for "edit" in practice). Editing a declaration lives
      where Figma puts it — on the popup's rows — so the row keeps exactly
      one glyph beside the pill: the detach.
    -->
    <button
      v-if="!boundTo"
      type="button"
      class="icon-button"
      :class="candidates ? 'apply-property' : 'apply-token'"
      data-popup-trigger
      :disabled="!editable"
      :title="
        candidates ? 'Link to a component property or token' : `Apply token to ${variableLabel}`
      "
      :aria-label="
        candidates ? 'Link to a component property or token' : `Apply token to ${variableLabel}`
      "
      :aria-expanded="picking"
      @click="picking = !picking"
    >
      <FieldIcon :name="candidates ? 'apply-property' : 'variables-grid'" />
    </button>

    <button
      v-if="boundTo"
      type="button"
      class="icon-button unlink-property"
      :disabled="!editable"
      title="remove the link"
      @click="unlink"
    >
      <FieldIcon name="unlink-property" />
    </button>

    <AssignPopup
      v-if="picking"
      :candidates="candidates"
      :component-name="componentName ?? null"
      :variables="variables ?? []"
      :bound-to="boundTo"
      :icon="icon"
      @property="choose"
      @variable="chooseVariable"
      @create="startCreate"
      @edit="startEdit"
      @close="picking = false"
    />
  </span>
</template>

<style scoped>
/*
 * The `--bound` purple the token rows already use for their label, here as a
 * fill rather than a text colour — a linked input is not a value with a note
 * on it, it is a different kind of thing.
 */
.property-pill {
  display: inline-flex;
  flex: 1;
  gap: var(--gap-sm);
  align-items: center;
  min-width: 0;
  height: var(--field-h);
  padding: 0 6px;
  border: 0;
  /* Matches `.token-pill`'s corner (radius-lg) — the reference's pills are
     the rounder shape, and a property pill is the same kind of thing. */
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--bound) 22%, transparent);
  color: var(--bound);
  font: inherit;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
/*
 * Not `position: relative`, deliberately: the popup inside is absolutely
 * positioned and 208px wide — anchored to this narrow span at the row's
 * right edge it spilled past the pane's left border and `.properties`
 * (overflow: auto) clipped it. Left unpositioned, the popup anchors to the
 * positioned row that hosts this control (`.field`, `.instance-swap-row`,
 * `.section-link`), whose right edge it can span without leaving the pane.
 */
.link-controls {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 2px;
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

/*
 * Dimmed at rest, full on hover. Figma hides this control until hover, but a
 * Figma user meeting *this* panel has no reason to try — invisible-until-hover
 * read as "there is no option other than text" in practice. Only the three
 * bindable inputs ever carry the glyph, so at rest it is a hint, not clutter.
 */
.apply-property {
  opacity: 0.7;
}
:hover > .apply-property,
.apply-property:focus-visible,
.apply-property:hover {
  opacity: 1;
}
</style>
