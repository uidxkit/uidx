import {
  DEFAULT_ROOT_FONT_SIZE,
  rootFontSizeOf,
  lengthToPx,
  mapLengthLeaves,
  isUnitLength,
  UNITLESS_NUMBER_PROPS,
  type PropSpec,
} from '@uidx/format'
import {
  computeAllLayouts,
  computeLayout,
  estimateTextSize,
  getTextMeasurer,
  setTextMeasurer,
} from '@open-pencil/core/layout'
import { defaultTuple, mergeModes, TokenResolver, type ModeTuple } from './resolve-modes.js'
import type { TokenIndex } from './token-index.js'
import { SceneGraph, type NodeType, type SceneNode } from '@open-pencil/scene-graph'
import {
  addressOf,
  aliasTarget,
  componentProps,
  componentVariants,
  defaultCombination,
  hasVariants,
  instanceProps as declaredInstanceValues,
  isWithin,
  matchesType,
  METADATA_ATTRS,
  slotFills,
  variantName,
  type JsonValue,
  type SceneElement,
  type UidxDocument,
  type UidxNode,
} from '@uidx/format'

import { STRUCTURAL_PROPS } from './known-props.js'
import { createPinMap, type MutablePinMap, type PinMap } from './pin-index.js'
import { pinFrom } from './pins.js'
import { resolvePins } from './pin-pass.js'
import { composeStrokes, isIdentityProp, mappingFor, normalizeFills } from './prop-table.js'
import { withStrokeEndpoints } from './stroke-endpoints.js'
import { arrangeVariants, type VariantBox } from './variant-layout.js'
import {
  deriveVariants,
  derivedDocument,
  modelSamples,
  repeatModel,
  repeatOf,
  sampleCount,
  specBindings,
  type RepeatScope,
  type ModelIndex,
} from './design-system.js'

export const NODE_TYPE: Record<SceneElement, NodeType> = {
  // The graph's own page node. `<Page>` is never constructed — it is mapped
  // onto the page the graph already provisions (ADR 0003). The token elements
  // are absent by design: a `<Tokens>` file declares variable collections, which
  // live beside the node tree rather than in it.
  Page: 'CANVAS',
  Component: 'COMPONENT',
  Frame: 'FRAME',
  Text: 'TEXT',
  Rectangle: 'RECTANGLE',
  Ellipse: 'ELLIPSE',
  Vector: 'VECTOR',
  // ADR 0007 §1. The SDK has no slot node — measured, not assumed: `NodeType`
  // is eighteen values and none is one — so a slot is unconditionally a frame.
  // Unlike `Component`, which `nodeTypeFor` makes conditional, there is no
  // second answer: what a slot *holds* varies, what it is does not.
  Slot: 'FRAME',
  // Story F3. An instance *is* the component, placed somewhere — which is why
  // it takes the component's own scene properties as its base and its children
  // are the component's children, generated rather than authored.
  Instance: 'INSTANCE',
  // Story F8. One of a component's states (ADR 0005) is a `COMPONENT` in the
  // engine's vocabulary, and the `<Component>` holding them becomes a
  // `COMPONENT_SET` — see `nodeTypeFor`. The set/component split is the Plugin
  // API's mechanism, and ADR 0002 puts mechanism in this layer rather than in
  // the authored surface.
  Variant: 'COMPONENT',
}

/**
 * What a node becomes, which for a `<Component>` depends on whether it has
 * states (ADR 0005 §1).
 *
 * The one place the authored surface's "a component is a component" and the
 * engine's set/component split are reconciled. Deliberately not a second entry
 * in `NODE_TYPE`: an author never writes a `<ComponentSet>`, and a table keyed
 * by element name would imply they could.
 */
export function nodeTypeFor(node: UidxNode): NodeType {
  if (node.element === 'Component' && hasVariants(node)) return 'COMPONENT_SET'
  return NODE_TYPE[node.element as SceneElement]
}

export interface AddressMap {
  /** UIDX address -> scene node id. */
  sceneIdOf(address: string): string | undefined
  /** Scene node id -> UIDX address. Undefined means "not authored" (see §4c). */
  addressOf(sceneId: string): string | undefined
}

/**
 * The bimap as reconciliation sees it: something it has to keep current.
 *
 * The map cannot be a snapshot of the document it was built from, because the
 * graph outlives that document. `applyChanges` inserts and deletes nodes on
 * every save, and a rename or a reparent changes an address — so an entry
 * written at build time names a node that no longer exists, and the node that
 * replaced it is absent. `fromSceneChange` reads "absent from the bimap" as
 * "the SDK generated this, do not write" (§4c), so a stale map does not fail
 * loudly: it silently drops every later edit to the moved subtree.
 *
 * Hence the mutators, and hence `applyChanges` taking the whole `SceneResult`
 * rather than a graph and a root id — the map is not something a caller can
 * forget to pass.
 */
export interface MutableAddressMap extends AddressMap {
  /** Records `address` as authored, living at `sceneId`. */
  link(address: string, sceneId: string): void
  /** Forgets `address` and everything beneath it, as deleting a subtree does. */
  unlink(address: string): void
}

function createAddressMap(): MutableAddressMap {
  const toScene = new Map<string, string>()
  const toAddress = new Map<string, string>()

  return {
    sceneIdOf: (address) => toScene.get(address),
    addressOf: (sceneId) => toAddress.get(sceneId),
    link(address, sceneId) {
      toScene.set(address, sceneId)
      toAddress.set(sceneId, address)
    },
    unlink(address) {
      // `isWithin('', x)` is true of every address, and the page is never
      // removed — guarding here keeps a stray call from emptying the map.
      if (address === '') return
      for (const [known, sceneId] of [...toScene]) {
        if (!isWithin(address, known)) continue
        toScene.delete(known)
        toAddress.delete(sceneId)
      }
    },
  }
}

/**
 * Turns a token address into the value it stands for.
 *
 * Supplied by the caller because resolution needs the whole document (ADR 0004
 * §2) and this function is handed one page. Absent means "render literally",
 * which is what a page opened outside a document does.
 */
export type AliasResolver = (address: string) => JsonValue | undefined

/**
 * A `src` to the hash its bytes are stored under (ADR 0006 §1-2).
 *
 * The file names a path and the renderer wants a hash, and only whoever loaded
 * the bytes can bridge the two — so it is injected here exactly as
 * `resolveAlias` is, rather than this package growing a filesystem. Absent, or
 * returning undefined, means the paint does not draw and the node still does.
 */
export type AssetResolver = (src: string) => string | undefined

/**
 * A bare global component name to its `<Component>` node (ADR 0004 §2, F3).
 *
 * Injected exactly as `resolveAlias` is, and for the same reason: a name is
 * global to a *document* and this function is handed one page, so only the
 * caller holding all the pages can answer. Absent, or returning undefined, is
 * an instance that draws nothing and still occupies its place — `uidx check`
 * is what says the name is wrong, in the same band as an unresolved alias.
 */
export type ComponentResolver = (name: string) => UidxNode | undefined

export interface SceneOptions {
  rootFontSize?: number
  resolveAlias?: AliasResolver
  resolveAsset?: AssetResolver
  resolveComponent?: ComponentResolver
  /**
   * Mode-aware token resolution (story G8).
   *
   * When given, the descent maintains a mode tuple and `#` addresses resolve
   * through it, so a subtree under `modes={{ theme: 'dark' }}` paints dark.
   * When absent, `resolveAlias` serves unchanged — which is what a caller with
   * no index, `uidx check` among them, still wants.
   */
  tokens?: { resolver: TokenResolver; index: TokenIndex }
  /**
   * Which sample a model binding resolves to (ADR 0015 §2): the n-th row of
   * a repeat draws the n-th sample of every bound field.
   */
  sampleIndex?: number
  /**
   * The sample a component previews with when nothing binds it to a row's
   * item — the editor's "Preview data" choice. Fixed at the top of a build,
   * while `sampleIndex` changes row by row inside a repeat.
   */
  previewIndex?: number
  /**
   * The current row's item, as the bindings `{as.field}` resolve to — handed
   * to what a consumer fills a repeated slot with, which is written in the
   * consuming page's scope but drawn once per item of the definition's list.
   */
  itemBindings?: ReadonlyMap<string, JsonValue>
  /**
   * True inside a repeated row: the nodes are generated, so nothing they
   * hold links into the bimap — the same rule an instance's children follow.
   */
  generated?: boolean
  /** The component whose contract the subtree reads: where a repeat's list prop lives. */
  component?: UidxNode
  /** The repeats this subtree sits inside, outermost first (ADR 0017 §2). */
  repeats?: readonly RepeatScope[]
  /**
   * Model name -> declaration across every page, the way `resolveComponent`
   * reaches definitions: a list prop names its model by type (ADR 0015 §2),
   * and the model is written once, very often on another page.
   */
  models?: ModelIndex
}

export interface SceneResult {
  rootFontSize?: number
  graph: SceneGraph
  rootId: string
  addresses: MutableAddressMap
  /**
   * Which node carries which pin (ADR 0011), maintained beside `addresses` and
   * for the same reason: the scene node cannot answer, because the offsets have
   * no scene field to hold.
   */
  pins: MutablePinMap
  warnings: string[]
  /**
   * Auto-sized texts this build could only estimate, because the SDK's measurer
   * declined to answer for them.
   *
   * It declines on first ask: `measureTextNode` raises a *font demand* for the
   * node's face and returns null until that demand settles. So a first build is
   * always estimates, and a later one is real metrics — which is a silent,
   * whole-page reflow the moment anything rebuilds. A caller that can rebuild
   * (the canvas) uses this to come back once the fonts have settled; a caller
   * that cannot (a test, `uidx check`) can ignore it.
   */
  unmeasuredText: number
}

