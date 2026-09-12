import { describe, expect, it } from 'vitest'
import { parseOrThrow, type UidxNode } from '@uidx/format'
import { editableProps, isMapped, parentOf, sectionsFor, selectedNode } from '../src/editable'

const PAGE = parseOrThrow(`---
id: fields
---

## Visual Contract

<Page>
  <Component name="Card" status="stable" version="2">
    <Frame name="root" cornerRadius="{radius#md}" opacity={0.5} visible={true}
      clipsContent={false} layoutMode="VERTICAL" notAThing={3}
      x={10} y={20} width={120} height={40}
      fills={[{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }]}>
      <Text name="label" characters="Hi" fontSize={14} />
      <Rectangle name="swatch" layoutPositioning="AUTO" x={5} />
      <Rectangle name="chip" layoutPositioning="ABSOLUTE" x={5} />
      <Rectangle name="pinned" layoutPositioning="ABSOLUTE" x={7} y={9} />
    </Frame>
  </Component>
</Page>
`)

/** A frame the page itself holds: no parent to give it edges, so no offsets. */
const LOOSE = parseOrThrow(`---
id: loose
---

## Visual Contract

<Page>
  <Frame name="board" width={1440} layoutMode="VERTICAL" />
</Page>
`)

const node = (address: string): UidxNode => selectedNode(PAGE.tree, [address])!
const field = (address: string, name: string) =>
  editableProps(node(address)).find((f) => f.name === name)!

describe('selectedNode', () => {
  it('finds a node by address', () => {
    expect(node('Card#root').name).toBe('root')
    expect(node('Card#root/label').element).toBe('Text')
  })

  it('edits nothing when several nodes are selected', () => {
    expect(selectedNode(PAGE.tree, ['Card#root', 'Card#root/label'])).toBeNull()
    expect(selectedNode(PAGE.tree, [])).toBeNull()
  })

  it('returns null for an address that is not in the tree', () => {
    expect(selectedNode(PAGE.tree, ['Card#ghost'])).toBeNull()
  })
})

describe('parentOf', () => {
  it("finds a node's parent by address", () => {
    expect(parentOf(PAGE.tree, 'Card#root/label')?.name).toBe('root')
  })

  it('returns null for the tree root', () => {
    expect(parentOf(PAGE.tree, '')).toBeNull()
  })

  it('returns null for an address not in the tree', () => {
    expect(parentOf(PAGE.tree, 'Card#ghost')).toBeNull()
  })
})

describe('editableProps', () => {
  it('picks a control from prop-ui, not the authored value', () => {
    expect(field('Card#root', 'layoutMode').control).toBe('enum')
    expect(field('Card#root', 'visible').control).toBe('boolean')
    expect(field('Card#root', 'x').control).toBe('number')
  })

  it('offers every legal value for an enum, and nothing else', () => {
    expect(field('Card#root', 'layoutMode').options).toEqual([
      'NONE',
      'HORIZONTAL',
      'VERTICAL',
      'GRID',
    ])
  })

  it('refuses to edit a prop the prop table does not know, and marks it ungroupable', () => {
    const unknown = field('Card#root', 'notAThing')
    expect(isMapped('notAThing')).toBe(false)
    expect(unknown.group).toBeNull()
    expect(unknown.control).toBe('readonly')
    expect(unknown.readonlyReason).toMatch(/not in the prop table/)
  })

  it('gives fills a paint control instead of a readonly row (C8)', () => {
    const fills = field('Card#root', 'fills')
    expect(isMapped('fills')).toBe(true)
    expect(fills.group).toBe('fill')
    expect(fills.control).toBe('paint')
    expect(fills.readonlyReason).toBeNull()
  })

  it('reports a token binding as bound, not as its number', () => {
    const bound = field('Card#root', 'cornerRadius')
    expect(bound.boundTo).toBe('radius#md')
    expect(bound.raw).toBe('"{radius#md}"')
    expect(bound.readonlyReason).toBeNull()
    // Bound values are still edited via NumberFieldRoot's detach affordance.
    expect(bound.control).toBe('number')
  })

  it("leaves out the node's name and its component metadata", () => {
    const names = editableProps(node('Card')).map((f) => f.name)
    expect(names).not.toContain('name')
    expect(names).not.toContain('status')
    expect(names).not.toContain('version')
  })

  it('keeps the authored order', () => {
    const names = editableProps(node('Card#root')).map((f) => f.name)
    expect(names.slice(0, 3)).toEqual(['cornerRadius', 'opacity', 'visible'])
  })

  it('offers a control for a boolean that is false', () => {
    const clips = field('Card#root', 'clipsContent')
    expect(clips.control).toBe('boolean')
    expect(clips.value).toBe(false)
    expect(clips.readonlyReason).toBeNull()
  })
})

