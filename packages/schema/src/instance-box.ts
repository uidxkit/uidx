import {
  aliasTarget,
  propertyBinding,
  type JsonValue,
  type UidxAttr,
  type UidxNode,
} from '@uidx/format'

import { repeatOf, synthAttr } from './design-system.js'
import { INSTANCE_CASCADE_PROPS, KNOWN_PROPS, STRUCTURAL_PROPS } from './known-props.js'

/**
 * An instance is a black box with a styleable outer box (ADR 0018).
 *
 * Every attribute an `<Instance>` carries has exactly one role: it decides
 * what gets built, places the use, styles its outer box, cascades into the
 * texts inside, or is locked — the component's own business, which every
 * target ignores. This is the one copy of that table: the renderer, the panel,
 * `uidx check`, codegen, detach and the agent all read it. So it imports
 * nothing that draws, and the CLI reaches it through
 * `@uidx/schema/instance-box` without CanvasKit, as it does `known-props`.
 *
 * The rest is the merge, as pure functions of parsed nodes: which node the
 * box lands on, how a use's box is laid over that node beneath state, and how
 * a text takes the colour a use hands down.
 */

export { INSTANCE_CASCADE_PROPS }

export type InstanceRole = 'structural' | 'placement' | 'box' | 'cascade' | 'locked'

/**
 * Read by the expansion rather than drawn (ADR 0018 §1). The ADR names
 * `component`, `props`, `overrides`, `modes` and `name`. The rest of
 * `STRUCTURAL_PROPS` comes too: a repeat and the part a use binds tie it into
 * its surroundings, and calling them locked would lint a working `repeat`.
 */
export const INSTANCE_STRUCTURAL_PROPS: readonly string[] = ['name', ...STRUCTURAL_PROPS]

/**
 * Where the use sits and how big it is: these land on the instance's own node.
 * The sizing modes are here because they are honoured when written by hand,
 * though the editor never writes them — a stated width already says Fixed
 * (`instanceSizing` in the scene build).
 */
export const INSTANCE_PLACEMENT_PROPS: readonly string[] = [
  'x',
  'y',
  'right',
  'bottom',
  'centerX',
  'centerY',
  'rotation',
  'constraints',
  'layoutPositioning',
  'layoutGrow',
  'layoutAlign',
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'primaryAxisSizingMode',
  'counterAxisSizingMode',
  'visible',
  'locked',
  'blendMode',
  'isMask',
  'maskType',
]

/**
 * The outer box a consumer may style, as CSS lets one style an element's box:
 * background, border, radius, padding, opacity and shadow. They land on the
 * box node (`boxTargetOf`), beneath the component's state rows.
 */
export const INSTANCE_BOX_PROPS: readonly string[] = [
  'fills',
  'strokes',
  'strokeWeight',
  'strokeAlign',
  'dashPattern',
  'strokeTopWeight',
  'strokeRightWeight',
  'strokeBottomWeight',
  'strokeLeftWeight',
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomRightRadius',
  'bottomLeftRadius',
  'cornerSmoothing',
  'opacity',
  'effects',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
]

/**
 * A shorthand replaces its longhands, as in CSS (ADR 0018 §5): an instance's
 * `cornerRadius` drops the component's corner radii, and its `strokeWeight`
 * drops the side weights.
 */
export const INSTANCE_BOX_SHORTHANDS: Readonly<Record<string, readonly string[]>> = {
  cornerRadius: ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'],
  strokeWeight: ['strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight'],
}

const ROLES = new Map<string, InstanceRole>([
  ...INSTANCE_STRUCTURAL_PROPS.map((prop) => [prop, 'structural'] as const),
  ...INSTANCE_PLACEMENT_PROPS.map((prop) => [prop, 'placement'] as const),
  ...INSTANCE_BOX_PROPS.map((prop) => [prop, 'box'] as const),
  ...INSTANCE_CASCADE_PROPS.map((prop) => [prop, 'cascade'] as const),
])

/** What an attribute written on an `<Instance>` does. Anything not listed is locked. */
export function instanceRole(prop: string): InstanceRole {
  return ROLES.get(prop) ?? 'locked'
}

/**
 * The component's inside: its layout, how its strokes end and join, and every
 * text and vector property. They still parse, since the format may lead the
 * tool, but nothing draws them on an instance and `uidx check` says so.
 */
export const INSTANCE_LOCKED_PROPS: readonly string[] = KNOWN_PROPS.filter(
  (prop) => instanceRole(prop) === 'locked',
)

/**
 * `instance` with only what its own node carries: where it sits, and what
 * decides what gets built. Its box goes to the box node, `textFills` to the
 * texts inside, and the locked inside nowhere (ADR 0018 §1). Pure; the node
 * is copied, never changed.
 */
