import { parse, type UidxDocument } from '@uidx/format'
import { describe, expect, it } from 'vitest'

import { drawsNothing, drawsNothingNotice } from '../src/edit/draws-nothing.js'

const page = (tree: string): UidxDocument => {
  const result = parse(`---\nid: p\n---\n\n## Visual Contract\n\n<Page>\n${tree}\n</Page>\n`)
  if (!result.doc) throw new Error(result.diagnostics.map((d) => d.message).join('; '))
  return result.doc
}

/**
 * The quiet failure. A Frame with no size, no fill and no children is valid
 * uidx: it parses, it validates, `uidx check` reports zero errors, and the
 * page renders blank. A local model built thirteen of them, marked its plan
 * steps done, and reported success — and nothing in the loop disagreed,
 * because nothing was wrong in any way the harness could see.
 */
describe('drawsNothing', () => {
  it('names an empty frame, which is the shape a real run produced thirteen of', () => {
    expect(drawsNothing(page('  <Frame name="states" />'))).toEqual(['states'])
  })

  it('says nothing about a frame with a size', () => {
    expect(drawsNothing(page('  <Frame name="card" width={200} height={80} />'))).toEqual([])
  })

  it('says nothing about a frame with a fill', () => {
    const tree =
      '  <Frame name="card" fills={[{ type: \'SOLID\', color: { r: 1, g: 1, b: 1, a: 1 } }]} />'
    expect(drawsNothing(page(tree))).toEqual([])
  })

  it('counts an empty fills array as no fill, since it paints nothing', () => {
    expect(drawsNothing(page('  <Frame name="card" fills={[]} />'))).toEqual(['card'])
  })

  it('names a Text with nothing to say', () => {
    expect(drawsNothing(page('  <Text name="title" characters="" />'))).toEqual(['title'])
    expect(drawsNothing(page('  <Text name="title" />'))).toEqual(['title'])
    expect(drawsNothing(page('  <Text name="title" characters="Switch" />'))).toEqual([])
  })

  // Auto-layout sizes itself from what it holds, so a container is visible as
  // long as it has something visible to lay out.
  it('accepts a container that holds something visible', () => {
    const tree =
      '  <Frame name="doc" layoutMode="VERTICAL">\n    <Text name="t" characters="Hi" />\n  </Frame>'
    expect(drawsNothing(page(tree))).toEqual([])
  })

  it('names the container, not each child, when the whole subtree is blank', () => {
    const tree = '  <Frame name="doc">\n    <Frame name="a" />\n    <Frame name="b" />\n  </Frame>'
    expect(drawsNothing(page(tree))).toEqual(['doc'])
  })

  // A definition is drawn through instances of it, so judging it by its own
  // geometry would report every well-formed component in the document.
  it('says nothing about a Component or its Variants', () => {
    const tree = [
      "  <Component name=\"Control/Switch\" variants={{ checked: ['off', 'on'] }}>",
      '    <Variant checked="off">',
      '      <Frame name="row" width={40} height={24} />',
      '    </Variant>',
      '    <Variant checked="on">',
      '      <Frame name="row" width={40} height={24} />',
      '    </Variant>',
      '  </Component>',
    ].join('\n')
    expect(drawsNothing(page(tree))).toEqual([])
  })

  it('says nothing about an Instance, which draws its component', () => {
    const tree = [
      '  <Component name="C" variants={{ s: [\'a\'] }}>',
      '    <Variant s="a"><Frame name="r" width={10} height={10} /></Variant>',
      '  </Component>',
      '  <Instance name="use" component="C" />',
    ].join('\n')
    expect(drawsNothing(page(tree))).toEqual([])
  })
})

describe('drawsNothingNotice', () => {
  it('says nothing at all when the page is fine', () => {
    expect(drawsNothingNotice(page('  <Frame name="card" width={10} height={10} />'))).toBe('')
  })

  it('reads as a fact about what was built, not an instruction', () => {
    expect(drawsNothingNotice(page('  <Frame name="states" />'))).toBe(
      ' — but states draws nothing yet: give it a size, a fill, or children.',
    )
  })

  it('caps the list and counts the rest', () => {
    const tree = Array.from({ length: 9 }, (_, i) => `  <Frame name="s${i}" />`).join('\n')
    const notice = drawsNothingNotice(page(tree))
    expect(notice).toContain('(+5 more)')
    expect(notice).toContain('draw nothing yet')
  })

  /**
   * A real page put a `<Text characters="" />` in the corner of a state grid
   * as a spacer above the row labels. Auto-sized and wordless it took no width,
   * so every column header sat shifted left of the column it named. "Give it a
   * fill, or children" is no help to a text node; `width` was the fix.
   */
  it('tells a Text what a Text can actually be given', () => {
    expect(drawsNothingNotice(page('  <Text name="empty" characters="" />'))).toBe(
      ' — but empty draws nothing yet: an empty <Text> needs characters, or a width if it is meant as a spacer.',
    )
  })

  /**
   * A model followed that advice to the letter — `characters="" width={90}`
   * as a grid's corner cell — and was flagged anyway, because the audit had
   * never learned its own exception. The advice and the rule must agree.
   */
  it('honours its own advice: a wordless Text with a width is a spacer, not a fault', () => {
    expect(drawsNothingNotice(page('  <Text name="corner" characters="" width={90} />'))).toBe('')
  })

  it('names both ways out when a page has some of each', () => {
    const tree = ['  <Frame name="states" />', '  <Text name="empty" characters="" />'].join('\n')
    const notice = drawsNothingNotice(page(tree))
    expect(notice).toContain('give it a size, a fill, or children')
    expect(notice).toContain('an empty <Text> needs characters')
  })
})
