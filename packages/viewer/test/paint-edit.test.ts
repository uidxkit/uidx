import { describe, expect, it } from 'vitest'
import { parseOrThrow, type JsonValue, type UidxNode } from '@uidx/format'
import {
  addEffect,
  addSolidPaint,
  asEffects,
  asPaints,
  colorToHex,
  cssColor,
  documentSwatches,
  formatDashPattern,
  hexToColor,
  hsvToRgb,
  paintColorAlias,
  paintRgba,
  parseDashPattern,
  removePaint,
  rgbToHsv,
  setEffectField,
  setPaintColor,
  setPaintColorAlias,
  setPaintOpacity,
  togglePaintVisible,
} from '../src/paint-edit'

const RED = { r: 1, g: 0, b: 0, a: 1 }
const SOLID = { type: 'SOLID', color: RED }
const GRADIENT = { type: 'GRADIENT_LINEAR', gradientStops: [] }

describe('asPaints', () => {
  it('accepts a paint array and refuses anything else', () => {
    expect(asPaints([SOLID])).toEqual([SOLID])
    expect(asPaints(null)).toBeNull()
    expect(asPaints('nope')).toBeNull()
    expect(asPaints([{ noType: true }])).toBeNull()
  })
})

describe('paint edits', () => {
  it('recolours one paint and carries the rest untouched', () => {
    const blue = { r: 0, g: 0, b: 1, a: 1 }
    const next = setPaintColor([SOLID, GRADIENT], 0, blue) as unknown[]
    expect(next[0]).toEqual({ type: 'SOLID', color: blue })
    expect(next[1]).toBe(GRADIENT) // by reference — gradients pass through byte-identical
  })

  it('leaves the stack alone for an out-of-range index', () => {
    expect(setPaintColor([SOLID], 5, RED)).toEqual([SOLID])
  })

  it('toggles visibility, defaulting an omitted visible to true first', () => {
    const next = togglePaintVisible([SOLID], 0) as Array<Record<string, unknown>>
    expect(next[0]!.visible).toBe(false)
    const back = togglePaintVisible(next as never, 0) as Array<Record<string, unknown>>
    expect(back[0]!.visible).toBe(true)
  })

  it('removes a paint', () => {
    expect(removePaint([SOLID, GRADIENT], 0)).toEqual([GRADIENT])
  })

  it('appends the Figma default solid, and creates the first from nothing', () => {
    expect((addSolidPaint([SOLID]) as unknown[]).length).toBe(2)
    expect(addSolidPaint(null)).toEqual([
      { type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5, a: 1 }, opacity: 1, visible: true },
    ])
  })

  it('sets per-paint opacity', () => {
    const next = setPaintOpacity([SOLID], 0, 0.4) as Array<Record<string, unknown>>
    expect(next[0]!.opacity).toBe(0.4)
  })
})

describe('effect edits', () => {
  const SHADOW = {
    type: 'DROP_SHADOW',
    color: { r: 0, g: 0, b: 0, a: 0.25 },
    offset: { x: 0, y: 4 },
    radius: 4,
    spread: 0,
    visible: true,
  }

  it('accepts an effect array and refuses junk', () => {
    expect(asEffects([SHADOW])).toEqual([SHADOW])
    expect(asEffects([{ type: 'DROP_SHADOW' }])).toBeNull() // no color/offset
  })

  it('writes offset fields into offset and scalars beside it', () => {
    const moved = setEffectField([SHADOW], 0, 'x', 8) as Array<Record<string, { x: number }>>
    expect(moved[0]!.offset!.x).toBe(8)
    const blurred = setEffectField([SHADOW], 0, 'radius', 10) as Array<Record<string, unknown>>
    expect(blurred[0]!.radius).toBe(10)
  })

  it('creates the first effect as Figma’s default shadow', () => {
    expect(addEffect(null)).toEqual([SHADOW])
  })
})

describe('dash patterns', () => {
  it('parses comma-separated numbers with sloppy spacing', () => {
    expect(parseDashPattern(' 4, 2 ,1 ')).toEqual([4, 2, 1])
  })

  it('refuses garbage, negatives and empties without writing', () => {
    expect(parseDashPattern('4, banana')).toBeNull()
    expect(parseDashPattern('-1')).toBeNull()
    expect(parseDashPattern('')).toBeNull()
  })

  it('formats back to the field text', () => {
    expect(formatDashPattern([4, 2])).toBe('4, 2')
    expect(formatDashPattern(null)).toBe('')
  })
})

