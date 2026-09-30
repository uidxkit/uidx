import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readManifest } from '../src/document.js'
import { createUidxServer, type UidxServer } from '../src/server.js'

/**
 * The headless library reaches the viewer (ADR 0013 §3).
 *
 * `uidx.json` names a `custom-elements.json`; the route serves it as written
 * so the Contract tab can offer elements and parts from a list rather than a
 * string an author has to know. A document that names none is a state the
 * viewer explains, not an error.
 */
let dir: string
let server: UidxServer | undefined
const source = '---\nid: welcome\n---\n\n## Visual Contract\n\n<Page></Page>\n'
const LIBRARY = {
  schemaVersion: '1.0.0',
  modules: [
    {
      declarations: [
        { tagName: 'hwc-button', customElement: true, attributes: [{ name: 'disabled' }] },
        { tagName: 'hwc-button-label', customElement: true },
      ],
    },
  ],
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uidx-headless-'))
  await writeFile(join(dir, 'welcome.uidx'), source)
  await mkdir(join(dir, 'dist'))
  await writeFile(join(dir, 'dist/index.html'), '<title>Viewer</title>')
})
afterEach(async () => {
  await server?.close()
  server = undefined
  await rm(dir, { recursive: true, force: true })
})

async function start(config: Record<string, unknown>) {
  await writeFile(
    join(dir, 'uidx.json'),
    JSON.stringify({ id: 'test', files: ['**/*.uidx'], ...config }),
  )
  server = await createUidxServer({
    file: join(dir, 'welcome.uidx'),
    root: dir,
    viewerDist: join(dir, 'dist'),
    port: 4860,
  })
}

describe('uidx.json "headless"', () => {
  it('is optional, and a path when present', async () => {
    await writeFile(join(dir, 'uidx.json'), JSON.stringify({ id: 'a', files: ['*.uidx'] }))
    expect((await readManifest(join(dir, 'uidx.json'))).headless).toBeUndefined()
    await writeFile(
      join(dir, 'uidx.json'),
      JSON.stringify({ id: 'a', files: ['*.uidx'], headless: 'vendor/custom-elements.json' }),
    )
    expect((await readManifest(join(dir, 'uidx.json'))).headless).toBe(
      'vendor/custom-elements.json',
    )
    await writeFile(
      join(dir, 'uidx.json'),
      JSON.stringify({ id: 'a', files: ['*.uidx'], headless: 3 }),
    )
    await expect(readManifest(join(dir, 'uidx.json'))).rejects.toThrow(/"headless" must be a path/)
  })
})

describe('the headless route', () => {
  it('serves the declared library as written, relative to uidx.json', async () => {
    await mkdir(join(dir, 'vendor'))
    await writeFile(join(dir, 'vendor/custom-elements.json'), JSON.stringify(LIBRARY))
    await start({ headless: 'vendor/custom-elements.json' })
    const response = await fetch(`${server!.url}/__uidx/headless`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ path: 'vendor/custom-elements.json', library: LIBRARY })
  })

  it('answers a document that declares none with a null path, and names an unreadable one', async () => {
    await start({})
    expect(await (await fetch(`${server!.url}/__uidx/headless`)).json()).toEqual({ path: null })
    await server!.close()
    server = undefined
    await start({ headless: 'missing/custom-elements.json' })
    const response = await fetch(`${server!.url}/__uidx/headless`)
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toMatch(
      /missing\/custom-elements\.json/,
    )
  })

  it('is read-only', async () => {
    await start({})
    const response = await fetch(`${server!.url}/__uidx/headless`, { method: 'POST' })
    expect(response.status).toBe(405)
  })
})