/**
 * Builds a scene graph from a parsed `.uidx` document.
 *
 * Scene node ids are set to UIDX addresses, so the bimap is the identity
 * function for everything that came from the file. The single exception is the
 * root `<Page>`, whose address is `''` (ADR 0003) and which maps onto the page
 * the graph provisions for itself — a node nobody selects or patches. Every
 * entity below it gets its plain address as its scene id, with no exception.
 */
export function toSceneGraph(doc: UidxDocument, options: SceneOptions = {}): SceneResult {
  if (doc.tree.element === 'Tokens') {
    throw new Error(
      'a <Tokens> document declares variable collections, not a scene — use applyTokens',
    )
  }
  // A component with a styles table is drawn as the set of trees the table
  // derives (ADR 0016 §4). Done here, and in `diffDocuments`, so the build
  // and the update path see one tree.
  doc = derivedDocument(doc)
  options = {
    ...options,
    rootFontSize: options.rootFontSize ?? rootFontSizeOf(doc),
    previewIndex: options.previewIndex ?? options.sampleIndex ?? 0,
  }
  const graph = new SceneGraph()
  // `new SceneGraph()` already provisions a page; adding another leaves the
  // editor pointing at an empty one.
  const page = graph.getPages()[0] ?? graph.addPage('Page 1')

  const warnings: string[] = []
  const addresses = createAddressMap()
  const pins = createPinMap()

  const rootId = page.id
  addresses.link('', rootId)

  /**
   * `scope` is the options a subtree resolves values with. It differs from the
   * document's only inside a `<Component>`, where `{label}` means that
   * component's property rather than a token — so the scope is narrowed on the
   * way in and every node below inherits it.
   */
  /**
   * The token resolver for one mode tuple, or the flat one when there is no
   * index. Recomputed only where a node actually selects a mode, so the common
   * node costs one property read (story G8).
   */
  const aliasFor = (tuple: ModeTuple | null): AliasResolver | undefined =>
    options.tokens && tuple
      ? withModes(options.resolveAlias, options.tokens.resolver.resolve(tuple))
      : options.resolveAlias

  const build = (
    node: UidxNode,
    parentId: string,
    scope: SceneOptions,
    tuple: ModeTuple | null,
  ): void => {
    // ADR 0017 §2: an element with `repeat` is drawn once per element of its
    // list, each row resolving `{item.*}` at its own sample index. The first
    // row is the layer itself — selected, edited and linked like any other,
    // the way Plasmic edits the first of a repeated element — and the rows
    // after it are its echoes: generated content that never links (the
    // instance rule, D4), named `row-2`, `row-3` beside it.
    const repeat = repeatOf(node)
    if (repeat) {
      const spec = scope.component?.spec
      // A list whose model no page in the index declares still draws its
      // rows (an instance row binds through its own definition); the audit
      // is where an unplaceable list is reported.
      const model = repeatModel(repeat, spec, scope.repeats ?? [], scope.models)
      const count = sampleCount(model)
      const row = unrepeated(node)
      for (let index = 0; index < count; index++) {
        const first = index === 0
        const id = addressOf(parentId, first ? node.name : `${node.name}-${index + 1}`)
        const bindings = model
          ? modelSamples(repeat.as, model, index, spec, scope.models)
          : new Map()
        const indexed: SceneOptions = {
          ...scope,
          sampleIndex: index,
          ...(first ? {} : { generated: true }),
          resolveAlias: layerProperties(scope.resolveAlias, bindings),
          repeats: [...(scope.repeats ?? []), { as: repeat.as, model }],
        }
        build(first ? row : readdressed(row, id), parentId, indexed, tuple)
      }
      return
    }
    // Generated nodes (instance clones, repeat rows) have no source span to
    // patch. A *derived* node (ADR 0016 §4) is synthetic too, but addressable:
    // an edit to it goes to the style row its address names.
    if ((!node.synthetic || node.derived) && !scope.generated)
      addresses.link(node.address, node.address)

    // Figma's explicitVariableModes layered over resolvedVariableModes: the
    // attribute is what this node sets, the tuple is what it ends up with.
    // Merging on the way *down* is what makes this O(1) per node — nothing in
    // this design ever walks up.
    const declaredModes = node.attrs.modes?.value
    const next =
      options.tokens &&
      tuple &&
      declaredModes !== null &&
      typeof declaredModes === 'object' &&
      !Array.isArray(declaredModes)
        ? mergeModes(tuple, declaredModes as Record<string, string>, options.tokens.index)
        : tuple

    let inner: SceneOptions = next === tuple ? scope : { ...scope, resolveAlias: aliasFor(next) }

    // A component's properties shadow an enclosing component's completely, so
    // this rebuilds from the token layer rather than from `inner` — but from
    // the *mode-aware* token layer, so a component under a dark frame is dark.
    if (node.element === 'Component') {
      inner = {
        ...inner,
        component: node,
        repeats: [],
        resolveAlias: withProperties(
          aliasFor(next),
          declaredDefaults(node, scope.sampleIndex, scope.models),
        ),
      }
    }

    pins.link(node.address, pinFrom(node.attrs, inner.rootFontSize, inner.resolveAlias))
    graph.createNodeWithId(
      node.address,
      nodeTypeFor(node),
      parentId,
      instanceProps(node, warnings, inner, graph.getNode(parentId)?.layoutMode),
    )

    if (node.element === 'Instance') {
      expandInstance(graph, addresses, pins, node, warnings, inner)
      return
    }

    for (const child of node.children) {
      build(child, node.address, inner, next)
    }
  }

  const rootTuple = options.tokens ? defaultTuple(options.tokens.index) : null
  const rootScope: SceneOptions =
    rootTuple === null ? options : { ...options, resolveAlias: aliasFor(rootTuple) }
  for (const entity of doc.tree.children) build(entity, rootId, rootScope, rootTuple)

  // Construction alone does not lay anything out: `createNodeWithId` writes the
  // layout properties but never runs the layout engine, so every auto-layout
  // frame keeps its default 100x100 size and the component renders wrong.
  //
  // Per entity rather than once at the root: a page has no layout of its own,
  // and its children are laid out independently of each other.
  let unmeasuredText = 0
  for (const entity of doc.tree.children) {
    unmeasuredText += layOutEntity(graph, entity.address, pins)
  }

  return {
    graph,
    rootId,
    warnings,
    addresses,
    pins,
    unmeasuredText,
    rootFontSize: options.rootFontSize,
  }
}

/**
 * Everything that has to happen to one top-level entity before it can be drawn.
 *
 * One function because the build path and the update path must never disagree
 * about it: `toSceneGraph` calls this per entity after construction, and
 * `applyChanges` calls it per entity after a diff lands. They used to hold two
 * copies of the same loop.
 *
 * A component *set* is the layout rule one level down — it has no layout of its
 * own either, and each variant hugs its own content — so its variants are laid
 * out one by one and then arranged. `computeAllLayouts` on the set would leave
 * every variant at its default 100x100 box, which is what made the arrangement
 * a measured pass rather than an auto-layout.
 */
export function layOutEntity(graph: SceneGraph, entityId: string, pins: PinMap): number {
  const unmeasured = new Set<string>()
  const measure = getTextMeasurer()
  // Yoga measures flow text itself. Observe its actual requests, including
  // wrapping constraints, so those estimates count without measuring twice.
  if (measure)
    setTextMeasurer((node, maxWidth) => {
      const result = measure(node, maxWidth)
      if (result === null) unmeasured.add(node.id)
      return result
    })
  try {
    measureFreeText(graph, entityId, unmeasured)
    if (!layOutSets(graph, entityId)) computeAllLayouts(graph, entityId)
    // Pins read the sizes layout just resolved, so they run last.
    resolvePins(graph, entityId, pins)
    return unmeasured.size
  } finally {
    if (measure) setTextMeasurer(measure)
  }
}

/**
 * Lays out what one changed node can have moved (spec §3).
 *
 * The node's own subtree first, then one pass over each auto-layout ancestor —
 * the same rule the SDK editor's `runLayoutForNode` applies after a gesture —
 * and finally the entity's variant arrangement and pins, which read sizes the
 * passes above may have changed. `layOutEntity` over every top-level entity
 * was measured at 0.6–0.9 s on the atlas page for a one-attribute change; this
 * is the part of that work the change could actually have invalidated.
 */
export function layOutAround(graph: SceneGraph, id: string, rootId: string, pins: PinMap): void {
  const node = graph.getNode(id)
  if (!node) return
  // A hidden node draws nothing and takes no space, so laying its subtree out
  // is work nobody can see — and on this page that subtree is 960 nodes.
  if (node.visible !== false) {
    measureFreeText(graph, id)
    computeAllLayouts(graph, id)
  }

  // Up the ancestors only while boxes keep moving. A change that leaves a
  // frame the same size cannot have moved anything above it, and the frames
  // above are the expensive ones: the page's own section is 6k nodes.
  let entityId = id
  let parent = node.parentId ? graph.getNode(node.parentId) : undefined
  while (parent && parent.id !== rootId) {
    entityId = parent.id
    const before = { width: parent.width, height: parent.height }
    if (parent.layoutMode !== 'NONE') computeLayout(graph, parent.id)
    const settled = parent.width === before.width && parent.height === before.height
    parent = parent.parentId ? graph.getNode(parent.parentId) : undefined
    if (settled && parent && parent.id !== rootId) {
      // Nothing above moved, but pins are scoped per entity, so keep walking
      // the addresses to name it without laying anything else out.
      let top = graph.getNode(entityId)
      while (top?.parentId && top.parentId !== rootId) top = graph.getNode(top.parentId)
      if (top) entityId = top.id
      break
    }
  }
  layOutSets(graph, entityId)
  resolvePins(graph, entityId, pins)
}

/* ------------------------------------- text nobody lays out (the 100x100 bug) */

