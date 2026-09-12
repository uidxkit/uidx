import { describe, expect, it } from 'vitest'
import { parseOrThrow, resolve } from '@uidx/format'
import { createSpec } from '@uidx/schema'

import { canInsert, moveFor } from '../src/layer-moves'
import {
  convertibleToSlot,
  convertToSlotFor,
  deleteSlotContentsFor,
  firstFillFor,
  newSlotFor,
  resetSlotFor,
  slotSceneIds,
  slotTargetFor,
} from '../src/slot-edits'
import { componentIndex, layerRows } from '../src/layer-rows'
import { editableProps, parentOf, sectionsFor } from '../src/editable'
import { LAYER_ICONS } from '../src/layer-icons'

/**
 * What the editor may do around a slot (story F5).
 *
 * The rules under test are the ones a table keyed by element cannot state, and
 * that therefore have to be right in more than one place: an `<Instance>` is a
 * container now, but for exactly one element — and the same `<Slot>` owns its
 * whole layout on one side of that boundary and nothing but its name on the
 * other.
 */
const DOC = parseOrThrow(`---
id: page
---

## Visual Contract

<Page>
  <Component name="Card" status="stable">
    <Frame name="container" layoutMode="VERTICAL">
      <Text name="title" characters="Title" />
      <Slot name="body" layoutMode="VERTICAL" itemSpacing={8} />
      <Frame name="footer" layoutMode="HORIZONTAL" />
      <Rectangle name="chip" width={20} height={8} />
    </Frame>
  </Component>
  <Instance name="card-1" component="Card">
    <Slot name="body">
      <Text name="figure" characters="$42,180" />
    </Slot>
  </Instance>
  <Instance name="card-2" component="Card" />
  <Frame name="loose" layoutMode="VERTICAL">
    <Text name="spare" characters="spare" />
    <Vector name="art" vectorPaths={[{ windingRule: 'NONZERO', data: 'M0 0L4 4Z' }]} />
    <Rectangle name="loose-chip" width={20} height={8} />
  </Frame>
</Page>
`)

const node = (address: string) => resolve(DOC.tree, address)!

describe('what an <Instance> may hold, now that it holds anything', () => {
  it('takes a slot fill', () => {
    expect(canInsert(DOC, 'card-1', 'Slot')).toBe(true)
  })

  it('takes nothing else — its other children are the component’s', () => {
    for (const element of ['Text', 'Frame', 'Rectangle', 'Ellipse', 'Vector', 'Instance']) {
      expect(canInsert(DOC, 'card-1', element)).toBe(false)
    }
  })

  it('refuses a drag that would put a scene node directly inside it', () => {
    expect(moveFor(DOC, 'loose#spare', 'card-1', 'into')).toBeNull()
  })

  it('accepts a drag into the fill, which is ordinary authored content', () => {
    expect(moveFor(DOC, 'loose#spare', 'card-1#body', 'into')).toEqual({
      op: 'move-node',
      address: 'loose#spare',
      newParent: 'card-1#body',
      index: 1,
    })
  })
})

describe('where a <Slot> may be made', () => {
  it('is refused on a page, where a hole would have nobody to fill it', () => {
    expect(canInsert(DOC, '', 'Slot')).toBe(false)
  })

  it('is allowed as a component’s direct child, since ADR 0008 §1', () => {
    // The component is the frame now, so this is the same position as any
    // other frame's inside — see the conversion test below for the reasoning.
    expect(canInsert(DOC, 'Card', 'Slot')).toBe(true)
  })

  it('is allowed inside a frame, which is where a hole belongs', () => {
    expect(canInsert(DOC, 'Card#container', 'Slot')).toBe(true)
  })

  it('is refused outside a component, at any depth', () => {
    expect(canInsert(DOC, 'loose', 'Slot')).toBe(false)
    expect(moveFor(DOC, 'Card#container/body', 'loose', 'into')).toBeNull()
  })

  it('is refused inside a fill — a hole nothing could declare', () => {
    expect(canInsert(DOC, 'card-1#body', 'Slot')).toBe(false)
    expect(moveFor(DOC, 'Card#container/body', 'card-1#body', 'into')).toBeNull()
  })
})