describe('virtual unset fields (C8)', () => {
  it('synthesizes fills, strokes and effects on a node that never declared them', () => {
    const fields = editableProps(node('Card#root/swatch'))
    const virtual = fields.filter((f) => !f.authored).map((f) => f.name)
    // Since C7 every applicable prop is synthesized, not just these three —
    // what matters here is that the paintable ones still arrive editable.
    for (const name of ['fills', 'strokes', 'effects']) {
      expect(virtual, name).toContain(name)
    }
    const fills = fields.find((f) => f.name === 'fills')!
    expect(fills.value).toBeNull()
    expect(fills.control).toBe('paint')
    expect(fills.readonlyReason).toBeNull()
  })

  it('does not duplicate a prop the file already declares', () => {
    const fields = editableProps(node('Card#root'))
    expect(fields.filter((f) => f.name === 'fills')).toHaveLength(1)
    expect(fields.find((f) => f.name === 'fills')!.authored).toBe(true)
  })

  it('never synthesizes on the page root', () => {
    expect(editableProps(PAGE.tree).filter((f) => !f.authored)).toEqual([])
  })
})

describe('sectionsFor', () => {
  it('groups fields into sections, in SECTION_ORDER', () => {
    const root = node('Card#root')
    const parent = parentOf(PAGE.tree, root.address)
    const sections = sectionsFor(root, editableProps(root, parent), parent)
    // Stroke and Effects appear although the file never declared them: the
    // virtual unset fields (C8) put the section there so it can offer its `+`.
    expect(sections.map((s) => s.group)).toEqual([
      'position',
      'layout',
      'appearance',
      'fill',
      'stroke',
      'effects',
    ])
    expect(sections.map((s) => s.label)).toEqual([
      'Position',
      'Layout',
      'Appearance',
      'Fill',
      'Stroke',
      'Effects',
    ])
  })

  it('omits a section with nothing applicable — no Text section on a Frame', () => {
    const root = node('Card#root')
    const parent = parentOf(PAGE.tree, root.address)
    const sections = sectionsFor(root, editableProps(root, parent), parent)
    expect(sections.some((s) => s.group === 'text')).toBe(false)
  })

  it('a Text node shows the Text section; a Rectangle does not', () => {
    const text = node('Card#root/label')
    const textSections = sectionsFor(text, editableProps(text), parentOf(PAGE.tree, text.address))
    expect(textSections.some((s) => s.group === 'text')).toBe(true)

    const rect = node('Card#root/swatch')
    const rectSections = sectionsFor(rect, editableProps(rect), parentOf(PAGE.tree, rect.address))
    expect(rectSections.some((s) => s.group === 'text')).toBe(false)
  })

  it('keeps text and typography together at the top', () => {
    const text = node('Card#root/label')
    const sections = sectionsFor(text, editableProps(text), parentOf(PAGE.tree, text.address))
    expect(sections[0]?.group).toBe('text')
    expect(sections.find((s) => s.group === 'text')?.fields[0]?.field.name).toBe('characters')
  })

  it('puts the dimensions under Layout, not Position', () => {
    const root = node('Card#root')
    const parent = parentOf(PAGE.tree, root.address)
    const sections = sectionsFor(root, editableProps(root, parent), parent)
    const named = (group: string) =>
      sections
        .find((s) => s.group === group)!
        .fields.flatMap((f) => [f.field.name, f.pairedWith?.name])
    expect(named('layout')).toContain('width')
    expect(named('position')).not.toContain('width')
    expect(named('position')).toContain('x')
  })

  it('leads Appearance with Opacity, and trails it with the boolean pill', () => {
    const root = node('Card#root')
    const parent = parentOf(PAGE.tree, root.address)
    const sections = sectionsFor(root, editableProps(root, parent), parent)
    const names = sections.find((s) => s.group === 'appearance')!.fields.map((f) => f.field.name)
    expect(names[0]).toBe('opacity')
    expect(names.at(-1), 'Figma trails the section with the pill').toBe('visible')
  })

  it('pairs each axis with its far edge in Position, width with height in Layout', () => {
    const root = node('Card#root')
    const parent = parentOf(PAGE.tree, root.address)
    const sections = sectionsFor(root, editableProps(root, parent), parent)
    const rows = (group: string) => sections.find((s) => s.group === group)!.fields
    // Each pair surfaces once, as its first member. Since the CSS revision an
    // axis is one line — near edge beside far edge — so Left pairs Right and
    // Top pairs Bottom, and the panel's edges sit still whatever the pin.
    expect(rows('position').map((f) => f.field.name)).toContain('x')
    expect(rows('position').map((f) => f.field.name)).not.toContain('right')
    expect(rows('position').find((f) => f.field.name === 'x')?.pairedWith?.name).toBe('right')
    expect(rows('position').find((f) => f.field.name === 'y')?.pairedWith?.name).toBe('bottom')

    expect(rows('layout').map((f) => f.field.name)).toContain('width')
    expect(rows('layout').map((f) => f.field.name)).not.toContain('height')
    expect(rows('layout').find((f) => f.field.name === 'width')?.pairedWith?.name).toBe('height')
  })

  /**
   * A page-level frame has no far edges, and used to lose its pairing with them.
   *
   * `inOffsetContext` is false directly under `<Page>`, so `right` and `bottom`
   * are `absent` rather than loose — they are not offsets any resolver would
   * read, so a dashed row for them would be an offer nothing honours. But `x`
   * declares `pairs: 'right'` and `y` declares `pairs: 'bottom'`, so with the
   * partners gone both fell to the single-field branch and Position rendered as
   * two stacked half-width rows (reported 2026-09-02, with a screenshot of a
   * `<Frame name="states">`). Figma shows X beside Y, and so does every other
   * pair in this panel.
   *
   * So the near edges pair with *each other* when the far ones are not there:
   * one row, two inputs, which is what the section says everywhere else.
   */
  it('pairs Left with Top when there are no far edges to pair with', () => {
    const board = selectedNode(LOOSE.tree, ['board'])!
    const parent = parentOf(LOOSE.tree, 'board')
    const sections = sectionsFor(board, editableProps(board, parent), parent)
    const position = sections.find((s) => s.group === 'position')!

    // The far edges are absent, not merely unset — nothing offers them.
    const names = editableProps(board, parent).map((f) => f.name)
    expect(names).not.toContain('right')
    expect(names).not.toContain('bottom')

    const rows = position.fields.map((f) => f.field.name)
    expect(rows).toContain('x')
    expect(rows, "Top rides on Left's row rather than opening its own").not.toContain('y')
    expect(position.fields.find((f) => f.field.name === 'x')?.pairedWith?.name).toBe('y')
  })

  /**
   * Before C7 a pair collapsed to one field when the file authored only half
   * of it. Now the partner always has a row, so X and Y arrive together the
   * way Figma shows them — one of them merely unset.
   */
  it('pairs a field with its partner even when only one half is authored', () => {
    // `chip` has escaped the flow, so its edges are offsets — x={5} authored,
    // right unset — and the pair still renders as one line.
    const rect = node('Card#root/chip')
    const parent = parentOf(PAGE.tree, rect.address)
    const sections = sectionsFor(rect, editableProps(rect, parent), parent)
    const position = sections.find((s) => s.group === 'position')!
    const x = position.fields.find((f) => f.field.name === 'x')!
    expect(x.field.authored).toBe(true)
    expect(x.pairedWith?.name).toBe('right')
    expect(
      x.pairedWith && editableProps(rect, parent).find((f) => f.name === 'right')?.authored,
    ).toBe(false)
  })

  /**
   * The separate "Layout child" section is gone (parity spec §2) — its props
   * fold into Layout. The gate they carried is still theirs: participation in
   * a parent's flow is only a question where a parent has one.
   */
  it('shows the child-participation props only when the parent lays its children out', () => {
    const rect = node('Card#root/swatch')
    const parent = parentOf(PAGE.tree, rect.address) // Card#root, layoutMode="VERTICAL"
    const named = (sections: ReturnType<typeof sectionsFor>) =>
      sections.flatMap((s) => s.fields.flatMap((f) => [f.field.name, f.pairedWith?.name]))

    expect(named(sectionsFor(rect, editableProps(rect), parent))).toContain('layoutGrow')
    expect(named(sectionsFor(rect, editableProps(rect), null))).not.toContain('layoutGrow')
  })

  it('excludes an unmapped prop from every section', () => {
    const root = node('Card#root')
    const parent = parentOf(PAGE.tree, root.address)
    const sections = sectionsFor(root, editableProps(root, parent), parent)
    const allNames = sections.flatMap((s) =>
      s.fields.flatMap((f) => [f.field.name, f.pairedWith?.name]),
    )
    expect(allNames).not.toContain('notAThing')
  })
})

