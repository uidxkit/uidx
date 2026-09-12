import { addressOf, resolve, type UidxDocument, type UidxPatch } from '@uidx/format'

import { remapAddress } from './layer-moves'

/**
 * Whether patches written against `base` can be trusted against `next` (E4).
 *
 * Patches address nodes by name path, not by byte offset, so an unrelated
 * external edit leaves them applying exactly as written. The file is the source
 * of truth and the active author wins for the property they were editing — so a
 * value changed underneath is not a conflict here, deliberately departing from
 * E4's first draft. What cannot be trusted is the *target*: an address that no
 * longer resolves, or that a different kind of node now occupies, would send
 * the edit somewhere the author never pointed.
 *
 * All or nothing: one gesture's patches travel and apply as one envelope, so a
 * batch with one untrustworthy member is refused whole rather than half-applied.
 *
 * An envelope is also read *in order*, against the document as its own earlier
 * ops will have left it. A canvas drop (C10b) is a `move-node` followed by the
 * position writes that keep the node where the pointer was, and those name the
 * address the move creates — which does not exist in `next` and never will
 * until the envelope runs. Checking each patch against `next` alone refused
 * every drop. `pending` is that bookkeeping: the moves seen so far, newest
 * last, used to read a later address back to the one the file has today.
 */
export function rebasePatches(
  patches: readonly UidxPatch[],
  base: UidxDocument,
  next: UidxDocument,
): UidxPatch[] | null {
  /** Moves this envelope will have made by the time a later patch runs. */
  const pending: { from: string; to: string }[] = []

  /**
   * The address a patch names, as the file spells it *today*.
   *
   * Undoing the envelope's own moves, newest first, because a later move can
   * carry a node the earlier one already moved. `remapAddress` is the same
   * rewrite the rail applies after a drop, run backwards — the entity boundary
   * stays decided in the one place that owns it.
   */
  const asFiled = (address: string): string => {
    let at = address
    for (let i = pending.length - 1; i >= 0; i--) {
      at = remapAddress(pending[i]!.to, pending[i]!.from, at)
    }
    return at
  }

  const nodeAt = (address: string) => {
    const target = resolve(next.tree, asFiled(address))
    if (!target) return null
    const was = resolve(base.tree, asFiled(address))
    return was === null || was.element === target.element ? target : null
  }
  const trusted = (address: string): boolean => nodeAt(address) !== null

  const rebased: UidxPatch[] = []
  for (const patch of patches) {
    switch (patch.op) {
      case 'set':
      case 'add':
      case 'remove': {
        const node = nodeAt(patch.address)
        if (!node) return null
        // The add/set distinction describes the file, and the file moved: an
        // `add` collides where the change also introduced the attribute, and
        // a `set` misses where it took it away. The op follows the file; a
        // `remove` of something already gone has nothing left to say. A move
        // earlier in this envelope carries the node's attributes with it, so
        // reading them off the node at its current address is right.
        const has = node.attrs[patch.prop] !== undefined
        if (patch.op === 'remove') {
          if (has) rebased.push(patch)
        } else {
          rebased.push({ ...patch, op: has ? 'set' : 'add' })
        }
        break
      }
      case 'remove-node':
        if (!trusted(patch.address)) return null
        rebased.push(patch)
        break
      case 'insert-node':
        if (!trusted(patch.parent)) return null
        rebased.push(patch)
        break
      case 'move-node': {
        const node = nodeAt(patch.address)
        if (!node || !trusted(patch.newParent)) return null
        rebased.push(patch)
        pending.push({ from: patch.address, to: addressOf(patch.newParent, node.name) })
        break
      }
      case 'retag': {
        // `nodeAt` already refuses a node whose element changed underneath —
        // which is exactly the collision that matters here: two retags of one
        // node, where the second was written against a tag the first replaced.
        const node = nodeAt(patch.address)
        if (!node || node.element === patch.element) return null
        rebased.push(patch)
        break
      }
    }
  }
  return rebased
}
