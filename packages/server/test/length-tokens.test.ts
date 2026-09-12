import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { buildSymbolTable } from '../src/symbols.js'

describe('length token bindings', () => {
  const tokens = {
    file: 'tokens.uidx',
    doc: parseOrThrow(
      `---\nid: tokens\n---\n## Visual Contract\n<Tokens><Collection name="scale" modes={['small', 'large']}><Variable name="base" type="FLOAT"><Mode name="small" value={1} /><Mode name="large" value="2rem" /></Variable><Variable name="alias" type="FLOAT"><Mode name="small" value="{scale#base}" /><Mode name="large" value="{scale#base}" /></Variable></Collection></Tokens>`,
    ),
  }
  const page = (prop: string) => ({
    file: 'page.uidx',
    doc: parseOrThrow(
      `---\nid: page\n---\n## Visual Contract\n<Page><Rectangle name="box" ${prop}="{scale#alias}" /></Page>`,
    ),
  })

  it('allows lengths through alias chains and modes on a dimension', () => {
    expect(buildSymbolTable([tokens, page('width')]).diagnostics).toEqual([])
  })

  it.each(['opacity', 'rotation', 'layoutGrow'])(
    'rejects a relative mode reaching unitless %s',
    (prop) => {
      expect(buildSymbolTable([tokens, page(prop)]).diagnostics).toEqual([
        expect.objectContaining({ code: 'UIDX205', severity: 'error', file: 'page.uidx' }),
      ])
    },
  )
})
