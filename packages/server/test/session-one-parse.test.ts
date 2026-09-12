import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as format from '@uidx/format'
import { FileSession, type ServerMessage } from '../src/index.js'

// A pass-through mock: `parse` still parses, but every call is counted.
vi.mock('@uidx/format', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@uidx/format')>()
  return { ...actual, parse: vi.fn(actual.parse) }
})

const VALID = `---
id: watched
---

## Visual Contract

<Component name="c" status="draft">
  <Frame name="root" cornerRadius={4} />
</Component>
`

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
  await session.start()
  vi.mocked(format.parse).mockClear()
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

describe('one parse per patch (spec §2)', () => {
  it('never parses itself on the happy path — the patcher’s validating parse is reused', async () => {
    const reply = await session.patch({
      patchId: 'p1',
      baseRevision: session.revision,
      patches: [{ op: 'set', address: 'c#root', prop: 'cornerRadius', value: 8 }],
    })
    expect(reply.type).toBe('patch:applied')
    // The patcher's own validating parse is a call inside `@uidx/format` and
    // does not pass through this mock; anything counted here is the session
    // parsing a second time.
    expect(vi.mocked(format.parse)).toHaveBeenCalledTimes(0)
    expect(session.current.kind === 'ok' && session.current.doc.source).toContain(
      'cornerRadius={8}',
    )
  })

  it('stamps its own write with the patch id, and a watcher reload with none', async () => {
    await session.patch({
      patchId: 'p7',
      baseRevision: session.revision,
      patches: [{ op: 'set', address: 'c#root', prop: 'cornerRadius', value: 8 }],
    })
    const own = received.find((m) => m.type === 'file:changed' && m.revision === 2)
    expect(own).toMatchObject({ type: 'file:changed', patchId: 'p7' })

    await writeFile(file, VALID.replace('cornerRadius={4}', 'cornerRadius={5}'))
    await waitFor(() => received.some((m) => m.type === 'file:changed' && m.revision === 3))
    const external = received.find((m) => m.type === 'file:changed' && m.revision === 3)!
    expect((external as { patchId?: string }).patchId).toBeUndefined()
  })
})
