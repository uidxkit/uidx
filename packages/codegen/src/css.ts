import { aliasTarget, type JsonValue, type UidxDocument } from '@uidx/format'
import { resolveTokenValues } from '@uidx/schema'

/**
 * UIDX properties as CSS (ADR 0017 §3).
 *
 * The vocabulary is Figma's (ADR 0002), so this is the same translation a
 * design-to-code plugin makes — with one difference that matters: a token
 * reference becomes a CSS custom property rather than its value, so the
 * generated stylesheet stays themeable by swapping `tokens.css`.
 */

/** `surface#accent` → `--surface-accent`; `type#label/sm` → `--type-label-sm`. */
export function cssVariable(address: string): string {
  return `--${address.replace(/[#/]/g, '-').replace(/[^A-Za-z0-9_-]/g, '')}`
}

const FONT_WEIGHTS: Record<string, number> = {
  THIN: 100,
  EXTRA_LIGHT: 200,
  LIGHT: 300,
  REGULAR: 400,
  NORMAL: 400,
  MEDIUM: 500,
  SEMI_BOLD: 600,
  SEMIBOLD: 600,
  BOLD: 700,
  EXTRA_BOLD: 800,
  BLACK: 900,
}

const ALIGN: Record<string, string> = {
  MIN: 'flex-start',
  CENTER: 'center',
  MAX: 'flex-end',
  SPACE_BETWEEN: 'space-between',
  BASELINE: 'baseline',
}

function round(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

/** A Figma colour `{ r, g, b, a }` in 0–1 as a CSS colour. */
export function cssColor(value: JsonValue): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { r, g, b, a } = value as Record<string, JsonValue>
  if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') return null
  const channel = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 255)
  const alpha = typeof a === 'number' ? a : 1
  return alpha >= 1
    ? `rgb(${channel(r)} ${channel(g)} ${channel(b)})`
    : `rgb(${channel(r)} ${channel(g)} ${channel(b)} / ${round(alpha)})`
}

/**
 * A length: a number is px, a `"1rem"` string is itself, and a token is its
 * variable scaled to px — tokens are stored unitless, and this is where the
 * unit is decided.
 */
export function cssLength(value: JsonValue): string | null {
  if (typeof value === 'number') return `${round(value)}px`
  if (typeof value !== 'string') return null
  const target = aliasTarget(value)
  if (target !== null) return `calc(var(${cssVariable(target)}) * 1px)`
  return /^-?\d+(\.\d+)?(px|rem|em|%|vw|vh)$/.test(value) ? value : null
}

/** A unitless number or a token used as one (opacity, flex-grow). */
function cssNumber(value: JsonValue): string | null {
  if (typeof value === 'number') return round(value)
  const target = typeof value === 'string' ? aliasTarget(value) : null
  return target === null ? null : `var(${cssVariable(target)})`
}

/**
 * The colour of a paint list: the first visible solid paint, or the token
 * the attribute or its entry references.
 */
export function cssPaint(value: JsonValue): string | null {
  if (typeof value === 'string') {
    const target = aliasTarget(value)
    return target === null ? null : `var(${cssVariable(target)})`
  }
  if (!Array.isArray(value)) return null
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const paint = entry as Record<string, JsonValue>
    if (paint.visible === false) continue
    if (paint.type !== 'SOLID' && paint.type !== undefined) continue
    const color = paint.color
    const target = typeof color === 'string' ? aliasTarget(color) : null
    if (target !== null) return `var(${cssVariable(target)})`
    const literal = color === undefined ? null : cssColor(color)
    if (literal) return literal
  }
  return null
}

export type CssKind = 'container' | 'text'

/**
 * The declarations for one node's attributes. `kind` decides what a fill is:
 * a frame's fill is its background, a text's fill is its colour.
 */
