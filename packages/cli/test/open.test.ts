import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initProject } from '../src/commands/init.js'
import { BootError, open } from '../src/commands/open.js'
import type { UidxServer } from '@uidx/server'

const VALID = `---
id: opened
---

## Visual Contract

<Component name="c" status="draft">
  <Frame name="root" cornerRadius={4} />
</Component>
`

let dir: string
let file: string
let server: UidxServer | null = null

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uidx-open-'))
  file = join(dir, 'opened.uidx')
  await writeFile(file, VALID)
  // `open` resolves the document the page belongs to (G3), so the fixture needs
  // a manifest the same way a real workspace does.
  await writeFile(join(dir, 'uidx.json'), '{ "id": "fixture", "files": ["*.uidx"] }')
})

afterEach(async () => {
  await server?.close()
  server = null
  await rm(dir, { recursive: true, force: true })
})

describe('uidx open', () => {
  it('opens a project from its root or a subdirectory and writes inside .uidx', async () => {
    await writeFile(join(dir, 'package.json'), '{"name":"app"}')
    await initProject(dir)
    await mkdir(join(dir, 'src'))
    await mkdir(join(dir, '.uidx/screens'))
    await writeFile(join(dir, '.uidx/screens/second.uidx'), VALID)
    const result = await open('.', { cwd: join(dir, 'src'), launchBrowser: false })
    server = result.server
    expect(result.document?.dir).toBe(join(dir, '.uidx'))
    expect(result.document?.pages.map((page) => page.file)).toEqual([
      'screens/second.uidx',
      'welcome.uidx',
    ])
    expect(result.url).toBe(server.url)
    expect(server.workspace?.pages).toEqual(['screens/second.uidx', 'welcome.uidx'])
    await writeFile(join(dir, '.uidx/screens/new.uidx'), VALID.replace('id: opened', 'id: new'))
    await expect
      .poll(() => server?.workspace?.pages, { timeout: 5000 })
      .toContain('screens/new.uidx')
    const welcome = server.workspace!.session('welcome.uidx')!
    const reply = await welcome.patch({
      patchId: 'project-edit',
      baseRevision: 1,
      patches: [
        {
          op: 'set',
          address: 'Welcome#heading',
          prop: 'characters',
          value: 'Edited in the project',
        },
      ],
    })
    expect(reply.type).toBe('patch:applied')
    expect(await readFile(join(dir, '.uidx/welcome.uidx'), 'utf8')).toContain(
      'Edited in the project',
    )
    expect(await readFile(file, 'utf8')).toBe(VALID)
  })

  /**
   * npm blocks install scripts unless they are approved, so the postinstall
   * that set the workspace up is no longer something an install can count on.
   * The first run has to do the same setup itself, or the documented path —
   * install, then `npm run uidx` — dead-ends with "no workspace".
   */
  it('sets the workspace up on the first run when the install script did not', async () => {
    const app = join(dir, 'app')
    await mkdir(app)
    await writeFile(join(app, 'package.json'), '{"name":"fresh-app"}')
    const result = await open('.', { cwd: app, launchBrowser: false })
    server = result.server
    expect(result.initialized).toBe(app)
    expect(result.document?.dir).toBe(join(app, '.uidx'))
    expect(result.document?.pages.map((page) => page.file)).toEqual(['welcome.uidx'])
    expect(JSON.parse(await readFile(join(app, 'package.json'), 'utf8')).scripts).toMatchObject({
      uidx: 'uidx dev',
      'uidx:mcp': 'uidx mcp',
    })
    expect(result.url).toBe(server.url)
  })

  it('still refuses a directory that is not an npm project', async () => {
    const loose = join(dir, 'loose')
    await mkdir(loose)
    await expect(open('.', { cwd: loose, launchBrowser: false })).rejects.toBeInstanceOf(BootError)
  })

  it('reports an existing workspace as not newly set up', async () => {
    await writeFile(join(dir, 'package.json'), '{"name":"app"}')
    await initProject(dir)
    const result = await open('.', { cwd: dir, launchBrowser: false })
    server = result.server
    expect(result.initialized).toBeNull()
  })

  it('parses once and starts watching', async () => {
    const result = await open(file, { launchBrowser: false })
    server = result.server
    expect(server.session.revision).toBe(1)
    expect(server.session.current.kind).toBe('ok')
    expect(new URL(result.url!).searchParams.get('page')).toBe('opened.uidx')
  })

  it('includes broken pages in the overview instead of preventing the project from opening', async () => {
    await writeFile(file, VALID.replace('<Frame', '<Blob'))
    const result = await open(undefined, { cwd: dir, launchBrowser: false })
    server = result.server
    expect(result.url).toBe(server.url)
    expect(server.workspace?.pages).toEqual(['opened.uidx'])
    expect(server.session.current.kind).toBe('error')
  })

  it('fails fast with diagnostics rather than serving a broken file', async () => {
    await writeFile(file, VALID.replace('<Frame', '<Blob'))
    // The point is that this throws *before* a server exists: an author who
    // typo'd should get the error, not an empty browser tab.
    await expect(open(file, { launchBrowser: false })).rejects.toThrow(BootError)
    try {
      await open(file, { launchBrowser: false })
    } catch (err) {
      expect((err as BootError).lines.join('\n')).toMatch(/UIDX100/)
    }
  })

  /**
   * E5. `spawn` reports a missing launcher by emitting an asynchronous `error`
   * event, which the `try/catch` around it cannot see. Unhandled, Node throws
   * and takes the server down seconds after it printed the URL — so a headless
   * box could not run `uidx open` at all. The failure mode is a crash *after*
   * boot resolves, which is why this waits for the event loop to turn.
   */
  it('keeps serving on a machine with no browser launcher', async () => {
    const path = process.env.PATH
    process.env.PATH = ''
    try {
      const result = await open(file, { launchBrowser: true })
      server = result.server
      await new Promise((done) => setTimeout(done, 50))
      expect(server.session.current.kind).toBe('ok')
    } finally {
      process.env.PATH = path
    }
  })

  it('reports a missing file clearly', async () => {
    await expect(open(join(dir, 'nope.uidx'), { launchBrowser: false })).rejects.toThrow(
      /cannot read/,
    )
  })

  it('picks up an external save after boot', async () => {
    const result = await open(file, { launchBrowser: false })
    server = result.server

    await writeFile(file, VALID.replace('cornerRadius={4}', 'cornerRadius={24}'))
    const start = Date.now()
    while (server.session.revision === 1) {
      if (Date.now() - start > 5000) throw new Error('watcher never fired')
      await new Promise((r) => setTimeout(r, 20))
    }

    const state = server.session.current
    expect(state.kind).toBe('ok')
    if (state.kind !== 'ok') throw new Error('unreachable')
    expect(state.doc.tree.children[0]!.children[0]!.attrs.cornerRadius!.value).toBe(24)
  })
})
