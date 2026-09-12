import { rootFontSizeOf, preserveLengthUnit, isUnitLength } from '@uidx/format'
import { type SceneGraph } from '@open-pencil/scene-graph'
import { hitTestFrame } from '@open-pencil/scene-graph/hit-test'
import { addressOf, isWithin, resolve, type UidxDocument, type UidxPatch } from '@uidx/format'

import { pinFrom, pinWrites } from '@uidx/schema'
import { canContainChildren, canInsert, moveFor, parentOf } from './layer-moves'

/**
 * The containers under a point, innermost first, ending at the page.
 *
 * The scene half of a drop: only the graph knows what the pointer is over.
 * `hitTestFrame` is the SDK's own answer for exactly this question — container
 * types only, and it skips the dragged subtree outright rather than finding it
 * and discarding it afterwards, which is what stops a drag from landing on
 * itself. It returns one node; the chain is that node and its ancestors, so a
 * drop the innermost frame refuses can be answered by the frame around it.
 *
 * The root is always the last link. Its address is `''` (ADR 0003), so a drop
 * on empty canvas promotes a node to a page child — the one way back out of a
 * frame with the pointer alone.
 */
export function containerChainAt(
  graph: SceneGraph,
  rootId: string,
  point: { x: number; y: number },
  draggedId: string,
): string[] {
  const chain: string[] = []
  // Scoped to the page, not to `graph.rootId`: the SDK's own root is a
  // zero-sized document FRAME above the CANVAS, and a scope of it bounds-checks
  // against 0×0 and finds nothing at all.
  let node = hitTestFrame(graph, point.x, point.y, new Set([draggedId]), rootId)
  while (node && node.id !== rootId) {
    chain.push(node.id)
    node = node.parentId ? (graph.getNode(node.parentId) ?? null) : null
  }
  chain.push(rootId)
  return chain
}

/** The reparent a canvas drop implies. */
export interface DropTarget {
  /** The address of the container the node lands in. */
  parent: string
  /** Where the node will answer to afterwards, for selection bookkeeping. */
  address: string
  /**
   * The whole drop, in order: the move, then whatever keeps the node where the
   * pointer left it. One envelope, because the server applies a batch in
   * memory and writes once — a drop that reparented but failed to reposition
   * would be a file state no gesture asked for.
   */
  patches: UidxPatch[]
}

/**
 * Where a dropped node has to sit in its new parent's frame to stay put, or
 * null when the new parent places its children and the answer is not the
 * author's to give (D4).
 *
 * The host works this out, because both halves are scene questions: the offset
 * between two world origins, and `isPositionAuthored` asked of the home the
 * node is about to have.
 */
export type DropPlacement = {
  x: number
  y: number
  /**
   * The dragged node's resolved size and the target's, for a pinned node
   * landing in a plain box: its offsets are re-measured from the new parent's
   * edges (`pinWrites`), which needs both. Optional because only the canvas
   * can measure them; without them a pinned node is stripped rather than
   * mis-measured.
   */
  node?: { width: number; height: number }
  parent?: { width: number; height: number }
} | null

/**
 * The reparent a drop over `containers` implies, or null for "no reparent".
 *
 * `containers` is the chain under the pointer, innermost first, ending at the
 * page — the canvas's half of the question, since only the scene graph knows
 * what the pointer is over. Everything the *document* has to say is `moveFor`'s
 * to say, so this is a second caller of the rail's rulebook rather than a
 * second rulebook: a drop the rail would refuse is a drop the canvas refuses,
 * for the same reason and with the same arithmetic.
 *
 * Three refusals, and the distinction between the last two is the whole of it:
 *
 * - **Inside the drag.** A gesture carries its own subtree under the pointer,
 *   so the dragged node and its descendants arrive in the chain and are simply
 *   not targets. Stepping past them is what makes the frame *beneath* the drag
 *   the answer.
 * - **The node's own parent.** Then this was a move, not a reparent — the
 *   position write C10a already commits says everything that happened. Walking
 *   further out to a grandparent would turn a nudge across a frame into a
 *   promotion nobody asked for.
 * - **A container that refuses.** A duplicate sibling name, a `<Component>`
 *   that already has its one child: the author aimed at that frame and it said
 *   no. Falling outward to its parent would perform a different gesture than
 *   the one they made. A node that could *never* take a child — a text, a
 *   rectangle the pointer happens to be over — is not a refusal at all, and the
 *   walk steps past it. This is the same split `LayersPane` makes between
 *   `canContainChildren` and a null `moveFor`.
 */
export function dropTargetFor(
  doc: UidxDocument,
  dragged: string,
  containers: readonly string[],
  keepAt: DropPlacement = null,
): DropTarget | null {
  if (dragged === '') return null
  const node = resolve(doc.tree, dragged)
  if (!node) return null

  const currentParent = parentOf(doc, dragged)

  for (const target of containers) {
    // `isWithin` answers "is this the node itself, or something inside it" —
    // the one home for address algebra (`@uidx/format`), shared with the
    // patcher and the rail so containment cannot mean three different things.
    if (isWithin(dragged, target)) continue
    if (currentParent && target === currentParent.address) return null
    if (!canContainChildren(doc, target)) continue

    return reparentTo(doc, dragged, target, keepAt)
  }
  return null
}

/**
 * The drop into one named container, or null if the document refuses it.
 *
 * Split out so the settle can re-ask about the container the highlight named,
 * rather than re-deriving it from a pointer that has stopped moving. The
 * legality is `moveFor`'s, unchanged.
 */