export function placementOf(instance: UidxNode): UidxNode {
  const attrs: Record<string, UidxAttr> = {}
  for (const [prop, attr] of Object.entries(instance.attrs)) {
    const role = instanceRole(prop)
    if (role === 'placement' || role === 'structural') attrs[prop] = attr
  }
  return { ...instance, attrs }
}

const LONGHANDS = new Map(Object.entries(INSTANCE_BOX_SHORTHANDS))
const SHORTHAND_OF = new Map(
  [...LONGHANDS].flatMap(([shorthand, longhands]) =>
    longhands.map((longhand) => [longhand, shorthand] as const),
  ),
)

/* ------------------------------------------------------------- the box node */

/**
 * The one frame a component wraps, when the component is only a wrapper
 * around it — or undefined for a component that lays itself out (ADR 0008),
 * whose children are its content.
 */
export function wrappedFrame(source: UidxNode): UidxNode | undefined {
  if (source.attrs.layoutMode || source.attrs.width || source.attrs.height) return undefined
  return source.children.length === 1 ? source.children[0] : undefined
}

/**
 * Where a use's box lands. `path` names the way down to that node from what
 * the instance draws, one name per level — `['root']` for a styles table's
 * derived root, `['root', 'base']` through a wrapper — which is also the
 * node's path inside the component, the key an override uses.
 */
export type BoxTarget =
  | { kind: 'frame'; node: UidxNode; path: readonly string[] }
  | { kind: 'instance'; node: UidxNode; path: readonly string[] }
  | { kind: 'self' }

/**
 * Where an instance's outer box lands (ADR 0018 §2). `source` is what the
 * instance draws: its component, or the variant it chose.
 *
 * The rule is the one that decides which node takes a stated size, so size
 * and look always land on the same node:
 *
 * - The frame a wrapper-shaped component wraps: a styles table's derived
 *   `root`, an authored variant's frame, or the laid-out frame of a bare
 *   `<Component>`. On the wrapper, a fill would paint an invisible box behind
 *   it and padding would act as a margin.
 * - The one instance a composition holds, as CheckboxField holds Field: it is
 *   passed the box as if it had stated it.
 * - Otherwise the instance's own node, which is the component's frame.
 *
 * From there the box goes on through any frame that only wraps another
 * (`onlyWraps`), for the same reason: a component that draws its look on a
 * part inside a frame of its own, as the Shoelace example's Button draws on
 * `base`, would otherwise take a fill behind that part.
 *
 * A repeat is neither: it is a template for many rows, not the component's
 * frame, so its box stays on the instance.
 */
export function boxTargetOf(source: UidxNode): BoxTarget {
  const wrapped = wrappedFrame(source)
  if (wrapped && repeatOf(wrapped)) return { kind: 'self' }
  const path = wrapped ? [wrapped.name] : []
  let node = wrapped ?? source
  for (let held = onlyWraps(node); held; held = onlyWraps(node)) {
    node = held
    path.push(held.name)
  }
  if (path.length === 0) return { kind: 'self' }
  if (node.element === 'Frame') return { kind: 'frame', node, path }
  if (node.element === 'Instance') return { kind: 'instance', node, path }
  return { kind: 'self' }
}

/** The node at `path` below `source`, one name per level, or undefined. */
export function nodeAtPath(source: UidxNode, path: readonly string[]): UidxNode | undefined {
  let node: UidxNode | undefined = source
  for (const name of path) node = node?.children.find((child) => child.name === name)
  return node
}

