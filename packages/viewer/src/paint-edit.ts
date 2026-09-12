import { parseLength, isUnitLength, type LengthValue } from '@uidx/format'
import { aliasTarget, toAlias, type JsonValue, type UidxNode } from '@uidx/format'

/**
 * Pure value algebra for the structured props (story C8).
 *
 * Every function takes the current value and returns the next *whole* value;
 * nothing here knows about Vue, patches or the canvas. The components emit
 * these results as ordinary `commit`s, so the malformed-paint risk the spec
 * worried about lives here, under tests, and nowhere else.
 */

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

export interface PaintLike {
  type: string
  color?: Rgba | string
  opacity?: number
  visible?: boolean
  [k: string]: unknown
}

export interface EffectLike {
  type: string
  color: Rgba
  offset: { x: LengthValue; y: LengthValue }
  radius: LengthValue
  spread: LengthValue
  visible: boolean
  [k: string]: unknown
}

const isRgba = (v: unknown): v is Rgba =>
  typeof v === 'object' &&
  v !== null &&
  ['r', 'g', 'b', 'a'].every((k) => typeof (v as Record<string, unknown>)[k] === 'number')

/** A paint array, or null for any value this module must not touch. */
export function asPaints(value: JsonValue | null): PaintLike[] | null {
  if (!Array.isArray(value)) return null
  const ok = value.every(
    (p) =>
      typeof p === 'object' &&
      p !== null &&
      !Array.isArray(p) &&
      typeof (p as PaintLike).type === 'string',
  )
  return ok ? (value as unknown as PaintLike[]) : null
}

export function asEffects(value: JsonValue | null): EffectLike[] | null {
  if (!Array.isArray(value)) return null
  const ok = value.every((e) => {
    if (typeof e !== 'object' || e === null || Array.isArray(e)) return false
    const eff = e as Partial<EffectLike>
    return (
      typeof eff.type === 'string' &&
      isRgba(eff.color) &&
      typeof eff.offset === 'object' &&
      eff.offset !== null &&
      parseLength(eff.offset.x) !== null &&
      parseLength(eff.offset.y) !== null
    )
  })
  return ok ? (value as unknown as EffectLike[]) : null
}

/** New array; entry `index` replaced by `patch(entry)`, everything else by reference. */
function replaceAt<T>(list: readonly T[], index: number, patch: (entry: T) => T): T[] {
  return list.map((entry, i) => (i === index ? patch(entry) : entry))
}

export function setPaintColor(paints: readonly PaintLike[], index: number, color: Rgba): JsonValue {
  return replaceAt(paints, index, (p) => ({ ...p, color })) as unknown as JsonValue
}

/** The token a paint's color reads, or null when it holds a literal. */
export function paintColorAlias(paint: PaintLike): string | null {
  return typeof paint.color === 'string' ? aliasTarget(paint.color) : null
}

/** A paint's color as Rgba — resolving an alias through the tokens map. */
export function paintRgba(paint: PaintLike, tokens?: ReadonlyMap<string, JsonValue>): Rgba | null {
  if (typeof paint.color === 'string') {
    const target = aliasTarget(paint.color)
    const resolved = target ? tokens?.get(target) : undefined
    return isRgba(resolved) ? resolved : null
  }
  return paint.color ?? null
}

/** Point one paint's color at a variable. */
export function setPaintColorAlias(
  paints: readonly PaintLike[],
  index: number,
  token: string,
): JsonValue {
  return paints.map((p, i) =>
    i === index ? { ...p, color: toAlias(token) } : p,
  ) as unknown as JsonValue
}

export function setPaintOpacity(
  paints: readonly PaintLike[],
  index: number,
  opacity: number,
): JsonValue {
  return replaceAt(paints, index, (p) => ({ ...p, opacity })) as unknown as JsonValue
}

export function togglePaintVisible(paints: readonly PaintLike[], index: number): JsonValue {
  return replaceAt(paints, index, (p) => ({
    ...p,
    visible: !(p.visible ?? true),
  })) as unknown as JsonValue
}

export function removePaint(paints: readonly PaintLike[], index: number): JsonValue {
  return paints.filter((_, i) => i !== index) as unknown as JsonValue
}

/** Figma's default: a mid-grey solid. Also the `+`'s first paint on a bare node. */
export function addSolidPaint(paints: readonly PaintLike[] | null): JsonValue {
  const fresh: PaintLike = {
    type: 'SOLID',
    color: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    opacity: 1,
    visible: true,
  }
  return [...(paints ?? []), fresh] as unknown as JsonValue
}

