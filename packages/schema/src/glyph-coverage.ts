/**
 * Which codepoints a bundled font actually has glyphs for.
 *
 * The viewer ships one family. A `.uidx` file is plain text and nothing stops a
 * label saying `characters="日本語"`, at which point Inter has nothing to draw —
 * and the SDK's response to a text node whose font cannot cover it is to draw
 * *nothing*, silently (`renderText` returns early unless readiness is `ready`,
 * and a fallback that cannot resolve never gets there). The author sees an empty
 * box and no reason for it.
 *
 * So the viewer answers the question itself, from the font bytes it already
 * fetched. Reading the `cmap` is exact, needs no canvas, and — unlike anything
 * that observes the render — is testable in a plain Node process, which matters
 * while S1 leaves headless rendering unavailable.
 *
 * Only the coverage question is answered here. Shaping, ligatures and variation
 * selectors are the renderer's business; a codepoint in the `cmap` is the claim
 * "this font has a glyph for this character", which is precisely the claim whose
 * failure blanks the node.
 */

/** Inclusive codepoint range. */
type Range = readonly [start: number, end: number]

export interface GlyphCoverage {
  covers(codePoint: number): boolean
  /** Distinct characters of `text` with no glyph, in first-appearance order. */
  missing(text: string): string[]
  /** Codepoints covered, for tests and diagnostics. */
  readonly size: number
}

export const EMPTY_COVERAGE: GlyphCoverage = {
  covers: () => false,
  missing: (text) => [...new Set(text)],
  size: 0,
}

/**
 * Coverage of a TrueType/OpenType file.
 *
 * Returns null rather than throwing on a font this cannot read: a coverage check
 * is a diagnostic, and failing to produce one must never be louder than the
 * problem it was looking for.
 */
export function readGlyphCoverage(font: ArrayBuffer): GlyphCoverage | null {
  try {
    const ranges = readCmapRanges(new DataView(font))
    return ranges && ranges.length ? coverageOf(ranges) : null
  } catch {
    return null
  }
}

/** Union of several fonts — the family covers what any of its faces covers. */
export function mergeCoverage(parts: readonly GlyphCoverage[]): GlyphCoverage {
  const present = parts.filter((part) => part.size > 0)
  if (present.length === 0) return EMPTY_COVERAGE
  if (present.length === 1) return present[0]!
  return {
    covers: (codePoint) => present.some((part) => part.covers(codePoint)),
    missing(text) {
      return distinctCharacters(text).filter((char) => !this.covers(char.codePointAt(0)!))
    },
    size: Math.max(...present.map((part) => part.size)),
  }
}

function coverageOf(ranges: Range[]): GlyphCoverage {
  const sorted = mergeRanges(ranges)
  const size = sorted.reduce((total, [start, end]) => total + (end - start + 1), 0)
  const covers = (codePoint: number): boolean => {
    let lo = 0
    let hi = sorted.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const [start, end] = sorted[mid]!
      if (codePoint < start) hi = mid - 1
      else if (codePoint > end) lo = mid + 1
      else return true
    }
    return false
  }
  return {
    covers,
    missing: (text) => distinctCharacters(text).filter((char) => !covers(char.codePointAt(0)!)),
    size,
  }
}

/**
 * Iterates by codepoint, not code unit, so an astral character is one entry
 * rather than two lone surrogates — which would both report as missing and name
 * a character nobody typed.
 */
function distinctCharacters(text: string): string[] {
  const seen = new Set<string>()
  for (const char of text) {
    // Control characters are never drawn and never in a cmap; reporting them
    // would make every multi-line label look broken.
    const code = char.codePointAt(0)!
    if (code < 0x20 || code === 0x7f) continue
    seen.add(char)
  }
  return [...seen]
}

function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const out: Range[] = []
  for (const [start, end] of sorted) {
    const last = out[out.length - 1]
    if (last && start <= last[1] + 1) out[out.length - 1] = [last[0], Math.max(last[1], end)]
    else out.push([start, end])
  }
  return out
}

// ------------------------------------------------------------------ sfnt/cmap

const CMAP = 0x636d6170 // 'cmap'

function readCmapRanges(view: DataView): Range[] | null {
  const cmap = findTable(view, CMAP)
  if (cmap === null) return null

  const subtable = bestSubtable(view, cmap)
  if (subtable === null) return null

  const format = view.getUint16(subtable)
  if (format === 4) return readFormat4(view, subtable)
  if (format === 12) return readFormat12(view, subtable)
  if (format === 6) return readFormat6(view, subtable)
  return null
}

