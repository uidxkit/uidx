import { describe, expect, it } from 'vitest'
import { resolvedBox, type Pin } from '@uidx/schema'
import { pinWrites } from '../src/pin-writes'

const PARENT = { width: 320, height: 200 }
const BOX = { x: 264, y: 16, width: 40, height: 20 }
const pin = (over: Partial<Pin> = {}): Pin => ({ horizontal: 'MIN', vertical: 'MIN', ...over })

describe('pinWrites', () => {
  it('writes x under MIN, and takes the far offsets out', () => {
    const out = pinWrites(pin(), BOX, PARENT)
    expect(out.fields).toEqual({ x: 264, y: 16 })
    expect([...out.removals].sort()).toEqual(['bottom', 'centerX', 'centerY', 'right'])
  })

  it('writes the far offset under MAX, and takes x out', () => {
    const out = pinWrites(pin({ horizontal: 'MAX' }), BOX, PARENT)
    // 320 − 264 − 40 = 16
    expect(out.fields.right).toBe(16)
    expect(out.fields.x).toBeUndefined()
    expect(out.removals).toContain('x')
  })

  it('writes both offsets under STRETCH, and takes the size out', () => {
    const out = pinWrites(pin({ horizontal: 'STRETCH' }), { ...BOX, x: 16, width: 288 }, PARENT)
    expect(out.fields.x).toBe(16)
    expect(out.fields.right).toBe(16)
    expect(out.removals).toContain('width')
  })

  it('writes the delta from the parent centre under CENTER', () => {
    // The box's centre is 264 + 20 = 284; the parent's is 160, so +124.
    const out = pinWrites(pin({ horizontal: 'CENTER' }), BOX, PARENT)
    expect(out.fields.centerX).toBe(124)
    expect(out.removals).toContain('x')
    expect(out.removals).toContain('right')
  })

  it('converts the two axes independently', () => {
    const out = pinWrites(pin({ horizontal: 'MAX', vertical: 'STRETCH' }), BOX, PARENT)
    expect(out.fields).toEqual({ right: 16, y: 16, bottom: 164 }) // 200 − 16 − 20
    expect([...out.removals].sort()).toEqual(['centerX', 'centerY', 'height', 'x'])
  })

  it('rounds, because a converted offset is a number a person then reads', () => {
    const out = pinWrites(pin({ horizontal: 'CENTER' }), { ...BOX, x: 139.5 }, PARENT)
    expect(Number.isInteger(out.fields.centerX)).toBe(true)
  })

  it('round-trips against resolvedBox, which is the invariant that matters', () => {
    // Convert the box to offsets, resolve those offsets back, and land in the
    // same place. If this fails, a pin gesture moves the node it was meant to
    // leave alone — which is the whole failure mode the conversion exists to
    // prevent.
    for (const horizontal of ['MIN', 'CENTER', 'MAX', 'STRETCH'] as const) {
      const chosen = pin({ horizontal })
      const written = pinWrites(chosen, BOX, PARENT)
      const authored = {
        x: written.fields.x ?? 0,
        y: written.fields.y ?? 0,
        width: BOX.width,
        height: BOX.height,
      }
      const back = resolvedBox({ ...chosen, ...written.fields }, authored, PARENT)
      expect(back.x).toBeCloseTo(BOX.x, 0)
    }
  })
})