/**
 * Sizes the auto-sized text that the layout engine will never reach.
 *
 * Yoga is the only thing in the SDK that measures a `<Text>`, and it only ever
 * sees the children of a frame it is laying out: `computeLayoutsBottomUp` skips
 * any node whose `layoutMode` is `NONE`, and `configureAbsoluteChild` — the
 * branch an `ABSOLUTE` child takes even inside an auto-layout parent — sets the
 * node's stored width and height rather than a measure function. A label
 * positioned by hand therefore kept the box `createNodeWithId` gave it, which
 * is the scene graph's constructed default: a 100x100 square.
 *
 * That is quiet in the worst way. The renderer measures text independently of
 * the node's box, so the glyphs still drew at their own size and the page
 * looked right — while selection drew a square, the hit target was a square,
 * and `textAlignVertical` pushed the glyphs down half a box that was not
 * theirs (`textVerticalOffset` divides `node.height` by two for `CENTER`).
 * Observed across every screen in `design/`, where the labels are placed by
 * coordinate rather than by flow.
 *
 * Figma has no such rule: an auto-width text is its glyph box wherever it
 * lives. So this is one more scene-graph difference the schema layer absorbs,
 * and it runs *before* layout so that anything sized from these nodes is sized
 * from real numbers.
 *
 * Writing measured geometry onto a node is safe here for the reason D4 already
 * relies on: `isDerivedSize` answers from `textAutoResize` alone, without
 * consulting the parent, so an auto-sized text reads as derived wherever it
 * sits and a reflow burst carrying these numbers is dropped rather than written
 * back to the file. `withLayoutMutations` says the same thing to the graph.
 */
function measureFreeText(
  graph: SceneGraph,
  entityId: string,
  unmeasured = new Set<string>(),
): number {
  graph.withLayoutMutations(() => {
    const walk = (id: string, measuredByParent: boolean): void => {
      const node = graph.getNode(id)
      if (!node) return
      if (node.type === 'TEXT') {
        if (!measuredByParent) {
          if (!measureText(graph, node)) unmeasured.add(node.id)
        } else if (!getTextMeasurer() && node.textAutoResize !== 'NONE') {
          // Headless/early builds have no measurer for Yoga to call at all.
          unmeasured.add(node.id)
        }
        return
      }
      // An `ABSOLUTE` child is placed by its parent but never measured by it,
      // so "the parent flows" is not enough on its own.
      const flows = node.layoutMode !== 'NONE'
      for (const childId of node.childIds ?? []) {
        const child = graph.getNode(childId)
        walk(childId, flows && child?.layoutPositioning !== 'ABSOLUTE')
      }
    }
    // The entity itself has no parent that could have measured it: a bare
    // `<Text>` directly under `<Page>` is the smallest case of this bug.
    walk(entityId, false)
  })
  return unmeasured.size
}

/**
 * One text node, sized by its glyphs.
 *
 * Deliberately the same two lines `textAutoResizeChanges` uses in the SDK's own
 * editor — the measurer when the canvas has installed one, the openType/width
 * estimate when it has not (a headless test, or the first build of a page
 * before fonts finish seeding). Measuring differently here would mean a node
 * changed size the first time somebody edited it.
 */
function measureText(graph: SceneGraph, node: SceneNode): boolean {
  const mode = node.textAutoResize
  if (mode !== 'WIDTH_AND_HEIGHT' && mode !== 'HEIGHT') return true

  // `HEIGHT` is Figma's wrap-and-grow-downward mode: the width is the author's
  // and constrains the measurement; only the height comes back.
  const maxWidth = mode === 'HEIGHT' ? node.width : undefined
  const answer = getTextMeasurer()?.(node, maxWidth) ?? null
  const measured = answer ?? estimateTextSize(node, maxWidth)

  const size: { width?: number; height?: number } = {}
  if (mode === 'WIDTH_AND_HEIGHT' && measured.width > 0) size.width = measured.width
  if (measured.height > 0) size.height = measured.height
  // A measurer that answers zero has told us nothing, and writing a zero box
  // would be worse than leaving the default one.
  if (size.width !== undefined || size.height !== undefined) graph.updateNode(node.id, size)
  return answer !== null
}

/* ------------------------------------------------- variants (story F8) */

/**
 * Places a component's variants side by side and sizes the set around them.
 *
 * ADR 0005 §5. Written straight onto the scene nodes *after* their own layout
 * has run, because the arrangement is a function of the measured sizes and
 * those do not exist until then. Nothing here reaches the file: a `<Variant>`
 * has no legal geometry at all (`isVariantGeometry`, D4's new predicate), so a
 * reflow burst carrying these numbers is dropped rather than written back.
 */
export function layOutComponentSet(graph: SceneGraph, setId: string): void {
  const set = graph.getNode(setId)
  if (!set || set.type !== 'COMPONENT_SET') return

  // The axes off the node rather than off the document, so the update path can
  // do this too: `applyChanges` has a graph and no `<Component>`. They are
  // there because ADR 0005's export bullet puts them there — one fact, read by
  // the arrangement now and by F2's exporter later.
  const axes = new Map<string, readonly string[]>(
    (set.componentPropertyDefinitions ?? [])
      .filter((definition) => definition.type === 'VARIANT')
      .map((definition) => [definition.name, definition.variantOptions ?? []]),
  )

  const boxes: VariantBox[] = []
  for (const id of set.childIds ?? []) {
    const node = graph.getNode(id)
    if (!node) continue
    boxes.push({
      name: id,
      coordinates: parseCoordinates(node.name ?? ''),
      width: node.width ?? 0,
      height: node.height ?? 0,
    })
  }

  const { placements, width, height } = arrangeVariants(axes, boxes)
  for (const { name, x, y } of placements) graph.updateNode(name, { x, y })
  graph.updateNode(setId, { width, height })
}

/** Every variant of every set on the page, re-measured and re-arranged. */
export function layOutSets(graph: SceneGraph, entityId: string): boolean {
  const entity = graph.getNode(entityId)
  if (entity?.type !== 'COMPONENT_SET') return false
  // Per variant, not once at the set: a set has no layout of its own and each
  // variant hugs its own content, and `computeAllLayouts` on the set leaves
  // every variant at its default 100x100 box. That is what made the
  // arrangement a measured pass rather than an auto-layout.
  for (const id of entity.childIds ?? []) computeAllLayouts(graph, id)
  layOutComponentSet(graph, entityId)
  return true
}

/**
 * A derived variant name read back as coordinates.
 *
 * The inverse of `variantName`, and the SDK's own `parseVariantName` in
 * everything but package: `@uidx/format` owns names and cannot depend on the
 * SDK, so the drift test that pins the two lives here — this is the package
 * that can see both spellings.
 */
function parseCoordinates(name: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const part of name.split(',')) {
    const at = part.indexOf('=')
    if (at === -1) continue
    out.set(part.slice(0, at).trim(), part.slice(at + 1).trim())
  }
  return out
}

/**
 * The combination an instance is asking for, and the variant that covers it
 * (ADR 0005 §4).
 *
 * Axes are assigned exactly where F7 assigns TEXT and BOOLEAN properties — one
 * surface, one spelling — so an unset axis falls back to its default and
 * `<Instance component="Button/Primary" />` renders the default combination
 * with nothing said.
 *
 * Undefined when the asked-for combination does not exist. Sparseness is the
 * point of declaring the domain (§2), so this is an ordinary state rather than
 * an error here; `uidx check` reports it at the use site, which is where the
 * author can do something about it.
 */
export function variantFor(
  definition: UidxNode,
  instance: UidxNode | null,
  /**
   * The consumer's scope, for a value the use binds rather than states:
   * `props={{ open: '{item.expanded}' }}` in a repeat asks for the state the
   * row's sample says (ADR 0017 §2), and an unbound alias asks for nothing.
   */
  resolveAlias?: AliasResolver,
): UidxNode | undefined {
  if (!hasVariants(definition)) return undefined
  const { axes } = componentVariants(definition)
  const asked = defaultCombination(axes)
  const assigned = new Map<string, JsonValue>()
  for (const [name, raw] of instance ? declaredInstanceValues(instance).values : new Map()) {
    const target = aliasTarget(raw)
    const value = target === null ? raw : resolveAlias?.(target)
    if (value !== undefined) assigned.set(name, value)
  }
  for (const [axis, domain] of axes) {
    const value = assigned.get(axis)
    if (typeof value === 'string' && domain.includes(value)) asked.set(axis, value)
  }
  // A derived set (ADR 0016) has a `state` axis whose values are the visual
  // boolean props: `open={true}` on the use asks for `state=open`. The first
  // one set wins, since a styles table draws one state at a time.
  const states = axes.get('state')
  if (states && !assigned.has('state')) {
    for (const prop of definition.spec?.contract?.props ?? []) {
      if (prop.visual && prop.type === 'boolean' && assigned.get(prop.name) === true) {
        if (states.includes(prop.name)) {
          asked.set('state', prop.name)
          break
        }
      }
    }
  }
  const wanted = variantName(asked)
  return definition.children.find((child) => child.name === wanted)
}

/* ----------------------------------------- component properties (F6) */

/**
 * An alias resolver that also answers a component's own property names.
 *
 * `scenePropFor` already substitutes `{target}` before the prop table sees it,
 * so a component property needs *no* new path through the mapping layer — only
 * a resolver that knows the names in scope. Which is which is a fact about the
 * address rather than a sigil: a token's global name always contains `#`
 * (`radius#md`), a property name never does.
 *
 * Scoped rather than global, and that is the point. Two components may each
 * declare `label` and mean different things, exactly as two functions may each
 * take an argument called `x`. So this is composed per subtree as the builder
 * descends into a `<Component>` or expands an `<Instance>`, and a page with no
 * components resolves exactly what it always did.
 */
function withProperties(
  base: AliasResolver | undefined,
  values: ReadonlyMap<string, JsonValue>,
): AliasResolver {
  return (address) => (address.includes('#') ? base?.(address) : values.get(address))
}

/**
 * A resolver that adds bare names *without* shadowing the ones below it: a
 * repeat's `{item.name}` sits beside the component's own `{label}`, so a row
 * still reads its component's props (ADR 0017 §2).
 */
