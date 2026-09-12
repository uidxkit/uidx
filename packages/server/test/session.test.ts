import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyPatchesIncremental, parseOrThrow } from '@uidx/format'
import { FileSession, sha256, WriteLedger, type ServerMessage } from '../src/index.js'

const VALID = `---
id: watched
---

## Visual Contract

<Component name="c" status="draft">
  <Frame name="root" cornerRadius={4} />
</Component>
`

const BROKEN = VALID.replace('<Frame name="root"', '<Blob name="root"')

let dir: string
let file: string
let session: FileSession
let received: ServerMessage[]

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uidx-session-'))
  file = join(dir, 'watched.uidx')
  await writeFile(file, VALID)
  received = []
  session = new FileSession({ file, stabilityThreshold: 10, onBroadcast: (m) => received.push(m) })
})

afterEach(async () => {
  await session.close()
  await rm(dir, { recursive: true, force: true })
})

/**
 * Waits for the watcher to settle rather than sleeping a fixed amount.
 *
 * The timeout is generous because CI runners are far slower than a dev machine
 * and filesystem event latency is the thing being waited on. Only tests that
 * genuinely exercise the watcher should use this; anything asserting on the
 * state machine drives `reload()` directly instead.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for a watcher event')
    await new Promise((r) => setTimeout(r, 15))
  }
}

describe('FileSession', () => {
  it('parses on start and exposes the document', async () => {
    const state = await session.start()
    expect(state.kind).toBe('ok')
    expect(session.revision).toBe(1)
    if (state.kind !== 'ok') throw new Error('unreachable')
    expect(state.doc.frontmatter.id).toBe('watched')
    expect(state.doc.tree.children[0]!.children[0]!.name).toBe('root')
  })

  it('broadcasts file:changed with an incremented revision on save', async () => {
    await session.start()
    received.length = 0

    await writeFile(file, VALID.replace('cornerRadius={4}', 'cornerRadius={12}'))
    await waitFor(() => received.some((m) => m.type === 'file:changed'))

    const message = received.filter((m) => m.type === 'file:changed').at(-1)!
    expect(message.type).toBe('file:changed')
    if (message.type !== 'file:changed') throw new Error('unreachable')
    expect(message.revision).toBe(2)
    // An outside save travels as the patches from the previous revision.
    expect(message.base).toBe(1)
    expect(message.patches).toEqual([
      { op: 'set', address: 'c#root', prop: 'cornerRadius', value: 12 },
    ])
    const applied = applyPatchesIncremental(parseOrThrow(VALID), message.patches!).doc
    expect(applied.sourceHash).toBe(message.sourceHash)
  })

  it('sends offsets the client can trust against the same source', async () => {
    await session.start()
    const state = session.current
    if (state.kind !== 'ok') throw new Error('unreachable')
    // Survives the JSON round trip the socket performs.
    const wire = JSON.parse(JSON.stringify(state.doc))
    const attr = wire.tree.children[0].children[0].attrs.cornerRadius
    expect(wire.source.slice(attr.valueLoc.start, attr.valueLoc.end)).toBe(attr.raw)
  })

  /**
   * Driven through `reload()`, like the recovery test below and for the same
   * reason: a write landing this soon after `start()` can be folded into the
   * initial read by `awaitWriteFinish`, so waiting for the event can wait
   * forever. That is correct watcher behaviour, and this test is about the state
   * machine — the error state, and the revision holding still — not about
   * whether chokidar fired. The single-write test above covers the watcher.
   */
  it('reports a parse error without crashing or losing the last good state', async () => {
    await session.start()
    const good = session.current
    received.length = 0

    await writeFile(file, BROKEN)
    await session.reload()

    const message = received.filter((m) => m.type === 'file:error').at(-1)!
    expect(message.type).toBe('file:error')
    if (message.type !== 'file:error') throw new Error('unreachable')
    expect(message.diagnostics.some((d) => d.code === 'UIDX100')).toBe(true)
    // The revision does not advance for a state no client can hold.
    expect(message.revision).toBe(good.revision)
  })

  /**
   * Driven through explicit `reload()` calls rather than the watcher.
   *
   * Two writes in quick succession are not two events: chokidar's
   * `awaitWriteFinish` coalesces them by design, so an intermediate broken state
   * can be skipped entirely and a test that waits for it hangs. That is correct
   * watcher behaviour — a half-written file should not be broadcast — so the
   * state machine is tested directly and the watcher is covered separately by
   * the single-write tests above.
   */
  it('recovers automatically on the next valid save', async () => {
    await session.start()

    await writeFile(file, BROKEN)
    expect((await session.reload())?.type).toBe('file:error')
    expect(session.current.kind).toBe('error')

    await writeFile(file, VALID.replace('cornerRadius={4}', 'cornerRadius={9}'))
    expect((await session.reload())?.type).toBe('file:changed')

    expect(session.current.kind).toBe('ok')
  })

  it('reports a deleted file instead of throwing', async () => {
    await session.start()
    received.length = 0
    await rm(file)
    await session.reload()
    expect(received.at(-1)!.type).toBe('file:error')
  })

  it('ignores a write that does not change the bytes', async () => {
    await session.start()
    received.length = 0
    await writeFile(file, VALID)
    await new Promise((r) => setTimeout(r, 250))
    expect(received).toEqual([])
    expect(session.revision).toBe(1)
  })

  it('swallows its own write as an echo', async () => {
    await session.start()
    received.length = 0 // start() itself broadcasts the initial state
    const next = VALID.replace('cornerRadius={4}', 'cornerRadius={20}')

    session.expectWrite(next)
    await writeFile(file, next)
    await new Promise((r) => setTimeout(r, 250))

    // No broadcast: the client already applied this optimistically (spec §6.3).
    expect(received.filter((m) => m.type === 'file:changed')).toEqual([])
  })

  it('offers a snapshot for a reconnecting client', async () => {
    await session.start()
    const snapshot = session.snapshot()
    expect(snapshot.type).toBe('file:changed')
    if (snapshot.type !== 'file:changed') throw new Error('unreachable')
    expect(snapshot.revision).toBe(session.revision)
  })
})

