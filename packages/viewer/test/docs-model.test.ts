import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { buildDependentsIndex } from '@uidx/schema'

import { componentDocs, docsExample, exampleDocument } from '../src/docs-model'

const CHECKBOX = parseOrThrow(`---
id: checkbox
---

Lets a user toggle one option. Uses \`checked\`.

## Visual Contract

<Page>
  <Component name="Checkbox" status="stable" implements="x-checkbox" width={20} height={20} />
</Page>

<Styles>
  <Style state="checked" root:opacity={0.5} />
</Styles>

## Contract

<Props>
  <Prop name="checked" type="boolean" default={false} visual>Whether it is on.</Prop>
  <Prop name="label" type="string">Words.</Prop>
</Props>

## Behavior

- toggle: click flips \`checked\`.

## Examples

<Example name="on">
  <Set at="root" state="checked" />
  <Set at="label" value="Remember me" />
  <Set slot="option" count={3} />
</Example>
`)

const FORM = parseOrThrow(`---
id: form
---

## Visual Contract

<Page>
  <Frame name="form">
    <Instance name="remember" component="Checkbox" />
  </Frame>
</Page>
`)

const pages = new Map([
  ['checkbox.uidx', CHECKBOX],
  ['form.uidx', FORM],
])

describe('componentDocs', () => {
  const docs = componentDocs('checkbox.uidx', CHECKBOX, buildDependentsIndex(pages))!

  it('reads the identity: words, contract, behaviour and uses', () => {
    expect(docs).toMatchObject({
      name: 'Checkbox',
      status: 'stable',
      implements: 'x-checkbox',
      intent: 'Lets a user toggle one option. Uses `checked`.',
    })
    expect(docs.contract?.props.map((prop) => prop.name)).toEqual(['checked', 'label'])
    expect(docs.behavior.map((rule) => rule.id)).toEqual(['toggle'])
    expect(docs.usedIn).toEqual([{ file: 'form.uidx', address: 'form#remember' }])
  })

  it('turns an example into one instance, naming what it cannot draw', () => {
    expect(docs.examples).toEqual([
      {
        name: 'on',
        props: { checked: true, label: 'Remember me' },
        notDrawn: ['<Set slot="option" count={3} />'],
      },
    ])
  })

  it('chooses the state axis for a state that is not a visual boolean', () => {
    const example = docsExample(
      {
        name: 'hovered',
        sets: [{ at: 'root', state: 'hover', loc: { start: 0, end: 0 } }],
        loc: { start: 0, end: 0 },
      },
      CHECKBOX.spec!.contract!,
    )
    expect(example.props).toEqual({ state: 'hover' })
  })

  it('draws an example as a one-instance page', () => {
    const doc = exampleDocument('Checkbox', docs.examples[0]!)!
    const instance = doc.tree.children[0]!
    expect(instance.element).toBe('Instance')
    expect(instance.attrs.props?.value).toEqual({ checked: true, label: 'Remember me' })
  })

  it('is null for a page without a component', () => {
    expect(componentDocs('form.uidx', FORM, buildDependentsIndex(pages))).toBeNull()
  })
})
