import { propUiFor } from '@uidx/schema'
import {
  addressOf,
  CONTAINER_ELEMENTS,
  ENTITY_SEP,
  isWithin,
  legalChildElementsOf,
  METADATA_ATTRS,
  toSpec,
  type JsonValue,
  PATH_SEP,
  resolve,
  type UidxDocument,
  type UidxNode,
  type UidxPatch,
} from '@uidx/format'

/** The three drops a layer tree offers. */
export type DropInstruction = 'above' | 'below' | 'into'

/**
 * Every refusal below mirrors a guard `applyPatch` already enforces.
 *
 * Duplicating them is deliberate and bounded: the patcher's guards protect the
 * file, and these protect the gesture. A drag needs to know a drop is illegal
 * while the pointer is still moving, which is a question a thrown PatchError
 * arriving after the write cannot answer. `null` is that answer.
 */
export function parentOf(doc: UidxDocument, address: string): UidxNode | null {
  if (address === '') return null
  const find = (node: UidxNode): UidxNode | null => {
    for (const child of node.children) {
      if (child.address === address) return node
      const hit = find(child)
      if (hit) return hit
    }
    return null
  }
  return find(doc.tree)
}

/**
 * Whether a new `element` may be created inside this address (story D1).
 *
 * Mirrors `insertNode`'s guards for the same reason `moveFor` mirrors
 * `moveNode`'s: a toolbar has to grey a button out while the pointer is still
 * moving, which a thrown `PatchError` arriving after the write cannot do.
 */
export function canInsert(doc: UidxDocument, parent: string, element: string): boolean {
  if (!canContainChildren(doc, parent)) return false
  const node = resolve(doc.tree, parent)!
  // The parser's own table (ADR 0007 gave it two more entries), so the rail and
  // `uidx check` cannot disagree about what a container may hold.
  if (!legalChildElementsOf(node.element).has(element)) return false
  // The one-child rule, on the element that still has it. ADR 0008 §1 took it
  // off `<Component>` — a component *is* a frame, so it holds what a frame
  // holds — and §2 left it on `<Variant>` deliberately: a variant is one
  // state's tree, and `arrangeVariants` measures one box per variant. It was
  // never one rule that two elements shared.
  if (node.element === 'Variant' && node.children.length >= 1) return false
  // The two rules the table cannot carry, both positions rather than parent
  // elements (ADR 0007 §1): a `<Slot>` is refused inside a fill, and refused
  // anywhere outside a `<Component>` — however deeply nested, since only an
  // `<Instance>` fills a slot and an instance names a component. Everything
  // else about a fill's insides is ordinary; content goes in freely.
  if (element !== 'Slot') return true
  if (node.element === 'Instance') return true // the fill side
  return isInsideComponent(doc, parent) && !isInsideFill(doc, parent)
}

/**
 * Whether `address` is a `<Component>` or sits inside one.
 *
 * Walks up, like `isInsideFill` and for the same reason: the rail asks about
 * one arbitrary row at a time and has no descent to hang a flag on. The parser
 * threads the same fact *down* as `inComponent`, because it does have one — two
 * shapes of the same question, which is why both live beside the rule they
 * serve rather than being derived twice from a tree walk.
 */
function isInsideComponent(doc: UidxDocument, address: string): boolean {
  let current: UidxNode | null = resolve(doc.tree, address)
  while (current) {
    if (current.element === 'Component') return true
    current = parentOf(doc, current.address)
  }
  return false
}

/**
 * Whether `address` sits inside a `<Slot>` fill — that is, under a slot whose
 * own parent is an `<Instance>`.
 *
 * Walks up rather than being threaded down, because the rail asks about one
 * arbitrary row at a time and has no descent to hang a flag on. The chain is
 * short: a fill is a direct child of an instance, so this stops at the first
 * slot it meets.
 */
function isInsideFill(doc: UidxDocument, address: string): boolean {
  let current: UidxNode | null = resolve(doc.tree, address)
  while (current) {
    const parent: UidxNode | null = parentOf(doc, current.address)
    if (current.element === 'Slot' && parent?.element === 'Instance') return true
    current = parent
  }
  return false
}

