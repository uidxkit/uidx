import { beforeEach, expect, it, vi } from 'vitest'

const manager = vi.hoisted(() => ({
  markLoaded: vi.fn(),
  setHostFontLoader: vi.fn(),
  setOnlineFontProviders: vi.fn(),
  setWebFontFetch: vi.fn(),
}))
vi.mock('@open-pencil/core', () => ({ fontManager: manager }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

it('installs the host loader before the bundled faces finish downloading', async () => {
  // A fetch that never settles: the canvas mounts while seeding is in flight.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => {})),
  )
  const { seedFonts } = await import('../src/fonts')
  void seedFonts()
  // Without it the SDK fetches its own bundled URL and caches the 404 body as Inter.
  expect(manager.setHostFontLoader).toHaveBeenCalledTimes(1)
  expect(manager.markLoaded).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})