describe('WriteLedger', () => {
  it('claims a recorded hash exactly once', () => {
    const ledger = new WriteLedger()
    ledger.record(sha256('a'))
    expect(ledger.claim(sha256('a'))).toBe(true)
    // A second identical write must not be swallowed by a stale entry.
    expect(ledger.claim(sha256('a'))).toBe(false)
  })

  it('does not claim content it never wrote', () => {
    const ledger = new WriteLedger()
    ledger.record(sha256('a'))
    expect(ledger.claim(sha256('b'))).toBe(false)
  })

  it('forgets entries past the TTL', () => {
    let now = 1000
    const ledger = new WriteLedger(8, 2000, () => now)
    ledger.record(sha256('a'))
    now += 2001
    expect(ledger.claim(sha256('a'))).toBe(false)
  })

  it('keeps only the most recent entries', () => {
    const ledger = new WriteLedger(2)
    ledger.record(sha256('a'))
    ledger.record(sha256('b'))
    ledger.record(sha256('c'))
    expect(ledger.size).toBe(2)
    expect(ledger.claim(sha256('a'))).toBe(false)
    expect(ledger.claim(sha256('c'))).toBe(true)
  })
})

/**
 * Story C1 — the first code in this project that writes to a user's file.
 *
 * Every test here asserts on what landed on disk as well as what was sent, on
 * the principle that the file is the product: a message claiming success while
 * the bytes say otherwise is the failure mode that matters.
 */
