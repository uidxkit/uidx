import { describe, expect, it } from 'vitest'
import {
  HANDLES,
  handleAt,
  nearestHandle,
  resizeCursor,
  movedRect,
  nudged,
  cornerWorld,
  handlePointsOf,
  resizedRect,
  rotationFor,
  rotationHandlePoint,
  ROTATE_HANDLE_STEM,
  type Rect,
} from '../src/gesture-model'

const BOX: Rect = { x: 100, y: 100, width: 200, height: 100 }

describe('handleAt', () => {
  it('finds the corner a press lands on', () => {
    expect(handleAt(BOX, { x: 100, y: 100 }, 1)).toBe('nw')
    expect(handleAt(BOX, { x: 300, y: 200 }, 1)).toBe('se')
  })

  it('finds an edge handle at the midpoint of a side', () => {
    expect(handleAt(BOX, { x: 200, y: 100 }, 1)).toBe('n')
    expect(handleAt(BOX, { x: 100, y: 150 }, 1)).toBe('w')
  })

  it('is null well inside the box', () => {
    expect(handleAt(BOX, { x: 200, y: 150 }, 1)).toBeNull()
  })

  it('grows its tolerance as the view zooms out, so handles stay grabbable', () => {
    const justOutside = { x: 100, y: 88 }
    expect(handleAt(BOX, justOutside, 1)).toBeNull()
    expect(handleAt(BOX, justOutside, 0.25)).toBe('nw')
  })

  it('names eight handles and no more', () => {
    expect([...HANDLES]).toHaveLength(8)
  })
})

describe('movedRect', () => {
  it('offsets by the drag delta', () => {
    expect(movedRect(BOX, { x: 30, y: -10 }, false)).toEqual({
      x: 130,
      y: 90,
      width: 200,
      height: 100,
    })
  })

  it('locks to the dominant axis while shift is held', () => {
    expect(movedRect(BOX, { x: 30, y: -10 }, true)).toMatchObject({ x: 130, y: 100 })
    expect(movedRect(BOX, { x: 4, y: -40 }, true)).toMatchObject({ x: 100, y: 60 })
  })
})

describe('resizedRect', () => {
  it('drags the south-east corner without moving the origin', () => {
    expect(resizedRect(BOX, 'se', { x: 50, y: 20 }, {})).toEqual({
      x: 100,
      y: 100,
      width: 250,
      height: 120,
    })
  })

  it('drags the north-west corner by moving the origin', () => {
    expect(resizedRect(BOX, 'nw', { x: 20, y: 10 }, {})).toEqual({
      x: 120,
      y: 110,
      width: 180,
      height: 90,
    })
  })

  it('moves one edge only', () => {
    expect(resizedRect(BOX, 'e', { x: 50, y: 999 }, {})).toEqual({
      x: 100,
      y: 100,
      width: 250,
      height: 100,
    })
  })

  it('keeps the aspect ratio while shift is held', () => {
    const out = resizedRect(BOX, 'se', { x: 100, y: 0 }, { constrain: true })
    expect(out.width / out.height).toBeCloseTo(BOX.width / BOX.height, 5)
  })

  it('resizes about the centre while alt is held', () => {
    expect(resizedRect(BOX, 'e', { x: 20, y: 0 }, { fromCentre: true })).toEqual({
      x: 80,
      y: 100,
      width: 240,
      height: 100,
    })
  })

  it('never produces a negative dimension', () => {
    const out = resizedRect(BOX, 'e', { x: -500, y: 0 }, {})
    expect(out.width).toBeGreaterThanOrEqual(0)
  })
})

describe('rotationFor', () => {
  it('measures the angle from the centre, in degrees', () => {
    const centre = { x: 0, y: 0 }
    expect(rotationFor(centre, { x: 10, y: 0 }, { x: 0, y: 10 }, 0, false)).toBeCloseTo(90, 5)
  })

  it('snaps to 15 degree stops while shift is held', () => {
    const centre = { x: 0, y: 0 }
    const snapped = rotationFor(centre, { x: 10, y: 0 }, { x: 10, y: 2 }, 0, true)
    expect(snapped % 15).toBeCloseTo(0, 5)
  })

  it('adds to the rotation the node already had', () => {
    const centre = { x: 0, y: 0 }
    expect(rotationFor(centre, { x: 10, y: 0 }, { x: 0, y: 10 }, 30, false)).toBeCloseTo(120, 5)
  })
})

