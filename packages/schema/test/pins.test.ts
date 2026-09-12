import { describe, expect, it } from 'vitest'
import { pinFrom, resolvedBox, type Pin } from '../src/pins.js'

const PARENT = { width: 320, height: 200 }
const BOX = { x: 0, y: 0, width: 40, height: 20 }
const pin = (over: Partial<Pin> = {}): Pin => ({ horizontal: 'MIN', vertical: 'MIN', ...over })

describe('resolvedBox', () => {
  it('leaves a MIN/MIN child exactly where it was authored', () => {
    expect(resolvedBox(pin(), { ...BOX, x: 16, y: 24 }, PARENT)).toEqual({
      x: 16,
      y: 24,
      width: 40,
      height: 20,
    })
  })

  it('measures a MAX child from the far edge', () => {
    // 320 − 16 − 40 = 264
    expect(resolvedBox(pin({ horizontal: 'MAX', right: 16 }), BOX, PARENT).x).toBe(264)
  })

  it('treats a missing offset as zero', () => {
    expect(resolvedBox(pin({ horizontal: 'MAX' }), BOX, PARENT).x).toBe(280)
  })

  it('stretches between both edges, deriving the width', () => {
    const out = resolvedBox(pin({ horizontal: 'STRETCH', right: 8 }), { ...BOX, x: 16 }, PARENT)
    expect(out.x).toBe(16)
    expect(out.width).toBe(296) // 320 − 16 − 8
  })

  it('centres, and takes centerX as a delta from the parent centre', () => {
    expect(resolvedBox(pin({ horizontal: 'CENTER' }), BOX, PARENT).x).toBe(140)
    expect(resolvedBox(pin({ horizontal: 'CENTER', centerX: 10 }), BOX, PARENT).x).toBe(150)
  })

  it('resolves the two axes independently', () => {
    const out = resolvedBox(
      pin({ horizontal: 'MAX', right: 16, vertical: 'STRETCH', bottom: 4 }),
      { ...BOX, y: 6 },
      PARENT,
    )
    expect(out).toEqual({ x: 264, y: 6, width: 40, height: 190 }) // 200 − 6 − 4
  })

  it('never produces a negative size — a parent narrower than its offsets clamps at zero', () => {
    // The renderer draws a negative box inside-out, so the clamp is not
    // cosmetic: it is the difference between a child that disappears and one
    // that draws over its own parent.
    const out = resolvedBox(pin({ horizontal: 'STRETCH', right: 400 }), { ...BOX, x: 0 }, PARENT)
    expect(out.width).toBe(0)
  })
})

describe('pinFrom', () => {
  it('is undefined for a node that states no pin', () => {
    expect(pinFrom({ x: { value: 16 } })).toBeUndefined()
  })

  it('reads the constraint pair and the offsets', () => {
    expect(
      pinFrom({
        constraints: { value: { horizontal: 'MAX', vertical: 'MIN' } },
        right: { value: 16 },
      }),
    ).toEqual({ horizontal: 'MAX', vertical: 'MIN', right: 16 })
  })

  it('is a pin when only an offset is stated, so the checker can still be right about it', () => {
    // MIN plus a `right` is exactly the file UIDX134 refuses. Answering
    // "unpinned" here would make the resolver agree with a file the checker
    // calls wrong.
    expect(pinFrom({ right: { value: 16 } })).toEqual({
      horizontal: 'MIN',
      vertical: 'MIN',
      right: 16,
    })
  })

  it('falls back to MIN for a constraint value it does not recognise', () => {
    expect(
      pinFrom({ constraints: { value: { horizontal: 'SCALE' } }, right: { value: 4 } }),
    ).toEqual({ horizontal: 'MIN', vertical: 'MIN', right: 4 })
  })
})
