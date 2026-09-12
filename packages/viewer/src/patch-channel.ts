import type { UidxDocument, UidxPatch } from '@uidx/format'
import type { ServerMessage } from '@uidx/server/protocol'

/**
 * The client half of the write path (stories C1 and C3).
 *
 * Owns the one thing the server cannot: knowing which patches are in flight, and
 * what the author should be told when one does not land. The server answers a
 * patch three ways and they mean different things to a person —
 *
 *   `patch:applied`  the file moved; nothing to say
 *   `patch:stale`    somebody else edited the file first; re-sync and retry
 *   `patch:rejected` the edit cannot be made at all; say why
 *
 * — so collapsing them into "failed" would leave the author unable to tell a
 * race from a mistake.
 *
 * Deliberately not a Vue composable: it is a state machine over messages, and
 * keeping it framework-free is what lets it be tested without mounting anything.
 */

export type PatchOutcome = 'applied' | 'stale' | 'rejected' | 'dropped'

export interface PatchNotice {
  kind: Exclude<PatchOutcome, 'applied'>
  message: string
}

export interface InFlight {
  patchId: string
  file: string
  baseRevision: number
  patches: readonly UidxPatch[]
  /** The document the patches were written against, for the rebase check. */
  baseDoc?: UidxDocument
  /** How many times this patch has been re-sent after a stale answer. */
  rebases: number
}

/** A fast external writer could stale the same patch forever; three is plenty. */
const MAX_REBASES = 3

export interface PatchChannelOptions {
  /** Returns false when the connection is down, which is a `dropped` outcome. */
  send(message: {
    type: 'node:patch'
    file: string
    patchId: string
    baseRevision: number
    patches: UidxPatch[]
  }): boolean
  /**
   * Called when in-flight optimistic state must be thrown away — a stale
   * rejection, a refusal, or a patch that never left. The authoritative document
   * arrives separately as `file:changed`; this is the signal to stop trusting
   * what the canvas is currently showing.
   */
  onRollback(inFlight: InFlight, outcome: Exclude<PatchOutcome, 'applied'>): void
  onNotice(notice: PatchNotice | null): void
  /**
   * Answers a stale rejection with patches safe to re-send against `revision`,
   * or null when they cannot be trusted anymore — the node they target left
   * the file, or something else sits at its address (E4). Absent, every stale
   * patch rolls back the way it did before rebasing existed.
   */
  rebase?(entry: InFlight, revision: number): UidxPatch[] | null
  /** Injectable so tests are not at the mercy of a clock. */
  now?: () => number
}

export interface PatchChannel {
  /** Sends patches for one page. Returns the id, or null if nothing was sent. */
  dispatch(
    file: string,
    baseRevision: number,
    patches: readonly UidxPatch[],
    baseDoc?: UidxDocument,
  ): string | null
  /** Feed every server message here; unrelated ones are ignored. */
  accept(message: ServerMessage): void
  readonly pending: number
  /** True while any patch this client sent is unanswered. */
  isPending(patchId: string): boolean
}

export function createPatchChannel(options: PatchChannelOptions): PatchChannel {
  const inFlight = new Map<string, InFlight>()
  let counter = 0

  const settle = (patchId: string, outcome: Exclude<PatchOutcome, 'applied'>, message: string) => {
    const entry = inFlight.get(patchId)
    if (!entry) return
    inFlight.delete(patchId)
    options.onRollback(entry, outcome)
    options.onNotice({ kind: outcome, message })
  }

  const post = (entry: InFlight): boolean => {
    const sent = options.send({
      type: 'node:patch',
      file: entry.file,
      patchId: entry.patchId,
      baseRevision: entry.baseRevision,
      patches: [...entry.patches],
    })
    if (!sent) {
      settle(
        entry.patchId,
        'dropped',
        'Not connected to the uidx server — that edit did not reach the file.',
      )
    }
    return sent
  }

  return {
    dispatch(file, baseRevision, patches, baseDoc) {
      if (patches.length === 0) return null
      // Unique within this client, which is all it has to be: the server echoes
      // it back untouched and never compares ids across connections.
      const patchId = `p${++counter}`
      const entry: InFlight = { patchId, file, baseRevision, patches, baseDoc, rebases: 0 }
      inFlight.set(patchId, entry)
      return post(entry) ? patchId : null
    },

    accept(message) {
      switch (message.type) {
        case 'patch:applied': {
          if (!inFlight.delete(message.patchId)) return
          // Success is silent on purpose. The file changed, the canvas already
          // shows it, and a toast for every committed drag is noise.
          options.onNotice(null)
          return
        }
        case 'patch:stale': {
          // E4. The file moved, but the file moving is normal — it is the
          // source of truth. If the edit's target survived the change it
          // re-applies against the revision the server actually has, and the
          // author never hears about the race.
          const entry = inFlight.get(message.patchId)
          if (entry && options.rebase && entry.rebases < MAX_REBASES) {
            const rebased = options.rebase(entry, message.revision)
            if (rebased) {
              entry.baseRevision = message.revision
              entry.patches = rebased
              entry.rebases += 1
              post(entry)
              return
            }
            settle(
              message.patchId,
              'stale',
              'The file changed underneath that edit and the node it targeted is ' +
                'no longer there, so it was not applied.',
            )
            return
          }
          settle(
            message.patchId,
            'stale',
            'The file changed underneath that edit, so it was not applied. ' +
              'The canvas has been re-synced — try again.',
          )
          return
        }
        case 'patch:rejected':
          settle(message.patchId, 'rejected', message.reason)
          return
        default:
          return
      }
    },

    get pending() {
      return inFlight.size
    },

    isPending(patchId) {
      return inFlight.has(patchId)
    },
  }
}