describe('nudged', () => {
  it('steps one pixel per press', () => {
    expect(nudged({ x: 10, y: 20 }, 'ArrowRight', false)).toEqual({ x: 11, y: 20 })
    expect(nudged({ x: 10, y: 20 }, 'ArrowUp', false)).toEqual({ x: 10, y: 19 })
  })

  it('steps ten with shift, Figma’s big nudge', () => {
    expect(nudged({ x: 10, y: 20 }, 'ArrowDown', true)).toEqual({ x: 10, y: 30 })
  })

  it('ignores keys that are not arrows', () => {
    expect(nudged({ x: 10, y: 20 }, 'Enter', false)).toBeNull()
  })
})

/**
 * The renderer's own transform, proven by measurement (C10a): a node's world
 * matrix is translate(origin) · rotate(node.rotation), clockwise in y-down
 * screen space — the pivot is the node's top-left origin, not its centre, and
 * `getAbsoluteRotation`'s inverted convention takes no part in it. On a text
 * turned 67.067°, `getWorldHandles`'s ne − nw came out as R(67.067°)·(width, 0)
 * to the decimal, and dots drawn from this model sat exactly on the drawn grips.
 */
describe('the rotated-node model pivots on the origin', () => {
  it('maps corners through translate(origin) · rotate', () => {
    // Quarter-turn clockwise: the width axis points straight down.
    const near = (frac: { x: number; y: number }, at: { x: number; y: number }) => {
      const world = cornerWorld(BOX, 90, frac)
      expect(world.x).toBeCloseTo(at.x, 8)
      expect(world.y).toBeCloseTo(at.y, 8)
    }
    near({ x: 1, y: 0 }, { x: 100, y: 300 })
    near({ x: 0, y: 0 }, { x: 100, y: 100 })
    near({ x: 1, y: 1 }, { x: 0, y: 300 })
  })

  it('finds a grip where the turned node draws it', () => {
    expect(handleAt(BOX, { x: 100, y: 300 }, 1, 90)).toBe('ne')
    expect(handleAt(BOX, { x: 50, y: 300 }, 1, 90)).toBe('e')
  })

  it('no longer finds one where the unrotated rect had it', () => {
    expect(handleAt(BOX, { x: 300, y: 100 }, 1, 90)).toBeNull()
  })
})

describe('nearestHandle', () => {
  const POINTS = {
    nw: { x: 10, y: 10 },
    n: { x: 30, y: 5 },
    ne: { x: 50, y: 0 },
    e: { x: 55, y: 20 },
    se: { x: 60, y: 40 },
    s: { x: 40, y: 45 },
    sw: { x: 20, y: 50 },
    w: { x: 15, y: 30 },
  }

  it('finds the grip a press lands on', () => {
    expect(nearestHandle(POINTS, { x: 60, y: 40 }, 6)).toBe('se')
    expect(nearestHandle(POINTS, { x: 11, y: 12 }, 6)).toBe('nw')
  })

  it('is null when nothing is within reach', () => {
    expect(nearestHandle(POINTS, { x: 35, y: 25 }, 6)).toBeNull()
  })

  it('picks the closest when two are near', () => {
    expect(nearestHandle(POINTS, { x: 57, y: 22 }, 20)).toBe('e')
  })
})

describe('resizing a rotated node', () => {
  it('keeps the origin put when a far grip is dragged — it is the pivot', () => {
    // Quarter-turn: a screen-down drag on the se grip travels along the width.
    const out = resizedRect(BOX, 'se', { x: 0, y: 50 }, {}, 90)
    expect(out).toMatchObject({ x: 100, y: 100, width: 250 })
  })

  it('holds the opposite corner still in world space', () => {
    const TURN = 35
    for (const [handle, anchor] of [
      ['nw', { x: 1, y: 1 }],
      ['se', { x: 0, y: 0 }],
      ['e', { x: 0, y: 0.5 }],
    ] as const) {
      const before = cornerWorld(BOX, TURN, anchor)
      const after = resizedRect(BOX, handle, { x: 40, y: 25 }, {}, TURN)
      const moved = cornerWorld(after, TURN, anchor)
      expect(moved.x, handle).toBeCloseTo(before.x, 5)
      expect(moved.y, handle).toBeCloseTo(before.y, 5)
    }
  })

  it('holds the centre when alt resizes from it', () => {
    const TURN = 35
    const centre = cornerWorld(BOX, TURN, { x: 0.5, y: 0.5 })
    const after = resizedRect(BOX, 'e', { x: 40, y: 0 }, { fromCentre: true }, TURN)
    const moved = cornerWorld(after, TURN, { x: 0.5, y: 0.5 })
    expect(moved.x).toBeCloseTo(centre.x, 5)
    expect(moved.y).toBeCloseTo(centre.y, 5)
  })

  it("grows by the travel measured along the node's own axis", () => {
    const rad = (35 * Math.PI) / 180
    const along = { x: Math.cos(rad) * 50, y: Math.sin(rad) * 50 }
    expect(resizedRect(BOX, 'e', along, {}, 35).width).toBeCloseTo(BOX.width + 50, 5)
  })

  it('reduces to the unrotated arithmetic at zero', () => {
    expect(resizedRect(BOX, 'e', { x: 50, y: 0 }, {}, 0)).toEqual(
      resizedRect(BOX, 'e', { x: 50, y: 0 }, {}),
    )
  })
})

