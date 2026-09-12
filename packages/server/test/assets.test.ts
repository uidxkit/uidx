import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { assetReply, contentTypeFor } from '../src/assets'
import { assetProblem, documentAssets, findManifest } from '../src/document'

const roots: string[] = []
afterEach(() => roots.splice(0))

/** A document on disk, with whatever manifest and files the case needs. */
async function workspace(
  manifest: Record<string, unknown>,
  files: Record<string, string> = {},
): Promise<NonNullable<Awaited<ReturnType<typeof findManifest>>>> {
  const dir = await mkdtemp(join(tmpdir(), 'uidx-assets-'))
  roots.push(dir)
  await writeFile(join(dir, 'uidx.json'), JSON.stringify(manifest))
  for (const [path, body] of Object.entries(files)) {
    const full = join(dir, path)
    await mkdir(join(full, '..'), { recursive: true })
    await writeFile(full, body)
  }
  return (await findManifest(dir))!
}

const MANIFEST = { id: 'w', files: ['**/*.uidx'] }

describe('the manifest', () => {
  it('defaults to the conventional folders when it says nothing', async () => {
    const found = await workspace(MANIFEST)
    expect(found.manifest.assets).toEqual(['assets/**', 'images/**', 'icons/**'])
  })

  it('takes an empty array as a statement, not as absence', async () => {
    // "This document has no assets" is a thing a manifest may say.
    const found = await workspace({ ...MANIFEST, assets: [] })
    expect(found.manifest.assets).toEqual([])
    expect(await documentAssets(found)).toEqual(new Set())
  })

  it('refuses a malformed assets field rather than ignoring it', async () => {
    await expect(workspace({ ...MANIFEST, assets: 'assets/**' })).rejects.toThrow(/"assets"/)
  })

  it('enumerates only what the globs cover', async () => {
    const found = await workspace(
      { ...MANIFEST, assets: ['icons/**'] },
      {
        'icons/tick.svg': '<svg/>',
        'elsewhere/logo.png': 'x',
      },
    )
    expect([...(await documentAssets(found))]).toEqual(['icons/tick.svg'])
  })
})

/**
 * Three answers rather than one, because they need three different fixes.
 */
describe('assetProblem', () => {
  it('passes a declared file that is there', async () => {
    const found = await workspace(MANIFEST, { 'assets/a.png': 'x' })
    expect(await assetProblem(found, await documentAssets(found), 'assets/a.png')).toBeNull()
  })

  it('tells a missing file from an undeclared one', async () => {
    const found = await workspace(
      { ...MANIFEST, assets: ['assets/**'] },
      {
        'vendor/logo.png': 'x',
      },
    )
    const declared = await documentAssets(found)
    expect(await assetProblem(found, declared, 'assets/gone.png')).toMatchObject({
      code: 'MISSING_ASSET',
    })
    // On disk, but the document never said that folder was part of it.
    expect(await assetProblem(found, declared, 'vendor/logo.png')).toMatchObject({
      code: 'UNDECLARED_ASSET',
    })
  })

  it('calls a malformed path malformed before it goes near the disk', async () => {
    const found = await workspace(MANIFEST)
    const declared = await documentAssets(found)
    for (const src of ['../outside.png', 'https://x/a.png', '/abs.png']) {
      expect(await assetProblem(found, declared, src), src).toMatchObject({
        code: 'BAD_ASSET_PATH',
      })
    }
  })
})

describe('the asset route', () => {
  it('serves a declared file with a type a browser can use', async () => {
    const found = await workspace(MANIFEST, { 'images/a.png': 'PNGBYTES' })
    const reply = await assetReply(found, 'images/a.png')
    expect(reply.status).toBe(200)
    expect(reply).toMatchObject({ type: 'image/png' })
    expect(Buffer.from((reply as { body: Uint8Array }).body).toString()).toBe('PNGBYTES')
  })

  /**
   * The reason the check runs here and not only in the browser: a client that
   * skipped its own validation still cannot read a file the document never
   * named.
   */
  it('refuses to climb out of the document, however the request is spelled', async () => {
    const found = await workspace(MANIFEST, { 'assets/a.png': 'x' })
    for (const path of ['../../etc/passwd', '..%2F..%2Fetc%2Fpasswd', '/etc/passwd']) {
      const reply = await assetReply(found, path)
      expect(reply.status, path).toBe(400)
    }
  })

  it('refuses a real file the manifest never declared', async () => {
    const found = await workspace({ ...MANIFEST, assets: ['assets/**'] }, { 'secret.env': 'x' })
    expect(await assetReply(found, 'secret.env')).toMatchObject({ status: 403 })
  })

  it('says not-found for a declared path with nothing behind it', async () => {
    const found = await workspace(MANIFEST, { 'assets/a.png': 'x' })
    expect(await assetReply(found, 'assets/b.png')).toMatchObject({ status: 403 })
  })

  it('does not fall over on an undecodable path', async () => {
    const found = await workspace(MANIFEST)
    expect(await assetReply(found, '%E0%A4%A')).toMatchObject({ status: 400 })
  })
})

describe('content types', () => {
  it('names the formats a canvas can decode, and shrugs at the rest', () => {
    expect(contentTypeFor('a/b.PNG')).toBe('image/png')
    expect(contentTypeFor('a.jpeg')).toBe('image/jpeg')
    expect(contentTypeFor('a.svg')).toBe('image/svg+xml')
    expect(contentTypeFor('a.bin')).toBe('application/octet-stream')
  })
})
