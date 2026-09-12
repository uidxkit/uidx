import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// A real race is impractical to force deterministically end-to-end (there is
// no hook to pause `session()` mid-flight), so this spies on `openWorkspace`
// — the one call whose duplication is the actual bug — and asserts the
// structural property that matters: two concurrent callers for the same
// not-yet-cached document collapse onto a single opened workspace, not two.
// The concurrency itself (both `session()` calls racing before either has
// populated the cache) is genuine: `Promise.all` starts both callers before
// either awaits anything, and `discoverManifests`/`openWorkspace` both do
// real filesystem I/O, which is exactly the window the bug lived in.
vi.mock('../src/workspace/workspace.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/workspace/workspace.js')>()
  return { ...actual, openWorkspace: vi.fn(actual.openWorkspace) }
})

import { openWorkspace } from '../src/workspace/workspace.js'
import { createTurnRunner, type TurnRunner } from '../src/server/turn.js'

const HOME = `---
id: home
---

## Visual Contract

<Page>
  <Frame name="hero" width={600} height={200} />
</Page>
`

/** A well-formed turn id the store has never seen. */
const UNKNOWN_TURN = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

let runner: TurnRunner | null = null
afterEach(async () => {
  await runner?.close()
  runner = null
  vi.mocked(openWorkspace).mockClear()
})

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'uidx-agent-turn-concurrency-'))
  await writeFile(join(root, 'uidx.json'), JSON.stringify({ id: 'doc', files: ['**/*.uidx'] }))
  await writeFile(join(root, 'home.uidx'), HOME)
  runner = createTurnRunner({
    roots: [root],
    maxSteps: 6,
    maxFilesPerTurn: 4,
    maxTokens: 200_000,
    // `revert()` is enough to exercise `session()` end to end — it never
    // touches the model, so a throwing stub keeps the harness honest that
    // these tests are not accidentally depending on one.
    model: () => {
      throw new Error('model should not be called by these tests')
    },
  })
  return { root, runner }
}

describe('session concurrency', () => {
  it('collapses two concurrent opens of the same not-yet-cached document into one workspace', async () => {
    const { runner } = await harness()

    // Two browser tabs opening the same document at once: both `revert()`
    // calls reach `session()` before either has had a chance to populate the
    // cache.
    const [a, b] = await Promise.all([
      runner.revert({ documentId: 'doc', turnId: UNKNOWN_TURN }),
      runner.revert({ documentId: 'doc', turnId: UNKNOWN_TURN }),
    ])
    // Neither call has a checkpoint to revert — that part is incidental.
    expect(a.status).toBe(404)
    expect(b.status).toBe(404)

    // The structural property that matters: only one workspace — and one
    // chokidar watcher — was ever opened for the two racing callers.
    expect(openWorkspace).toHaveBeenCalledTimes(1)
  })

  it('lets a later call retry after a failed open', async () => {
    const { runner } = await harness()
    vi.mocked(openWorkspace).mockImplementationOnce(() => {
      throw new Error('disk unavailable')
    })

    const failed = await runner.revert({ documentId: 'doc', turnId: UNKNOWN_TURN })
    // The document was found; opening it is what went wrong. Reporting that as
    // 404 "not found" sent the caller looking for a document that is right
    // where they left it.
    expect(failed.status).toBe(500)
    expect((await failed.json()).error).toContain('disk unavailable')

    // If the failed attempt had left its rejected promise cached, this call
    // would resolve to that same rejection forever, and `openWorkspace` would
    // never be called again. Real disk access works this time, so the call
    // should get past the earlier failure and reach the (still 404, but for
    // an unrelated reason) "no checkpoint" outcome instead.
    const retried = await runner.revert({ documentId: 'doc', turnId: UNKNOWN_TURN })
    expect(retried.status).toBe(404)
    expect((await retried.json()).error).toContain('no checkpoint')
    expect(openWorkspace).toHaveBeenCalledTimes(2)
  })
})