describe('the panel, on each side of the instance boundary', () => {
  const sections = (address: string) => {
    const target = node(address)
    const parent = parentOf(DOC.tree, address)
    return sectionsFor(target, editableProps(target, parent), parent)
  }

  it('offers the declaration its layout — a card decides how its body sits', () => {
    const names = sections('Card#container/body').flatMap((s) => s.fields.map((r) => r.field.name))
    expect(names).toContain('layoutMode')
    expect(names).toContain('itemSpacing')
  })

  it('offers a fill nothing at all, because the grammar accepts nothing', () => {
    // Without this the panel would show `layoutMode` on a node whose write
    // `uidx check` rejects as UIDX131 — a control that cannot be obeyed.
    expect(sections('card-1#body')).toEqual([])
  })
})

describe('the pieces a gesture needs', () => {
  it('draws a slot in the rail, outlined like the hole it is', () => {
    expect(LAYER_ICONS.Slot).toBeTruthy()
  })

  it('makes a slot that flows, and paints nothing of its own', () => {
    expect(createSpec('Slot', 'body', { at: null, size: null })).toEqual({
      element: 'Slot',
      attrs: { name: 'body', layoutMode: 'VERTICAL' },
    })
  })
})

describe('the "New slot" gesture', () => {
  it('inserts into the selection when it can hold a hole', () => {
    expect(slotTargetFor(DOC, ['Card#container'])).toBe('Card#container')
  })

  it('inserts beside the selection when it cannot', () => {
    // A `<Text>` holds nothing, so the hole goes next to it — "put a hole
    // here" rather than "name the container first".
    expect(slotTargetFor(DOC, ['Card#container/title'])).toBe('Card#container')
  })

  it('is unavailable where no slot may go, so the button can be disabled', () => {
    expect(slotTargetFor(DOC, [])).toBeNull()
    expect(slotTargetFor(DOC, ['card-1#body/figure'])).toBeNull()
    // No mixed-value model for several nodes at once (C5's open deferral).
    expect(slotTargetFor(DOC, ['Card#container', 'Card#container/title'])).toBeNull()
  })

  it('puts one inside a selected component, which is a container now', () => {
    // Before ADR 0008 §1 this was null twice over: the component was full, and
    // a slot could not be its direct child. Both reasons are gone.
    expect(slotTargetFor(DOC, ['Card'])).toBe('Card')
  })

  it('is one patch, and hands back the address so the caller can select it', () => {
    const made = newSlotFor(DOC, ['Card#container'])!
    expect(made.patches).toEqual([
      {
        op: 'insert-node',
        parent: 'Card#container',
        index: 4,
        node: { element: 'Slot', attrs: { name: 'slot-1', layoutMode: 'VERTICAL' } },
      },
    ])
    // ADR 0007 §6: with no empty-slot indicator, an unselected new slot is
    // one the author cannot find.
    expect(made.address).toBe('Card#container/slot-1')
  })
})

describe('the layers rail, inside an instance', () => {
  const rows = layerRows(DOC, componentIndex([DOC]))
  const row = (address: string) => rows.find((r) => r.address === address)

  it('shows the fill instead of the default the definition supplies', () => {
    // The rail mirrors `expandInstance`, and the two have to agree: the canvas
    // draws `figure`, so the rail must not still be showing `placeholder`.
    expect(row('card-1#body/figure')).toBeDefined()
    expect(row('card-1#container/body/placeholder')).toBeUndefined()
  })

  it('marks fill content authored, so it selects, renames and drags', () => {
    // The story F3 named this gap out loud: an instance had nothing selectable
    // inside it. Slot fill is the first content that does.
    expect(row('card-1#body')!.generated).toBe(false)
    expect(row('card-1#body/figure')!.generated).toBe(false)
  })

  it('leaves the clones beside it generated, and therefore inert', () => {
    expect(row('card-1#container/title')!.generated).toBe(true)
  })

  it('carries the address, not the scene id — they diverge here', () => {
    // ADR 0007 §3. The rail selects by address; `sceneIdOf` is the canvas's job.
    expect(row('card-1#container/body/figure')).toBeUndefined()
  })
})

