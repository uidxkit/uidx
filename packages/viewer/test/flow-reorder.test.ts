import { describe, expect, it } from 'vitest'

import { flowSlotAt, type FlowChild } from '../src/flow-reorder'

const PARENT = { id: 'stack', x: 0, y: 0, width: 200, height: 400 }

/** Three rows of 100x40, stacked with no gap: y 0-40, 40-80, 80-120. */
const ROWS: FlowChild[] = [
  { id: 'a', x: 0, y: 0, width: 100, height: 40 },
  { id: 'b', x: 0, y: 40, width: 100, height: 40 },
  { id: 'c', x: 0, y: 80, width: 100, height: 40 },
]

const slot = (x: number, y: number, siblings = ROWS, axis = 'VERTICAL' as const) =>
  flowSlotAt({ x, y }, siblings, axis, PARENT)

describe('a vertical stack', () => {
  it('counts the children the pointer has passed the middle of', () => {
    expect(slot(50, 5).index).toBe(0)
    expect(slot(50, 19).index).toBe(0)
    expect(slot(50, 21).index).toBe(1)
    expect(slot(50, 59).index).toBe(1)
    expect(slot(50, 61).index).toBe(2)
    expect(slot(50, 500).index).toBe(3)
  })

  /**
   * `siblings` arrives with the dragged child already removed, so "back where
   * it started" is `index === its own original index` rather than an
   * off-by-one that depends on which way the drag went — the classic reorder
   * bug, and why `moveFor` filters first too.
   */
  it('names the slot a child came from when it is dragged back to it', () => {
    // `b` is being dragged: siblings are [a, c], and b sat at index 1.
    const without = [ROWS[0]!, { ...ROWS[2]!, y: 40 }]
    expect(flowSlotAt({ x: 50, y: 50 }, without, 'VERTICAL', PARENT).index).toBe(1)
  })

  it('draws the caret across the run, between the two children it separates', () => {
    const { caret } = slot(50, 41)
    expect(caret).toMatchObject({ parentId: 'stack', index: 1, direction: 'HORIZONTAL', y: 40 })
    expect(caret.x).toBe(0)
    expect(caret.length).toBe(100)
  })

  it('sits just inside the run at either end rather than on top of a child', () => {
    expect(slot(50, 1).caret.y).toBeLessThan(ROWS[0]!.y + 1)
    expect(slot(50, 300).caret.y).toBeGreaterThan(ROWS[2]!.y + ROWS[2]!.height - 1)
  })
})

describe('a horizontal row', () => {
  const COLS: FlowChild[] = [
    { id: 'a', x: 0, y: 0, width: 40, height: 100 },
    { id: 'b', x: 40, y: 0, width: 40, height: 100 },
  ]
  it('counts along x and parts along a vertical caret', () => {
    expect(flowSlotAt({ x: 10, y: 50 }, COLS, 'HORIZONTAL', PARENT).index).toBe(0)
    expect(flowSlotAt({ x: 50, y: 50 }, COLS, 'HORIZONTAL', PARENT).index).toBe(1)
    const { caret } = flowSlotAt({ x: 41, y: 50 }, COLS, 'HORIZONTAL', PARENT)
    expect(caret).toMatchObject({ direction: 'VERTICAL', x: 40, y: 0, length: 100 })
  })
})

/**
 * The reason D7 is an L rather than an S. A wrapped flow makes the question
 * two-dimensional: which row, and then where in it.
 */
describe('a wrapped flow', () => {
  // Two rows of two: (0,0) (50,0) then (0,50) (50,50). Wrap shows up as the
  // main-axis start going backwards, which is how the runs are detected.
  const GRID: FlowChild[] = [
    { id: 'a', x: 0, y: 0, width: 40, height: 40 },
    { id: 'b', x: 50, y: 0, width: 40, height: 40 },
    { id: 'c', x: 0, y: 50, width: 40, height: 40 },
    { id: 'd', x: 50, y: 50, width: 40, height: 40 },
  ]
  const at = (x: number, y: number) => flowSlotAt({ x, y }, GRID, 'HORIZONTAL', PARENT)

  it('places within the row the pointer is in, not by x alone', () => {
    expect(at(10, 10).index).toBe(0)
    expect(at(80, 10).index).toBe(2)
    // Same x, second row: the earlier row's two children are already counted.
    expect(at(10, 60).index).toBe(2)
    expect(at(80, 60).index).toBe(4)
  })

  it('falls to the nearest row when the pointer is between or beyond them', () => {
    expect(at(10, -30).index).toBe(0)
    expect(at(80, 300).index).toBe(4)
  })

  it('spans the caret across only its own row', () => {
    expect(at(45, 10).caret).toMatchObject({ y: 0, length: 40, direction: 'VERTICAL' })
    expect(at(45, 60).caret).toMatchObject({ y: 50, length: 40 })
  })
})

describe('an only child, and an empty parent', () => {
  it('has one slot, spanning the parent', () => {
    const { index, caret } = flowSlotAt({ x: 50, y: 50 }, [], 'VERTICAL', PARENT)
    expect(index).toBe(0)
    expect(caret).toMatchObject({ x: 0, length: 200, direction: 'HORIZONTAL' })
  })
})
