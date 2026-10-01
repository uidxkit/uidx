import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createUidxServer, type UidxServer } from '../src/server.js'

/**
 * The code connection edited from the viewer: only its own fields of
 * uidx.json change, every change is validated, and an invalid one leaves
 * the file as it was.
 */
let dir: string
let server: UidxServer | undefined
const PAGE = `---\nid: box\n---\n\n## Visual Contract\n\n<Page>\n  <Component name="Box" status="draft" width={20} height={20} />\n</Page>\n`

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uidx-config-'))
  await mkdir(join(dir, 'dist'))
  await writeFile(join(dir, 'dist/index.html'), '<title>Viewer</title>')
  await writeFile(join(dir, 'box.uidx'), PAGE)
  await writeFile(join(dir, 'custom-elements.json'), JSON.stringify({ modules: [] }))
})
afterEach(async () => {
  await server?.close()
  server = undefined
  await rm(dir, { recursive: true, force: true })
})

async function start(config: Record<string, unknown>) {
  await writeFile(
    join(dir, 'uidx.json'),
    JSON.stringify({ id: 'test', files: ['*.uidx'], ...config }),
  )
  server = await createUidxServer({
    file: join(dir, 'box.uidx'),
    root: dir,
    viewerDist: join(dir, 'dist'),
    port: 4890,
  })
}
const patch = (change: object) =>
  fetch(`${server!.url}/__uidx/config`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', origin: server!.url! },
    body: JSON.stringify(change),
  })
const manifest = async () =>
  JSON.parse(await readFile(join(dir, 'uidx.json'), 'utf8')) as Record<string, unknown>

describe('the config route', () => {
  it('writes the profile and a component binding into headless, keeping the rest', async () => {
    await start({ headless: 'custom-elements.json', assets: ['art/**'] })
    expect((await patch({ key: 'profile', value: { props: 'data-attribute' } })).status).toBe(200)
    const response = await patch({
      key: 'binding',
      component: 'Box',
      value: { tag: 'x-box', attributes: { label: 'text', other: '' } },
    })
    expect(await response.json()).toMatchObject({
      headless: {
        manifest: 'custom-elements.json',
        profile: { props: 'data-attribute' },
        bindings: { Box: { tag: 'x-box', attributes: { label: 'text' } } },
      },
    })
    expect(await manifest()).toMatchObject({ assets: ['art/**'] })
    await patch({ key: 'binding', component: 'Box', value: null })
    await patch({ key: 'profile', value: null })
    expect((await manifest()).headless).toBe('custom-elements.json')
  })

  it('sets the output, then maps a component onto a React library', async () => {
    await start({})
    expect(
      (await patch({ key: 'react', component: 'Box', value: { from: '@acme/ui' } })).status,
    ).toBe(400)
    await patch({ key: 'codegen', value: { out: 'src/ds', targets: ['react', 'html'] } })
    await patch({
      key: 'react',
      component: 'Box',
      value: { from: '@acme/ui', export: 'Card', props: { label: 'title' } },
    })
    expect((await manifest()).codegen).toEqual({
      out: 'src/ds',
      targets: ['react', 'html'],
      react: { Box: { from: '@acme/ui', export: 'Card', props: { label: 'title' } } },
    })
    expect((await patch({ key: 'react', component: 'Box', value: { export: 'X' } })).status).toBe(
      400,
    )
  })

  it('refuses a profile before a library, and puts back a change that breaks the manifest', async () => {
    await start({})
    const refused = await patch({ key: 'profile', value: { props: 'class' } })
    expect(refused.status).toBe(400)
    expect(((await refused.json()) as { error: string }).error).toMatch(/library first/)
    await patch({ key: 'codegen', value: { out: 'src/ds' } })
    const before = await readFile(join(dir, 'uidx.json'), 'utf8')
    expect((await patch({ key: 'codegen', value: { out: 'x', targets: ['cobol'] } })).status).toBe(
      400,
    )
    expect(await readFile(join(dir, 'uidx.json'), 'utf8')).toBe(before)
  })
})
