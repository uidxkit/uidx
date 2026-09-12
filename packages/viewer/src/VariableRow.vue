<script setup lang="ts">
import { FieldIcon, type IconName } from './field-icons'
import { cssColor, type Rgba } from './paint-edit'
import type { VariableCandidate } from './variable-binding'

/**
 * One variable as a popup row — glyph (or swatch, for a colour) + name +
 * resolved preview. Its own component because the assignment popup and the
 * colour picker's Libraries tab are the same list (spec §4), and two
 * renderings of "a variable" would drift.
 */
defineProps<{ candidate: VariableCandidate; current: boolean }>()
defineEmits<{ pick: [] }>()

const GLYPH: Record<string, IconName> = {
  FLOAT: 'variable',
  STRING: 'prop-text',
  BOOLEAN: 'prop-boolean',
}
</script>

<template>
  <button
    type="button"
    class="popup-row variable-row"
    :class="{ current }"
    :data-variable="candidate.address"
    :title="candidate.address"
    @click="$emit('pick')"
  >
    <span
      v-if="candidate.type === 'COLOR'"
      class="row-swatch"
      :style="{ background: cssColor(candidate.value as unknown as Rgba) }"
    />
    <FieldIcon v-else :name="GLYPH[candidate.type] ?? 'variable'" />
    <span class="row-name">{{ candidate.name }}</span>
    <span class="row-preview">{{ candidate.preview }}</span>
  </button>
</template>

<style scoped>
.popup-row {
  display: flex;
  gap: var(--gap-sm);
  align-items: center;
  width: 100%;
  height: var(--row-h);
  padding: 0 6px;
  border: 0;
  border-radius: var(--radius);
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.popup-row:hover {
  background: var(--raised);
}
.popup-row.current {
  background: color-mix(in srgb, var(--accent) 25%, transparent);
}
.row-swatch {
  flex: none;
  width: 12px;
  height: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
}
.row-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-preview {
  flex: none;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-faint);
}
</style>
