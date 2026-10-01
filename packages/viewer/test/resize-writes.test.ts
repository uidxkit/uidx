import { describe, expect, it } from 'vitest'
import { resizedRect } from '../src/gesture-model'
import {
  instanceResizeWrites,
  releasedFills,
  resizedBox,
  resizeWrites,
  sizingFlipFor,
} from '../src/resize-writes'

/** The shape `resizeWrites` reads: what the SDK knows about the node's sizing. */
const node = (over: Record<string, unknown> = {}) => ({
  type: 'FRAME',
  layoutMode: 'VERTICAL',
  primaryAxisSizing: 'FIXED',
  counterAxisSizing: 'FIXED',
  ...over,
})

const RECT = { x: 10, y: 20, width: 300, height: 150 }

describe('resizeWrites', () => {
  it('writes the rect for a node that already sizes itself explicitly', () => {
    expect(resizeWrites(node(), RECT)).toEqual(RECT)
  })

  /**
   * The spike: `commitResizePreview` sends x/y/width/height and nothing else,
   * so a hugging frame's new width arrives while the axis still reads HUG and
   * D4's filter drops it. Dragging a handle in Figma switches the axis to
   * Fixed — so the gesture says so, and the write becomes legible.
   */
  it('flips a hugged axis to fixed, because that is what the gesture means', () => {
    const writes = resizeWrites(node({ primaryAxisSizing: 'HUG', counterAxisSizing: 'HUG' }), RECT)
    expect(writes).toMatchObject(RECT)
    expect(writes.primaryAxisSizing).toBe('FIXED')
    expect(writes.counterAxisSizing).toBe('FIXED')
  })

  it('flips only the axis that was hugging', () => {
    const writes = resizeWrites(node({ counterAxisSizing: 'HUG' }), RECT)
    expect(writes.counterAxisSizing).toBe('FIXED')
    expect(writes.primaryAxisSizing).toBeUndefined()
  })

  it('flips an axis its parent was stretching, for the same reason', () => {
    const writes = resizeWrites(node({ primaryAxisSizing: 'FILL' }), RECT)
    expect(writes.primaryAxisSizing).toBe('FIXED')
  })

  it('pins text that measures itself, so the resize survives', () => {
    const writes = resizeWrites(node({ type: 'TEXT', textAutoResize: 'WIDTH_AND_HEIGHT' }), RECT)
    expect(writes.textAutoResize).toBe('NONE')
  })

  it('leaves a wrapping text wrapping when only its width was dragged', () => {
    const writes = resizeWrites(node({ type: 'TEXT', textAutoResize: 'HEIGHT' }), RECT, {
      widthOnly: true,
    })
    expect(writes.textAutoResize).toBeUndefined()
  })

  it('pins a wrapping text once its height is dragged too', () => {
    const writes = resizeWrites(node({ type: 'TEXT', textAutoResize: 'HEIGHT' }), RECT)
    expect(writes.textAutoResize).toBe('NONE')
  })
})

describe('sizingFlipFor', () => {
  it('flips only the axis the edited dimension governs', () => {
    // A vertical frame: width is the counter axis, height the primary.
    const hugging = node({ primaryAxisSizing: 'HUG', counterAxisSizing: 'HUG' })
    expect(sizingFlipFor(hugging, 'width')).toEqual({ counterAxisSizing: 'FIXED' })
    expect(sizingFlipFor(hugging, 'height')).toEqual({ primaryAxisSizing: 'FIXED' })
  })

  it('says nothing when the axis is already fixed', () => {
    expect(sizingFlipFor(node(), 'width')).toEqual({})
  })

  it('follows the layout direction', () => {
    const horizontal = node({
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG',
    })
    expect(sizingFlipFor(horizontal, 'width')).toEqual({ primaryAxisSizing: 'FIXED' })
  })

  it('pins a text that measures the edited dimension', () => {
    const text = node({ type: 'TEXT', textAutoResize: 'WIDTH_AND_HEIGHT' })
    // A typed width sets the wrap and the box keeps growing downward —
    // Figma's split, and the one that never leaves an unauthored height
    // reading as fixed on the scene node (the D4 geometry echo). A typed
    // height is the one that fixes the box.
    expect(sizingFlipFor(text, 'width')).toMatchObject({ textAutoResize: 'HEIGHT' })
    expect(sizingFlipFor(text, 'height')).toMatchObject({ textAutoResize: 'NONE' })
  })

  it('leaves a wrapping text wrapping when only its width is set', () => {
    const text = node({ type: 'TEXT', textAutoResize: 'HEIGHT' })
    expect(sizingFlipFor(text, 'width').textAutoResize).toBeUndefined()
    expect(sizingFlipFor(text, 'height').textAutoResize).toBe('NONE')
  })
})

