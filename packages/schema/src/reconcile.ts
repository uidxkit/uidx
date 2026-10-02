import { derivedDocument, repeatOf } from './design-system.js'
import { rootFontSizeOf, DEFAULT_ROOT_FONT_SIZE } from '@uidx/format'
import { SceneGraph, type NodeType, type SceneNode } from '@open-pencil/scene-graph'
import {
  addressDepth,
  addressOf,
  aliasTarget,
  ENTITY_SEP,
  hasVariants,
  isWithin,
  type SceneElement,
  type UidxDocument,
  type UidxNode,
} from '@uidx/format'

import { boxTargetOf, INSTANCE_BOX_PROPS, nodeAtPath } from './instance-box.js'
import { pinFrom, type Pin } from './pins.js'
import type { MutablePinMap } from './pin-index.js'
import { defaultTuple, mergeModes, type ModeTuple } from './resolve-modes.js'
import {
  generatedChildProps,
  instanceFills,
  instanceRootProps,
  layOutAround,
  nodeTypeFor,
  NODE_TYPE,
  scenePropsFor,
  variantFor,
  withModes,
  type AliasResolver,
  type MutableAddressMap,
  type SceneOptions,
  type SceneResult,
} from './to-scene.js'

/**
 * A single scene-graph edit derived from comparing two documents.
 *
 * The mirror of `fromSceneChange`: that turns canvas mutations into file
 * patches, this turns file changes into canvas mutations. Both are driven by
 * `PROP_TABLE` so the two directions cannot drift apart.
 */
export type SceneChange =
  | { kind: 'update'; address: string; props: Partial<SceneNode> }
  /** `tuple` is the mode tuple in force at `parent`, so the subtree resolves as the page would (G8). */
  | { kind: 'insert'; parent: string; index: number; node: UidxNode; tuple?: ModeTuple }
  | { kind: 'remove'; address: string }
  | { kind: 'move'; address: string; parent: string; index: number }
  /**
   * A node inside a component changed attributes, and this is one instance's
   * copy of it (spec §3). `prev`/`next` are the definition node before and
   * after; `applyChanges` recomputes the copy's props from each and writes the
   * difference, so an instance override on the same property still wins.
   *
   * `id` spells the copy under the instance's address. `applyChanges` finds it
   * under wherever the instance is drawn, by `relative`: for an instance in a
   * slot fill, that is not its address (ADR 0007 §3).
   */
  | {
      kind: 'update-generated'
      id: string
      instance: UidxNode
      definition: UidxNode
      relative: string
      prev: UidxNode
      next: UidxNode
      /** The mode tuple in force at the instance, so a token resolves as the page draws it there (G8). */
      tuple?: ModeTuple
    }
  /**
   * An instance's own scene node, recomputed from the instance and its
   * definition before and after — the instance's own attributes changed, or
   * the component (or variant) root's did (spec §3). The frame its component
   * wraps is recomputed with it, since that frame takes the instance's box
   * and stated size (ADR 0018 §2). An instance gets no plain `update`.
   *
   * `id` is the instance's address, which `applyChanges` draws where the
   * bimap says, like every other address it is handed.
   */
  | {
      kind: 'update-instance-root'
      id: string
      prevInstance: UidxNode
      nextInstance: UidxNode
      prevDefinition: UidxNode
      nextDefinition: UidxNode
      /**
       * The mode tuple in force at the instance, its own `modes` included: a
       * token on its box binds there (ADR 0018 §5), as one in its definition does.
       */
      tuple?: ModeTuple
    }
  /**
   * A pin changed (ADR 0011).
   *
   * Its own kind because the offsets map to no scene property, so `diffProps`
   * cannot see them — the same blindness `overrides` has, and with a sharper
   * consequence: without this, editing `right={16}` to `right={40}` produces an
   * empty change list, the index keeps the old offset *and* layout never
   * re-runs, so the canvas simply does not move.
   */
  | { kind: 'pin'; address: string; pin: Pin | undefined }

/**
 * Property defaults for a freshly created node of each type.
 *
 * Needed because removing an attribute from the file has to put the scene node
 * back to what it would have been had the attribute never been written — and
 * only the engine knows that value. Built once from a scratch graph.
 */
const defaultsCache = new Map<NodeType, Readonly<Record<string, unknown>>>()

function defaultsFor(type: NodeType): Readonly<Record<string, unknown>> {
  let cached = defaultsCache.get(type)
  if (!cached) {
    const graph = new SceneGraph()
    const page = graph.getPages()[0] ?? graph.addPage('scratch')
    cached = { ...(graph.createNode(type, page.id) as unknown as Record<string, unknown>) }
    defaultsCache.set(type, cached)
  }
  return cached
}

type IndexedNode = { node: UidxNode; parent: string | null; index: number }

/** What a repeat rides on (ADR 0017 §2); a change to one re-expands the rows. */
const REPEATS = ['repeat', 'as']