function layerProperties(
  base: AliasResolver | undefined,
  values: ReadonlyMap<string, JsonValue>,
): AliasResolver {
  return (address) =>
    address.includes('#') ? base?.(address) : (values.get(address) ?? base?.(address))
}

/** The node without the attributes that made it repeat, so a row does not repeat again. */
function unrepeated(node: UidxNode): UidxNode {
  const attrs = { ...node.attrs }
  delete attrs.repeat
  delete attrs.as
  return { ...node, attrs }
}

/** The subtree re-addressed under `address`, so each row's children have ids of their own. */
function readdressed(node: UidxNode, address: string): UidxNode {
  return {
    ...node,
    address,
    synthetic: true,
    children: node.children.map((child) => readdressed(child, addressOf(address, child.name))),
  }
}

/**
 * A resolver bound to one mode tuple (story G8).
 *
 * The mirror of `withProperties`: that one claims bare names and delegates
 * addresses, this one claims addresses and delegates bare names. Composed, a
 * component's subtree keeps its declared defaults while its tokens resolve in
 * whatever mode the enclosing frame selected.
 */
export function withModes(
  base: AliasResolver | undefined,
  values: ReadonlyMap<string, JsonValue>,
): AliasResolver {
  return (address) => (address.includes('#') ? values.get(address) : base?.(address))
}

/**
 * What a component's own subtree resolves `{name}` to: the declared defaults
 * — from the `props` attribute (F6) and from the contract (ADR 0013 §5),
 * which also answers `{item.field}` with a model's sample (ADR 0015 §2).
 */
function declaredDefaults(
  component: UidxNode,
  sampleIndex = 0,
  models?: ModelIndex,
): Map<string, JsonValue> {
  const out = new Map<string, JsonValue>()
  for (const [name, declaration] of componentProps(component).declared) {
    out.set(name, declaration.default)
  }
  for (const [name, value] of specBindings(component.spec, sampleIndex, models))
    out.set(name, value)
  return out
}

/**
 * What an instance sets, filtered to what its component actually declares and
 * to values of the right type (story F7).
 *
 * Filtered rather than trusted, because a hand-edited file is the case that
 * matters: a value for a property that has since been removed, or a string
 * where a boolean belongs, would otherwise reach the renderer and draw
 * something the document does not mean. `uidx check` names both properly;
 * here they are simply not applied, so the instance falls back to the default
 * and still draws.
 */
/** Whether a use hands a component the current row's item: some prop set to `{as}` of a repeat it sits in. */
function bindsRowItem(instance: UidxNode, repeats: readonly RepeatScope[]): boolean {
  if (!repeats.length) return false
  const names = new Set(repeats.map((scope) => scope.as))
  for (const [, raw] of declaredInstanceValues(instance).values) {
    const target = aliasTarget(raw)
    if (target !== null && names.has(target)) return true
  }
  return false
}

function instanceValues(
  instance: UidxNode,
  definition: UidxNode,
  resolveAlias?: AliasResolver,
): Map<string, JsonValue> {
  const declared = componentProps(definition).declared
  const contract = new Map(
    (definition.spec?.contract?.props ?? []).map((prop) => [prop.name, prop] as const),
  )
  const out = new Map<string, JsonValue>()
  for (const [name, raw] of declaredInstanceValues(instance).values) {
    // `props={{ label: '{label}' }}` passes the consuming component's own
    // property through (ADR 0017 §3), so an alias here is the *consumer's*
    // — resolved in its scope, before the value enters the definition's. A
    // token alias resolves the same way. One that resolves to nothing is
    // left unset, so the instance falls back to the definition's default.
    const target = aliasTarget(raw)
    const value = target === null ? raw : resolveAlias?.(target)
    if (value === undefined) continue
    const declaration = declared.get(name)
    if (declaration) {
      if (matchesType(declaration.type, value)) out.set(name, value)
      continue
    }
    // A component declared by its contract alone (ADR 0013 §5) has no `props`
    // attribute to be found in; its `<Prop>` elements are the declaration.
    const prop = contract.get(name)
    if (prop && matchesSpecType(prop, value)) out.set(name, value)
  }
  return out
}

/**
 * Whether a value fits a contract prop's TypeScript-ish type, to the depth a
 * renderer needs: a boolean where the contract says `boolean`, a number for
 * `number`, a string for `string` or a string enum. Anything else — a model,
 * an array, a union nobody spelt — is trusted; `uidx check` is the audit.
 */
function matchesSpecType(prop: PropSpec, value: JsonValue): boolean {
  if (prop.type === 'boolean') return typeof value === 'boolean'
  if (prop.type === 'number') return typeof value === 'number'
  if (prop.type === 'string' || /^'[^']*'(\s*\|\s*'[^']*')*$/.test(prop.type))
    return typeof value === 'string'
  return true
}

/* ------------------------------------------------- instances (story F3) */

/**
 * What an `<Instance>` node itself is made of.
 *
 * An instance *is* the component, placed somewhere — so it starts from the
 * component's own scene properties and the instance's authored ones are laid
 * over the top. That ordering is the whole semantic: the definition decides
 * what the thing looks like, and the use decides where it sits and what it
 * changes about it.
 *
 * Everything that is not an instance is unchanged, which is why this wraps
 * `scenePropsFor` rather than replacing it.
 *
 * `parentLayout` is the layout of the node this one is placed in. Only an
 * instance's size reads it (`fixedDimensions`), and only to tell which of its
 * width and height an authored stretch or grow fills.
 */
function instanceProps(
  node: UidxNode,
  warnings: string[],
  options: SceneOptions,
  parentLayout?: SceneNode['layoutMode'],
): Partial<SceneNode> {
  const own = scenePropsFor(
    node,
    warnings,
    options.resolveAlias,
    options.resolveAsset,
    options.rootFontSize,
  )
  if (node.element !== 'Instance') return own

  const definition = componentFor(node, warnings, options)
  if (!definition) return own
  return placedProps(node, own, definition, options, parentLayout, warnings)
}

/**
 * What an instance's own scene node is made of, given its definition
 * explicitly — the base is the chosen variant (or the definition), and the
 * instance's own attributes win. The incremental path uses this with the
 * definition before and after a change, so an attribute on a component root
 * reaches every instance root without a rebuild (viewer-at-scale spec §3).
 */
export function instanceRootProps(
  instance: UidxNode,
  definition: UidxNode,
  options: SceneOptions,
  parentLayout?: SceneNode['layoutMode'],
  warnings: string[] = [],
): Partial<SceneNode> {
  const own = scenePropsFor(
    instance,
    warnings,
    options.resolveAlias,
    options.resolveAsset,
    options.rootFontSize,
  )
  return placedProps(instance, own, definition, options, parentLayout, warnings)
}

/** The two above, once the instance's own props are in hand. */
function placedProps(
  instance: UidxNode,
  own: Partial<SceneNode>,
  definition: UidxNode,
  options: SceneOptions,
  parentLayout: SceneNode['layoutMode'] | undefined,
  warnings: string[],
): Partial<SceneNode> {
  // A component with states *is* whichever state this use asked for (ADR 0005
  // §4), so the base is the chosen variant rather than the set — the set is a
  // container for four looks and has none of its own.
  const source = variantFor(definition, instance, options.resolveAlias) ?? definition
  const merged = {
    ...scenePropsFor(
      source,
      warnings,
      options.resolveAlias,
      options.resolveAsset,
      options.rootFontSize,
    ),
    // The instance's own name and geometry win: `scenePropsFor` on the
    // definition brought the component's name with it, and a use is not called
    // by the definition's name.
    ...own,
  }
  return { ...merged, ...instanceSizing(instance, merged.layoutMode, parentLayout) }
}

/**
 * What an `<Instance>`'s own scene node is made of, resolved exactly as the
 * build resolves it: the component found by name (or by the property that
 * names it), its styles table expanded, the chosen variant, and the
 * instance's own attributes and size laid over. For a caller holding the
 * document rather than the build — the viewer asks it how an instance sizes
 * before a resize says otherwise, because the scene node a preview has
 * already moved cannot answer that.
 */
export function instanceSceneProps(
  instance: UidxNode,
  options: SceneOptions,
  parentLayout?: SceneNode['layoutMode'],
): Partial<SceneNode> {
  return instanceProps(instance, [], options, parentLayout)
}

type Dimension = 'width' | 'height'
const DIMENSIONS: readonly Dimension[] = ['width', 'height']

/** The scene field that sizes `dimension` on a node laying out along `layoutMode`. */
const sizingFieldFor = (
  layoutMode: SceneNode['layoutMode'] | undefined,
  dimension: Dimension,
): 'primaryAxisSizing' | 'counterAxisSizing' =>
  (layoutMode === 'HORIZONTAL') === (dimension === 'width')
    ? 'primaryAxisSizing'
    : 'counterAxisSizing'

/**
 * The dimensions an `<Instance>` fixes for itself: the ones it states, less
 * any it told its parent to compute.
 *
 * An instance that states a width has said what its width is — a resize on
 * the canvas writes one, so does a number typed into the panel — and that
 * axis is Fixed whatever its component does. One that states none follows its
 * component: hug, fixed or fill. That is Figma's rule as well, where dragging
 * an instance's handle switches only the axis it moved.
 *
 * A fill the instance authors still wins on its own axis, so a width left
 * over from before a stretch cannot undo the stretch (`instanceFills`).
 */
function fixedDimensions(
  instance: UidxNode,
  parentLayout: SceneNode['layoutMode'] | undefined,
): Dimension[] {
  const fills = instanceFills(instance, parentLayout)
  return DIMENSIONS.filter(
    (dimension) => instance.attrs[dimension] !== undefined && !fills[dimension],
  )
}

/** The attribute that tells an instance's parent to compute one of its dimensions. */
export type InstanceFills = Partial<Record<Dimension, 'layoutGrow' | 'layoutAlign'>>

