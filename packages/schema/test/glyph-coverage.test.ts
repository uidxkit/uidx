import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EMPTY_COVERAGE, mergeCoverage, readGlyphCoverage } from '../src/glyph-coverage.js'

/**
 * Read against the actual faces the viewer ships, not a synthetic font.
 *
 * The whole point of this module is to answer "can Inter draw this?" for the
 * bytes in `public/fonts`, and a hand-built fixture would only prove the cmap
 * reader agrees with itself. `postinstall` puts these there; they are gitignored
 * copies of an installed dependency.
 */
// The faces live where the viewer's postinstall puts them; this module moved
// to schema (so the agent can share it) but the bytes it answers for did not.
const face = (name: string): string =>
  resolve(process.cwd(), '..', 'viewer', 'public/fonts', `Inter-${name}.ttf`)

async function coverageOf(name: string) {
  const bytes = await readFile(face(name))
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return readGlyphCoverage(buffer as ArrayBuffer)
}

describe('glyph coverage', () => {
  it('reads the bundled Inter cmap', async () => {
    const inter = await coverageOf('Regular')
    expect(inter).not.toBeNull()
    // A Latin text face carries at least the basic multilingual essentials.
    expect(inter!.size).toBeGreaterThan(200)
  })

  it('covers the characters a design file actually uses', async () => {
    const inter = (await coverageOf('Regular'))!
    expect(inter.missing('Click Me')).toEqual([])
    expect(inter.missing('Save & Continue — 100%')).toEqual([])
  })

  it('reports what Inter cannot draw', async () => {
    const inter = (await coverageOf('Regular'))!
    // The failure this whole module exists for: a label the renderer answers
    // with a blank box and no explanation.
    expect(inter.missing('日本語')).toEqual(['日', '本', '語'])
  })

  it('reports each missing character once, in order', async () => {
    const inter = (await coverageOf('Regular'))!
    expect(inter.missing('語語語')).toEqual(['語'])
  })

  it('counts an astral character as one character, not two surrogates', async () => {
    const inter = (await coverageOf('Regular'))!
    const missing = inter.missing('ok 🎉')
    // Whatever the verdict, it must never be a pair of lone surrogates naming a
    // character nobody typed.
    for (const char of missing) expect([...char]).toHaveLength(1)
    expect(missing.every((char) => char.codePointAt(0)! > 0xffff || char === '🎉')).toBe(true)
  })

  it('ignores control characters', async () => {
    const inter = (await coverageOf('Regular'))!
    expect(inter.missing('two\nlines\tapart')).toEqual([])
  })

  it('merges faces, since the family covers what any face covers', async () => {
    const regular = (await coverageOf('Regular'))!
    const bold = (await coverageOf('Bold'))!
    const merged = mergeCoverage([regular, bold])
    expect(merged.missing('Click Me')).toEqual([])
    expect(merged.covers('A'.codePointAt(0)!)).toBe(true)
  })

  it('refuses bytes that are not a font rather than throwing', () => {
    expect(readGlyphCoverage(new TextEncoder().encode('not a font').buffer)).toBeNull()
    expect(readGlyphCoverage(new ArrayBuffer(0))).toBeNull()
  })

  /**
   * With no readable font, every character reads as missing — which would put a
   * warning about every label on screen. The seeding path treats "no coverage"
   * as "do not report", and this pins the shape that rests on.
   */
  it('has an empty coverage whose size is zero', () => {
    expect(EMPTY_COVERAGE.size).toBe(0)
    expect(mergeCoverage([EMPTY_COVERAGE, EMPTY_COVERAGE]).size).toBe(0)
  })
})