describe('resizedBox', () => {
  const FROM = { x: 10, y: 20, width: 100, height: 40 }
  const DRAG = { constrain: false, fromCentre: false }
  /** The box a commit settles on: every side rounded, as the controller does. */
  const settled = (rect: typeof FROM) => ({
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  })

  it('is the width alone for a side handle, even if the height moved', () => {
    expect(resizedBox(FROM, { ...FROM, width: 160, height: 44 }, true)).toEqual({
      x: false,
      y: false,
      width: true,
      height: false,
    })
  })

  it('reads a top or bottom handle off the box, since the controller has no word for it', () => {
    expect(resizedBox(FROM, { ...FROM, y: 10, height: 50 }, false)).toEqual({
      x: false,
      y: true,
      width: false,
      height: true,
    })
  })

  it('is both for a corner that moved both', () => {
    expect(resizedBox(FROM, { x: 0, y: 0, width: 110, height: 60 }, false)).toEqual({
      x: true,
      y: true,
      width: true,
      height: true,
    })
  })

  it('ignores the half pixel a commit rounds away', () => {
    expect(resizedBox({ ...FROM, x: 10.4 }, { ...FROM, height: 50 }, false)).toMatchObject({
      x: false,
      width: false,
    })
  })

  it('ignores exactly half a pixel, which is as far as rounding moves anything', () => {
    // An instance centred in an auto-layout column sits at x 89.5; a bottom
    // handle's commit rounds it to 90, and that is not a resize of the width.
    const from = { x: 89.5, y: 0, width: 121, height: 40 }
    expect(resizedBox(from, settled({ ...from, height: 60 }), false)).toEqual({
      x: false,
      y: false,
      width: false,
      height: true,
    })
  })

  it('moves a rotated box’s origin on both axes without calling that a resize of both', () => {
    // Rotated, a side handle holds the far edge still by moving the origin
    // along the other axis too, and a top handle moves `x` while the width
    // stays exactly what it was.
    const from = { x: 100, y: 100, width: 92, height: 36 }
    const west = settled(resizedRect(from, 'w', { x: -20, y: 0 }, DRAG, 30))
    expect(resizedBox(from, west, true)).toEqual({ x: true, y: true, width: true, height: false })
    const north = settled(resizedRect(from, 'n', { x: 0, y: -20 }, DRAG, 30))
    expect(north.width).toBe(from.width)
    expect(resizedBox(from, north, false)).toEqual({
      x: true,
      y: true,
      width: false,
      height: true,
    })
  })
})

describe('instanceResizeWrites', () => {
  /** An instance of a hugging styled component: its root is the derived VERTICAL wrapper. */
  const hugging = node({ type: 'INSTANCE', primaryAxisSizing: 'HUG', counterAxisSizing: 'HUG' })
  const ALL = { x: true, y: true, width: true, height: true }

  it('writes the width side of the box, and flips only the axis the width governs', () => {
    expect(
      instanceResizeWrites(hugging, RECT, { x: true, y: false, width: true, height: false }),
    ).toEqual({ x: 10, width: 300, counterAxisSizing: 'FIXED' })
  })

  it('writes the height side alone for a top or bottom handle', () => {
    expect(
      instanceResizeWrites(hugging, RECT, { x: false, y: true, width: false, height: true }),
    ).toEqual({ y: 20, height: 150, primaryAxisSizing: 'FIXED' })
  })

  it('writes a moved origin on both axes, whichever dimension changed', () => {
    // A rotated west handle: the held edge stays put only if y lands too.
    expect(
      instanceResizeWrites(hugging, RECT, { x: true, y: true, width: true, height: false }),
    ).toEqual({ x: 10, y: 20, width: 300, counterAxisSizing: 'FIXED' })
  })

  it('flips nothing on an axis the instance already fixes', () => {
    expect(instanceResizeWrites(node({ type: 'INSTANCE' }), RECT, ALL)).toEqual(RECT)
  })
})

describe('releasedFills', () => {
  /** In a column: a stretch fills the width, a grow the height. */
  const FILLS = { width: 'layoutAlign', height: 'layoutGrow' } as const

  it('lets go of the fill on each dimension a size is chosen for, and on no other', () => {
    expect(releasedFills(FILLS, ['width'])).toEqual({
      fields: { layoutAlignSelf: 'AUTO' },
      removals: ['layoutAlign'],
    })
    expect(releasedFills(FILLS, ['height'])).toEqual({
      fields: { layoutGrow: 0 },
      removals: ['layoutGrow'],
    })
  })

  it('has nothing to let go of on a dimension nothing fills', () => {
    expect(releasedFills({}, ['width', 'height'])).toEqual({ fields: {}, removals: [] })
  })
})
