import { describe, expect, it } from 'vitest'
import { applyPatches } from '@uidx/format'
import { parseOrThrow } from '@uidx/format'

import { dropTargetFor, insertTargetFor, reparentTo } from '../src/drop-target'

/**
 * `container` holds a leaf, a text and an empty frame; `loose` is a second
 * page-level frame whose own text is named `label` too, so a cross-container
 * drop can collide on a sibling name. `empty` is somewhere to land.
 */
const DOC = parseOrThrow(`---
id: page
---

## Visual Contract

<Page>
  <Component name="Button/Primary" status="stable">
    <Frame name="container">
      <Vector name="icon" />
      <Text name="label" characters="Hi" />
      <Frame name="slot" />
    </Frame>
  </Component>
  <Frame name="loose">
    <Text name="label" characters="Hi" />
  </Frame>
  <Frame name="empty" />
  <Rectangle name="placed" x={1} y={2} />
</Page>
`)

const CONTAINER = 'Button/Primary#container'
const ICON = `${CONTAINER}/icon`
const LABEL = `${CONTAINER}/label`
const SLOT = `${CONTAINER}/slot`
const PAGE = ''

describe('dropTargetFor', () => {
  it('reparents into the innermost container under the pointer', () => {
    expect(dropTargetFor(DOC, ICON, [SLOT, CONTAINER, 'Button/Primary', PAGE])).toEqual({
      parent: SLOT,
      address: `${SLOT}/icon`,
      patches: [{ op: 'move-node', address: ICON, newParent: SLOT, index: 0 }],
    })
  })

  it('is no move at all when the pointer is still over the node’s own parent', () => {
    expect(dropTargetFor(DOC, ICON, [CONTAINER, 'Button/Primary', PAGE])).toBeNull()
  })

  it('steps past the dragged node and anything inside it', () => {
    // A drag carries its own subtree under the pointer, so the chain arrives
    // with the dragged node in it. `empty` is the first thing that is not.
    expect(dropTargetFor(DOC, 'loose', ['loose/label', 'loose', 'empty', PAGE])?.parent).toBe(
      'empty',
    )
  })

  it('steps past something under the pointer that can never take a child', () => {
    expect(dropTargetFor(DOC, ICON, ['loose/label', 'loose', PAGE])?.parent).toBe('loose')
  })

  it('stops at a real container that refuses this particular move', () => {
    // `loose` already has a `label`. Reparenting somewhere else instead would
    // perform a gesture nobody asked for — the same rule the rail applies.
    expect(dropTargetFor(DOC, LABEL, ['loose', PAGE])).toBeNull()
  })

  it('promotes a node to the page when the drop lands on the background', () => {
    expect(dropTargetFor(DOC, ICON, [PAGE])).toEqual({
      parent: PAGE,
      address: 'icon',
      patches: [{ op: 'move-node', address: ICON, newParent: PAGE, index: 4 }],
    })
  })

  it('has nothing to say about a pointer over nothing', () => {
    expect(dropTargetFor(DOC, ICON, [])).toBeNull()
  })

  it('refuses to move the page itself', () => {
    expect(dropTargetFor(DOC, PAGE, ['empty'])).toBeNull()
  })
})

describe('keeping a dropped node where the pointer left it', () => {
  it('adds x and y after the move, addressed to where the node will answer', () => {
    // `icon` has neither, so the file has to gain them.
    const drop = dropTargetFor(DOC, ICON, [SLOT], { x: 12, y: 34 })
    expect(drop?.patches).toEqual([
      { op: 'move-node', address: ICON, newParent: SLOT, index: 0 },
      { op: 'add', address: `${SLOT}/icon`, prop: 'x', value: 12 },
      { op: 'add', address: `${SLOT}/icon`, prop: 'y', value: 34 },
    ])
  })

  it('sets them instead where the file already states a position', () => {
    const drop = dropTargetFor(DOC, 'placed', ['empty'], { x: 5, y: 6 })
    expect(drop?.patches.slice(1)).toEqual([
      { op: 'set', address: 'empty#placed', prop: 'x', value: 5 },
      { op: 'set', address: 'empty#placed', prop: 'y', value: 6 },
    ])
  })

  it('writes no position at all when the caller says the new parent places it', () => {
    // Null is how the host says "the new parent lays its children out", which
    // makes the position the layout's answer and not the author's (D4).
    expect(dropTargetFor(DOC, ICON, [SLOT], null)?.patches).toHaveLength(1)
    expect(dropTargetFor(DOC, ICON, [SLOT])?.patches).toHaveLength(1)
  })
})

