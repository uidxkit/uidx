<script setup lang="ts">
import { computed, type CSSProperties } from 'vue'
import { parseLength } from '@uidx/format'
import type { TokenCell, TokenRow } from './tokens-view-model'
import { TOKEN_TYPES, visualRole } from './token-presentation'

const props = defineProps<{ row: TokenRow; cell?: TokenCell; rootFontSize?: number }>()
const cell = computed(() => props.cell ?? props.row.cells[0])
const value = computed(() => cell.value?.resolved ?? null)
const scopes = computed(() => props.row.inferredScopes ?? props.row.scopes)
const amount = computed(() => {
  const length = parseLength(value.value)
  if (!length) return 0
  return length.value * (length.unit === 'rem' ? (props.rootFontSize ?? 16) : 1)
})
const style = computed<CSSProperties>(() => {
  const raw = value.value
  const n = amount.value
  const category = props.row.category
  if (
    category === 'color' &&
    raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    typeof raw.r === 'number' &&
    typeof raw.g === 'number' &&
    typeof raw.b === 'number'
  ) {
    return {
      '--sample-color': `rgba(${raw.r * 255}, ${raw.g * 255}, ${raw.b * 255}, ${typeof raw.a === 'number' ? raw.a : 1})`,
    }
  }
  if (category === 'typography') {
    if (scopes.value.includes('FONT_FAMILY') && typeof raw === 'string') return { fontFamily: raw }
    if (scopes.value.includes('FONT_WEIGHT')) return { fontWeight: Math.min(1000, Math.max(1, n)) }
    if (
      scopes.value.includes('FONT_STYLE') &&
      (raw === 'italic' || raw === 'normal' || raw === 'oblique')
    )
      return { fontStyle: raw }
    if (scopes.value.includes('LETTER_SPACING'))
      return { letterSpacing: `${Math.min(8, Math.max(-2, n))}px` }
    if (scopes.value.includes('FONT_SIZE')) return { fontSize: `${Math.min(32, Math.max(8, n))}px` }
  }
  return {
    '--sample-length': `${Math.min(44, Math.max(0, n))}px`,
    '--sample-radius': `${Math.min(18, Math.max(0, n))}px`,
    '--sample-opacity': String(Math.min(1, Math.max(0, n))),
    '--sample-stroke': `${Math.min(12, Math.max(0, n))}px`,
  }
})
const label = computed(
  () =>
    `${TOKEN_TYPES[props.row.category].label}: ${visualRole(props.row)} Preview is scaled to fit; the value is shown separately.`,
)
</script>

<template>
  <span
    class="token-specimen"
    :class="row.category"
    :style="style"
    role="img"
    :aria-label="label"
    :title="label"
  >
    <span v-if="!cell || cell.broken !== undefined || value === null" class="unresolved">—</span>
    <span v-else-if="row.category === 'color'" class="color-sample" />
    <span v-else-if="row.category === 'spacing'" class="space-sample"><i /><b /><i /></span>
    <span v-else-if="row.category === 'radius'" class="radius-sample" />
    <span v-else-if="row.category === 'size'" class="size-sample" />
    <span v-else-if="row.category === 'opacity'" class="opacity-sample"><i /><b /></span>
    <span v-else-if="row.category === 'stroke'" class="stroke-sample" />
    <span v-else-if="row.category === 'typography'" class="type-sample">Aa</span>
    <span
      v-else-if="row.category === 'toggle'"
      class="toggle-sample"
      :class="{ on: value === true }"
      ><i
    /></span>
    <span v-else-if="row.category === 'text'" class="text-sample">{{ value }}</span>
    <span v-else class="number-sample">{{ value }}</span>
  </span>
</template>

<style scoped>
.token-specimen {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 76px;
  height: 44px;
  flex: none;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text-dim);
}
.color-sample {
  width: 100%;
  height: 100%;
  background:
    linear-gradient(var(--sample-color), var(--sample-color)),
    repeating-conic-gradient(var(--raised) 0% 25%, var(--panel) 0% 50%) 0 0 / 12px 12px;
}
.space-sample {
  display: flex;
  align-items: center;
}
.space-sample i {
  height: 24px;
  width: 9px;
  background: var(--raised);
  border: 1px solid var(--text-faint);
  border-radius: 2px;
}
.space-sample b {
  width: var(--sample-length);
  height: 16px;
  border-block: 1px dashed var(--bound);
  background: color-mix(in srgb, var(--bound) 14%, transparent);
}
.radius-sample {
  width: 39px;
  height: 29px;
  margin: 16px -20px -10px 0;
  border-top: 2px solid var(--bound);
  border-left: 2px solid var(--bound);
  border-top-left-radius: var(--sample-radius);
  background: color-mix(in srgb, var(--bound) 10%, transparent);
}
.size-sample {
  width: max(1px, var(--sample-length));
  height: 22px;
  border: 1px solid var(--bound);
  background: color-mix(in srgb, var(--bound) 14%, transparent);
}
.opacity-sample {
  display: flex;
  align-items: center;
}
.opacity-sample i,
.opacity-sample b {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--raised);
}
.opacity-sample b {
  margin-left: -9px;
  background: var(--bound);
  opacity: var(--sample-opacity);
}
.stroke-sample {
  width: 46px;
  height: var(--sample-stroke);
  background: var(--bound);
}
.type-sample {
  font-size: inherit;
  line-height: 1;
}
.typography {
  font-size: 25px;
}
.toggle-sample {
  width: 30px;
  height: 17px;
  border: 1px solid var(--text-faint);
  border-radius: 20px;
  padding: 3px;
}
.toggle-sample i {
  display: block;
  width: 9px;
  height: 9px;
  background: var(--text-faint);
  border-radius: 50%;
}
.toggle-sample.on {
  border-color: var(--bound);
}
.toggle-sample.on i {
  margin-left: auto;
  background: var(--bound);
}
.text-sample {
  max-width: 100%;
  padding: 0 7px;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.number-sample {
  font-family: monospace;
  font-size: 16px;
  padding: 0 5px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.unresolved {
  color: var(--text-faint);
}
</style>
