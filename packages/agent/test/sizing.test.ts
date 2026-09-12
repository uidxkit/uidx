import { parse, type UidxDocument } from '@uidx/format'
import { describe, expect, it } from 'vitest'

import { fixedWithoutSize, fixedWithoutSizeNotice } from '../src/edit/sizing.js'

const page = (tree: string): UidxDocument => {
  const result = parse(`---\nid: p\n---\n\n## Visual Contract\n\n<Page>\n${tree}\n</Page>\n`)
  if (!result.doc) throw new Error(result.diagnostics.map((d) => d.message).join('; '))
  return result.doc
}

/**
 * Measured: every section of a real run carried counterAxisSizingMode="FIXED"
 * with no width anywhere, the engine fell back to hugging content, and the
 * page collapsed into a ~370px column — while every other audit passed.
 * "My width is fixed" with no width is a sentence missing its object.
 */
describe('fixedWithoutSize', () => {
  it('names a FIXED counter axis with no width, on a vertical layout', () => {
    const doc = page(
      '  <Frame name="sections" layoutMode="VERTICAL" counterAxisSizingMode="FIXED" />',
    )
    expect(fixedWithoutSize(doc)).toEqual([
      { address: 'sections', axis: 'counterAxisSizingMode', dimension: 'width' },
    ])
  })

  it('maps the axes the other way round for a horizontal layout', () => {
    const doc = page('  <Frame name="row" layoutMode="HORIZONTAL" counterAxisSizingMode="FIXED" />')
    expect(fixedWithoutSize(doc)).toEqual([
      { address: 'row', axis: 'counterAxisSizingMode', dimension: 'height' },
    ])
  })

  it('says nothing when the size is stated', () => {
    const doc = page(
      '  <Frame name="sections" layoutMode="VERTICAL" counterAxisSizingMode="FIXED" width={1440} />',
    )
    expect(fixedWithoutSize(doc)).toEqual([])
  })

  it('says nothing about AUTO, which asks for hugging on purpose', () => {
    const doc = page(
      '  <Frame name="sections" layoutMode="VERTICAL" counterAxisSizingMode="AUTO" primaryAxisSizingMode="AUTO" />',
    )
    expect(fixedWithoutSize(doc)).toEqual([])
  })

  // A node without a (valid) layout mode has no axes for the sizing props to
  // govern — whatever it meant, it is not this contradiction.
  it('says nothing without a layout mode to give the axes meaning', () => {
    expect(fixedWithoutSize(page('  <Frame name="a" counterAxisSizingMode="FIXED" />'))).toEqual([])
  })

  it('checks the primary axis too', () => {
    const doc = page('  <Frame name="col" layoutMode="VERTICAL" primaryAxisSizingMode="FIXED" />')
    expect(fixedWithoutSize(doc)).toEqual([
      { address: 'col', axis: 'primaryAxisSizingMode', dimension: 'height' },
    ])
  })
})

describe('fixedWithoutSizeNotice', () => {
  it('says nothing when every FIXED has its size', () => {
    expect(fixedWithoutSizeNotice(page('  <Frame name="a" width={10} />'))).toBe('')
  })

  it('states the contradiction and both ways out', () => {
    const doc = page(
      '  <Frame name="sections" layoutMode="VERTICAL" counterAxisSizingMode="FIXED" />',
    )
    expect(fixedWithoutSizeNotice(doc)).toBe(
      ' — but sections says counterAxisSizingMode="FIXED" but has no width: FIXED with no size falls back to hugging content and the layout collapses. State the width, or use "AUTO".',
    )
  })
})
