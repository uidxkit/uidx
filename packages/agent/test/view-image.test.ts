import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createImageStash, NO_VISION, viewImageTools } from '../src/tools/view_image.js'
import { discoverManifests } from '../src/workspace/discover.js'
import { openWorkspace, type Workspace } from '../src/workspace/workspace.js'

const HOME = `---
id: home
---

## Visual Contract

<Page>
  <Frame name="card" width={200} height={120}
    fills={[{ type: 'SOLID', color: { r: 0.1, g: 0.4, b: 0.9, a: 1 } }]} />
</Page>
`

let open: Workspace | null = null
afterEach(async () => {
  await open?.close()
  open = null
})

const stash = createImageStash()

async function harness(vision = true) {
  stash.pending.clear()
  const root = await mkdtemp(join(tmpdir(), 'uidx-view-'))
  await writeFile(join(root, 'uidx.json'), JSON.stringify({ id: 'doc', files: ['**/*.uidx'] }))
  await writeFile(join(root, 'home.uidx'), HOME)
  const [found] = await discoverManifests([root])
  open = await openWorkspace(found!)
  return viewImageTools({ workspace: open, vision, stash })
}

const run = async (tool: { execute?: unknown }, input: unknown): Promise<unknown> =>
  (tool.execute as (i: unknown, o: unknown) => Promise<unknown>)(input, {
    toolCallId: 'call-1',
    messages: [],
  })

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])

describe('view_image', () => {
  // The tool answers in words and leaves the picture in the stash. It cannot
  // return the image itself: a `tool` message carries a string in the OpenAI
  // protocol, and an image put there reaches the model as JSON text — measured
  // on the wire, with the model reporting it could see nothing at all.
  it('answers in words and stashes the picture against its call id', async () => {
    const { view_image } = await harness()
    const output = await run(view_image, { file: 'home.uidx' })
    expect(output).toContain('home.uidx')
    expect(output).toContain('image follows')
    const waiting = stash.pending.get('call-1')?.[0]
    expect(Buffer.from(waiting!.png, 'base64').subarray(0, 4)).toEqual(PNG_MAGIC)
  }, 60_000)

  // A model that cannot see must be told so, not handed bytes it will
  // confidently describe from the filename.
  it('refuses when the model has no vision', async () => {
    const { view_image } = await harness(false)
    expect(await run(view_image, { file: 'home.uidx' })).toBe(NO_VISION)
  })

  it('passes a render refusal through in the words render.ts chose', async () => {
    const { view_image } = await harness()
    expect(await run(view_image, { file: 'home.uidx', address: 'nope' })).toContain(
      'the page holds card',
    )
  }, 60_000)

  it('stashes nothing when it refused, so no picture is delivered for a failure', async () => {
    const { view_image } = await harness(false)
    await run(view_image, { file: 'home.uidx' })
    expect(stash.pending.size).toBe(0)
  })
})

/**
 * Measured without pinning: a model fetched three real switches, studied
 * them — and by drawing time every reference had been evicted by its own
 * review shots, so it drew from prose again. Comparison only beats prose
 * while both pictures are actually in view.
 */
describe('stash pinning', () => {
  it('never lets working shots evict a pinned reference', async () => {
    const { createImageStash: fresh, stash: put } = await import('../src/tools/view_image.js')
    const s = fresh()
    put(s, 'ref1', [{ png: 'r', note: 'reference', pinned: true }])
    put(s, 'work1', [{ png: 'a', note: 'shot' }])
    put(s, 'work2', [{ png: 'b', note: 'shot' }])
    put(s, 'work3', [{ png: 'c', note: 'shot' }])
    expect([...s.pending.keys()]).toEqual(['ref1', 'work2', 'work3'])
  })

  it('caps pinned references against each other, oldest first', async () => {
    const { createImageStash: fresh, stash: put } = await import('../src/tools/view_image.js')
    const s = fresh()
    for (const id of ['r1', 'r2', 'r3', 'r4']) {
      put(s, id, [{ png: id, note: 'reference', pinned: true }])
    }
    expect([...s.pending.keys()]).toEqual(['r2', 'r3', 'r4'])
  })
})