/**
 * The dimensions an `<Instance>` tells its parent to compute, each with the
 * attribute that says so.
 *
 * `layoutAlign` and `layoutGrow` name the *parent's* axes —
 * `isStretchedByParent` reads them the same way — so the parent's layout has
 * to be known to say whether a stretch fills the width or the height. The
 * viewer asks too: a size chosen on a filled dimension has to let the fill go,
 * or the fill outranks it.
 */
export function instanceFills(
  instance: UidxNode,
  parentLayout: SceneNode['layoutMode'] | undefined,
): InstanceFills {
  const flows =
    (parentLayout === 'HORIZONTAL' || parentLayout === 'VERTICAL') &&
    instance.attrs.layoutPositioning?.value !== 'ABSOLUTE'
  if (!flows) return {}
  const along: Dimension = parentLayout === 'HORIZONTAL' ? 'width' : 'height'
  const across: Dimension = along === 'width' ? 'height' : 'width'
  const grow = instance.attrs.layoutGrow?.value
  return {
    ...(typeof grow === 'number' && grow > 0 ? { [along]: 'layoutGrow' as const } : {}),
    ...(instance.attrs.layoutAlign?.value === 'STRETCH'
      ? { [across]: 'layoutAlign' as const }
      : {}),
  }
}

/**
 * An instance's root, Fixed on each dimension it fixes.
 *
 * Laid over everything else because what it replaces is the component's
 * sizing — `HUG` from a hugging definition, or from the variant a styles table
 * wraps it in — and layout overwrites every hugging axis with the content
 * size, which is how `width={199}` on page1's Button1 came to draw 92 wide. A
 * sizing mode the instance states itself still wins: the author answered that
 * axis in so many words.
 *
 * Nothing here reaches the file. The modes are relative to whatever layout the
 * root is drawn with, which for a styled component is the derived variant's
 * and not the one the author wrote, so the file says it with the size alone
 * (`fromSceneChange` holds the other end of that).
 */
function instanceSizing(
  instance: UidxNode,
  layoutMode: SceneNode['layoutMode'] | undefined,
  parentLayout: SceneNode['layoutMode'] | undefined,
): Partial<SceneNode> {
  if (layoutMode !== 'HORIZONTAL' && layoutMode !== 'VERTICAL') return {}
  const out: Partial<SceneNode> = {}
  for (const dimension of fixedDimensions(instance, parentLayout)) {
    const field = sizingFieldFor(layoutMode, dimension)
    if (instance.attrs[`${field}Mode`] === undefined) out[field] = 'FIXED'
  }
  return out
}

/** The `<Component>` an instance names, or undefined with a warning. */
function componentFor(
  node: UidxNode,
  warnings: string[],
  options: SceneOptions,
): UidxNode | undefined {
  const authored = node.attrs.component?.value
  if (typeof authored !== 'string' || authored === '') return undefined
  // `component` may be filled by an `INSTANCE_SWAP` property (F6). It is a
  // structural prop, so `scenePropFor` never sees it and never substitutes the
  // alias — this is the only place that can.
  const binding = aliasTarget(authored)
  const name = binding === null ? authored : options.resolveAlias?.(binding)
  if (typeof name !== 'string' || name === '') {
    if (binding !== null) warnings.push(`${node.address}: "{${binding}}" resolves to no component`)
    return undefined
  }
  const found = options.resolveComponent?.(name)
  if (!found) {
    warnings.push(`${node.address}: no component named "${name}" in this document`)
    return undefined
  }
  // A definition from another file arrives as written; its styles table has
  // to be expanded here too, so an instance picks a derived variant exactly
  // as it picks an authored one (ADR 0016 §4).
  return derivedOf(found)
}

const derivedDefinitions = new WeakMap<UidxNode, UidxNode>()
function derivedOf(definition: UidxNode): UidxNode {
  const cached = derivedDefinitions.get(definition)
  if (cached) return cached
  const derived = deriveVariants(definition)
  derivedDefinitions.set(definition, derived)
  return derived
}

/**
 * Grows an instance's children from the component it names.
 *
 * Three properties this has to keep, and each is load-bearing:
 *
 * **The generated nodes are absent from the bimap.** That is D4's whole test
 * for "the SDK made this, do not write it" — `fromSceneChange` reads a missing
 * address as unauthored and drops the patch. Until now that rule was written
 * where the events arrive and had nothing to exercise it; these are the nodes
 * it was written for.
 *
 * **Their ids are still the addresses they would have had.** Not to make them
 * writable — they are not linked, so nothing can — but because every other part
 * of the viewer already reads an id as a path, and an opaque id would mean the
 * layers rail, hover and hit-testing each needing a second scheme. Nothing can
 * collide with them either: an `<Instance>` has no authored children, so no
 * real address ever begins with one.
 *
 * **Expansion is recursive and bounded.** A component may hold an instance of
 * another, so the clone has to expand too; `seen` is what stops a document that
 * `uidx check` would reject from taking the renderer down with it. The viewer
 * renders whatever it is handed, including a file that is mid-edit and briefly
 * cyclic, so refusing to recurse is not belt-and-braces — it is the only reason
 * a stack overflow is not one keystroke away.
 */
function expandInstance(
  graph: SceneGraph,
  addresses: MutableAddressMap,
  pins: MutablePinMap,
  node: UidxNode,
  warnings: string[],
  options: SceneOptions,
  seen: readonly string[] = [],
): void {
  const definition = componentFor(node, warnings, options)
  if (!definition) return

  const name = definition.name
  if (seen.includes(name)) {
    warnings.push(
      `${node.address}: "${name}" is an instance of itself (${[...seen, name].join(' → ')})`,
    )
    return
  }
  const chain = [...seen, name]
  const overrides = overrideMap(node)
  /** What the consuming page puts in each hole, keyed by slot name (ADR 0007 §2). */
  const { fills } = slotFills(node)

  /*
   * The clones resolve `{label}` against the *definition's* properties, not the
   * consuming page's scope (story F6). Chained rather than replaced, so a token
   * reference inside the component still reaches the document's resolver — the
   * wrapper only claims the names with no `#` in them. A component's properties
   * therefore shadow an enclosing component's completely, which is right: two
   * components may each declare `label` and mean different things.
   *
   * The instance's own values are laid over the definition's defaults (F7), so
   * an unset property falls back to what the definition says — which is what
   * makes "unset" a real state rather than an empty one, and what C7's dimmed
   * row shows.
   */
  // A row's item reaches the instance only when the use binds it — a prop set
  // to `{item}`, the repeat's own name (ADR 0017 §2). Unbound, it previews like
  // any instance outside a repeat: the editor's chosen sample.
  const row = bindsRowItem(node, options.repeats ?? [])
    ? options.sampleIndex
    : (options.previewIndex ?? options.sampleIndex)
  const scope: SceneOptions = {
    ...options,
    component: definition,
    repeats: [],
    resolveAlias: withProperties(
      options.resolveAlias,
      new Map([
        ...declaredDefaults(definition, row, options.models),
        ...instanceValues(node, definition, options.resolveAlias),
      ]),
    ),
  }

  /**
   * A node of the *fill* — written by the consuming page, so unlike a clone it
   * is authored content: it links into the bimap and may be patched.
   *
   * The scene id follows the definition's position and the address follows the
   * file (ADR 0007 §3), which is the one place the bimap's two maps stop being
   * mirror images. `sceneId` is threaded rather than derived from the address
   * for exactly that reason.
   *
   * Values resolve in `options` — the consuming page's scope — rather than in
   * `scope`, which carries the definition's properties. That split is not new:
   * it is what `overrideProps` already does, and for the same reason. A
   * `{radius#md}` in a fill is the consuming page's token, and a bare `{label}`
   * there is a mistake rather than the component's property.
   */
  const authored = (
    source: UidxNode,
    parentSceneId: string,
    within: SceneOptions = options,
  ): void => {
    const sceneId = addressOf(parentSceneId, source.name)
    if (!within.generated) addresses.link(source.address, sceneId)
    pins.link(sceneId, pinFrom(source.attrs, within.rootFontSize, within.resolveAlias))
    graph.createNodeWithId(
      sceneId,
      nodeTypeFor(source),
      parentSceneId,
      instanceProps(source, warnings, within, graph.getNode(parentSceneId)?.layoutMode),
    )
    // An instance inside a fill expands with the consuming page's scope and
    // this instance's own chain, so a cycle that runs through a fill still
    // terminates.
    if (source.element === 'Instance') {
      expandInstance(
        graph,
        addresses,
        pins,
        { ...source, address: sceneId },
        warnings,
        within,
        chain,
      )
      return
    }
    for (const child of source.children) authored(child, sceneId, within)
  }

  /** A repeat's echo row is a copy under a new name; this remembers the name it was written with. */
  const authoredName = new WeakMap<UidxNode, string>()

  /**
   * `source` is a node of the definition; `relative` is its path inside the
   * component, which is exactly the key an override uses (ADR 0004 §3).
   * `inherited` sits under the node's own props and `pinned` over them — the
   * sizing the instance passes to the frame its component wraps.
   */
  const clone = (
    source: UidxNode,
    parentId: string,
    relative: string,
    inherited: Partial<SceneNode> = {},
    local: SceneOptions = scope,
    pinned: Partial<SceneNode> = {},
  ): void => {
    // ADR 0017 §2 inside a definition being instanced: the same expansion
    // the top-level build does, in the definition's local at each sample
    // index.
    const repeat = repeatOf(source)
    if (repeat) {
      const model = repeatModel(repeat, definition.spec, local.repeats ?? [], local.models)
      const count = sampleCount(model)
      const row = unrepeated(source)
      for (let index = 0; index < count; index++) {
        const bindings = model
          ? modelSamples(repeat.as, model, index, definition.spec, local.models)
          : new Map()
        const indexed: SceneOptions = {
          ...local,
          sampleIndex: index,
          generated: true,
          itemBindings: bindings,
          resolveAlias: layerProperties(local.resolveAlias, bindings),
          repeats: [...(local.repeats ?? []), { as: repeat.as, model }],
        }
        const echo = { ...row, name: index === 0 ? source.name : `${source.name}-${index + 1}` }
        authoredName.set(echo, source.name)
        clone(echo, parentId, relative, inherited, indexed, pinned)
      }
      return
    }
    const id = addressOf(parentId, source.name)
    const props = instanceProps(source, warnings, local, graph.getNode(parentId)?.layoutMode)
    const changed = overrides.get(relative)

    // A generated child has no address to look the document up by, so its pin
    // is recorded here, against the id it was built with. This is what makes
    // ADR 0011's "instances get this for free" true rather than aspirational.
    pins.link(id, pinFrom(source.attrs, local.rootFontSize, local.resolveAlias))
    graph.createNodeWithId(id, NODE_TYPE[source.element as SceneElement], parentId, {
      // Under the node's own props: what the frame says about itself wins over
      // what the instance passes down.
      ...inherited,
      ...props,
      // Except a size the instance states, which is the use deciding.
      ...pinned,
      // An override is written by the *consumer*, so it resolves in the
      // consumer's local rather than the definition's — a token in an override
      // is the consuming page's token, and `{label}` there is not the
      // component's property but a mistake `uidx check` reports.
      ...(changed ? overrideProps(changed, relative, warnings, options) : {}),
    })

    if (source.element === 'Instance') {
      expandInstance(graph, addresses, pins, { ...source, address: id }, warnings, local, chain)
      return
    }

    /*
     * A hole the consumer filled (ADR 0007 §2). The slot's scene node is the
     * definition's — its layout belongs there — but from here down the tree is
     * the consuming page's, so it links and the default is replaced outright
     * rather than merged. A self-closing fill has no children, which is how
     * "explicitly empty" differs from "unfilled".
     */
    if (source.element === 'Slot') {
      // A repeated slot's rows after the first are named `item-2`, `item-3`;
      // the consumer filled `item`, and fills every row (ADR 0017 §2).
      const fill = fills.get(authoredName.get(source) ?? source.name)
      if (fill) {
        // Drawn once per item: the first row is the fill itself, linked and
        // editable; the rest are echoes, like any repeat's. Each copy receives
        // its row's item — the n-th sample — as an instance inside a repeat
        // does, so an injected item component shows the person it is for.
        const row = local.sampleIndex ?? 0
        const echo = (local.repeats?.length ?? 0) > 0 && row > 0
        const filled: SceneOptions = {
          ...options,
          sampleIndex: local.sampleIndex,
          repeats: local.repeats,
          generated: options.generated || echo,
          resolveAlias: local.itemBindings
            ? layerProperties(options.resolveAlias, local.itemBindings)
            : options.resolveAlias,
        }
        if (!filled.generated) addresses.link(fill.address, id)
        for (const child of fill.children) authored(child, id, filled)
        return
      }
    }

    for (const child of source.children)
      clone(child, id, `${relative}${relative ? '/' : ''}${child.name}`, {}, local)
  }

  /*
   * For a component with states, the tree to grow is the chosen variant's, not
   * the set's — whose children are the variants themselves (ADR 0005 §4). This
   * is also what keeps an override key free of the variant: `'container/label'`
   * rather than `'state=hover/container/label'`, so switching state re-applies
   * the override by path and a consuming file never embeds which state it was
   * written against (§3, and ADR 0003's rationale 2).
   */
  const chosen = variantFor(definition, node, options.resolveAlias)
  if (hasVariants(definition) && !chosen) {
    warnings.push(
      `${node.address}: "${name}" has no variant for the combination this instance asks for`,
    )
    return
  }
  const source = chosen ?? definition
  const sizing = frameSizing(node, source)
  // The instance's own node was built just before this, from `instanceProps`
  // — so it already says which dimensions the instance fixes, and at what.
  const pinned = pinnedFrame(node, source, graph.getNode(node.address) ?? {})
  for (const child of source.children) clone(child, node.address, child.name, sizing, scope, pinned)
}