const PADDING = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const
const LIMITS = ['minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const

/**
 * The one frame or instance `node` holds, when `node` is only a wrapper
 * around it, or undefined: it lays that one out and hugs it on both axes,
 * with no padding, no paint, no opacity and no clip of its own, so its box is
 * the held one's and nothing of it shows (ADR 0018 §2).
 *
 * Read from the values the component rests in. A value a state row stamped
 * does not count: a state sits above the use (§3), so the disabled state's
 * opacity on Shoelace's root must not move where the use's fill lands.
 */
function onlyWraps(node: UidxNode): UidxNode | undefined {
  if (node.children.length !== 1) return undefined
  const held = node.children[0]!
  if (held.element !== 'Frame' && held.element !== 'Instance') return undefined
  if (repeatOf(held) || resting(held, 'visible') === false) return undefined
  if (resting(held, 'layoutPositioning') === 'ABSOLUTE') return undefined
  const mode = resting(node, 'layoutMode')
  if (mode !== 'HORIZONTAL' && mode !== 'VERTICAL') return undefined
  if (resting(node, 'primaryAxisSizingMode') !== 'AUTO') return undefined
  if (resting(node, 'counterAxisSizingMode') !== 'AUTO') return undefined
  if (LIMITS.some((prop) => resting(node, prop) !== undefined)) return undefined
  if (PADDING.some((prop) => (resting(node, prop) ?? 0) !== 0)) return undefined
  if (['fills', 'strokes', 'effects'].some((prop) => paints(resting(node, prop)))) return undefined
  if ((resting(node, 'opacity') ?? 1) !== 1 || resting(node, 'clipsContent') === true)
    return undefined
  return held
}

/** An attribute's value as the component rests, or undefined when only a state row set it. */
function resting(node: UidxNode, prop: string): JsonValue | undefined {
  const attr = node.attrs[prop]
  return attr === undefined || attr.stateRow !== undefined ? undefined : attr.value
}

/** Whether a paint or effect list draws anything: a token, or one entry not hidden. */
function paints(value: JsonValue | undefined): boolean {
  if (value === undefined || value === null) return false
  if (!Array.isArray(value)) return true
  return value.some(
    (entry) => !isEntry(entry) || (entry as Record<string, JsonValue>).visible !== false,
  )
}

/** What the scene build draws as a hugging column when it states no geometry at all. */
const COLUMN_BY_DEFAULT: ReadonlySet<string> = new Set(['Component', 'Variant', 'Slot'])

/**
 * Whether `node` lays out what it holds, which is what gives padding
 * something to inset — so whether a use's padding does anything on the node
 * its box lands on (ADR 0018 §2). The contract, `uidx check` and codegen all
 * ask it here, so they answer as the canvas draws.
 *
 * A frame lays out only when it says so; a styles table's `root` says what
 * its component does (`deriveVariants`). A component, a variant or a slot
 * that states no layout, width or height is drawn as a hugging column
 * (`componentSizing` in the scene build), so it lays out without saying so;
 * one that states a size and no layout places its children where they say.
 */
export function laysOut(node: UidxNode): boolean {
  const mode = node.attrs.layoutMode
  if (mode) return mode.value !== 'NONE'
  return COLUMN_BY_DEFAULT.has(node.element) && !node.attrs.width && !node.attrs.height
}

/* ---------------------------------------------------------------- the merge */

/** The attributes a use lays over a node of its component, bound and ready to merge. */
export type BoxLayer = Record<string, UidxAttr>

/**
 * `node` with `layer` laid over it attribute by attribute (ADR 0018 §3, §5).
 *
 * A layer value replaces the node's, and a shorthand also drops the longhands
 * it covers. A value a state row wrote carries a stamp (`stateRow`) and sits
 * above the use, so it stays — a stamped corner under the use's
 * `cornerRadius`, and a stamped `cornerRadius` over a corner the use states,
 * which would otherwise undo the state on one side.
 *
 * At the level of attributes, before `scenePropsFor`, so the composition that
 * folds `strokeWeight` into each stroke sees one node: an instance's
 * `strokes` keeps the component's weight, and its weight alone takes the
 * component's paints. Pure; the node is copied, never changed.
 */
export function layered(node: UidxNode, layer: BoxLayer): UidxNode {
  const props = Object.keys(layer)
  if (props.length === 0) return node
  const base = node.attrs
  const stamped = (prop: string | undefined): boolean =>
    prop !== undefined && base[prop]?.stateRow !== undefined
  const attrs = { ...base }
  const laid: string[] = []
  // Drop against the base first, then add: a layer stating both a shorthand
  // and one of its longhands keeps both.
  for (const prop of props) {
    if (stamped(prop) || stamped(SHORTHAND_OF.get(prop))) continue
    for (const longhand of LONGHANDS.get(prop) ?? []) if (!stamped(longhand)) delete attrs[longhand]
    laid.push(prop)
  }
  for (const prop of laid) attrs[prop] = layer[prop]!
  return { ...node, attrs }
}

type Resolve = (address: string) => JsonValue | undefined

/**
 * The box attributes `instance` states, each bound where the instance is
 * written (`boxValue`), ready for `layered`. Placement, structure, the locked
 * inside and `textFills` are left out: each has a node of its own to go to.
 */
export function boxLayer(
  instance: UidxNode,
  resolveAlias: Resolve | undefined,
  warnings: string[],
): BoxLayer {
  const out: BoxLayer = {}
  for (const [prop, attr] of Object.entries(instance.attrs)) {
    if (instanceRole(prop) !== 'box') continue
    const value = boxValue(instance, prop, resolveAlias, warnings)
    if (value !== undefined) out[prop] = synthAttr(prop, value, attr)
  }
  return out
}

/** Attributes whose whole-attribute colour token means one solid paint, as on a frame. */
const PAINT_PROPS: ReadonlySet<string> = new Set([
  'fills',
  'strokes',
  'effects',
  ...INSTANCE_CASCADE_PROPS,
])

/** A paint or an effect: an entry of a list that may lose it and still draw. */
function isEntry(value: JsonValue): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** A Figma colour: `{ r, g, b }` in 0–1, alpha optional. */
function isColor(value: JsonValue): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const { r, g, b } = value as Record<string, JsonValue>
  return typeof r === 'number' && typeof g === 'number' && typeof b === 'number'
}

