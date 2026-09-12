import { addressOf, resolve, resolveParent } from './parse.js'
import { PatchError } from './patch.js'
import { predictDocument } from './predict.js'
import type { UidxDocument, UidxNode, UidxNodeSpec, UidxPatch } from './types.js'

/** A node as an insert spec: attrs by value, children recursively. */
export function toNodeSpec(node: UidxNode): UidxNodeSpec {
  const attrs = Object.fromEntries(Object.entries(node.attrs).map(([k, a]) => [k, a.value]))
  return node.children.length
    ? { element: node.element, attrs, children: node.children.map(toNodeSpec) }
    : { element: node.element, attrs }
}

/**
 * The batch that undoes `patches`, computed against the document they were
 * written for (spec §5). Later ops in a batch are inverted against the
 * document as the earlier ones leave it, and the result is emitted newest
 * first, so applying it walks the edit back step by step.
 *
 * Undo in this design is a *new* write through the same channel, never a
 * rewind — which is why the answer is patches and not a source string.
 */
export function inversePatches(doc: UidxDocument, patches: readonly UidxPatch[]): UidxPatch[] {
  const out: UidxPatch[] = []
  let current = doc
  for (const patch of patches) {
    out.unshift(...invertOne(current, patch))
    current = advance(current, patch)
  }
  return out
}

function mustResolve(doc: UidxDocument, address: string): UidxNode {
  const node = resolve(doc.tree, address)
  if (!node) throw new PatchError(`no node at address ${JSON.stringify(address)}`)
  return node
}

function invertOne(doc: UidxDocument, patch: UidxPatch): UidxPatch[] {
  switch (patch.op) {
    case 'set': {
      const attr = mustResolve(doc, patch.address).attrs[patch.prop]
      if (!attr) {
        throw new PatchError(`${patch.address} has no attribute "${patch.prop}" to restore`)
      }
      return [{ op: 'set', address: patch.address, prop: patch.prop, value: attr.value }]
    }
    case 'add':
      return [{ op: 'remove', address: patch.address, prop: patch.prop }]
    case 'remove': {
      const attr = mustResolve(doc, patch.address).attrs[patch.prop]
      if (!attr) {
        throw new PatchError(`${patch.address} has no attribute "${patch.prop}" to restore`)
      }
      return [{ op: 'add', address: patch.address, prop: patch.prop, value: attr.value }]
    }
    case 'set-mode': {
      const variable = mustResolve(doc, patch.address)
      const mode = variable.children.find(
        (c) => c.element === 'Mode' && c.attrs.name?.value === patch.mode,
      )
      const value = mode?.attrs.value?.value
      if (value === undefined) {
        throw new PatchError(`${patch.address} has no mode "${patch.mode}" to restore`)
      }
      return [{ op: 'set-mode', address: patch.address, mode: patch.mode, value }]
    }
    case 'insert-node': {
      const name = patch.node.attrs.name
      if (typeof name !== 'string') {
        throw new PatchError('an insert-node without a name attribute cannot be inverted')
      }
      mustResolve(doc, patch.parent)
      return [{ op: 'remove-node', address: addressOf(patch.parent, name) }]
    }
    case 'remove-node': {
      const node = mustResolve(doc, patch.address)
      const parent = resolveParent(doc.tree, patch.address)
      if (!parent) throw new PatchError('the root cannot be removed, so there is nothing to invert')
      const index = parent.children.indexOf(node)
      return [{ op: 'insert-node', parent: parent.address, index, node: toNodeSpec(node) }]
    }
    case 'move-node': {
      const node = mustResolve(doc, patch.address)
      const parent = resolveParent(doc.tree, patch.address)
      if (!parent) throw new PatchError('the root cannot be moved, so there is nothing to invert')
      const index = parent.children.indexOf(node)
      mustResolve(doc, patch.newParent)
      return [
        {
          op: 'move-node',
          address: addressOf(patch.newParent, node.name),
          newParent: parent.address,
          index,
        },
      ]
    }
    default:
      throw new PatchError(`the "${patch.op}" op cannot be inverted`)
  }
}

/** The document after `patch`, well enough for the next inversion to read. */
function advance(doc: UidxDocument, patch: UidxPatch): UidxDocument {
  switch (patch.op) {
    case 'set':
    case 'add':
    case 'remove':
    case 'set-mode':
      return predictDocument(doc, [patch])
    default:
      // A structural op moves addresses. Inverting later ops against the
      // pre-op document is right for every op that does not name what this
      // one moved, and a batch that does is one the server re-parses between.
      return doc
  }
}