export function setEffectField(
  effects: readonly EffectLike[],
  index: number,
  field: 'x' | 'y' | 'radius' | 'spread',
  value: LengthValue,
): JsonValue {
  return replaceAt(effects, index, (e) =>
    field === 'x' || field === 'y'
      ? { ...e, offset: { ...e.offset, [field]: value } }
      : { ...e, [field]: value },
  ) as unknown as JsonValue
}

export function setEffectColor(
  effects: readonly EffectLike[],
  index: number,
  color: Rgba,
): JsonValue {
  return replaceAt(effects, index, (e) => ({ ...e, color })) as unknown as JsonValue
}

export function setEffectType(
  effects: readonly EffectLike[],
  index: number,
  type: string,
): JsonValue {
  return replaceAt(effects, index, (e) => ({ ...e, type })) as unknown as JsonValue
}

export function toggleEffectVisible(effects: readonly EffectLike[], index: number): JsonValue {
  return replaceAt(effects, index, (e) => ({ ...e, visible: !e.visible })) as unknown as JsonValue
}

export function removeEffect(effects: readonly EffectLike[], index: number): JsonValue {
  return effects.filter((_, i) => i !== index) as unknown as JsonValue
}

/** Figma's default effect: a soft drop shadow. */
export function addEffect(effects: readonly EffectLike[] | null): JsonValue {
  const fresh: EffectLike = {
    type: 'DROP_SHADOW',
    color: { r: 0, g: 0, b: 0, a: 0.25 },
    offset: { x: 0, y: 4 },
    radius: 4,
    spread: 0,
    visible: true,
  }
  return [...(effects ?? []), fresh] as unknown as JsonValue
}

/**
 * `null` means "refuse without writing" — the field paints red the way a
 * refused rename does, and the file never sees the garbage.
 */
export function parseDashPattern(text: string): LengthValue[] | null {
  const parts = text.split(',').map((p) => p.trim())
  if (parts.length === 0 || parts.some((p) => p === '')) return null
  const numbers = parts.map((part) => (isUnitLength(part) ? part : Number(part)))
  if (numbers.some((n) => !parseLength(n) || parseLength(n)!.value < 0)) return null
  return numbers
}

export function formatDashPattern(value: JsonValue | null): string {
  if (!Array.isArray(value)) return ''
  return value.join(', ')
}

const toByte = (f: number): string =>
  Math.round(Math.min(1, Math.max(0, f)) * 255)
    .toString(16)
    .padStart(2, '0')

export function colorToHex(color: Rgba): string {
  return `#${toByte(color.r)}${toByte(color.g)}${toByte(color.b)}`
}

export function hexToColor(hex: string, a: number): Rgba | null {
  const clean = hex.replace(/^#/, '').toLowerCase()
  const long = clean.length === 3 ? [...clean].map((c) => c + c).join('') : clean
  if (!/^[0-9a-f]{6}$/.test(long)) return null
  const byte = (i: number): number => parseInt(long.slice(i, i + 2), 16) / 255
  return { r: byte(0), g: byte(2), b: byte(4), a }
}

/** What a swatch paints: the colour with the paint's own opacity folded in. */
export function cssColor(color: Rgba, opacity = 1): string {
  const c = (f: number): number => Math.round(f * 255)
  return `rgba(${c(color.r)}, ${c(color.g)}, ${c(color.b)}, ${color.a * opacity})`
}

export interface Hsv {
  h: number
  s: number
  v: number
}

export function rgbToHsv(color: Rgba): Hsv {
  const { r, g, b } = color
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6)
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
  }
  if (h < 0) h += 360
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

export function hsvToRgb(hsv: Hsv, a: number): Rgba {
  const { h, s, v } = hsv
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  return { r: r + m, g: g + m, b: b + m, a }
}

/** Figma's "on this page": every distinct solid the document already uses. */
export function documentSwatches(root: UidxNode): Rgba[] {
  const seen = new Set<string>()
  const out: Rgba[] = []
  const visit = (node: UidxNode): void => {
    for (const prop of ['fills', 'strokes'] as const) {
      const paints = asPaints((node.attrs[prop]?.value as JsonValue) ?? null) ?? []
      for (const paint of paints) {
        if (paint.type !== 'SOLID' || !paint.color || typeof paint.color === 'string') continue
        const key = JSON.stringify(paint.color)
        if (seen.has(key) || out.length >= 24) continue
        seen.add(key)
        out.push(paint.color)
      }
    }
    node.children.forEach(visit)
  }
  visit(root)
  return out
}
