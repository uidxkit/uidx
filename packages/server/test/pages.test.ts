import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { createUidxServer, type UidxServer } from '../src/server.js'
import type { ServerMessage } from '../src/protocol.js'

let dir: string
let server: UidxServer | undefined
const source = '---\nid: welcome\n---\n\n## Visual Contract\n\n<Page></Page>\n'
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uidx-pages-'))
  await writeFile(join(dir, 'welcome.uidx'), source)
  await mkdir(join(dir, 'dist'))
  await writeFile(join(dir, 'dist/index.html'), '<title>Viewer</title>')
})
afterEach(async () => {
  await server?.close()
  server = undefined
  await rm(dir, { recursive: true, force: true })
})

describe.each(['built', 'development'] as const)('%s page creation', (mode) => {
  async function start(files = ['**/*.uidx']) {
    await writeFile(join(dir, 'uidx.json'), JSON.stringify({ id: 'test', files }))
    server = await createUidxServer({
      file: join(dir, 'welcome.uidx'),
      root: dir,
      viewerDist: mode === 'built' ? join(dir, 'dist') : undefined,
      port: 4840,
    })
  }
  function post(name: unknown, origin = server!.url!) {
    return fetch(`${server!.url}/__uidx/pages`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
  }

  it('creates a valid blank page and announces it before responding', async () => {
    await start()
    const messages: ServerMessage[] = []
    server!.workspace!.onMessage((message) => messages.push(message))
    const response = await post('Checkout: mobile')
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ file: 'checkout-mobile.uidx' })
    const doc = parseOrThrow(await readFile(join(dir, 'checkout-mobile.uidx'), 'utf8'))
    expect(doc.frontmatter.id).toBe('checkout-mobile')
    expect(doc.tree.element).toBe('Page')
    expect(server!.workspace!.pages).toContain('checkout-mobile.uidx')
    expect(
      messages.some(
        (m) => m.type === 'document:opened' && m.pages.includes('checkout-mobile.uidx'),
      ),
    ).toBe(true)
    expect(
      messages.some((m) => m.type === 'file:changed' && m.file === 'checkout-mobile.uidx'),
    ).toBe(true)
  })

  it('preserves existing pages and resolves concurrent creates exclusively', async () => {
    await start()
    expect((await post('Welcome')).status).toBe(409)
    expect(await readFile(join(dir, 'welcome.uidx'), 'utf8')).toBe(source)
    const results = await Promise.all([post('New page'), post('New page')])
    expect(results.map((r) => r.status).sort()).toEqual([201, 409])
  })

  it('uses configured folders, honors exclusions, and rejects outside names', async () => {
    await start(['welcome.uidx', 'pages/*.uidx', '!pages/private*.uidx'])
    expect((await post('Home')).status).toBe(201)
    expect(server!.workspace!.pages).toContain('pages/home.uidx')
    expect((await post('Private notes')).status).toBe(422)
    for (const name of ['', '../outside', 'a/b', 'a\\b', '\nname', 42, 'x'.repeat(101)]) {
      expect((await post(name)).status, String(name)).toBe(400)
    }
  })

  it('refuses symlink folders and existing symlink files', async () => {
    await start(['welcome.uidx', 'pages/*.uidx'])
    await mkdir(join(dir, 'outside'))
    await symlink(join(dir, 'outside'), join(dir, 'pages'))
    expect((await post('Escape')).status).toBe(422)
    await rm(join(dir, 'pages'))
    await mkdir(join(dir, 'pages'))
    await symlink(join(dir, 'welcome.uidx'), join(dir, 'pages/escape.uidx'))
    expect((await post('Escape')).status).toBe(409)
    expect(await readFile(join(dir, 'welcome.uidx'), 'utf8')).toBe(source)
  })

  it('rejects foreign origins, malformed JSON and oversized bodies', async () => {
    await start()
    expect((await post('Foreign', 'https://example.com')).status).toBe(403)
    const url = `${server!.url}/__uidx/pages`
    expect((await fetch(url)).status).toBe(405)
    expect((await fetch(url, { method: 'POST', body: '{' })).status).toBe(400)
    expect((await fetch(url, { method: 'POST', body: ' '.repeat(4097) })).status).toBe(413)
    expect(server!.workspace!.pages).toEqual(['welcome.uidx'])
  })
})
