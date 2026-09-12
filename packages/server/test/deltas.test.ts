import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyPatchesIncremental, parseOrThrow } from '@uidx/format'
import { FileSession, type ServerMessage } from '../src/index.js'

const VALID = `---
id: watched
---

## Core Intent

Prose.

## Visual Contract

<Page>
  <Frame name="root" cornerRadius={4}>
    <Rectangle name="a" width={10} />
  </Frame>
</Page>
`

let dir: string
let file: string
let session: FileSession
let received: ServerMessage[]

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uidx-deltas-'))
  file = join(dir, 'watched.uidx')
  await writeFile(file, VALID)
  received = []
  session = new FileSession({ file, stabilityThreshold: 10, onBroadcast: (m) => received.push(m) })
  await session.start()
})

afterEach(async () => {
  await session.close()
  await rm(dir, { recursive: true, force: true })
})

async function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 20))
  }
}

const changed = () =>
  received.filter((m) => m.type === 'file:changed') as Extract<
    ServerMessage,
    { type: 'file:changed' }
  >[]

describe('deltas on the wire (spec: viewer at scale §2)', () => {
  it('a patch write broadcasts the patches, the base revision and the hash, without the document', async () => {
    const reply = await session.patch({
      patchId: 'p1',
      baseRevision: session.revision,
      patches: [{ op: 'set', address: 'root', prop: 'cornerRadius', value: 8 }],
    })
    expect(reply.type).toBe('patch:applied')
    const delta = changed().find((m) => m.revision === 2)!
    expect(delta.doc).toBeUndefined()
    expect(delta.base).toBe(1)
    expect(delta.patchId).toBe('p1')
    expect(delta.patches).toEqual([{ op: 'set', address: 'root', prop: 'cornerRadius', value: 8 }])
    // A client holding revision 1 lands on the server's document.
    const mine = applyPatchesIncremental(parseOrThrow(VALID), delta.patches!).doc
    expect(mine.sourceHash).toBe(delta.sourceHash)
    expect(session.current.kind === 'ok' && session.current.doc.sourceHash).toBe(delta.sourceHash)
  })

  it('an outside write broadcasts a diff-derived delta against the previous revision', async () => {
    await writeFile(file, VALID.replace('width={10}', 'width={20}'))
    await waitFor(() => changed().some((m) => m.revision === 2))
    const delta = changed().find((m) => m.revision === 2)!
    expect(delta.doc).toBeUndefined()
    expect(delta.base).toBe(1)
    expect(delta.patches).toEqual([{ op: 'set', address: 'root#a', prop: 'width', value: 20 }])
    const mine = applyPatchesIncremental(parseOrThrow(VALID), delta.patches!).doc
    expect(mine.sourceHash).toBe(delta.sourceHash)
  })

  it('a prose-only outside write is an empty delta with a new hash — the client will ask for the document', async () => {
    await writeFile(file, VALID.replace('Prose.', 'Different prose.'))
    await waitFor(() => changed().some((m) => m.revision === 2))
    const delta = changed().find((m) => m.revision === 2)!
    expect(delta.patches).toEqual([])
    expect(delta.doc).toBeUndefined()
    expect(delta.sourceHash).not.toBe(parseOrThrow(VALID).sourceHash)
  })

  it('a snapshot carries the whole document and its hash', () => {
    const snapshot = session.snapshot() as Extract<ServerMessage, { type: 'file:changed' }>
    expect(snapshot.type).toBe('file:changed')
    expect(snapshot.doc).toBeDefined()
    expect(snapshot.sourceHash).toBe(snapshot.doc!.sourceHash)
    expect(snapshot.patches).toBeUndefined()
  })

  it('the first parse after an error state is a full document, not a delta', async () => {
    await writeFile(file, VALID.replace('<Rectangle name="a" width={10} />', '<Blob name="a" />'))
    await waitFor(() => received.some((m) => m.type === 'file:error'))
    await writeFile(file, VALID.replace('width={10}', 'width={30}'))
    await waitFor(() => changed().some((m) => m.revision === 2))
    const full = changed().find((m) => m.revision === 2)!
    expect(full.doc).toBeDefined()
    expect(full.patches).toBeUndefined()
  })
})
