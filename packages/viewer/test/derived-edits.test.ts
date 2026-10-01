import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { applyPatches, parseOrThrow } from '@uidx/format'
import PropertiesPane from '../src/PropertiesPane.vue'
import { drawnNode, routeDerivedPatches } from '../src/derived-edits'
import { bindVariable, detachVariable } from '../src/variable-binding'

/**
 * Designing a state on the canvas (ADR 0016 §4).
 *
 * The claims: a derived variant is selectable and shows its fields; an edit
 * to it becomes a cell of its style row rather than a patch to a node that
 * has no source; on the default combination it edits the base tree; and
 * what a state cannot change is refused with a reason, not sent.
 */
const SOURCE = `---
id: checkbox
---

## Visual Contract

<Page>
  <Component name="Checkbox" status="stable" implements="hwc-checkbox" width={20} height={20}
    fills={[{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }]}>
    <Vector name="check" part="checked-indicator" visible={false} width={12} height={12}
      vectorPaths={[{ windingRule: 'NONZERO', data: 'M2 6 L5 9 L10 3' }]} />
    <Frame name="ring" width={20} height={20} />
  </Component>
</Page>

<Styles>
  <Style state="checked" checked-indicator:visible={true} />
  <Style state="hover" root:opacity={0.9} />
</Styles>

## Contract

<Props>
  <Prop name="checked" type="boolean" default={false} controllable visual>Selected.</Prop>
</Props>
`
const doc = parseOrThrow(SOURCE)

describe('routing an edit on a derived variant', () => {
  it('writes a cell of the state row, targeting root, a part, or a node by name', () => {
    expect(
      routeDerivedPatches(doc, [
        { op: 'set', address: 'Checkbox#state=hover/root', prop: 'opacity', value: 0.5 },
        { op: 'add', address: 'Checkbox#state=hover/root/check', prop: 'visible', value: true },
        { op: 'add', address: 'Checkbox#state=checked/root/ring', prop: 'opacity', value: 0.2 },
      ]),
    ).toEqual({
      patches: [
        { op: 'style', keys: { state: 'hover' }, target: 'root', prop: 'opacity', value: 0.5 },
        {
          op: 'style',
          keys: { state: 'hover' },
          target: 'checked-indicator',
          prop: 'visible',
          value: true,
        },
        { op: 'style', keys: { state: 'checked' }, target: 'ring', prop: 'opacity', value: 0.2 },
      ],
    })
  })

  it('clears a cell for a remove, and lands on the base tree for the default combination', () => {
    expect(
      routeDerivedPatches(doc, [
        { op: 'remove', address: 'Checkbox#state=hover/root', prop: 'opacity' },
        { op: 'set', address: 'Checkbox#state=default/root', prop: 'width', value: 24 },
        { op: 'set', address: 'Checkbox#state=default/root/check', prop: 'width', value: 14 },
      ]),
    ).toEqual({
      patches: [
        { op: 'style', keys: { state: 'hover' }, target: 'root', prop: 'opacity' },
        // Its last cell gone, the row is written back empty: hover stays a state.
        { op: 'style', keys: { state: 'hover' }, target: '', prop: '', value: {} },
        { op: 'set', address: 'Checkbox', prop: 'width', value: 24 },
        { op: 'set', address: 'Checkbox#check', prop: 'width', value: 14 },
      ],
    })
  })

  it('leaves authored addresses alone', () => {
    const patches = [{ op: 'set' as const, address: 'Checkbox#check', prop: 'width', value: 14 }]
    expect(routeDerivedPatches(doc, patches)).toEqual({ patches })
  })

  it('refuses what a state cannot change, with the reason', () => {
    expect(
      routeDerivedPatches(doc, [
        { op: 'set', address: 'Checkbox#state=hover/root', prop: 'x', value: 10 },
      ]),
    ).toEqual({ refused: expect.stringContaining('draws where its base draws') })
    expect(
      routeDerivedPatches(doc, [{ op: 'remove-node', address: 'Checkbox#state=hover/root/ring' }]),
    ).toEqual({ refused: expect.stringContaining('drawn from the base tree') })
    // Rotation is a look: a chevron turns when a row opens, and CSS renders it.
    expect(
      routeDerivedPatches(doc, [
        { op: 'set', address: 'Checkbox#state=hover/root/ring', prop: 'rotation', value: 90 },
      ]),
    ).toEqual({
      patches: [
        { op: 'style', keys: { state: 'hover' }, target: 'ring', prop: 'rotation', value: 90 },
      ],
    })
  })

  it('round-trips: the routed edit lands in the file as a row cell', () => {
    const routed = routeDerivedPatches(doc, [
      { op: 'set', address: 'Checkbox#state=hover/root', prop: 'opacity', value: 0.5 },
    ])
    if (!('patches' in routed)) throw new Error(routed.refused)
    expect(applyPatches(SOURCE, routed.patches).source).toContain(
      '<Style state="hover" root:opacity={0.5} />',
    )
  })
})