describe('convert a frame into a hole (F14 makes it expressible)', () => {
  it('offers it for a frame inside a component', () => {
    expect(convertibleToSlot(DOC, ['Card#container/footer'])).toBe('Card#container/footer')
  })

  it("offers a component's direct child, now that the component is the frame", () => {
    // ADR 0007 §1 refused this, and its reason was the one-child rule: the sole
    // child *was* the whole content, so a slot there left a component that was
    // nothing but a hole. ADR 0008 made the component the frame — it carries
    // its own fills, size and strokes — so a slot inside one is a painted,
    // sized frame with a hole in it, which is a contract. The Figma parity
    // argument re-points too: the top layer a slot may not be bound to is now
    // the `<Component>` itself, and `NEVER_A_SLOT` already refuses that.
    expect(convertibleToSlot(DOC, ['Card#container'])).toBe('Card#container')
  })

  it('refuses what could not legally be a slot afterwards', () => {
    expect(convertibleToSlot(DOC, ['loose'])).toBeNull() // on the page
    expect(convertibleToSlot(DOC, ['card-1#body'])).toBeNull() // already one
    expect(convertibleToSlot(DOC, ['card-1'])).toBeNull() // an <Instance>
    expect(convertibleToSlot(DOC, ['Card'])).toBeNull() // a <Component>
  })

  it('refuses a node carrying a prop no slot could mean', () => {
    // The §3.3 prop whitelist is global, so `<Slot characters="…">` would
    // parse and `uidx check` would say nothing — a document that validates and
    // means nothing. `appliesTo` is the per-element table that can refuse it.
    expect(convertibleToSlot(DOC, ['Card#container/title'])).toBeNull() // characters
    expect(convertibleToSlot(DOC, ['loose#art'])).toBeNull() // vectorPaths
  })

  it('offers it for a plain box inside a component, which is what a slot is', () => {
    expect(convertibleToSlot(DOC, ['Card#container/chip'])).toBe('Card#container/chip')
  })

  it('refuses one outside a component, however deeply nested', () => {
    // ADR 0007 §1's reason is "outside a component", not "on the page": only
    // an <Instance> fills a slot, and an instance names a <Component>.
    expect(convertibleToSlot(DOC, ['loose#loose-chip'])).toBeNull()
  })

  it('is one retag, and the address does not change', () => {
    const made = convertToSlotFor(DOC, ['Card#container/footer'])!
    expect(made.patches).toEqual([
      { op: 'retag', address: 'Card#container/footer', element: 'Slot' },
    ])
    expect(made.address).toBe('Card#container/footer')
  })
})

describe("ADR 0007 §2's other two states, as gestures", () => {
  it('resets a slot by removing the fill, so the default comes back', () => {
    expect(resetSlotFor(DOC, 'card-1#body')).toEqual([
      { op: 'remove-node', address: 'card-1#body' },
    ])
  })

  it('empties a fill without removing it — a different document, a different render', () => {
    expect(deleteSlotContentsFor(DOC, 'card-1#body')).toEqual([
      { op: 'remove-node', address: 'card-1#body/figure' },
    ])
  })

  it('has nothing to say about a slot that is not a fill', () => {
    expect(resetSlotFor(DOC, 'Card#container/body')).toBeNull()
    expect(deleteSlotContentsFor(DOC, 'Card#container/body')).toBeNull()
  })
})

describe('the first fill, by dropping into a hole nobody has filled', () => {
  const holes = slotSceneIds(DOC, componentIndex([DOC]))

  it('knows the scene id the canvas hit-tests, not the address', () => {
    // ADR 0007 §3 again: the slot's scene id follows the definition.
    expect(holes.get('card-2#container/body')).toEqual({ instance: 'card-2', slot: 'body' })
  })

  it('creates the wrapper and moves into it, in one envelope', () => {
    const made = firstFillFor(DOC, 'loose#spare', ['card-2#container/body'], holes)!
    expect(made.patches).toEqual([
      {
        op: 'insert-node',
        parent: 'card-2',
        index: 0,
        node: { element: 'Slot', attrs: { name: 'body' } },
      },
      { op: 'move-node', address: 'loose#spare', newParent: 'card-2#body', index: 0 },
    ])
    expect(made.address).toBe('card-2#body/spare')
  })

  it('stands aside once the slot is filled — that is an ordinary reparent', () => {
    expect(firstFillFor(DOC, 'loose#spare', ['card-1#container/body'], holes)).toBeNull()
  })
})
