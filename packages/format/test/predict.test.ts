import { describe, expect, it } from 'vitest'
import { parseOrThrow, predictDocument, resolve } from '../src/index.js'

const DOC = parseOrThrow(`---
id: p
---

## Visual Contract

<Page>
  <Frame name="doc">
    <Rectangle name="cover" width={10} visible={true} />
    <Rectangle name="other" width={10} />
  </Frame>
</Page>
`)

const TOKENS = parseOrThrow(`---
id: t
---

## Visual Contract

<Tokens>
  <Collection name="c" modes={['a', 'b']}>
    <Variable name="v" type="FLOAT">
      <Mode name="a" value={1} />
      <Mode name="b" value={2} />
    </Variable>
  </Collection>
</Tokens>
`)

describe('predictDocument (spec §4)', () => {
  it('sets an attribute on the addressed node and nothing else', () => {
    const next = predictDocument(DOC, [
      { op: 'set', address: 'doc#cover', prop: 'visible', value: false },
    ])
    expect(next).not.toBe(DOC)
    expect(next.predicted).toBe(true)
    expect(resolve(next.tree, 'doc#cover')!.attrs.visible!.value).toBe(false)
    // Untouched subtrees are shared, so `===` still means "unchanged".
    expect(resolve(next.tree, 'doc#other')).toBe(resolve(DOC.tree, 'doc#other'))
    // The input is not mutated.
    expect(resolve(DOC.tree, 'doc#cover')!.attrs.visible!.value).toBe(true)
  })

  it('adds and removes attributes', () => {
    const next = predictDocument(DOC, [
      { op: 'add', address: 'doc#other', prop: 'visible', value: false },
      { op: 'remove', address: 'doc#cover', prop: 'width' },
    ])
    expect(resolve(next.tree, 'doc#other')!.attrs.visible!.value).toBe(false)
    expect(resolve(next.tree, 'doc#other')!.attrs.visible!.raw).toBe('{false}')
    expect(resolve(next.tree, 'doc#cover')!.attrs.width).toBeUndefined()
  })

  it('returns the same document for structural ops, missing addresses, and nothing', () => {
    expect(predictDocument(DOC, [{ op: 'remove-node', address: 'doc#cover' }])).toBe(DOC)
    expect(
      predictDocument(DOC, [{ op: 'set', address: 'doc#gone', prop: 'visible', value: false }]),
    ).toBe(DOC)
    expect(predictDocument(DOC, [])).toBe(DOC)
  })

  it('applies later patches over earlier ones', () => {
    const next = predictDocument(DOC, [
      { op: 'set', address: 'doc#cover', prop: 'width', value: 20 },
      { op: 'set', address: 'doc#cover', prop: 'width', value: 30 },
    ])
    expect(resolve(next.tree, 'doc#cover')!.attrs.width!.value).toBe(30)
  })

  it('predicts a mode value on a variable', () => {
    const variable = resolve(TOKENS.tree, 'c#v') ?? resolve(TOKENS.tree, 'c/v')
    expect(variable).not.toBeNull()
    const next = predictDocument(TOKENS, [
      { op: 'set-mode', address: variable!.address, mode: 'b', value: 9 },
    ])
    const after = resolve(next.tree, variable!.address)!
    expect(after.children.find((m) => m.attrs.name?.value === 'b')!.attrs.value!.value).toBe(9)
    expect(after.children.find((m) => m.attrs.name?.value === 'a')!.attrs.value!.value).toBe(1)
  })
})
