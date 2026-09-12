import { describe, expect, it } from 'vitest'
import { resizeWrites, sizingFlipFor } from '../src/resize-writes'

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
