import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const manager = vi.hoisted(() => ({
  markLoaded: vi.fn(),
  setHostFontLoader: vi.fn(),
  setOnlineFontProviders: vi.fn(),
  setWebFontFetch: vi.fn(),
}))
vi.mock('@open-pencil/core', () => ({ fontManager: manager }))
const font = {
  id: 'test',
  family: 'Test Sans',
  style: 'Regular',
  weight: 400,
  italic: false,
  source: 'custom',
  file: 'test.ttf',
}
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})
afterEach(() => vi.unstubAllGlobals())

describe('font loading', () => {
  it('explains a stale server returning HTML instead of exposing a JSON syntax error', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }),
        ),
    )
    const library = await import('../src/font-library')
    await library.initializeFontLibrary()
    expect(library.fontLibraryError.value).toContain('Restart the uidx server')
    expect(library.fontLibraryError.value).not.toContain('Unexpected token')
  })
  it('restores project faces into the canvas manager and serves only real matching families', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json([font]))
      .mockResolvedValueOnce(new Response(new Uint8Array([0, 1, 0, 0])))
    vi.stubGlobal('fetch', fetcher)
    const library = await import('../src/font-library')
    await library.initializeFontLibrary()
    expect(manager.markLoaded).toHaveBeenCalledWith('Test Sans', 'Regular', expect.any(ArrayBuffer))
    expect(library.fontGeneration.value).toBe(1)
    expect(await library.projectFontBytes('Test Sans', 'Regular')).toBeInstanceOf(ArrayBuffer)
    expect(await library.projectFontBytes('Missing', 'Regular')).toBeNull()
    expect(await library.projectFontBytes('Test Sans', 'Bold')).toBeNull()
  })
  it('retains bundled fonts when the project library fails and allows retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')))
    const library = await import('../src/font-library')
    await expect(library.initializeFontLibrary()).resolves.toBeUndefined()
    expect(library.fontLibraryError.value).toBe('Offline')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([])))
    await library.initializeFontLibrary()
    expect(library.fontLibraryError.value).toBe('')
  })
  it('validates file types and reports server refusals', async () => {
    const library = await import('../src/font-library')
    await expect(library.uploadFont(new File(['bad'], 'test.woff2'))).rejects.toThrow(/ttf or .otf/)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: 'Unknown family' }, { status: 400 })),
    )
    await expect(library.importGoogleFont('Unknown', 400, false)).rejects.toThrow('Unknown family')
  })
})
