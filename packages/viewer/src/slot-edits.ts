import {
  addressOf,
  autoName,
  ENTITY_SEP,
  isWithin,
  PATH_SEP,
  resolve,
  slotFills,
  slots,
  type UidxDocument,
  type UidxNode,
  type UidxPatch,
} from '@uidx/format'
import { createSpec } from '@uidx/schema'

import { attrsSurviveAs, canInsert, parentOf } from './layer-moves'

/**
 * Making a hole, from the editor (story F5, ADR 0007).
 *
 * Judgement here rather than in the `.vue` file, for the reason this repo has
 * settled on twice already: the canvas render path cannot be driven headlessly
 * (spike S1), so anything worth testing lives in a pure module and the
 * component is glue.
 *
 * Both gestures ADR 0007 §6 asks for are here. "Convert to slot" needed a
 * patch op that changes an element's tag without reprinting what is inside it
 * — `retag`, story F14 — because doing it as remove-plus-insert would lose the
 * frame's children, their comments and their formatting.
 */

/**
 * Where a new slot should go, given what is selected.
 *
 * Figma inserts into the selection when it can hold one and beside it when it
 * cannot, which is what makes the gesture feel like "put a hole here" rather
 * than "put a hole in a place I have to name first". Null means no position in
 * reach takes a slot — on a page, inside a fill, or as a component's only
 * child — and the caller disables the control rather than offering a press
 * that fails.
 */
export function slotTargetFor(doc: UidxDocument, selection: readonly string[]): string | null {
  // One at a time: a slot inserted "into" several selected nodes has no
  // meaning, and multi-select has no mixed-value model here (C5's deferral).
  if (selection.length !== 1) return null
  const address = selection[0]!
  if (canInsert(doc, address, 'Slot')) return address
  const parent = parentOf(doc, address)
  if (parent && canInsert(doc, parent.address, 'Slot')) return parent.address
  return null
}

/**
 * The gesture: one `insert-node`, and the address it will answer to.
 *
 * The address is returned rather than left for the caller to derive because
 * ADR 0007 §6 requires the new slot be *selected* afterwards — with no
 * empty-slot indicator on the canvas, a slot with no default content draws
 * nothing, and this is the gesture that makes one. A hole the author cannot
 * find is worse than no hole.
 */
export function newSlotFor(
  doc: UidxDocument,
  selection: readonly string[],
): { patches: UidxPatch[]; address: string } | null {
  const parent = slotTargetFor(doc, selection)
  if (parent === null) return null
  const parentNode = resolve(doc.tree, parent)
  if (!parentNode) return null

  const name = autoName('Slot', parentNode.children)
  return {
    patches: [
      {
        op: 'insert-node',
        parent,
        index: parentNode.children.length,
        node: createSpec('Slot', name, { at: null, size: null }),
      },
    ],
    address: addressOf(parent, name),
  }
}

/**
 * Elements that are never a hole, whatever they carry.
 *
 * Not a taste call in any of the four cases. A `<Slot>` is already one; an
 * `<Instance>` is a *use* of a component and a hole is a thing a component
 * declares; a `<Component>` is the declaration itself; a `<Variant>` has no
 * geometry or name of its own at all (ADR 0005 §5).
 */
const NEVER_A_SLOT: ReadonlySet<string> = new Set([
  'Slot',
  'Instance',
  'Component',
  'Variant',
  'Page',
])

/**
 * Whether the selection could become a hole.
 *
 * Figma's ⌘⇧S, and the retrofit path an author reaches for more often than
 * "New slot": most holes start life as something somebody already built and
 * arranged in place.
 */
export function convertibleToSlot(doc: UidxDocument, selection: readonly string[]): string | null {
  if (selection.length !== 1) return null
  const address = selection[0]!
  const node = resolve(doc.tree, address)
  if (!node || NEVER_A_SLOT.has(node.element)) return null
  if (!attrsSurviveAs(node, 'Slot')) return null
  // The same positional rules a new slot obeys, asked of where this frame
  // already sits: a component's direct child and anything inside a fill are
  // refused, and the parser would refuse them again after the write.
  const parent = parentOf(doc, address)
  if (!parent || !canInsert(doc, parent.address, 'Slot')) return null
  return address
}

/**
 * The gesture: one `retag`, and the canvas does not move.
 *
 * The frame's children become the slot's default content and its layout stays
 * exactly where it was, because nothing about the node changes except the word
 * naming it. That is what makes this a one-word diff rather than a rewrite, and
 * it is why `retag` was worth an op.
 */
export function convertToSlotFor(
  doc: UidxDocument,
  selection: readonly string[],
): { patches: UidxPatch[]; address: string } | null {
  const address = convertibleToSlot(doc, selection)
  if (address === null) return null
  return { patches: [{ op: 'retag', address, element: 'Slot' }], address }
}

