import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { buildDependentsIndex } from '@uidx/schema'

import { componentRenamePlan, offerableComponents } from '../src/component-rename'

const doc = (id: string, body: string) =>
  parseOrThrow(`---\nid: ${id}\n---\n\n## Visual Contract\n\n${body}\n`)

const LIB = doc(
  'lib',
  `<Page>
  <Component name="Card" status="draft">
    <Frame name="root" />
  </Component>
  <Component name="Lonely" status="draft">
    <Frame name="root" />
  </Component>
  <Component name="Retired" status="draft" deprecated={true}>
    <Frame name="root" />
  </Component>
</Page>`,
)

const USE = doc(
  'use',
  `<Page>
  <Instance name="a" component="Card" />
  <Frame name="plain" />
</Page>`,
)

const pages = new Map([
  ['lib.uidx', LIB],
  ['use.uidx', USE],
])
const deps = () => buildDependentsIndex(pages)

describe('componentRenamePlan', () => {
  it('turns a lone set-name on an instantiated component into the engine plan', () => {
    const plan = componentRenamePlan(pages, deps(), [
      { op: 'set', address: 'Card', prop: 'name', value: 'Panel' },
    ])
    expect(plan).not.toBeNull()
    expect([...plan!.byFile.keys()].sort()).toEqual(['lib.uidx', 'use.uidx'])
    expect(plan!.dependents).toHaveLength(1)
  })

  it('leaves a rename of a component nobody instantiates on the direct path', () => {
    expect(
      componentRenamePlan(pages, deps(), [
        { op: 'set', address: 'Lonely', prop: 'name', value: 'Solo' },
      ]),
    ).toBeNull()
  })

  it('leaves every other patch shape alone', () => {
    expect(
      componentRenamePlan(pages, deps(), [
        { op: 'set', address: 'plain', prop: 'name', value: 'renamed' },
      ]),
    ).toBeNull()
    expect(
      componentRenamePlan(pages, deps(), [
        { op: 'set', address: 'Card', prop: 'name', value: 'Panel' },
        { op: 'set', address: 'plain', prop: 'opacity', value: 0.5 },
      ]),
    ).toBeNull()
  })
})

describe('offerableComponents', () => {
  it('hides deprecated components from the picker, keeps the rest', () => {
    const components = new Map(
      [...LIB.tree.children]
        .filter((node) => node.element === 'Component')
        .map((node) => [node.name, node] as const),
    )
    expect(offerableComponents(components)).toEqual(['Card', 'Lonely'])
  })
})
