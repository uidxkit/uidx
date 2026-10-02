import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readManifest } from '../src/document.js'
import { discoverHeadless } from '../src/headless.js'
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
    expect((await readManifest(join(dir, 'uidx.json'))).headless).toEqual({
      manifest: 'vendor/custom-elements.json',
    })
    await writeFile(
      join(dir, 'uidx.json'),
      JSON.stringify({ id: 'a', files: ['*.uidx'], headless: 3 }),
    )
    await expect(readManifest(join(dir, 'uidx.json'))).rejects.toThrow(/"headless" must be a path/)
  })

  it('takes the object form with a profile and bindings, each validated', async () => {
    const config = {
      manifest: 'vendor/custom-elements.json',
      profile: { props: 'data-attribute' },
      bindings: { Checkbox: { tag: 'sl-checkbox', events: { change: 'sl-change' } } },
    }
    await writeFile(
      join(dir, 'uidx.json'),
      JSON.stringify({ id: 'a', files: ['*.uidx'], headless: config }),
    )
    expect((await readManifest(join(dir, 'uidx.json'))).headless).toEqual(config)
    await writeFile(
      join(dir, 'uidx.json'),
      JSON.stringify({
        id: 'a',
        files: ['*.uidx'],
        headless: { manifest: 'x.json', profile: { props: 3 } },
      }),
    )
    await expect(readManifest(join(dir, 'uidx.json'))).rejects.toThrow(/"headless.profile"/)
  })
})

describe('library discovery', () => {
  it("finds dependencies that ship a manifest, by package.json's customElements field", async () => {
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'app',
        dependencies: { '@acme/kit': '1.0.0', lodash: '4.0.0', ghost: '1.0.0' },
      }),
    )
    await mkdir(join(dir, 'node_modules/@acme/kit/dist'), { recursive: true })
    await writeFile(
      join(dir, 'node_modules/@acme/kit/package.json'),
      JSON.stringify({ name: '@acme/kit', customElements: 'dist/custom-elements.json' }),
    )
    await writeFile(
      join(dir, 'node_modules/@acme/kit/dist/custom-elements.json'),
      JSON.stringify(LIBRARY),
    )
    await mkdir(join(dir, 'node_modules/lodash'), { recursive: true })
    await writeFile(
      join(dir, 'node_modules/lodash/package.json'),
      JSON.stringify({ name: 'lodash' }),
    )
    // The document may sit below the project: the path comes back relative to uidx.json.
    await mkdir(join(dir, 'design'))
    expect(await discoverHeadless(join(dir, 'design'))).toEqual([
      { package: '@acme/kit', path: '../node_modules/@acme/kit/dist/custom-elements.json' },
    ])
    expect(await discoverHeadless(dir)).toEqual([
      { package: '@acme/kit', path: 'node_modules/@acme/kit/dist/custom-elements.json' },
    ])
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
    expect(await response.json()).toEqual({
      path: 'vendor/custom-elements.json',
      library: LIBRARY,
      candidates: [],
    })
  })

  it('offers discovered libraries when none is declared, and writes the choice into uidx.json', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies: { kit: '1' } }))
    await mkdir(join(dir, 'node_modules/kit'), { recursive: true })
    await writeFile(
      join(dir, 'node_modules/kit/package.json'),
      JSON.stringify({ name: 'kit', customElements: 'custom-elements.json' }),
    )
    await writeFile(join(dir, 'node_modules/kit/custom-elements.json'), JSON.stringify(LIBRARY))
    await start({})
    expect(await (await fetch(`${server!.url}/__uidx/headless`)).json()).toEqual({
      path: null,
      candidates: [{ package: 'kit', path: 'node_modules/kit/custom-elements.json' }],
    })
    const chosen = await fetch(`${server!.url}/__uidx/headless`, {
      method: 'PUT',
      headers: { origin: server!.url!, 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'node_modules/kit/custom-elements.json' }),
    })
    expect(chosen.status).toBe(200)
    expect(((await chosen.json()) as { path: string }).path).toBe(
      'node_modules/kit/custom-elements.json',
    )
    expect(JSON.parse(await readFile(join(dir, 'uidx.json'), 'utf8')).headless).toBe(
      'node_modules/kit/custom-elements.json',
    )
    const refused = await fetch(`${server!.url}/__uidx/headless`, {
      method: 'PUT',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'x' }),
    })
    expect(refused.status).toBe(403)
  })

  it('answers a document that declares none with a null path, and names an unreadable one', async () => {
    await start({})
    expect(await (await fetch(`${server!.url}/__uidx/headless`)).json()).toEqual({
      path: null,
      candidates: [],
    })
    await server!.close()
    server = undefined
    await start({ headless: 'missing/custom-elements.json' })
    const response = await fetch(`${server!.url}/__uidx/headless`)
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string; code?: string; path?: string }
    expect(body.error).toMatch(/missing\/custom-elements\.json/)
    // The class and the configured path, so the viewer words the failure itself.
    expect(body.code).toBe('ENOENT')
    expect(body.path).toBe('missing/custom-elements.json')
  })

  it('answers only GET and PUT', async () => {
    await start({})
    const response = await fetch(`${server!.url}/__uidx/headless`, { method: 'POST' })
    expect(response.status).toBe(405)
  })
})