/** True when a repeat, or a node a repeat draws, was added, removed or changed. */
function repeatChanged(before: Map<string, IndexedNode>, after: Map<string, IndexedNode>): boolean {
  const underRepeat = (index: Map<string, IndexedNode>, address: string): boolean => {
    for (let at: string | null = address; at !== null; at = index.get(at)?.parent ?? null) {
      const node = index.get(at)?.node
      if (node && repeatOf(node)) return true
    }
    return false
  }
  for (const [address] of before)
    if (!after.has(address) && underRepeat(before, address)) return true
  for (const [address, entry] of after) {
    const previous = before.get(address)
    if (!previous) {
      if (underRepeat(after, address)) return true
      continue
    }
    if (REPEATS.some((p) => !deepEqual(previous.node.attrs[p]?.value, entry.node.attrs[p]?.value)))
      return true
    if (
      !deepEqual(attrValues(previous.node), attrValues(entry.node)) &&
      (underRepeat(after, address) || underRepeat(before, address))
    )
      return true
  }
  return false
}

function indexNodes(doc: UidxDocument): Map<string, IndexedNode> {
  const out = new Map<string, IndexedNode>()
  const walk = (node: UidxNode, parent: string | null, index: number): void => {
    out.set(node.address, { node, parent, index })
    node.children.forEach((child, i) => walk(child, node.address, i))
  }
  walk(doc.tree, null, 0)
  return out
}

/**
 * Computes the minimal set of scene edits taking `prev` to `next`.
 *
 * Returns `null` when a full rebuild is required — currently only when the
 * frontmatter `id` changes. Since ADR 0003 that is the *page's* name rather than
 * any node's scene id, so the rebuild is now conservative rather than necessary;
 * it stays until there is a test proving the incremental path handles it.
 * Callers fall back to `toSceneGraph`.
 *
 * Nodes are matched by address, which is exactly why this is tractable: scene
 * ids *are* addresses (ADR 0003), or for slot-fill content the bimap names the
 * one an address is drawn at (ADR 0007 §3), so there is no keying heuristic and
 * no "moved or recreated?" ambiguity. A renamed node changes address and therefore
 * reads as a remove plus an insert — correct, if slightly heavy-handed, and
 * renames are rare enough not to optimise for yet.
 */
export function diffDocuments(
  prev: UidxDocument,
  next: UidxDocument,
  resolveAlias?: AliasResolver,
  tokens?: SceneOptions['tokens'],
): SceneChange[] | null {
  if (prev.frontmatter.id !== next.frontmatter.id) return null
  if (rootFontSizeOf(prev) !== rootFontSizeOf(next)) return null
  // The same expansion the builder applied (ADR 0016 §4): a diff between a
  // derived scene and an underived document would remove every variant.
  prev = derivedDocument(prev)
  next = derivedDocument(next)
  const rootFontSize = rootFontSizeOf(next)

  const before = indexNodes(prev)
  const after = indexNodes(next)
  const tuples = tuplesOf(next, tokens)

  // A `modes` attribute changing re-resolves everything beneath it, which is
  // more than a per-node diff can see; the rebuild is the honest answer.
  for (const [address, entry] of after) {
    const previous = before.get(address)
    if (previous && !deepEqual(previous.node.attrs.modes?.value, entry.node.attrs.modes?.value)) {
      return null
    }
    // A node that kept its address but became another element — an instance
    // detached into a frame, a frame retagged — is a different scene node
    // (another type, and an instance's generated subtree to drop): rebuild.
    if (previous && previous.node.element !== entry.node.element) return null
    // A component that gains its first state, or loses its last, turns into
    // a set of variants or back (ADR 0016 §4) — another scene type, laid out
    // by `arrangeVariants`. The diff would only move children: rebuild.
    if (
      previous &&
      entry.node.element === 'Component' &&
      nodeTypeFor(previous.node) !== nodeTypeFor(entry.node)
    )
      return null
  }

  // ADR 0017 §2: a repeat's echoes (`row-2`, `row-3`) are generated at ids
  // this diff does not enumerate, so what a repeat rides on — the list, the
  // item's name — and anything a repeat draws, its layer and the
  // subtree below, rebuild when they change; the same honesty an instance's
  // copies get. Beside a repeat, the incremental path still serves.
  if (repeatChanged(before, after)) return null

  // Story F3. An instance's subtree is generated from a `<Component>` that may
  // live on another page entirely, so a page-shaped diff cannot see what
  // changed it: an edited `overrides` map produces no property change at all
  // (both of `<Instance>`'s attributes stop at `scenePropFor`), and an edited
  // definition produces changes on nodes the instances only copy.
  //
  // So a document that uses instances rebuilds whenever a component or an
  // instance is involved. Coarse, and deliberately confined: a document with no
  // `<Instance>` in either version takes exactly the path it always did, which
  // is every file in this repo today. Making it incremental means teaching the
  // diff to expand a subtree it has no resolver for, which is a story of its
  // own rather than a line here.
  const generated: SceneChange[] = []
  if (usesInstances(before) || usesInstances(after)) {
    const copies = compositionChanges(before, after, tuples)
    if (copies === null) return null
    generated.push(...copies)
  }

  const changes: SceneChange[] = []

  // Removals first, so an insert never collides with a node still occupying its
  // address, and deepest-first so a parent is not deleted before its children
  // are accounted for.
  const removed = [...before.keys()].filter((address) => !after.has(address))
  for (const address of removed.sort((a, b) => depth(b) - depth(a))) {
    // Skip nodes whose ancestor is also being removed; deleting the ancestor
    // takes the subtree with it.
    if (removed.some((other) => other !== address && isWithin(other, address))) continue
    changes.push({ kind: 'remove', address })
  }

  // Then inserts, shallowest-first so parents exist before their children.
  const added = [...after.keys()].filter((address) => !before.has(address))
  for (const address of added.sort((a, b) => depth(a) - depth(b))) {
    const entry = after.get(address)!
    if (entry.parent === null) return null // the root itself is new: rebuild
    if (added.includes(entry.parent)) continue // arrives with its parent's subtree
    const tuple = tuples.get(entry.parent)
    changes.push({
      kind: 'insert',
      parent: entry.parent,
      index: entry.index,
      node: entry.node,
      ...(tuple ? { tuple } : {}),
    })
  }

  // Surviving nodes: property updates and reordering.
  for (const [address, entry] of after) {
    const previous = before.get(address)
    if (!previous) continue
    // A predicted document shares every untouched node with the document it
    // was predicted from, so identity alone says "unchanged" and skips the
    // scene-prop resolution that otherwise runs for all 7k nodes of a page.
    if (
      previous.node === entry.node &&
      previous.parent === entry.parent &&
      previous.index === entry.index
    ) {
      continue
    }
    // An incremental re-parse copies every node after the edit to move its
    // offsets; the copy's attributes read the same. Comparing the raw text is
    // a string compare per attribute, where resolving scene props is not.
    if (
      previous.parent === entry.parent &&
      previous.index === entry.index &&
      sameAuthoredAttrs(previous.node, entry.node)
    ) {
      continue
    }

    // A binding to the component's contract — `{label}`, `{item.name}` — is
    // resolved by the full build against the component's defaults and its
    // models' samples, a scope this path does not hold: here both sides would
    // read as unbound and the change would vanish (a text rebound from
    // `{item.role}` to `{item.id}` kept drawing the role). Rebuild instead.
    if (rebindsContract(previous.node, entry.node)) return null
    // An instance's own node takes only where it sits, and its box lands on
    // the node that draws it, for most components a level down (ADR 0018 §2).
    // Its attributes painted straight onto its node drew that box behind the
    // component instead. `update-instance-root` recomputes both from the
    // instance and its definition, and what it cannot express rebuilds
    // (`compositionChanges`).
    if (entry.node.element !== 'Instance') {
      const props = diffProps(
        previous.node,
        entry.node,
        resolverFor(resolveAlias, tokens, tuples.get(address)),
        rootFontSize,
      )
      if (props) changes.push({ kind: 'update', address, props })
    }

    const pin = pinFrom(
      entry.node.attrs,
      rootFontSize,
      resolverFor(resolveAlias, tokens, tuples.get(address)),
    )
    if (
      !deepEqual(
        pin,
        pinFrom(
          previous.node.attrs,
          rootFontSize,
          resolverFor(resolveAlias, tokens, tuples.get(address)),
        ),
      )
    ) {
      changes.push({ kind: 'pin', address, pin })
    }

    if (previous.index !== entry.index || previous.parent !== entry.parent) {
      if (entry.parent !== null) {
        changes.push({ kind: 'move', address, parent: entry.parent, index: entry.index })
      }
    }
  }

  // After the definitions' own updates, so a copy is never written before the
  // node it copies.
  changes.push(...generated)
  return changes
}

