import { describe, expect, it } from 'vitest'
import { parseSVGPath } from '@open-pencil/scene-graph/parse-path'
import { vectorNetworkToSVGPaths } from '@open-pencil/core'

import { bounds, closesPath, overlay, pathData, vertexAt, type PenVertex } from '../src/pen-model'

const corner = (x: number, y: number): PenVertex => vertexAt({ x, y }, null)
const smooth = (x: number, y: number, dx: number, dy: number): PenVertex =>
  vertexAt({ x, y }, { x: x + dx, y: y + dy })

describe('placing a vertex', () => {
  it('is a corner when the press did not travel', () => {
    expect(corner(3, 4)).toEqual({ x: 3, y: 4, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } })
  })

  it('pulls mirrored handles when it did', () => {
    expect(smooth(10, 10, 5, 0)).toEqual({
      x: 10,
      y: 10,
      out: { x: 5, y: 0 },
      in: { x: -5, y: 0 },
    })
  })
})

describe('path data', () => {
  it('joins corners with lines', () => {
    expect(pathData([corner(0, 0), corner(10, 0), corner(10, 10)], false)).toBe('M0 0L10 0L10 10')
  })

  it('closes back to the first vertex', () => {
    expect(pathData([corner(0, 0), corner(10, 0), corner(10, 10)], true)).toBe(
      'M0 0L10 0L10 10L0 0Z',
    )
  })

  it('makes a cubic when either end pulls a tangent', () => {
    expect(pathData([smooth(0, 0, 5, 0), corner(10, 10)], false)).toBe('M0 0C5 0 10 10 10 10')
    // The other end alone is enough, too.
    expect(pathData([corner(0, 0), smooth(10, 10, 3, 3)], false)).toBe('M0 0C0 0 7 7 10 10')
  })

  it('expresses the path relative to an origin, since the file holds it that way', () => {
    expect(pathData([corner(100, 50), corner(110, 50)], false, { x: 100, y: 50 })).toBe('M0 0L10 0')
  })

  it('rounds to two decimals, and never writes negative zero', () => {
    expect(pathData([corner(0.126, -0), corner(1, 1)], false)).toBe('M0.13 0L1 1')
  })

  it('has nothing to say about no vertices, or a single one', () => {
    expect(pathData([], false)).toBe('')
    expect(pathData([corner(2, 3)], true)).toBe('M2 3')
  })
})

/**
 * The property ADR 0006 §8 rests on, checked from the pen's own end: what a
 * drawing tool produces must survive the write-back conversion untouched, or
 * the file would re-spell itself the first time the path was saved.
 */
describe('what the pen produces survives the round trip exactly', () => {
  for (const [name, vertices, closed] of [
    ['a triangle', [corner(0, 0), corner(10, 0), corner(5, 8)], true],
    ['an open polyline', [corner(0, 0), corner(4, 4), corner(8, 0)], false],
    ['a smooth curve', [smooth(0, 0, 4, 0), smooth(20, 10, 4, 4)], false],
    ['a closed blob', [smooth(0, 0, 5, 0), smooth(20, 0, 0, 5), smooth(10, 20, -5, 0)], true],
    ['mixed corners and curves', [corner(0, 0), smooth(10, 5, 3, 0), corner(20, 0)], false],
  ] as const) {
    it(name, () => {
      const d = pathData(vertices, closed)
      const network = parseSVGPath(d, 'NONZERO')
      expect(vectorNetworkToSVGPaths(network)[0], d).toBe(d)
    })
  }
})

describe('bounds', () => {
  it('boxes a straight-edged path by its vertices', () => {
    expect(bounds([corner(2, 3), corner(12, 3), corner(12, 9)], true)).toEqual({
      x: 2,
      y: 3,
      width: 10,
      height: 6,
    })
  })

  /**
   * A handle can reach well outside the curve it shapes. Boxing the control
   * polygon would give the node empty space to select and resize around, so
   * the extremes are solved for rather than approximated.
   */
  it('boxes the ink, not the handles', () => {
    // Both control points sit 20 above the baseline, but the curve only reaches
    // three quarters of that: at t=0.5 a symmetric cubic is 6/8 of the way up.
    const path = [smooth(0, 0, 0, -20), vertexAt({ x: 10, y: 0 }, { x: 10, y: 20 })]
    const box = bounds(path, false)
    expect(box.y).toBeGreaterThan(-20)
    expect(box.y).toBeCloseTo(-15, 5)
    expect(box.height).toBeCloseTo(15, 5)
  })

  it('includes the curve on the closing segment', () => {
    const open = bounds([smooth(0, 0, 0, -10), corner(10, 0)], false)
    const shut = bounds([smooth(0, 0, 0, -10), corner(10, 0)], true)
    expect(shut.height).toBeGreaterThan(open.height)
  })

  it('is empty for an empty path', () => {
    expect(bounds([], false)).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})

describe('closing', () => {
  it('needs two vertices and a pointer near the first', () => {
    const path = [corner(0, 0), corner(10, 0)]
    expect(closesPath(path, { x: 2, y: 2 }, 1)).toBe(true)
    expect(closesPath(path, { x: 40, y: 40 }, 1)).toBe(false)
    expect(closesPath([corner(0, 0)], { x: 0, y: 0 }, 1)).toBe(false)
  })

  it('widens its reach as the view shrinks, so the target stays hittable', () => {
    const path = [corner(0, 0), corner(10, 0)]
    expect(closesPath(path, { x: 30, y: 0 }, 1)).toBe(false)
    expect(closesPath(path, { x: 30, y: 0 }, 0.25)).toBe(true)
  })
})

describe('the overlay handed to the renderer', () => {
  it('carries one segment per join, with the tangents that shape it', () => {
    const out = overlay([smooth(0, 0, 5, 0), corner(10, 10)], { x: 12, y: 12 })
    expect(out.vertices).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ])
    expect(out.segments).toEqual([
      { start: 0, end: 1, tangentStart: { x: 5, y: 0 }, tangentEnd: { x: 0, y: 0 } },
    ])
    expect(out).toMatchObject({ cursorX: 12, cursorY: 12, closingToFirst: false })
  })

  it('shows both halves of the handle while one is being pulled', () => {
    const out = overlay([smooth(0, 0, 5, 0)], null, { dragging: true })
    expect(out.dragTangent).toEqual({ x: 5, y: 0 })
    expect(out.oppositeDragTangent).toEqual({ x: -5, y: 0 })
  })

  it('says when a press would close, so the renderer can enlarge the target', () => {
    expect(overlay([corner(0, 0)], null, { closing: true }).closingToFirst).toBe(true)
  })
})
