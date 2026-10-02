import { addressOf, hasVariants, slotFills, type JsonValue, type UidxNode } from '@uidx/format'
import { SceneGraph, type NodeType, type SceneNode } from '@open-pencil/scene-graph'

import { defaultFor } from './defaults.js'
import { deriveVariants, repeatOf } from './design-system.js'
import {
  INSTANCE_BOX_PROPS,
  INSTANCE_BOX_SHORTHANDS,
  boxLayer,
  boxTargetOf,
  boxValue,
  instanceRole,
  laysOut,
  layered,
  nodeAtPath,
  type BoxLayer,
  type BoxTarget,
} from './instance-box.js'
import { wrappedFrameUpdate } from './reconcile.js'
import {
  composedNode,
  instanceDefinition,
  instanceRootProps,
  instanceScope,
  NODE_TYPE,
  scenePropFor,
  variantFor,
  type SceneOptions,
} from './to-scene.js'

/**
 * What the properties panel reads for a selected instance, and how the canvas
 * previews an edit to its outer box (ADR 0018 §7).
 *
 * A row of the outer box shows the component's own value, dimmed, until the
 * use states one. `instanceBase` reads that value where the box lands, for
 * the combination the use asks for, with the token aliases the component
 * wrote. An edit is previewed before it is a patch, and the node that draws
 * it is generated, so `instancePreview` draws it through the build's own
 * functions: the instance's own node, the node its box lands on, and the
 * texts its colour reaches. The preview and the file's echo then cannot
 * disagree.
 *
 * Pure functions of parsed nodes: nothing here draws, and nothing reaches the
 * file.
 */

/** Where a use's outer box is drawn (ADR 0018 §2). */
export interface InstanceBoxTarget {
  /** The frame its component wraps, the instance a composition holds, or its own node. */
  kind: BoxTarget['kind']
  /**
   * The scene id of the node that draws the box. Through a composition that
   * is the held instance's own box node, at any depth: `cf#field/root`.
   */
  id: string
}

/** The layout of the node a use's box lands on, as `LockedLayoutRow` reads it, aliases kept. */
export interface InstanceLayout {
  layoutMode?: JsonValue
  itemSpacing?: JsonValue
  primaryAxisAlignItems?: JsonValue
  counterAxisAlignItems?: JsonValue
  layoutWrap?: JsonValue
  clipsContent?: JsonValue
}

/** What a selected instance inherits from its component, row by row. */
export interface InstanceBase {
  target: InstanceBoxTarget
  /**
   * The box values the component draws where the box lands, for the
   * combination the use asks for: its own attributes with its style rows laid
   * over, token aliases kept. A property it states nothing for is absent, so
   * an engine default never shows (ADR 0018 §7).
   */
  values: Readonly<Record<string, JsonValue>>
  /**
   * Each property that a state the use's props select sets, with the state's
   * name. A state sits above the use (§3), so a value the use states for one
   * of these shows only in the other states. `textFills` is here when a state
   * colours a text the use's colour would otherwise reach.
   */
  stateWins: ReadonlyMap<string, string>
  /**
   * What the texts the use's colour reaches show without it: one fills value,
   * or `'mixed'` when they differ. Where a state the use's props select
   * colours every one of them instead, it is what that state colours them, as
   * `values` keeps a state's box value. Null when the component draws no text
   * the use's colour could reach. The texts that show decide, and hidden ones
   * only when none shows.
   */
  text: JsonValue | 'mixed' | null
  /** The layout of the node the box lands on, which belongs to the component. */
  layout: InstanceLayout
}

/** One node a preview moves, and what moves on it. */
export interface InstancePreviewUpdate {
  id: string
  props: Partial<SceneNode>
}

/**
 * What `instance` inherits for each row of its outer box (ADR 0018 §7), or
 * null when it draws nothing: no definition, or no variant for the
 * combination it asks for.
 *
 * `definition` is its component as `instanceDefinition` finds it, and
 * `options` the scope the instance is written in. `instance.address` is read
 * as its scene id, as the build reads it. A use inside a slot fill is drawn at
 * the definition's position, so it is passed re-addressed there.
 */