const depth = addressDepth

/**
 * The mode tuple in force at every address, merged on the way down exactly as
 * `toSceneGraph` merges it (story G8). Without tokens every address maps to
 * null and the flat resolver serves, which is the pre-modes behaviour.
 */
function tuplesOf(
  doc: UidxDocument,
  tokens: SceneOptions['tokens'],
): Map<string, ModeTuple | null> {
  const out = new Map<string, ModeTuple | null>()
  const walk = (node: UidxNode, inherited: ModeTuple | null): void => {
    const declared = node.attrs.modes?.value
    const tuple =
      tokens &&
      inherited &&
      declared !== null &&
      typeof declared === 'object' &&
      !Array.isArray(declared)
        ? mergeModes(inherited, declared as Record<string, string>, tokens.index)
        : inherited
    out.set(node.address, tuple)
    for (const child of node.children) walk(child, tuple)
  }
  walk(doc.tree, tokens ? defaultTuple(tokens.index) : null)
  return out
}

/** The alias resolver for one tuple, or the flat one when there is no index. */
function resolverFor(
  base: AliasResolver | undefined,
  tokens: SceneOptions['tokens'],
  tuple: ModeTuple | null | undefined,
): AliasResolver | undefined {
  return tokens && tuple ? withModes(base, tokens.resolver.resolve(tuple)) : base
}

/** `options` resolving tokens in `tuple`'s modes: as the page draws the node a change is for (G8). */
function inModes(options: SceneOptions, tuple: ModeTuple | undefined): SceneOptions {
  return tuple && options.tokens
    ? { ...options, resolveAlias: resolverFor(options.resolveAlias, options.tokens, tuple) }
    : options
}

type NodeIndex = Map<string, { node: UidxNode; parent: string | null; index: number }>

const usesInstances = (index: NodeIndex): boolean =>
  [...index.values()].some((entry) => entry.node.element === 'Instance')

/** The entity an address belongs to: `#` bounds it from the path inside (ADR 0004 §3). */
function entityOf(address: string): string {
  const cut = address.indexOf(ENTITY_SEP)
  return cut === -1 ? address : address.slice(0, cut)
}