describe('insertTargetFor', () => {
  it('draws into the innermost container under the pointer', () => {
    expect(insertTargetFor(DOC, 'Rectangle', [SLOT, CONTAINER, 'Button/Primary', PAGE])).toBe(SLOT)
  })

  it('steps past a container that cannot take this element, rather than refusing', () => {
    // A `<Component>` belongs on the page. Drawing one over a frame is not a
    // mis-aimed gesture — it is an element that lives a level up.
    expect(insertTargetFor(DOC, 'Component', [SLOT, CONTAINER, 'Button/Primary', PAGE])).toBe(PAGE)
  })

  it('draws into a component, which holds what a frame holds (ADR 0008 §1)', () => {
    // This used to land on the page: `Button/Primary` "already has its one
    // child". A component is a frame now, so a shape drawn over one goes in,
    // the same way it would over any other container under the pointer.
    expect(insertTargetFor(DOC, 'Rectangle', ['Button/Primary', PAGE])).toBe('Button/Primary')
  })

  it('draws onto the page when the pointer is over empty canvas', () => {
    expect(insertTargetFor(DOC, 'Frame', [PAGE])).toBe(PAGE)
  })

  it('has nowhere to put a node when nothing under the pointer will take it', () => {
    expect(insertTargetFor(DOC, 'Rectangle', [])).toBeNull()
  })
})

/**
 * A pinned node crossing a parent boundary (ADR 0011, found live).
 *
 * The pin travelled with the node, and a page has no edges to measure from —
 * so the whole move was refused (UIDX135) at the moment the author let go.
 * The move now says everything it means, the way the absolute-position toggle
 * does: what cannot come along is taken off in the same envelope.
 */
describe('reparentTo, for a pinned node', () => {
  const PINNED_DOC = parseOrThrow(
    [
      '---',
      'id: pinned-drop',
      '---',
      '',
      '## Visual Contract',
      '',
      '<Page>',
      '  <Component name="Card">',
      '    <Frame name="body" width={320} height={200}>',
      '      <Frame name="close" width={20} height={20} right={16} y={16} constraints={{ horizontal: \'MAX\' }} />',
      '    </Frame>',
      '  </Component>',
      '  <Component name="Tray">',
      '    <Frame name="dock" width={200} height={100} />',
      '    <Frame name="row" layoutMode="HORIZONTAL" />',
      '  </Component>',
      '</Page>',
      '',
    ].join('\n'),
  )
  const CLOSE = 'Card#body/close'

  it('strips the pin on a drop onto the page, and lands where the pointer said', () => {
    const target = reparentTo(PINNED_DOC, CLOSE, '', {
      x: 480,
      y: 90,
      node: { width: 20, height: 20 },
      parent: { width: 0, height: 0 },
    })
    const props = target!.patches.map((p) => ('prop' in p ? `${p.op} ${p.prop}` : p.op))
    // Out, then the move, then the plain coordinates — every intermediate
    // state a legal document, since the server re-parses between ops.
    expect(props).toEqual(['remove right', 'remove constraints', 'move-node', 'add x', 'set y'])
    expect(target!.patches).toContainEqual({ op: 'add', address: 'close', prop: 'x', value: 480 })
  })

  it('strips the pin on a drop into a flowing frame, whose layout now places it', () => {
    const target = reparentTo(PINNED_DOC, CLOSE, 'Tray#row', null)
    const props = target!.patches.map((p) => ('prop' in p ? `${p.op} ${p.prop}` : p.op))
    expect(props).toEqual(['remove right', 'remove constraints', 'move-node'])
  })

  it('keeps the pin on a drop into a plain frame, re-measured from its edges', () => {
    // Dropped at x=130 inside a 200-wide dock: right = 200 − 130 − 20 = 50.
    const into = reparentTo(PINNED_DOC, CLOSE, 'Tray#dock', {
      x: 130,
      y: 30,
      node: { width: 20, height: 20 },
      parent: { width: 200, height: 100 },
    })
    const props = into!.patches.map((p) => ('prop' in p ? `${p.op} ${p.prop}` : p.op))
    // `y` is authored on close, so the vertical MIN axis re-lands as a set.
    expect(props).toEqual(['set right', 'set y', 'move-node'])
    expect(into!.patches).toContainEqual({ op: 'set', address: CLOSE, prop: 'right', value: 50 })
    expect(into!.patches).toContainEqual({ op: 'set', address: CLOSE, prop: 'y', value: 30 })
  })

  it('applies cleanly, which is the whole point of the ordering', () => {
    const source = PINNED_DOC.source
    for (const parent of ['', 'Tray#row', 'Tray#dock']) {
      const target = reparentTo(PINNED_DOC, CLOSE, parent, {
        x: 40,
        y: 30,
        node: { width: 20, height: 20 },
        parent: { width: 200, height: 100 },
      })
      expect(() => applyPatches(source, target!.patches), parent).not.toThrow()
    }
  })
})
