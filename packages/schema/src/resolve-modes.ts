import { aliasTarget, type JsonValue, type UidxNode } from '@uidx/format'
import type { TokenIndex } from './token-index.js'

/** Which mode is in effect for each collection. Figma's `resolvedVariableModes`. */
export type ModeTuple = ReadonlyMap<string, string>

/** Every collection at its leftmost mode. */
export function defaultTuple(index: TokenIndex): ModeTuple {
  const out = new Map<string, string>()
  for (const [name, info] of index.collections) out.set(name, info.modes[0]!)
  return out
}

/**
 * A stable cache key.
 *
 * Sorted, because two tuples holding the same pairs in a different insertion
 * order are the same tuple. Keying on object identity instead is precisely how
 * this design becomes the slow one it was chosen over: every node would miss.
 */
export function modeTupleKey(tuple: ModeTuple): string {
  return [...tuple]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([collection, mode]) => `${collection}:${mode}`)
    .join('|')
}

/**
 * A node's explicit selection layered over what it inherited.
 *
 * Returns the *same* tuple object when nothing actually changed, which is what
 * keeps the cache warm: a node that selects the mode it already had must not
 * mint a new key. An override naming a collection or mode that does not exist
 * is dropped rather than honoured — the file is diagnosed elsewhere, and the
 * renderer's job is to draw what it can.
 */
export function mergeModes(
  tuple: ModeTuple,
  overrides: Record<string, string>,
  index: TokenIndex,
): ModeTuple {
  let next: Map<string, string> | null = null
  for (const [collection, mode] of Object.entries(overrides)) {
    const info = index.collections.get(collection)
    if (!info || !info.modes.includes(mode)) continue
    if (tuple.get(collection) === mode) continue
    next ??= new Map(tuple)
    next.set(collection, mode)
  }
  return next ?? tuple
}

/**
 * Flattens alias chains under one mode tuple, memoised.
 *
 * One instance per document load. The cache is dropped by discarding the
 * resolver, which is what G6's rebuild-wholesale behaviour already does on any
 * token change — so there is no incremental bookkeeping to get wrong.
 */
export class TokenResolver {
  #cache = new Map<string, ReadonlyMap<string, JsonValue>>()
  #misses = 0

  constructor(private readonly index: TokenIndex) {}

  /** Cache misses so far. A test hook: the property A′ exists to guarantee. */
  get misses(): number {
    return this.#misses
  }

  resolve(tuple: ModeTuple): ReadonlyMap<string, JsonValue> {
    const key = modeTupleKey(tuple)
    const hit = this.#cache.get(key)
    if (hit) return hit
    this.#misses++
    const built = this.#build(tuple)
    this.#cache.set(key, built)
    return built
  }

  /** One address's authored value under this tuple, before alias-following. */
  #authored(address: string, tuple: ModeTuple): JsonValue | undefined {
    const entry = this.index.entries.get(address)
    if (!entry) return undefined
    const info = this.index.collections.get(entry.collection)
    const mode = tuple.get(entry.collection) ?? info?.modes[0]
    // A variable missing one of its collection's modes is a diagnostic, and
    // resolves to the default-mode value so an incomplete file still draws.
    return (
      (mode !== undefined ? entry.valuesByMode[mode] : undefined) ??
      (info ? entry.valuesByMode[info.modes[0]!] : undefined)
    )
  }

  #build(tuple: ModeTuple): ReadonlyMap<string, JsonValue> {
    const resolved = new Map<string, JsonValue>()
    for (const address of this.index.entries.keys()) {
      const seen = new Set<string>([address])
      let current = this.#authored(address, tuple)

      for (;;) {
        const target = current === undefined ? null : aliasTarget(current)
        if (target === null) break
        if (seen.has(target)) {
          current = undefined // a cycle: leave it unresolved
          break
        }
        seen.add(target)
        current = this.#authored(target, tuple)
      }

      if (current !== undefined) resolved.set(address, current)
    }
    return resolved
  }
}

/**
 * The mode tuple in effect at one address (story G8).
 *
 * The panel's counterpart to the renderer's descent: the canvas learns a node's
 * tuple by carrying it down, but the inspector is handed an address out of
 * nowhere and has to reconstruct it. Same accumulation, walked once per
 * selection change rather than once per node — so the picker previews a value
 * in the mode the selected node is actually in, and detaching writes that one.
 *
 * Returns the default tuple when the address is not found, which is what an
 * empty selection should resolve against anyway.
 */
export function tupleAt(root: UidxNode, address: string, index: TokenIndex): ModeTuple {
  const found = (node: UidxNode, tuple: ModeTuple): ModeTuple | null => {
    const declared = node.attrs.modes?.value
    const here =
      declared !== null && typeof declared === 'object' && !Array.isArray(declared)
        ? mergeModes(tuple, declared as Record<string, string>, index)
        : tuple
    if (node.address === address) return here
    for (const child of node.children) {
      const hit = found(child, here)
      if (hit) return hit
    }
    return null
  }
  return found(root, defaultTuple(index)) ?? defaultTuple(index)
}