/**
 * Whether this node may be deleted (story D2).
 *
 * The sole child of a `<Variant>` may not: the patcher refuses it (UIDX104),
 * and D2 asks the UI to disable the control rather than let the author press a
 * button that throws. A `<Component>`'s child used to be refused for the same
 * reason and no longer is — ADR 0008 §1 lets a component hold any number of
 * children including none, so taking its last one out leaves a document that
 * parses.
 */
export function canRemove(doc: UidxDocument, address: string): boolean {
  if (address === '') return false
  if (!resolve(doc.tree, address)) return false
  const parent = parentOf(doc, address)
  if (parent?.element === 'Variant') return false
  return !parent?.synthetic
}

/**
 * Whether a drop onto this address could ever be a reparent.
 *
 * The rail asks this to decide whether a row deserves a reparent band at all.
 * Asking `moveFor` instead would conflate "this row can never take a child"
 * with "this particular move is refused" — and a refusal the author meant to
 * hit must not quietly become a different move somewhere else.
 */
export function canContainChildren(doc: UidxDocument, address: string): boolean {
  const node = resolve(doc.tree, address)
  return node !== null && !node.synthetic && CONTAINER_ELEMENTS.has(node.element)
}

export function moveFor(
  doc: UidxDocument,
  dragged: string,
  target: string,
  instruction: DropInstruction,
): UidxPatch | null {
  if (dragged === '') return null

  const node = resolve(doc.tree, dragged)
  const targetNode = resolve(doc.tree, target)
  if (!node || !targetNode) return null

  const newParent = instruction === 'into' ? targetNode : parentOf(doc, target)
  if (!newParent) return null

  // A synthetic <Page> has no source span, so nothing can be written into it
  // until `uidx fmt` materialises the wrapper.
  if (newParent.synthetic) return null
  if (!CONTAINER_ELEMENTS.has(newParent.element)) return null
  // `isWithin` answers "is this the node itself, or something inside it" —
  // the same address algebra the patcher and the reconciler share, so
  // containment cannot come to mean three different things in three files.
  if (isWithin(dragged, newParent.address)) return null

  const oldParent = parentOf(doc, dragged)
  // Same rule as `canRemove`, and for the same reason: a move is a remove and
  // an insert, so what may not be taken out may not be dragged out either.
  if (oldParent?.element === 'Variant') return null
  if (oldParent?.synthetic) return null

  // The parser's table, not a second copy of it — so a drag can never land a
  // child `uidx check` then refuses. This is what keeps a `<Text>` out of an
  // `<Instance>`, whose one legal child is a `<Slot>` fill (ADR 0007 §2).
  if (!legalChildElementsOf(newParent.element).has(node.element)) return null
  if (node.element === 'Slot' && newParent.element !== 'Instance') {
    if (!isInsideComponent(doc, newParent.address)) return null
    if (isInsideFill(doc, newParent.address)) return null
  }

  // The index `move-node` wants is an index into the siblings *after* the
  // dragged node is removed (patch.ts:341). Filtering first makes the
  // same-parent reorder arithmetic fall out rather than needing correction.
  const siblings = newParent.children.filter((c) => c.address !== dragged)
  if (newParent.element === 'Variant' && siblings.length >= 1) return null
  if (newParent !== oldParent && siblings.some((c) => c.name === node.name)) return null

  let index: number
  if (instruction === 'into') {
    index = siblings.length
  } else {
    const at = siblings.findIndex((c) => c.address === target)
    if (at === -1) return null
    index = instruction === 'above' ? at : at + 1
  }

  return { op: 'move-node', address: dragged, newParent: newParent.address, index }
}

/**
 * The patch a canvas reorder commits (story D7).
 *
 * `index` is into the siblings *after* the dragged child is removed, which is
 * what `flowSlotAt` produces and what `move-node` wants. Expressed through
 * `moveFor` rather than built here, so a reorder on the canvas is refused for
 * exactly the reasons a drop in the rail is — the rules have one home, and D7
 * is a third caller of them rather than a third copy.
 *
 * Null when nothing would change. A drag that wanders and lands back in its own
 * slot is not an edit, and committing one would put a revision and a diff in
 * front of a reviewer for a gesture that did nothing.
 */