/**
 * The sizing an instance passes to the frame that carries its component's
 * layout.
 *
 * A `<Component>` that declares no geometry is given a hugging vertical layout
 * (`componentSizing`), and a component *with states* has to keep a frame inside
 * each `<Variant>`, because a variant may not carry auto-layout. Both shapes
 * leave a wrapper between the instance and the frame the author actually laid
 * out — and a wrapper nobody wrote must not change how the thing behaves.
 *
 * It did. Measured on two structurally identical trees stretched into the same
 * 520-wide card: as a plain frame the root and its divider both came out 504;
 * as an instance the box came out 504 while the frame inside stayed at its hug
 * width of 15, because the stretch was on the wrapper and the frame beneath it
 * had never been told anything. Every rule under it — a divider running the
 * card's width, a row's cells spacing themselves apart — was drawn against the
 * component's own size instead of the size it was placed at.
 *
 * So the frame *is* the instance's frame: it fills the wrapper unconditionally.
 * That is a no-op when the instance hugs (a hugging box takes its size from the
 * child that fills it), and it is what makes a stretched or grown instance
 * reflow. An explicit width on the frame still wins, in a component exactly as
 * in a frame, which is CSS and is the behaviour a pinned component relies on.
 *
 * `layoutGrow` is passed on only when the instance has it, because it is the
 * *main* axis of a hugging wrapper: a grow with a zero basis inside a container
 * that sizes to its content has no free space to take and can collapse it.
 *
 * Two things are deliberately left alone, and the first was measured as a
 * regression before it was: a frame that declares no `layoutMode` is a leaf to
 * the layout engine, and filling one makes it *skip* the explicit size the
 * author gave it — a 140-wide dial of absolutely placed art drifted off centre
 * that way. A frame that declares a width has already answered the question.
 */
/**
 * The props `expandInstance` gives one generated child of an instance — the
 * copy of `source` (a node inside `definition`) that sits at `relative` under
 * the instance. The incremental path uses this to update a copy in place when
 * the definition's attributes change (spec §3), instead of rebuilding the page;
 * it must therefore compute exactly what `clone` computes: the instance's
 * component-property scope, the definition node's own props, the sizing a
 * bare frame inherits at the first level, and the instance's overrides last.
 */
export function generatedChildProps(
  instance: UidxNode,
  definition: UidxNode,
  source: UidxNode,
  relative: string,
  options: SceneOptions,
  parentLayout?: SceneNode['layoutMode'],
  warnings: string[] = [],
): Partial<SceneNode> {
  const scope: SceneOptions = {
    ...options,
    resolveAlias: withProperties(
      options.resolveAlias,
      new Map([
        ...declaredDefaults(definition),
        ...instanceValues(instance, definition, options.resolveAlias),
      ]),
    ),
  }
  const root = variantFor(definition, instance, options.resolveAlias) ?? definition
  const first = !relative.includes('/')
  const placed = first ? instanceRootProps(instance, definition, options, parentLayout) : {}
  const changed = overrideMap(instance).get(relative)
  return {
    ...(first ? frameSizing(instance, root) : {}),
    ...instanceProps(source, warnings, scope, placed.layoutMode),
    ...(first ? pinnedFrame(instance, root, placed) : {}),
    ...(changed ? overrideProps(changed, relative, warnings, options) : {}),
  }
}

/**
 * The one frame a component wraps, when the component is only a wrapper
 * around it — or undefined for a component that lays itself out (ADR 0008),
 * whose children are its content.
 */
function wrappedFrame(source: UidxNode): UidxNode | undefined {
  if (source.attrs.layoutMode || source.attrs.width || source.attrs.height) return undefined
  return source.children.length === 1 ? source.children[0] : undefined
}

function frameSizing(instance: UidxNode, source: UidxNode): Partial<SceneNode> {
  // A component that lays itself out (ADR 0008) has no wrapper: its children
  // are its content, and stretching each of them would be a different thing.
  const frame = wrappedFrame(source)
  // Only a frame that lays itself out can pass a size on to what it holds.
  if (!frame?.attrs.layoutMode) return {}

  const grow = instance.attrs.layoutGrow?.value
  return {
    ...(frame.attrs.width ? {} : { layoutAlignSelf: 'STRETCH' as const }),
    ...(typeof grow === 'number' && grow > 0 && !frame.attrs.height ? { layoutGrow: grow } : {}),
  }
}

/**
 * The frame `pinnedFrame` hands an instance's size to, if the component has
 * one: a plain frame it wraps. A repeat is a template for many rows rather
 * than the component's frame — each row pinned to the instance's height drew
 * three 200-tall rows in a 200-tall instance — so its rows keep
 * `frameSizing`'s stretch and the size stays on the wrapper.
 */
function pinnableFrame(source: UidxNode): UidxNode | undefined {
  const frame = wrappedFrame(source)
  return frame?.element === 'Frame' && !repeatOf(frame) ? frame : undefined
}

/**
 * The size an instance fixes, carried onto the frame its component wraps.
 *
 * `frameSizing`'s argument one step further: a wrapper nobody wrote must not
 * change how the thing behaves, and a stated size is behaviour too. The
 * wrapper takes the instance's number (`instanceSizing`), and unless the frame
 * the author laid out takes it as well, the instance is a box at the new size
 * with the old drawing in its corner — measured on page1, where the pill
 * stayed 92 wide inside a 199-wide instance.
 *
 * So on each dimension the instance fixes, the frame is that size and Fixed,
 * and the stretch or grow `frameSizing` gave it on that axis is withdrawn.
 * Laid *over* the frame's own props, unlike `frameSizing`: a width on the
 * frame is the component's default, and the use decides what it changes.
 * `placed` is the instance's own scene props, which already say what it fixes.
 */
