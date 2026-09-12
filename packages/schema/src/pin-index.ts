import type { Pin } from './pins.js'

/**
 * Which scene node carries which pin.
 *
 * The same species as `AddressMap`, kept on the same path and for the same
 * reason: built during construction, mutated by `applyChanges` as nodes come
 * and go, and handed around as part of the `SceneResult` so no caller can
 * forget to pass it.
 *
 * It exists because the scene node cannot answer the question. The offsets are
 * authored-only props with no scene field (ADR 0011 §2) — that absence is what
 * stops a reflow announcing one back at the file — and an instance's generated
 * children have no address to look the document up by either (findings §4c).
 *
 * A stale entry here is a silently wrong filter rather than a crash: the
 * resolver would place a child against last minute's offset and `from-scene`
 * would let a computed coordinate through. Hence `pin-index.test.ts`.
 */
export interface PinMap {
  pinOf(sceneId: string): Pin | undefined
  /** Every pinned scene id. The pin pass reads these instead of walking a subtree. */
  ids(): Iterable<string>
}

export interface MutablePinMap extends PinMap {
  /** Records this node's pin. `undefined` clears any pin it used to have. */
  link(sceneId: string, pin: Pin | undefined): void
  /** Forgets this node and everything beneath it, as deleting a subtree does. */
  unlink(sceneId: string): void
}

export function createPinMap(): MutablePinMap {
  const pins = new Map<string, Pin>()

  return {
    pinOf: (sceneId) => pins.get(sceneId),
    ids: () => pins.keys(),

    link(sceneId, pin) {
      if (pin) pins.set(sceneId, pin)
      else pins.delete(sceneId)
    },

    unlink(sceneId) {
      pins.delete(sceneId)
      // A subtree leaves as a subtree, exactly as `AddressMap.unlink` does.
      // Scene ids are addresses for authored nodes (ADR 0003), so a node's
      // descendants are precisely the keys beneath its own.
      const prefix = `${sceneId}/`
      for (const key of [...pins.keys()]) if (key.startsWith(prefix)) pins.delete(key)
    },
  }
}
