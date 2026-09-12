import { SkiaRenderer } from '@open-pencil/core'
import { getCanvasKit } from '@open-pencil/core/canvaskit'
import { renderThumbnail } from '@open-pencil/core/io'
import { toSceneGraph, type SceneResult, type TokenIndex, type TokenResolver } from '@uidx/schema'
import type { JsonValue, UidxDocument, UidxNode } from '@uidx/format'

import { createAssetStore, type AssetFetch, type AssetStore } from './asset-store'
import { seedFonts } from './fonts'

/**
 * A page, drawn small.
 *
 * The dashboard needs a picture of every page while the canvas is drawing at
 * most one, so the two cannot share a surface. They do share everything that is
 * expensive: `getCanvasKit` is a module singleton and `fontManager` — which
 * `seedFonts` has already fed the bundled Inter faces — is another, so a second
 * renderer here costs one 1x1 raster surface and no second copy of a 7 MB wasm
 * binary. This is the construction `@open-pencil/core`'s own headless helper
 * performs, minus its `initCanvasKit`, which resolves `canvaskit-wasm/full`
 * through a Node path and would fetch a second, different binary in a browser.
 *
 * Measured on this repo's own `design/` sheets — 25 pages, the largest 1586
 * scene nodes once instances are expanded: ~100 ms to boot, then a median of
 * 73 ms per tile and 2.1 s for all 25 serialised. In the browser, cold and
 * including the wasm, the eight tiles of `design/option-4` are up in 3.8 s. A
 * save re-renders exactly one.
 *
 * No `<canvas>` element and no `requestAnimationFrame`: `ck.MakeSurface` hands
 * back a raster surface directly, so spike S1 — the rAF that `useCanvasKitLoader`
 * awaits, which a backgrounded tab never fires — is not on this path.
 *
 * A tile is built with the same four resolvers the canvas is. Three of them
 * answer with something from *another* page — a component, a token, an image —
 * which is what the client holding the whole document is for (ADR 0004 §1).
 */

/**
 * The ground a tile is cleared to — `--canvas-bg` from `theme.css`, as the
 * 0..1 floats Skia takes.
 *
 * The one raw colour in this package, and the rule it breaks is real: no
 * component may contain a hex code, because "does this look like Figma" should
 * be answerable from one file. This is not CSS — it is a value handed to a
 * rasteriser, so it cannot be a custom property, and the alternative is reading
 * a computed style off an element the renderer does not have.
 */
const TILE_GROUND = { r: 0x1e / 255, g: 0x1e / 255, b: 0x1e / 255, a: 1 }

export interface ThumbnailRequest {
  /** The page id, which is also the cache key's first half. */
  file: string
  doc: UidxDocument
  /** Mode-aware token resolution, so a tile paints the colours the canvas does. */
  tokens: { resolver: TokenResolver; index: TokenIndex } | undefined
  /** Token address -> literal, the flat default-mode view `resolveAlias` reads. */
  literals: ReadonlyMap<string, JsonValue> | undefined
  /**
   * Component name -> definition, across every page of the document (F3).
   *
   * An `<Instance>` is a reference, and its subtree comes from a `<Component>`
   * that ADR 0004 §2 makes global to the document — very often on a different
   * page than the instance. Without this the descent has nothing to expand and
   * an instance contributes no geometry at all, so a page built from a
   * component library draws as the few frames it declares directly and nothing
   * else. `design/option-4/properties.uidx` is 211 instances; it rendered
   * nearly empty.
   */
  components: ReadonlyMap<string, UidxNode> | undefined
  /**
   * The page's revision.
   *
   * The cache key, and half the invalidation strategy: a thumbnail is stale
   * when the file it draws has been written to, which is the event that moves
   * this number. Null before the first `file:changed`, which caches under its
   * own key rather than pretending to be revision 0.
   */
  revision: number | null
  /**
   * A stamp for the component definitions this page draws through, or null for
   * a page holding no instances.
   *
   * The other half of invalidation, and the half a page-local revision cannot
   * see: editing a component changes every page that instances it while none of
   * their revisions move. Coarse in the same direction `CanvasPane` is
   * (`definitionsMoved`) — it can redraw for a save that changed nothing this
   * page uses, never the reverse — and it costs a page with no instances
   * nothing, because there is nothing to stamp.
   */
  definitions: number | null
  /**
   * A stamp for the artwork this page paints with, or null for a page that
   * references none.
   *
   * The third thing a page's own revision cannot see, for the same reason as
   * `definitions`: an image lives outside every `.uidx` file, so rewriting it
   * moves no revision anywhere. The server watches the referenced artwork and
   * says which `src` moved; the shell counts those and stamps the pages that
   * could be affected. Null for a page with no image paint, which is most of
   * them, so artwork churn costs them nothing.
   */
  assets: number | null
  fonts?: number
  width: number
  height: number
}