/**
 * ADR 0007 §2's other two states, as gestures rather than as spellings.
 *
 * "Reset slot" needs no function of its own: removing the fill `<Slot>` *is*
 * the reset, and `canRemove` already permits it — a fill's parent is an
 * `<Instance>`, which is neither a `<Component>` nor synthetic. So the delete
 * the toolbar already offers does it, and what was missing was only the name.
 * `resetSlotFor` exists to carry that name, and to be the thing a menu binds to
 * when there is one.
 */
export function resetSlotFor(doc: UidxDocument, address: string): UidxPatch[] | null {
  const node = resolve(doc.tree, address)
  if (!node || node.element !== 'Slot') return null
  const parent = parentOf(doc, address)
  if (parent?.element !== 'Instance') return null
  return [{ op: 'remove-node', address }]
}

/**
 * Empty the fill without removing it — ADR 0007 §2's third state.
 *
 * `<Slot name="body" />` and *no* `<Slot name="body">` are different documents
 * with different renderings: the first draws nothing on purpose, the second
 * falls back to the definition's default content. This is the gesture that
 * reaches the first from the second, which is why it is not the same as reset.
 *
 * Removed last-first, because `applyPatches` re-parses between ops and a
 * sibling's address does not depend on the ones before it — but the *order* a
 * reader sees in the diff does, and removing from the end keeps each remaining
 * address the one it started with.
 */
export function deleteSlotContentsFor(doc: UidxDocument, address: string): UidxPatch[] | null {
  const node = resolve(doc.tree, address)
  if (!node || node.element !== 'Slot') return null
  if (parentOf(doc, address)?.element !== 'Instance') return null
  if (node.children.length === 0) return null
  return [...node.children]
    .reverse()
    .map((child) => ({ op: 'remove-node', address: child.address }) as const)
}

/**
 * Dropping something into a hole nobody has filled yet (ADR 0007 §2).
 *
 * The one drop this editor cannot express as a `move-node`. An unfilled slot
 * has no node in the consuming page at all — what the pointer is over is a
 * *clone* of the definition's `<Slot>`, absent from the bimap and therefore
 * unwritable. So the first fill has to create the wrapper before anything can
 * move into it: an `insert-node` of `<Slot name>` into the instance, then the
 * ordinary `move-node` into the address that wrapper now owns.
 *
 * Two ops in one envelope, which `applyPatches` re-parses between — so the
 * fill's address exists by the time the move is applied. Once it exists, every
 * later drop is an ordinary reparent and this function has nothing to say.
 *
 * `slotSceneIds` maps the scene ids the canvas hit-tested to the slot each one
 * is: the caller has the component index and this module deliberately does not.
 */
export function firstFillFor(
  doc: UidxDocument,
  dragged: string,
  containers: readonly string[],
  slotSceneIds: ReadonlyMap<string, { instance: string; slot: string }>,
): { patches: UidxPatch[]; address: string } | null {
  const node = resolve(doc.tree, dragged)
  if (!node) return null

  for (const target of containers) {
    const hole = slotSceneIds.get(target)
    if (!hole) continue
    const instance = resolve(doc.tree, hole.instance)
    if (!instance) continue
    // Already filled: an ordinary drop handles it, and two wrappers for one
    // slot would be UIDX132.
    if (slotFills(instance).fills.has(hole.slot)) return null
    // Dropping a node into a hole inside itself, which `isWithin` refuses for
    // every other drop too.
    if (isWithin(dragged, hole.instance)) return null

    const fillAddress = addressOf(hole.instance, hole.slot)
    return {
      patches: [
        {
          op: 'insert-node',
          parent: hole.instance,
          index: instance.children.length,
          node: { element: 'Slot', attrs: { name: hole.slot } },
        },
        { op: 'move-node', address: dragged, newParent: fillAddress, index: 0 },
      ],
      address: addressOf(fillAddress, node.name),
    }
  }
  return null
}

/**
 * Every unfilled slot an instance renders, by the scene id the canvas knows it
 * by (ADR 0007 §3).
 *
 * The divergence again: the slot's scene id follows the *definition's*
 * position, so it is built by walking the component from the instance's
 * address — exactly as `expandInstance` addresses its clones, because the two
 * have to agree or the drop lands on nothing.
 */
export function slotSceneIds(
  doc: UidxDocument,
  components: ReadonlyMap<string, UidxNode>,
): Map<string, { instance: string; slot: string }> {
  const out = new Map<string, { instance: string; slot: string }>()
  const walk = (node: UidxNode): void => {
    if (node.element === 'Instance') {
      const name = node.attrs.component?.value
      const definition = typeof name === 'string' ? components.get(name) : undefined
      if (definition) {
        for (const [slotName, slot] of slots(definition).declared) {
          // The slot's path inside the component, rejoined onto the use.
          const inside = slot.address.slice(slot.address.indexOf(ENTITY_SEP) + 1)
          let id = node.address
          for (const segment of inside.split(PATH_SEP)) id = addressOf(id, segment)
          out.set(id, { instance: node.address, slot: slotName })
        }
      }
    }
    for (const child of node.children) walk(child)
  }
  walk(doc.tree)
  return out
}