/**
 * What a change to an instance, or inside a component, means for the
 * instances on this page (story F3, spec §3).
 *
 * Returns null — rebuild — when something the incremental path cannot express
 * has moved: an instance appearing or disappearing, or changing what it
 * expands (`EXPANDS`); a fill written or taken away, which swaps the
 * definition's default content in that slot for the page's own (ADR 0007
 * §2); any structural change inside a component; a component that is
 * instanced from *inside* another component, or content in the fill of an
 * instance a component holds, whose copies nest under ids this pass does not
 * enumerate; a composition's box or size, which the instance it holds draws a
 * level further down (ADR 0018 §2); or a change that a coloured slot fill's
 * text colour reaches (§4).
 *
 * Otherwise returns one `update-instance-root` per instance whose own
 * attributes or component root moved, and one `update-generated` per (changed
 * inner node, instance that expands its component and — for a variant set —
 * chose its variant). That is the atlas case: a frame inside one `<Variant>`
 * of a component with fifteen instances on the page, toggled from the layers
 * rail. Each carries the mode tuple in force at its instance (`tuples`).
 */
function compositionChanges(
  before: NodeIndex,
  after: NodeIndex,
  tuples: ReadonlyMap<string, ModeTuple | null>,
): SceneChange[] | null {
  /** An instance, a component, or anything inside a component. */
  const composed = (index: NodeIndex, address: string): boolean => {
    const entry = index.get(address)
    if (!entry) return false
    if (entry.node.element === 'Instance') return true
    return index.get(entityOf(address))?.node.element === 'Component'
  }

  for (const address of before.keys()) {
    if (after.has(address)) continue
    if (composed(before, address) || isFill(before, address)) return null
  }

  if (colouredFillChanged(before, after)) return null

  // Which dimensions an instance fixes depends on the layout it sits in
  // (`instanceFills`): a stretch fills the width of a column and the height of
  // a row. A parent that turns between the two re-decides that for an
  // instance stating a size beside a fill, and the parent's own update says
  // nothing to the instance's root. (A move to another parent is another
  // address, so a remove and an insert — already a rebuild.)
  for (const [address, entry] of after) {
    const previous = before.get(address)
    if (!previous || entry.node.element !== 'Instance') continue
    const was = layoutOf(before, previous.parent)
    const now = layoutOf(after, entry.parent)
    if (was === now) continue
    const refixed = (node: UidxNode): boolean =>
      (['width', 'height'] as const).some(
        (dimension) =>
          node.attrs[dimension] !== undefined &&
          instanceFills(node, was)[dimension] !== instanceFills(node, now)[dimension],
      )
    if (refixed(previous.node) || refixed(entry.node)) return null
  }

  const instances: { node: UidxNode; previous: UidxNode; address: string }[] = []
  /** Components instanced from *inside* another component — copies this pass cannot enumerate. */
  const nestedInstanced = new Set<string>()
  const changedInner: { address: string; previous: UidxNode; next: UidxNode }[] = []
  /** Instances whose own attributes moved, and definition roots that moved. */
  const changedInstances = new Set<string>()
  const changedRoots = new Set<string>()
  /**
   * Attributes an instance's expansion reads; a change to one is a rebuild.
   * `textFills` reaches every text the instance draws, at any depth: those of
   * the instances it nests and of its slot fill too (ADR 0018 §4).
   */
  const EXPANDS = ['component', 'props', 'overrides', 'layoutGrow', 'textFills']
  for (const [address, entry] of after) {
    const previous = before.get(address)
    if (!previous) {
      if (composed(after, address) || isFill(after, address)) return null
      continue
    }
    if (entry.node.element === 'Instance') {
      const moved = !deepEqual(attrValues(previous.node), attrValues(entry.node))
      if (moved) {
        if (
          EXPANDS.some((p) => !deepEqual(previous.node.attrs[p]?.value, entry.node.attrs[p]?.value))
        )
          return null
        // Where it sits or its outer box changed — visible, a size, a fill —
        // which is the instance's root node and the frame its component
        // wraps, and nothing deeper (`update-instance-root`).
        if (after.get(entityOf(address))?.node.element === 'Component') return null
        changedInstances.add(address)
      }
      if (after.get(entityOf(address))?.node.element === 'Component') {
        // Its copies sit under every instance of the enclosing component, at
        // ids this pass does not enumerate. That only matters if the component
        // *it* instances is the one that changed — recorded, decided below.
        const name = entry.node.attrs.component?.value
        if (typeof name === 'string') nestedInstanced.add(name)
        continue
      }
      instances.push({ node: entry.node, previous: previous.node, address })
      continue
    }
    if (!composed(after, address)) continue
    if (previous.parent !== entry.parent || previous.index !== entry.index) return null
    if (deepEqual(attrValues(previous.node), attrValues(entry.node))) continue
    if (entry.node.element === 'Component' || entry.node.element === 'Variant') {
      // A root's look flows into every instance root; its shape — variants,
      // props, the variant's coordinates — is a rebuild.
      const shape = ['variants', 'props', 'name']
      if (shape.some((p) => !deepEqual(previous.node.attrs[p]?.value, entry.node.attrs[p]?.value)))
        return null
      if (entry.node.element === 'Variant' && entry.node.name !== previous.node.name) return null
      changedRoots.add(entityOf(address))
      continue
    }
    changedInner.push({ address, previous: previous.node, next: entry.node })
  }

  // A definition change can move where a use's box lands (ADR 0018 §2): a
  // wrapper that starts to paint takes the box back from the frame inside it.
  // The node that had it would keep the use's look, so that rebuilds.
  const touched = new Set([...changedRoots, ...changedInner.map((c) => entityOf(c.address))])
  for (const name of touched) {
    const was = before.get(name)?.node
    const now = after.get(name)?.node
    if (was && now && boxPlaces(was).join() !== boxPlaces(now).join()) return null
  }

  const out: SceneChange[] = []
  // Instance roots: the instance's own attributes moved, or its component's
  // root did. Both recompute the root from (instance, definition) before and
  // after; a definition declared on another page is not in these indexes, so
  // its instances stay on the rebuild path.
  for (const instance of instances) {
    const name = instance.node.attrs.component?.value
    const ownMoved = changedInstances.has(instance.address)
    const rootMoved = typeof name === 'string' && changedRoots.has(name)
    if (!ownMoved && !rootMoved) continue
    // With no plain update for an instance, nothing else would say where one
    // that names no component sits.
    if (typeof name !== 'string') return null
    if (nestedInstanced.has(name)) return null
    const nextDefinition = after.get(name)?.node
    const prevDefinition = before.get(name)?.node
    if (!nextDefinition || !prevDefinition || nextDefinition.element !== 'Component') return null
    // A composition hands the use's box and size to the instance it holds
    // (ADR 0018 §2), which draws them on its own frame: a level below the
    // frame this update reaches. So a change to either rebuilds, as does one
    // to the definition's root, which decides whether it composes at all.
    if (
      (composes(prevDefinition, instance.previous) || composes(nextDefinition, instance.node)) &&
      (rootMoved ||
        HANDED_DOWN.some(
          (p) => !deepEqual(instance.previous.attrs[p]?.value, instance.node.attrs[p]?.value),
        ))
    )
      return null
    const tuple = tuples.get(instance.address)
    out.push({
      kind: 'update-instance-root',
      id: instance.address,
      prevInstance: instance.previous,
      nextInstance: instance.node,
      prevDefinition,
      nextDefinition,
      ...(tuple ? { tuple } : {}),
    })
  }
  for (const changed of changedInner) {
    const definition = after.get(entityOf(changed.address))!.node
    if (nestedInstanced.has(definition.name)) return null
    // The chain of names from the variant (or the component) down to the node
    // is both the copy's id under an instance and its `relative` key for
    // overrides — the same two spellings `expandInstance` uses.
    const names: string[] = []
    let variant: UidxNode | null = null
    let at = after.get(changed.address)!
    while (at.parent !== null && at.parent !== definition.address) {
      names.unshift(at.node.name)
      const parent = after.get(at.parent)!
      if (parent.node.element === 'Variant') {
        variant = parent.node
        break
      }
      // In the fill of an instance the component holds: every copy sits
      // where that instance's own definition puts the slot, which these
      // names do not say (ADR 0007 §3), and the bimap holds one copy under
      // the component's address. Neither can be found from here.
      if (parent.node.element === 'Instance') return null
      at = parent
    }
    if (variant === null) names.unshift(at.node.name)
    const relative = names.join('/')

    for (const instance of instances) {
      if (instance.node.attrs.component?.value !== definition.name) continue
      const chosen = variantFor(definition, instance.node)
      if (variant !== null && chosen !== variant) continue
      if (variant === null && chosen !== undefined) continue
      // Its texts take the colour of the instance whose fill it sits in
      // (ADR 0018 §4), and the copy is computed without it. The rebuild keeps
      // the cascade exact; carrying the colour is a later saving.
      if (inColouredFill(after, instance.address)) return null
      const tuple = tuples.get(instance.address)
      out.push({
        kind: 'update-generated',
        id: names.reduce((id, name) => addressOf(id, name), instance.address),
        instance: instance.node,
        definition,
        relative,
        prev: changed.previous,
        next: changed.next,
        ...(tuple ? { tuple } : {}),
      })
    }
  }
  return out
}