function pinnedFrame(
  instance: UidxNode,
  source: UidxNode,
  placed: Partial<SceneNode>,
): Partial<SceneNode> {
  const frame = pinnableFrame(source)
  if (!frame) return {}
  const layout = frame.attrs.layoutMode?.value
  const out: Partial<SceneNode> = {}
  for (const dimension of DIMENSIONS) {
    const field = sizingFieldFor(placed.layoutMode, dimension)
    const size = placed[dimension]
    if (instance.attrs[dimension] === undefined || placed[field] !== 'FIXED') continue
    if (typeof size !== 'number') continue
    out[dimension] = size
    if (layout === 'HORIZONTAL' || layout === 'VERTICAL')
      out[sizingFieldFor(layout, dimension)] = 'FIXED'
    // Along the wrapper's main axis the frame was grown, across it stretched.
    if (field === 'primaryAxisSizing') out.layoutGrow = 0
    else out.layoutAlignSelf = 'AUTO'
  }
  return out
}

/** The overrides an instance declares, keyed by path inside the component. */
function overrideMap(node: UidxNode): Map<string, Record<string, JsonValue>> {
  const declared = node.attrs.overrides?.value
  const out = new Map<string, Record<string, JsonValue>>()
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) return out
  for (const [key, value] of Object.entries(declared)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      out.set(key, value as Record<string, JsonValue>)
    }
  }
  return out
}

/**
 * One override entry as scene fields.
 *
 * Through `scenePropFor`, so an override is spelled exactly like the property
 * it replaces — a token alias in an override resolves, an unknown property
 * lints, and neither needs a rule of its own here.
 */
function overrideProps(
  changed: Record<string, JsonValue>,
  relative: string,
  warnings: string[],
  options: SceneOptions,
): Partial<SceneNode> {
  const out: Partial<SceneNode> = {}
  for (const [prop, value] of Object.entries(changed)) {
    const fields = scenePropFor(prop, value, {
      warnings,
      rootFontSize: options.rootFontSize,
      resolveAlias: options.resolveAlias,
      resolveAsset: options.resolveAsset,
      at: relative,
    })
    if (fields) Object.assign(out, fields)
  }
  return out
}

/**
 * A bare `<Component>` carries no size in the canonical example — the layout
 * lives on an inner `<Frame>`. A COMPONENT node defaults to a fixed 100x100
 * box, so without this the component clips its own content and the viewer shows
 * a cropped component. A `<Variant>` is a component in the engine's vocabulary
 * and holds exactly one child, so it wants the same treatment and gets it —
 * which is also what makes the arrangement measurable (`layOutVariants`).
 *
 * Wrapping the single child in a hugging auto-layout makes the component's
 * bounds *be* its content, which is what a component definition implies.
 * An explicit `width`/`height` in the file still wins: `overridesFor` is spread
 * after this.
 *
 * Applies per `<Component>`, not to the root — since ADR 0003 the root is the
 * page, and a `<Frame>` sitting on it is scenery with geometry of its own.
 */
function componentSizing(node: UidxNode): Partial<SceneNode> {
  if (node.attrs.width || node.attrs.height || node.attrs.layoutMode) return {}
  return {
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    clipsContent: false,
  }
}

/**
 * What a `<Text>`'s silence about its size means: the box hugs its glyphs.
 *
 * The engine's own default is `textAutoResize: 'NONE'` — a fixed 100x100 box —
 * but a text that authors no size never chose that box; it is what `createSpec`
 * writes as `WIDTH_AND_HEIGHT` for a clicked text, said here for the hand-
 * written file that never says it. A width alone is Figma's other mode: the
 * box wraps at the width and grows downward (`HEIGHT`).
 *
 * This is also what keeps D4 honest. `isDerivedSize` asks the *scene node*
 * whether a dimension is computed, and Yoga re-announces every flowed child's
 * full rect on every pass — so a text left at `NONE` reads as authored-size,
 * and the first re-layout outside a gesture writes the engine's 100x100 into
 * a file that never mentioned either number (the geometry echo, observed live
 * on bound-card). An explicit `textAutoResize` in the file still wins:
 * `overridesFor` is spread after this. A height alone has no Figma mode —
 * there is no auto-width-fixed-height text — so it keeps the engine's `NONE`.
 */
function textSizing(node: UidxNode): Partial<SceneNode> {
  if (node.attrs.textAutoResize || node.attrs.height) return {}
  return { textAutoResize: node.attrs.width ? 'HEIGHT' : 'WIDTH_AND_HEIGHT' }
}

/**
 * The complete scene-node property set a UIDX node maps to.
 *
 * Exported because reconciliation (`diffDocuments`) has to compute the same
 * thing for two versions of a document and compare them. Sharing this keeps the
 * build path and the update path from ever disagreeing about what a node means.
 */
export function scenePropsFor(
  node: UidxNode,
  warnings: string[] = [],
  resolveAlias?: AliasResolver,
  resolveAsset?: AssetResolver,
  rootFontSize = DEFAULT_ROOT_FONT_SIZE,
): Partial<SceneNode> {
  // A `<Variant>` carries nothing but its coordinates, and those are its
  // *identity* rather than properties of the node (ADR 0005 §2-3) — its name
  // already says them. Returning early rather than filtering them out of
  // `overridesFor`: an axis is not a scene property that happens to be unknown,
  // and letting them reach the prop table would report each one as a §3.3 lint
  // warning, which is the vocabulary accusing itself of its own words.
  if (node.element === 'Variant') {
    return {
      ...componentSizing(node),
      name: node.name,
      // Derived from the name rather than from the attributes, because the name
      // is already in *declared* axis order (ADR 0005 §3) and the attributes are
      // in whatever order they were typed. Keyed by axis name, since ADR 0004
      // made names the addressing currency and the SDK's own ids never reach
      // the file.
      variantPropSpecs: [...parseCoordinates(node.name)].map(([propDefId, value]) => ({
        propDefId,
        value,
      })),
    }
  }

  return {
    // A slot "inherits frame-like properties" (ADR 0007 §1), and the one that
    // matters when it says nothing about its size is this: its box is its
    // placeholder content, not the engine's 100x100 default — which would
    // hold a one-line placeholder in a square and push everything below it.
    ...(node.element === 'Component' || node.element === 'Slot' ? componentSizing(node) : {}),
    ...(node.element === 'Slot' ? { pluginData: [slotMark(node.name)] } : {}),
    ...(hasVariants(node) ? variantDefinitions(node) : {}),
    ...(node.element === 'Text' ? textSizing(node) : {}),
    name: node.name,
    ...overridesFor(node, warnings, resolveAlias, resolveAsset, rootFontSize),
  }
}

/**
 * Marks a slot's frame in the scene. A slot is a `FRAME` there (ADR 0007 §6),
 * and an empty one draws nothing, so the editor needs to tell it apart to
 * outline the hole — on its overlay, never in the scene, which exports.
 */
const SLOT_PLUGIN = 'uidx'
const slotMark = (name: string): { pluginId: string; key: string; value: string } => ({
  pluginId: SLOT_PLUGIN,
  key: 'slot',
  value: name,
})

/** The slot a scene node is the frame of, or null for any other node. */
export function slotOfSceneNode(node: Pick<SceneNode, 'pluginData'>): string | null {
  const mark = node.pluginData?.find(
    (entry) => entry.pluginId === SLOT_PLUGIN && entry.key === 'slot',
  )
  return mark?.value ?? null
}

/**
 * A component's axes, as the engine's own `componentPropertyDefinitions`
 * (ADR 0005 §5 and the F2 row of its table).
 *
 * Written at build time so the arrangement can be recomputed from the graph
 * alone — `applyChanges` has a graph and no document — and so the export F2
 * will write has the definitions already sitting where it needs them. The id is
 * the name: ADR 0004 made names the addressing currency, and Figma's own
 * `Label#8:0` is exactly the qualifier it refused.
 *
 * A component with variants also stops hugging, because its children no longer
 * stack — they are placed by `arrangeVariants`, which sizes the set itself.
 */
function variantDefinitions(component: UidxNode): Partial<SceneNode> {
  return {
    layoutMode: 'NONE',
    componentPropertyDefinitions: [...componentVariants(component).axes].map(([name, options]) => ({
      id: name,
      name,
      type: 'VARIANT' as const,
      defaultValue: options[0] ?? '',
      variantOptions: [...options],
    })),
  }
}

/** Attrs whose array entries may carry a `color` alias (spec §4). */
const PAINT_PROPS: ReadonlySet<string> = new Set(['fills', 'strokes', 'effects'])

/** A Figma colour: `{ r, g, b }` in 0–1, alpha optional. */
function isColor(value: JsonValue): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const { r, g, b } = value as Record<string, JsonValue>
  return typeof r === 'number' && typeof g === 'number' && typeof b === 'number'
}

/**
 * Follows a whole-attribute alias on a paint list. `strokes="{border#default}"`
 * names a COLOR token, and a colour is not a paint list, so it becomes the one
 * solid paint it means. An alias naming a paint list resolves to that list. An
 * unresolved alias comes back untouched: `scenePropFor` reports it, and the
 * caller's array check drops it. Shared by `scenePropFor` and the stroke
 * composition in `scenePropsFor`, which must agree — the composition is what
 * folds `strokeWeight` into each stroke, and a stroke it never saw is drawn
 * with no weight at all.
 */
function wholePaintAlias(value: JsonValue, resolveAlias: AliasResolver | undefined): JsonValue {
  const target = aliasTarget(value)
  if (target === null) return value
  const bound = resolveAlias?.(target)
  if (bound === undefined) return value
  return isColor(bound) ? [{ type: 'SOLID', color: bound }] : bound
}

/**
 * Resolves `color` aliases inside paint/effect entries. An entry whose token
 * is missing is dropped — not the whole attribute — because the renderer's
 * job is to draw what it can (same stance as the attribute-level branch).
 */