export function reorderFor(doc: UidxDocument, address: string, index: number): UidxPatch | null {
  const parent = parentOf(doc, address)
  if (!parent) return null
  const siblings = parent.children.filter((c) => c.address !== address)
  if (siblings.length === 0) return null

  const at = Math.max(0, Math.min(index, siblings.length))
  const was = parent.children.findIndex((c) => c.address === address)
  if (at === was) return null

  // `moveFor` speaks in "above/below this sibling", so the index is expressed
  // as one: the slot before sibling `at`, or after the last one.
  return at < siblings.length
    ? moveFor(doc, address, siblings[at]!.address, 'above')
    : moveFor(doc, address, siblings[siblings.length - 1]!.address, 'below')
}

/**
 * A rename is an ordinary `set` on `name` — the patcher says so itself
 * (`patch.ts:216`). What makes it structural is not the write but the fallout:
 * every address beneath the node moves with it. See `remapAddress`.
 */
export function renameFor(doc: UidxDocument, address: string, name: string): UidxPatch | null {
  const next = name.trim()
  if (address === '' || next === '') return null

  const node = resolve(doc.tree, address)
  if (!node || node.name === next) return null
  // Nothing to replace when the attribute was never authored.
  if (!node.attrs.name) return null

  const parent = parentOf(doc, address)
  if (parent?.children.some((c) => c.address !== address && c.name === next)) return null

  return { op: 'set', address, prop: 'name', value: next }
}

/**
 * Turning a node into a `<Component>` (story F10).
 *
 * The step between D8 and F3 that neither of them covers: the importer makes
 * `<Vector>` nodes and F3 places `<Instance>`s, and until now nothing turned the
 * first into something the second could name — which meant hand-editing the
 * file, precisely what the canvas exists to stop (ADR 0006 §7).
 *
 * Two patches rather than one, and the order matters. The component is inserted
 * at the *end* of the page carrying a copy of the node, and only then is the
 * original removed — so both the document the second patch is computed against
 * and the one the first leaves behind are valid. The obvious shape, an
 * `insert-node` for an empty component followed by a `move-node` into it, cannot
 * work: `applyPatches` re-parses between ops and a `<Component>` with no child
 * is a UIDX104 error, so the intermediate document would be rejected. That is
 * the "fiddly" this story predicted, and this is the way round it.
 *
 * `taken` is every name already spoken for in the *document* — components and
 * token variables alike, since ADR 0004 §2 gives them one namespace. It is
 * passed in rather than derived because a page cannot see the document, the
 * same division `resolveAlias` and `resolveComponent` already keep.
 */
/**
 * Whether every attribute this node carries would still mean something if the
 * node were retagged as `element`.
 *
 * The §3.3 prop whitelist is *global*, so `<Slot characters="hi" />` and
 * `<Component vectorPaths={…} />` both parse and `uidx check` says nothing —
 * documents that validate and mean nothing. `appliesTo` in `prop-ui.ts` is the
 * one table in this repo keyed per element, so it is the one that can refuse
 * them, and it refuses for every element at once rather than for a list
 * somebody has to remember to extend.
 *
 * What falls out, for the two conversions that ask: a `<Frame>` can become
 * either a `<Slot>` or a `<Component>`; a bare `<Rectangle>` can too, being a
 * box with fills; a `<Text>` can become neither, because `characters` is
 * TEXT_ONLY; and a `<Vector>` can become neither while it has `vectorPaths` —
 * which is why F10 still wraps one rather than retagging it (ADR 0008 §3).
 */
export function attrsSurviveAs(node: UidxNode, element: string): boolean {
  return Object.keys(node.attrs).every((name) => {
    if (name === 'name' || METADATA_ATTRS.has(name)) return true
    const ui = propUiFor(name)
    // Unknown to the table: `uidx check` lints it separately, and it is not a
    // conversion's business to refuse what the panel never showed.
    if (!ui?.appliesTo) return true
    return (ui.appliesTo as readonly string[]).includes(element)
  })
}