export function cssDeclarations(
  attrs: Record<string, JsonValue>,
  kind: CssKind,
): Record<string, string> {
  const out: Record<string, string> = {}
  const set = (prop: string, value: string | null) => {
    if (value !== null) out[prop] = value
  }
  for (const [name, value] of Object.entries(attrs)) {
    switch (name) {
      case 'fills':
        set(kind === 'text' ? 'color' : 'background-color', cssPaint(value))
        break
      case 'strokes': {
        const color = cssPaint(value)
        if (color) {
          const weight = attrs.strokeWeight === undefined ? '1px' : cssLength(attrs.strokeWeight)
          set('border', `${weight ?? '1px'} solid ${color}`)
        }
        break
      }
      case 'cornerRadius':
        set('border-radius', cssLength(value))
        break
      case 'topLeftRadius':
        set('border-top-left-radius', cssLength(value))
        break
      case 'topRightRadius':
        set('border-top-right-radius', cssLength(value))
        break
      case 'bottomRightRadius':
        set('border-bottom-right-radius', cssLength(value))
        break
      case 'bottomLeftRadius':
        set('border-bottom-left-radius', cssLength(value))
        break
      case 'width':
      case 'height':
      case 'minWidth':
      case 'maxWidth':
      case 'minHeight':
      case 'maxHeight':
        set(name.replace(/([A-Z])/g, '-$1').toLowerCase(), cssLength(value))
        break
      case 'paddingLeft':
      case 'paddingRight':
      case 'paddingTop':
      case 'paddingBottom':
        set(name.replace(/([A-Z])/g, '-$1').toLowerCase(), cssLength(value))
        break
      case 'itemSpacing':
        set('gap', cssLength(value))
        break
      case 'layoutMode':
        if (value === 'HORIZONTAL' || value === 'VERTICAL') {
          out.display = 'flex'
          out['flex-direction'] = value === 'HORIZONTAL' ? 'row' : 'column'
        }
        break
      case 'primaryAxisAlignItems':
        if (typeof value === 'string' && ALIGN[value]) out['justify-content'] = ALIGN[value]!
        break
      case 'counterAxisAlignItems':
        if (typeof value === 'string' && ALIGN[value]) out['align-items'] = ALIGN[value]!
        break
      case 'layoutGrow':
        set('flex-grow', cssNumber(value))
        break
      case 'layoutAlign':
      case 'layoutAlignSelf':
        if (value === 'STRETCH') out['align-self'] = 'stretch'
        break
      case 'opacity':
        set('opacity', cssNumber(value))
        break
      case 'visible':
        // A part hidden by the base tree and shown by a state row: the row
        // needs a display value, and inline-flex suits a part wrapping an
        // icon or a text alike.
        if (value === false) out.display = 'none'
        else if (value === true) out.display = 'inline-flex'
        break
      case 'fontSize':
        set('font-size', cssLength(value))
        break
      case 'fontFamily':
        if (typeof value === 'string')
          out['font-family'] = value.includes(' ') ? `"${value}"` : value
        break
      case 'fontWeight':
        if (typeof value === 'number') out['font-weight'] = String(value)
        else if (typeof value === 'string' && FONT_WEIGHTS[value])
          out['font-weight'] = String(FONT_WEIGHTS[value])
        else set('font-weight', cssNumber(value))
        break
      case 'lineHeight':
        set('line-height', cssLength(value))
        break
      case 'letterSpacing':
        set('letter-spacing', cssLength(value))
        break
      case 'textAlignHorizontal':
        if (value === 'LEFT' || value === 'CENTER' || value === 'RIGHT' || value === 'JUSTIFIED')
          out['text-align'] = value === 'JUSTIFIED' ? 'justify' : value.toLowerCase()
        break
      case 'rotation':
        if (typeof value === 'number' && value !== 0) out.transform = `rotate(${round(value)}deg)`
        break
      case 'effects':
        if (Array.isArray(value)) {
          const shadows: string[] = []
          for (const entry of value) {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
            const effect = entry as Record<string, JsonValue>
            if (effect.visible === false) continue
            if (effect.type !== 'DROP_SHADOW' && effect.type !== 'INNER_SHADOW') continue
            const offset = (effect.offset ?? {}) as Record<string, JsonValue>
            const color =
              effect.color === undefined ? null : cssPaint([{ type: 'SOLID', color: effect.color }])
            shadows.push(
              `${effect.type === 'INNER_SHADOW' ? 'inset ' : ''}${cssLength(offset.x ?? 0) ?? '0'} ${cssLength(offset.y ?? 0) ?? '0'} ${cssLength(effect.radius ?? 0) ?? '0'} ${cssLength(effect.spread ?? 0) ?? '0'} ${color ?? 'rgb(0 0 0 / 0.25)'}`,
            )
          }
          if (shadows.length) out['box-shadow'] = shadows.join(', ')
        }
        break
      default:
        break
    }
  }
  return out
}

/** One CSS rule, or nothing when there are no declarations. */
export function cssRule(selector: string, declarations: Record<string, string>): string {
  const entries = Object.entries(declarations)
  if (entries.length === 0) return ''
  return `${selector} {\n${entries.map(([prop, value]) => `  ${prop}: ${value};`).join('\n')}\n}\n`
}

/**
 * `tokens.css`: every token at its default mode as a custom property on
 * `:root`. Colours become CSS colours; numbers stay unitless, and the rules
 * that use them add the unit (`cssLength`), so one token serves a radius and
 * a font size alike.
 */
export function tokensCss(docs: readonly UidxDocument[]): string {
  const values = resolveTokenValues(docs)
  const lines: string[] = []
  for (const [address, value] of [...values].sort(([a], [b]) => a.localeCompare(b))) {
    const color = cssColor(value)
    const text =
      color ??
      (typeof value === 'number'
        ? round(value)
        : typeof value === 'string'
          ? value
          : typeof value === 'boolean'
            ? String(value)
            : null)
    if (text !== null) lines.push(`  ${cssVariable(address)}: ${text};`)
  }
  return lines.length ? `:root {\n${lines.join('\n')}\n}\n` : ''
}