function resolvePaintAliases(
  value: JsonValue,
  resolveAlias: AliasResolver | undefined,
  warnings: string[],
  at: string,
): JsonValue {
  if (!Array.isArray(value)) return value
  const out: JsonValue[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      out.push(entry)
      continue
    }
    const color = (entry as Record<string, JsonValue>).color
    const target = color === undefined ? null : aliasTarget(color)
    if (target === null) {
      out.push(entry)
      continue
    }
    const bound = resolveAlias?.(target)
    if (bound === undefined) {
      warnings.push(`${at}: unresolved token "${target}"`)
      continue
    }
    out.push({ ...(entry as Record<string, JsonValue>), color: bound })
  }
  return out
}

/**
 * One authored property as scene fields.
 *
 * Split out of `overridesFor` because the write path needs exactly this and
 * nothing else: the properties panel (C5) changes one prop at a time, and
 * rebuilding the whole node to apply it would overwrite every sibling attribute
 * with what the file still says — discarding the edit in progress.
 *
 * `warnings` collects the §3.3 unknown-prop lint. An unresolved alias returns
 * null rather than a partial, because drawing the literal `"{radius#md}"` is
 * worse than drawing the engine default.
 */
export function scenePropFor(
  prop: string,
  value: JsonValue,
  options: {
    warnings?: string[]
    resolveAlias?: AliasResolver
    resolveAsset?: AssetResolver
    at?: string
    rootFontSize?: number
  } = {},
): Partial<SceneNode> | null {
  const {
    warnings = [],
    resolveAlias,
    resolveAsset,
    at = '<root>',
    rootFontSize = DEFAULT_ROOT_FONT_SIZE,
  } = options
  // Three kinds of attribute are not scene properties and stop here. `name` is
  // the node's identity, the metadata attrs describe a component rather than
  // draw it, and `<Instance>`'s two decide what gets *built* — they are read by
  // `expandInstance`, which is a long way from setting a field on a node
  // (F3). Without this last one they reach the prop table and are reported as
  // unknown, which is the §3.3 lint accusing the vocabulary of its own words.
  if (
    prop === 'rootFontSize' ||
    prop === 'name' ||
    METADATA_ATTRS.has(prop) ||
    STRUCTURAL_PROPS.includes(prop)
  )
    return null

  // A token reference stands for a value, so it is substituted before the prop
  // table ever sees it — the table maps values, not addresses (G5, G6).
  const target = aliasTarget(value)
  let authored = value
  if (target !== null) {
    const bound = resolveAlias?.(target)
    if (bound === undefined) {
      warnings.push(`${at}: unresolved token "${target}"`)
      return null
    }
    // `fills="{surface#accent}"` names a COLOR token for the whole paint list
    // (ADR 0016 §2 writes every style row this way). A colour is not a paint
    // list, so it becomes the one solid paint it means; the per-entry form,
    // `[{ type: 'SOLID', color: '{token}' }]`, still resolves below.
    authored = PAINT_PROPS.has(prop) && isColor(bound) ? [{ type: 'SOLID', color: bound }] : bound
  }

  if (UNITLESS_NUMBER_PROPS.has(prop) && isUnitLength(authored)) {
    warnings.push(`${at}: ${prop} does not accept length units`)
    return null
  }

  // A paint/effect array may carry its own per-entry `color` alias (spec §4),
  // beneath the attribute-level substitution above — resolved before the
  // mapping layer, exactly as the attribute-level alias is.
  const entries = PAINT_PROPS.has(prop)
    ? resolvePaintAliases(authored, resolveAlias, warnings, at)
    : authored

  // Fills only: this scene graph's `Stroke` has no image field, so an image
  // stroke could not draw whatever was mapped into it (see `composeStrokes`).
  const resolvedValue =
    prop === 'fills'
      ? resolveImagePaints(normalizeFills(entries), resolveAsset, warnings, at)
      : entries

  const measured = mapLengthLeaves(prop, resolvedValue, (leaf) => {
    const target = aliasTarget(leaf)
    const literal = target === null ? leaf : resolveAlias?.(target)
    const px = lengthToPx(literal, rootFontSize)
    if (px === null) warnings.push(`${at}: ${prop} expects a finite number, px or rem length`)
    return px ?? 0
  })
  const mapping = mappingFor(prop)
  if (mapping) return mapping.toScene(measured)
  if (isIdentityProp(prop)) return { [prop]: measured } as Partial<SceneNode>

  // Spec §3.3: unknown props are a lint warning, passed through so the format
  // can lead the tool.
  warnings.push(`${at}: unknown property "${prop}" passed through`)
  return { [prop]: measured } as Partial<SceneNode>
}

/**
 * Image paints, as the renderer wants them (ADR 0006 §1).
 *
 * The file says `{ type: 'IMAGE', src, scaleMode }` because a path is what a
 * person can read in a diff; the renderer wants `imageHash` and
 * `imageScaleMode`, because a hash is what a byte store is keyed by. This is
 * the one place the two spellings meet.
 *
 * A `src` nothing resolved keeps its place in the stack and simply does not
 * draw: dropping the paint would silently renumber the stack an author is
 * looking at, and substituting a colour would put one in the design that nobody
 * chose. The warning is what says so.
 */
function resolveImagePaints(
  value: JsonValue,
  resolveAsset: AssetResolver | undefined,
  warnings: string[],
  at: string,
): JsonValue {
  if (!Array.isArray(value)) return value
  return value.map((paint) => {
    if (typeof paint !== 'object' || paint === null || Array.isArray(paint)) return paint
    const record = paint as Record<string, JsonValue>
    if (record.type !== 'IMAGE') return paint

    const src = typeof record.src === 'string' ? record.src : ''
    const hash = src === '' ? undefined : resolveAsset?.(src)
    if (hash === undefined) {
      warnings.push(`${at}: image "${src}" is not available, so that paint does not draw`)
    }
    const { src: _src, scaleMode, ...rest } = record
    return {
      ...rest,
      ...(hash === undefined ? {} : { imageHash: hash }),
      imageScaleMode: typeof scaleMode === 'string' ? scaleMode : 'FILL',
    }
  }) as JsonValue
}

function overridesFor(
  node: UidxNode,
  warnings: string[],
  resolveAlias?: AliasResolver,
  resolveAsset?: AssetResolver,
  rootFontSize = DEFAULT_ROOT_FONT_SIZE,
): Partial<SceneNode> {
  const out: Partial<SceneNode> = {}

  for (const [prop, attr] of Object.entries(node.attrs)) {
    const fields = scenePropFor(prop, attr.value, {
      // `strokes` is resolved again just below, immediately before
      // `composeStrokes` — and that call's result unconditionally overwrites
      // whatever this pass writes to `out.strokes`. This pass still runs (it
      // is the path the properties panel's single-prop write goes through via
      // `scenePropFor` directly, not a composition), but when the value is an
      // array, this pass's per-entry paint-alias warnings (from
      // `resolvePaintAliases` inside `scenePropFor`) would be a duplicate of
      // the ones the composition below already reports, so those get a
      // scratch array instead of the real one. A *whole-attribute* alias
      // (`strokes="{missing#tok}"`, a string, not an array) is different: its
      // warning comes from `scenePropFor`'s attribute-level branch, which the
      // composition below never re-runs — that one must land in the real
      // array or it is lost entirely.
      warnings: prop === 'strokes' && Array.isArray(attr.value) ? [] : warnings,
      resolveAlias,
      resolveAsset,
      rootFontSize,
      at: node.address || '<root>',
    })
    if (fields) Object.assign(out, fields)
  }

  // Strokes are authored as Figma Paints plus node-level weight/align (ADR
  // 0002); the engine wants those folded into each Stroke record. Done here
  // rather than in a PropMapping because it needs sibling attributes.
  if (node.attrs.strokes) {
    const strokes = composeStrokes(
      resolvePaintAliases(
        wholePaintAlias(node.attrs.strokes.value, resolveAlias),
        resolveAlias,
        warnings,
        node.address || '<root>',
      ),
      {
        weight:
          lengthToPx(boundAttr(node, 'strokeWeight', resolveAlias), rootFontSize) ?? undefined,
        align: stringAttr(node, 'strokeAlign', resolveAlias),
        cap: node.attrs.strokeCap?.value,
        join: node.attrs.strokeJoin?.value,
        dashPattern: node.attrs.dashPattern
          ? mapLengthLeaves('dashPattern', node.attrs.dashPattern.value, (v) => {
              const target = aliasTarget(v)
              return lengthToPx(target === null ? v : resolveAlias?.(target), rootFontSize) ?? 0
            })
          : undefined,
      },
    )
    if (strokes) out.strokes = strokes
  }

  if (out.vectorNetwork) {
    out.vectorNetwork = withStrokeEndpoints(
      out.vectorNetwork,
      {
        strokeStartCap: node.attrs.strokeStartCap?.value,
        strokeEndCap: node.attrs.strokeEndCap?.value,
      },
      resolveAlias,
    )
  }
  return out
}

/**
 * A sibling attribute, with a token alias followed to its value.
 *
 * `composeStrokes` needs `strokeWeight` and `strokeAlign` off the node rather
 * than through the prop table, and reading `attrs[prop].value` raw means an
 * alias — a string like `"{stage#hairline}"` — fails the type check and comes
 * back `undefined`. The stroke then silently takes the engine's default weight:
 * the file says one thing and the render shows another, with no warning and a
 * clean audit. Every other bound value on the node resolves, so a page can bind
 * its colours and its spacing and be quietly wrong about only its line weights.
 */
function boundAttr(
  node: UidxNode,
  prop: string,
  resolveAlias: AliasResolver | undefined,
): JsonValue | undefined {
  const value = node.attrs[prop]?.value
  if (value === undefined) return undefined
  const target = aliasTarget(value)
  return target === null ? value : resolveAlias?.(target)
}

function stringAttr(
  node: UidxNode,
  prop: string,
  resolveAlias?: AliasResolver,
): string | undefined {
  const value = boundAttr(node, prop, resolveAlias)
  return typeof value === 'string' ? value : undefined
}
