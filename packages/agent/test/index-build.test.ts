import { parse, type UidxDocument } from '@uidx/format'
import { describe, expect, it } from 'vitest'

import { buildIndex } from '../src/index/build.js'

const doc = (source: string): UidxDocument => {
  const result = parse(source)
  if (!result.doc) throw new Error(result.diagnostics.map((d) => d.message).join('; '))
  return result.doc
}

const COMPONENTS = doc(`---
id: components
---

## Core Intent

Shared surfaces.

## Visual Contract

<Page>
  <Component name="Card" status="stable" props={{ heading: { type: 'TEXT', default: 'Title' } }}>
    <Frame name="container" layoutMode="VERTICAL" width={280} height={180}>
      <Text name="title" characters="{heading}" fontSize={16} />
      <Slot name="body" layoutMode="VERTICAL" />
    </Frame>
  </Component>
</Page>
`)

const HOME = doc(`---
id: home
---

## Visual Contract

<Page>
  <Frame name="hero" width={600} height={200} cornerRadius="{radius#md}" />
  <Instance name="revenue" component="Card" x={0} y={0} props={{ heading: 'Revenue' }} />
</Page>
`)

const TOKENS = doc(`---
id: tokens
---

## Visual Contract

<Tokens>
  <Collection name="radius">
    <Variable name="md" type="FLOAT" value={8} />
  </Collection>
</Tokens>
`)

const index = () =>
  buildIndex(
    'doc',
    new Map([
      ['components.uidx', COMPONENTS],
      ['home.uidx', HOME],
      ['tokens.uidx', TOKENS],
    ]),
  )

describe('buildIndex', () => {
  it('records every component with its props and slots', () => {
    const card = index().components.get('Card')
    expect(card).toMatchObject({ file: 'components.uidx', status: 'stable', slots: ['body'] })
    expect(card?.props).toEqual([{ name: 'heading', type: 'TEXT', default: 'Title' }])
  })

  it('records each page skeleton without its bodies', () => {
    const home = index().pages.get('home.uidx')
    expect(home?.kind).toBe('page')
    expect(home?.topLevel.map((n) => n.name)).toEqual(['hero', 'revenue'])
  })

  it('marks a token file as tokens, not a page', () => {
    expect(index().pages.get('tokens.uidx')?.kind).toBe('tokens')
  })

  it('collects the intent headings so the agent can read the designers words', () => {
    expect(index().pages.get('components.uidx')?.headings).toContain('Core Intent')
  })

  it('indexes variables by their addresses', () => {
    expect(index().variables.get('radius#md')).toMatchObject({ type: 'FLOAT', name: 'md' })
  })

  it('answers which pages use a component', () => {
    expect(index().usesOfComponent('Card')).toEqual([
      { address: 'revenue', file: 'home.uidx', component: 'Card' },
    ])
  })

  it('answers which nodes reference a token', () => {
    expect(index().usesOfVariable('radius#md')).toEqual([
      { address: 'hero', file: 'home.uidx', prop: 'cornerRadius' },
    ])
  })

  it('does not throw on a null prop declaration, and reports it with the fallback shape', () => {
    const malformed = doc(`---
id: malformed
---

## Visual Contract

<Page>
  <Component name="Widget" status="stable" props={{ label: { type: 'TEXT', default: 'Hi' } }}>
    <Frame name="container" layoutMode="VERTICAL" width={100} height={100} />
  </Component>
</Page>
`)
    // @uidx/format's own parser refuses to ever *produce* this shape: a
    // malformed props entry is UIDX115, a hard parse error, so `parse()`
    // never returns a doc with one. `buildIndex` takes a `UidxDocument` by
    // type, not "whatever `parse()` vetted", so it must not lean on that
    // invariant either — corrupt the tree in memory, the way any other
    // producer of a `UidxDocument` could, to prove it.
    const widget = malformed.tree.children[0]!
    const props = widget.attrs.props!.value as Record<string, unknown>
    props.broken = null

    const widgetEntry = buildIndex('doc', new Map([['malformed.uidx', malformed]])).components.get(
      'Widget',
    )
    expect(widgetEntry?.props).toEqual([
      { name: 'label', type: 'TEXT', default: 'Hi' },
      { name: 'broken', type: 'TEXT', default: undefined },
    ])
  })

  it('collects a component variant name from its Variant children', () => {
    const withVariant = doc(`---
id: variants
---

## Visual Contract

<Page>
  <Component name="Toggle" status="stable" variants={{ state: ['on'] }}>
    <Variant state="on">
      <Frame name="container" layoutMode="HORIZONTAL" width={40} height={20} />
    </Variant>
  </Component>
</Page>
`)
    const toggle = buildIndex('doc', new Map([['variants.uidx', withVariant]])).components.get(
      'Toggle',
    )
    expect(toggle?.variants).toEqual(['state=on'])
  })
})
