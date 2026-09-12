import { parse, type UidxDocument } from '@uidx/format'
import { describe, expect, it } from 'vitest'

import { tokenFacts, tokenUse } from '../src/edit/token-use.js'

const doc = (body: string, id = 'p'): UidxDocument => {
  const result = parse(`---\nid: ${id}\n---\n\n## Visual Contract\n\n${body}\n`)
  if (!result.doc) throw new Error(result.diagnostics.map((d) => d.message).join('; '))
  return result.doc
}

const TOKENS = doc(
  [
    '<Tokens>',
    '  <Collection name="radius">',
    '    <Variable name="md" type="FLOAT" value={10} />',
    '  </Collection>',
    '  <Collection name="space">',
    '    <Variable name="md" type="FLOAT" value={16} />',
    '  </Collection>',
    '  <Collection name="palette">',
    '    <Variable name="blue" type="COLOR" value={{ r: 0, g: 0.4, b: 1, a: 1 }} />',
    '  </Collection>',
    '</Tokens>',
  ].join('\n'),
  'tokens',
)

const page = (tree: string): UidxDocument => doc(`<Page>\n${tree}\n</Page>`)

/**
 * Counted rather than judged, and that distinction was measured. Two audits
 * that accuse — "this literal equals a token you could have bound" — were
 * tried first against this repo's 39 hand-authored pages. The wide one fired
 * 340 times on `design/option-4` alone, matching a `fontSize` against a radius.
 * The narrow one, restricted to props the document itself binds elsewhere,
 * still fired 22-27 times per design and, worse, scored the *worst* of three
 * real model runs at zero while scoring both clean runs at 13 and 28: it
 * punishes a page for binding tokens at all.
 *
 * What survives is arithmetic with no claim about intent. A page either
 * references a collection or it does not, and saying which is never wrong.
 */
describe('tokenUse', () => {
  it('counts a reference written as a whole prop value', () => {
    const use = tokenUse(
      [TOKENS],
      page('  <Frame name="a" cornerRadius="{radius#md}" width={10} />'),
    )
    expect(use.references).toBe(1)
    expect(use.used).toEqual(['radius'])
  })

  // How every colour in this repo's designs is bound: the alias sits on the
  // `color` of a paint, not on `fills` itself. `to-scene` resolves it there,
  // so an audit that missed it would report a page as unbound that is not.
  it('counts a reference bound inside a paint', () => {
    const use = tokenUse(
      [TOKENS],
      page("  <Frame name=\"a\" fills={[{ type: 'SOLID', color: '{palette#blue}' }]} />"),
    )
    expect(use.references).toBe(1)
    expect(use.used).toEqual(['palette'])
  })

  it('names every declared collection the page never reaches for', () => {
    const use = tokenUse([TOKENS], page('  <Frame name="a" cornerRadius="{radius#md}" />'))
    expect(use.declared).toEqual(['radius', 'space', 'palette'])
    expect(use.unused).toEqual(['space', 'palette'])
  })

  it('reports nothing declared when the document has no tokens at all', () => {
    const use = tokenUse([], page('  <Frame name="a" width={10} />'))
    expect(use).toEqual({ references: 0, declared: [], used: [], unused: [] })
  })

  // Prose is not a binding. A page that merely writes the words "{radius#md}"
  // in a caption has bound nothing.
  it('does not count a token address quoted in body text', () => {
    const use = tokenUse([TOKENS], page('  <Text name="t" characters="bind it to {radius#md}" />'))
    expect(use.references).toBe(0)
  })

  it('counts each reference, so a page that binds one token ten times says ten', () => {
    const tree = Array.from(
      { length: 3 },
      (_, i) => `  <Frame name="a${i}" cornerRadius="{radius#md}" />`,
    ).join('\n')
    expect(tokenUse([TOKENS], page(tree)).references).toBe(3)
  })
})

describe('tokenFacts', () => {
  it('says nothing at all when the document declares no tokens', () => {
    expect(tokenFacts([], page('  <Frame name="a" width={10} />'))).toBeNull()
  })

  it('states the count and names what is going unused', () => {
    expect(tokenFacts([TOKENS], page('  <Frame name="a" cornerRadius="{radius#md}" />'))).toBe(
      '- binds 1 token; space and palette are declared and this page never uses them.',
    )
  })

  // The shape the real run produced: 42 bindings, all to `radius`, with the
  // whole `space` scale untouched and every gap in the page typed as a number.
  it('reads as English when exactly one scale is going unused', () => {
    const tree = [
      '  <Frame name="a" cornerRadius="{radius#md}" itemSpacing={16}',
      "    fills={[{ type: 'SOLID', color: '{palette#blue}' }]} />",
    ].join('\n')
    expect(tokenFacts([TOKENS], page(tree))).toBe(
      '- binds 2 tokens; space is declared and this page never uses it.',
    )
  })

  it('says so plainly when every scale is in play', () => {
    const tree = [
      '  <Frame name="a" cornerRadius="{radius#md}" itemSpacing="{space#md}"',
      "    fills={[{ type: 'SOLID', color: '{palette#blue}' }]} />",
    ].join('\n')
    expect(tokenFacts([TOKENS], page(tree))).toBe(
      '- binds 3 tokens, across every collection declared.',
    )
  })

  // The page that prompted this bound 14 tokens and left the whole `space`
  // scale untouched, hardcoding every gap and pad in it.
  it('calls out a page that hardcodes rather than binds', () => {
    expect(
      tokenFacts([TOKENS], page('  <Frame name="a" cornerRadius={10} itemSpacing={16} />')),
    ).toBe('- binds no tokens at all, though radius, space and palette are declared.')
  })
})
