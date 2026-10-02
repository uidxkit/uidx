import { describe, expect, it } from 'vitest'
import { applyPatches, parseOrThrow, resolve } from '@uidx/format'

import { renameContractProp } from '../src/contract-rename'
import { examplesOf } from '../src/docs-edits'

/**
 * Renaming a contract prop carries everything that reads it, so the document
 * checks clean afterwards: bindings, style rows keyed by it, examples that set
 * it, and every instance's props on every page.
 */
const BADGE = `---
id: badge
---

A badge.

## Visual Contract

<Page>
  <Component name="Badge" status="draft" width={20} height={20}>
    <Text name="text" characters="{label}" />
  </Component>
</Page>

<Styles>
  <Style tone="danger" root:opacity={0.5} />
  <Style state="hover" tone="danger" root:opacity={0.4} />
</Styles>

## Contract

<Props>
  <Prop name="label" type="string" sample="New">Words.</Prop>
  <Prop name="tone" type="'info' | 'danger'" default="info" visual>Tone.</Prop>
</Props>

## Examples

<Example name="danger">
  <Set at="tone" value="danger" />
</Example>
`
const HOME = `---
id: home
---

## Visual Contract

<Page>
  <Instance name="a" component="Badge" props={{ tone: 'danger', label: 'Hot' }} />
  <Instance name="b" component="Badge" />
</Page>
`
const pages = () =>
  new Map([
    ['badge.uidx', parseOrThrow(BADGE)],
    ['home.uidx', parseOrThrow(HOME)],
  ])

describe('renaming a contract prop', () => {
  it('carries style rows, examples and instances with it', () => {
    const plan = renameContractProp(pages(), 'badge.uidx', 'tone', 'intent')
    if ('refused' in plan) throw new Error(plan.refused)
    const badge = parseOrThrow(applyPatches(BADGE, plan.byFile.get('badge.uidx')!).source)
    expect(badge.spec!.contract!.props.map((prop) => prop.name)).toEqual(['label', 'intent'])
    expect(badge.spec!.styles!.map((row) => row.keys)).toEqual([
      { intent: 'danger' },
      { state: 'hover', intent: 'danger' },
    ])
    expect(examplesOf(badge)).toEqual([
      { name: 'danger', sets: [{ at: 'intent', value: 'danger' }] },
    ])
    const home = parseOrThrow(applyPatches(HOME, plan.byFile.get('home.uidx')!).source)
    expect(resolve(home.tree, 'a')!.attrs.props!.value).toEqual({ intent: 'danger', label: 'Hot' })
    expect(plan.byFile.get('home.uidx')).toHaveLength(1)
  })

  it('carries the bindings that read it', () => {
    const plan = renameContractProp(pages(), 'badge.uidx', 'label', 'text')
    if ('refused' in plan) throw new Error(plan.refused)
    const badge = parseOrThrow(applyPatches(BADGE, plan.byFile.get('badge.uidx')!).source)
    expect(resolve(badge.tree, 'Badge#text')!.attrs.characters!.value).toBe('{text}')
  })

  it('refuses a taken or malformed name', () => {
    expect(renameContractProp(pages(), 'badge.uidx', 'tone', 'label')).toEqual({
      refused: 'there is already a prop called label',
    })
    expect(renameContractProp(pages(), 'badge.uidx', 'tone', 'Big tone')).toMatchObject({
      refused: expect.stringMatching(/camelCase/),
    })
  })
})