/**
 * What a composition hands the instance it holds, as if that instance had
 * stated it (ADR 0018 §2): the use's box, and the size it fixes, which turns
 * on what the use says about its size and on what its parent fills.
 */
const HANDED_DOWN: readonly string[] = [
  ...INSTANCE_BOX_PROPS,
  'width',
  'height',
  'layoutGrow',
  'layoutAlign',
  'layoutPositioning',
  'primaryAxisSizingMode',
  'counterAxisSizingMode',
]

/** Where a component draws a use's box (`boxTargetOf`), for each variant it may draw. */
function boxPlaces(definition: UidxNode): string[] {
  const sources = hasVariants(definition)
    ? definition.children.filter((child) => child.element === 'Variant')
    : [definition]
  return sources.map((source) => {
    const target = boxTargetOf(source)
    return target.kind === 'self' ? 'self' : `${target.kind}:${target.path.join('/')}`
  })
}

/** Whether `instance` draws a composition: a component holding one instance and nothing else. */
function composes(definition: UidxNode, instance: UidxNode): boolean {
  return boxTargetOf(variantFor(definition, instance) ?? definition).kind === 'instance'
}

/**
 * Whether `address` is a fill: a `<Slot>` written under an instance, whose
 * content takes the place of the definition's default there (ADR 0007 §2).
 */
function isFill(index: NodeIndex, address: string): boolean {
  const parent = index.get(address)?.parent ?? null
  return parent !== null && index.get(parent)?.node.element === 'Instance'
}

