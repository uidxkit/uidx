import { parse, type UidxDocument } from '@uidx/format'
import { describe, expect, it } from 'vitest'

import { overlapNotice, overlaps } from '../src/edit/overlaps.js'

const page = (tree: string): UidxDocument => {
  const result = parse(`---\nid: p\n---\n\n## Visual Contract\n\n<Page>\n${tree}\n</Page>\n`)
  if (!result.doc) throw new Error(result.diagnostics.map((d) => d.message).join('; '))
  return result.doc
}

/**
 * Deliberately narrow, and the narrowness is the point. A first version
 * compared rectangles and reported any intersection: 121 collisions on a page
 * that renders perfectly, and 90 more across this repo's hand-authored
 * designs — every one of them intentional layering, which is how design works.
 *
 * What cannot be intentional is omission. Two siblings with no x and no y are
 * stacked by default rather than by choice.
 */
describe('overlaps', () => {
  it('names siblings that were never given a position', () => {
    const tree = [
      '  <Frame name="states" width={1440} layoutMode="VERTICAL"><Text name="a" characters="x" /></Frame>',
      '  <Frame name="changelog" width={1440} layoutMode="VERTICAL"><Text name="b" characters="y" /></Frame>',
    ].join('\n')
    expect(overlaps(page(tree))).toEqual([['states', 'changelog']])
  })

  it('says nothing when they have been placed', () => {
    const tree = [
      '  <Frame name="a" x={0} y={0} width={200} height={100} />',
      '  <Frame name="b" x={0} y={200} width={200} height={100} />',
    ].join('\n')
    expect(overlaps(page(tree))).toEqual([])
  })

  // Layering is design: an outline over a row, a veil over a field, a halo
  // around a control. All of these appear in this repo's own pages.
  it('never judges a deliberate layer, however much it overlaps', () => {
    const tree = [
      '  <Frame name="row" x={0} y={0} width={200} height={100} />',
      '  <Frame name="veil" x={0} y={0} width={200} height={100} />',
    ].join('\n')
    expect(overlaps(page(tree))).toEqual([])
  })

  // A fill may not carry a layoutMode (UIDX131): the declared <Slot> in the
  // component lays the fill's children out, so unplaced siblings there are
  // placed by a node this audit cannot see. Measured on a real page: an
  // AppSubHeader instance whose actions fill held four nodes drew a correct
  // row and was reported six times.
  it('never judges the children of a slot fill', () => {
    const tree = [
      '  <Component name="Bar" x={0} y={0}>',
      '    <Frame name="bar" layoutMode="HORIZONTAL" width={400} height={48}>',
      '      <Slot name="actions" layoutMode="HORIZONTAL" itemSpacing={8}><Text name="d" characters="x" /></Slot>',
      '    </Frame>',
      '  </Component>',
      '  <Instance name="i" x={0} y={100} component="Bar">',
      '    <Slot name="actions"><Text name="a" characters="x" /><Text name="b" characters="y" /></Slot>',
      '  </Instance>',
    ].join('\n')
    expect(overlaps(page(tree))).toEqual([])
  })

  it('never judges children the parent lays out', () => {
    const tree = [
      '  <Frame name="doc" layoutMode="VERTICAL">',
      '    <Frame name="a" width={100}><Text name="t" characters="x" /></Frame>',
      '    <Frame name="b" width={100}><Text name="u" characters="y" /></Frame>',
      '  </Frame>',
    ].join('\n')
    expect(overlaps(page(tree))).toEqual([])
  })

  /**
   * The first version exempted Components on the assumption that "the canvas
   * places a definition beside the page." It does not — the canvas draws a
   * Component at its authored position, the *author* parks it beside the page
   * (the exemplar's checkbox Component carries x={1600}) — and a run that
   * left the position off drew its whole variant grid under the doc frame,
   * caught by a user's eye in the viewer where every audit stayed silent.
   */
  it('judges an unplaced page-level Component like any other sibling', () => {
    const tree = [
      "  <Component name=\"C\" variants={{ s: ['a', 'b'] }}>",
      '    <Variant s="a"><Frame name="r" width={10} height={10} /></Variant>',
      '    <Variant s="b"><Frame name="r" width={10} height={10} /></Variant>',
      '  </Component>',
      '  <Frame name="doc" width={100}><Text name="t" characters="x" /></Frame>',
    ].join('\n')
    expect(overlaps(page(tree))).toEqual([['C', 'doc']])
  })

  it('says nothing once the Component is parked beside the page, like the exemplar', () => {
    const tree = [
      "  <Component name=\"C\" x={1600} variants={{ s: ['a', 'b'] }}>",
      '    <Variant s="a"><Frame name="r" width={10} height={10} /></Variant>',
      '    <Variant s="b"><Frame name="r" width={10} height={10} /></Variant>',
      '  </Component>',
      '  <Frame name="doc" width={100}><Text name="t" characters="x" /></Frame>',
    ].join('\n')
    expect(overlaps(page(tree))).toEqual([])
  })

  // What stays exempt is the Component's *inside*: variants are
  // `arrangeVariants`' business, whatever their own geometry says.
  it('still never judges the variants inside a Component', () => {
    const tree = [
      "  <Component name=\"C\" x={1600} variants={{ s: ['a', 'b'] }}>",
      '    <Variant s="a"><Frame name="r" width={10} height={10} /></Variant>',
      '    <Variant s="b"><Frame name="r" width={10} height={10} /></Variant>',
      '  </Component>',
    ].join('\n')
    expect(overlaps(page(tree))).toEqual([])
  })

  it('says nothing about a node that draws nothing — that is another audit', () => {
    expect(overlaps(page('  <Frame name="a" />\n  <Frame name="b" />'))).toEqual([])
  })

  /**
   * Measured: a run wrote `layoutMode="vertical"`, the engine only knows
   * "VERTICAL", the layout pass ignored it, and the children stacked at the
   * origin — while this audit said nothing, because it took "has a
   * layoutMode" to mean "places its children". The value is what places them.
   */
  it('is not fooled by a layoutMode value the engine ignores', () => {
    const tree = [
      '  <Frame name="cover" layoutMode="vertical">',
      '    <Text name="a" characters="x" width={10} />',
      '    <Text name="b" characters="y" width={10} />',
      '  </Frame>',
    ].join('\n')
    expect(overlaps(page(tree))).toEqual([['cover#a', 'cover#b']])
  })

  it('knows NONE never placed anything either', () => {
    const tree = [
      '  <Frame name="board" layoutMode="NONE">',
      '    <Frame name="a" width={10} height={10} />',
      '    <Frame name="b" width={10} height={10} />',
      '  </Frame>',
    ].join('\n')
    expect(overlaps(page(tree))).toEqual([['board#a', 'board#b']])
  })

  it('reports each stacked sibling against the first, not every pair', () => {
    const tree = Array.from(
      { length: 4 },
      (_, i) => `  <Frame name="s${i}" width={100}><Text name="t${i}" characters="x" /></Frame>`,
    ).join('\n')
    expect(overlaps(page(tree))).toHaveLength(3)
  })
})

describe('overlapNotice', () => {
  it('says nothing when the page is fine', () => {
    expect(overlapNotice(page('  <Frame name="a" x={0} y={0} width={10} height={10} />'))).toBe('')
  })

  it('reads as a fact, and names both ways out', () => {
    const tree = [
      '  <Frame name="states" width={100}><Text name="a" characters="x" /></Frame>',
      '  <Frame name="changelog" width={100}><Text name="b" characters="y" /></Frame>',
    ].join('\n')
    expect(overlapNotice(page(tree))).toBe(
      ' — but states and changelog have no position, so they all draw from the same spot: give them x and y, or put them in a parent with layoutMode so it places them.',
    )
  })
})
