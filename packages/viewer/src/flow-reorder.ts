import type { Point } from './gesture-model'

/**
 * Where a drag through an auto-layout frame would drop its child (story D7).
 *
 * A flowed child's `x`/`y` belong to the layout (D4), so the canvas refused to
 * drag one at all. Figma's answer is that the drag means something else
 * entirely: not a position, an *index*. This is the arithmetic for that, with
 * no canvas in it — the same reason `gesture-model.ts` exists.
 *
 * Everything here works in world coordinates, because the pointer does.
 */

export interface FlowChild {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export type FlowAxis = 'HORIZONTAL' | 'VERTICAL'

/** The SDK's own insertion-caret payload, which the renderer already draws. */
export interface InsertCaret {
  parentId: string
  index: number
  x: number
  y: number
  length: number
  direction: FlowAxis
}

export interface FlowSlot {
  /**
   * An index into the siblings *after* the dragged child is removed, which is
   * the index `move-node` wants (patch.ts:341) and the one `moveFor` computes.
   */
  index: number
  caret: InsertCaret
}

/** How far a caret sits from the edge of the run when it lands at either end. */
const EDGE_GAP = 2

/**
 * The runs a wrapped flow lays its children out in, in flow order.
 *
 * Detected by the main-axis start going backwards rather than by comparing
 * cross-axis positions: `counterAxisAlignItems` can put children of different
 * sizes at different cross offsets within one run, so a grouping keyed on the
 * cross axis splits a single row into several. A wrap is the one thing that
 * always moves the main axis back to the start.
 */
function runsOf(siblings: readonly FlowChild[], axis: FlowAxis): FlowChild[][] {
  const main = axis === 'HORIZONTAL' ? 'x' : 'y'
  const runs: FlowChild[][] = []
  let run: FlowChild[] = []
  for (const child of siblings) {
    if (run.length && child[main] < run[run.length - 1]![main]) {
      runs.push(run)
      run = []
    }
    run.push(child)
  }
  if (run.length) runs.push(run)
  return runs.length ? runs : [[]]
}

/** The run the pointer is in, or the nearest one when it is outside them all. */
function runAt(runs: readonly FlowChild[][], point: Point, axis: FlowAxis): number {
  const cross = axis === 'HORIZONTAL' ? 'y' : 'x'
  const size = axis === 'HORIZONTAL' ? 'height' : 'width'
  let best = 0
  let bestDistance = Infinity
  runs.forEach((run, i) => {
    if (!run.length) return
    const lo = Math.min(...run.map((c) => c[cross]))
    const hi = Math.max(...run.map((c) => c[cross] + c[size]))
    const distance =
      point[cross] < lo ? lo - point[cross] : point[cross] > hi ? point[cross] - hi : 0
    if (distance < bestDistance) {
      best = i
      bestDistance = distance
    }
  })
  return best
}

/**
 * The slot a pointer at `point` names, and where to draw its caret.
 *
 * `siblings` is the parent's children in flow order **with the dragged child
 * already removed**, so the index falls out as the count of children the
 * pointer has passed. Removing it first is what makes the same-slot case
 * `index === original` rather than an off-by-one that depends on direction —
 * the classic reorder bug, and the same reason `moveFor` filters first.
 *
 * `bounds` is the parent's own world rect, used only to give the caret
 * something to span when there is nothing else to measure against.
 */
export function flowSlotAt(
  point: Point,
  siblings: readonly FlowChild[],
  axis: FlowAxis,
  parent: { id: string; x: number; y: number; width: number; height: number },
): FlowSlot {
  const main = axis === 'HORIZONTAL' ? 'x' : 'y'
  const size = axis === 'HORIZONTAL' ? 'width' : 'height'
  const cross = axis === 'HORIZONTAL' ? 'y' : 'x'
  const crossSize = axis === 'HORIZONTAL' ? 'height' : 'width'
  // A vertical stack parts along a horizontal line, and the other way about.
  const direction: FlowAxis = axis === 'HORIZONTAL' ? 'VERTICAL' : 'HORIZONTAL'

  const runs = runsOf(siblings, axis)
  const which = runAt(runs, point, axis)
  const run = runs[which]!
  // How many siblings the earlier runs already account for.
  const before = runs.slice(0, which).reduce((n, r) => n + r.length, 0)

  // Past the midpoint counts as past the child — Figma's rule, and the rail's.
  const within = run.filter((c) => point[main] > c[main] + c[size] / 2).length
  const index = before + within

  const span = run.length
    ? {
        lo: Math.min(...run.map((c) => c[cross])),
        hi: Math.max(...run.map((c) => c[cross] + c[crossSize])),
      }
    : { lo: parent[cross], hi: parent[cross] + parent[crossSize] }

  // Between the two children it separates; at the run's own edge when there is
  // only one side to sit against.
  const previous = run[within - 1]
  const next = run[within]
  const at =
    previous && next
      ? (previous[main] + previous[size] + next[main]) / 2
      : previous
        ? previous[main] + previous[size] + EDGE_GAP
        : next
          ? next[main] - EDGE_GAP
          : parent[main] + EDGE_GAP

  return {
    index,
    caret: {
      parentId: parent.id,
      index,
      x: axis === 'HORIZONTAL' ? at : span.lo,
      y: axis === 'HORIZONTAL' ? span.lo : at,
      length: span.hi - span.lo,
      direction,
    },
  }
}
