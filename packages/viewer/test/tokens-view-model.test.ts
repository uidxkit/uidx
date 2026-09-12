import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { buildDependentsIndex, buildTokenIndex, TokenResolver } from '@uidx/schema'

import { categoryOf, tokensViewModel } from '../src/tokens-view-model'

const doc = (id: string, body: string) =>
  parseOrThrow(`---\nid: ${id}\n---\n\n## Visual Contract\n\n${body}\n`)

const CORE = doc(
  'core',
  `<Tokens>
  <Collection name="palette">
    <Variable name="blue-500" type="COLOR" value={{ r: 0.1, g: 0.4, b: 0.9, a: 1 }} />
    <Variable name="old-gray" type="COLOR" value={{ r: 0.5, g: 0.5, b: 0.5, a: 1 }} deprecated={true} />
  </Collection>
  <Collection name="radius">
    <Variable name="md" type="FLOAT" value={8} scopes={['CORNER_RADIUS']} />
  </Collection>
  <Collection name="semantic" modes={['light', 'dark']}>
    <Variable name="brand" type="COLOR">
      <Mode name="light" value="{palette#blue-500}" />
      <Mode name="dark" value="{palette#missing}" />
    </Variable>
  </Collection>
</Tokens>`,
)

const HOME = doc(
  'home',
  `<Page>
  <Frame name="hero" cornerRadius="{radius#md}" />
</Page>`,
)

const pages = new Map([
  ['core.uidx', CORE],
  ['home.uidx', HOME],
])

function model(view: { kind: 'tokens'; file: string }) {
  const index = buildTokenIndex([...pages.values()])
  return tokensViewModel({
    view,
    pages,
    index,
    resolver: new TokenResolver(index),
    deps: buildDependentsIndex(pages),
  })
}

describe('categoryOf', () => {
  it('maps type and scopes to the industry categories', () => {
    expect(categoryOf('COLOR', ['ALL_SCOPES'])).toBe('color')
    expect(categoryOf('FLOAT', ['CORNER_RADIUS'])).toBe('radius')
    expect(categoryOf('FLOAT', ['GAP'])).toBe('spacing')
    expect(categoryOf('FLOAT', ['SPACING'])).toBe('spacing')
    expect(categoryOf('FLOAT', ['WIDTH_HEIGHT'])).toBe('size')
    expect(categoryOf('FLOAT', ['FONT_SIZE'])).toBe('typography')
    expect(categoryOf('FLOAT', ['LINE_HEIGHT'])).toBe('typography')
    expect(categoryOf('FLOAT', ['OPACITY'])).toBe('opacity')
    expect(categoryOf('FLOAT', ['ALL_SCOPES'])).toBe('number')
    expect(categoryOf('STRING', ['FONT_FAMILY'])).toBe('typography')
    expect(categoryOf('STRING', ['ALL_SCOPES'])).toBe('text')
    expect(categoryOf('BOOLEAN', ['ALL_SCOPES'])).toBe('toggle')
  })
})

describe('tokensViewModel', () => {
  it('lists a tokens page as its collections, in authored order', () => {
    const groups = model({ kind: 'tokens', file: 'core.uidx' })
    expect(groups.map((g) => g.name)).toEqual(['palette', 'radius', 'semantic'])
    expect(groups[0]!.file).toBe('core.uidx')
    expect(groups[0]!.rows.map((r) => r.name)).toEqual(['blue-500', 'old-gray'])
    expect(groups[2]!.modes).toEqual(['light', 'dark'])
  })

  it('scopes a scene page to the tokens it binds', () => {
    const groups = model({ kind: 'tokens', file: 'home.uidx' })
    expect(groups.map((g) => g.name)).toEqual(['radius'])
    expect(groups[0]!.rows.map((r) => r.address)).toEqual(['radius#md'])
    expect(groups[0]!.file).toBe('core.uidx')
  })

  it('carries the alias chain and the calculated end value', () => {
    const groups = model({ kind: 'tokens', file: 'core.uidx' })
    const brand = groups[2]!.rows[0]!
    const light = brand.cells.find((c) => c.mode === 'light')!
    expect(light.chain).toEqual(['palette#blue-500'])
    expect(light.resolved).toEqual({ r: 0.1, g: 0.4, b: 0.9, a: 1 })
  })

  it('names the break in a chain instead of leaving a blank', () => {
    const groups = model({ kind: 'tokens', file: 'core.uidx' })
    const brand = groups[2]!.rows[0]!
    const dark = brand.cells.find((c) => c.mode === 'dark')!
    expect(dark.resolved).toBeNull()
    expect(dark.broken).toContain('palette#missing')
  })

  it('carries category, deprecation and the dependents count', () => {
    const groups = model({ kind: 'tokens', file: 'core.uidx' })
    const blue = groups[0]!.rows[0]!
    expect(blue.category).toBe('color')
    expect(blue.dependents).toBe(1) // semantic#brand's light mode
    expect(groups[0]!.rows[1]!.deprecated).toBe(true)
    const md = groups[1]!.rows[0]!
    expect(md.category).toBe('radius')
    expect(md.dependents).toBe(1) // hero's cornerRadius
  })
})

