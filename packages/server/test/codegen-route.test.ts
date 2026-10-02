import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readManifest } from '../src/document.js'
import { createUidxServer, type UidxServer } from '../src/server.js'

/**
 * Generating code from the viewer (ADR 0017 §3): the route runs the same
 * generator `uidx codegen` does, into the folder `uidx.json` names, and
 * writes nothing when a page or a contract is wrong.
 */
let dir: string
let server: UidxServer | undefined
const PAGE = `---
id: box
---

A box.

## Visual Contract

<Page>
  <Component name="Box" status="stable" implements="x-box" width={20} height={20}>
    <Text name="label" part="label" characters="{label}" fontSize={14} />
  </Component>
</Page>

## Contract

<Props>
  <Prop name="label" type="string" sample="Hi">Words.</Prop>
</Props>
`
const LIBRARY = {
  modules: [{ declarations: [{ tagName: 'x-box' }, { tagName: 'x-box-label' }] }],
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uidx-codegen-'))
  await mkdir(join(dir, 'dist'))
  await writeFile(join(dir, 'dist/index.html'), '<title>Viewer</title>')
  await writeFile(join(dir, 'box.uidx'), PAGE)
  await writeFile(join(dir, 'custom-elements.json'), JSON.stringify(LIBRARY))
})
afterEach(async () => {
  await server?.close()
  server = undefined
  await rm(dir, { recursive: true, force: true })
})

async function start(config: Record<string, unknown>) {
  await writeFile(
    join(dir, 'uidx.json'),
    JSON.stringify({ id: 'test', files: ['*.uidx'], headless: 'custom-elements.json', ...config }),
  )
  server = await createUidxServer({
    file: join(dir, 'box.uidx'),
    root: dir,
    viewerDist: join(dir, 'dist'),
    port: 4870,
  })
}

describe('uidx.json "codegen"', () => {
  it('names the output folder and the targets, validated', async () => {
    await writeFile(
      join(dir, 'uidx.json'),
      JSON.stringify({
        id: 'a',
        files: ['*.uidx'],
        codegen: { out: '../generated', targets: ['html'] },
      }),
    )
    expect((await readManifest(join(dir, 'uidx.json'))).codegen).toEqual({
      out: '../generated',
      targets: ['html'],
    })
    await writeFile(
      join(dir, 'uidx.json'),
      JSON.stringify({ id: 'a', files: ['*.uidx'], codegen: { out: 'x', targets: ['vue'] } }),
    )
    await expect(readManifest(join(dir, 'uidx.json'))).rejects.toThrow(/"codegen.targets"/)
  })
})

describe('the codegen route', () => {
  it('writes the targets into the configured folder and reports what it wrote', async () => {
    await start({ codegen: { out: 'generated', targets: ['html', 'react'] } })
    const asked = await (await fetch(`${server!.url}/__uidx/codegen`)).json()
    expect(asked).toEqual({ configured: true, out: 'generated' })
    const response = await fetch(`${server!.url}/__uidx/codegen`, {
      method: 'POST',
      headers: { origin: server!.url!, 'content-type': 'application/json' },
      body: '{}',
    })
    expect(response.status).toBe(200)
    const run = (await response.json()) as {
      out: string
      written: string[]
      diagnostics: unknown[]
    }
    expect(run.out).toBe('generated')
    expect(run.diagnostics).toEqual([])
    expect(run.written).toContain('html/box.html')
    expect(run.written).toContain('react/Box.tsx')
    expect(run.written).not.toContain('contract/box.json')
    expect(await readFile(join(dir, 'generated/html/box.html'), 'utf8')).toContain('<x-box>')
    const headless = (await (await fetch(`${server!.url}/__uidx/headless`)).json()) as {
      codegen?: { out: string }
    }
    expect(headless.codegen).toEqual({ out: 'generated' })
  })

  it('writes nothing when a page does not parse, and says which', async () => {
    await start({ codegen: { out: 'generated' } })
    await writeFile(
      join(dir, 'broken.uidx'),
      '---\nid: broken\n---\n\n## Visual Contract\n\n<Page>\n  <Frame name="a" width={1} />\n  <Frame name="a" width={1} />\n</Page>\n',
    )
    const response = await fetch(`${server!.url}/__uidx/codegen`, {
      method: 'POST',
      headers: { origin: server!.url!, 'content-type': 'application/json' },
      body: '{}',
    })
    const run = (await response.json()) as { written: string[]; diagnostics: { file: string }[] }
    expect(run.written).toEqual([])
    expect(run.diagnostics.map((d) => d.file)).toContain('broken.uidx')
  })

  it('refuses without a configured folder, from another origin, and on other methods', async () => {
    await start({})
    expect(await (await fetch(`${server!.url}/__uidx/codegen`)).json()).toEqual({
      configured: false,
      out: null,
    })
    const unconfigured = await fetch(`${server!.url}/__uidx/codegen`, {
      method: 'POST',
      headers: { origin: server!.url!, 'content-type': 'application/json' },
      body: '{}',
    })
    expect(unconfigured.status).toBe(400)
    const foreign = await fetch(`${server!.url}/__uidx/codegen`, {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: '{}',
    })
    expect(foreign.status).toBe(403)
    expect((await fetch(`${server!.url}/__uidx/codegen`, { method: 'DELETE' })).status).toBe(405)
  })
})

describe('one component as code', () => {
  it('renders its files in memory, for every target, writing nothing', async () => {
    await start({})
    const response = await fetch(`${server!.url}/__uidx/code?component=Box`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { files: { path: string; text: string }[] }
    const paths = body.files.map((file) => file.path).sort()
    expect(paths).toContain('react/Box.tsx')
    expect(paths).toContain('html/box.html')
    expect(paths).toContain('contract/box.json')
    expect(body.files.find((file) => file.path === 'react/Box.tsx')!.text).toContain('label')
    expect(
      (await fetch(`${server!.url}/__uidx/code?component=${encodeURIComponent('<x>')}`)).status,
    ).toBe(404)
  })
})