export function instanceBase(
  instance: UidxNode,
  definition: UidxNode | undefined,
  options: SceneOptions,
): InstanceBase | null {
  if (!definition) return null
  const derived = deriveVariants(definition)
  const box = boxDrawn(instance, instance.address, derived, options, [derived.name])
  if (!box) return null
  const values: Record<string, JsonValue> = {}
  const stateWins = new Map<string, string>()
  for (const prop of INSTANCE_BOX_PROPS) {
    const attr = box.node.attrs[prop]
    if (attr) values[prop] = attr.value
    // The use's value gives way wherever `layered` keeps the component's: a
    // value a state row stamped, or a longhand under a stamped shorthand.
    const shorthand = SHORTHAND_OF.get(prop)
    const state =
      attr?.stateRow ?? (shorthand === undefined ? undefined : box.node.attrs[shorthand]?.stateRow)
    if (state !== undefined) stateWins.set(prop, state)
  }
  const texts = reachedTexts(instance, derived, options)
  if (texts.stamped !== undefined) stateWins.set('textFills', texts.stamped)
  return {
    target: { kind: box.kind, id: box.id },
    values,
    stateWins,
    text: textColour(texts.list) ?? textColour(texts.held),
    layout: layoutOf(box.node),
  }
}

/**
 * What the canvas moves to draw `next` where it now draws `drawn`, or null
 * when the instance draws nothing: no definition, or no variant for the
 * combination it asks for. The two are versions of one instance, as an edit
 * to its outer box, its text colour or its stated size leaves the file.
 *
 * Each update is what changed on one node, by the rule the file's echo
 * follows, so the preview leaves the scene as a rebuild of the edited file
 * would, and the reverse preview puts it back:
 *
 * - the instance's own node (`instanceRootProps`), which takes the box only
 *   when its component lays itself out;
 * - the node its box lands on (`wrappedFrameUpdate`), and through a
 *   composition the held instance's box node too;
 * - each text in `textTargets`, the instance's `SceneResult.textTargets`
 *   list, when the colour it hands down changed.
 *
 * `drawn` is what the scene shows now: the file's version, or the last
 * preview. The caller keeps it, as `createWrappedFrame` does in the viewer.
 * `options` is the scope the instance is written in, with any colour an
 * enclosing use hands down as `textFills`; `parentLayout` is the layout of
 * the node it sits in; and `next.address` is its scene id (`instanceBase`).
 */
export function instancePreview(
  drawn: UidxNode,
  next: UidxNode,
  definition: UidxNode | undefined,
  options: SceneOptions,
  parentLayout?: SceneNode['layoutMode'],
  textTargets: readonly string[] = [],
): InstancePreviewUpdate[] | null {
  if (!definition) return null
  const derived = deriveVariants(definition)
  if (!drawnSource(derived, next, options)) return null
  const id = next.address
  const out: InstancePreviewUpdate[] = []
  const root = moved(
    instanceRootProps(drawn, derived, options, parentLayout),
    instanceRootProps(next, derived, options, parentLayout),
    NODE_TYPE.Instance,
  )
  if (root) out.push({ id, props: root })
  out.push(...boxUpdates(id, drawn, next, derived, options, parentLayout, [derived.name]))
  out.push(...textUpdates(drawn, next, derived, options, textTargets))
  return out
}

/* ------------------------------------------------------------- the box */

/** Each longhand a shorthand covers, to that shorthand. */
const SHORTHAND_OF = new Map(
  Object.entries(INSTANCE_BOX_SHORTHANDS).flatMap(([shorthand, longhands]) =>
    longhands.map((longhand) => [longhand, shorthand] as const),
  ),
)

/** What `instance` draws of `definition`: the variant it asks for, or undefined when none covers it. */
function drawnSource(
  definition: UidxNode,
  instance: UidxNode,
  options: SceneOptions,
): UidxNode | undefined {
  const chosen = variantFor(definition, instance, options.resolveAlias)
  if (hasVariants(definition) && !chosen) return undefined
  return chosen ?? definition
}

/** The node a use's box is drawn on, as its component draws it before the use's layer. */
interface DrawnBox {
  kind: BoxTarget['kind']
  id: string
  node: UidxNode
}

