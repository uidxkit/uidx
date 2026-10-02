import { describe, expect, it } from 'vitest'
import { applyPatches, parseOrThrow, resolve } from '@uidx/format'
import { frameSelectionFor, positionsDroppedBy } from '../src/layer-moves'

/**
 * Frame selection (⌘⌥G), the gesture that builds a component's anatomy: the
 * selected siblings move into a new hugging auto-layout frame where the first
 * of them stood, keeping their order and dropping positions the layout
 * ignores. A default-state twin on the canvas stands for its base layer.
 */
const SOURCE = `---
id: switch
---

## Visual Contract

<Page>
  <Component name="Switch" status="draft" layoutMode="HORIZONTAL">
    <Text name="hint" characters="?" />
    <Frame name="control" x={4} y={2} width={36} height={20} />
    <Frame name="label" width={40} height={20} />
  </Component>
  <Rectangle name="a" x={40} y={10} width={10} height={10} />
  <Rectangle name="b" x={20} y={30} width={10} height={10} />
</Page>

## Contract

<Props>
  <Prop name="checked" type="boolean" default={false} visual>On.</Prop>
</Props>
`
const doc = parseOrThrow(SOURCE)
const apply = (patches: Parameters<typeof applyPatches>[1]) =>
  parseOrThrow(applyPatches(SOURCE, patches).source)

describe('Frame selection', () => {
  it('wraps siblings in a hugging frame of the layout they sit in, in order', () => {
    const made = frameSelectionFor(doc, ['Switch#label', 'Switch#control'])!
    expect(made.address).toBe('Switch#frame')
    const next = apply(made.patches)
    const component = resolve(next.tree, 'Switch')!
    expect(component.children.map((child) => child.name)).toEqual(['hint', 'frame'])
    const frame = resolve(next.tree, 'Switch#frame')!
    expect(frame.children.map((child) => child.name)).toEqual(['control', 'label'])
    expect(frame.attrs.layoutMode?.value).toBe('HORIZONTAL')
    expect(frame.attrs.primaryAxisSizingMode?.value).toBe('AUTO')
    expect(resolve(next.tree, 'Switch#frame/control')!.attrs.x).toBeUndefined()
  })

  it('places a frame on a free canvas where its contents were', () => {
    const made = frameSelectionFor(doc, ['a', 'b'])!
    const frame = resolve(apply(made.patches).tree, made.address)!
    expect([frame.attrs.x?.value, frame.attrs.y?.value]).toEqual([20, 10])
  })

  it('takes a default-state twin for its base layer, and refuses other states', () => {
    const made = frameSelectionFor(doc, ['Switch#state=default/root/control'])!
    expect(resolve(apply(made.patches).tree, 'Switch#frame/control')).not.toBeNull()
    expect(frameSelectionFor(doc, ['Switch#state=checked/root/control'])).toBeNull()
  })

  it('refuses layers under different parents, and the component itself', () => {
    expect(frameSelectionFor(doc, ['Switch#control', 'a'])).toBeNull()
    expect(frameSelectionFor(doc, ['Switch'])).toBeNull()
  })
})

describe('a layer moved into an auto layout', () => {
  it('leaves its position behind, because the layout places it', () => {
    const move = { op: 'move-node' as const, address: 'a', newParent: 'Switch', index: 0 }
    expect(positionsDroppedBy(doc, move)).toEqual([
      { op: 'remove', address: 'Switch#a', prop: 'x' },
      { op: 'remove', address: 'Switch#a', prop: 'y' },
    ])
    expect(resolve(apply([move, ...positionsDroppedBy(doc, move)]).tree, 'Switch#a')!.attrs.x).toBe(
      undefined,
    )
    // Out onto the free page it keeps where it was.
    const out = { op: 'move-node' as const, address: 'Switch#control', newParent: '', index: 0 }
    expect(positionsDroppedBy(doc, out)).toEqual([])
  })
})
