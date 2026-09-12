import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { buildTokenIndex, IMPLICIT_MODE } from '@uidx/schema'

import { addCollectionPatch, addTokenPatch, aliasTargets, editCellPatch } from '../src/token-edits'

const CORE = parseOrThrow(`---
id: core
---

## Visual Contract

<Tokens>
  <Collection name="palette">
    <Variable name="blue-500" type="COLOR" value={{ r: 0.1, g: 0.4, b: 0.9, a: 1 }} />
    <Variable name="stale" type="COLOR" value={{ r: 0.5, g: 0.5, b: 0.5, a: 1 }} deprecated={true} />
    <Variable name="depth" type="FLOAT" value={2} />
  </Collection>
  <Collection name="semantic" modes={['light', 'dark']}>
    <Variable name="brand" type="COLOR">
      <Mode name="light" value="{palette#blue-500}" />
      <Mode name="dark" value={{ r: 1, g: 1, b: 1, a: 1 }} />
    </Variable>
  </Collection>
  <Collection name="loop">
    <Variable name="a" type="FLOAT" value="{loop#b}" />
    <Variable name="b" type="FLOAT" value={7} />
  </Collection>
</Tokens>`)

const index = () => buildTokenIndex([CORE])

describe('editCellPatch', () => {
  it('writes a single-mode value as one set on the variable', () => {
    const result = editCellPatch({
      index: index(),
      row: { address: 'palette#depth', type: 'FLOAT', file: 'core.uidx' },
      mode: IMPLICIT_MODE,
      value: 12,
    })
    expect(result).toEqual({
      file: 'core.uidx',
      patches: [{ op: 'set', address: 'palette#depth', prop: 'value', value: 12 }],
    })
  })

  it('writes a moded value as one set-mode', () => {
    const result = editCellPatch({
      index: index(),
      row: { address: 'semantic#brand', type: 'COLOR', file: 'core.uidx' },
      mode: 'dark',
      value: { r: 0, g: 0, b: 0, a: 1 },
    })
    expect(result).toEqual({
      file: 'core.uidx',
      patches: [
        {
          op: 'set-mode',
          address: 'semantic#brand',
          mode: 'dark',
          value: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    })
  })

  it('accepts an alias whose target fits the type', () => {
    const result = editCellPatch({
      index: index(),
      row: { address: 'semantic#brand', type: 'COLOR', file: 'core.uidx' },
      mode: 'light',
      value: '{palette#blue-500}',
    })
    expect('patches' in result && result.patches).toHaveLength(1)
  })

  it('refuses an alias to a token of another type, naming both', () => {
    const result = editCellPatch({
      index: index(),
      row: { address: 'semantic#brand', type: 'COLOR', file: 'core.uidx' },
      mode: 'light',
      value: '{palette#depth}',
    })
    expect('refused' in result && result.refused).toMatch(/FLOAT.*COLOR|COLOR.*FLOAT/)
  })

  it('refuses an alias to nothing', () => {
    const result = editCellPatch({
      index: index(),
      row: { address: 'semantic#brand', type: 'COLOR', file: 'core.uidx' },
      mode: 'light',
      value: '{palette#ghost}',
    })
    expect('refused' in result && result.refused).toContain('palette#ghost')
  })

  it('refuses a literal that does not fit the type', () => {
    const result = editCellPatch({
      index: index(),
      row: { address: 'palette#depth', type: 'FLOAT', file: 'core.uidx' },
      mode: IMPLICIT_MODE,
      value: 'twelve',
    })
    expect('refused' in result).toBe(true)
  })
})

describe('addTokenPatch', () => {
  it('inserts a typed variable at the end of its collection', () => {
    expect(
      addTokenPatch({
        collection: 'palette',
        file: 'core.uidx',
        name: 'green-500',
        type: 'COLOR',
        value: { r: 0, g: 0.8, b: 0.2, a: 1 },
        at: 3,
        modes: ['default'],
      }),
    ).toEqual({
      file: 'core.uidx',
      patches: [
        {
          op: 'insert-node',
          parent: 'palette',
          index: 3,
          node: {
            element: 'Variable',
            attrs: { name: 'green-500', type: 'COLOR', value: { r: 0, g: 0.8, b: 0.2, a: 1 } },
          },
        },
      ],
    })
  })

  it('gives a moded collection one <Mode> child per mode, no plain value', () => {
    expect(
      addTokenPatch({
        collection: 'semantic',
        file: 'core.uidx',
        name: 'accent',
        type: 'COLOR',
        value: { r: 1, g: 0, b: 0, a: 1 },
        at: 1,
        modes: ['light', 'dark'],
      }),
    ).toEqual({
      file: 'core.uidx',
      patches: [
        {
          op: 'insert-node',
          parent: 'semantic',
          index: 1,
          node: {
            element: 'Variable',
            attrs: { name: 'accent', type: 'COLOR' },
            children: [
              { element: 'Mode', attrs: { name: 'light', value: { r: 1, g: 0, b: 0, a: 1 } } },
              { element: 'Mode', attrs: { name: 'dark', value: { r: 1, g: 0, b: 0, a: 1 } } },
            ],
          },
        },
      ],
    })
  })
})

describe('addCollectionPatch', () => {
  it('inserts an empty collection at the tokens root', () => {
    expect(addCollectionPatch({ file: 'core.uidx', name: 'elevation', at: 3 })).toEqual({
      file: 'core.uidx',
      patches: [
        {
          op: 'insert-node',
          parent: '',
          index: 3,
          node: { element: 'Collection', attrs: { name: 'elevation' } },
        },
      ],
    })
  })
})

describe('aliasTargets', () => {
  it('offers same-typed, live tokens and never the token itself', () => {
    const offered = aliasTargets(index(), 'COLOR', 'semantic#brand').map((e) => e.address)
    expect(offered).toContain('palette#blue-500')
    expect(offered).not.toContain('semantic#brand') // self
    expect(offered).not.toContain('palette#stale') // deprecated
    expect(offered).not.toContain('palette#depth') // FLOAT
  })

  it('excludes targets whose chain already passes through the editing token', () => {
    const offered = aliasTargets(index(), 'FLOAT', 'loop#b').map((e) => e.address)
    expect(offered).not.toContain('loop#a') // a → b would close the loop
    expect(offered).toContain('palette#depth')
  })
})
