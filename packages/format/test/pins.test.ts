import { describe, expect, it } from 'vitest'
import { parse } from '../src/index.js'
import { CODES } from '../src/diagnostics.js'

/**
 * What a pin may say, and where (ADR 0011 §2 and §6).
 *
 * The rule the whole file turns on: a pin answers a question, so the file may
 * not answer it a second time. `right` under a MAX pin is the author's; `x`
 * under one is the resolver's, and a file stating both has two answers that
 * can disagree the moment the parent is resized.
 */

const CARD = (child: string, frame = 'width={320} height={200}'): string =>
  [
    '---',
    'id: card',
    '---',
    '',
    '## Visual Contract',
    '',
    '<Page>',
    '  <Component name="Card">',
    `    <Frame name="body" ${frame}>`,
    child,
    '    </Frame>',
    '  </Component>',
    '</Page>',
    '',
  ].join('\n')

const codes = (source: string): string[] => parse(source).diagnostics.map((d) => d.code)

describe('pins (ADR 0011)', () => {
  it('accepts a right-pinned child', () => {
    expect(
      codes(CARD(`      <Text name="a" right={16} constraints={{ horizontal: 'MAX' }} />`)),
    ).toEqual([])
  })

  it('accepts an unpinned child, which is every file written before H1', () => {
    expect(codes(CARD(`      <Text name="a" x={16} y={16} />`))).toEqual([])
  })

  it('refuses x under a MAX pin — the coordinate is the resolver’s', () => {
    const found = parse(
      CARD(`      <Text name="a" x={16} right={16} constraints={{ horizontal: 'MAX' }} />`),
    ).diagnostics
    expect(found.map((d) => d.code)).toEqual([CODES.PIN_GEOMETRY_CONFLICT])
    expect(found[0]!.message).toMatch(/"x" is computed under a MAX pin/)
  })

  it('refuses width under a STRETCH pin', () => {
    expect(
      codes(
        CARD(
          `      <Text name="a" x={8} right={8} width={100} constraints={{ horizontal: 'STRETCH' }} />`,
        ),
      ),
    ).toEqual([CODES.PIN_GEOMETRY_CONFLICT])
  })

  it('refuses right under a MIN pin, which is the default', () => {
    expect(codes(CARD(`      <Text name="a" right={16} />`))).toEqual([CODES.PIN_GEOMETRY_CONFLICT])
  })

  it('allows a missing offset — it defaults to 0', () => {
    expect(codes(CARD(`      <Text name="a" constraints={{ horizontal: 'MAX' }} />`))).toEqual([])
  })

  it('checks the two axes independently', () => {
    // Horizontal is a legal MAX pin; vertical states a bottom under MIN.
    expect(
      codes(
        CARD(`      <Text name="a" right={16} bottom={8} constraints={{ horizontal: 'MAX' }} />`),
      ),
    ).toEqual([CODES.PIN_GEOMETRY_CONFLICT])
  })

  it('refuses a pin on a child its parent flows', () => {
    const found = parse(
      CARD(
        `      <Text name="a" right={16} constraints={{ horizontal: 'MAX' }} />`,
        'layoutMode="VERTICAL"',
      ),
    ).diagnostics
    expect(found.map((d) => d.code)).toEqual([CODES.PIN_NOT_ALLOWED_HERE])
    expect(found[0]!.message).toMatch(/layoutPositioning="ABSOLUTE"/)
  })

  it('allows a pin on an absolutely positioned child of a flowing parent', () => {
    expect(
      codes(
        CARD(
          `      <Text name="a" right={16} layoutPositioning="ABSOLUTE" constraints={{ horizontal: 'MAX' }} />`,
          'layoutMode="VERTICAL"',
        ),
      ),
    ).toEqual([])
  })

  it('refuses a pin on a page’s own child — there is no box to pin to', () => {
    const source = [
      '---',
      'id: card',
      '---',
      '',
      '## Visual Contract',
      '',
      '<Page>',
      `  <Component name="Card" right={16} constraints={{ horizontal: 'MAX' }} />`,
      '</Page>',
      '',
    ].join('\n')
    const found = parse(source).diagnostics
    expect(found.map((d) => d.code)).toEqual([CODES.PIN_NOT_ALLOWED_HERE])
    expect(found[0]!.message).toMatch(/a page is not one/)
  })

  it('refuses SCALE, and says what to use instead', () => {
    const found = parse(
      CARD(`      <Text name="a" constraints={{ horizontal: 'SCALE' }} />`),
    ).diagnostics
    expect(found.map((d) => d.code)).toEqual([CODES.PIN_SCALE_UNSUPPORTED])
    expect(found[0]!.message).toMatch(/STRETCH/)
  })
})
