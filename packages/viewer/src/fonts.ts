import { fontManager } from '@open-pencil/core'

import { EMPTY_COVERAGE, mergeCoverage, readGlyphCoverage, type GlyphCoverage } from '@uidx/schema'
import { initializeFontLibrary, projectFontBytes, registerFontCoverage } from './font-library'

/**
 * Feeds the bundled Inter faces to the SDK's font manager (G7 — no network).
 *
 * Two earlier approaches failed in ways worth remembering:
 *   - `EditorOptions.loadFont` is never called.
 *   - Registering into the renderer's `TypefaceFontProvider` works until the
 *     next `createSurface`, which deletes that provider and repopulates a new
 *     one from `fontManager`. Text then keeps *measuring* correctly while the
 *     glyphs silently vanish, so the layout looks right and the label is blank.
 *
 * `fontManager` is the authority, so seeding it covers every provider it ever
 * attaches.
 *
 * Timing matters: this must run before mount, because `useCanvas` calls the
 * SDK's `loadFonts()` on mount and that asks the manager for Inter Regular.
 */
const FACES: Record<string, string> = {
  Regular: 'Regular',
  Medium: 'Medium',
  SemiBold: 'Semi Bold',
  Bold: 'Bold',
}

async function fetchFace(file: string): Promise<ArrayBuffer | null> {
  const response = await fetch(`/fonts/Inter-${file}.ttf`)
  return response.ok ? await response.arrayBuffer() : null
}

export interface SeededFonts {
  /** Styles that were registered. */
  styles: string[]
  /** Codepoints the bundled family can draw. */
  coverage: GlyphCoverage
}

let seeded: Promise<SeededFonts> | null = null

/**
 * Shuts the web font providers off, by name.
 *
 * This used to hold only because `WebFontResolver.fetchFont` short-circuits in a
 * browser that has not been given a fetcher — an internal detail of a 0.x
 * dependency, which is a thin thing to rest an offline guarantee on. Naming the
 * providers puts the guarantee in this repo, where it is reviewable.
 *
 * The failure it prevents is worse than a slow load. A codepoint the bundled
 * family lacks makes the SDK raise a font *demand*; while that demand is
 * unsettled the node's readiness is `pending`, and `renderText` draws nothing at
 * all for a pending node. Settling as `exhausted` is what unlocks its fallback
 * path. So an unreachable provider does not degrade text — it holds the node in
 * `pending` for as long as the network takes to give up, which air-gapped can be
 * indefinitely. Refusing the fetch outright turns that into an immediate,
 * deterministic failure.
 */
function refuseNetworkFonts(): void {
  fontManager.setOnlineFontProviders({
    google: false,
    fontsource: false,
    bunny: false,
    fontshare: false,
  })
  fontManager.setWebFontFetch(() => {
    // Rejecting is the point: it settles the demand now rather than at the mercy
    // of a DNS timeout.
    return Promise.reject(new Error('uidx renders offline; web fonts are disabled'))
  })
}

export function seedFonts(): Promise<SeededFonts> {
  seeded ??= (async () => {
    refuseNetworkFonts()

    const styles: string[] = []
    const coverages: GlyphCoverage[] = []
    for (const [file, style] of Object.entries(FACES)) {
      const bytes = await fetchFace(file)
      if (!bytes) continue
      // `markLoaded` takes ownership of the buffer as far as CanvasKit is
      // concerned, so coverage is read first.
      const coverage = readGlyphCoverage(bytes)
      if (coverage) coverages.push(coverage)
      registerFontCoverage('Inter', bytes)
      fontManager.markLoaded('Inter', style, bytes)
      styles.push(style)
    }

    fontManager.setHostFontLoader(async (family, style = 'Regular') => {
      if (family === 'Inter') {
        const file = Object.keys(FACES).find((key) => FACES[key] === style)
        if (file) return fetchFace(file)
      }
      return projectFontBytes(family, style)
    })

    await initializeFontLibrary()

    return { styles, coverage: coverages.length ? mergeCoverage(coverages) : EMPTY_COVERAGE }
  })()
  return seeded
}

/** Test seam: the module-level cache would otherwise leak between cases. */
export function resetSeededFonts(): void {
  seeded = null
}
