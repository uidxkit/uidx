import type { JsonValue, UidxDocument } from './types.js'

export type LengthUnit = 'px' | 'rem'
export type LengthValue = number | string
export const DEFAULT_ROOT_FONT_SIZE = 16
export const UNITLESS_NUMBER_PROPS: ReadonlySet<string> = new Set([
  'opacity',
  'rotation',
  'cornerSmoothing',
  'layoutGrow',
  'fontWeight',
  'maxLines',
  'strokeMiterLimit',
])

/** Only distances have units. Ratios, angles, counts and font weights do not. */
export const LENGTH_PROPS: ReadonlySet<string> = new Set([
  'x',
  'y',
  'right',
  'bottom',
  'centerX',
  'centerY',
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'paddingBottom',
  'itemSpacing',
  'counterAxisSpacing',
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomLeftRadius',
  'bottomRightRadius',
  'strokeWeight',
  'strokeTopWeight',
  'strokeRightWeight',
  'strokeBottomWeight',
  'strokeLeftWeight',
  'fontSize',
  'lineHeight',
  'letterSpacing',
])

const LENGTH = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(px|rem)$/i

export function parseLength(value: unknown): { value: number; unit: LengthUnit } | null {
  if (typeof value === 'number') return Number.isFinite(value) ? { value, unit: 'px' } : null
  if (typeof value !== 'string') return null
  const match = LENGTH.exec(value.trim())
  if (!match || !Number.isFinite(Number(match[1]))) return null
  return { value: Number(match[1]), unit: match[2]!.toLowerCase() as LengthUnit }
}

export function isUnitLength(value: unknown): value is string {
  return typeof value === 'string' && parseLength(value) !== null
}

export function rootFontSizeOf(doc?: UidxDocument | null): number {
  const value = doc?.tree.attrs.rootFontSize?.value
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_ROOT_FONT_SIZE
}

export function lengthToPx(value: unknown, rootFontSize = DEFAULT_ROOT_FONT_SIZE): number | null {
  const length = parseLength(value)
  if (!length) return null
  const px = length.value * (length.unit === 'rem' ? rootFontSize : 1)
  return Number.isFinite(px) ? px : null
}

export function writeLength(value: number, unit: LengthUnit): LengthValue {
  const rounded = Number(value.toFixed(6))
  return unit === 'px' ? rounded : `${rounded}rem`
}

export function convertLength(
  value: unknown,
  unit: LengthUnit,
  rootFontSize = DEFAULT_ROOT_FONT_SIZE,
): LengthValue | null {
  const px = lengthToPx(value, rootFontSize)
  return px === null ? null : writeLength(px / (unit === 'rem' ? rootFontSize : 1), unit)
}

/** Re-express a canvas measurement in the unit the file already uses. */
export function preserveLengthUnit(
  px: number,
  authored: unknown,
  rootFontSize = DEFAULT_ROOT_FONT_SIZE,
): LengthValue {
  if (!isUnitLength(authored)) return px
  const unit = parseLength(authored)!.unit
  const converted = convertLength(px, unit, rootFontSize)!
  return unit === 'px' ? `${converted}px` : converted
}

/** Lengths nested in effects and dash patterns use the same conversion. */
export function mapLengthLeaves(
  prop: string,
  value: JsonValue,
  map: (value: JsonValue) => JsonValue,
): JsonValue {
  if (LENGTH_PROPS.has(prop)) return value === null ? value : map(value)
  if (prop === 'dashPattern' && Array.isArray(value)) return value.map(map)
  if (prop !== 'effects' || !Array.isArray(value)) return value
  return value.map((effect) => {
    if (!effect || typeof effect !== 'object' || Array.isArray(effect)) return effect
    const next = { ...effect }
    for (const key of ['radius', 'spread']) if (next[key] !== undefined) next[key] = map(next[key]!)
    const offset = next.offset
    if (offset && typeof offset === 'object' && !Array.isArray(offset)) {
      next.offset = { ...offset }
      for (const key of ['x', 'y'])
        if (offset[key] !== undefined) next.offset[key] = map(offset[key]!)
    }
    return next
  })
}

export function hasLengthUnits(prop: string, value: JsonValue): boolean {
  let found = false
  mapLengthLeaves(prop, value, (leaf) => {
    if (isUnitLength(leaf)) found = true
    return leaf
  })
  return found
}
