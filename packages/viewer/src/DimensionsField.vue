<script setup lang="ts">
import { computed } from 'vue'
import type { JsonValue } from '@uidx/format'
import type { TokenBindingSource, TokenDetachWrite } from './token-binding-source'
import SizeField from './SizeField.vue'
import { sizingPropFor, textResizeWrite, textSizingFor } from './size-model'

/**
 * Figma's Dimensions row: W and H, each one box carrying its number and the
 * Hug/Fixed state that governs it.
 *
 * The row owns the rulebook its two boxes share, which is why it is a
 * component rather than markup in the pane. Which attribute a Hug/Fixed pick
 * writes is not the same question for every element — a frame states each
 * axis separately (`primaryAxisSizingMode` / `counterAxisSizingMode`, chosen
 * by the layout direction) and a `<Text>` states both at once in
 * `textAutoResize`. `SizeField` stays a control and knows none of that;
 * `size-model.ts` holds the mapping; this row is where the two meet.
 */
const props = defineProps<{
  /** The selected node's element, which decides how sizing is spelled. */
  element: string
  /**
   * The sizing facts as the *file* states them, resolved by the pane (an
   * unauthored prop still has an answer — the engine's, which for a
   * `<Component>` is the hugging wrapper `to-scene.ts` gives it).
   */
  layoutMode: string
  primaryAxisSizing: string
  counterAxisSizing: string
  textResize: string
  /** Null where the file authors no number: a hug, or a derived box. */
  width: number | null
  height: number | null
  /** False for a node whose size nothing computes — no Hug to offer. */
  modes: Array<{ value: 'FIXED' | 'AUTO'; label: string }> | null
  editable: boolean
  tokenSource?: TokenBindingSource
}>()

const emit = defineEmits<{
  bind: [properties: string[], token: string]
  detach: [writes: TokenDetachWrite[]]
  preview: [prop: string, value: JsonValue]
  commit: [prop: string, value: JsonValue]
  hover: [prop: string | null]
}>()

const isText = computed(() => props.element === 'Text')

const numberOf = (dimension: 'width' | 'height'): number | null =>
  dimension === 'width' ? props.width : props.height

/** The attribute a dimension's Hug/Fixed pick writes, in this node's vocabulary. */
function sizingPropOf(dimension: 'width' | 'height'): string {
  return isText.value ? 'textAutoResize' : sizingPropFor(props.layoutMode, dimension)
}

/** That attribute's current state, as the panel's own FIXED/AUTO pair. */
function sizingModeOf(dimension: 'width' | 'height'): 'FIXED' | 'AUTO' {
  if (isText.value) return textSizingFor(props.textResize, dimension)
  const axis = sizingPropFor(props.layoutMode, dimension)
  const stated =
    axis === 'primaryAxisSizingMode' ? props.primaryAxisSizing : props.counterAxisSizing
  return stated === 'AUTO' ? 'AUTO' : 'FIXED'
}

function onSizing(dimension: 'width' | 'height', mode: 'FIXED' | 'AUTO'): void {
  if (isText.value) {
    emit('commit', 'textAutoResize', textResizeWrite(props.textResize, dimension, mode))
    return
  }
  emit('commit', sizingPropFor(props.layoutMode, dimension), mode)
}
</script>

<template>
  <!--
    Not also `.field`: that class is the pane's, and its `display: block`
    lands on this component's root with the same specificity as the grid
    below — leaving which one wins to stylesheet order across two files. The
    row owns its own padding instead (the one thing `.field` gave it).
  -->
  <div class="field-resizing">
    <!--
      One caption above each box, the style every named pair wears since the
      CSS revision — the spanning "Dimensions" caption and the W/H letters
      inside the boxes went together. The Fixed/Hug mode keeps its seat
      inside the box: a width and how it is decided are one fact.
    -->
    <div v-for="dimension in ['width', 'height'] as const" :key="dimension" class="size-column">
      <span class="field-caption">{{ dimension === 'width' ? 'Width' : 'Height' }}</span>
      <SizeField
        :dimension="dimension"
        :value="numberOf(dimension)"
        :sizing-mode="sizingModeOf(dimension)"
        :sizing-prop="sizingPropOf(dimension)"
        :modes="modes"
        :editable="editable"
        :token-source="tokenSource"
        @bind="(names, token) => emit('bind', names, token)"
        @detach="(writes) => emit('detach', writes)"
        @preview="(p, v) => emit('preview', p, v)"
        @commit="(p, v) => emit('commit', p, v)"
        @sizing="onSizing"
        @hover="(p) => emit('hover', p)"
      />
    </div>
  </div>
</template>

<style scoped>
/*
 * Two boxes on one row under a shared caption. `row-gap: 0` plus the
 * caption's own margin states the 4px rhythm explicitly rather than leaning
 * on a grid gap that also has to serve the boxes beside it.
 */
.field-resizing {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 var(--gap);
  align-items: start;
  padding: 5px 0;
}
.size-column {
  min-width: 0;
}
.field-caption {
  display: block;
  color: var(--text-dim);
}
.span-caption {
  grid-column: 1 / -1;
  margin-bottom: 4px;
}
</style>