describe('resizeCursor', () => {
  it('matches the unrotated grips to their native cursors', () => {
    expect(resizeCursor('e', 0)).toBe('ew-resize')
    expect(resizeCursor('w', 0)).toBe('ew-resize')
    expect(resizeCursor('n', 0)).toBe('ns-resize')
    expect(resizeCursor('se', 0)).toBe('nwse-resize')
    expect(resizeCursor('ne', 0)).toBe('nesw-resize')
  })

  it('turns with the node, so the arrows point along the real resize axis', () => {
    // Quarter-turn: the east edge's axis points straight down the screen.
    expect(resizeCursor('e', 90)).toBe('ns-resize')
    expect(resizeCursor('n', 90)).toBe('ew-resize')
    expect(resizeCursor('se', 90)).toBe('nesw-resize')
    expect(resizeCursor('ne', 90)).toBe('nwse-resize')
  })

  it('quantizes to the nearest of the four native orientations', () => {
    // 81.74 degrees: the axis is near-vertical, so the arrows say so.
    expect(resizeCursor('e', 81.74)).toBe('ns-resize')
    // 160 degrees wraps: nearer to horizontal than to the diagonal.
    expect(resizeCursor('e', 160)).toBe('ew-resize')
  })

  it('is stable across full turns and negative angles', () => {
    expect(resizeCursor('e', 360)).toBe('ew-resize')
    expect(resizeCursor('e', -90)).toBe('ns-resize')
  })
})

describe('handlePointsOf', () => {
  it('puts the eight grips where cornerWorld puts them', () => {
    const points = handlePointsOf(BOX)
    expect(points.nw).toEqual({ x: 100, y: 100 })
    expect(points.n).toEqual({ x: 200, y: 100 })
    expect(points.se).toEqual({ x: 300, y: 200 })
    expect(points.w).toEqual({ x: 100, y: 150 })
  })

  it('turns with the node, about its origin', () => {
    const turned = handlePointsOf(BOX, 90)
    expect(turned.nw).toEqual({ x: 100, y: 100 })
    expect(turned.ne.x).toBeCloseTo(100)
    expect(turned.ne.y).toBeCloseTo(300)
  })
})

/**
 * The knob is the rotate target the eye can find (#16): Figma's corner zones
 * are invisible, and a gesture nobody can see may as well not exist.
 */
describe('rotationHandlePoint', () => {
  it('sits on a stem straight above the top-centre grip', () => {
    expect(rotationHandlePoint(handlePointsOf(BOX), 1)).toEqual({
      x: 200,
      y: 100 - ROTATE_HANDLE_STEM,
    })
  })

  it('keeps the same reach on screen whatever the zoom', () => {
    const handles = handlePointsOf(BOX)
    expect(rotationHandlePoint(handles, 2).y).toBeCloseTo(100 - ROTATE_HANDLE_STEM / 2)
    expect(rotationHandlePoint(handles, 0.5).y).toBeCloseTo(100 - ROTATE_HANDLE_STEM * 2)
  })

  it('turns with the node, so it stays above the box the author sees', () => {
    const turned = handlePointsOf(BOX, 90)
    const knob = rotationHandlePoint(turned, 1)
    // A quarter turn clockwise points the box's "up" to the right.
    expect(knob.x - turned.n.x).toBeCloseTo(ROTATE_HANDLE_STEM)
    expect(knob.y - turned.n.y).toBeCloseTo(0)
  })

  it('points straight up for a box with no height of its own', () => {
    const flat = handlePointsOf({ x: 0, y: 0, width: 100, height: 0 })
    expect(rotationHandlePoint(flat, 1)).toEqual({ x: 50, y: -ROTATE_HANDLE_STEM })
  })
})