/**
 * Where this node sits in the *page's* frame of reference, not its parent's.
 *
 * A component is a page child (ADR 0003 §1), so making one out of something
 * nested moves it up — and `x`/`y` are relative to whatever contained it. Reused
 * unchanged on the page they describe a different point, and the artwork slides
 * by exactly the sum of the offsets it was lifted out of. That is not a rounding
 * error the author can ignore; on a page whose stage frame sits at (-40, -64) it
 * is a visible jump, which is how this was reported.
 *
 * Per axis rather than as a point, because the two are authored independently
 * and a node may state one and leave the other to its parent's layout. An
 * ancestor that states neither contributes nothing, which is the same reading
 * the renderer takes: absent is not zero-the-author-chose, but it lands there.
 *
 * A node with no `x` of its own gets none back. Its position is whatever its
 * parent's auto-layout computed, and that is not a number this module can know
 * without running layout — so there is nothing to carry and nothing to invent,
 * which is the rule `wrapInComponent` already stated for the node's own half.
 */
function pageRelativePosition(doc: UidxDocument, address: string): Record<string, number> {
  const node = resolve(doc.tree, address)
  if (!node) return {}
  const out: Record<string, number> = {}
  for (const axis of ['x', 'y'] as const) {
    const own = node.attrs[axis]?.value
    if (typeof own !== 'number') continue
    let total = own
    for (
      let up = parentOf(doc, address);
      up !== null && up.address !== '';
      up = parentOf(doc, up.address)
    ) {
      const step = up.attrs[axis]?.value
      if (typeof step === 'number') total += step
    }
    // The precision `svg-import` writes geometry at. Summing floats is how
    // 374.18 becomes 374.17999999999995, and a diff full of that is a diff
    // nobody can read.
    out[axis] = Math.round(total * 1e4) / 1e4
  }
  return out
}

export function componentFrom(
  doc: UidxDocument,
  address: string,
  name: string,
  taken: ReadonlySet<string>,
): { patches: UidxPatch[]; address: string } | null {
  const wanted = name.trim()
  if (!isComponentNameFree(wanted, taken)) return null

  const node = resolve(doc.tree, address)
  // `canRemove` is exactly the precondition: "may this node be taken out of
  // where it is". A `<Component>`'s sole child may not, which is also why
  // making a component from something that is already one is refused below.
  if (!node || !canRemove(doc, address)) return null
  if (node.element === 'Component' || node.element === 'Page') return null

  /*
   * ADR 0008 §3. The frame *becomes* the component — it is not wrapped in one.
   *
   * This used to be an insert-node carrying a copy of the whole subtree plus a
   * remove-node of the original, which was the only gesture in this editor that
   * reprinted a subtree: every comment and every hand-arranged attribute inside
   * came back re-emitted. It also invented a frame the author never drew, which
   * is the wrapper ADR 0008 exists to delete.
   *
   * One `retag` instead. The canvas does not move, because nothing about the
   * node changes but the word naming it — and `status` rides along in the same
   * edit, since a `<Component>` without one is UIDX110 and a `<Frame>` with one
   * is UIDX111, so no ordering of two patches has a valid document in between.
   */
  /*
   * Artwork that cannot *be* a component is wrapped in one, as it always was.
   *
   * ADR 0008 §3 says a frame becomes the component rather than being wrapped,
   * and the reason is that a component *is* a frame — which is exactly why the
   * rule cannot be "always retag". A `<Vector>` carrying `vectorPaths` is not a
   * frame and never will be, and F10 exists so that a drawn mark becomes a
   * component (ADR 0006 §7). So the question is not "is this a Frame" but "would
   * everything this node says still mean something on a `<Component>`", which is
   * the same per-element question `attrsSurviveAs` answers for slots.
   */
  if (!attrsSurviveAs(node, 'Component') || !canInsert(doc, '', 'Component')) {
    return wrapInComponent(doc, node, address, wanted)
  }

  const patches: UidxPatch[] = []
  const parent = parentOf(doc, address)
  // A component is a page child (ADR 0003 §1), so a nested frame comes up
  // first. Ordered, and `applyPatches` re-parses between ops, so the retag
  // addresses the node where the move has just put it.
  const onPage = parent !== null && parent.address === ''
  const at = onPage ? address : addressOf('', node.name)
  // Rebased in the same envelope as the move that makes it necessary. A node
  // already on the page is already in the page's frame of reference, so there
  // is nothing to restate — and restating it would be a diff for no change.
  const placed = onPage ? {} : pageRelativePosition(doc, address)
  if (!onPage) {
    const move = moveFor(doc, address, '', 'into')
    if (!move) return null
    patches.push(move)
  }
  patches.push({
    op: 'retag',
    address: at,
    element: 'Component',
    // ADR 0009 §3: nothing writes `status` on the author's behalf. A component
    // that declares no maturity has not made a claim, which is more honest than
    // claiming to be a draft because a dialog needed a value.
    attrs: { name: wanted, ...placed },
  })

  return { patches, address: wanted }
}

