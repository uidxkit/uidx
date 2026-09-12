import { shallowRef } from 'vue'
import type { UidxPatch } from '@uidx/format'

/**
 * The patches this client has sent and not yet seen land (spec §4).
 *
 * Reactive through one counter rather than a reactive array: the shell's
 * `shown` computed reads `version`, so a push or a settle recomputes the
 * prediction exactly once, and nothing deep-watches patch objects.
 */
export interface InFlight {
  push(patchId: string, patches: readonly UidxPatch[]): void
  /** True if the id was in flight. */
  settle(patchId: string): boolean
  has(patchId: string): boolean
  /** Every in-flight patch, oldest batch first. */
  patches(): UidxPatch[]
  readonly size: number
  readonly version: number
}

export function createInFlight(): InFlight {
  const batches = new Map<string, readonly UidxPatch[]>()
  const version = shallowRef(0)
  return {
    push(patchId, patches) {
      batches.set(patchId, patches)
      version.value += 1
    },
    settle(patchId) {
      const had = batches.delete(patchId)
      if (had) version.value += 1
      return had
    },
    has: (patchId) => batches.has(patchId),
    patches: () => [...batches.values()].flat(),
    get size() {
      return batches.size
    },
    get version() {
      return version.value
    },
  }
}