/**
 * Whether `address` sits in the fill of an instance that hands its texts a
 * colour (ADR 0018 §4), at any depth. Nothing but fill content has an
 * instance above it in the file.
 */
function inColouredFill(index: NodeIndex, address: string): boolean {
  const parent = index.get(address)?.parent ?? null
  for (let at: string | null = parent; at !== null; at = index.get(at)?.parent ?? null) {
    const node = index.get(at)?.node
    if (node?.element === 'Instance' && node.attrs.textFills !== undefined) return true
  }
  return false
}

/**
 * True when a node was added to the fill of an instance that hands its texts
 * a colour, or a text there stopped stating its own fills (ADR 0018 §4). Both
 * now take that colour, where an insert or an update draws a node only as the
 * file states it. A text that states its fills keeps them, so any other edit
 * there is still an update.
 */
function colouredFillChanged(before: NodeIndex, after: NodeIndex): boolean {
  for (const [address, entry] of after) {
    const previous = before.get(address)
    if (previous?.node === entry.node) continue
    const inherits =
      !previous ||
      (entry.node.element === 'Text' &&
        entry.node.attrs.fills === undefined &&
        previous.node.attrs.fills !== undefined)
    if (inherits && inColouredFill(after, address)) return true
  }
  return false
}

/** The layout a node lays its children out on, as the file states it. */
function layoutOf(index: NodeIndex, address: string | null): SceneNode['layoutMode'] | undefined {
  const value = address === null ? undefined : index.get(address)?.node.attrs.layoutMode?.value
  return typeof value === 'string' ? (value as SceneNode['layoutMode']) : undefined
}

/** Same element, same attribute names, same source text for each — offsets aside. */
/** Whether an attribute moved to or from a contract binding (an alias with no `#`). */
function rebindsContract(a: UidxNode, b: UidxNode): boolean {
  const contractAlias = (value: unknown): boolean => {
    if (typeof value !== 'string') return false
    const target = aliasTarget(value)
    return target !== null && !target.includes('#')
  }
  for (const k of new Set([...Object.keys(a.attrs), ...Object.keys(b.attrs)])) {
    const before = a.attrs[k]
    const after = b.attrs[k]
    if (before?.raw === after?.raw) continue
    if (contractAlias(before?.value) || contractAlias(after?.value)) return true
  }
  return false
}

function sameAuthoredAttrs(a: UidxNode, b: UidxNode): boolean {
  if (a.element !== b.element) return false
  const ka = Object.keys(a.attrs)
  if (ka.length !== Object.keys(b.attrs).length) return false
  for (const k of ka) {
    const other = b.attrs[k]
    if (!other || other.raw !== a.attrs[k]!.raw) return false
  }
  return true
}

const attrValues = (node: UidxNode): Record<string, unknown> =>
  Object.fromEntries(Object.entries(node.attrs).map(([k, a]) => [k, a.value]))

/** Changed, added and removed properties for one node, or null if identical. */
function diffProps(
  prev: UidxNode,
  next: UidxNode,
  resolveAlias?: AliasResolver,
  rootFontSize = DEFAULT_ROOT_FONT_SIZE,
): Partial<SceneNode> | null {
  const before = scenePropsFor(prev, [], resolveAlias, undefined, rootFontSize) as Record<
    string,
    unknown
  >
  const after = scenePropsFor(next, [], resolveAlias, undefined, rootFontSize) as Record<
    string,
    unknown
  >
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(after)) {
    if (!deepEqual(before[key], value)) out[key] = value
  }
  // An attribute deleted from the file must go back to the engine default, not
  // linger at whatever the author last set.
  const defaults = defaultsFor(NODE_TYPE[next.element as SceneElement])
  for (const key of Object.keys(before)) {
    if (key in after) continue
    if (!(key in defaults)) continue
    if (!deepEqual(before[key], defaults[key])) out[key] = defaults[key]
  }

  return Object.keys(out).length ? (out as Partial<SceneNode>) : null
}

export interface ApplyResult {
  applied: number
  /** Scene ids whose subtree or ancestors were laid out again — what a renderer should re-record. */
  touched: string[]
}

/**
 * Applies scene changes in place, then re-runs layout once.
 *
 * Takes the whole `SceneResult` rather than a graph and a root id because the
 * address bimap has to move with the graph. A rename or a reparent reaches here
 * as a `remove` plus an `insert` (see `diffDocuments` above), so the ids the
 * bimap holds stop existing and the ids that replaced them are unknown to it —
 * and `fromSceneChange` reads an unknown id as "not authored, do not write".
 * The failure is silent: the canvas moves and the file never changes. Keeping
 * the map here, beside the mutation that invalidates it, is what stops the two
 * from drifting; passing it separately would only move the chance to forget.
 *
 * The map is also what says where an address is drawn (`drawnAt`), which for
 * slot-fill content is not the address itself (ADR 0007 §3).
 */
