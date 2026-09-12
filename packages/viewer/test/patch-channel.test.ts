import { describe, expect, it, vi } from 'vitest'
import type { UidxPatch } from '@uidx/format'
import type { ServerMessage } from '@uidx/server/protocol'
import { createPatchChannel, type InFlight, type PatchNotice } from '../src/patch-channel'

const PATCH: UidxPatch = { op: 'set', address: 'c#root', prop: 'cornerRadius', value: 12 }

function harness(
  sendable = true,
  rebase?: (entry: InFlight, revision: number) => UidxPatch[] | null,
) {
  const sent: unknown[] = []
  const rollbacks: { inFlight: InFlight; outcome: string }[] = []
  const notices: (PatchNotice | null)[] = []
  const channel = createPatchChannel({
    send: (message) => {
      sent.push(message)
      return sendable
    },
    onRollback: (inFlight, outcome) => rollbacks.push({ inFlight, outcome }),
    onNotice: (notice) => notices.push(notice),
    ...(rebase ? { rebase } : {}),
  })
  return { channel, sent, rollbacks, notices }
}

const stale = (patchId: string, revision: number): ServerMessage =>
  ({ type: 'patch:stale', file: 'page.uidx', patchId, revision }) as ServerMessage

describe('patch channel', () => {
  it('sends a page-addressed envelope carrying the base revision', () => {
    const { channel, sent } = harness()
    const id = channel.dispatch('page.uidx', 7, [PATCH])

    expect(id).toBe('p1')
    expect(sent).toEqual([
      {
        type: 'node:patch',
        file: 'page.uidx',
        patchId: 'p1',
        baseRevision: 7,
        patches: [PATCH],
      },
    ])
    expect(channel.pending).toBe(1)
  })

  it('sends nothing for an empty patch list', () => {
    const { channel, sent } = harness()
    expect(channel.dispatch('page.uidx', 1, [])).toBeNull()
    expect(sent).toEqual([])
  })

  it('clears the patch on an ack, and says nothing about it', () => {
    const { channel, rollbacks, notices } = harness()
    const id = channel.dispatch('page.uidx', 1, [PATCH])!
    channel.accept({
      type: 'patch:applied',
      file: 'page.uidx',
      patchId: id,
      revision: 2,
    } as ServerMessage)

    expect(channel.pending).toBe(0)
    // Success is silent: a toast for every committed drag is noise.
    expect(rollbacks).toEqual([])
    expect(notices).toEqual([null])
  })

  /**
   * C3. A stale rejection means an edit the author made is *not* in their file,
   * which they have to be told — and the optimistic canvas state has to go.
   */
  it('rolls back and explains a stale rejection', () => {
    const { channel, rollbacks, notices } = harness()
    const id = channel.dispatch('page.uidx', 1, [PATCH])!
    channel.accept({
      type: 'patch:stale',
      file: 'page.uidx',
      patchId: id,
      revision: 5,
    } as ServerMessage)

    expect(channel.pending).toBe(0)
    expect(rollbacks).toHaveLength(1)
    expect(rollbacks[0]!.outcome).toBe('stale')
    expect(rollbacks[0]!.inFlight.patches).toEqual([PATCH])
    expect(notices.at(-1)).toMatchObject({ kind: 'stale' })
    expect(notices.at(-1)!.message).toMatch(/changed underneath/)
  })

  it('passes the server’s own reason through on a rejection', () => {
    const { channel, notices } = harness()
    const id = channel.dispatch('page.uidx', 1, [PATCH])!
    channel.accept({
      type: 'patch:rejected',
      file: 'page.uidx',
      patchId: id,
      revision: 1,
      reason: 'no node at address "c#ghost"',
    } as ServerMessage)

    expect(notices.at(-1)).toEqual({ kind: 'rejected', message: 'no node at address "c#ghost"' })
  })

  it('treats a patch that never left as a rollback too', () => {
    const { channel, rollbacks, notices } = harness(false)
    expect(channel.dispatch('page.uidx', 1, [PATCH])).toBeNull()

    expect(channel.pending).toBe(0)
    expect(rollbacks[0]!.outcome).toBe('dropped')
    expect(notices.at(-1)!.message).toMatch(/Not connected/)
  })

  it('ignores an answer to a patch it never sent', () => {
    const { channel, rollbacks, notices } = harness()
    channel.accept({
      type: 'patch:stale',
      file: 'page.uidx',
      patchId: 'someone-else',
      revision: 2,
    } as ServerMessage)
    expect(rollbacks).toEqual([])
    expect(notices).toEqual([])
  })

  it('ignores messages that are not about patches', () => {
    const { channel } = harness()
    channel.dispatch('page.uidx', 1, [PATCH])
    channel.accept({ type: 'document:opened', id: 'd', pages: [], entry: 'x' } as ServerMessage)
    expect(channel.pending).toBe(1)
  })

  it('keeps concurrent patches apart', () => {
    const { channel, rollbacks } = harness()
    const first = channel.dispatch('page.uidx', 1, [PATCH])!
    const second = channel.dispatch('page.uidx', 1, [PATCH])!
    expect(first).not.toBe(second)
    expect(channel.pending).toBe(2)

    channel.accept({
      type: 'patch:applied',
      file: 'page.uidx',
      patchId: second,
      revision: 2,
    } as ServerMessage)
    expect(channel.isPending(first)).toBe(true)
    expect(channel.isPending(second)).toBe(false)
    expect(rollbacks).toEqual([])
  })

  /**
   * E4. The file is the source of truth and it moved — but the edit was to a
   * node that is still there, so it re-applies against the revision the server
   * actually has instead of being thrown away.
   */
  it('rebases a stale patch onto the server’s revision instead of rolling back', () => {
    const { channel, sent, rollbacks, notices } = harness(true, (entry) => [...entry.patches])
    const id = channel.dispatch('page.uidx', 1, [PATCH])!
    channel.accept(stale(id, 5))

    expect(sent).toHaveLength(2)
    expect(sent[1]).toMatchObject({ patchId: id, baseRevision: 5, patches: [PATCH] })
    expect(channel.isPending(id)).toBe(true)
    expect(rollbacks).toEqual([])
    expect(notices).toEqual([])
  })

  it('hands the rebase hook the entry and the revision the server reported', () => {
    const seen: { entry: InFlight; revision: number }[] = []
    const baseDoc = { source: 'doc-at-rev-1' }
    const { channel } = harness(true, (entry, revision) => {
      seen.push({ entry, revision })
      return null
    })
    const id = channel.dispatch('page.uidx', 1, [PATCH], baseDoc as never)!
    channel.accept(stale(id, 5))

    expect(seen).toHaveLength(1)
    expect(seen[0]!.revision).toBe(5)
    expect(seen[0]!.entry.baseDoc).toBe(baseDoc)
    expect(seen[0]!.entry.patches).toEqual([PATCH])
  })

  it('rolls back with its own explanation when the rebase cannot be trusted', () => {
    const { channel, rollbacks, notices } = harness(true, () => null)
    const id = channel.dispatch('page.uidx', 1, [PATCH])!
    channel.accept(stale(id, 5))

    expect(channel.pending).toBe(0)
    expect(rollbacks[0]!.outcome).toBe('stale')
    expect(notices.at(-1)!.message).toMatch(/no longer there/)
  })

  it('gives up after three rebases so a fast writer cannot livelock it', () => {
    const { channel, sent, rollbacks } = harness(true, (entry) => [...entry.patches])
    const id = channel.dispatch('page.uidx', 1, [PATCH])!
    for (const revision of [2, 3, 4, 5]) channel.accept(stale(id, revision))

    // The original send plus three rebases; the fourth stale settles.
    expect(sent).toHaveLength(4)
    expect(channel.pending).toBe(0)
    expect(rollbacks).toHaveLength(1)
    expect(rollbacks[0]!.outcome).toBe('stale')
  })

  it('clears a rebased patch silently once it lands', () => {
    const { channel, rollbacks, notices } = harness(true, (entry) => [...entry.patches])
    const id = channel.dispatch('page.uidx', 1, [PATCH])!
    channel.accept(stale(id, 5))
    channel.accept({
      type: 'patch:applied',
      file: 'page.uidx',
      patchId: id,
      revision: 6,
    } as ServerMessage)

    expect(channel.pending).toBe(0)
    expect(rollbacks).toEqual([])
    expect(notices).toEqual([null])
  })

  it('does not send when the caller supplies no patches at all', () => {
    const send = vi.fn(() => true)
    const channel = createPatchChannel({ send, onRollback: () => {}, onNotice: () => {} })
    channel.dispatch('page.uidx', 1, [])
    expect(send).not.toHaveBeenCalled()
  })
})
