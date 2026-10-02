import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'

import { designDiff, designDiffMarkdown } from '../src/design-diff.js'

const button = (props: string, tokens: string) =>
  new Map([
    [
      'button.uidx',
      parseOrThrow(`---
id: button
---

## Visual Contract

<Page>
  <Component name="Button" width={80} height={32} />
</Page>

## Contract

<Props>
${props}
</Props>
`),
    ],
    [
      'tokens.uidx',
      parseOrThrow(`---
id: tokens
---

## Visual Contract

<Tokens>
  <Collection name="color">
${tokens}
  </Collection>
</Tokens>
`),
    ],
  ])

describe('designDiff', () => {
  it('marks removed and retyped props and removed tokens as breaking', () => {
    const before = button(
      `  <Prop name="label" type="string">Words.</Prop>
  <Prop name="size" type="'sm' | 'md'" default="md" visual>Size.</Prop>`,
      `    <Variable name="accent" type="COLOR" value={{ r: 0, g: 0, b: 1, a: 1 }} />
    <Variable name="danger" type="COLOR" value={{ r: 1, g: 0, b: 0, a: 1 }} />`,
    )
    const after = button(
      `  <Prop name="size" type="'sm' | 'md' | 'lg'" default="md" visual>Size.</Prop>
  <Prop name="icon" type="string" default="">Icon.</Prop>`,
      `    <Variable name="accent" type="COLOR" value={{ r: 0, g: 0.5, b: 1, a: 1 }} />`,
    )
    const changes = designDiff(before, after)
    expect(changes.filter((c) => c.breaking).map((c) => `${c.subject}: ${c.change}`)).toEqual([
      'Button: prop "label" removed',
      `Button: prop "size" type 'sm' | 'md' → 'sm' | 'md' | 'lg'`,
      'token color#danger: removed',
    ])
    expect(changes.filter((c) => !c.breaking).map((c) => c.change)).toEqual([
      'prop "icon" added',
      'default: {"r":0,"g":0,"b":1,"a":1} → {"r":0,"g":0.5,"b":1,"a":1}',
    ])
    expect(designDiffMarkdown(changes)).toContain('**3 breaking changes**')
  })
})
