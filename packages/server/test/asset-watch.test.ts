import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Workspace } from '../src/workspace.js'
import type { ServerMessage } from '../src/protocol.js'

/**
 * The artwork half of the watch (ADR 0006 §9).
 *
 * Driven through `Workspace` rather than `AssetWatcher` directly, because the
 * behaviour worth pinning is the wiring: that the watch set is derived from
 * what the *pages* reference, and that it follows them as they change.
 */

const withImage = (id: string, src: string) => `---
id: ${id}
---

## Visual Contract

<Page>
  <Frame name="banner" x={0} y={0} width={100} height={100}
    fills={[{ type: 'IMAGE', src: '${src}' }]} />
</Page>
`

const NO_IMAGE = `---
id: plain
---

## Visual Contract

<Page>
  <Frame name="card" x={0} y={0} width={100} height={100} />
</Page>
`

let dir: string
let workspace: Workspace | null = null
let received: ServerMessage[] = []

const write = (name: string, body: string) => writeFile(join(dir, name), body)

async function waitFor(predicate: () => boolean, timeout = 15_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 10))
  }
}

const changedAssets = () =>
  received.filter((m) => m.type === 'asset:changed').map((m) => (m as { src: string }).src)

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uidx-assets-'))
  await mkdir(join(dir, 'assets'), { recursive: true })
  await writeFile(join(dir, 'uidx.json'), '{ "id": "ws", "files": ["*.uidx"] }')
  await writeFile(join(dir, 'assets', 'logo.png'), 'first')
  received = []
})

afterEach(async () => {
  await workspace?.close()
  workspace = null
  await rm(dir, { recursive: true, force: true })
})

async function open(): Promise<Workspace> {
  workspace = await Workspace.open({
    from: dir,
    stabilityThreshold: 10,
    onBroadcast: (m) => received.push(m),
  })
  await workspace.start()
  // Every test below writes to disk on the next line. chokidar folds a write
  // that lands before its first scan finishes into that scan, and announces it
  // to nobody under `ignoreInitial` — a race a real edit never loses and a test
  // loses about half the time.
  await workspace.whenAssetsReady()
  return workspace
}

describe('the artwork watch', () => {
  it('watches what the pages reference, not what the folder holds', async () => {
    // Two files on disk, one referenced. The unreferenced one is not watched:
    // an event for artwork nobody paints with has no consumer, and a document
    // beside a large asset folder must not pay for the whole of it.
    await writeFile(join(dir, 'assets', 'unused.png'), 'nobody')
    await write('hero.uidx', withImage('hero', 'assets/logo.png'))

    const ws = await open()

    expect(ws.watchedAssets).toEqual(['assets/logo.png'])
  })

  it('watches nothing at all for a document with no artwork', async () => {
    await write('plain.uidx', NO_IMAGE)

    const ws = await open()

    expect(ws.watchedAssets).toEqual([])
  })

  it('deduplicates a file two pages paint with', async () => {
    await write('one.uidx', withImage('one', 'assets/logo.png'))
    await write('two.uidx', withImage('two', 'assets/logo.png'))

    const ws = await open()

    expect(ws.watchedAssets).toEqual(['assets/logo.png'])
  })

  it('announces a rewritten image, by the src a client knows it as', async () => {
    await write('hero.uidx', withImage('hero', 'assets/logo.png'))
    await open()

    await writeFile(join(dir, 'assets', 'logo.png'), 'second')

    // The `src`, not the absolute path: that is the key the client's asset
    // store holds bytes under, and the only name it has for the file.
    await waitFor(() => changedAssets().includes('assets/logo.png'))
  })

  it('announces artwork that appears after the page referencing it', async () => {
    // The ordinary case: the page names the image before the author has saved
    // it. Until then the tile draws a placeholder, and this is what tells it to
    // stop.
    await write('hero.uidx', withImage('hero', 'assets/late.png'))
    await open()

    await writeFile(join(dir, 'assets', 'late.png'), 'arrived')

    await waitFor(() => changedAssets().includes('assets/late.png'))
  })

  it('announces artwork that is deleted', async () => {
    await write('hero.uidx', withImage('hero', 'assets/logo.png'))
    await open()

    await unlink(join(dir, 'assets', 'logo.png'))

    // Drawing artwork that is no longer there is worse than drawing the gap.
    await waitFor(() => changedAssets().includes('assets/logo.png'))
  })

  it('follows a page that changes which image it paints with', async () => {
    await writeFile(join(dir, 'assets', 'other.png'), 'other')
    await write('hero.uidx', withImage('hero', 'assets/logo.png'))
    const ws = await open()

    await write('hero.uidx', withImage('hero', 'assets/other.png'))
    await waitFor(() => ws.watchedAssets.includes('assets/other.png'))

    // The old reference is dropped, or a document would accumulate watchers for
    // every image it ever named.
    expect(ws.watchedAssets).toEqual(['assets/other.png'])
  })

  it('stops watching when the last page referencing a file drops it', async () => {
    await write('hero.uidx', withImage('hero', 'assets/logo.png'))
    const ws = await open()

    await write('hero.uidx', NO_IMAGE)
    await waitFor(() => ws.watchedAssets.length === 0)

    expect(ws.watchedAssets).toEqual([])
  })

  it('says nothing about a file no page references', async () => {
    await writeFile(join(dir, 'assets', 'unused.png'), 'nobody')
    await write('hero.uidx', withImage('hero', 'assets/logo.png'))
    await open()

    await writeFile(join(dir, 'assets', 'unused.png'), 'still nobody')
    // Give the watcher the same window the announced cases need, then check
    // nothing arrived — the point is the absence.
    await writeFile(join(dir, 'assets', 'logo.png'), 'second')
    await waitFor(() => changedAssets().includes('assets/logo.png'))

    expect(changedAssets()).not.toContain('assets/unused.png')
  })
})
