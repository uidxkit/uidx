<script setup lang="ts">
import type { TokenIndex } from '@uidx/schema'

/**
 * Figma's **Apply variable mode**, in the Appearance section (story G8).
 *
 * One row per collection that declares modes. The value shown is the node's
 * *explicit* selection, or `Auto` when it has none — Figma's
 * `explicitVariableModes` against `resolvedVariableModes`, made visible. Auto
 * is the absence of a selection rather than a mode named Auto, which is why
 * choosing it emits a clear rather than a set.
 *
 * A document with no moded collection renders nothing: an empty section header
 * is worse than no section, and the panel's rule is functional chrome only.
 */
const props = defineProps<{
  tokenIndex?: TokenIndex
  /** The selected node's own `modes` map, or undefined when it sets none. */
  explicit?: Record<string, string>
  editable: boolean
}>()

const emit = defineEmits<{
  set: [collection: string, mode: string]
  clear: [collection: string]
}>()

const AUTO = '__auto__'

/** Collections worth a row: the ones that actually declare modes. */
const moded = (): { name: string; modes: string[] }[] =>
  [...(props.tokenIndex?.collections.values() ?? [])]
    .filter((c) => c.modes.length > 1)
    .map((c) => ({ name: c.name, modes: c.modes }))

const valueFor = (collection: string): string => props.explicit?.[collection] ?? AUTO

function onChange(collection: string, value: string): void {
  if (value === AUTO) emit('clear', collection)
  else emit('set', collection, value)
}
</script>

<template>
  <div v-for="collection in moded()" :key="collection.name" class="field mode-row">
    <label :for="`mode-${collection.name}`" class="field-caption">{{ collection.name }}</label>
    <select
      :id="`mode-${collection.name}`"
      class="value enum-select"
      :disabled="!editable"
      :value="valueFor(collection.name)"
      @change="onChange(collection.name, ($event.target as HTMLSelectElement).value)"
    >
      <!-- Auto first, because inheriting is the default state and Figma lists
           it that way too. -->
      <option :value="AUTO">Auto</option>
      <option v-for="mode in collection.modes" :key="mode" :value="mode">{{ mode }}</option>
    </select>
  </div>
</template>
