import type { UidxPatch } from '@uidx/format'

/**
 * Which of a burst's patches say something new (story C6's field report).
 *
 * One committed edit can cascade in the scene graph: flipping
 * `primaryAxisSizingMode` to FIXED makes the SDK pin the frame's current hug
 * width, and the layout engine re-announces that same write on its next pass
 * and once more when the server's echo settles. `fromSceneChange` cannot see
 * the repetition — it compares against the document, and the document does not
 * carry the write until the echo lands — so each announcement became its own
 * dispatch, racing the revision the previous one had already advanced. C3
 * refused the losers loudly, which is how a single click produced the stale
 * banner for an edit the author made exactly once.
 *
 * The comparison deliberately ignores `op`: what was an `add` while the prop
 * was absent re-announces as a `set` once the echo has landed it, and both say
 * the same thing about the file.
 */
export function novelPatches(
  pending: readonly UidxPatch[],
  incoming: readonly UidxPatch[],
): UidxPatch[] {
  const seen = new Set(pending.map(key).filter((k): k is string => k !== null))
  const novel: UidxPatch[] = []
  for (const patch of incoming) {
    const k = key(patch)
    // Structural ops never cascade this way and are not comparable by value —
    // they pass through untouched.
    if (k === null) {
      novel.push(patch)
      continue
    }
    if (seen.has(k)) continue
    seen.add(k)
    novel.push(patch)
  }
  return novel
}

/** `op` is excluded on purpose — see above. Null for structural ops. */
function key(patch: UidxPatch): string | null {
  if (patch.op !== 'set' && patch.op !== 'add' && patch.op !== 'remove') return null
  const value = patch.op === 'remove' ? '' : JSON.stringify(patch.value)
  return `${patch.address} ${patch.prop} ${value}`
}

/**
 * One envelope may only say one thing per property.
 *
 * A commit to a prop the layout engine also writes can announce the same
 * address+prop twice in one microtask with *different* values — measured as
 * `[add x=<scrubbed>, add x=<flow>]` scrubbing x on a flowed child. The server
 * applies ops serially and re-parses between them, so the second `add` found
 * the attribute the first had just created and refused the whole envelope
 * ("already has attribute; use the set op") for an edit the author made once.
 *
 * The burst's last patch is where the scene actually settled, so it wins. The
 * op still describes the *file*: what began as an `add` stays an `add`
 * whatever follows it, and an `add` taken back by a `remove` collapses to
 * nothing — the file never had the attribute to remove.
 */
export function collapseBurst(patches: readonly UidxPatch[]): UidxPatch[] {
  const groups = new Map<string, { first: UidxPatch; last: UidxPatch }>()
  const slot = (patch: UidxPatch): string | null =>
    patch.op === 'set' || patch.op === 'add' || patch.op === 'remove'
      ? `${patch.address} ${patch.prop}`
      : null

  for (const patch of patches) {
    const k = slot(patch)
    if (k === null) continue
    const group = groups.get(k)
    if (group) group.last = patch
    else groups.set(k, { first: patch, last: patch })
  }

  const out: UidxPatch[] = []
  const emitted = new Set<string>()
  for (const patch of patches) {
    const k = slot(patch)
    if (k === null) {
      out.push(patch)
      continue
    }
    if (emitted.has(k)) continue
    emitted.add(k)
    const { first, last } = groups.get(k)!
    if (last.op === 'remove') {
      if (first.op !== 'add') out.push(last)
      continue
    }
    if (first.op === 'add' && last.op === 'set') out.push({ ...last, op: 'add' })
    else out.push(last)
  }
  return out
}
