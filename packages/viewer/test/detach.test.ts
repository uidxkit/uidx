import { describe, expect, it } from 'vitest'
import { applyPatches, parseOrThrow, resolve } from '@uidx/format'

import { detachInstance } from '../src/detach'

/**
 * Detaching an instance writes the layers it draws into the page: the
 * variant its props select, its bindings resolved to what it showed, its
 * overrides applied and its slots filled — and the component no longer
 * controls them.
 */
const BADGE = `---
id: badge
---

A badge.

## Visual Contract

<Page>
  <Component name="Badge" status="draft" implements="x-badge" layoutMode="HORIZONTAL" width={40} height={20} opacity={1}>
    <Text name="text" part="label" characters="{label}" />
    <Slot name="icon">
      <Frame name="dot" width={4} height={4} />
    </Slot>
  </Component>
</Page>

<Styles>
  <Style tone="danger" root:opacity={0.5} />
</Styles>

## Contract

<Props>
  <Prop name="label" type="string" sample="New">Words.</Prop>
  <Prop name="tone" type="'info' | 'danger'" default="info" visual>Tone.</Prop>
</Props>
<Parts>
  <Part name="label">The words.</Part>
</Parts>
`
const HOME = `---
id: home
---

## Visual Contract

<Page>
  <Instance name="hot" component="Badge" x={10} y={20} props={{ tone: 'danger', label: 'Hot' }} overrides={{ text: { fontSize: 18 } }}>
    <Slot name="icon">
      <Frame name="star" width={6} height={6} />
    </Slot>
  </Instance>
  <Instance name="plain" component="Badge" />
</Page>
`
const pages = new Map([
  ['badge.uidx', parseOrThrow(BADGE)],
  ['home.uidx', parseOrThrow(HOME)],
])

describe('detaching an instance', () => {
  it('writes the selected variant with its values, overrides and slot fills', () => {
    const home = pages.get('home.uidx')!
    const plan = detachInstance(pages, home, 'hot')!
    const next = parseOrThrow(applyPatches(HOME, plan.patches).source)
    const frame = resolve(next.tree, 'hot')!
    expect(frame.element).toBe('Frame')
    expect(frame.attrs.opacity!.value).toBe(0.5)
    expect([frame.attrs.x!.value, frame.attrs.y!.value]).toEqual([10, 20])
    for (const gone of ['component', 'props', 'overrides', 'implements', 'status'])
      expect(frame.attrs[gone]).toBeUndefined()
    const text = resolve(next.tree, 'hot#text')!
    expect(text.attrs.characters!.value).toBe('Hot')
    expect(text.attrs.fontSize!.value).toBe(18)
    expect(text.attrs.part).toBeUndefined()
    const icon = resolve(next.tree, 'hot#icon')!
    expect(icon.element).toBe('Frame')
    expect(icon.children.map((child) => child.name)).toEqual(['star'])
    expect(next.tree.children.map((child) => child.name)).toEqual(['hot', 'plain'])
  })

  it('uses defaults and samples for an instance that sets nothing', () => {
    const plan = detachInstance(pages, pages.get('home.uidx')!, 'plain')!
    const next = parseOrThrow(applyPatches(HOME, plan.patches).source)
    expect(resolve(next.tree, 'plain')!.attrs.opacity!.value).toBe(1)
    expect(resolve(next.tree, 'plain#text')!.attrs.characters!.value).toBe('New')
    expect(resolve(next.tree, 'plain#icon')!.children.map((child) => child.name)).toEqual(['dot'])
  })

  it('offers nothing for a layer that is not an instance', () => {
    expect(detachInstance(pages, pages.get('badge.uidx')!, 'Badge')).toBeNull()
  })
})
