<script setup lang="ts">
import { computed } from 'vue'
import type { JsonValue } from '@uidx/format'
import type { PinAxis } from '@uidx/schema'
import type { EditableProp } from './editable'

/**
 * Figma's constraints widget (story H2, ADR 0011).
 *
 * A square with four edge bars. **A plain click sets that axis to that edge;
 * shift-click adds or removes one**, so holding both edges of an axis
 * stretches between them and holding neither centres. That is Figma's own
 * contract — its help centre says "Hold down Shift to select or apply more
 * than one constraint at a time. For example: left and right constraints" —
 * and it is not the toggle-only model this first shipped with, which turned
 * "pin me to the bottom instead" into "stretch me", by one click, silently.
 *
 * `SCALE` is absent on purpose. It is a ratio rather than an offset and the
 * format cannot express it yet (ADR 0011 §3), so `uidx check` refuses it
 * (UIDX136) and offering it here would be an affordance for a file the tool
 * would then reject.
 *
 * Modelled on `AlignmentMatrix.vue`, which solves the same problem one
 * section down: one click, two props, one envelope, one line-pair in the diff.
 */
const props = defineProps<{ field: EditableProp; editable: boolean }>()
const emit = defineEmits<{
  commit: [prop: string, value: JsonValue]
  hover: [prop: string | null]
}>()

/**
 * The pair the row currently holds. A value the file never declared reads
 * MIN/MIN, which is both Figma's default and the resolver's.
 */
const pin = computed(() => {
  const value = (props.field.value ?? {}) as { horizontal?: string; vertical?: string }
  const axis = (name?: string): PinAxis =>
    name === 'CENTER' || name === 'MAX' || name === 'STRETCH' ? name : 'MIN'
  return { horizontal: axis(value.horizontal), vertical: axis(value.vertical) }
})

/** Which edges each constraint lights, and therefore what a click toggles. */
const EDGES: Record<PinAxis, { near: boolean; far: boolean }> = {
  MIN: { near: true, far: false },
  MAX: { near: false, far: true },
  STRETCH: { near: true, far: true },
  CENTER: { near: false, far: false },
}

/**
 * What a click on one edge produces.
 *
 * Plain: that edge alone, which is the common gesture and the one a person
 * means by "pin it to the bottom". Shift: add or remove, so both edges is the
 * stretch and neither is the centre.
 *
 * A named mapping rather than branches spread through the template: this is
 * the whole behaviour of the control and should be readable in one place.
 * (`<script setup>` cannot export it, so the tests drive it through the DOM —
 * which is the contract that matters anyway.)
 */
function clicked(constraint: PinAxis, edge: 'near' | 'far', additive: boolean): PinAxis {
  if (!additive) return edge === 'near' ? 'MIN' : 'MAX'
  const next = { ...EDGES[constraint], [edge]: !EDGES[constraint][edge] }
  if (next.near && next.far) return 'STRETCH'
  if (next.near) return 'MIN'
  if (next.far) return 'MAX'
  return 'CENTER'
}

const horizontal = computed(() => EDGES[pin.value.horizontal])
const vertical = computed(() => EDGES[pin.value.vertical])
const centred = computed(() => pin.value.horizontal === 'CENTER' && pin.value.vertical === 'CENTER')

/**
 * Commits the whole pair as one `constraints` value, exactly as the two
 * selects did. Converting the geometry that the new pin makes derived is the
 * *pane's* job (`onCommit`), because only it holds the resolved box — a
 * control that measured would be a second answer to the scene graph's
 * question.
 */
function onEdge(axis: 'horizontal' | 'vertical', edge: 'near' | 'far', event: MouseEvent): void {
  if (!props.editable) return
  const next = clicked(pin.value[axis], edge, event.shiftKey)
  emit('commit', props.field.name, { ...pin.value, [axis]: next })
}

/** The centre dot is the one gesture that answers both axes at once. */
function onCentre(): void {
  if (!props.editable) return
  emit('commit', props.field.name, { horizontal: 'CENTER', vertical: 'CENTER' })
}
</script>

<template>
  <label>{{ field.label }}</label>
  <div
    class="value matrix"
    role="group"
    aria-label="constraints"
    @mouseenter="emit('hover', 'constraints')"
    @mouseleave="emit('hover', null)"
  >
    <button
      type="button"
      class="edge left"
      :data-active="horizontal.near"
      :disabled="!editable"
      aria-label="pin left"
      :aria-pressed="horizontal.near"
      :title="`Left — shift-click to hold both edges`"
      @click="onEdge('horizontal', 'near', $event)"
    />
    <button
      type="button"
      class="edge right"
      :data-active="horizontal.far"
      :disabled="!editable"
      aria-label="pin right"
      :aria-pressed="horizontal.far"
      :title="`Right — shift-click to hold both edges`"
      @click="onEdge('horizontal', 'far', $event)"
    />
    <button
      type="button"
      class="edge top"
      :data-active="vertical.near"
      :disabled="!editable"
      aria-label="pin top"
      :aria-pressed="vertical.near"
      :title="`Top — shift-click to hold both edges`"
      @click="onEdge('vertical', 'near', $event)"
    />
    <button
      type="button"
      class="edge bottom"
      :data-active="vertical.far"
      :disabled="!editable"
      aria-label="pin bottom"
      :aria-pressed="vertical.far"
      :title="`Bottom — shift-click to hold both edges`"
      @click="onEdge('vertical', 'far', $event)"
    />
    <button
      type="button"
      class="centre"
      :data-active="centred"
      :disabled="!editable"
      aria-label="pin centre"
      :aria-pressed="centred"
      title="Centre"
      @click="onCentre()"
    />
  </div>
</template>

<style scoped>
label {
  color: var(--text-faint);
}
.matrix {
  position: relative;
  width: 44px;
  height: 44px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--raised);
}
button {
  position: absolute;
  padding: 0;
  border: 0;
  border-radius: 1px;
  background: var(--text-faint);
  cursor: pointer;
}
button:disabled {
  cursor: default;
  opacity: 0.4;
}
button[data-active='true'] {
  background: var(--accent);
}
.edge.left,
.edge.right {
  width: 2px;
  height: 14px;
  top: 14px;
}
.edge.left {
  left: 5px;
}
.edge.right {
  right: 5px;
}
.edge.top,
.edge.bottom {
  width: 14px;
  height: 2px;
  left: 14px;
}
.edge.top {
  top: 5px;
}
.edge.bottom {
  bottom: 5px;
}
.centre {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  top: 17px;
  left: 17px;
}
button:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: 2px;
}
</style>
