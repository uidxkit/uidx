import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'

import {
  canInsert,
  canRemove,
  reorderFor,
  moveFor,
  parentOf,
  remapAddress,
  renameFor,
} from '../src/layer-moves'

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
  <Component name="Button/Pair" status="stable">
    <Frame name="one" />
    <Frame name="two" />
  </Component>
  <Component name="Button/Set" status="stable" variants={{ state: ['default', 'hover'] }}>
    <Variant state="default"><Frame name="root" /></Variant>
    <Variant state="hover"><Frame name="root" /></Variant>
  </Component>
  <Frame name="loose">
    <Text name="label" characters="Hi" />
  </Frame>
</Page>
`)

const A = 'Button/Primary#container'

describe('parentOf', () => {
  it('finds the parent node of an address', () => {
    expect(parentOf(DOC, `${A}/icon`)?.address).toBe(A)
    expect(parentOf(DOC, 'Button/Primary')?.address).toBe('')
    expect(parentOf(DOC, '')).toBeNull()
  })
})

describe('moveFor', () => {
  /**
   * `moveNode` filters the dragged node out of the sibling list before
   * clamping the index (patch.ts:341), so every index here is computed against
   * the list as it will be *after* removal. Computing it against the list as
   * displayed is the classic reorder off-by-one.
   */
  it('drops above a sibling using the post-removal index', () => {
    expect(moveFor(DOC, `${A}/label`, `${A}/icon`, 'above')).toEqual({
      op: 'move-node',
      address: `${A}/label`,
      newParent: A,
      index: 0,
    })
  })

  it('drops below a sibling', () => {
    expect(moveFor(DOC, `${A}/icon`, `${A}/label`, 'below')).toEqual({
      op: 'move-node',
      address: `${A}/icon`,
      newParent: A,
      index: 1,
    })
  })

  it('drops into a container, appending', () => {
    expect(moveFor(DOC, `${A}/icon`, `${A}/slot`, 'into')).toEqual({
      op: 'move-node',
      address: `${A}/icon`,
      newParent: `${A}/slot`,
      index: 0,
    })
  })

  it('refuses to move the root page', () => {
    expect(moveFor(DOC, '', `${A}/icon`, 'above')).toBeNull()
  })

  it('refuses a drop into the dragged node or its own descendant', () => {
    // `slot` is a Frame, so this reaches the descendant guard instead of
    // short-circuiting on "the target cannot have children".
    expect(moveFor(DOC, A, `${A}/slot`, 'into')).toBeNull()
    expect(moveFor(DOC, A, A, 'into')).toBeNull()
  })

  it("drags a component's child out, now that one is not the cap (ADR 0008 §1)", () => {
    expect(moveFor(DOC, A, 'loose', 'into')).not.toBeNull()
  })

  it("refuses to drag a variant's sole child out, which would leave UIDX104", () => {
    expect(moveFor(DOC, 'Button/Set#state=default/root', 'loose', 'into')).toBeNull()
  })

  it('refuses a drop into an element that cannot have children', () => {
    expect(moveFor(DOC, `${A}/icon`, `${A}/label`, 'into')).toBeNull()
  })

  it('refuses an element the target may not contain', () => {
    // <Component> is a page child only — it may not nest inside a frame.
    // `loose` sits outside the dragged subtree, so the descendant guard does
    // not fire first and the legality check is what refuses this.
    expect(moveFor(DOC, 'Button/Primary', 'loose', 'into')).toBeNull()
  })

  it('refuses a move that would duplicate a sibling name', () => {
    // `loose` already has a child called `label`.
    expect(moveFor(DOC, `${A}/label`, 'loose', 'into')).toBeNull()
  })
})

describe('renameFor', () => {
  it('writes the new name onto the node', () => {
    expect(renameFor(DOC, `${A}/icon`, 'glyph')).toEqual({
      op: 'set',
      address: `${A}/icon`,
      prop: 'name',
      value: 'glyph',
    })
  })

  it('refuses a name a sibling already has', () => {
    expect(renameFor(DOC, `${A}/icon`, 'label')).toBeNull()
  })

  it('refuses renaming the root page, whose name is the frontmatter id', () => {
    expect(renameFor(DOC, '', 'other')).toBeNull()
  })

  it('refuses an empty name', () => {
    expect(renameFor(DOC, `${A}/icon`, '  ')).toBeNull()
  })

  /**
   * Null here means "no patch", not "bad name" — there is simply nothing to
   * write. The two are indistinguishable from this side, so the caller has to
   * tell them apart: `commitRename` closes on an unchanged name before it ever
   * asks, or an author who opened a rename and changed their mind is shown a
   * refusal (`LayersPane.vue`).
   */
  it('has no patch for a rename to the name it already has', () => {
    expect(renameFor(DOC, `${A}/icon`, 'icon')).toBeNull()
  })
})

describe('remapAddress', () => {
  it('moves a descendant address under the new name', () => {
    expect(remapAddress(A, 'Button/Primary#box', `${A}/label`)).toBe('Button/Primary#box/label')
  })

  it('moves the renamed address itself', () => {
    expect(remapAddress(A, 'Button/Primary#box', A)).toBe('Button/Primary#box')
  })

  it('leaves an unrelated address alone', () => {
    expect(remapAddress(A, 'Button/Primary#box', 'loose/label')).toBe('loose/label')
  })

  /**
   * The trap. `/` is a name character inside an entity name, so a component
   * called `Button/Primary` and one called `Button/Primary/Old` are siblings,
   * not parent and child. Only `#` bounds an entity.
   */
  it('does not remap a different entity that shares a name prefix', () => {
    expect(remapAddress('Button/Primary', 'Button/Secondary', 'Button/Primary/Old#root')).toBe(
      'Button/Primary/Old#root',
    )
  })

  it('remaps across the entity boundary when the entity is renamed', () => {
    expect(remapAddress('Button/Primary', 'Button/Secondary', `${A}/label`)).toBe(
      'Button/Secondary#container/label',
    )
  })

  /** Inside an entity the boundary is `/`, and a longer sibling name must not match. */
  it('does not remap a sibling whose name extends the renamed one', () => {
    expect(remapAddress(A, 'Button/Primary#box', `${A}Extra/label`)).toBe(`${A}Extra/label`)
  })

  it('leaves every address alone when asked to rename the page', () => {
    expect(remapAddress('', 'anything', `${A}/label`)).toBe(`${A}/label`)
  })

  /**
   * D6. A reparent can cross the entity boundary, and then the descendant's
   * own separators change: a `Frame` promoted onto the page is an entity now,
   * so its children join with `#` where they used to join with `/`. A string
   * splice keeps the old separators; only rejoining through `addressOf` gets
   * the boundary right.
   */
  it('promotes a descendant across the entity boundary with the right separator', () => {
    expect(remapAddress(`${A}/slot`, 'slot', `${A}/slot/inner`)).toBe('slot#inner')
  })

  it('promotes a deeper descendant with one `#` and then `/`', () => {
    expect(remapAddress(`${A}/slot`, 'slot', `${A}/slot/inner/leaf`)).toBe('slot#inner/leaf')
  })

  it('demotes an entity into another entity with the right separator', () => {
    expect(remapAddress('loose', `${A}/loose`, 'loose#label')).toBe(`${A}/loose/label`)
  })
})