/**
 * The old shape, for a node that cannot be a component itself.
 *
 * Two ops in one envelope, in an order where the document is valid at every
 * step — `applyPatches` re-parses between them, so a pair that only works if
 * you squint at the end is rejected halfway.
 *
 * The position moves *up*, it is not thrown away. A `<Component>` with one
 * child hugs it (`componentSizing`), so an `x`/`y` left on the child is a
 * number the file states and the layout ignores — the stale geometry D4 exists
 * to keep out, arriving by a different door. The component is itself a page
 * child, whose position is authored (ADR 0003), so carrying the node's own up
 * to it is what keeps the artwork where the author left it.
 */
function wrapInComponent(
  doc: UidxDocument,
  node: UidxNode,
  address: string,
  wanted: string,
): { patches: UidxPatch[]; address: string } | null {
  if (!canInsert(doc, '', 'Component')) return null
  const spec = toSpec(node)
  // The node's own half was never the whole of it: every ancestor it is being
  // lifted out of contributed an offset too.
  const { x, y } = pageRelativePosition(doc, address)
  return {
    patches: [
      {
        op: 'insert-node',
        parent: '',
        index: doc.tree.children.length,
        node: {
          element: 'Component',
          attrs: {
            name: wanted,
            ...(typeof x === 'number' ? { x } : {}),
            ...(typeof y === 'number' ? { y } : {}),
          },
          children: [{ ...spec, attrs: withoutPosition(spec.attrs) }],
        },
      },
      { op: 'remove-node', address },
    ],
    address: addressOf(wanted, node.name),
  }
}

const withoutPosition = (attrs: Record<string, JsonValue>): Record<string, JsonValue> => {
  const { x: _x, y: _y, ...rest } = attrs
  return rest
}

/**
 * Whether this name is the author's to take.
 *
 * Split out so the dialog can grey its button out while the pointer is still
 * moving, which is the same reason `canRemove` and `canInsert` exist beside
 * the patcher's own guards.
 */
export function isComponentNameFree(name: string, taken: ReadonlySet<string>): boolean {
  const wanted = name.trim()
  if (wanted === '') return false
  // `#` bounds an entity from the path inside it (ADR 0004 §3), so a name
  // holding one would address something that is not the component.
  if (wanted.includes(ENTITY_SEP)) return false
  return !taken.has(wanted)
}

/**
 * One address, rewritten for a rename that happened above it.
 *
 * The page cannot be renamed, and treating '' as an ancestor would rewrite
 * every address in the document. The boundary character is the whole subtlety.
 * ADR 0004 keeps `/` free to be a name character and uses `#` to bound the
 * entity, so `Button/Primary` and `Button/Primary/Old` are two components
 * rather than a parent and a child. Which separator counts as "beneath"
 * therefore depends on which side of the `#` the renamed node sits.
 */
export function remapAddress(oldAddress: string, newAddress: string, address: string): string {
  // The page cannot be renamed, and treating '' as an ancestor would rewrite
  // every address in the document.
  if (oldAddress === '') return address
  if (!isWithin(oldAddress, address)) return address
  if (address === oldAddress) return newAddress
  // Not a string splice: a reparent can cross the entity boundary, and then
  // the separators beneath the moved node change too — a promoted node's
  // children join with `#` where they used to join with `/`. Rejoining each
  // segment through `addressOf` decides the boundary in the one place that
  // owns it. The slice is unambiguous because nothing below an entity may
  // contain `/` or `#` in its name.
  const segments = address.slice(oldAddress.length + 1).split(PATH_SEP)
  return segments.reduce((parent, name) => addressOf(parent, name), newAddress)
}