describe('token architecture and visual scopes', () => {
  function from(body: string) {
    const tokens = doc('tiers', body)
    const localPages = new Map([
      ['tiers.uidx', tokens],
      ['home.uidx', HOME],
    ])
    const index = buildTokenIndex([...localPages.values()])
    const input = {
      pages: localPages,
      index,
      resolver: new TokenResolver(index),
      deps: buildDependentsIndex(localPages),
    }
    return {
      groups: tokensViewModel({ ...input, view: { kind: 'tokens', file: 'tiers.uidx' } }),
      bound: tokensViewModel({ ...input, view: { kind: 'tokens', file: 'home.uidx' } }),
    }
  }

  it('preserves authored tiers on collections and page-bound rows without guessing unassigned tiers', () => {
    const { groups, bound } = from(`<Tokens>
      <Collection name="radius" tier="primitive"><Variable name="md" type="FLOAT" value={8} /></Collection>
      <Collection name="decisions" tier="semantic"><Variable name="round" type="FLOAT" value="{radius#md}" /></Collection>
      <Collection name="control" tier="component"><Variable name="round" type="FLOAT" value="{decisions#round}" /></Collection>
      <Collection name="semantic"><Variable name="loose" type="FLOAT" value={2} /></Collection>
    </Tokens>`)
    expect(groups.map((g) => g.tier)).toEqual(['primitive', 'semantic', 'component', 'unassigned'])
    expect(bound[0]!.tier).toBe('primitive')
    expect(bound[0]!.rows[0]!.tier).toBe('primitive')
  })

  it('previews legacy scales and aliases without changing their authored scopes', () => {
    const { groups } = from(`<Tokens>
      <Collection name="space"><Variable name="md" type="FLOAT" value={16} /></Collection>
      <Collection name="layout"><Variable name="gap" type="FLOAT" value="{space#md}" /><Variable name="unknown" type="FLOAT" value={24} /></Collection>
    </Tokens>`)
    expect(groups[0]!.rows[0]!.category).toBe('spacing')
    expect(groups[0]!.rows[0]!.scopes).toEqual(['ALL_SCOPES'])
    expect(groups[1]!.rows[0]!.inferredScopes).toEqual(['SPACING'])
    expect(groups[1]!.rows[1]!.category).toBe('number')
  })

  it('honors explicit scopes and leaves mixed or cyclic aliases unclassified', () => {
    const { groups } = from(`<Tokens>
      <Collection name="space"><Variable name="explicit" type="FLOAT" value={8} scopes={['CORNER_RADIUS']} /><Variable name="md" type="FLOAT" value={16} /></Collection>
      <Collection name="other" modes={['a', 'b']}><Variable name="mixed" type="FLOAT"><Mode name="a" value="{space#md}" /><Mode name="b" value="{space#explicit}" /></Variable></Collection>
      <Collection name="cycle"><Variable name="a" type="FLOAT" value="{cycle#b}" /><Variable name="b" type="FLOAT" value="{cycle#a}" /></Collection>
    </Tokens>`)
    expect(groups[0]!.rows[0]!.category).toBe('radius')
    expect(groups[0]!.rows[0]!.inferredScopes).toBeUndefined()
    expect(groups[1]!.rows[0]!.category).toBe('number')
    expect(groups[2]!.rows.every((row) => row.category === 'number')).toBe(true)
  })
})
