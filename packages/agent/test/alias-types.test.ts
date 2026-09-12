import { parse, type UidxDocument } from '@uidx/format'
import { describe, expect, it } from 'vitest'

import { badAliasNotice, badAliases } from '../src/edit/alias-types.js'

const doc = (body: string, id = 'p'): UidxDocument => {
  const result = parse(`---\nid: ${id}\n---\n\n## Visual Contract\n\n${body}\n`)
  if (!result.doc) throw new Error(result.diagnostics.map((d) => d.message).join('; '))
  return result.doc
}

const TOKENS = doc(
  [
    '<Tokens>',
    '  <Collection name="radius">',
    '    <Variable name="pill" type="FLOAT" value={999} />',
    '  </Collection>',
    '  <Collection name="copy">',
    '    <Variable name="cta" type="STRING" value="Save changes" />',
    '  </Collection>',
    '</Tokens>',
  ].join('\n'),
  'tokens',
)

const page = (tree: string): UidxDocument => doc(`<Page>\n${tree}\n</Page>`)

/**
 * Measured on a real run, and fatal. Asked to document a Switch's measurements,
 * Haiku 4.5 wrote `<Text characters="{radius#pill}" />` to show the token's
 * value in a spec table. An alias is *substituted* for its value, so
 * `characters` became the number 999 — and the SDK's font pass iterates a text
 * node's string to collect the glyphs it needs. A number is not iterable, so
 * the pass threw and **the whole page stopped rendering**, not just that node.
 *
 * Everything else said it was fine: it parses, `uidx check` reported "2 files
 * OK", and every audit in this harness returned clean. This is precisely the
 * family the audits exist for — valid uidx, zero errors, nothing on screen.
 */
describe('badAliases', () => {
  it('names a numeric token bound where a string belongs', () => {
    const found = badAliases([TOKENS], page('  <Text name="v" characters="{radius#pill}" />'))
    expect(found).toEqual([{ address: 'v', prop: 'characters', target: 'radius#pill', got: 999 }])
  })

  it('allows a token that really does hold a string', () => {
    expect(badAliases([TOKENS], page('  <Text name="v" characters="{copy#cta}" />'))).toEqual([])
  })

  // A component prop binding has no `#`, is resolved by the instance rather
  // than by the token index, and is exactly how a label reaches a variant.
  it('never touches a prop binding, which is not a token at all', () => {
    expect(badAliases([TOKENS], page('  <Text name="v" characters="{label}" />'))).toEqual([])
  })

  it('leaves a number bound to a number alone', () => {
    expect(badAliases([TOKENS], page('  <Frame name="f" cornerRadius="{radius#pill}" />'))).toEqual(
      [],
    )
  })

  // An alias pointing nowhere is `uidx check`'s to report, and guessing at its
  // type here would be inventing a fault.
  it('says nothing about an alias that resolves to nothing', () => {
    expect(badAliases([TOKENS], page('  <Text name="v" characters="{ghost#x}" />'))).toEqual([])
  })

  it('finds every one of them, not just the first', () => {
    const tree = [
      '  <Text name="a" characters="{radius#pill}" />',
      '  <Text name="b" characters="{radius#pill}" />',
    ].join('\n')
    expect(badAliases([TOKENS], page(tree))).toHaveLength(2)
  })
})

describe('badAliasNotice', () => {
  it('says nothing when every alias lands where it fits', () => {
    expect(badAliasNotice([TOKENS], page('  <Text name="v" characters="Switch" />'))).toBe('')
  })

  // It has to say what happens, because "type mismatch" does not convey that
  // the page is now blank.
  it('names the value, the consequence, and the way to write it instead', () => {
    expect(badAliasNotice([TOKENS], page('  <Text name="v" characters="{radius#pill}" />'))).toBe(
      ' — but v binds radius#pill into characters, which resolves to 999, not text:' +
        ' the whole page stops rendering. Type the value instead, e.g. characters="999 (radius#pill)".',
    )
  })
})