/**
 * One box or cascade attribute of `instance`, bound in the consumer's scope,
 * or undefined when it is absent or dropped (ADR 0018 §5).
 *
 * The value lands on a node of the component, whose resolver knows the
 * component's props and not the page's modes, so it is bound here first.
 * `resolveAlias` is the scope the instance is written in — its page's modes
 * and its own `modes` — as for `overrides`. A whole colour token on a paint
 * list becomes the one solid paint it means, as on a frame
 * (`wholePaintAlias` in the scene build).
 *
 * A component-property or item binding is dropped with a warning: colour
 * reaches a component through its visual props and rows (F6), and inside a
 * definition `{label}` would be the outer component's. An unresolved token
 * drops the value too, so the component's own value shows. A paint whose
 * token does not resolve leaves its list and the rest still paints, as on a
 * frame, but a list left with no paint at all is dropped: `[]` is the use's
 * explicit "none", and a missing token must not wipe the component's paint.
 */
export function boxValue(
  instance: UidxNode,
  prop: string,
  resolveAlias: Resolve | undefined,
  warnings: string[],
): JsonValue | undefined {
  const attr = instance.attrs[prop]
  if (!attr) return undefined
  const at = instance.address
  const binding = firstBinding(attr.value)
  if (binding !== null) {
    warnings.push(
      `${at}: ${prop} binds "{${binding}}" — an instance's outer box takes a value or a token, so the component's own ${prop} shows`,
    )
    return undefined
  }
  const whole = aliasTarget(attr.value)
  if (whole === null) return boundLeaves(attr.value, resolveAlias, warnings, at)
  const bound = resolveAlias?.(whole)
  if (bound === undefined) {
    warnings.push(`${at}: unresolved token "${whole}"`)
    return undefined
  }
  return PAINT_PROPS.has(prop) && isColor(bound) ? [{ type: 'SOLID', color: bound }] : bound
}

/** The first `{name}` binding anywhere in `value`, or null when it binds none. */
function firstBinding(value: JsonValue): string | null {
  const target = aliasTarget(value)
  if (target !== null) return propertyBinding(target)
  if (value === null || typeof value !== 'object') return null
  for (const entry of Array.isArray(value) ? value : Object.values(value)) {
    const found = firstBinding(entry)
    if (found !== null) return found
  }
  return null
}

/**
 * `value` with every token inside it bound: a paint's `color`, a dash length,
 * or undefined when one does not resolve.
 *
 * A paint whose token does not resolve leaves its list rather than taking the
 * list with it, as the scene build's `resolvePaintAliases` does — unless no
 * paint is left, since an empty list would read as "none". Any other entry
 * takes the list with it: a dash pattern missing one length would swap its
 * dashes and gaps.
 */
function boundLeaves(
  value: JsonValue,
  resolveAlias: Resolve | undefined,
  warnings: string[],
  at: string,
): JsonValue | undefined {
  const target = aliasTarget(value)
  if (target !== null) {
    const bound = resolveAlias?.(target)
    if (bound === undefined) warnings.push(`${at}: unresolved token "${target}"`)
    return bound
  }
  if (Array.isArray(value)) {
    const out: JsonValue[] = []
    let whole = true
    for (const entry of value) {
      const bound = boundLeaves(entry, resolveAlias, warnings, at)
      if (bound !== undefined) out.push(bound)
      else if (!isEntry(entry)) whole = false
    }
    return whole && (out.length > 0 || value.length === 0) ? out : undefined
  }
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, JsonValue> = {}
  for (const [key, entry] of Object.entries(value)) {
    const bound = boundLeaves(entry, resolveAlias, warnings, at)
    if (bound === undefined) return undefined
    out[key] = bound
  }
  return out
}

/* ------------------------------------------------------------ the cascade */

/**
 * `text` drawn in the colour an instance hands down (ADR 0018 §4), or `text`
 * itself: when it is not a text, when there is no colour, or when a state row
 * set its fills — a row keyed by a state sits above the use (§3). `paints` is
 * already bound (`boxValue`).
 */
export function withTextFills(text: UidxNode, paints: JsonValue | undefined): UidxNode {
  if (text.element !== 'Text' || paints === undefined) return text
  const own = text.attrs.fills
  if (own?.stateRow !== undefined) return text
  return { ...text, attrs: { ...text.attrs, fills: synthAttr('fills', paints, own ?? text) } }
}