/**
 * Where `instance`'s box is drawn, and what is there before the use lays its
 * own box over it: the frame its component wraps, or the component's own
 * frame. Through a composition it is the held instance's box node, with what
 * the definition wrote on the held instance laid over it, as `composedNode`
 * hands it on. Null when nothing draws it.
 */
function boxDrawn(
  instance: UidxNode,
  id: string,
  definition: UidxNode,
  options: SceneOptions,
  chain: readonly string[],
): DrawnBox | null {
  const source = drawnSource(definition, instance, options)
  if (!source) return null
  const target = boxTargetOf(source)
  if (target.kind === 'self') return { kind: 'self', id, node: source }
  const at = target.path.reduce(addressOf, id)
  if (target.kind === 'frame') return { kind: 'frame', id: at, node: target.node }
  const held = heldBy(instance, target.node, definition, options, chain)
  if (!held) return null
  const inner = boxDrawn(target.node, at, held.definition, held.scope, [
    ...chain,
    held.definition.name,
  ])
  if (!inner) return null
  return {
    kind: 'instance',
    id: inner.id,
    node: layered(inner.node, writtenBox(target.node, held.scope)),
  }
}

/**
 * The component an instance inside `definition` draws, and the scope that
 * instance is written in. Null when it names nothing, or names a component
 * the chain already expands, which the build refuses as a cycle.
 */
function heldBy(
  use: UidxNode,
  held: UidxNode,
  definition: UidxNode,
  options: SceneOptions,
  chain: readonly string[],
): { definition: UidxNode; scope: SceneOptions } | null {
  const scope = instanceScope(use, definition, options)
  const found = instanceDefinition(held, scope)
  if (!found || chain.includes(found.name)) return null
  return { definition: found, scope }
}

/**
 * The box a definition wrote on the instance it holds, aliases kept, but only
 * what the build lays on: a binding, or a token that does not resolve, is
 * dropped there (`boxValue`), so the component's own value shows.
 */
function writtenBox(held: UidxNode, scope: SceneOptions): BoxLayer {
  const out: BoxLayer = {}
  for (const [prop, attr] of Object.entries(held.attrs)) {
    if (instanceRole(prop) !== 'box') continue
    if (boxValue(held, prop, scope.resolveAlias, []) !== undefined) out[prop] = attr
  }
  return out
}

const LAYOUT_PROPS = [
  'layoutMode',
  'itemSpacing',
  'primaryAxisAlignItems',
  'counterAxisAlignItems',
  'layoutWrap',
  'clipsContent',
] as const

/**
 * The layout `node` draws with, as written. A component, variant or slot that
 * says nothing is drawn as a hugging column (`laysOut`), so that is what it
 * shows.
 */
function layoutOf(node: UidxNode): InstanceLayout {
  const out: InstanceLayout = {}
  for (const prop of LAYOUT_PROPS) {
    const value = node.attrs[prop]?.value
    if (value !== undefined) out[prop] = value
  }
  if (out.layoutMode === undefined && laysOut(node)) out.layoutMode = 'VERTICAL'
  return out
}

/**
 * What moves on the node an instance's box lands on: by the echo's own rule
 * (`wrappedFrameUpdate`), and through a composition on the held instance's box
 * node as well. That node is a level further down, where the build hands the
 * held instance the use's box and size (`composedNode`).
 */
function boxUpdates(
  id: string,
  drawn: UidxNode,
  next: UidxNode,
  definition: UidxNode,
  options: SceneOptions,
  parentLayout: SceneNode['layoutMode'] | undefined,
  chain: readonly string[],
): InstancePreviewUpdate[] {
  const source = drawnSource(definition, next, options)
  if (!source) return []
  const target = boxTargetOf(source)
  if (target.kind === 'self') return []
  const out: InstancePreviewUpdate[] = []
  const framed = wrappedFrameUpdate(
    id,
    { instance: drawn, definition },
    { instance: next, definition },
    options,
    parentLayout,
  )
  if (framed) out.push(framed)
  if (target.kind !== 'instance') return out
  const held = heldBy(next, target.node, definition, options, chain)
  if (!held) return out
  const heldId = target.path.reduce(addressOf, id)
  const placed = (use: UidxNode) => instanceRootProps(use, definition, options, parentLayout)
  const composed = (use: UidxNode, at: Partial<SceneNode>): UidxNode => ({
    ...composedNode(use, target.node, boxLayer(use, options.resolveAlias, []), at),
    address: heldId,
  })
  const nextPlaced = placed(next)
  // The held instance sits in the instance's own node, or in the frame it was
  // found through, which only wraps it and so lays out.
  const around =
    target.path.length === 1
      ? nextPlaced.layoutMode
      : (nodeAtPath(source, target.path.slice(0, -1))?.attrs.layoutMode?.value as
          SceneNode['layoutMode'] | undefined)
  out.push(
    ...boxUpdates(
      heldId,
      composed(drawn, placed(drawn)),
      composed(next, nextPlaced),
      held.definition,
      held.scope,
      around,
      [...chain, held.definition.name],
    ),
  )
  return out
}

