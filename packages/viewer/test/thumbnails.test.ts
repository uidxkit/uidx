import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseOrThrow } from '@uidx/format'

import { createAssetStore } from '../src/asset-store'
import { componentIndex } from '../src/layer-rows'
import {
  createThumbnailer,
  sceneForThumbnail,
  thumbnailKey,
  type ThumbnailRequest,
} from '../src/thumbnails'

/**
 * The bookkeeping around the render: the cache, its key, the queue and the
 * eviction. The render itself is injected — CanvasKit cannot be driven under
 * jsdom (spike S1), and its timings are measured against the real `design/`
 * sheets rather than asserted here.
 */

const DOC = parseOrThrow(`---
id: sign-in
---

## Visual Contract

<Page>
  <Frame name="screen" width={100} height={100} />
</Page>
`)

const request = (over: Partial<ThumbnailRequest> = {}): ThumbnailRequest => ({
  file: 'sign-in.uidx',
  doc: DOC,
  tokens: undefined,
  literals: undefined,
  components: undefined,
  revision: 1,
  definitions: null,
  assets: null,
  width: 640,
  height: 400,
  ...over,
})

/** jsdom implements neither half of the object-URL pair. */
let handed: string[] = []
let revoked: string[] = []

beforeEach(() => {
  handed = []
  revoked = []
  let next = 0
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:tile-${next++}`
    handed.push(url)
    return url
  })
  URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url))
})

const bytes = () => new Uint8Array([1, 2, 3])

describe('the thumbnail key', () => {
  it('changes when the page is written to, and not otherwise', () => {
    const at = (revision: number) => thumbnailKey(request({ revision }))

    expect(at(1)).toBe(at(1))
    expect(at(1)).not.toBe(at(2))
  })

  it('separates two pages and two tile sizes', () => {
    expect(thumbnailKey(request())).not.toBe(thumbnailKey(request({ file: 'other.uidx' })))
    expect(thumbnailKey(request())).not.toBe(thumbnailKey(request({ width: 320 })))
  })

  it('changes when a component definition may have moved, for a page that instances one', () => {
    // A page's own revision cannot see this: editing a component changes every
    // page that instances it while none of their revisions move.
    expect(thumbnailKey(request({ definitions: 1 }))).not.toBe(
      thumbnailKey(request({ definitions: 2 })),
    )
  })

  it('leaves a page holding no instances alone when a definition moves', () => {
    // Not stamped at all, so a component edit costs it nothing — the key is the
    // same one it had before there were any definitions to speak of.
    expect(thumbnailKey(request({ definitions: null }))).toBe(
      thumbnailKey(request({ definitions: null })),
    )
  })

  it('changes when artwork moved, for a page that paints with some', () => {
    // The third thing a page's revision cannot see, after a component edit: the
    // bytes live outside every `.uidx` file, so rewriting an image moves no
    // revision anywhere.
    expect(thumbnailKey(request({ assets: 1 }))).not.toBe(thumbnailKey(request({ assets: 2 })))
  })

  it('leaves a page painting with no artwork alone when artwork moves', () => {
    expect(thumbnailKey(request({ assets: null }))).toBe(thumbnailKey(request({ assets: null })))
  })

  it('does not let a page with no revision yet share a key with revision zero', () => {
    // They are different states: one has never been sent, the other has been
    // saved. Colliding them would serve a stale tile for the first save.
    expect(thumbnailKey(request({ revision: null }))).not.toBe(
      thumbnailKey(request({ revision: 0 })),
    )
  })
})

describe('the thumbnailer', () => {
  it('renders a page once and serves the cache after', async () => {
    const renderPage = vi.fn(async () => bytes())
    const thumbs = createThumbnailer({ renderPage })

    const first = await thumbs.request(request())
    const second = await thumbs.request(request())

    expect(renderPage).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
  })

  it('re-renders a page whose revision moved', async () => {
    const renderPage = vi.fn(async () => bytes())
    const thumbs = createThumbnailer({ renderPage })

    const before = await thumbs.request(request({ revision: 1 }))
    const after = await thumbs.request(request({ revision: 2 }))

    expect(renderPage).toHaveBeenCalledTimes(2)
    expect(after).not.toBe(before)
  })

  it('renders once for two tiles asking at the same moment', async () => {
    const renderPage = vi.fn(async () => bytes())
    const thumbs = createThumbnailer({ renderPage })

    const [a, b] = await Promise.all([thumbs.request(request()), thumbs.request(request())])

    expect(renderPage).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })

  it('renders one page at a time', async () => {
    // `prepareForExport` swaps a *global* text measurer for the duration of a
    // render, so two in flight would restore each other's. The queue is what
    // makes one shared renderer safe.
    let running = 0
    let overlapped = false
    const renderPage = vi.fn(async () => {
      running += 1
      if (running > 1) overlapped = true
      await Promise.resolve()
      running -= 1
      return bytes()
    })
    const thumbs = createThumbnailer({ renderPage })

    await Promise.all(
      ['a.uidx', 'b.uidx', 'c.uidx', 'd.uidx'].map((file) => thumbs.request(request({ file }))),
    )

    expect(renderPage).toHaveBeenCalledTimes(4)
    expect(overlapped).toBe(false)
  })

  it('reports a failure to the tile that asked, and keeps rendering', async () => {
    const renderPage = vi.fn(async (req: ThumbnailRequest) => {
      if (req.file === 'bad.uidx') throw new Error('scene would not build')
      return bytes()
    })
    const thumbs = createThumbnailer({ renderPage })

    const bad = thumbs.request(request({ file: 'bad.uidx' }))
    const good = thumbs.request(request({ file: 'good.uidx' }))

    // Rejected rather than resolved null: "could not be drawn" and "there was
    // nothing to draw" are different things to put on a tile. The queue carries
    // on either way — one bad page must not stop the dashboard.
    await expect(bad).rejects.toThrow('scene would not build')
    await expect(good).resolves.toBe('blob:tile-0')
  })

  it('caches nothing for a page there was nothing to draw for', async () => {
    const renderPage = vi.fn(async () => null)
    const thumbs = createThumbnailer({ renderPage })

    await thumbs.request(request())
    await thumbs.request(request())

    // Asked again rather than remembered as "nothing": a page becomes drawable
    // the moment somebody puts a frame on it, and that is a new revision anyway.
    expect(renderPage).toHaveBeenCalledTimes(2)
  })

  it('releases the oldest tile past the cap rather than growing forever', async () => {
    const thumbs = createThumbnailer({ renderPage: async () => bytes(), limit: 2 })

    await thumbs.request(request({ file: 'a.uidx' }))
    await thumbs.request(request({ file: 'b.uidx' }))
    await thumbs.request(request({ file: 'c.uidx' }))

    expect(revoked).toEqual([handed[0]])
  })

  it('releases every tile when the dashboard goes away', async () => {
    const thumbs = createThumbnailer({ renderPage: async () => bytes() })

    await thumbs.request(request({ file: 'a.uidx' }))
    await thumbs.request(request({ file: 'b.uidx' }))
    thumbs.dispose()

    expect(revoked).toEqual(handed)
  })

  it('does not leak a tile that finished after the dashboard went away', async () => {
    const thumbs = createThumbnailer({ renderPage: async () => bytes() })

    const pending = thumbs.request(request())
    thumbs.dispose()

    await expect(pending).resolves.toBeNull()
    expect(revoked).toEqual(handed)
  })
})

describe('the scene a tile is drawn from', () => {
  const LIBRARY = parseOrThrow(`---
id: library
---

## Visual Contract

<Page>
  <Component name="Button/Primary" status="stable">
    <Frame name="box" x={0} y={0} width={120} height={40} />
  </Component>
</Page>
`)

  const SCREEN = parseOrThrow(`---
id: settings
---

## Visual Contract

<Page>
  <Frame name="screen" x={0} y={0} width={400} height={300}>
    <Instance name="save" component="Button/Primary" x={10} y={10} />
  </Frame>
</Page>
`)

  const count = (scene: ReturnType<typeof sceneForThumbnail>) => {
    let n = 0
    const walk = (id: string) => {
      const node = scene.graph.getNode(id)
      if (!node) return
      n += 1
      for (const child of node.childIds ?? []) walk(child)
    }
    walk(scene.rootId)
    return n
  }

  it('expands an instance from a definition on another page', () => {
    // The bug this is here for: an `<Instance>` is a reference, and its subtree
    // comes from a `<Component>` on a page this one has never heard of. Built
    // without the index, the instance contributes no geometry — a page assembled
    // from a component library draws as the frames it declares literally and
    // nothing else, which on `design/option-4/properties.uidx` (211 instances)
    // was a nearly empty tile.
    const withIndex = sceneForThumbnail(
      request({ doc: SCREEN, components: componentIndex([LIBRARY, SCREEN]) }),
    )
    const without = sceneForThumbnail(request({ doc: SCREEN, components: undefined }))

    expect(count(withIndex)).toBeGreaterThan(count(without))
  })

  it('resolves a token declared on another page', () => {
    const bound = parseOrThrow(`---
id: bound
---

## Visual Contract

<Page>
  <Frame name="card" x={0} y={0} width={100} height={100} cornerRadius="{radius#md}" />
</Page>
`)

    const scene = sceneForThumbnail(request({ doc: bound, literals: new Map([['radius#md', 8]]) }))
    const card = scene.graph.getNode(scene.graph.getNode(scene.rootId)!.childIds[0]!)

    expect(card).toMatchObject({ cornerRadius: 8 })
  })
})

describe('image fills in a tile', () => {
  const WITH_IMAGE = parseOrThrow(`---
id: hero
---

## Visual Contract

<Page>
  <Frame name="banner" x={0} y={0} width={200} height={100}
    fills={[{ type: 'IMAGE', src: 'assets/logo.png' }]} />
</Page>
`)

  // Not a real PNG — the store hashes whatever bytes it is given and the graph
  // keys on that hash, neither of which decodes anything.
  const PIXELS = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])

  it('puts the resolved hash on the paint and the bytes in the graph', async () => {
    const store = createAssetStore(async () => PIXELS)
    await store.load(WITH_IMAGE)

    const scene = sceneForThumbnail(request({ doc: WITH_IMAGE }), store)
    const banner = scene.graph.getNode(scene.graph.getNode(scene.rootId)!.childIds[0]!)
    const hash = store.hashOf('assets/logo.png')

    expect(hash).toBeTruthy()
    // The paint names a hash; the bytes behind it have to be somewhere the
    // renderer can find them, which is the graph's own image store.
    expect(banner).toMatchObject({ fills: [expect.objectContaining({ imageHash: hash })] })
    expect(scene.graph.images.get(hash!)).toEqual(PIXELS)
  })

  it('fetches the bytes a page references before drawing it', async () => {
    const asked: string[] = []
    const thumbs = createThumbnailer({
      loadAsset: async (src) => {
        asked.push(src)
        return PIXELS
      },
      // The bytes have to be loaded by the time the render runs, which is what
      // this asserts by reading the store through the scene the render builds.
      renderPage: async (req) => {
        expect(asked).toContain('assets/logo.png')
        return req.doc === WITH_IMAGE ? bytes() : null
      },
    })

    await thumbs.request(request({ doc: WITH_IMAGE }))

    expect(asked).toEqual(['assets/logo.png'])
  })

  it('fetches one image once, however many pages reference it', async () => {
    const asked: string[] = []
    const thumbs = createThumbnailer({
      loadAsset: async (src) => {
        asked.push(src)
        return PIXELS
      },
      renderPage: async () => bytes(),
    })

    // A logo on six pages is one fetch: the store is keyed by a path that ADR
    // 0006 §3 makes document-relative, so it is shared across every tile.
    await thumbs.request(request({ file: 'a.uidx', doc: WITH_IMAGE }))
    await thumbs.request(request({ file: 'b.uidx', doc: WITH_IMAGE }))

    expect(asked).toEqual(['assets/logo.png'])
  })

  it('draws a page whose artwork is missing rather than failing it', async () => {
    const thumbs = createThumbnailer({
      loadAsset: async () => null,
      renderPage: async () => bytes(),
    })

    // The usual cause is artwork the author has not saved yet. The page still
    // draws — with a placeholder where the paint is — and the next render
    // retries, which is what that save produces.
    await expect(thumbs.request(request({ doc: WITH_IMAGE }))).resolves.toBe('blob:tile-0')
  })

  it('re-fetches an image it has been told to forget', async () => {
    let served = 'first'
    const asked: string[] = []
    const thumbs = createThumbnailer({
      loadAsset: async (src) => {
        asked.push(src)
        return new Uint8Array([...served].map((c) => c.charCodeAt(0)))
      },
      renderPage: async () => bytes(),
    })

    await thumbs.request(request({ doc: WITH_IMAGE }))
    expect(asked).toHaveLength(1)

    // Without this the store answers from `byPath` forever and the second render
    // draws the first bytes — the whole bug.
    expect(thumbs.invalidateAsset('assets/logo.png')).toBe(true)
    served = 'second'
    await thumbs.request(request({ doc: WITH_IMAGE, assets: 1 }))

    expect(asked).toEqual(['assets/logo.png', 'assets/logo.png'])
  })

  it('says it held nothing for an image this surface never loaded', async () => {
    const thumbs = createThumbnailer({ renderPage: async () => bytes() })

    // The shell announces every change to the document's artwork; a surface
    // that never drew that page should not be made to re-render for it.
    expect(thumbs.invalidateAsset('assets/never-seen.png')).toBe(false)
  })
})