describe('letting go of a look on a state', () => {
  const outlined = parseOrThrow(
    SOURCE.replace(
      '<Style state="hover" root:opacity={0.9} />',
      `<Style state="hover" root:opacity={0.9} />
  <Style state="focus" ring:strokes={[{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }]} ring:strokeWeight={2} />`,
    ),
  )

  it('clears the cells a removed stroke leaves, keeping the state', () => {
    // What the panel sends when the stroke a state added is removed.
    const routed = routeDerivedPatches(outlined, [
      { op: 'set', address: 'Checkbox#state=focus/root/ring', prop: 'strokes', value: [] },
      { op: 'set', address: 'Checkbox#state=focus/root/ring', prop: 'strokeWeight', value: 0 },
    ])
    expect(routed).toEqual({
      patches: [
        { op: 'style', keys: { state: 'focus' }, target: 'ring', prop: 'strokes' },
        { op: 'style', keys: { state: 'focus' }, target: 'ring', prop: 'strokeWeight' },
        { op: 'style', keys: { state: 'focus' }, target: '', prop: '', value: {} },
      ],
    })
    const next = parseOrThrow(
      applyPatches(outlined.source, (routed as { patches: never[] }).patches).source,
    )
    expect(next.spec!.styles!.find((row) => row.keys.state === 'focus')!.values).toEqual({})
  })

  it('takes the weights with the stroke even when only the stroke is removed', () => {
    const routed = routeDerivedPatches(outlined, [
      { op: 'set', address: 'Checkbox#state=focus/root/ring', prop: 'strokes', value: [] },
    ]) as { patches: { prop: string; value?: unknown }[] }
    expect(routed.patches.map((p) => [p.prop, p.value])).toEqual([
      ['strokes', undefined],
      ['strokeWeight', undefined],
      ['', {}],
    ])
  })

  it("reads a state's twin as its base with the state's cells laid over", () => {
    const node = drawnNode(outlined, 'Checkbox#state=focus/root/ring')!
    expect(node.address).toBe('Checkbox#state=focus/root/ring')
    expect(node.attrs.strokeWeight?.value).toBe(2)
    expect(node.attrs.width?.value).toBe(20)
    expect(drawnNode(outlined, 'Checkbox#ring')).toBeNull()
  })

  it('writes nothing for a value the base already has and no cell holds', () => {
    expect(
      routeDerivedPatches(doc, [
        { op: 'set', address: 'Checkbox#state=hover/root/ring', prop: 'width', value: 20 },
      ]),
    ).toEqual({ patches: [] })
  })
})

describe('a token bound on a derived variant', () => {
  // The variant has no node in the file; the binding must still reach the
  // router, which writes the state's row (or the base, for the default).
  it('lands on the state row, and on the base tree for the default combination', () => {
    const bound = [
      ...bindVariable(doc, 'Checkbox#state=hover/root', 'opacity', 'opacity#disabled')!,
      ...bindVariable(doc, 'Checkbox#state=default/root/ring', 'opacity', 'opacity#disabled')!,
    ]
    expect(routeDerivedPatches(doc, bound)).toEqual({
      patches: [
        {
          op: 'style',
          keys: { state: 'hover' },
          target: 'root',
          prop: 'opacity',
          value: '{opacity#disabled}',
        },
        { op: 'add', address: 'Checkbox#ring', prop: 'opacity', value: '{opacity#disabled}' },
      ],
    })
    expect(detachVariable(doc, 'Checkbox#state=hover/root', 'opacity', 0.4)).not.toBeNull()
  })
})

describe('a derived variant in the inspector', () => {
  it('is selectable, shows its fields, and says which state it is', () => {
    const pane = mount(PropertiesPane, {
      props: { doc, selection: ['Checkbox#state=hover/root'], writable: true },
    })
    expect(pane.find('.node-head .name').text()).toBe('root')
    expect(pane.find('.meta[data-meta="state"]').text()).toBe('state=hover of Checkbox')
    expect(pane.find('.editor').exists()).toBe(true)
  })

  it('stands a selected variant in for its root frame', () => {
    const pane = mount(PropertiesPane, {
      props: { doc, selection: ['Checkbox#state=hover'], writable: true },
    })
    expect(pane.find('.node-head .name').text()).toBe('root')
    expect(pane.find('.meta[data-meta="state"]').text()).toBe('state=hover of Checkbox')
  })

  it('shows the authored component for the set itself, with no variants section', () => {
    const pane = mount(PropertiesPane, {
      props: { doc, selection: ['Checkbox'], writable: true },
    })
    expect(pane.find('.node-head .name').text()).toBe('Checkbox')
    expect(pane.find('.variants').exists()).toBe(false)
    expect(pane.find('.meta[data-meta="state"]').exists()).toBe(false)
  })
})
