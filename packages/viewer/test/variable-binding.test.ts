import { describe, expect, it } from 'vitest'
import { parseOrThrow, type JsonValue } from '@uidx/format'
import { bindVariable, variableCandidates, variableTypeForControl } from '../src/variable-binding'

const TOKENS = new Map<string, JsonValue>([
  ['radius#md', 8],
  ['radius#lg', 16],
  ['palette#blue', { r: 0.1, g: 0.4, b: 0.9, a: 1 }],
  ['strings#label', 'Accept'],
  ['flags#on', true],
])

describe('variableCandidates', () => {
  it('filters by type and splits the address', () => {
    const floats = variableCandidates(TOKENS, undefined, 'FLOAT', null)
    expect(floats.map((c) => c.address)).toEqual(['radius#md', 'radius#lg'])
    expect(floats[0]).toMatchObject({ collection: 'radius', name: 'md', preview: '8' })
  })
  it('previews a color as its hex', () => {
    expect(variableCandidates(TOKENS, undefined, 'COLOR', null)[0]!.preview).toMatch(/^#/)
  })
  it('answers empty for no tokens or no type', () => {
    expect(variableCandidates(undefined, undefined, 'FLOAT', null)).toEqual([])
    expect(variableCandidates(TOKENS, undefined, null, null)).toEqual([])
  })
})

describe('variableTypeForControl', () => {
  it('maps the three bindable controls and nothing else', () => {
    expect(variableTypeForControl('number')).toBe('FLOAT')
    expect(variableTypeForControl('text')).toBe('STRING')
    expect(variableTypeForControl('boolean')).toBe('BOOLEAN')
    expect(variableTypeForControl('enum')).toBeNull()
    expect(variableTypeForControl('paint')).toBeNull()
  })
})

describe('bindVariable', () => {
  const DOC = parseOrThrow(`---
id: bind
---

## Visual Contract

<Page>
  <Component name="Card" status="draft">
    <Frame name="root" cornerRadius={4} width={10} height={10} />
  </Component>
</Page>
`)
  it('sets over an authored value and adds over an absent one', () => {
    expect(bindVariable(DOC, 'Card#root', 'cornerRadius', 'radius#md')).toEqual([
      { op: 'set', address: 'Card#root', prop: 'cornerRadius', value: '{radius#md}' },
    ])
    expect(bindVariable(DOC, 'Card#root', 'opacity', 'radius#md')).toEqual([
      { op: 'add', address: 'Card#root', prop: 'opacity', value: '{radius#md}' },
    ])
  })
  it('refuses an address that resolves to nothing', () => {
    expect(bindVariable(DOC, 'Card#nope', 'cornerRadius', 'radius#md')).toBeNull()
  })
})
