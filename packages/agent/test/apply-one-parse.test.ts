import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as format from '@uidx/format'

import { createCheckpointStore } from '../src/edit/checkpoint.js'
import { applyOps, type ApplyContext } from '../src/edit/apply.js'
import { discoverManifests } from '../src/workspace/discover.js'
import { openWorkspace, type Workspace } from '../src/workspace/workspace.js'

// Pass-through: `parse` still parses, every call through this module id is counted.
vi.mock('@uidx/format', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@uidx/format')>()
  return { ...actual, parse: vi.fn(actual.parse) }
})

const HOME = `---
id: home
---

## Visual Contract

<Page>
  <Frame name="hero" width={600} height={200} />
</Page>
`

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
    turnId: '7d1f0a2c-4b3e-4f6a-9c8d-0e1f2a3b4c5d',
  }
}

describe('applyOps parses once per op (spec §2)', () => {
  it('reuses the patcher’s validating parse instead of parsing again', async () => {
    const ctx = await context()
    vi.mocked(format.parse).mockClear()
    const outcome = await applyOps(ctx, 'home.uidx', [
      { kind: 'set_prop', address: 'hero', prop: 'width', value: 800 },
      { kind: 'set_prop', address: 'hero', prop: 'height', value: 300 },
    ])
    expect(outcome).toMatchObject({ ok: true, changed: 2 })
    // The patcher's own parse is internal to `@uidx/format`; any call counted
    // here is the harness parsing the same text a second time.
    expect(vi.mocked(format.parse).mock.calls.length).toBe(0)
  })
})

describe('applyOps reports what it wrote (spec §5 turn attribution)', () => {
  it('calls onWrite with the written document’s source hash', async () => {
    const ctx = await context()
    const written: { file: string; sourceHash: string }[] = []
    const outcome = await applyOps(
      { ...ctx, onWrite: (file, sourceHash) => written.push({ file, sourceHash }) },
      'home.uidx',
      [{ kind: 'set_prop', address: 'hero', prop: 'width', value: 800 }],
    )
    expect(outcome).toMatchObject({ ok: true, changed: 1 })
    expect(written).toEqual([
      { file: 'home.uidx', sourceHash: ctx.workspace.docOf('home.uidx')!.sourceHash },
    ])
  })

  it('does not call onWrite for a batch that changed nothing', async () => {
    const ctx = await context()
    const written: string[] = []
    await applyOps({ ...ctx, onWrite: (file) => written.push(file) }, 'home.uidx', [
      { kind: 'set_prop', address: 'hero', prop: 'width', value: 600 },
    ])
    expect(written).toEqual([])
  })
})

describe('applyOps hands its patches to an open viewer (spec: viewer at scale §3)', () => {
  it('posts the compiled patches and adopts the server’s hash instead of writing the file', async () => {
    const ctx = await context()
    const before = await readFile(join(ctx.workspace.root, 'home.uidx'), 'utf8')
    const posted: { file: string; patches: unknown }[] = []
    const written: string[] = []
    const outcome = await applyOps(
      {
        ...ctx,
        post: async (file, patches) => {
          posted.push({ file, patches })
          // The viewer applied the same edit to the same head: same hash.
          const hash = format.applyPatchesIncremental(ctx.workspace.docOf(file)!, patches).doc
            .sourceHash
          return { posted: true, revision: 7, sourceHash: hash }
        },
        onWrite: (_file, hash) => written.push(hash),
      },
      'home.uidx',
      [{ kind: 'set_prop', address: 'hero', prop: 'width', value: 800 }],
    )
    expect(outcome).toMatchObject({ ok: true, changed: 1 })
    expect(posted).toEqual([
      { file: 'home.uidx', patches: [{ op: 'set', address: 'hero', prop: 'width', value: 800 }] },
    ])
    // Not written here — the server wrote it — but the index moved on.
    expect(await readFile(join(ctx.workspace.root, 'home.uidx'), 'utf8')).toBe(before)
    expect(ctx.workspace.docOf('home.uidx')!.source).toContain('width={800}')
    expect(written).toHaveLength(1)
  })

  it('writes the file itself when no viewer is open', async () => {
    const ctx = await context()
    const outcome = await applyOps(
      { ...ctx, post: async () => ({ posted: false, reason: 'no-viewer', message: 'none' }) },
      'home.uidx',
      [{ kind: 'set_prop', address: 'hero', prop: 'width', value: 800 }],
    )
    expect(outcome).toMatchObject({ ok: true, changed: 1 })
    expect(await readFile(join(ctx.workspace.root, 'home.uidx'), 'utf8')).toContain('width={800}')
  })

  it('reports a viewer refusal as a refusal', async () => {
    const ctx = await context()
    const outcome = await applyOps(
      {
        ...ctx,
        post: async () => ({ posted: false, reason: 'rejected', message: 'no node at "hero"' }),
      },
      'home.uidx',
      [{ kind: 'set_prop', address: 'hero', prop: 'width', value: 800 }],
    )
    expect(outcome.ok).toBe(false)
    expect((outcome as { error: string }).error).toMatch(/refused/)
  })
})
