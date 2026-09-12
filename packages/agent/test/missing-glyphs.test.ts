import { parse, type UidxDocument } from '@uidx/format'
import { describe, expect, it } from 'vitest'

import { missingGlyphs, missingGlyphsNotice } from '../src/edit/missing-glyphs.js'

const page = (tree: string): UidxDocument => {
  const result = parse(`---\nid: p\n---\n\n## Visual Contract\n\n<Page>\n${tree}\n</Page>\n`)
  if (!result.doc) throw new Error(result.diagnostics.map((d) => d.message).join('; '))
  return result.doc
}

/**
 * Found by a user reading the viewer's diagnostics over a finished page: two
 * measurement labels wrote ⌀ (U+2300), Inter has no glyph, and the renderer
 * draws nothing for the whole node — while every harness audit stayed silent,
 * because none had ever asked "can the font draw these words?" Answered from
 * the real bundled faces, through the same module the viewer's diagnostic
 * uses.
 */
describe('missingGlyphs', () => {
  it('names the node and the exact characters Inter cannot draw', async () => {
    const found = await missingGlyphs(page('  <Text name="d" characters="⌀ 28 px" />'))
    expect(found).toEqual([{ address: 'd', chars: ['⌀'] }])
  })

  it('stays silent over everything a documentation page ordinarily says', async () => {
    const ordinary =
      'Switch — on/off, 44×24 px, radius Ø 12; “quotes”, dashes – —, arrows ← →, bullets •, checks ✓'
    expect(
      await missingGlyphs(page(`  <Text name="t" characters=${JSON.stringify(ordinary)} />`)),
    ).toEqual([])
  })

  it('walks the whole tree, variants included', async () => {
    const tree = [
      "  <Component name=\"C\" x={1600} variants={{ s: ['a', 'b'] }}>",
      '    <Variant s="a"><Frame name="r"><Text name="bad" characters="⌀" /></Frame></Variant>',
      '    <Variant s="b"><Frame name="r" width={10} /></Variant>',
      '  </Component>',
    ].join('\n')
    expect(await missingGlyphs(page(tree))).toHaveLength(1)
  })
})

describe('missingGlyphsNotice', () => {
  it('says nothing when every character draws', async () => {
    expect(await missingGlyphsNotice(page('  <Text name="t" characters="Switch" />'))).toBe('')
  })

  it('names the character, the consequence, and a substitution that draws', async () => {
    const notice = await missingGlyphsNotice(page('  <Text name="d" characters="⌀ 28" />'))
    expect(notice).toContain('d uses "⌀"')
    expect(notice).toContain('no glyph')
    expect(notice).toContain('draws as nothing')
    expect(notice).toContain('Ø instead of ⌀')
  })
})