export interface Thumbnailer {
  /**
   * The tile for a page, rendering it if this is the first ask.
   *
   * Resolves null for a page there is nothing to draw — a `<Tokens>` page or an
   * empty one — and rejects when a page that should have drawn did not. The two
   * are different things to say on a tile, so they are different answers here.
   */
  request(request: ThumbnailRequest): Promise<string | null>
  /**
   * Forget the bytes held for one `src`, so the next render re-fetches it.
   *
   * Only the bytes. The rendered tiles are left alone deliberately — which one
   * of them is now wrong is a question about which pages paint with this file,
   * and the shell is what knows that. It answers by moving the `assets` stamp,
   * which is what actually retires the stale tiles.
   */
  invalidateAsset(src: string): boolean
  /** Drop every cached tile and release the surface. */
  dispose(): void
}

/** As much of the asset store as building a scene needs. */
export type SceneAssets = Pick<AssetStore, 'hashOf' | 'entries'>

/**
 * The scene a tile is drawn from.
 *
 * Its own function because it is the whole of what a thumbnail resolves, and
 * because it is the only part of the render that can be tested headlessly —
 * CanvasKit cannot run under jsdom (spike S1), but the descent that expands an
 * instance and resolves a token is pure.
 *
 * The options are the same set `CanvasPane` builds the canvas with, and they
 * matter for the same reason: an `<Instance>` names a `<Component>` and a value
 * may name a token, both of which ADR 0004 §2 makes global to the *document*
 * and both of which usually live on another page. A build handed only the page
 * draws a page's literal frames and nothing that references anything.
 */
export function sceneForThumbnail(request: ThumbnailRequest, assets?: SceneAssets): SceneResult {
  const scene = toSceneGraph(request.doc, {
    resolveAlias: (address) => request.literals?.get(address),
    resolveComponent: (name) => request.components?.get(name),
    resolveAsset: (src) => assets?.hashOf(src),
    tokens: request.tokens,
  })
  // The graph owns the byte store the renderer reads and a fresh graph starts
  // empty, so it is refilled here — the same two steps `CanvasPane` takes, and
  // for the same reason: `resolveAsset` puts a *hash* on the paint, and the
  // bytes behind that hash have to be somewhere the renderer can find them.
  if (assets) for (const asset of assets.entries()) scene.graph.images.set(asset.hash, asset.bytes)
  return scene
}

export function thumbnailKey(request: ThumbnailRequest): string {
  const revision = request.revision ?? 'pending'
  const definitions = request.definitions === null ? '' : `+defs${request.definitions}`
  const assets = request.assets === null ? '' : `+art${request.assets}`
  const fonts = request.fonts ? `+fonts${request.fonts}` : ''
  return `${request.file}@${revision}${definitions}${assets}${fonts}@${request.width}x${request.height}`
}

/**
 * Object URLs rather than base64 data URLs.
 *
 * A data URL is a JavaScript string pinned in the heap for as long as anything
 * references it, about a third larger than the bytes it carries, and it cannot
 * be handed back. A blob URL is revocable, which is what makes an eviction
 * policy possible at all — thirty tiles at 27 KB is not the problem, thirty
 * tiles that can never be released across a long session is.
 */
