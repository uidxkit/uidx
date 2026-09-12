import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { buildTokenIndex, type TokenIndex } from '../src/token-index.js'
import {
  defaultTuple,
  mergeModes,
  modeTupleKey,
  TokenResolver,
  tupleAt,
} from '../src/resolve-modes.js'

const doc = (body: string) => parseOrThrow(`---\nid: t\n---\n\n## Visual Contract\n\n${body}\n`)

const WHITE = { r: 1, g: 1, b: 1, a: 1 }
const BLACK = { r: 0, g: 0, b: 0, a: 1 }

export const DOCS = [
  doc(`<Tokens>
  <Collection name="palette" modes={['light', 'dark']}>
    <Variable name="bg" type="COLOR">
      <Mode name="light" value={{ r: 1, g: 1, b: 1, a: 1 }} />
      <Mode name="dark" value={{ r: 0, g: 0, b: 0, a: 1 }} />
    </Variable>
  </Collection>
  <Collection name="semantic">
    <Variable name="surface" type="COLOR" value="{palette#bg}" />
  </Collection>
</Tokens>`),
]

describe('TokenResolver (G8)', () => {
  const index = buildTokenIndex(DOCS)

  it('resolves the default tuple to the leftmost mode', () => {
    expect(new TokenResolver(index).resolve(defaultTuple(index)).get('palette#bg')).toEqual(WHITE)
  })

  it('follows an alias into whatever mode the target collection is in', () => {
    const resolver = new TokenResolver(index)
    const dark = mergeModes(defaultTuple(index), { palette: 'dark' }, index)
    // The alias lives in an unmoded collection but resolves through to a moded
    // one — which is why resolution is per-tuple rather than per-mode.
    expect(resolver.resolve(dark).get('semantic#surface')).toEqual(BLACK)
    expect(resolver.resolve(defaultTuple(index)).get('semantic#surface')).toEqual(WHITE)
  })

  it('keys a tuple stably regardless of insertion order', () => {
    const a = new Map([
      ['x', '1'],
      ['y', '2'],
    ])
    const b = new Map([
      ['y', '2'],
      ['x', '1'],
    ])
    expect(modeTupleKey(a)).toBe(modeTupleKey(b))
  })

  it('resolves once per distinct tuple, not once per call', () => {
    const resolver = new TokenResolver(index)
    const tuple = defaultTuple(index)
    resolver.resolve(tuple)
    resolver.resolve(tuple)
    resolver.resolve(tuple)
    expect(resolver.misses).toBe(1)
  })

  it('ignores an unknown collection or mode in an override', () => {
    const tuple = mergeModes(defaultTuple(index), { nope: 'x', palette: 'dusk' }, index)
    expect(tuple.get('nope')).toBeUndefined()
    expect(tuple.get('palette')).toBe('light')
  })

  it('returns the same tuple object when nothing changed', () => {
    // Identity matters: a fresh object per node would miss the cache every time.
    const base = defaultTuple(index)
    expect(mergeModes(base, { palette: 'light' }, index)).toBe(base)
  })

  it('leaves a cycle unresolved rather than hanging', () => {
    const cyclic = buildTokenIndex([
      doc(`<Tokens>
  <Collection name="c">
    <Variable name="a" type="FLOAT" value="{c#b}" />
    <Variable name="b" type="FLOAT" value="{c#a}" />
  </Collection>
</Tokens>`),
    ])
    expect(new TokenResolver(cyclic).resolve(defaultTuple(cyclic)).has('c#a')).toBe(false)
  })

  it('falls back to the default mode for a variable missing one', () => {
    // Built by hand rather than parsed: a file that omits a declared mode is
    // diagnostic UIDX127, so `parseOrThrow` refuses it — correctly. What is
    // under test is the resolver staying useful for a document that reached
    // memory another way, mid-patch or by import, so that it still draws.
    const partial: TokenIndex = {
      collections: new Map([['c', { name: 'c', modes: ['light', 'dark'] }]]),
      entries: new Map([
        [
          'c#v',
          {
            address: 'c#v',
            collection: 'c',
            name: 'v',
            type: 'FLOAT' as const,
            scopes: ['ALL_SCOPES' as const],
            description: '',
            deprecated: false,
            valuesByMode: { light: 8 },
          },
        ],
      ]),
    }
    const dark = mergeModes(defaultTuple(partial), { c: 'dark' }, partial)
    expect(new TokenResolver(partial).resolve(dark).get('c#v')).toBe(8)
  })
})

describe('tupleAt (G8)', () => {
  const index = buildTokenIndex(DOCS)
  const tree = parseOrThrow(`---
id: p
---

## Visual Contract

<Page>
  <Frame name="outer" modes={{ palette: 'dark' }}>
    <Frame name="inherits" />
  </Frame>
  <Frame name="plain" />
</Page>
`).tree

  it('accumulates a mode down to the address', () => {
    expect(tupleAt(tree, 'outer#inherits', index).get('palette')).toBe('dark')
  })

  it('leaves a sibling outside the subtree alone', () => {
    expect(tupleAt(tree, 'plain', index).get('palette')).toBe('light')
  })

  it('falls back to the default tuple for an address it cannot find', () => {
    expect(tupleAt(tree, 'nope', index).get('palette')).toBe('light')
  })
})
