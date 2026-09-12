import { describe, expect, it } from 'vitest'
import { assetPathProblem, assetRefs, DEFAULT_ASSET_GLOBS } from '../src/index.js'
import { parseOrThrow } from '../src/index.js'

describe('where artwork is looked for by default', () => {
  it('is the conventional folders, not one of them', () => {
    // There is no single convention, and defaulting to one would make the
    // others a configuration step for something nobody configures.
    expect([...DEFAULT_ASSET_GLOBS]).toEqual(['assets/**', 'images/**', 'icons/**'])
  })
})

describe('assetPathProblem', () => {
  it('accepts an ordinary document-relative path', () => {
    expect(assetPathProblem('assets/hero.jpg')).toBeNull()
    expect(assetPathProblem('images/brand/logo-2026.png')).toBeNull()
  })

  it('refuses a URL rather than offering to fetch it', () => {
    for (const src of ['https://cdn.example.com/a.png', 'data:image/png;base64,AA', '//x/a.png']) {
      expect(assetPathProblem(src), src).toMatch(/URL/)
    }
  })

  it('refuses what would not travel with the document', () => {
    expect(assetPathProblem('/Users/me/logo.png')).toMatch(/absolute/)
    expect(assetPathProblem('../../Desktop/logo.png')).toMatch(/outside/)
    expect(assetPathProblem('assets\\logo.png')).toMatch(/backslash/)
  })

  it('says a missing src is missing rather than calling it malformed', () => {
    expect(assetPathProblem('')).toBe('an image needs a "src"')
  })

  it('does not mistake a dotted filename for a parent reference', () => {
    expect(assetPathProblem('assets/logo..v2.png')).toBeNull()
    expect(assetPathProblem('assets/..hidden.png')).toBeNull()
  })
})

const doc = (body: string) =>
  parseOrThrow(`---\nid: a\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`)

describe('assetRefs', () => {
  it('finds an image paint in a fill stack, wherever it sits', () => {
    const parsed = doc(`  <Rectangle name="hero"
    fills={[
      { type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } },
      { type: 'IMAGE', src: 'assets/hero.jpg', scaleMode: 'FILL' },
    ]} />`)
    expect(assetRefs(parsed)).toEqual([
      { address: 'hero', prop: 'fills', index: 1, src: 'assets/hero.jpg' },
    ])
  })

  it('does not scan strokes, where an image could never draw anyway', () => {
    const parsed = doc(
      `  <Rectangle name="r" strokes={[{ type: 'IMAGE', src: 'icons/edge.png' }]} />`,
    )
    expect(assetRefs(parsed)).toEqual([])
  })

  it('walks the whole tree, in document order', () => {
    const parsed = doc(`  <Frame name="outer" fills={[{ type: 'IMAGE', src: 'a.png' }]}>
    <Rectangle name="inner" fills={[{ type: 'IMAGE', src: 'b.png' }]} />
  </Frame>`)
    expect(assetRefs(parsed).map((r) => r.src)).toEqual(['a.png', 'b.png'])
  })

  it('ignores solids and gradients', () => {
    const parsed = doc(
      `  <Rectangle name="r" fills={[{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }]} />`,
    )
    expect(assetRefs(parsed)).toEqual([])
  })

  it('reports an image paint with no src, rather than skipping it', () => {
    // Skipping would let a paint that can never draw pass `uidx check`.
    const parsed = doc(`  <Rectangle name="r" fills={[{ type: 'IMAGE' }]} />`)
    expect(assetRefs(parsed)).toMatchObject([{ src: '' }])
  })
})
