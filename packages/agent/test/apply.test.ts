import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createCheckpointStore } from '../src/edit/checkpoint.js'
import { applyOps, createFile, deleteFile, type ApplyContext } from '../src/edit/apply.js'
import { discoverManifests } from '../src/workspace/discover.js'
import { openWorkspace, type Workspace } from '../src/workspace/workspace.js'

const HOME = `---
id: home
---

## Visual Contract

<Page>
  <Frame name="hero" width={600} height={200} />
</Page>
`

/** The store insists on a real turn id; the service always hands it a UUID. */
const TURN = '7d1f0a2c-4b3e-4f6a-9c8d-0e1f2a3b4c5d'

let open: Workspace | null = null
afterEach(async () => {
  await open?.close()
  open = null
})

async function context(): Promise<ApplyContext> {
  const root = await mkdtemp(join(tmpdir(), 'uidx-agent-apply-'))
  await writeFile(join(root, 'uidx.json'), JSON.stringify({ id: 'doc', files: ['**/*.uidx'] }))
  await writeFile(join(root, 'home.uidx'), HOME)
  const [found] = await discoverManifests([root])
  open = await openWorkspace(found!)
  return {
    workspace: open,
    checkpoints: createCheckpointStore(root),
    globs: ['**/*.uidx'],
    turnId: TURN,
  }
}

describe('applyOps', () => {
  it('writes the change to disk and reports success', async () => {
    const ctx = await context()
    const result = await applyOps(ctx, 'home.uidx', [
      { kind: 'set_prop', address: 'hero', prop: 'width', value: 800 },
    ])
    expect(result).toMatchObject({ ok: true, file: 'home.uidx' })
    expect(await readFile(join(ctx.workspace.root, 'home.uidx'), 'utf8')).toContain('width={800}')
  })

  it('snapshots the file before writing, so the turn can be reverted', async () => {
    const ctx = await context()
    await applyOps(ctx, 'home.uidx', [
      { kind: 'set_prop', address: 'hero', prop: 'width', value: 800 },
    ])
    await ctx.checkpoints.revert(TURN)
    expect(await readFile(join(ctx.workspace.root, 'home.uidx'), 'utf8')).toBe(HOME)
  })

  it('refuses an edit against a node that does not exist, and leaves the file alone', async () => {
    const ctx = await context()
    const result = await applyOps(ctx, 'home.uidx', [
      { kind: 'set_prop', address: 'ghost', prop: 'width', value: 1 },
    ])
    expect(result).toMatchObject({ ok: false })
    expect(await readFile(join(ctx.workspace.root, 'home.uidx'), 'utf8')).toBe(HOME)
  })

  it('returns the diagnostic when a patch would break the document', async () => {
    const ctx = await context()
    const result = await applyOps(ctx, 'home.uidx', [
      { kind: 'set_prop', address: 'hero', prop: 'name', value: 42 },
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/name|invalid|rejected/i)
  })

  it('refuses to touch a file outside the manifest', async () => {
    const ctx = await context()
    const result = await applyOps({ ...ctx, globs: ['design/**/*.uidx'] }, 'home.uidx', [
      { kind: 'set_prop', address: 'hero', prop: 'width', value: 800 },
    ])
    expect(result).toMatchObject({ ok: false })
  })

  it('compiles each op against the document the previous op produced, so two appends under the same parent both land, in order', async () => {
    const ctx = await context()
    const result = await applyOps(ctx, 'home.uidx', [
      { kind: 'insert_node', parent: 'hero', node: { element: 'Rectangle' } },
      { kind: 'insert_node', parent: 'hero', node: { element: 'Text' } },
    ])
    expect(result).toMatchObject({ ok: true, file: 'home.uidx', changed: 2 })

    const source = await readFile(join(ctx.workspace.root, 'home.uidx'), 'utf8')
    const rectangleAt = source.indexOf('<Rectangle')
    const textAt = source.indexOf('<Text')
    expect(rectangleAt).toBeGreaterThan(-1)
    expect(textAt).toBeGreaterThan(-1)
    // The second insert must not have been compiled against the stale,
    // pre-first-insert document — that would default its index to the same
    // slot as the first insert and put Text before Rectangle instead of after.
    expect(rectangleAt).toBeLessThan(textAt)
  })

  it('writes nothing at all when a later op in the batch is invalid, even though an earlier op was valid', async () => {
    const ctx = await context()
    const result = await applyOps(ctx, 'home.uidx', [
      { kind: 'set_prop', address: 'hero', prop: 'width', value: 800 },
      { kind: 'set_prop', address: 'ghost', prop: 'width', value: 1 },
    ])
    expect(result).toMatchObject({ ok: false })
    expect(await readFile(join(ctx.workspace.root, 'home.uidx'), 'utf8')).toBe(HOME)
  })
})

describe('createFile', () => {
  it('writes a page skeleton that parses', async () => {
    const ctx = await context()
    const result = await createFile(ctx, 'about.uidx', 'about')
    expect(result.ok).toBe(true)
    expect(ctx.workspace.docOf('about.uidx')).not.toBeNull()
  })

  it('refuses to overwrite a page that already exists', async () => {
    const ctx = await context()
    expect(await createFile(ctx, 'home.uidx', 'home')).toMatchObject({ ok: false })
  })

  /**
   * The member index is a cache a watcher feeds, and a page created on canvas
   * a moment ago is not in it yet. Guarding on the index therefore let a
   * `create_file` for that page through — the skeleton went over the top of
   * the designer's work, and the model was told it had succeeded. Nothing here
   * waits for the watcher, deliberately: this is the window, and disk is the
   * only thing that answers correctly inside it.
   */
  it('refuses a page that appeared on disk after the session opened, before any watcher saw it', async () => {
    const ctx = await context()
    const theirs = HOME.replace('id: home', 'id: about').replace('hero', 'the-users-work')
    await writeFile(join(ctx.workspace.root, 'about.uidx'), theirs)
    expect(ctx.workspace.members()).not.toContain('about.uidx')

    const result = await createFile(ctx, 'about.uidx', 'about')

    expect(result).toMatchObject({ ok: false })
    expect(await readFile(join(ctx.workspace.root, 'about.uidx'), 'utf8')).toBe(theirs)
  })
})

describe('deleteFile', () => {
  it('removes the page and can be reverted', async () => {
    const ctx = await context()
    expect(await deleteFile(ctx, 'home.uidx')).toMatchObject({ ok: true })
    expect(ctx.workspace.docOf('home.uidx')).toBeNull()
    await ctx.checkpoints.revert(TURN)
    expect(await readFile(join(ctx.workspace.root, 'home.uidx'), 'utf8')).toBe(HOME)
  })
})
