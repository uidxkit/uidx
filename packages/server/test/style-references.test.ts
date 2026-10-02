import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { buildSymbolTable } from '../src/symbols.js'

const tokens = {
  file: 'tokens.uidx',
  doc: parseOrThrow(`---
id: tokens
---

## Visual Contract

<Tokens>
  <Collection name="surface">
    <Variable name="accent" type="COLOR" value={{ r: 0, g: 0.5, b: 1, a: 1 }} />
  </Collection>
</Tokens>
`),
}

const button = (cell: string) => ({
  file: 'button.uidx',
  doc: parseOrThrow(`---
id: button
---

## Visual Contract

<Page>
  <Component name="Button" fills="{surface#accent}" width={80} height={32} />
</Page>

<Styles>
  <Style state="hover" root:fills="${cell}" />
</Styles>
`),
})

describe('styles-table cells are references (ADR 0016 §2)', () => {
  it('reports a cell aliasing a token nobody declares', () => {
    const found = buildSymbolTable([tokens, button('{surface#accentHover}')]).diagnostics
    expect(found.map((d) => [d.code, d.file])).toEqual([['UIDX401', 'button.uidx']])
    expect(found[0]!.message).toContain('surface#accentHover')
  })

  it('accepts a cell aliasing a declared token', () => {
    expect(buildSymbolTable([tokens, button('{surface#accent}')]).diagnostics).toEqual([])
  })
})
