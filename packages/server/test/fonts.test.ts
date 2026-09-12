import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadGoogleFont, FontLibrary, inspectFont } from '../src/fonts.js'
import { createUidxServer, type UidxServer } from '../src/server.js'

let dir: string
let bytes: Buffer
let server: UidxServer | undefined
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uidx-fonts-'))
  bytes = await readFile(new URL('../../viewer/public/fonts/Inter-Regular.ttf', import.meta.url))
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await server?.close()
  server = undefined
  await rm(dir, { recursive: true, force: true })
})

function customFont(): Buffer {
  const copy = Buffer.from(bytes)
  const from = Buffer.from('Inter', 'utf16le').swap16(),
    to = Buffer.from('Uidxy', 'utf16le').swap16()
  for (let index = copy.indexOf(from); index !== -1; index = copy.indexOf(from, index + to.length))
    to.copy(copy, index)
  return copy
}

describe('project font storage', () => {
  it('reads family and style from the font tables', () => {
    expect(inspectFont(bytes)).toEqual({
      family: 'Inter',
      style: 'Regular',
      weight: 400,
      italic: false,
    })
    expect(() => inspectFont(Buffer.from('<html>not a font</html>'))).toThrow(/valid static/)
    expect(() => inspectFont(bytes.subarray(0, 120))).toThrow(/valid static/)
  })
  it('persists uploaded bytes and metadata, deduplicates imports, and removes a face', async () => {
    const library = new FontLibrary(dir)
    const custom = customFont()
    const font = await library.add(custom, 'custom')
    expect(font.family).toBe('Uidxy')
    expect(await library.add(custom, 'custom')).toEqual(font)
    const reopened = new FontLibrary(dir)
    expect(await reopened.list()).toEqual([font])
    expect(await reopened.bytes(font.id)).toEqual(custom)
    await reopened.remove(font.id)
    expect(await reopened.list()).toEqual([])
    await expect(reopened.bytes(font.id)).rejects.toThrow(/not found/)
  })
  it('serializes concurrent imports and refuses conflicting faces and bundled duplicates', async () => {
    const library = new FontLibrary(dir)
    await Promise.all([
      library.add(bytes, 'google', 'First'),
      library.add(bytes, 'google', 'Second'),
    ])
    expect(await library.list()).toHaveLength(2)
    const altered = Buffer.from(bytes)
    altered[8] = altered[8]! ^ 1
    await expect(library.add(altered, 'google', 'First')).rejects.toThrow(/already imported/)
    await expect(library.add(bytes, 'custom')).rejects.toThrow(/already bundled/)
  })
  it('refuses arbitrary file paths and symlinked font bytes', async () => {
    const library = new FontLibrary(dir)
    await expect(library.bytes('../../secrets')).rejects.toThrow(/not found/)
    const font = await library.add(customFont(), 'custom')
    await rm(join(dir, 'fonts', font.file))
    await symlink(join(dir, 'fonts', 'fonts.json'), join(dir, 'fonts', font.file))
    await expect(library.bytes(font.id)).rejects.toThrow(/symlink/)
  })
})

describe('Google font imports', () => {
  it('downloads a full font from Google with encoded family and explicit style', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          '@font-face { src: url(https://fonts.gstatic.com/s/test.ttf) format("truetype"); }',
        ),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array(bytes)))
    vi.stubGlobal('fetch', fetcher)
    expect(await downloadGoogleFont('Noto Sans Hebrew', 700, true)).toEqual(bytes)
    const url = fetcher.mock.calls[0]![0] as URL
    expect(url.searchParams.get('family')).toBe('Noto Sans Hebrew:ital,wght@1,700')
    expect(fetcher.mock.calls[1]![0]).toBe('https://fonts.gstatic.com/s/test.ttf')
  })
  it('reports unavailable styles and refuses unexpected download hosts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unavailable', { status: 400 })))
    await expect(downloadGoogleFont('Unknown', 400, false)).rejects.toThrow(/could not find/)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('@font-face { src: url(http://localhost/private) }')),
    )
    await expect(downloadGoogleFont('Roboto', 400, false)).rejects.toThrow(/supported font/)
    await expect(downloadGoogleFont('Roboto&other=value', 400, false)).rejects.toThrow(/family/)
  })
})

describe('font HTTP routes', () => {
  beforeEach(async () => {
    await writeFile(join(dir, 'uidx.json'), JSON.stringify({ id: 'font-tests', files: ['*.uidx'] }))
    const file = join(dir, 'page.uidx')
    await writeFile(file, '---\nid: fonts\n---\n\n## Visual Contract\n\n<Frame name="root" />\n')
    server = await createUidxServer({ root: dir, file, port: 4770 })
  })
  it('uploads, lists, serves and deletes project fonts over HTTP', async () => {
    const root = `${server!.url}/__uidx/fonts`
    const upload = await fetch(root + '/upload', {
      method: 'POST',
      body: new Uint8Array(customFont()),
      headers: { 'content-type': 'application/octet-stream' },
    })
    expect(upload.status).toBe(200)
    const font = (await upload.json()) as { id: string }
    expect(await (await fetch(root)).json()).toHaveLength(1)
    const file = await fetch(root + '/' + font.id)
    expect(file.headers.get('content-type')).toBe('font/ttf')
    expect(Buffer.from(await file.arrayBuffer())).toEqual(customFont())
    expect((await fetch(root + '/' + font.id, { method: 'DELETE' })).status).toBe(200)
    expect(await (await fetch(root)).json()).toEqual([])
  })
  it('rejects cross-origin writes, invalid uploads and invalid Google requests', async () => {
    const root = `${server!.url}/__uidx/fonts`
    expect(
      (
        await fetch(root + '/upload', {
          method: 'POST',
          headers: { origin: 'https://example.com' },
          body: new Uint8Array(customFont()),
        })
      ).status,
    ).toBe(403)
    expect((await fetch(root + '/upload', { method: 'POST', body: 'invalid' })).status).toBe(400)
    expect((await fetch(root + '/google', { method: 'POST', body: '{}' })).status).toBe(400)
    expect(await (await fetch(root)).json()).toEqual([])
  })
})
