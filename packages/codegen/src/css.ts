import { aliasTarget, type JsonValue, type UidxDocument } from '@uidx/format'
import { buildTokenIndex, defaultTuple, mergeModes, TokenResolver } from '@uidx/schema'
import { INSTANCE_BOX_HOOKS } from '@uidx/schema/design-system'
import { INSTANCE_CASCADE_PROPS } from '@uidx/schema/instance-box'

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
export function cssNumber(value: JsonValue): string | null {
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

export type CssKind = 'container' | 'text' | 'vector'

/**
 * `base`: a node's whole look, as its resting rule states it. `row`: only
 * what a styles-table row states, laid over that rule — so a row that
 * changes a stroke's colour keeps the weight the base gave it.
 */
export type CssMode = 'base' | 'row'

const STROKE_SIDES = [
  ['top', 'strokeTopWeight'],
  ['right', 'strokeRightWeight'],
  ['bottom', 'strokeBottomWeight'],
  ['left', 'strokeLeftWeight'],
] as const

const CORNERS = [
  ['top-left', 'topLeftRadius'],
  ['top-right', 'topRightRadius'],
  ['bottom-right', 'bottomRightRadius'],
  ['bottom-left', 'bottomLeftRadius'],
] as const

/** A dash pattern with dashes in it draws dashed; an empty one is solid. */
function borderStyle(dashPattern: JsonValue | undefined): string {
  return Array.isArray(dashPattern) && dashPattern.length > 0 ? 'dashed' : 'solid'
}

/**
 * The border widths a node states: the uniform weight, then each side that
 * has its own — longhands after the shorthand, so a side wins as the canvas
 * draws it. In `base` mode a stroke with no weight draws at Figma's 1.
 */
function borderWidths(
  attrs: Record<string, JsonValue>,
  mode: CssMode,
  out: Record<string, string>,
): void {
  const uniform = attrs.strokeWeight === undefined ? null : cssLength(attrs.strokeWeight)
  if (uniform !== null || mode === 'base') out['border-width'] = uniform ?? '1px'
  for (const [side, prop] of STROKE_SIDES) {
    const weight = attrs[prop] === undefined ? null : cssLength(attrs[prop]!)
    if (weight !== null) out[`border-${side}-width`] = weight
  }
}

/**
 * Whether an auto-layout frame sizes `axis` to its content (Figma's Hug). The
 * primary axis is the layout's direction, the counter axis the other one; a
 * frame with no sizing mode on an axis but no number either hugs it too.
 */
function hugs(attrs: Record<string, JsonValue>, axis: 'width' | 'height'): boolean {
  const mode = attrs.layoutMode
  if (mode !== 'HORIZONTAL' && mode !== 'VERTICAL') return false
  const primary = (mode === 'HORIZONTAL') === (axis === 'width')
  const sizing = primary ? attrs.primaryAxisSizingMode : attrs.counterAxisSizingMode
  return sizing === 'AUTO' || (sizing === undefined && attrs[axis] === undefined)
}

/**
 * The declarations for one node's attributes. `kind` decides what a fill is:
 * a frame's fill is its background, a text's fill is its colour. A vector's
 * paths paint with `currentColor`, so its fill — or, when it is only
 * outlined, its stroke — is its colour, never a box border.
 *
 * A border is written as longhands — width, style, colour — rather than the
 * `border` shorthand, so a row that states only a colour (`mode: 'row'`)
 * changes only the colour, and so each part can read its own hook (ADR 0018
 * §6).
 */
export function cssDeclarations(
  attrs: Record<string, JsonValue>,
  kind: CssKind,
  mode: CssMode = 'base',
): Record<string, string> {
  const out: Record<string, string> = {}
  const set = (prop: string, value: string | null) => {
    if (value !== null) out[prop] = value
  }
  // Written once, at the first attribute that bears on it.
  let widths = false
  for (const [name, value] of Object.entries(attrs)) {
    switch (name) {
      case 'fills':
        set(kind === 'container' ? 'background-color' : 'color', cssPaint(value))
        break
      case 'strokes': {
        const color = cssPaint(value)
        if (kind === 'vector') {
          if (cssPaint(attrs.fills ?? null) === null) set('color', color)
          break
        }
        if (color) {
          if (mode === 'base' && !widths) {
            borderWidths(attrs, mode, out)
            widths = true
          }
          out['border-style'] = borderStyle(attrs.dashPattern)
          out['border-color'] = color
        }
        break
      }
      // A row may change the weight or the dashes alone; a base draws them
      // only with a stroke, above.
      case 'strokeWeight':
      case 'strokeTopWeight':
      case 'strokeRightWeight':
      case 'strokeBottomWeight':
      case 'strokeLeftWeight':
        if (mode === 'row' && kind !== 'vector' && !widths) {
          borderWidths(attrs, mode, out)
          widths = true
        }
        break
      case 'dashPattern':
        if (mode === 'row' && kind !== 'vector') out['border-style'] = borderStyle(value)
        break
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
        // An axis that hugs is sized by its content; the number stored beside
        // it is only what the content measured when it was drawn.
        if (!hugs(attrs, name)) set(name, cssLength(value))
        break
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
          // A frame that hugs its width sizes to its content, as the canvas
          // draws it; a block-level flex box would stretch to its container.
          out.display = hugs(attrs, 'width') ? 'inline-flex' : 'flex'
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

/* --------------------------------------------------------- the instance box */

/**
 * The instance attribute whose hook each box declaration reads (ADR 0018
 * §6), then the shorthand's: a side or a corner falls back to the uniform
 * hook before the component's own value, which is §5's rule that a use's
 * `cornerRadius` replaces the component's corners.
 */
const BOX_READS: Readonly<Record<string, readonly string[]>> = {
  'background-color': ['fills'],
  ...Object.fromEntries(
    STROKE_SIDES.map(([side, prop]) => [`border-${side}-width`, [prop, 'strokeWeight']]),
  ),
  'border-style': ['dashPattern'],
  'border-color': ['strokes'],
  ...Object.fromEntries(
    CORNERS.map(([corner, prop]) => [`border-${corner}-radius`, [prop, 'cornerRadius']]),
  ),
  'padding-top': ['paddingTop'],
  'padding-right': ['paddingRight'],
  'padding-bottom': ['paddingBottom'],
  'padding-left': ['paddingLeft'],
  opacity: ['opacity'],
  'box-shadow': ['effects'],
}

/**
 * `value` read through the hook its property takes:
 * `var(--uidx-radius-top-left, var(--uidx-radius, 999px))`. A property no use
 * can set is returned as it is.
 */
export function boxDeclaration(cssProp: string, value: string): string {
  const reads = BOX_READS[cssProp] ?? []
  return reads.reduceRight(
    (fallback, prop) => `var(${INSTANCE_BOX_HOOKS[prop]}, ${fallback})`,
    value,
  )
}

/**
 * A box node's declarations, each read through its hook. The `border-width`
 * and `border-radius` shorthands become their longhands, since each side and
 * corner has a hook of its own.
 *
 * `fallbacks`, for a resting rule, adds every box property the node leaves
 * unset at the value CSS draws without it (`boxFallbacks`), so a use can set
 * a hook the component never wrote.
 */
export function withBoxHooks(
  declarations: Record<string, string>,
  fallbacks?: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  const read = (prop: string, value: string) => {
    out[prop] = boxDeclaration(prop, value)
  }
  for (const [prop, value] of Object.entries(declarations)) {
    if (prop === 'border-width')
      for (const [side] of STROKE_SIDES) read(`border-${side}-width`, value)
    else if (prop === 'border-radius')
      for (const [corner] of CORNERS) read(`border-${corner}-radius`, value)
    else read(prop, value)
  }
  for (const [prop, value] of Object.entries(fallbacks ?? {})) if (!(prop in out)) read(prop, value)
  return out
}

/**
 * What a box draws for each property it leaves unset: nothing. Except the
 * border width, which is the weight a stroke would draw at — the node's
 * own, or Figma's 1 — so a use that adds only a stroke gets the border the
 * canvas draws; with no stroke the style is `none` and the width moot.
 *
 * Padding only where the box lays out, as the canvas draws it (`laysOut`):
 * anywhere else a use's padding does nothing on the canvas, and UIDX155 says
 * so (ADR 0018 §6).
 */
export function boxFallbacks(
  attrs: Record<string, JsonValue>,
  laysOut: boolean,
): Record<string, string> {
  const weight = (attrs.strokeWeight === undefined ? null : cssLength(attrs.strokeWeight)) ?? '1px'
  const out: Record<string, string> = { 'background-color': 'transparent' }
  for (const [side, prop] of STROKE_SIDES)
    out[`border-${side}-width`] =
      (attrs[prop] === undefined ? null : cssLength(attrs[prop]!)) ?? weight
  out['border-style'] = 'none'
  out['border-color'] = 'transparent'
  for (const [corner] of CORNERS) out[`border-${corner}-radius`] = '0px'
  if (laysOut) for (const side of ['top', 'right', 'bottom', 'left']) out[`padding-${side}`] = '0px'
  out.opacity = '1'
  out['box-shadow'] = 'none'
  return out
}

/**
 * Every box hook set to `initial`, for a component's root: a hook set on an
 * outer component then stops at this one, whose own box is its own use's to
 * style. `--uidx-text-color` is left out — it inherits, which is the cascade
 * (ADR 0018 §4).
 */
export const BOX_HOOK_RESETS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(INSTANCE_BOX_HOOKS)
    .filter(([prop]) => !INSTANCE_CASCADE_PROPS.includes(prop))
    .map(([, hook]) => [hook, 'initial']),
)

/**
 * A text's colour read through `--uidx-text-color`, over the colour it states.
 * A text that states none takes the hook alone, which is no colour at all
 * until a use sets one, so it inherits as it did.
 */
export function textColor(own: string | undefined): string {
  const hook = INSTANCE_BOX_HOOKS.textFills!
  return own === undefined ? `var(${hook})` : `var(${hook}, ${own})`
}

/**
 * `tokens.css`: every token at its default mode as a custom property on
 * `:root`. Colours become CSS colours; numbers stay unitless, and the rules
 * that use them add the unit (`cssLength`), so one token serves a radius and
 * a font size alike.
 */
function tokenText(value: JsonValue): string | null {
  const color = cssColor(value)
  if (color !== null) return color
  if (typeof value === 'number') return round(value)
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return String(value)
  return null
}

function tokenBlock(selector: string, values: Map<string, string>): string {
  const lines = [...values]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([address, text]) => `  ${cssVariable(address)}: ${text};`)
  return lines.length ? `${selector} {\n${lines.join('\n')}\n}\n` : ''
}

/**
 * Every token as a custom property: the default modes on `:root`, then one
 * block per other mode of each collection — `[data-color="dark"]` — holding
 * only the variables that mode changes. Setting the attribute on any element
 * (usually `<html>`) switches that subtree, the way a frame's mode selection
 * does on the canvas.
 */
export function tokensCss(docs: readonly UidxDocument[]): string {
  const index = buildTokenIndex(docs)
  const resolver = new TokenResolver(index)
  const base = defaultTuple(index)
  const texts = (tuple: typeof base) => {
    const out = new Map<string, string>()
    for (const [address, value] of resolver.resolve(tuple)) {
      const text = tokenText(value)
      if (text !== null) out.set(address, text)
    }
    return out
  }
  const defaults = texts(base)
  const blocks = [tokenBlock(':root', defaults)]
  for (const [collection, info] of index.collections) {
    for (const mode of info.modes.slice(1)) {
      const changed = new Map<string, string>()
      for (const [address, text] of texts(mergeModes(base, { [collection]: mode }, index))) {
        if (defaults.get(address) !== text) changed.set(address, text)
      }
      const name = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '-')
      blocks.push(tokenBlock(`[data-${name(collection)}="${mode.replace(/"/g, '')}"]`, changed))
    }
  }
  return blocks.filter(Boolean).join('\n')
}
