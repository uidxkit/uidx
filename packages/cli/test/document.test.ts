import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  check,
  documentMembers,
  findManifest,
  isMember,
  loadDocument,
  ManifestError,
  readManifest,
} from '../src/index.js'
import { BootError, open } from '../src/commands/open.js'

const page = (id: string, component: string) => `---
id: ${id}
---

## Visual Contract

<Component name="${component}" status="draft">
  <Frame name="root" cornerRadius={4} />
</Component>
`

let dir: string

const write = async (rel: string, body: string) => {
  const path = join(dir, rel)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, body, 'utf8')
  return path
}

const manifest = (body: unknown) => write('uidx.json', JSON.stringify(body))

/** Awaits a rejection and returns it typed, so assertions do not fight a union. */
async function failure<T extends Error>(promise: Promise<unknown>): Promise<T> {
  try {
    await promise
  } catch (err) {
    return err as T
  }
  throw new Error('expected the call to fail, but it resolved')
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uidx-doc-'))
})

describe('findManifest', () => {
  it('walks up from a nested file to the workspace root', async () => {
    await manifest({ id: 'ws', files: ['**/*.uidx'] })
    const nested = await write('marketing/deep/hero.uidx', page('hero', 'Marketing/Hero'))

    const found = await findManifest(nested)
    expect(found!.dir).toBe(dir)
    expect(found!.manifest.id).toBe('ws')
  })

  it('accepts a directory as the starting point', async () => {
    await manifest({ id: 'ws', files: ['**/*.uidx'] })
    await mkdir(join(dir, 'sub'), { recursive: true })
    expect((await findManifest(join(dir, 'sub')))!.dir).toBe(dir)
  })

  it('returns null when there is no document above the path', async () => {
    await write('loose.uidx', page('loose', 'Loose'))
    expect(await findManifest(join(dir, 'loose.uidx'))).toBeNull()
  })
})

describe('readManifest', () => {
  it('reports every problem at once rather than the first', async () => {
    const path = await manifest({ files: [] })
    const err = await failure<ManifestError>(readManifest(path))
    expect(err).toBeInstanceOf(ManifestError)
    expect(err.lines).toHaveLength(2)
    expect(err.lines.join('\n')).toMatch(/"id" must be a non-empty string/)
    expect(err.lines.join('\n')).toMatch(/"files" must be a non-empty array/)
  })

  it("rejects invalid JSON with the parser's own message", async () => {
    const path = await write('uidx.json', '{ nope }')
    await expect(readManifest(path)).rejects.toThrow(/not valid JSON/)
  })

  it('rejects a non-string glob', async () => {
    const path = await manifest({ id: 'ws', files: ['ok/**', 7] })
    await expect(readManifest(path)).rejects.toThrow(/every entry of "files"/)
  })
})

describe('loadDocument', () => {
  it('spans several design systems in one document (ADR 0004 §1)', async () => {
    await manifest({ id: 'ws', files: ['marketing/**/*.uidx', 'app/**/*.uidx'] })
    await write('marketing/hero.uidx', page('m-hero', 'Marketing/Hero'))
    await write('app/button.uidx', page('a-button', 'App/Button'))
    // Outside both globs, so it is not a member even though it is in the tree.
    await write('scratch/wip.uidx', page('wip', 'Wip'))

    const found = (await findManifest(dir))!
    const loaded = await loadDocument(found)

    expect(loaded.pages.map((p) => p.file)).toEqual(['app/button.uidx', 'marketing/hero.uidx'])
    expect(loaded.pages.every((p) => p.result.doc !== null)).toBe(true)
    expect(loaded.parseMs).toBeGreaterThanOrEqual(0)
  })

  it('keeps a member that does not parse, with its diagnostics', async () => {
    await manifest({ id: 'ws', files: ['*.uidx'] })
    await write('good.uidx', page('good', 'Good'))
    await write('bad.uidx', page('bad', 'Bad').replace('<Frame', '<Blob'))

    const loaded = await loadDocument((await findManifest(dir))!)
    const bad = loaded.pages.find((p) => p.file === 'bad.uidx')!
    expect(bad.result.doc).toBeNull()
    expect(bad.result.diagnostics.map((d) => d.code)).toContain('UIDX100')
  })
})

describe('isMember', () => {
  it('distinguishes members from files that merely sit nearby', async () => {
    await manifest({ id: 'ws', files: ['app/**/*.uidx'] })
    await write('app/a.uidx', page('a', 'A'))
    await write('other/b.uidx', page('b', 'B'))

    const found = (await findManifest(dir))!
    const members = await documentMembers(found)
    expect(isMember(found, members, join(dir, 'app/a.uidx'))).toBe(true)
    expect(isMember(found, members, join(dir, 'other/b.uidx'))).toBe(false)
    expect(isMember(found, members, '/somewhere/else/a.uidx')).toBe(false)
  })
})

describe('uidx check defaults to the document', () => {
  it("checks the document's members, not the working directory", async () => {
    await manifest({ id: 'ws', files: ['app/**/*.uidx'] })
    await write('app/a.uidx', page('a', 'A'))
    // Broken, but outside the manifest — so it must not fail the check.
    await write('scratch/broken.uidx', page('broken', 'B').replace('<Frame', '<Blob'))

    const result = await check([], { cwd: dir })
    expect(result.files.map((f) => f.file)).toEqual(['app/a.uidx'])
    expect(result.exitCode).toBe(0)
  })

  it('still honours an explicit glob, so CI can gate a subset', async () => {
    await manifest({ id: 'ws', files: ['app/**/*.uidx'] })
    await write('app/a.uidx', page('a', 'A'))
    await write('scratch/broken.uidx', page('broken', 'B').replace('<Frame', '<Blob'))

    const result = await check(['scratch'], { cwd: dir })
    expect(result.files.map((f) => f.file)).toEqual(['scratch/broken.uidx'])
    expect(result.exitCode).toBe(1)
  })

  it('falls back to the working directory when there is no manifest', async () => {
    await write('loose.uidx', page('loose', 'Loose'))
    const result = await check([], { cwd: dir })
    expect(result.files.map((f) => f.file)).toEqual(['loose.uidx'])
  })
})

describe('uidx open requires a document', () => {
  it('refuses a page outside any document, and names the fix', async () => {
    const file = await write('loose.uidx', page('loose', 'Loose'))
    const err = await failure<BootError>(open(file, { launchBrowser: false }))
    expect(err).toBeInstanceOf(BootError)
    expect(err.lines.join('\n')).toMatch(/not inside a uidx document/)
    expect(err.lines.join('\n')).toMatch(/uidx\.json/)
  })

  it('refuses a page the manifest does not claim', async () => {
    await manifest({ id: 'ws', files: ['app/**/*.uidx'] })
    const file = await write('scratch/wip.uidx', page('wip', 'Wip'))
    const err = await failure<BootError>(open(file, { launchBrowser: false }))
    expect(err.lines.join('\n')).toMatch(/not a member of document "ws"/)
  })

  it('surfaces a malformed manifest as a boot error', async () => {
    await write('uidx.json', '{ nope }')
    const file = await write('a.uidx', page('a', 'A'))
    const err = await failure<BootError>(open(file, { launchBrowser: false }))
    expect(err).toBeInstanceOf(BootError)
    expect(err.lines.join('\n')).toMatch(/not valid JSON/)
  })
})
