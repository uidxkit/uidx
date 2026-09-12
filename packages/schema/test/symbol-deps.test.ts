import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'

import { buildDependentsIndex } from '../src/symbol-deps.js'

const doc = (id: string, body: string) =>
  parseOrThrow(`---\nid: ${id}\n---\n\n## Visual Contract\n\n${body}\n`)

const TOKENS = doc(
  'core',
  `<Tokens>
  <Collection name="palette">
    <Variable name="blue-500" type="COLOR" value={{ r: 0.1, g: 0.4, b: 0.9, a: 1 }} />
  </Collection>
  <Collection name="semantic" modes={['light', 'dark']}>
    <Variable name="brand" type="COLOR">
      <Mode name="light" value="{palette#blue-500}" />
      <Mode name="dark" value={{ r: 1, g: 1, b: 1, a: 1 }} />
    </Variable>
  </Collection>
  <Collection name="alias-flat">
    <Variable name="accent" type="COLOR" value="{palette#blue-500}" />
  </Collection>
</Tokens>`,
)

const SCENE = doc(
  'home',
  `<Page>
  <Component name="Card" status="draft">
    <Frame name="root" cornerRadius={4} />
  </Component>
  <Component name="Icon/Check" status="draft">
    <Frame name="root" />
  </Component>
  <Frame name="hero" fills={[{ type: 'SOLID', color: '{palette#blue-500}' }]}>
    <Instance name="card" component="Card" props={{ icon: 'Icon/Check' }} />
  </Frame>
</Page>`,
)

const pages = new Map([
  ['core.uidx', TOKENS],
  ['home.uidx', SCENE],
])

describe('buildDependentsIndex', () => {
  const index = () => buildDependentsIndex(pages)

  it('finds a variable that aliases a token', () => {
    const deps = index().ofToken.get('palette#blue-500') ?? []
    expect(deps).toContainEqual({
      file: 'core.uidx',
      address: 'alias-flat#accent',
      prop: 'value',
      kind: 'variable',
    })
  })

  it('finds a mode value that aliases a token, addressed to its variable', () => {
    const deps = index().ofToken.get('palette#blue-500') ?? []
    expect(deps).toContainEqual({
      file: 'core.uidx',
      address: 'semantic#brand',
      prop: 'value',
      kind: 'mode',
      mode: 'light',
    })
  })

  it('finds a scene binding buried inside a structured value', () => {
    const deps = index().ofToken.get('palette#blue-500') ?? []
    expect(deps).toContainEqual({
      file: 'home.uidx',
      address: 'hero',
      prop: 'fills',
      kind: 'scene',
    })
  })

  it('finds instances of a component', () => {
    const deps = index().ofComponent.get('Card') ?? []
    expect(deps).toContainEqual({
      file: 'home.uidx',
      address: 'hero#card',
      prop: 'component',
      kind: 'instance',
    })
  })

  it('finds an instance-swap prop naming a component of the document', () => {
    const deps = index().ofComponent.get('Icon/Check') ?? []
    expect(deps).toContainEqual({
      file: 'home.uidx',
      address: 'hero#card',
      prop: 'props',
      kind: 'instance-swap',
    })
  })

  it('answers nothing for an unreferenced token', () => {
    expect(index().ofToken.get('semantic#brand') ?? []).toEqual([])
  })
})
