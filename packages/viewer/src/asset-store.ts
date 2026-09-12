import { computeImageHash } from '@open-pencil/scene-graph'
import { assetRefs, type UidxDocument } from '@uidx/format'

/**
 * Image bytes, fetched once and kept by path (ADR 0006 §9).
 *
 * The file names a path and the renderer wants a hash keyed into
 * `graph.images`, so something has to load the bytes and bridge the two. That
 * is here rather than in `@uidx/schema` for the reason the SVG importer is in
 * this package: it is I/O, and the mapping layer has none.
 *
 * Fetched from the server's own origin, which is where the viewer already gets
 * its wasm and its fonts — not a hole in G7's no-network rule, which is about
 * the *renderer* not reaching the internet.
 */

export const ASSET_ROUTE = '/__uidx/asset/'

export interface LoadedAsset {
  hash: string
  bytes: Uint8Array
}

export interface AssetStore {
  /** The hash a `src` resolved to, for `toSceneGraph`'s `resolveAsset`. */
  hashOf(src: string): string | undefined
  /** Everything loaded, to be handed to a fresh graph's `images` map. */
  entries(): LoadedAsset[]
  /** References this document names that could not be loaded. */
  missing(): string[]
  /**
   * Forget one reference, so the next `load` fetches it again.
   *
   * The store is a cache with no expiry — `load` asks only for paths it does
   * not already hold — which is right while a path's bytes are immutable and
   * wrong the moment the file behind it is rewritten. The server watches the
   * artwork a document references and says which one moved; this is what a
   * client does with that.
   *
   * Answers whether anything was actually held, so a caller can skip the
   * re-render for a file this surface had never loaded.
   */
  invalidate(src: string): boolean
  /**
   * Loads whatever `doc` references and is not held yet. Resolves to true when
   * anything changed, which is the caller's cue that a rebuild is worth it.
   */
  load(doc: UidxDocument): Promise<boolean>
}

/** Injectable so the store can be tested without a server. */
export type AssetFetch = (src: string) => Promise<Uint8Array | null>

const defaultFetch: AssetFetch = async (src) => {
  const response = await fetch(`${ASSET_ROUTE}${src.split('/').map(encodeURIComponent).join('/')}`)
  if (!response.ok) return null
  return new Uint8Array(await response.arrayBuffer())
}

export function createAssetStore(load: AssetFetch = defaultFetch): AssetStore {
  const byPath = new Map<string, LoadedAsset>()
  const failed = new Set<string>()

  return {
    hashOf: (src) => byPath.get(src)?.hash,
    entries: () => [...byPath.values()],
    missing: () => [...failed],

    invalidate(src) {
      // Dropped from both: a file that failed and has since been written is the
      // usual reason this is called, and leaving it in `failed` would keep
      // reporting artwork that is now on disk as missing.
      failed.delete(src)
      return byPath.delete(src)
    },

    async load(doc) {
      const wanted = new Set(
        assetRefs(doc)
          .map((ref) => ref.src)
          .filter((src) => src !== ''),
      )

      // Retried every time rather than remembered as hopeless: the usual reason
      // a reference fails is that the author has not saved the file yet, and
      // the next document is exactly when they have.
      const fresh = [...wanted].filter((src) => !byPath.has(src))
      const results = await Promise.all(
        fresh.map(async (src) => ({ src, bytes: await load(src).catch(() => null) })),
      )

      let changed = false
      for (const { src, bytes } of results) {
        if (!bytes) continue
        // Hashed here rather than on the server: the hash is what the scene
        // graph is keyed by, it is derived (ADR 0006 §2), and computing it
        // where the bytes land keeps the two from ever disagreeing.
        byPath.set(src, { hash: computeImageHash(bytes), bytes })
        changed = true
      }

      failed.clear()
      for (const src of wanted) if (!byPath.has(src)) failed.add(src)
      return changed
    },
  }
}