/**
 * Position is the parent's business (D4): a child of an auto-layout frame is
 * placed by it, so its X and Y are shown but not offered for editing — the way
 * Figma greys them out. `layoutPositioning: ABSOLUTE` is the escape hatch, and
 * a node that has taken it is positioned by hand again.
 */
describe('derived position', () => {
  const withParent = (address: string) => editableProps(node(address), parentOf(PAGE.tree, address))

  it('marks x and y read-only for a child the parent lays out', () => {
    const fields = withParent('Card#root/label')
    const x = fields.find((f) => f.name === 'x')!
    const y = fields.find((f) => f.name === 'y')!
    expect(x.readonlyReason).toMatch(/auto layout/i)
    expect(y.readonlyReason).toMatch(/auto layout/i)
    // Still a number row, so the paired X|Y box keeps its shape.
    expect(x.control).toBe('number')
  })

  it('marks an authored x too — the value shows, the scrub does not', () => {
    const x = withParent('Card#root/swatch').find((f) => f.name === 'x')!
    expect(x.authored).toBe(true)
    expect(x.readonlyReason).toMatch(/auto layout/i)
  })

  it('leaves x editable for a child that escaped with absolute positioning', () => {
    const x = withParent('Card#root/pinned').find((f) => f.name === 'x')!
    expect(x.readonlyReason).toBeNull()
  })

  it('leaves x editable when the parent does not lay children out', () => {
    const x = withParent('Card#root').find((f) => f.name === 'x')!
    expect(x.readonlyReason).toBeNull()
  })

  it('touches nothing but position', () => {
    const opacity = withParent('Card#root/swatch').find((f) => f.name === 'opacity')!
    expect(opacity.readonlyReason).toBeNull()
  })
})