describe('FileSession.patch (C1)', () => {
  const patch = (over: Partial<Parameters<FileSession['patch']>[0]> = {}) => ({
    patchId: 'p1',
    baseRevision: 1,
    patches: [{ op: 'set' as const, address: 'c#root', prop: 'cornerRadius', value: 12 }],
    ...over,
  })

  it('applies a patch, writes the file and acks the new revision', async () => {
    await session.start()
    const reply = await session.patch(patch())

    expect(reply).toMatchObject({ type: 'patch:applied', file, patchId: 'p1', revision: 2 })
    expect(await readFile(file, 'utf8')).toContain('cornerRadius={12}')
    expect(session.revision).toBe(2)
  })

  it('changes exactly the one line, leaving the rest byte-for-byte', async () => {
    await session.start()
    await session.patch(patch())

    const after = await readFile(file, 'utf8')
    const before = VALID.split('\n')
    const changed = after.split('\n').filter((line, i) => line !== before[i])
    expect(changed).toEqual(['  <Frame name="root" cornerRadius={12} />'])
  })

  it('broadcasts the new document so other viewers follow', async () => {
    await session.start()
    received.length = 0
    await session.patch(patch())

    const changed = received.filter((m) => m.type === 'file:changed')
    expect(changed).toHaveLength(1)
    expect(changed[0]).toMatchObject({ revision: 2 })
  })

  it('does not advance the revision for a patch that changes nothing', async () => {
    await session.start()
    const reply = await session.patch(
      patch({ patches: [{ op: 'set', address: 'c#root', prop: 'cornerRadius', value: 4 }] }),
    )
    expect(reply).toMatchObject({ type: 'patch:applied', revision: 1 })
    expect(await readFile(file, 'utf8')).toBe(VALID)
  })

  it('rejects a patch whose address does not resolve, and writes nothing', async () => {
    await session.start()
    const reply = await session.patch(
      patch({ patches: [{ op: 'set', address: 'c#ghost', prop: 'cornerRadius', value: 12 }] }),
    )
    expect(reply).toMatchObject({ type: 'patch:rejected', patchId: 'p1' })
    expect((reply as { reason: string }).reason).toMatch(/no node at address/)
    expect(await readFile(file, 'utf8')).toBe(VALID)
    expect(session.revision).toBe(1)
  })

  it('refuses to patch a page that does not parse', async () => {
    await writeFile(file, BROKEN)
    await session.start()
    const reply = await session.patch(patch({ baseRevision: 0 }))
    expect(reply).toMatchObject({ type: 'patch:rejected' })
    expect((reply as { reason: string }).reason).toMatch(/does not currently parse/)
    expect(await readFile(file, 'utf8')).toBe(BROKEN)
  })

  /**
   * C3. The client wrote its addresses against a tree it could see; if the file
   * has moved on, the same address may name a different node — or nothing.
   */
  it('rejects a patch written against an older revision as stale', async () => {
    await session.start()
    await writeFile(file, VALID.replace('cornerRadius={4}', 'cornerRadius={6}'))
    await session.reload()
    expect(session.revision).toBe(2)

    const reply = await session.patch(patch({ baseRevision: 1 }))
    expect(reply).toEqual({ type: 'patch:stale', file, patchId: 'p1', revision: 2 })
    expect(await readFile(file, 'utf8')).toContain('cornerRadius={6}')
  })

  it('accepts the same patch once the client has caught up', async () => {
    await session.start()
    await writeFile(file, VALID.replace('cornerRadius={4}', 'cornerRadius={6}'))
    await session.reload()

    const reply = await session.patch(patch({ baseRevision: 2 }))
    expect(reply).toMatchObject({ type: 'patch:applied', revision: 3 })
  })

  /**
   * C2. The write causes a watcher event carrying bytes the client already has.
   * Re-broadcasting it mid-gesture is the flicker the ledger exists to prevent.
   */
  it('swallows the watcher event its own write causes', async () => {
    await session.start()
    received.length = 0
    await session.patch(patch())

    // One `file:changed` from the patch itself, and none from the watcher —
    // waited out rather than asserted immediately, or this passes by being fast.
    await new Promise((r) => setTimeout(r, 400))
    expect(received.filter((m) => m.type === 'file:changed')).toHaveLength(1)
    expect(session.revision).toBe(2)
  })

  it('still hears a genuine external save after its own write', async () => {
    await session.start()
    await session.patch(patch())
    received.length = 0

    await writeFile(file, VALID.replace('cornerRadius={4}', 'cornerRadius={20}'))
    await waitFor(() => received.some((m) => m.type === 'file:changed'))
    expect(session.revision).toBe(3)
  })

  it('leaves no temp file behind', async () => {
    await session.start()
    await session.patch(patch())
    expect(await readdir(dir)).toEqual(['watched.uidx'])
  })

  /**
   * §6.3 — a structural op invalidates every offset after its edit point, so a
   * batch has to re-parse between ops rather than applying them all against the
   * offsets of the original text.
   */
  it('applies a batch of ops in order against a re-parsed tree', async () => {
    await session.start()
    const reply = await session.patch(
      patch({
        patches: [
          { op: 'add', address: 'c#root', prop: 'opacity', value: 0.5 },
          { op: 'set', address: 'c#root', prop: 'cornerRadius', value: 9 },
        ],
      }),
    )
    expect(reply).toMatchObject({ type: 'patch:applied', revision: 2 })
    const after = await readFile(file, 'utf8')
    expect(after).toContain('cornerRadius={9}')
    expect(after).toContain('opacity={0.5}')
  })
})