/* ------------------------------------------------------------ the texts */

/** A colour a nearer use hands a text, as written and bound. */
interface HandedColour {
  raw: JsonValue
  bound: JsonValue
}

/** One text the use's colour reaches. */
interface ReachedText {
  /** Its scene id; for a text a repeat draws, the first row's. */
  id: string
  /** The text as drawn, with its component's rows on it. */
  source: UidxNode
  /** The scope its own fills resolve in. */
  scope: SceneOptions
  /** A colour it is handed short of the use's own: an enclosing use's, or a composition's. */
  colour: HandedColour | undefined
  /** Whether it is drawn visible in the combinations chosen. */
  shown: boolean
}

interface Reached {
  list: ReachedText[]
  /** The texts a state row colours instead, which keep the row's colour whatever is handed down. */
  held: ReachedText[]
  /** The first state found colouring a text the use's colour would otherwise reach. */
  stamped: string | undefined
  /** Every id walked, and the repeats among them, to read a later row's id as its first row's. */
  ids: Set<string>
  repeats: Set<string>
}

/** Where a walk stands: the scope values resolve in and what a text there is handed. */
interface Within {
  scope: SceneOptions
  colour: HandedColour | undefined
  shown: boolean
  /** The components expanded on the way down, which the build stops at. */
  chain: readonly string[]
}

/** Inside a component one instance draws. */
interface Drawing extends Within {
  /** The scope the instance is written in, where its slot fills resolve. */
  written: SceneOptions
  fills: ReadonlyMap<string, UidxNode>
  /** Paths inside the component whose `overrides` entry sets fills, which beats any colour. */
  overridden: ReadonlySet<string>
  /** The instance a composition holds, at whatever depth: its colour is handed beneath the use's. */
  held: UidxNode | undefined
}

/**
 * The texts `instance`'s colour reaches (ADR 0018 §4), walked as
 * `expandInstance` draws them: every text its component draws at any depth,
 * the instances it holds included, unless a state row or the `overrides` map
 * colours it; slot content that states no fills; and nothing under an
 * instance that states its own colour. A composition's definition may colour
 * the held instance's texts, and they show that short of the use's colour. A
 * repeat is walked once, as its first row. The texts a state row colours are
 * kept apart (`held`): they still draw, in the row's colour.
 */
