import { toNodeSpec } from './inverse.js'
import { isWithin } from './parse.js'
import type { JsonValue, UidxDocument, UidxNode, UidxPatch } from './types.js'

type Entry = { node: UidxNode; parent: string | null; index: number }

function indexNodes(doc: UidxDocument): Map<string, Entry> {
  const out = new Map<string, Entry>()
  const walk = (node: UidxNode, parent: string | null, index: number): void => {
    out.set(node.address, { node, parent, index })
    node.children.forEach((child, i) => walk(child, node.address, i))
  }
  walk(doc.tree, null, 0)
  return out
}

const depth = (address: string): number => (address === '' ? 0 : address.split(/[/#]/).length)

const sameValue = (a: JsonValue | undefined, b: JsonValue | undefined): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

/**
 * The patches that take `prev`'s tree to `next`'s (spec §5). This is how a
 * revision this client did not send — an outside editor, an LLM turn, a
 * `uidx apply` — gets an inverse: `diffToPatches(next, prev)`.
 *
 * Address-keyed like the scene diff, and for the same reason: addresses are
 * identity (ADR 0003), so a rename is a remove plus an insert. Prose and
 * frontmatter are outside the patch vocabulary and are not expressed.
 */
export function diffToPatches(prev: UidxDocument, next: UidxDocument): UidxPatch[] {
  const before = indexNodes(prev)
  const after = indexNodes(next)
  const out: UidxPatch[] = []

  // Removals, deepest first, skipping anything an ancestor's removal covers.
  const removed = [...before.keys()]
    .filter((a) => !after.has(a))
    .sort((a, b) => depth(b) - depth(a))
  for (const address of removed) {
    if (removed.some((other) => other !== address && isWithin(other, address))) continue
    out.push({ op: 'remove-node', address })
  }

  // Inserts, shallowest first; a child of an inserted node arrives inside it.
  const added = [...after.keys()].filter((a) => !before.has(a)).sort((a, b) => depth(a) - depth(b))
  const addedSet = new Set(added)
  for (const address of added) {
    const entry = after.get(address)!
    if (entry.parent === null || addedSet.has(entry.parent)) continue
    out.push({
      op: 'insert-node',
      parent: entry.parent,
      index: entry.index,
      node: toNodeSpec(entry.node),
    })
  }

  // Survivors: attributes, then position.
  const moves: UidxPatch[] = []
  for (const [address, entry] of after) {
    const previous = before.get(address)
    if (!previous) continue
    for (const [prop, attr] of Object.entries(entry.node.attrs)) {
      const old = previous.node.attrs[prop]
      if (!old) out.push({ op: 'add', address, prop, value: attr.value })
      else if (!sameValue(old.value, attr.value))
        out.push({ op: 'set', address, prop, value: attr.value })
    }
    for (const prop of Object.keys(previous.node.attrs)) {
      if (!(prop in entry.node.attrs)) out.push({ op: 'remove', address, prop })
    }
    if (
      entry.parent !== null &&
      (previous.parent !== entry.parent || previous.index !== entry.index)
    ) {
      moves.push({ op: 'move-node', address, newParent: entry.parent, index: entry.index })
    }
  }
  // Moves in target order, so each lands at an index the earlier ones have
  // already made true.
  moves.sort((a, b) => (a as { index: number }).index - (b as { index: number }).index)
  out.push(...moves)
  return out
}
