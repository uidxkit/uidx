import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { mergeCoverage, readGlyphCoverage, type GlyphCoverage } from '@uidx/schema'
import type { UidxDocument, UidxNode } from '@uidx/format'

/** How many nodes a notice names before it starts counting. */
const MAX_NAMED = 3

export interface MissingGlyphs {
  /** The text node, by address. */
  address: string
  /** The distinct characters Inter cannot draw, in first-appearance order. */
  chars: string[]
}

/**
 * The bundled Inter faces, read once and merged — the same four files
 * `render.ts` seeds the SDK's font manager with, resolved the same way.
 */
let coverage: Promise<GlyphCoverage | null> | null = null
function bundledCoverage(): Promise<GlyphCoverage | null> {
  coverage ??= (async () => {
    try {
      const require = createRequire(import.meta.url)
      const assets = join(dirname(require.resolve('@open-pencil/core/package.json')), 'assets')
      const parts: GlyphCoverage[] = []
      for (const face of ['Regular', 'Medium', 'SemiBold', 'Bold']) {
        const bytes = await readFile(join(assets, `Inter-${face}.ttf`))
        const read = readGlyphCoverage(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        )
        if (read) parts.push(read)
      }
      return parts.length > 0 ? mergeCoverage(parts) : null
    } catch {
      // A coverage check is a diagnostic; failing to produce one must never
      // be louder than the problem it was looking for.
      return null
    }
  })()
  return coverage
}

/**
 * Text nodes holding characters the bundled fonts cannot draw.
 *
 * Found by a user reading the viewer's diagnostics over a finished page: two
 * measurement labels wrote `⌀` (the diameter sign, U+2300), Inter has no glyph
 * for it, and the renderer draws *nothing* for a text it cannot cover — the
 * whole node, not just the character. uidx renders offline, so no web font can
 * fill the gap. Every audit in this harness was silent, because none of them
 * had ever asked "can the font actually draw these words?"
 *
 * The answer comes from the font's own cmap, via the same module the viewer's
 * diagnostic uses — moved into @uidx/schema so both read one truth. Exact, no
 * canvas, no guess.
 */
export async function missingGlyphs(doc: UidxDocument): Promise<MissingGlyphs[]> {
  const covers = await bundledCoverage()
  if (!covers) return []
  const found: MissingGlyphs[] = []
  const walk = (node: UidxNode): void => {
    if (node.element === 'Text') {
      const characters = node.attrs.characters?.value
      if (typeof characters === 'string') {
        const chars = covers.missing(characters)
        if (chars.length > 0) found.push({ address: node.address || '(page)', chars })
      }
    }
    for (const child of node.children) walk(child)
  }
  walk(doc.tree)
  return found
}

/** The audit as a sentence to append to a successful edit, or empty when every character draws. */
export async function missingGlyphsNotice(doc: UidxDocument): Promise<string> {
  const misses = await missingGlyphs(doc)
  if (misses.length === 0) return ''
  const named = misses
    .slice(0, MAX_NAMED)
    .map((m) => `${m.address} uses ${m.chars.map((c) => JSON.stringify(c)).join(' ')}`)
  const rest = misses.length - named.length
  const more = rest > 0 ? `, (+${rest} more)` : ''
  const subject = misses.length === 1 ? 'that node draws as nothing' : 'those nodes draw as nothing'
  return (
    ` — but ${named.join('; ')}${more}, which the bundled Inter faces have no glyph for, so ${subject}.` +
    ` Use characters Inter covers — Ø instead of ⌀, × instead of ✕, words instead of exotic symbols.`
  )
}

/** Test seam: the module-level cache would otherwise leak between cases. */
export function resetGlyphCoverage(): void {
  coverage = null
}