describe('colours', () => {
  it('round-trips hex', () => {
    expect(colorToHex(RED)).toBe('#ff0000')
    expect(hexToColor('#ff0000', 1)).toEqual(RED)
    expect(hexToColor('0f0', 0.5)).toEqual({ r: 0, g: 1, b: 0, a: 0.5 })
    expect(hexToColor('nope', 1)).toBeNull()
  })

  it('renders a swatch colour with paint opacity folded in', () => {
    expect(cssColor(RED, 0.5)).toBe('rgba(255, 0, 0, 0.5)')
  })
})

describe('colour math (C9)', () => {
  it('round-trips rgb through hsv', () => {
    for (const c of [
      { r: 1, g: 0, b: 0, a: 1 },
      { r: 0.2, g: 0.4, b: 0.8, a: 0.5 },
      { r: 0, g: 0, b: 0, a: 1 },
      { r: 1, g: 1, b: 1, a: 1 },
    ]) {
      const back = hsvToRgb(rgbToHsv(c), c.a)
      expect(back.r).toBeCloseTo(c.r, 5)
      expect(back.g).toBeCloseTo(c.g, 5)
      expect(back.b).toBeCloseTo(c.b, 5)
      expect(back.a).toBe(c.a)
    }
  })

  it('maps the corners of the SV square', () => {
    expect(hsvToRgb({ h: 0, s: 1, v: 1 }, 1)).toEqual({ r: 1, g: 0, b: 0, a: 1 })
    expect(hsvToRgb({ h: 0, s: 0, v: 1 }, 1)).toEqual({ r: 1, g: 1, b: 1, a: 1 })
    expect(hsvToRgb({ h: 0, s: 1, v: 0 }, 1)).toEqual({ r: 0, g: 0, b: 0, a: 1 })
  })
})

describe('documentSwatches (C9)', () => {
  it('collects distinct solid colours in first-seen order', () => {
    const doc = parseOrThrow(`---
id: sw
---

## Visual Contract

<Page>
  <Frame name="a" fills={[{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }]}>
    <Text name="t" characters="x" fills={[{ type: 'SOLID', color: { r: 0, g: 1, b: 0, a: 1 } }]} />
    <Rectangle name="r" fills={[{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }]} />
  </Frame>
</Page>
`)
    const tree: UidxNode = doc.tree
    expect(documentSwatches(tree)).toEqual([
      { r: 1, g: 0, b: 0, a: 1 },
      { r: 0, g: 1, b: 0, a: 1 },
    ])
  })
})

describe('alias-aware paints', () => {
  const tokens = new Map<string, JsonValue>([['palette#blue', { r: 0.1, g: 0.4, b: 0.9, a: 1 }]])
  const aliased = { type: 'SOLID', color: '{palette#blue}' }
  const literal = { type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }

  it('reads the alias out of a paint, and only an alias', () => {
    expect(paintColorAlias(aliased)).toBe('palette#blue')
    expect(paintColorAlias(literal)).toBeNull()
  })

  it('resolves to Rgba through the tokens map', () => {
    expect(paintRgba(aliased, tokens)).toEqual({ r: 0.1, g: 0.4, b: 0.9, a: 1 })
    expect(paintRgba(aliased, new Map())).toBeNull()
    expect(paintRgba(literal)).toEqual({ r: 1, g: 0, b: 0, a: 1 })
  })

  it('writes an alias into one paint and leaves the others', () => {
    const next = setPaintColorAlias([literal, aliased], 0, 'palette#blue') as {
      color: unknown
    }[]
    expect(next[0]!.color).toBe('{palette#blue}')
    expect(next[1]!.color).toBe('{palette#blue}')
  })

  // The spec §4 preservation pin: every fill write goes through this file's
  // whole-value algebra, so a sibling edit spreading the paint keeps the alias.
  it('sibling paint edits leave a color alias in place', () => {
    const paints = [aliased]
    expect((setPaintOpacity(paints, 0, 0.5) as { color: unknown }[])[0]!.color).toBe(
      '{palette#blue}',
    )
    expect((togglePaintVisible(paints, 0) as { color: unknown }[])[0]!.color).toBe('{palette#blue}')
  })
})