export function reparentTo(
  doc: UidxDocument,
  dragged: string,
  parent: string,
  keepAt: DropPlacement = null,
): DropTarget | null {
  const node = resolve(doc.tree, dragged)
  if (!node) return null
  const patch = moveFor(doc, dragged, parent, 'into')
  if (!patch || patch.op !== 'move-node') return null
  // The `move-node` patch's own arithmetic, rejoined through `addressOf` so
  // the entity boundary is decided in one place: a node dropped onto the
  // page becomes an entity and joins with nothing, one dropped into an
  // entity joins with `#`, anything deeper with `/`.
  const address = addressOf(patch.newParent, node.name)

  /*
   * `x` and `y` are relative to the parent, so a reparent silently re-reads
   * them against a different origin — the node jumps by exactly the distance
   * between the two parents. Restating them is what makes the drop mean what
   * the pointer said.
   *
   * Two things about these that are easy to get wrong. They are addressed to
   * the node's *new* address, because they apply after the move — the whole
   * point of one ordered envelope, and `applyPatches` re-parses between ops so
   * the address exists by the time they run. And the op is `add` or `set`
   * depending on what the file already states: the patcher refuses the wrong
   * one outright rather than guessing.
   */
  /*
   * A pinned node crossing a parent boundary says everything the crossing
   * means, in an order where every intermediate state is a legal document —
   * the server re-parses between ops (found live: the pin travelled to the
   * page, which has no edges, and UIDX135 refused the whole drop).
   *
   * Figma's rule, and the file's: constraints belong to the frame you are in.
   * Landing on the page or in a flow that places you strips them; landing in
   * another box keeps them, re-measured from its edges.
   */
  const rootFontSize = rootFontSizeOf(doc)
  const pin = pinFrom(node.attrs, rootFontSize)
  if (pin) {
    const targetNode = patch.newParent === '' ? null : resolve(doc.tree, patch.newParent)
    const flows =
      FLOW_MODES.has(targetNode?.attrs.layoutMode?.value as string) &&
      node.attrs.layoutPositioning?.value !== 'ABSOLUTE'
    const keeps = patch.newParent !== '' && !flows && keepAt?.node && keepAt.parent

    if (keeps) {
      const writes = pinWrites(
        pin,
        { x: keepAt.x, y: keepAt.y, width: keepAt.node!.width, height: keepAt.node!.height },
        keepAt.parent!,
        undefined,
        Object.values(node.attrs).some((attr) => isUnitLength(attr.value)) ? 6 : 0,
      )
      const converted: UidxPatch[] = []
      for (const prop of writes.removals) {
        if (node.attrs[prop] !== undefined) converted.push({ op: 'remove', address: dragged, prop })
      }
      for (const [prop, value] of Object.entries(writes.fields)) {
        converted.push({
          op: node.attrs[prop] === undefined ? 'add' : 'set',
          address: dragged,
          prop,
          value: preserveLengthUnit(value, node.attrs[prop]?.value, rootFontSize),
        })
      }
      // Offsets first, at the old address — any number is legal under the
      // unchanged constraint — then the move that makes them measure anew.
      return { parent: patch.newParent, address, patches: [...converted, patch] }
    }

    const stripped: UidxPatch[] = []
    for (const prop of ['right', 'bottom', 'centerX', 'centerY']) {
      if (node.attrs[prop] !== undefined) stripped.push({ op: 'remove', address: dragged, prop })
    }
    if (node.attrs.constraints !== undefined) {
      stripped.push({ op: 'remove', address: dragged, prop: 'constraints' })
    }
    const placement: UidxPatch[] =
      keepAt && patch.newParent === ''
        ? [
            {
              op: node.attrs.x ? 'set' : 'add',
              address,
              prop: 'x',
              value: preserveLengthUnit(keepAt.x, node.attrs.x?.value, rootFontSize),
            },
            {
              op: node.attrs.y ? 'set' : 'add',
              address,
              prop: 'y',
              value: preserveLengthUnit(keepAt.y, node.attrs.y?.value, rootFontSize),
            },
          ]
        : []
    return { parent: patch.newParent, address, patches: [...stripped, patch, ...placement] }
  }

  const placement: UidxPatch[] = keepAt
    ? [
        {
          op: node.attrs.x ? 'set' : 'add',
          address,
          prop: 'x',
          value: preserveLengthUnit(keepAt.x, node.attrs.x?.value, rootFontSize),
        },
        {
          op: node.attrs.y ? 'set' : 'add',
          address,
          prop: 'y',
          value: preserveLengthUnit(keepAt.y, node.attrs.y?.value, rootFontSize),
        },
      ]
    : []

  return { parent: patch.newParent, address, patches: [patch, ...placement] }
}

/** The layout modes under which a parent places its children itself. */
const FLOW_MODES = new Set(['HORIZONTAL', 'VERTICAL', 'GRID'])

/**
 * The container a new node drawn over `containers` belongs in (story D1).
 *
 * The same walk `dropTargetFor` makes, and the same principle: the innermost
 * thing under the pointer that can actually take this element. There is no
 * dragged subtree to step past here, and no "own parent" to stop at — drawing
 * inside a frame means inside that frame, and drawing on empty canvas means on
 * the page, which is always the last link in the chain.
 *
 * A container that refuses *this element* is stepped past rather than treated
 * as a refusal, which is where this parts company with a drop. Drawing a
 * `<Component>` over a frame is not a mis-aimed gesture the author meant to
 * fail — the element simply belongs a level up, on the page, and that is where
 * Figma puts it. A drop had someone aiming at a specific frame; a draw has
 * someone aiming at a *place*.
 */
export function insertTargetFor(
  doc: UidxDocument,
  element: string,
  containers: readonly string[],
): string | null {
  for (const target of containers) {
    if (canInsert(doc, target, element)) return target
  }
  return null
}