/** Offset of a table in an sfnt, handling the `ttcf` collection wrapper. */
function findTable(view: DataView, tag: number): number | null {
  let base = 0
  if (view.getUint32(0) === 0x74746366) base = view.getUint32(12) // 'ttcf' → first font
  const numTables = view.getUint16(base + 4)
  for (let i = 0; i < numTables; i++) {
    const record = base + 12 + i * 16
    if (view.getUint32(record) === tag) return view.getUint32(record + 8)
  }
  return null
}

/**
 * Picks the richest Unicode subtable: full-repertoire formats before the BMP
 * ones, so a font carrying both does not get read through its 16-bit table and
 * report every astral character as missing.
 */
function bestSubtable(view: DataView, cmap: number): number | null {
  const count = view.getUint16(cmap + 2)
  let best: number | null = null
  let bestScore = -1
  for (let i = 0; i < count; i++) {
    const record = cmap + 4 + i * 8
    const platform = view.getUint16(record)
    const encoding = view.getUint16(record + 2)
    const offset = cmap + view.getUint32(record + 4)
    const score = subtableScore(platform, encoding)
    if (score > bestScore) {
      bestScore = score
      best = offset
    }
  }
  return bestScore < 0 ? null : best
}

function subtableScore(platform: number, encoding: number): number {
  if (platform === 3 && encoding === 10) return 5 // Windows UCS-4
  if (platform === 0 && encoding >= 4) return 4 // Unicode full repertoire
  if (platform === 3 && encoding === 1) return 3 // Windows BMP
  if (platform === 0) return 2 // Unicode BMP
  return -1 // Mac Roman and friends: not Unicode, so not an answer
}

/** Segment-mapped BMP table. Glyph 0 means "no glyph", so it is not coverage. */
function readFormat4(view: DataView, at: number): Range[] {
  const segCount = view.getUint16(at + 6) / 2
  const endAt = at + 14
  const startAt = endAt + segCount * 2 + 2
  const deltaAt = startAt + segCount * 2
  const rangeOffsetAt = deltaAt + segCount * 2

  const ranges: Range[] = []
  for (let seg = 0; seg < segCount; seg++) {
    const end = view.getUint16(endAt + seg * 2)
    const start = view.getUint16(startAt + seg * 2)
    if (start > end || start === 0xffff) continue
    const delta = view.getUint16(deltaAt + seg * 2)
    const rangeOffset = view.getUint16(rangeOffsetAt + seg * 2)

    if (rangeOffset === 0) {
      // A whole segment mapped by addition. One code in it can still land on
      // glyph 0, but only by contrivance; treating the segment as covered is
      // both the common reading and the safe direction to be wrong in.
      ranges.push([start, end])
      continue
    }
    // Indexed through glyphIdArray: resolve per code, because a segment here is
    // routinely sparse and claiming all of it would hide real gaps.
    for (let code = start; code <= end; code++) {
      const glyphAt = rangeOffsetAt + seg * 2 + rangeOffset + (code - start) * 2
      if (glyphAt + 1 >= view.byteLength) break
      const glyph = view.getUint16(glyphAt)
      if (glyph !== 0 && ((glyph + delta) & 0xffff) !== 0) ranges.push([code, code])
    }
  }
  return ranges
}

/** Trimmed 16-bit table: a single contiguous run with per-code glyph ids. */
function readFormat6(view: DataView, at: number): Range[] {
  const first = view.getUint16(at + 6)
  const count = view.getUint16(at + 8)
  const ranges: Range[] = []
  for (let i = 0; i < count; i++) {
    if (view.getUint16(at + 10 + i * 2) !== 0) ranges.push([first + i, first + i])
  }
  return ranges
}

/** Segmented coverage, full Unicode range. */
function readFormat12(view: DataView, at: number): Range[] {
  const groups = view.getUint32(at + 12)
  const ranges: Range[] = []
  for (let i = 0; i < groups; i++) {
    const group = at + 16 + i * 12
    if (group + 12 > view.byteLength) break
    const start = view.getUint32(group)
    const end = view.getUint32(group + 4)
    const startGlyph = view.getUint32(group + 8)
    if (startGlyph === 0 && start === end) continue
    if (start <= end) ranges.push([start, end])
  }
  return ranges
}
