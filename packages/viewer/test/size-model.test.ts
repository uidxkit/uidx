import { describe, expect, it } from 'vitest'
import { sizingPropFor, textResizeWrite, textSizingFor } from '../src/size-model'

describe('sizingPropFor', () => {
  it('follows the primary axis of a horizontal frame', () => {
    expect(sizingPropFor('HORIZONTAL', 'width')).toBe('primaryAxisSizingMode')
    expect(sizingPropFor('HORIZONTAL', 'height')).toBe('counterAxisSizingMode')
  })

  it('transposes for a vertical frame', () => {
    expect(sizingPropFor('VERTICAL', 'width')).toBe('counterAxisSizingMode')
    expect(sizingPropFor('VERTICAL', 'height')).toBe('primaryAxisSizingMode')
  })

  it('treats everything else as vertical, the SDK default', () => {
    expect(sizingPropFor('NONE', 'width')).toBe('counterAxisSizingMode')
    expect(sizingPropFor('GRID', 'height')).toBe('primaryAxisSizingMode')
  })
})

describe('textSizingFor', () => {
  it('reads each axis out of the one prop that states both', () => {
    expect(textSizingFor('WIDTH_AND_HEIGHT', 'width')).toBe('AUTO')
    expect(textSizingFor('WIDTH_AND_HEIGHT', 'height')).toBe('AUTO')
    expect(textSizingFor('HEIGHT', 'width')).toBe('FIXED')
    expect(textSizingFor('HEIGHT', 'height')).toBe('AUTO')
    expect(textSizingFor('NONE', 'width')).toBe('FIXED')
    expect(textSizingFor('NONE', 'height')).toBe('FIXED')
  })

  /** The legacy fixed-and-ellipsises value; `textTruncation` carries that now. */
  it('reads TRUNCATE as fixed on both axes', () => {
    expect(textSizingFor('TRUNCATE', 'width')).toBe('FIXED')
    expect(textSizingFor('TRUNCATE', 'height')).toBe('FIXED')
  })
})

describe('textResizeWrite', () => {
  it('hugs both axes when the width is set to hug, the only mode that spells it', () => {
    expect(textResizeWrite('NONE', 'width', 'AUTO')).toBe('WIDTH_AND_HEIGHT')
    expect(textResizeWrite('HEIGHT', 'width', 'AUTO')).toBe('WIDTH_AND_HEIGHT')
  })

  /**
   * The same answers `resize-writes.ts` gives a typed number and a dragged
   * handle — a fixed width leaves the height hugging, and a fixed height
   * takes the width's hug with it, because auto-width implies auto-height.
   */
  it('agrees with the gesture path about what fixing one axis leaves', () => {
    expect(textResizeWrite('WIDTH_AND_HEIGHT', 'width', 'FIXED')).toBe('HEIGHT')
    expect(textResizeWrite('WIDTH_AND_HEIGHT', 'height', 'FIXED')).toBe('NONE')
    expect(textResizeWrite('HEIGHT', 'height', 'FIXED')).toBe('NONE')
  })

  it('hugs the height alone from a fixed box', () => {
    expect(textResizeWrite('NONE', 'height', 'AUTO')).toBe('HEIGHT')
  })

  it('never writes the legacy TRUNCATE back', () => {
    const every = (['width', 'height'] as const).flatMap((d) =>
      (['FIXED', 'AUTO'] as const).map((m) => textResizeWrite('TRUNCATE', d, m)),
    )
    expect(every).not.toContain('TRUNCATE')
  })
})