function urlFor(bytes: Uint8Array): string {
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }))
}

export interface ThumbnailerOptions {
  /**
   * Tiles kept before the oldest is released.
   *
   * Generous, because the working set is "the pages of one document" and a tile
   * is tens of kilobytes: the cap is here so that a long session editing a large
   * document has a ceiling, not because thirty tiles is expensive.
   */
  limit?: number
  /**
   * How image bytes are fetched. Test seam, and the same shape `AssetStore`
   * takes — the default asks the server's own asset route.
   */
  loadAsset?: AssetFetch
  /**
   * The render itself. Test seam.
   *
   * CanvasKit cannot be driven under jsdom (spike S1), which would otherwise put
   * the cache, the queue and the eviction policy — all of which are ordinary
   * bookkeeping — out of reach of the suite along with the rasteriser. Replacing
   * one function leaves everything around it under test.
   */
  renderPage?: (request: ThumbnailRequest) => Promise<Uint8Array | null>
}

export function createThumbnailer(options: ThumbnailerOptions = {}): Thumbnailer {
  const limit = options.limit ?? 64
  /** Insertion-ordered, so the first key is the least recently rendered. */
  const cache = new Map<string, string>()
  const inFlight = new Map<string, Promise<string | null>>()

  /**
   * Image bytes for every page of the document, in one store.
   *
   * One rather than one per tile because the store is keyed by path and a path
   * is document-relative (ADR 0006 §3): a logo on six pages is one fetch, not
   * six. Its own store rather than the canvas's, which belongs to `CanvasPane`
   * and lives and dies with it — the cost is that opening a page after seeing
   * its thumbnail re-fetches those bytes once, against the server the viewer is
   * already served from, and the browser has them cached. Known and open — see
   * "One image is fetched twice per session" in `docs/backlog.md`.
   *
   * A reference that fails to load draws as a placeholder and is retried on the
   * page's next render, which is what a save produces — the same self-healing
   * `CanvasPane` gets, and for the same reason: the usual cause is artwork the
   * author has not saved yet.
   *
   * What it does not survive is the file changing underneath it: bytes are held
   * by path for the session and nothing watches the asset globs, so an
   * overwritten image keeps drawing the old picture. Also known and open, and
   * `CanvasPane` has it too — see "Changed artwork does not reach the screen".
   */
  const assets = createAssetStore(options.loadAsset)

  let engine: Promise<{
    ck: Awaited<ReturnType<typeof getCanvasKit>>
    renderer: SkiaRenderer
  }> | null = null
  let disposed = false

  /**
   * The renderer, built once on the first tile anybody actually asks for.
   *
   * Lazy rather than eager so that opening straight to a page — `uidx open`
   * with one file, or any link carrying `?page=` — never pays for a surface the
   * session will not draw on.
   */
  function ready(): Promise<{
    ck: Awaited<ReturnType<typeof getCanvasKit>>
    renderer: SkiaRenderer
  }> {
    engine ??= (async () => {
      // Before the renderer, deliberately: `loadFonts` asks the font manager for
      // Inter, and seeding after that is too late for the first tile — the same
      // ordering `CanvasPane` observes for the canvas.
      await seedFonts()
      const ck = await getCanvasKit()
      const surface = ck.MakeSurface(1, 1)
      if (!surface) throw new Error('CanvasKit would not allocate a surface for thumbnails')
      const renderer = new SkiaRenderer(ck, surface)
      renderer.viewportWidth = 1
      renderer.viewportHeight = 1
      renderer.dpr = 1
      // `renderThumbnail` fits the page inside the tile and clears the rest to
      // this colour, so a page that is not the tile's aspect ratio letterboxes.
      // Left at the renderer's white default, a tall page — `properties.uidx` is
      // 1440x3616 — arrives as a slab of white in a dark well, which reads as a
      // broken render rather than a shape. The canvas ground makes the bars
      // disappear into the tile.
      renderer.pageColor = TILE_GROUND
      await renderer.loadFonts()
      return { ck, renderer }
    })()
    return engine
  }

  /**
   * One tile at a time.
   *
   * Not politeness about the main thread. `prepareForExport` swaps the *global*
   * text measurer for the duration of a render and restores it afterwards, and
   * `renderThumbnail` draws through one shared renderer — two renders in flight
   * would interleave those swaps and restore each other's measurer. The queue is
   * what makes the shared renderer safe.
   */
  let queue: Promise<unknown> = Promise.resolve()
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work, work)
    // Failures belong to the caller that asked, not to the next tile in line.
    queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  const renderPage = options.renderPage ?? drawWithSkia

  async function draw(request: ThumbnailRequest): Promise<string | null> {
    // Fetching the artwork is the thumbnailer's job, not the rasteriser's — so
    // it sits outside `renderPage`, which tests replace. Before the render and
    // awaited: `resolveAsset` is asked during the descent, so bytes that arrive
    // after it has run are bytes the paint never saw.
    await assets.load(request.doc)
    if (disposed) return null

    const bytes = await renderPage(request)
    if (bytes === null || disposed) return null
    return urlFor(bytes)
  }

  async function drawWithSkia(request: ThumbnailRequest): Promise<Uint8Array | null> {
    // A `<Tokens>` page declares variable collections and `toSceneGraph` throws
    // rather than invent a scene — asked before building, because the throw is
    // the documented answer and not an error worth reporting as one.
    if (request.doc.tree.element === 'Tokens') return null

    const { ck, renderer } = await ready()
    if (disposed) return null

    const scene = sceneForThumbnail(request, assets)
    const page = scene.graph.getNode(scene.rootId)
    const nodeIds = page?.childIds ?? []
    if (nodeIds.length === 0) return null

    // The renderer memoises pictures per node id, and node ids are UIDX
    // addresses — so `frame#0` on one page and `frame#0` on the next are the
    // same key holding different geometry. Without this every tile after the
    // first draws the first page's content.
    renderer.invalidateAllPictures()

    const restore = await renderer.prepareForExport(scene.graph, scene.rootId, nodeIds)
    try {
      return renderThumbnail(ck, renderer, scene.graph, scene.rootId, request.width, request.height)
    } finally {
      restore()
    }
  }

  function remember(key: string, url: string | null): string | null {
    if (url === null) return null
    // Disposed while this tile was in the queue: the pane that asked has gone,
    // so the bytes are handed straight back rather than into a cache nobody
    // will read or release.
    if (disposed) {
      URL.revokeObjectURL(url)
      return null
    }
    cache.set(key, url)
    while (cache.size > limit) {
      const oldest = cache.keys().next()
      if (oldest.done) break
      const stale = cache.get(oldest.value)
      cache.delete(oldest.value)
      if (stale) URL.revokeObjectURL(stale)
    }
    return url
  }

  return {
    request(request) {
      const key = thumbnailKey(request)
      const cached = cache.get(key)
      if (cached) return Promise.resolve(cached)

      // Two tiles asking for one page — a resize, or a scroll that re-observes a
      // row — must not render it twice.
      const running = inFlight.get(key)
      if (running) return running

      // A failure is passed to the caller rather than swallowed into a null.
      // The tile can then say *that* it could not be drawn, which is a different
      // thing from a page with nothing on it — and a well that stays empty for
      // no stated reason is the one outcome worth ruling out.
      const work = enqueue(() => draw(request))
        .then((url) => remember(key, url))
        .finally(() => inFlight.delete(key))
      inFlight.set(key, work)
      return work
    },

    invalidateAsset(src) {
      return assets.invalidate(src)
    },

    dispose() {
      disposed = true
      for (const url of cache.values()) URL.revokeObjectURL(url)
      cache.clear()
    },
  }
}
