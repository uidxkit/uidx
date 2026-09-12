import { describe, expect, it } from 'vitest'

import { applyPatches, parse } from '../src/index.js'

const SOURCE = `---
id: theme
---

## Visual Contract

<Tokens>
  <Collection name="semantic" modes={['light', 'dark']}>
    <Variable name="brand" type="COLOR">
      <Mode name="light" value={{ r: 0, g: 0, b: 1, a: 1 }} />
      <Mode name="dark" value={{ r: 1, g: 1, b: 1, a: 1 }} />
    </Variable>
  </Collection>
</Tokens>
`

describe('set-mode', () => {
  it('rewrites the value of the named <Mode> child', () => {
    const result = applyPatches(SOURCE, [
      {
        op: 'set-mode',
        address: 'semantic#brand',
        mode: 'dark',
        value: { r: 0, g: 0, b: 0, a: 1 },
      },
    ])
    const { doc, diagnostics } = parse(result.source)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const brand = doc!.tree.children[0]!.children[0]!
    const dark = brand.children.find((m) => m.attrs.name?.value === 'dark')!
    expect(dark.attrs.value?.value).toEqual({ r: 0, g: 0, b: 0, a: 1 })
    // The sibling mode is untouched.
    const light = brand.children.find((m) => m.attrs.name?.value === 'light')!
    expect(light.attrs.value?.value).toEqual({ r: 0, g: 0, b: 1, a: 1 })
  })

  it('accepts an alias as the mode value', () => {
    const result = applyPatches(SOURCE, [
      { op: 'set-mode', address: 'semantic#brand', mode: 'light', value: '{palette#blue-500}' },
    ])
    expect(result.source).toContain('value="{palette#blue-500}"')
  })

  it('refuses a mode the variable does not hold', () => {
    expect(() =>
      applyPatches(SOURCE, [
        { op: 'set-mode', address: 'semantic#brand', mode: 'sepia', value: 1 },
      ]),
    ).toThrow(/no mode "sepia".*light, dark/)
  })

  it('refuses an address that is not a <Variable>', () => {
    expect(() =>
      applyPatches(SOURCE, [{ op: 'set-mode', address: 'semantic', mode: 'dark', value: 1 }]),
    ).toThrow(/Variable/)
  })
})

describe('inserting into token containers', () => {
  const FLAT = `---
id: flat
---

## Visual Contract

<Tokens>
  <Collection name="radius">
    <Variable name="sm" type="FLOAT" value={4} />
  </Collection>
</Tokens>
`

  it('inserts a <Variable> into a <Collection>', () => {
    const result = applyPatches(FLAT, [
      {
        op: 'insert-node',
        parent: 'radius',
        index: 1,
        node: { element: 'Variable', attrs: { name: 'md', type: 'FLOAT', value: 8 } },
      },
    ])
    const { doc, diagnostics } = parse(result.source)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(doc!.tree.children[0]!.children.map((v) => v.name)).toEqual(['sm', 'md'])
  })

  it('inserts a <Collection> into the <Tokens> root', () => {
    const result = applyPatches(SOURCE, [
      {
        op: 'insert-node',
        parent: '',
        index: 1,
        node: { element: 'Collection', attrs: { name: 'elevation' } },
      },
    ])
    const { doc, diagnostics } = parse(result.source)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(doc!.tree.children.map((c) => c.name)).toEqual(['semantic', 'elevation'])
  })
})
