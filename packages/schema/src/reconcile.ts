import { rootFontSizeOf, DEFAULT_ROOT_FONT_SIZE } from '@uidx/format'
import { SceneGraph, type NodeType, type SceneNode } from '@open-pencil/scene-graph'
import {
  addressDepth,
  addressOf,
  ENTITY_SEP,
  isWithin,
  type SceneElement,
  type UidxDocument,
  type UidxNode,
} from '@uidx/format'

import { pinFrom, type Pin } from './pins.js'
import type { MutablePinMap } from './pin-index.js'
import { defaultTuple, mergeModes, type ModeTuple } from './resolve-modes.js'
import {
  generatedChildProps,
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
   */
  | {
      kind: 'update-generated'
      id: string
      instance: UidxNode
      definition: UidxNode
      relative: string
      prev: UidxNode
      next: UidxNode
    }
  /**
   * An instance's own scene node, recomputed from the instance and its
   * definition before and after — the instance's own attributes changed, or
   * the component (or variant) root's did (spec §3).
   */
  | {
      kind: 'update-instance-root'
      id: string
      prevInstance: UidxNode
      nextInstance: UidxNode
      prevDefinition: UidxNode
      nextDefinition: UidxNode
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

function indexNodes(
  doc: UidxDocument,
): Map<string, { node: UidxNode; parent: string | null; index: number }> {
  const out = new Map<string, { node: UidxNode; parent: string | null; index: number }>()
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
 * ids *are* addresses (ADR 0003), so there is no keying heuristic and no
 * "moved or recreated?" ambiguity. A renamed node changes address and therefore
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
  }

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
    const copies = compositionChanges(before, after)
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

    const props = diffProps(
      previous.node,
      entry.node,
      resolverFor(resolveAlias, tokens, tuples.get(address)),
      rootFontSize,
    )
    if (props) changes.push({ kind: 'update', address, props })

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

type NodeIndex = Map<string, { node: UidxNode; parent: string | null; index: number }>

const usesInstances = (index: NodeIndex): boolean =>
  [...index.values()].some((entry) => entry.node.element === 'Instance')

/** The entity an address belongs to: `#` bounds it from the path inside (ADR 0004 §3). */
function entityOf(address: string): string {
  const cut = address.indexOf(ENTITY_SEP)
  return cut === -1 ? address : address.slice(0, cut)
}

/**
 * What an attribute change inside a component means for the instances on this
 * page (story F3, spec §3).
 *
 * Returns null — rebuild — when something the incremental path cannot express
 * has moved: an instance appearing, disappearing or changing its own
 * attributes (`component`, `overrides`, anything); any structural change
 * inside a component; an attribute change on a `<Component>` or `<Variant>`
 * itself, whose props flow into every instance's root; or a component that is
 * instanced from *inside* another component, whose copies nest under ids this
 * pass does not enumerate.
 *
 * Otherwise returns one `update-generated` per (changed inner node, instance
 * that expands its component and — for a variant set — chose its variant).
 * That is the atlas case: a frame inside one `<Variant>` of a component with
 * fifteen instances on the page, toggled from the layers rail.
 */
function compositionChanges(before: NodeIndex, after: NodeIndex): SceneChange[] | null {
  /** An instance, a component, or anything inside a component. */
  const composed = (index: NodeIndex, address: string): boolean => {
    const entry = index.get(address)
    if (!entry) return false
    if (entry.node.element === 'Instance') return true
    return index.get(entityOf(address))?.node.element === 'Component'
  }

  for (const address of before.keys()) {
    if (!after.has(address) && composed(before, address)) return null
  }

  const instances: { node: UidxNode; previous: UidxNode; address: string }[] = []
  /** Components instanced from *inside* another component — copies this pass cannot enumerate. */
  const nestedInstanced = new Set<string>()
  const changedInner: { address: string; previous: UidxNode; next: UidxNode }[] = []
  /** Instances whose own attributes moved, and definition roots that moved. */
  const changedInstances = new Set<string>()
  const changedRoots = new Set<string>()
  /** Attributes an instance's expansion reads; a change to one is a rebuild. */
  const EXPANDS = ['component', 'props', 'overrides', 'layoutGrow']

  for (const [address, entry] of after) {
    const previous = before.get(address)
    if (!previous) {
      if (composed(after, address)) return null
      continue
    }
    if (entry.node.element === 'Instance') {
      const moved = !deepEqual(attrValues(previous.node), attrValues(entry.node))
      if (moved) {
        if (
          EXPANDS.some((p) => !deepEqual(previous.node.attrs[p]?.value, entry.node.attrs[p]?.value))
        )
          return null
        // Its own look changed — visible, opacity, a size override — which
        // is the instance's root node and nothing underneath it.
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

  const out: SceneChange[] = []
  // Instance roots: the instance's own attributes moved, or its component's
  // root did. Both recompute the root from (instance, definition) before and
  // after; a definition declared on another page is not in these indexes, so
  // its instances stay on the rebuild path.
  for (const instance of instances) {
    const name = instance.node.attrs.component?.value
    if (typeof name !== 'string') continue
    const ownMoved = changedInstances.has(instance.address)
    const rootMoved = changedRoots.has(name)
    if (!ownMoved && !rootMoved) continue
    if (nestedInstanced.has(name)) return null
    const nextDefinition = after.get(name)?.node
    const prevDefinition = before.get(name)?.node
    if (!nextDefinition || !prevDefinition || nextDefinition.element !== 'Component') return null
    out.push({
      kind: 'update-instance-root',
      id: instance.address,
      prevInstance: instance.previous,
      nextInstance: instance.node,
      prevDefinition,
      nextDefinition,
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
      at = parent
    }
    if (variant === null) names.unshift(at.node.name)
    const relative = names.join('/')

    for (const instance of instances) {
      if (instance.node.attrs.component?.value !== definition.name) continue
      const chosen = variantFor(definition, instance.node)
      if (variant !== null && chosen !== variant) continue
      if (variant === null && chosen !== undefined) continue
      out.push({
        kind: 'update-generated',
        id: names.reduce((id, name) => addressOf(id, name), instance.address),
        instance: instance.node,
        definition,
        relative,
        prev: changed.previous,
        next: changed.next,
      })
    }
  }
  return out
}

/** Same element, same attribute names, same source text for each — offsets aside. */
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
 */
export function applyChanges(
  scene: SceneResult,
  changes: readonly SceneChange[],
  options: SceneOptions = {},
): ApplyResult {
  options = { ...options, rootFontSize: options.rootFontSize ?? scene.rootFontSize }
  const { graph, rootId, addresses, pins } = scene
  /** Nodes whose subtree or ancestors may need laying out again, in order. */
  const touched: string[] = []
  for (const change of changes) {
    switch (change.kind) {
      case 'remove': {
        const id = sceneIdOf(change.address, rootId)
        const parent = graph.getNode(id)?.parentId
        graph.deleteNode(id)
        // Deleting a node takes its subtree with it, and so do both maps.
        addresses.unlink(change.address)
        pins.unlink(change.address)
        if (parent) touched.push(parent)
        break
      }
      case 'insert':
        insertSubtree(
          graph,
          change.node,
          sceneIdOf(change.parent, rootId),
          change.index,
          addresses,
          pins,
          change.tuple && options.tokens
            ? {
                ...options,
                resolveAlias: resolverFor(options.resolveAlias, options.tokens, change.tuple),
              }
            : options,
        )
        touched.push(change.node.address)
        break
      case 'update':
        graph.updateNode(sceneIdOf(change.address, rootId), change.props)
        touched.push(sceneIdOf(change.address, rootId))
        break
      case 'update-generated': {
        // A filled slot's subtree is never generated, so the copy may not
        // exist; nothing to update then.
        if (!graph.getNode(change.id)) break
        touched.push(change.id)
        const was = generatedChildProps(
          change.instance,
          change.definition,
          change.prev,
          change.relative,
          options,
        ) as Record<string, unknown>
        const now = generatedChildProps(
          change.instance,
          change.definition,
          change.next,
          change.relative,
          options,
        ) as Record<string, unknown>
        const props: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(now)) {
          if (!deepEqual(was[key], value)) props[key] = value
        }
        const defaults = defaultsFor(NODE_TYPE[change.next.element as SceneElement])
        for (const key of Object.keys(was)) {
          if (key in now || !(key in defaults)) continue
          if (!deepEqual(was[key], defaults[key])) props[key] = defaults[key]
        }
        if (Object.keys(props).length) graph.updateNode(change.id, props as Partial<SceneNode>)
        break
      }
      case 'update-instance-root': {
        if (!graph.getNode(change.id)) break
        touched.push(change.id)
        const was = instanceRootProps(
          change.prevInstance,
          change.prevDefinition,
          options,
        ) as Record<string, unknown>
        const now = instanceRootProps(
          change.nextInstance,
          change.nextDefinition,
          options,
        ) as Record<string, unknown>
        const props: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(now)) {
          if (!deepEqual(was[key], value)) props[key] = value
        }
        const defaults = defaultsFor(NODE_TYPE.Instance)
        for (const key of Object.keys(was)) {
          if (key in now || !(key in defaults)) continue
          if (!deepEqual(was[key], defaults[key])) props[key] = defaults[key]
        }
        if (Object.keys(props).length) graph.updateNode(change.id, props as Partial<SceneNode>)
        break
      }
      case 'pin':
        pins.link(change.address, change.pin)
        break
      // A move keeps the node's address, and addresses are scene ids, so both
      // maps are already right.
      case 'move': {
        const id = sceneIdOf(change.address, rootId)
        const from = graph.getNode(id)?.parentId
        graph.reorderChild(id, sceneIdOf(change.parent, rootId), change.index)
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

/** Addresses are scene ids, except the root `<Page>`, which is the graph's page. */
function sceneIdOf(address: string, rootId: string): string {
  return address === '' ? rootId : address
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
 */
function insertSubtree(
  graph: SceneGraph,
  node: UidxNode,
  parentId: string,
  index: number,
  addresses: MutableAddressMap,
  pins: MutablePinMap,
  options: SceneOptions,
): void {
  graph.createNodeWithId(
    node.address,
    // `nodeTypeFor`, not the bare table: a `<Component>` that declares variants
    // becomes a `COMPONENT_SET`, and an insert has to build the same node the
    // full build would (ADR 0005 §1).
    nodeTypeFor(node),
    parentId,
    scenePropsFor(node, [], options.resolveAlias, options.resolveAsset, options.rootFontSize),
  )
  addresses.link(node.address, node.address)
  pins.link(node.address, pinFrom(node.attrs, options.rootFontSize, options.resolveAlias))
  graph.reorderChild(node.address, parentId, index)
  node.children.forEach((child, i) =>
    insertSubtree(graph, child, node.address, i, addresses, pins, options),
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
