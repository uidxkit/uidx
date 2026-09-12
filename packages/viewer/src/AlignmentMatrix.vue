<script setup lang="ts">
import { computed } from 'vue'

/**
 * Figma's 3×3 alignment matrix (story C9).
 *
 * One click sets both axes, which is the whole point of the control: the two
 * `*AxisAlignItems` props are one decision to a designer and two props to the
 * file. Which axis a column means depends on `layoutMode` — in a horizontal
 * frame the primary axis runs left-to-right, in a vertical one it runs down —
 * so the grid transposes rather than the values.
 *
 * The two writes leave in the same tick and `patch-burst` makes them one
 * envelope, so a click is one revision and one line-pair in the diff.
 */
const props = defineProps<{
  primary: string
  counter: string
  layoutMode: string
  editable: boolean
}>()

const emit = defineEmits<{
  commit: [writes: Array<{ prop: string; value: string }>]
  hover: [prop: string | null]
}>()

/** Figma's words for the three stops on either axis, in visual order. */
const STOPS = ['MIN', 'CENTER', 'MAX'] as const
type Stop = (typeof STOPS)[number]

const LABEL: Record<string, string> = {
  MIN: 'start',
  CENTER: 'center',
  MAX: 'end',
  SPACE_BETWEEN: 'space between',
  BASELINE: 'baseline',
}

const horizontal = computed(() => props.layoutMode === 'HORIZONTAL')

/**
 * A cell is a (row, column) on screen. Screen columns are the primary axis in
 * a horizontal frame and the counter axis in a vertical one.
 */
function cellFor(row: number, col: number): { primary: Stop; counter: Stop } {
  return horizontal.value
    ? { primary: STOPS[col]!, counter: STOPS[row]! }
    : { primary: STOPS[row]!, counter: STOPS[col]! }
}

const cells = computed(() =>
  [0, 1, 2].flatMap((row) =>
    [0, 1, 2].map((col) => {
      const { primary, counter } = cellFor(row, col)
      return {
        key: `${row}-${col}`,
        primary,
        counter,
        active: props.primary === primary && props.counter === counter,
        title: `${LABEL[primary]} · ${LABEL[counter]}`,
      }
    }),
  ),
)

/**
 * `SPACE_BETWEEN` has no cell — it distributes rather than aligns — so the
 * grid shows the counter-axis row it still obeys and the toggle beneath
 * carries the mode.
 */
const distributed = computed(() => props.primary === 'SPACE_BETWEEN')

function onCell(primary: Stop, counter: Stop): void {
  if (!props.editable) return
  emit('commit', [
    { prop: 'primaryAxisAlignItems', value: primary },
    { prop: 'counterAxisAlignItems', value: counter },
  ])
}

function onDistribute(next: boolean): void {
  if (!props.editable) return
  emit('commit', [{ prop: 'primaryAxisAlignItems', value: next ? 'SPACE_BETWEEN' : 'MIN' }])
}
</script>

<template>
  <div
    class="alignment-matrix"
    :data-distributed="distributed"
    role="group"
    aria-label="alignment"
    @mouseenter="emit('hover', 'primaryAxisAlignItems')"
    @mouseleave="emit('hover', null)"
  >
    <div class="matrix-grid">
      <button
        v-for="cell in cells"
        :key="cell.key"
        type="button"
        class="matrix-cell"
        :class="{ active: cell.active }"
        :data-active="cell.active"
        :disabled="!editable"
        :title="cell.title"
        :aria-label="cell.title"
        :aria-pressed="cell.active"
        @click="onCell(cell.primary, cell.counter)"
      >
        <span class="matrix-mark" aria-hidden="true" />
      </button>
    </div>

    <div class="matrix-modes">
      <button
        type="button"
        class="matrix-mode"
        :data-active="!distributed"
        :disabled="!editable"
        title="packed"
        aria-label="packed"
        @click="onDistribute(false)"
      >
        <span class="mode-bar" /><span class="mode-bar" /><span class="mode-bar" />
      </button>
      <button
        type="button"
        class="matrix-mode spaced"
        :data-active="distributed"
        :disabled="!editable"
        title="space between"
        aria-label="space between"
        @click="onDistribute(true)"
      >
        <span class="mode-bar" /><span class="mode-bar" /><span class="mode-bar" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.alignment-matrix {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--gap-sm);
}
.matrix-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  width: 72px;
  height: 72px;
  background: var(--raised);
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  padding: 2px;
  gap: 1px;
}
.matrix-grid:hover {
  border-color: var(--line);
}
.matrix-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: var(--radius);
  padding: 0;
  cursor: pointer;
}
.matrix-cell:hover:not(:disabled) {
  background: var(--accent-dim);
}
/* Figma's affordance: inactive cells are dots, the chosen one is a bar. */
.matrix-mark {
  width: 3px;
  height: 3px;
  border-radius: 999px;
  background: var(--text-faint);
}
.matrix-cell:hover:not(:disabled) .matrix-mark {
  background: var(--text-dim);
}
.matrix-cell.active .matrix-mark {
  width: 12px;
  height: 3px;
  border-radius: 999px;
  background: var(--accent);
}
.matrix-modes {
  display: flex;
  gap: var(--gap-sm);
}
.matrix-mode {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: 24px;
  height: 18px;
  background: var(--raised);
  border: 1px solid transparent;
  border-radius: var(--radius);
  cursor: pointer;
  padding: 0 3px;
}
.matrix-mode.spaced {
  justify-content: space-between;
}
.matrix-mode[data-active='true'] {
  border-color: var(--accent);
}
.matrix-mode:hover:not(:disabled) {
  border-color: var(--line);
}
.mode-bar {
  width: 2px;
  height: 10px;
  border-radius: 999px;
  background: var(--text-faint);
}
.matrix-mode[data-active='true'] .mode-bar {
  background: var(--accent);
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