describe('canInsert', () => {
  it('allows a shape inside a plain frame', () => {
    expect(canInsert(DOC, `${A}/slot`, 'Rectangle')).toBe(true)
  })

  it('refuses a Component anywhere but the page — it is a declaration', () => {
    expect(canInsert(DOC, '', 'Component')).toBe(true)
    expect(canInsert(DOC, `${A}/slot`, 'Component')).toBe(false)
  })

  it('allows a second child of a Component, which is a frame now (ADR 0008 §1)', () => {
    // v1 capped a component at one child because it was a wrapper *around* a
    // frame. ADR 0008 made it the frame, so it holds what a frame holds. The
    // rule did not disappear — `<Variant>` still has it, for the reason §2
    // gives: a variant is one state's tree and `arrangeVariants` measures one
    // box per variant. So this is the rule moving, not being dropped.
    expect(canInsert(DOC, 'Button/Primary', 'Frame')).toBe(true)
    expect(canInsert(DOC, 'Button/Pair', 'Frame')).toBe(true)
  })

  it('still caps a Variant at one child, which is where the rule went', () => {
    expect(canInsert(DOC, 'Button/Set#state=default', 'Frame')).toBe(false)
  })

  it('refuses anything inside a node that cannot have children', () => {
    expect(canInsert(DOC, `${A}/label`, 'Rectangle')).toBe(false)
  })
})

describe('canRemove', () => {
  it('allows an ordinary node', () => {
    expect(canRemove(DOC, `${A}/icon`)).toBe(true)
    expect(canRemove(DOC, 'loose')).toBe(true)
  })

  it("allows a Component's child, which is no longer load-bearing (ADR 0008 §1)", () => {
    // A `<Component>` with no children parses, so taking its last one out
    // leaves a document the patcher accepts. The refusal that used to live
    // here was the one-child rule wearing a different coat.
    expect(canRemove(DOC, A)).toBe(true)
    expect(canRemove(DOC, 'Button/Pair#one')).toBe(true)
  })

  it("still refuses a Variant's sole child, which UIDX104 still requires", () => {
    expect(canRemove(DOC, 'Button/Set#state=default/root')).toBe(false)
  })

  it('refuses the page itself, and an address that resolves to nothing', () => {
    expect(canRemove(DOC, '')).toBe(false)
    expect(canRemove(DOC, 'nope')).toBe(false)
  })
})

describe('reorderFor', () => {
  it('moves a child to the slot an index names', () => {
    expect(reorderFor(DOC, `${A}/icon`, 2)).toEqual({
      op: 'move-node',
      address: `${A}/icon`,
      newParent: A,
      index: 2,
    })
  })

  /**
   * The index counts siblings with the dragged child already removed, so
   * "where it already is" is its own original index — not one more or one less
   * depending on which way the drag went.
   */
  it('commits nothing for a drag that lands back in its own slot', () => {
    expect(reorderFor(DOC, `${A}/icon`, 0)).toBeNull()
    expect(reorderFor(DOC, `${A}/label`, 1)).toBeNull()
    expect(reorderFor(DOC, `${A}/slot`, 2)).toBeNull()
  })

  it('clamps an index past the end rather than refusing it', () => {
    expect(reorderFor(DOC, `${A}/icon`, 99)).toMatchObject({ index: 2 })
  })

  it('has nothing to reorder for an only child', () => {
    expect(reorderFor(DOC, 'loose/label', 0)).toBeNull()
    expect(reorderFor(DOC, A, 1)).toBeNull()
  })
})
