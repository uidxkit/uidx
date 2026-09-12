import { variantFor } from '@uidx/schema'
import {
  addressOf,
  ENTITY_SEP,
  PATH_SEP,
  slotFills,
  type UidxDocument,
  type UidxElement,
  type UidxNode,
} from '@uidx/format'

/**
 * One row of the layers rail.
 *
 * Read from the document rather than the scene graph, which is what makes
 * `address` do three jobs at once: it is the row's identity, the target of any
 * patch the row emits, and the scene-graph node id the canvas selects by. No
 * lookup sits between a row and the file it edits.
 */
export interface LayerRow {
  /** 'Button/Primary#container/label'. The root <Page> is the empty string. */
  address: string
  name: string
  element: UidxElement
  depth: number
  hasChildren: boolean
  /** From the `visible` attribute, defaulting true when it is not declared. */
  visible: boolean
  /** Whether `visible` is authored, which decides between a `set` and an `add`. */
  declaresVisible: boolean
  /**
   * An `<Instance>`'s child, grown from the component rather than written down
   * (story F3).
   *
   * The rail reads the document, and these are the one thing in the canvas the
   * document does not contain — so without them the rail shows a structure the
   * canvas contradicts, an instance appearing as a leaf while the scene beneath
   * it is a whole subtree. They are shown and they are inert: no rename, no
   * drag, no visibility toggle, no selection, because `address` here names a
   * node that is deliberately absent from the bimap and every one of those
   * would be a patch aimed at a line that does not exist.
   */
  generated: boolean
  /**
   * A `<Variant>`: authored, but named and placed by something other than the
   * author (story F8, ADR 0005 §3 and §5).
   *
   * Not the same claim as `generated` — this row *has* a line in the file, so
   * it is selectable and its contents are ordinary editable nodes. What it does
   * not have is a name of its own (its coordinates spell one), a position of
   * its own (`arrangeVariants` computes it) or any legal scene attribute at all
   * (`visible` on a `<Variant>` is UIDX118). So the rail shows it and offers no
   * rename, no drag and no visibility toggle — three gestures that would each
   * write a line the format rejects.
   */
  derived: boolean
}

/** A component name to its definition, for expanding instances (ADR 0004 §2). */
export type ComponentIndex = ReadonlyMap<string, UidxNode>

/** The whole document, depth-first, root first. Collapse is applied separately. */
export function layerRows(doc: UidxDocument | null, components?: ComponentIndex): LayerRow[] {
  if (!doc) return []
  const out: LayerRow[] = []

  const rowFor = (
    node: UidxNode,
    address: string,
    depth: number,
    generated: boolean,
  ): LayerRow => ({
    address,
    name: node.name,
    element: node.element,
    depth,
    hasChildren: node.children.length > 0,
    // Absent means visible. Reading a missing attribute as `false` would
    // show every node in the file as hidden.
    visible: node.attrs.visible?.value !== false,
    declaresVisible: node.attrs.visible !== undefined,
    generated,
    derived: node.element === 'Variant',
  })

  /**
   * An instance's children, addressed exactly as `toSceneGraph` addresses them
   * — the address a node would have had if it were written there. The two have
   * to agree because the rail's `address` is also the scene id it selects by,
   * and `seen` bounds the same loop the scene builder bounds, for the same
   * reason: a file is briefly cyclic while somebody is typing.
   */
  const expand = (
    node: UidxNode,
    address: string,
    depth: number,
    seen: readonly string[],
  ): void => {
    const name = node.attrs.component?.value
    const definition = typeof name === 'string' ? components?.get(name) : undefined
    if (!definition || seen.includes(definition.name)) return
    const chain = [...seen, definition.name]
    /** What this use puts in each hole, keyed by slot name (ADR 0007 §2). */
    const { fills } = slotFills(node)
    const clone = (source: UidxNode, parent: string, at: number): void => {
      const id = addressOf(parent, source.name)

      /*
       * A hole the consuming page filled — the one thing under an instance
       * that is *not* generated (story F5).
       *
       * The row carries the fill's own address rather than the cloned `id`,
       * because that is the divergence ADR 0007 §3 introduces: the scene id
       * follows the definition's position, the address follows the file, and
       * the rail selects by address. Marked authored, so it renames, drags and
       * toggles like any other row — which is the whole point of the story.
       */
      const fill = source.element === 'Slot' ? fills.get(source.name) : undefined
      if (fill) {
        const row = rowFor(fill, fill.address, at, false)
        row.hasChildren = fill.children.length > 0
        out.push(row)
        for (const child of fill.children) walk(child, at + 1)
        return
      }

      out.push(rowFor(source, id, at, true))
      if (source.element === 'Instance') {
        expand(source, id, at + 1, chain)
        return
      }
      for (const child of source.children) clone(child, id, at + 1)
    }
    // A component with states grows the tree of the state this use asked for,
    // exactly as `expandInstance` does — the two have to agree, because the
    // rail's `address` is the scene id it selects by (ADR 0005 §4).
    const chosen = variantFor(definition, node)
    if (chosen === undefined && definition.children.some((c) => c.element === 'Variant')) return
    for (const child of (chosen ?? definition).children) clone(child, address, depth)
  }

  const walk = (node: UidxNode, depth: number): void => {
    const row = rowFor(node, node.address, depth, false)
    out.push(row)
    if (node.element === 'Instance') {
      const before = out.length
      expand(node, node.address, depth + 1, [])
      row.hasChildren = out.length > before
      return
    }
    for (const child of node.children) walk(child, depth + 1)
  }
  walk(doc.tree, 0)
  return out
}

/** Every `<Component>` a set of pages declares, by its global name (ADR 0004 §2). */
export function componentIndex(docs: Iterable<UidxDocument>): Map<string, UidxNode> {
  const out = new Map<string, UidxNode>()
  for (const doc of docs) {
    if (doc.tree.element === 'Tokens') continue
    for (const node of doc.tree.children) {
      // First declaration wins; a duplicate is a `uidx check` error, and the
      // rail's job is to show something rather than to arbitrate.
      if (node.element === 'Component' && !out.has(node.name)) out.set(node.name, node)
    }
  }
  return out
}

/**
 * The rows a collapsed tree actually shows.
 *
 * Depth-tracking rather than an ancestor test per row: the list is already in
 * document order, so everything under a collapsed row is exactly the run of
 * rows deeper than it.
 */
export function visibleRows(rows: readonly LayerRow[], expanded: ReadonlySet<string>): LayerRow[] {
  const out: LayerRow[] = []
  let hiddenBelow = Number.POSITIVE_INFINITY
  for (const row of rows) {
    if (row.depth > hiddenBelow) continue
    hiddenBelow = Number.POSITIVE_INFINITY
    out.push(row)
    if (row.hasChildren && !expanded.has(row.address)) hiddenBelow = row.depth
  }
  return out
}

/**
 * Every address between the page and this one, outermost first.
 *
 * Used to open the tree down to a canvas selection. The entity boundary matters:
 * ADR 0004 keeps `/` free to be a name character, so `Button/Primary` is one
 * component and splitting the whole address on `/` would invent an ancestor.
 */
export function ancestorsOf(address: string): string[] {
  if (address === '') return []
  const hash = address.indexOf(ENTITY_SEP)
  if (hash === -1) return ['']

  const entity = address.slice(0, hash)
  const out = ['', entity]
  const segments = address.slice(hash + 1).split(PATH_SEP)
  for (let i = 1; i < segments.length; i += 1) {
    out.push(`${entity}${ENTITY_SEP}${segments.slice(0, i).join(PATH_SEP)}`)
  }
  return out
}