export function applyChanges(
  scene: SceneResult,
  changes: readonly SceneChange[],
  options: SceneOptions = {},
): ApplyResult {
  options = { ...options, rootFontSize: options.rootFontSize ?? scene.rootFontSize }
  const { graph, rootId, addresses, pins } = scene
  const at = (address: string): string => drawnAt(scene, address)
  /** Nodes whose subtree or ancestors may need laying out again, in order. */
  const touched: string[] = []
  for (const change of changes) {
    switch (change.kind) {
      case 'remove': {
        const id = at(change.address)
        const parent = graph.getNode(id)?.parentId
        graph.deleteNode(id)
        // Deleting a node takes its subtree with it, and so do both maps.
        addresses.unlink(change.address)
        pins.unlink(id)
        if (parent) touched.push(parent)
        break
      }
      case 'insert': {
        const parent = at(change.parent)
        // Into a slot fill, a node is drawn under the slot's id, as the build
        // draws the rest of the fill; anywhere else, at its address.
        const id =
          parent === sceneIdOf(change.parent, rootId)
            ? change.node.address
            : addressOf(parent, change.node.name)
        insertSubtree(
          graph,
          change.node,
          id,
          parent,
          change.index,
          addresses,
          pins,
          inModes(options, change.tuple),
        )
        touched.push(id)
        break
      }
      case 'update': {
        const id = at(change.address)
        graph.updateNode(id, change.props)
        touched.push(id)
        break
      }
      case 'update-generated': {
        const instance = at(change.instance.address)
        const id = addressOf(instance, change.relative)
        // A filled slot's subtree is never generated, so the copy may not
        // exist; nothing to update then.
        if (!graph.getNode(id)) break
        touched.push(id)
        const parentLayout = layoutAbove(graph, instance)
        const scoped = inModes(options, change.tuple)
        const was = generatedChildProps(
          change.instance,
          change.definition,
          change.prev,
          change.relative,
          scoped,
          parentLayout,
        )
        const now = generatedChildProps(
          change.instance,
          change.definition,
          change.next,
          change.relative,
          scoped,
          parentLayout,
        )
        const props = movedProps(was, now, NODE_TYPE[change.next.element as SceneElement])
        if (props) graph.updateNode(id, props)
        break
      }
      case 'update-instance-root': {
        const id = at(change.id)
        if (!graph.getNode(id)) break
        touched.push(id)
        const parentLayout = layoutAbove(graph, id)
        const scoped = inModes(options, change.tuple)
        const props = movedProps(
          instanceRootProps(change.prevInstance, change.prevDefinition, scoped, parentLayout),
          instanceRootProps(change.nextInstance, change.nextDefinition, scoped, parentLayout),
          NODE_TYPE.Instance,
          // The canvas flips an instance's sizing to draw a resize live, and
          // `fromSceneChange` keeps that flip out of the file — so the sizing
          // the file implies is measured against the node, not the old file.
          graph.getNode(id),
        )
        if (props) graph.updateNode(id, props)
        const framed = wrappedFrameUpdate(
          id,
          { instance: change.prevInstance, definition: change.prevDefinition },
          { instance: change.nextInstance, definition: change.nextDefinition },
          scoped,
          parentLayout,
        )
        if (framed && graph.getNode(framed.id)) graph.updateNode(framed.id, framed.props)
        break
      }
      case 'pin':
        pins.link(at(change.address), change.pin)
        break
      // A move keeps the node's address, and so where it is drawn: both maps
      // are already right.
      case 'move': {
        const id = at(change.address)
        const from = graph.getNode(id)?.parentId
        graph.reorderChild(id, at(change.parent), change.index)
        touched.push(id)
        if (from) touched.push(from)
        break
      }
    }
  }
  // Only what the changes can have moved: each touched node's subtree, its
  // auto-layout ancestors, and its entity's variant arrangement and pins. The
  // page has no layout of its own and its entities are independent, so a
  // change inside one never reaches another — laying out every entity here
  // cost 0.6–0.9 s per edit on a 7k-node page.
  const unique = [...new Set(touched)]
  for (const id of unique) layOutAround(graph, id, rootId, pins)
  return { applied: changes.length, touched: unique }
}

/** One version of an instance, with the definition it is drawn from. */
export interface InstanceVersion {
  instance: UidxNode
  definition: UidxNode
}

/**
 * The node a wrapper-shaped component draws its box on takes the instance's
 * outer box and the size it states (`boxTargetOf`, `pinnedFrame`; ADR 0018
 * §2), a level or more below the instance — where a rebuild puts them. This
 * is that node's id and what moves on it when the instance goes from `prev`
 * to `next`, or null when the box is the instance's own node or nothing on it
 * moves. Both sides come from `generatedChildProps`, the build's own rule for
 * that node, so a box or a size written and then cleared is put back exactly.
 * Nothing else under the instance turns on its box or size: a frame the box
 * is found through only wraps it, and hugs it either way.
 *
 * Both versions draw their box at the same place: a definition change that
 * moves it rebuilds (`diffDocuments`).
 *
 * `applyChanges` asks when the file says so. The canvas asks while a resize
 * is still under the author's hand, with the instance as the gesture would
 * leave the file: a build was the only thing that put the size on the frame,
 * so the box moved and the pill inside it waited for the echo. Asking the
 * same question here is what keeps the preview and the echo from disagreeing.
 */
export function wrappedFrameUpdate(
  id: string,
  prev: InstanceVersion,
  next: InstanceVersion,
  options: SceneOptions,
  parentLayout?: SceneNode['layoutMode'],
): { id: string; props: Partial<SceneNode> } | null {
  const prevRoot =
    variantFor(prev.definition, prev.instance, options.resolveAlias) ?? prev.definition
  const nextRoot =
    variantFor(next.definition, next.instance, options.resolveAlias) ?? next.definition
  const target = boxTargetOf(nextRoot)
  if (target.kind === 'self') return null
  const before = nodeAtPath(prevRoot, target.path)
  if (!before) return null
  const relative = target.path.join('/')
  const props = movedProps(
    generatedChildProps(prev.instance, prev.definition, before, relative, options, parentLayout),
    generatedChildProps(
      next.instance,
      next.definition,
      target.node,
      relative,
      options,
      parentLayout,
    ),
    NODE_TYPE[target.node.element as SceneElement],
  )
  return props ? { id: target.path.reduce(addressOf, id), props } : null
}