function reachedTexts(instance: UidxNode, definition: UidxNode, options: SceneOptions): Reached {
  const reached: Reached = {
    list: [],
    held: [],
    stamped: undefined,
    ids: new Set(),
    repeats: new Set(),
  }
  const outer =
    options.textFills === undefined
      ? undefined
      : { raw: options.textFills, bound: options.textFills }

  const expand = (use: UidxNode, id: string, found: UidxNode, within: Within): void => {
    if (within.chain.includes(found.name)) return
    const source = drawnSource(found, use, within.scope)
    if (!source) return
    const scope = instanceScope(use, found, within.scope)
    const target = boxTargetOf(source)
    const drawing: Drawing = {
      ...within,
      scope,
      written: within.scope,
      fills: slotFills(use).fills,
      overridden: overriddenFills(use),
      chain: [...within.chain, found.name],
      held: target.kind === 'instance' ? target.node : undefined,
    }
    for (const child of source.children) drawn(child, id, child.name, drawing)
  }

  /** A node a component draws (`clone`), at `relative` inside it. */
  const drawn = (node: UidxNode, parentId: string, relative: string, within: Drawing): void => {
    if (node === within.held) {
      // The held instance's own colour becomes what its texts are handed,
      // beneath the use's (`composedTextFills`), so it states none itself.
      const bound = boxValue(node, 'textFills', within.scope.resolveAlias, [])
      const attrs = { ...node.attrs }
      delete attrs.textFills
      const colour =
        bound === undefined ? within.colour : { raw: node.attrs.textFills!.value, bound }
      return drawn({ ...node, attrs }, parentId, relative, { ...within, colour, held: undefined })
    }
    const id = addressOf(parentId, node.name)
    reached.ids.add(id)
    if (repeatOf(node)) reached.repeats.add(id)
    const shown = within.shown && node.attrs.visible?.value !== false
    if (node.element === 'Text') {
      // The overrides map colours a text over a state row and the use alike.
      if (within.overridden.has(relative)) return
      const state = node.attrs.fills?.stateRow
      const text = { id, source: node, scope: within.scope, colour: within.colour, shown }
      if (state === undefined) {
        reached.list.push(text)
      } else {
        reached.stamped ??= state
        reached.held.push({ ...text, colour: undefined })
      }
      return
    }
    if (node.element === 'Instance') return nested(node, id, { ...within, shown })
    const fill = node.element === 'Slot' ? within.fills.get(node.name) : undefined
    if (fill) {
      const content: Within = {
        scope: within.written,
        colour: within.colour,
        shown,
        chain: within.chain,
      }
      for (const child of fill.children) authored(child, id, content)
      return
    }
    for (const child of node.children)
      drawn(child, id, `${relative}/${child.name}`, { ...within, shown })
  }

  /** Slot content (`authored`): written by the consuming page, so a text keeps fills it states. */
  const authored = (node: UidxNode, parentId: string, within: Within): void => {
    const id = addressOf(parentId, node.name)
    reached.ids.add(id)
    const shown = within.shown && node.attrs.visible?.value !== false
    if (node.element === 'Text') {
      if (node.attrs.fills === undefined)
        reached.list.push({ id, source: node, scope: within.scope, colour: within.colour, shown })
      return
    }
    if (node.element === 'Instance') return nested(node, id, { ...within, shown })
    for (const child of node.children) authored(child, id, { ...within, shown })
  }

  /** An instance below the use: its texts are the use's unless it states a colour of its own. */
  const nested = (node: UidxNode, id: string, within: Within): void => {
    if (boxValue(node, 'textFills', within.scope.resolveAlias, []) !== undefined) return
    const found = instanceDefinition(node, within.scope)
    if (found) expand(node, id, found, within)
  }

  expand(instance, instance.address, definition, {
    scope: options,
    colour: outer,
    shown: true,
    chain: [],
  })
  return reached
}

/** The paths an instance's `overrides` map sets fills at. */
function overriddenFills(instance: UidxNode): Set<string> {
  const declared = instance.attrs.overrides?.value
  const out = new Set<string>()
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) return out
  for (const [path, entry] of Object.entries(declared)) {
    if (typeof entry === 'object' && entry !== null && !Array.isArray(entry) && 'fills' in entry)
      out.add(path)
  }
  return out
}

/**
 * What a set of reached texts shows: one fills value, `'mixed'`, or null for
 * none. A text that states no fills shows the engine's black.
 */
function textColour(texts: readonly ReachedText[]): JsonValue | 'mixed' | null {
  const shown = texts.filter((text) => text.shown)
  const deciding = shown.length > 0 ? shown : texts
  if (deciding.length === 0) return null
  const [first, ...rest] = deciding.map(
    (text) =>
      text.colour?.raw ?? text.source.attrs.fills?.value ?? defaultFor('Text', 'fills') ?? null,
  )
  return rest.every((value) => sameValue(value, first)) ? first! : 'mixed'
}

/**
 * Each text in `textTargets` the colour reaches, with the fills it draws once
 * the instance goes from `drawn` to `next`: the use's colour, or without one,
 * what the text shows short of it. Nothing when the colour did not change.
 */