/**
 * Figma keeps the absolute-position toggle with Position, because that is the
 * question it answers — who places this node. It exists only where there is a
 * flow to escape: a child of an auto-layout frame.
 */
describe('absolute position toggle placement', () => {
  const sectionNames = (address: string, group: string): string[] => {
    const target = node(address)
    const parent = parentOf(PAGE.tree, address)
    const sections = sectionsFor(target, editableProps(target, parent), parent)
    return (
      sections
        .find((s) => s.group === group)
        ?.fields.flatMap((f) => [f.field.name, f.pairedWith?.name]) ?? []
    ).filter((n): n is string => n !== undefined)
  }

  it('sits in Position, beside the x/y it unlocks', () => {
    const names = sectionNames('Card#root/label', 'position')
    expect(names).toContain('layoutPositioning')
    // Right after the pair it governs, the way Figma lays the section out.
    expect(names.indexOf('layoutPositioning')).toBe(names.indexOf('x') + 2)
    // It is a Position row, not a Layout one — the merged Layout section
    // holds participation (`layoutGrow`, `layoutAlign`), not placement.
    expect(sectionNames('Card#root/label', 'layout')).not.toContain('layoutPositioning')
  })

  it('does not exist where there is no flow to escape', () => {
    expect(sectionNames('Card#root', 'position')).not.toContain('layoutPositioning')
  })
})