/** Addresses are scene ids, except the root `<Page>`, which is the graph's page. */
function sceneIdOf(address: string, rootId: string): string {
  return address === '' ? rootId : address
}

/**
 * Where the scene draws an address: `sceneIdOf`, unless the bimap records
 * otherwise. It does for slot-fill content, whose id follows where the
 * definition puts the slot while its address follows the file (ADR 0007 §3),
 * so `p#content/btn` can be drawn at `p#root/body/content/btn`. A change is
 * addressed by the file, so every one goes through here.
 */
function drawnAt(scene: SceneResult, address: string): string {
  return scene.addresses.sceneIdOf(address) ?? sceneIdOf(address, scene.rootId)
}

/** The fields that say whether layout computes a dimension or keeps the one it is given. */
const SIZING_FIELDS = ['primaryAxisSizing', 'counterAxisSizing'] as const

/**
 * What changed between a node's props before and after, as a scene update,
 * or null for nothing. A prop that stopped being computed goes back to the
 * engine's default for the type, which is what a rebuild would leave there.
 *
 * `live`, when given, is the node as the scene holds it, and its sizing is
 * compared against `now` directly rather than against `was`.
 */
function movedProps(
  was: Partial<SceneNode>,
  now: Partial<SceneNode>,
  type: NodeType,
  live?: SceneNode,
): Partial<SceneNode> | null {
  const before = was as Record<string, unknown>
  const after = now as Record<string, unknown>
  const props: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(after)) {
    if (!deepEqual(before[key], value)) props[key] = value
  }
  const defaults = defaultsFor(type)
  for (const key of Object.keys(before)) {
    if (key in after || !(key in defaults)) continue
    if (!deepEqual(before[key], defaults[key])) props[key] = defaults[key]
  }
  if (live) {
    for (const field of SIZING_FIELDS) {
      const value = after[field] ?? defaults[field]
      if (!deepEqual(live[field], value)) props[field] = value
    }
  }
  // Layout writes a computed dimension over the node's own, so while an axis
  // hugged or filled, the node held layout's number and not the one either
  // side states. An axis that changes how it is decided gets the stated number
  // back — what a rebuild starts from — or a stretch's 504 stays standing on
  // an axis just made Fixed at 50.
  if (SIZING_FIELDS.some((field) => field in props)) {
    for (const dimension of ['width', 'height']) {
      props[dimension] = after[dimension] ?? defaults[dimension]
    }
  }
  return Object.keys(props).length ? (props as Partial<SceneNode>) : null
}

/** The layout of the node a scene node sits in — what an instance's stretch is measured against. */
function layoutAbove(graph: SceneGraph, id: string): SceneNode['layoutMode'] | undefined {
  const parentId = graph.getNode(id)?.parentId
  return parentId ? graph.getNode(parentId)?.layoutMode : undefined
}

/**
 * An inserted node and everything under it.
 *
 * `options` rather than a bare `resolveAlias`: an inserted node can carry an
 * image fill, and passing only the alias resolver left `resolveAsset` behind —
 * so a `<Rectangle>` inserted incrementally against an image the store had
 * *already* fetched got no `imageHash` and drew nothing until the next
 * rebuild. Narrow (a first reference forces a rebuild anyway, because the bytes
 * arriving is itself a change the diff cannot see) but real, and found while
 * threading the component resolver through the same call.
 *
 * An `<Instance>` never reaches here: `diffDocuments` returns null — rebuild —
 * for every change that touches composition, so an instance is only ever built
 * by `toSceneGraph`, which is the one place that holds the component resolver.
 *
 * `id` is where the node is drawn: its address, or in a slot fill an id that
 * follows the slot's, which every child below it follows in turn (ADR 0007
 * §3) — and which it links under, as the build links fill content.
 */
function insertSubtree(
  graph: SceneGraph,
  node: UidxNode,
  id: string,
  parentId: string,
  index: number,
  addresses: MutableAddressMap,
  pins: MutablePinMap,
  options: SceneOptions,
): void {
  graph.createNodeWithId(
    id,
    // `nodeTypeFor`, not the bare table: a `<Component>` that declares variants
    // becomes a `COMPONENT_SET`, and an insert has to build the same node the
    // full build would (ADR 0005 §1).
    nodeTypeFor(node),
    parentId,
    scenePropsFor(node, [], options.resolveAlias, options.resolveAsset, options.rootFontSize),
  )
  addresses.link(node.address, id)
  pins.link(id, pinFrom(node.attrs, options.rootFontSize, options.resolveAlias))
  graph.reorderChild(id, parentId, index)
  node.children.forEach((child, i) =>
    insertSubtree(
      graph,
      child,
      id === node.address ? child.address : addressOf(id, child.name),
      id,
      i,
      addresses,
      pins,
      options,
    ),
  )
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || a === undefined || b === undefined) {
    return false
  }
  if (typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  return ka.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  )
}