function textUpdates(
  drawn: UidxNode,
  next: UidxNode,
  definition: UidxNode,
  options: SceneOptions,
  textTargets: readonly string[],
): InstancePreviewUpdate[] {
  if (textTargets.length === 0) return []
  const was = boxValue(drawn, 'textFills', options.resolveAlias, [])
  const now = boxValue(next, 'textFills', options.resolveAlias, [])
  if (sameValue(was, now)) return []
  const reached = reachedTexts(next, definition, options)
  const byId = new Map(reached.list.map((text) => [text.id, text]))
  const out: InstancePreviewUpdate[] = []
  for (const id of textTargets) {
    const first = firstRowOf(id, next.address, reached)
    const text = first === undefined ? undefined : byId.get(first)
    if (text) out.push({ id, props: { fills: textFills(text, now, options) } })
  }
  return out
}

/** The fills `text` draws when the use hands it `colour`, or hands it nothing. */
function textFills(
  text: ReachedText,
  colour: JsonValue | undefined,
  options: SceneOptions,
): SceneNode['fills'] {
  const handed = colour ?? text.colour?.bound
  const fills =
    handed !== undefined
      ? sceneFills(handed, options)
      : text.source.attrs.fills && sceneFills(text.source.attrs.fills.value, text.scope)
  return fills ?? (engineDefaults('TEXT').fills as SceneNode['fills'])
}

/** A fills value as the scene draws it, through the build's own mapping. */
function sceneFills(value: JsonValue, scope: SceneOptions): SceneNode['fills'] | undefined {
  return scenePropFor('fills', value, {
    resolveAlias: scope.resolveAlias,
    resolveAsset: scope.resolveAsset,
    rootFontSize: scope.rootFontSize,
  })?.fills
}

/**
 * `id` read as the same node's id in a repeat's first row. A later row is
 * named `row-2`, `row-3` beside the first, and draws what the first draws.
 */
function firstRowOf(id: string, base: string, reached: Reached): string | undefined {
  if (reached.ids.has(id)) return id
  const separator = id.charAt(base.length)
  if (!id.startsWith(base) || (separator !== '#' && separator !== '/')) return undefined
  let at = base
  for (const segment of id.slice(base.length + 1).split('/')) {
    const exact = addressOf(at, segment)
    if (reached.ids.has(exact)) {
      at = exact
      continue
    }
    const row = /^(.+)-\d+$/.exec(segment)
    const first = row ? addressOf(at, row[1]!) : undefined
    if (first === undefined || !reached.repeats.has(first)) return undefined
    at = first
  }
  return at
}

/* ------------------------------------------------------------ updates */

/** The fields that say whether layout computes a dimension or keeps the one it is given. */
const SIZING_FIELDS = ['primaryAxisSizing', 'counterAxisSizing'] as const

const defaultsCache = new Map<NodeType, Readonly<Record<string, unknown>>>()

/** A fresh node's fields: where a field no build sets is left. */
function engineDefaults(type: NodeType): Readonly<Record<string, unknown>> {
  let cached = defaultsCache.get(type)
  if (!cached) {
    const graph = new SceneGraph()
    const page = graph.getPages()[0] ?? graph.addPage('scratch')
    cached = { ...(graph.createNode(type, page.id) as unknown as Record<string, unknown>) }
    defaultsCache.set(type, cached)
  }
  return cached
}

/**
 * What changed from `was` to `now` on a node of `type`, or null: the rule the
 * echo updates a node by (`movedProps` in reconcile), so a preview leaves a
 * node as the echo will. A field that stopped being set goes back to the
 * engine's default, and an axis that changes how it is sized gets its stated
 * number back, which is what a rebuild starts from.
 */
function moved(
  was: Partial<SceneNode>,
  now: Partial<SceneNode>,
  type: NodeType,
): Partial<SceneNode> | null {
  const before = was as Record<string, unknown>
  const after = now as Record<string, unknown>
  const props: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(after))
    if (!sameValue(before[key], value)) props[key] = value
  const defaults = engineDefaults(type)
  for (const key of Object.keys(before)) {
    if (key in after || !(key in defaults)) continue
    if (!sameValue(before[key], defaults[key])) props[key] = defaults[key]
  }
  if (SIZING_FIELDS.some((field) => field in props))
    for (const dimension of ['width', 'height'])
      props[dimension] = after[dimension] ?? defaults[dimension]
  return Object.keys(props).length ? (props as Partial<SceneNode>) : null
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) =>
    sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  )
}
