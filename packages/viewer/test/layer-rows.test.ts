import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'

import { ancestorsOf, componentIndex, layerRows, visibleRows } from '../src/layer-rows'

const DOC = parseOrThrow(`---
id: primary-button
---

## Visual Contract

<Page>
  <Component name="Button/Primary" status="stable">
    <Frame name="container" layoutMode="HORIZONTAL">
      <Vector name="leading-icon" visible={false} />
      <Text name="label" characters="Click Me" />
    </Frame>
  </Component>
</Page>
`)

describe('layerRows', () => {
  it('flattens the document depth-first, root first', () => {
    expect(layerRows(DOC).map((r) => [r.address, r.depth])).toEqual([
      ['', 0],
      ['Button/Primary', 1],
      ['Button/Primary#container', 2],
      ['Button/Primary#container/leading-icon', 3],
      ['Button/Primary#container/label', 3],
    ])
  })

  it('carries the element and the display name', () => {
    const rows = layerRows(DOC)
    expect(rows[1]).toMatchObject({ element: 'Component', name: 'Button/Primary' })
    expect(rows[4]).toMatchObject({ element: 'Text', name: 'label' })
  })

  /** An absent `visible` attribute means visible — the eye must not read blank as hidden. */
  it('defaults visible to true and reads an explicit false', () => {
    const rows = layerRows(DOC)
    expect(rows[2]!.visible).toBe(true)
    expect(rows[3]!.visible).toBe(false)
  })

  it('marks which rows can be expanded', () => {
    expect(layerRows(DOC).map((r) => r.hasChildren)).toEqual([true, true, true, false, false])
  })

  it('records whether visible was authored, to choose set over add', () => {
    const rows = layerRows(DOC)
    expect(rows[3]!.declaresVisible).toBe(true)
    expect(rows[4]!.declaresVisible).toBe(false)
  })

  it('is empty for no document', () => {
    expect(layerRows(null)).toEqual([])
  })
})

describe('visibleRows', () => {
  it('hides every descendant of a collapsed row', () => {
    const rows = layerRows(DOC)
    const shown = visibleRows(rows, new Set(['', 'Button/Primary']))
    expect(shown.map((r) => r.address)).toEqual(['', 'Button/Primary', 'Button/Primary#container'])
  })

  it('shows everything when all containers are expanded', () => {
    const rows = layerRows(DOC)
    const all = new Set(rows.filter((r) => r.hasChildren).map((r) => r.address))
    expect(visibleRows(rows, all)).toHaveLength(5)
  })

  it('collapsing the root leaves only the root', () => {
    expect(visibleRows(layerRows(DOC), new Set())).toHaveLength(1)
  })
})

describe('ancestorsOf', () => {
  it('walks up through the entity boundary and the path', () => {
    expect(ancestorsOf('Button/Primary#container/label')).toEqual([
      '',
      'Button/Primary',
      'Button/Primary#container',
    ])
  })

  it('stops at the page for an entity', () => {
    expect(ancestorsOf('Button/Primary')).toEqual([''])
    expect(ancestorsOf('')).toEqual([])
  })

  /**
   * `/` is a name character in an entity name — `Button/Primary` is one
   * component, not two levels. Splitting the whole address on `/` would invent
   * an ancestor called `Button`.
   */
  it('does not split the entity name into levels', () => {
    expect(ancestorsOf('Button/Primary#container')).toEqual(['', 'Button/Primary'])
  })
})

/**
 * A component's states in the rail (story F8, ADR 0005).
 *
 * The rail reads the document, so a `<Variant>` is an ordinary row with
 * ordinary editable children — which is the decisive argument for full trees.
 * What is not ordinary is the row itself: it has no name of its own and no
 * position of its own, so three of the rail's gestures have nothing to write.
 */
const STATEFUL = parseOrThrow(`---
id: chip
---

## Visual Contract

<Page>
  <Component name="Chip" status="draft" variants={{ state: ['default', 'hover'] }}>
    <Variant state="default">
      <Frame name="root" layoutMode="VERTICAL"><Text name="t" characters="Chip" /></Frame>
    </Variant>
    <Variant state="hover">
      <Frame name="root" layoutMode="VERTICAL"><Text name="t" characters="Hover" /></Frame>
    </Variant>
  </Component>
</Page>
`)

describe('variants in the rail', () => {
  it('shows each variant, addressed by its coordinates', () => {
    expect(layerRows(STATEFUL).map((r) => r.address)).toEqual([
      '',
      'Chip',
      'Chip#state=default',
      'Chip#state=default/root',
      'Chip#state=default/root/t',
      'Chip#state=hover',
      'Chip#state=hover/root',
      'Chip#state=hover/root/t',
    ])
  })

  it('marks the variant row derived, and nothing inside it', () => {
    const rows = layerRows(STATEFUL)
    const derived = rows.filter((r) => r.derived).map((r) => r.address)
    expect(derived).toEqual(['Chip#state=default', 'Chip#state=hover'])
    // Not the same claim as `generated`: these rows have lines in the file.
    expect(rows.every((r) => !r.generated)).toBe(true)
  })

  it('grows an instance from the state it asked for, not from the set', () => {
    const components = componentIndex([STATEFUL])
    const uses = (props: string) =>
      parseOrThrow(
        `---\nid: home\n---\n\n## Visual Contract\n\n<Page>\n` +
          `  <Instance name="c" component="Chip"${props} />\n</Page>\n`,
      )
    expect(layerRows(uses(''), components).map((r) => r.address)).toEqual([
      '',
      'c',
      'c#root',
      'c#root/t',
    ])
    // And the same addresses whichever state it picks — a variant is never in
    // an instance's address (ADR 0005 §3).
    expect(
      layerRows(uses(` props={{ state: 'hover' }}`), components).map((r) => r.address),
    ).toEqual(['', 'c', 'c#root', 'c#root/t'])
  })

  it('shows an instance asking for a combination nobody designed as a leaf', () => {
    const sparse = parseOrThrow(`---
id: sparse
---

## Visual Contract

<Page>
  <Component name="S" status="draft" variants={{ state: ['a'], size: ['md', 'sm'] }}>
    <Variant state="a" size="md"><Frame name="root" layoutMode="VERTICAL" /></Variant>
  </Component>
</Page>
`)
    const rows = layerRows(
      parseOrThrow(
        `---\nid: home\n---\n\n## Visual Contract\n\n<Page>\n` +
          `  <Instance name="i" component="S" props={{ size: 'sm' }} />\n</Page>\n`,
      ),
      componentIndex([sparse]),
    )
    // Rather than the set's variants, which is a structure the canvas does not
    // have either — `uidx check` reports UIDX407 at the use site.
    expect(rows.map((r) => r.address)).toEqual(['', 'i'])
    expect(rows[1]!.hasChildren).toBe(false)
  })
})
