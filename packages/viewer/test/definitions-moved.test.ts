import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { componentIndex } from '../src/layer-rows'
import { declaredComponents, definitionsMoved, instancedComponents } from '../src/definitions-moved'

const LIB = (radius: number, unusedRadius = 0) =>
  parseOrThrow(`---
id: lib
---

## Visual Contract

<Page>
  <Component name="Chip" status="draft">
    <Frame name="root" cornerRadius={${radius}} />
  </Component>
  <Component name="Unused" status="draft">
    <Frame name="root" cornerRadius={${unusedRadius}} />
  </Component>
</Page>
`)

const USER = parseOrThrow(`---
id: user
---

## Visual Contract

<Page>
  <Frame name="doc">
    <Instance name="chip" component="Chip" />
  </Frame>
</Page>
`)

describe('definitionsMoved', () => {
  it('lists the components a page instances', () => {
    expect(instancedComponents(USER)).toEqual(new Set(['Chip']))
    expect(instancedComponents(null)).toEqual(new Set())
  })

  it('is false when a save re-parses the definitions into fresh but identical nodes', () => {
    expect(
      definitionsMoved(componentIndex([LIB(4)]), componentIndex([LIB(4)]), new Set(['Chip'])),
    ).toBe(false)
  })

  it('is true when an instanced definition changes', () => {
    expect(
      definitionsMoved(componentIndex([LIB(4)]), componentIndex([LIB(8)]), new Set(['Chip'])),
    ).toBe(true)
  })

  it('ignores a change to a component the page does not instance', () => {
    expect(
      definitionsMoved(componentIndex([LIB(4)]), componentIndex([LIB(4, 2)]), new Set(['Chip'])),
    ).toBe(false)
  })

  it('is true on first render and when an instanced definition appears or vanishes', () => {
    expect(definitionsMoved(undefined, componentIndex([LIB(4)]), new Set(['Chip']))).toBe(true)
    expect(definitionsMoved(componentIndex([LIB(4)]), new Map(), new Set(['Chip']))).toBe(true)
  })

  it('is false for the same map object', () => {
    const index = componentIndex([LIB(4)])
    expect(definitionsMoved(index, index, new Set(['Chip']))).toBe(false)
  })
})

describe('declaredComponents', () => {
  it('lists the components a page declares, and nothing for no page', () => {
    expect(declaredComponents(LIB(1))).toEqual(new Set(['Chip', 'Unused']))
    expect(declaredComponents(USER)).toEqual(new Set())
    expect(declaredComponents(null)).toEqual(new Set())
  })
})
