import { isWithin, resolve } from './parse.js'
import { serializeValue } from './values.js'
import type { JsonValue, UidxAttr, UidxDocument, UidxNode, UidxPatch } from './types.js'

type AttributePatch = Extract<UidxPatch, { op: 'set' | 'add' | 'remove' | 'set-mode' }>

const isAttributePatch = (p: UidxPatch): p is AttributePatch =>
  p.op === 'set' || p.op === 'add' || p.op === 'remove' || p.op === 'set-mode'

const attr = (name: string, value: JsonValue, previous?: UidxAttr): UidxAttr => ({
  name,
  value,
  raw: serializeValue(value),
  loc: previous?.loc ?? { start: 0, end: 0 },
  valueLoc: previous?.valueLoc ?? { start: 0, end: 0 },
})

/**
 * The document as it will read once `patches` land, computed from the tree
 * alone (spec §4). Attribute ops only: a structural op needs address
 * recomputation for a moved subtree, and the canvas already shows its own
 * result for those, so such a batch is left to the round trip.
 *
 * Untouched subtrees are shared with `doc`, which is what keeps this cheap on
 * a 7k-node page and lets `===` on a node mean "unchanged" downstream. Spans on
 * the result are stale and `predicted` says so: nothing may patch *against* a
 * predicted document.
 */
export function predictDocument(doc: UidxDocument, patches: readonly UidxPatch[]): UidxDocument {
  if (patches.length === 0) return doc
  if (!patches.every(isAttributePatch)) return doc

  const edits = new Map<string, ((node: UidxNode) => UidxNode)[]>()
  for (const patch of patches) {
    // Gone underneath us — an external revision removed it while the patch was
    // in flight. The server will refuse the patch; predicting nothing is right.
    if (!resolve(doc.tree, patch.address)) continue
    const list = edits.get(patch.address) ?? []
    list.push(editFor(patch))
    edits.set(patch.address, list)
  }
  if (edits.size === 0) return doc

  const targets = [...edits.keys()]
  const rebuild = (node: UidxNode): UidxNode => {
    const own = edits.get(node.address)
    const below = targets.some((a) => a !== node.address && isWithin(node.address, a))
    if (!own && !below) return node
    let next: UidxNode = below ? { ...node, children: node.children.map(rebuild) } : { ...node }
    for (const edit of own ?? []) next = edit(next)
    return next
  }

  return { ...doc, tree: rebuild(doc.tree), predicted: true }
}

function editFor(patch: AttributePatch): (node: UidxNode) => UidxNode {
  switch (patch.op) {
    case 'set':
    case 'add':
      return (node) => ({
        ...node,
        attrs: {
          ...node.attrs,
          [patch.prop]: attr(patch.prop, patch.value, node.attrs[patch.prop]),
        },
      })
    case 'remove':
      return (node) => {
        const { [patch.prop]: _dropped, ...rest } = node.attrs
        return { ...node, attrs: rest }
      }
    case 'set-mode':
      return (node) => ({
        ...node,
        children: node.children.map((child) =>
          child.element === 'Mode' && child.attrs.name?.value === patch.mode
            ? {
                ...child,
                attrs: { ...child.attrs, value: attr('value', patch.value, child.attrs.value) },
              }
            : child,
        ),
      })
  }
}
