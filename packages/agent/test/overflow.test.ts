import { parse, type UidxDocument } from '@uidx/format'
import { describe, expect, it } from 'vitest'

import { overflowNotice, overflows } from '../src/edit/overflow.js'

const page = (tree: string): UidxDocument => {
  const result = parse(`---\nid: p\n---\n\n## Visual Contract\n\n<Page>\n${tree}\n</Page>\n`)
  if (!result.doc) throw new Error(result.diagnostics.map((d) => d.message).join('; '))
  return result.doc
}

/**
 * The defect this exists for, measured: Haiku 4.5 built a documentation page
 * whose `doc` frame was `width={1440}` with 72px of padding on each side, and
 * gave all twelve of its sections `width={1440}` too. Every section was 144px
 * wider than the space it had, so every section's text ran past its container.
 *
 * Nothing else in the harness could see it. It is not a stack — the sections
 * are laid out by their parent. It is not blankness — every frame is full. And
 * a half-scale render, which is what `review` shows, hides a 144px spill in a
 * 1440px page behind antialiasing.
 */
describe('overflows', () => {
  it('names a child wider than the space its parent leaves it', () => {
    const tree = [
      '  <Frame name="doc" width={1440} paddingLeft={72} paddingRight={72} layoutMode="VERTICAL">',
      '    <Frame name="cover" width={1440} layoutMode="VERTICAL" />',
      '  </Frame>',
    ].join('\n')
    expect(overflows(page(tree))).toEqual([{ address: 'doc#cover', width: 1440, inner: 1296 }])
  })

  it('says nothing when the child fits exactly', () => {
    const tree = [
      '  <Frame name="doc" width={1440} paddingLeft={72} paddingRight={72}>',
      '    <Frame name="cover" width={1296} />',
      '  </Frame>',
    ].join('\n')
    expect(overflows(page(tree))).toEqual([])
  })

  it('counts padding, so an unpadded parent gives its full width away', () => {
    const tree = [
      '  <Frame name="doc" width={100}>',
      '    <Frame name="a" width={100} />',
      '  </Frame>',
    ].join('\n')
    expect(overflows(page(tree))).toEqual([])
  })

  /**
   * Only what the author wrote down. A child with no width of its own is sized
   * by the layout engine or by its content, and guessing at that number would
   * be the rectangle-intersection mistake `overlaps` already learned from.
   */
  it('judges only widths that were authored, never ones it would have to infer', () => {
    const tree = [
      '  <Frame name="doc" width={100} paddingLeft={40} paddingRight={40}>',
      '    <Text name="t" characters="a very long line of text indeed" />',
      '  </Frame>',
    ].join('\n')
    expect(overflows(page(tree))).toEqual([])
  })

  it('says nothing about a parent whose own width was never stated', () => {
    const tree = [
      '  <Frame name="doc" layoutMode="VERTICAL">',
      '    <Frame name="a" width={9999} />',
      '  </Frame>',
    ].join('\n')
    expect(overflows(page(tree))).toEqual([])
  })

  /**
   * Measured before shipping, the same way `overlaps` was. An x-aware reading —
   * `x + width` against the inner box — found 8 collisions on Sonnet's clean
   * page and 1 in this repo's own `design/option-4`; a height reading found
   * one there too. Width alone found 0 across all 39 hand-authored pages here
   * and all 12 of Haiku's real defects. A rule that fires on a good page is a
   * rule that will be ignored.
   */
  it('ignores where a child sits, judging only how wide it is', () => {
    const tree = [
      '  <Frame name="doc" width={100} paddingLeft={10} paddingRight={10}>',
      '    <Frame name="a" x={60} width={80} />',
      '  </Frame>',
    ].join('\n')
    expect(overflows(page(tree))).toEqual([])
  })

  it('ignores height, which a container is entitled to grow past', () => {
    const tree = [
      '  <Frame name="doc" width={100} height={50} paddingTop={10} paddingBottom={10}>',
      '    <Frame name="a" width={100} height={400} />',
      '  </Frame>',
    ].join('\n')
    expect(overflows(page(tree))).toEqual([])
  })

  // `arrangeVariants` sizes and places these; their authored geometry is not
  // what the canvas draws. The same carve-out `overlaps` makes, for the same
  // reason.
  it('never judges a Component or the variants inside it', () => {
    const tree = [
      '  <Component name="C" variants={{ s: [\'a\'] }} width={10} paddingLeft={4} paddingRight={4}>',
      '    <Variant s="a"><Frame name="r" width={200} /></Variant>',
      '  </Component>',
    ].join('\n')
    expect(overflows(page(tree))).toEqual([])
  })

  it('finds every section of a page that made the same mistake', () => {
    const rows = Array.from({ length: 3 }, (_, i) => `    <Frame name="s${i}" width={200} />`)
    const tree = [
      '  <Frame name="doc" width={200} paddingLeft={20} paddingRight={20} layoutMode="VERTICAL">',
      ...rows,
      '  </Frame>',
    ].join('\n')
    expect(overflows(page(tree)).map((o) => o.address)).toEqual(['doc#s0', 'doc#s1', 'doc#s2'])
  })
})

describe('overflowNotice', () => {
  it('says nothing when everything fits', () => {
    expect(overflowNotice(page('  <Frame name="a" width={10} />'))).toBe('')
  })

  // The numbers are the point: 1440 into 1296 tells the model both that it is
  // wrong and by exactly how much, which "check your layout" does not.
  it('gives both numbers and names the arithmetic that fixes it', () => {
    const tree = [
      '  <Frame name="doc" width={1440} paddingLeft={72} paddingRight={72} layoutMode="VERTICAL">',
      '    <Frame name="cover" width={1440} />',
      '  </Frame>',
    ].join('\n')
    expect(overflowNotice(page(tree))).toBe(
      ' — but doc#cover is 1440 wide inside 1296 of space, so it overflows its parent: subtract the parent’s left and right padding from its width, or drop the child’s width and let the parent size it.',
    )
  })

  it('starts counting once too many have the same fault to name', () => {
    const rows = Array.from({ length: 5 }, (_, i) => `    <Frame name="s${i}" width={200} />`)
    const tree = [
      '  <Frame name="doc" width={200} paddingLeft={20} paddingRight={20} layoutMode="VERTICAL">',
      ...rows,
      '  </Frame>',
    ].join('\n')
    const notice = overflowNotice(page(tree))
    expect(notice).toContain('doc#s0 is 200 wide inside 160')
    expect(notice).toContain('(+2 more)')
  })
})
