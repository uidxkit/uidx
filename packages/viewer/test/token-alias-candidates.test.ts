import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { buildTokenIndex, TokenResolver } from '@uidx/schema'
import { tokenAliasCandidates } from '../src/token-alias-candidates'

const document = parseOrThrow(`---
id: tokens
---

## Visual Contract

<Tokens>
  <Collection name="palette" modes={['light', 'dark']}>
    <Variable name="ink" type="COLOR"><Mode name="light" value={{r: 0, g: 0, b: 0, a: 1}} /><Mode name="dark" value={{r: 1, g: 1, b: 1, a: 1}} /></Variable>
  </Collection>
  <Collection name="semantic" modes={['light', 'dark']}>
    <Variable name="text" type="COLOR"><Mode name="light" value="{palette#ink}" /><Mode name="dark" value="{palette#ink}" /></Variable>
  </Collection>
  <Collection name="other">
    <Variable name="old" type="COLOR" deprecated={true} value={{r: 0, g: 0, b: 0, a: 1}} />
    <Variable name="broken" type="COLOR" value="{missing#color}" />
    <Variable name="dependent" type="COLOR" value="{semantic#text}" />
    <Variable name="number" type="FLOAT" value={8} />
  </Collection>
</Tokens>`)
const index = buildTokenIndex([document])
const resolver = new TokenResolver(index)

describe('token alias candidates', () => {
  it('previews the edited mode and groups candidates by collection', () => {
    const dark = tokenAliasCandidates(index, resolver, 'COLOR', 'semantic#text', 'dark')
    const light = tokenAliasCandidates(index, resolver, 'COLOR', 'semantic#text', 'light')
    expect(dark[0]).toMatchObject({
      address: 'palette#ink',
      collection: 'palette',
      value: { r: 1, g: 1, b: 1, a: 1 },
    })
    expect(light[0]).toMatchObject({ value: { r: 0, g: 0, b: 0, a: 1 } })
  })

  it('excludes self, dependents, deprecated, unresolved, and incompatible tokens', () => {
    expect(
      tokenAliasCandidates(index, resolver, 'COLOR', 'semantic#text', 'dark').map(
        (item) => item.address,
      ),
    ).toEqual(['palette#ink'])
  })
})
