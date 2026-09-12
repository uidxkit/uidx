import { describe, expect, it } from 'vitest'
import {
  applyPatches,
  applyPatchesIncremental,
  fitsVariableType,
  parseOrThrow,
} from '../src/index.js'
import { convertLength, lengthToPx, parseLength, preserveLengthUnit } from '../src/lengths.js'

const page = (attrs: string) =>
  `---\nid: units\n---\n## Visual Contract\n<Page><Frame name="box" ${attrs} /></Page>`

describe('length values', () => {
  it('converts signed and fractional lengths without losing the chosen unit', () => {
    expect(lengthToPx('-0.25rem', 20)).toBe(-5)
    expect(convertLength(30, 'rem', 20)).toBe('1.5rem')
    expect(convertLength('1.5rem', 'px', 20)).toBe(30)
    expect(preserveLengthUnit(33, '2rem')).toBe('2.0625rem')
    expect(preserveLengthUnit(33, '32px')).toBe('33px')
  })

  it.each(['1em', '50%', 'calc(1rem + 2px)', 'Infinityrem', '1rem junk', ''])(
    'rejects unsupported or malformed length %s',
    (value) => {
      expect(parseLength(value)).toBeNull()
      expect(() => parseOrThrow(page(`width="${value}"`))).toThrow()
    },
  )

  it('keeps unit strings through parsing, patching and reopening', () => {
    const doc = parseOrThrow(page('width="20rem" paddingTop="8px"'))
    const result = applyPatches(doc.source, [
      { op: 'set', address: 'box', prop: 'width', value: '21.25rem' },
    ])
    expect(parseOrThrow(result.source).tree.children[0]!.attrs.width!.value).toBe('21.25rem')
    expect(result.source).toContain('paddingTop="8px"')
  })

  it('accepts relative FLOAT tokens in every mode and preserves explicit strings', () => {
    expect(fitsVariableType('1rem', 'FLOAT')).toBe(true)
    expect(fitsVariableType('1rem', 'STRING')).toBe(true)
    expect(fitsVariableType('1em', 'FLOAT')).toBe(false)
    expect(() =>
      parseOrThrow(
        `---\nid: units\n---\n## Visual Contract\n<Tokens><Collection name="space" modes={['compact', 'comfortable']}><Variable name="gap" type="FLOAT"><Mode name="compact" value="0.5rem" /><Mode name="comfortable" value="1rem" /></Variable></Collection></Tokens>`,
      ),
    ).not.toThrow()
  })

  it('requires a positive pixel root size and rejects units on ratios', () => {
    for (const value of ['0', '-1', '"1rem"']) {
      expect(() =>
        parseOrThrow(page('').replace('<Page>', `<Page rootFontSize={${value}}>`)),
      ).toThrow()
    }
    expect(() => parseOrThrow(page('opacity="1rem"'))).toThrow()
  })

  it('validates units on incremental edits without slowing valid attribute patches', () => {
    const doc = parseOrThrow(page('paddingTop={16}'))
    const changed = applyPatchesIncremental(doc, [
      { op: 'set', address: 'box', prop: 'paddingTop', value: '2rem' },
    ])
    expect(changed.fellBack).toBe(false)
    expect(changed.doc.tree.children[0]!.attrs.paddingTop!.value).toBe('2rem')
    for (const [prop, value] of [
      ['paddingLeft', '1em'],
      ['opacity', '1rem'],
      ['rootFontSize', 20],
    ] as const) {
      expect(() =>
        applyPatchesIncremental(doc, [{ op: 'add', address: 'box', prop, value }]),
      ).toThrow()
    }
  })
})
