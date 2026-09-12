import { describe, expect, it } from 'vitest'
import { CODES, parse, parseOrThrow, resolve, slotFills, slots } from '../src/index.js'

/**
 * `<Slot>`'s half of the grammar (story F5, ADR 0007).
 *
 * The load-bearing rule is that one element does two jobs and its *position*
 * decides which — so every test here is about where a `<Slot>` sits, not about
 * what it says.
 *
 * Whether the slot a fill names is one its component declares is a cross-page
 * question, so it lives in `buildSymbolTable` beside the same question about a
 * component name.
 */
const contractOf = (body: string) => `---\nid: t\n---\n\n## Visual Contract\n\n${body}\n`
const PAGE = (body: string) => contractOf(`<Page>\n${body}\n</Page>`)
const codes = (source: string): string[] => parse(source).diagnostics.map((d) => d.code)

/** A component whose `container` frame holds whatever is passed in. */
const CARD = (inside: string) =>
  `  <Component name="Card" status="draft">\n` +
  `    <Frame name="container" layoutMode="VERTICAL">\n` +
  `${inside}\n` +
  `    </Frame>\n` +
  `  </Component>`

describe('<Slot> — where it may sit', () => {
  it('is legal inside a frame, and carries its own layout and default content', () => {
    const doc = parseOrThrow(
      PAGE(
        CARD(
          `      <Slot name="body" layoutMode="VERTICAL" itemSpacing={8}>\n` +
            `        <Text name="placeholder" characters="Body goes here" />\n` +
            `      </Slot>`,
        ),
      ),
    )
    const slot = resolve(doc.tree, 'Card#container/body')!
    expect(slot.element).toBe('Slot')
    expect(slot.attrs.itemSpacing!.value).toBe(8)
    expect(slot.children[0]!.address).toBe('Card#container/body/placeholder')
  })

  it('is legal inside a variant', () => {
    expect(
      codes(
        PAGE(
          `  <Component name="Card" status="draft" variants={{ size: ['sm', 'lg'] }}>\n` +
            `    <Variant size="sm">\n` +
            `      <Frame name="root"><Slot name="body" /></Frame>\n` +
            `    </Variant>\n` +
            `    <Variant size="lg">\n` +
            `      <Frame name="root"><Slot name="body" /></Frame>\n` +
            `    </Variant>\n` +
            `  </Component>`,
        ),
      ),
    ).toEqual([])
  })

  it("is legal inside another slot's default content", () => {
    expect(codes(PAGE(CARD(`      <Slot name="body"><Slot name="inner" /></Slot>`)))).toEqual([])
  })

  it('is refused on a page — nothing outside a component can fill it', () => {
    const found = parse(PAGE(`  <Slot name="body" />`)).diagnostics
    expect(found.map((d) => d.code)).toEqual([CODES.SLOT_NOT_ALLOWED_HERE])
    expect(found[0]!.message).toMatch(/belongs inside a <Component>/)
  })

  it('is refused however deeply it is nested outside a component', () => {
    // The rule is "inside a component", not "not a page's direct child": a
    // slot two frames deep on a page is exactly as unfillable as one on the
    // page itself, because only an <Instance> fills a slot and an instance
    // names a <Component>.
    const found = parse(
      PAGE(
        `  <Frame name="outer" layoutMode="VERTICAL">\n` +
          `    <Frame name="inner"><Slot name="body" /></Frame>\n` +
          `  </Frame>`,
      ),
    ).diagnostics
    expect(found.map((d) => d.code)).toEqual([CODES.SLOT_NOT_ALLOWED_HERE])
    expect(found[0]!.message).toMatch(/however deeply nested it is/)
  })

  it("is allowed as a component's direct child, since a component is a frame", () => {
    // ADR 0007 §1 refused this, and said why: "a component that is nothing but
    // a hole declares no contract". That was true while a component was a
    // wrapper *around* a frame — the sole child was the whole of it. ADR 0008
    // §1 made the component the frame, so it carries its own fills, size and
    // strokes, and a slot inside one leaves a contract behind. The parity
    // argument re-points too: the top layer Figma will not bind a slot to is
    // now the `<Component>` itself, not its child.
    const found = parse(
      PAGE(`  <Component name="Card" status="draft">\n    <Slot name="body" />\n  </Component>`),
    ).diagnostics
    expect(found).toEqual([])
  })

  it('is refused inside a fill, where no component could declare it', () => {
    const found = parse(
      PAGE(
        `  <Instance name="card-1" component="Card">\n` +
          `    <Slot name="body">\n` +
          `      <Slot name="deeper" />\n` +
          `    </Slot>\n` +
          `  </Instance>`,
      ),
    ).diagnostics
    expect(found.map((d) => d.code)).toEqual([CODES.SLOT_NOT_ALLOWED_HERE])
    expect(found[0]!.message).toMatch(/inside a slot fill/)
  })
})

describe('<Slot> — what each position may carry', () => {
  it('takes name only on the fill side, and says where layout lives', () => {
    const found = parse(
      PAGE(
        `  <Instance name="card-1" component="Card">\n` +
          `    <Slot name="body" layoutMode="VERTICAL">\n` +
          `      <Text name="figure" characters="$42,180" />\n` +
          `    </Slot>\n` +
          `  </Instance>`,
      ),
    ).diagnostics
    expect(found.map((d) => d.code)).toEqual([CODES.SLOT_FILL_SHAPE])
    expect(found[0]!.message).toMatch(/layout is the definition's to decide/)
  })

  it('accepts a fill that carries only a name, and its content is authored', () => {
    const doc = parseOrThrow(
      PAGE(
        `  <Instance name="card-1" component="Card">\n` +
          `    <Slot name="body">\n` +
          `      <Text name="figure" characters="$42,180" />\n` +
          `    </Slot>\n` +
          `  </Instance>`,
      ),
    )
    expect(resolve(doc.tree, 'card-1#body/figure')!.element).toBe('Text')
  })

  it('accepts the self-closing fill — explicitly empty, ADR 0007 §2', () => {
    const doc = parseOrThrow(
      PAGE(`  <Instance name="card-1" component="Card">\n    <Slot name="body" />\n  </Instance>`),
    )
    expect(resolve(doc.tree, 'card-1#body')!.children).toEqual([])
  })

  it('refuses a scene element as an instance’s direct child', () => {
    expect(
      codes(
        PAGE(
          `  <Instance name="card-1" component="Card">\n` +
            `    <Text name="stray" characters="x" />\n` +
            `  </Instance>`,
        ),
      ),
    ).toEqual([CODES.ELEMENT_NOT_ALLOWED_HERE])
  })
})

describe('<Slot> — uniqueness', () => {
  it('refuses two slots of one name anywhere in a component, not only as siblings', () => {
    const found = parse(
      PAGE(
        CARD(
          `      <Slot name="body" />\n` +
            `      <Frame name="footer"><Slot name="body" /></Frame>`,
        ),
      ),
    ).diagnostics
    expect(found.map((d) => d.code)).toEqual([CODES.DUPLICATE_SLOT])
    expect(found[0]!.message).toMatch(/fills by name/)
  })

  it('lets two variants each declare the same slot — each is a full tree', () => {
    expect(
      codes(
        PAGE(
          `  <Component name="Card" status="draft" variants={{ size: ['sm', 'lg'] }}>\n` +
            `    <Variant size="sm"><Frame name="root"><Slot name="body" /></Frame></Variant>\n` +
            `    <Variant size="lg"><Frame name="root"><Slot name="body" /></Frame></Variant>\n` +
            `  </Component>`,
        ),
      ),
    ).toEqual([])
  })

  it('refuses two fills for one slot on one instance', () => {
    const found = parse(
      PAGE(
        `  <Instance name="card-1" component="Card">\n` +
          `    <Slot name="body" />\n` +
          `    <Slot name="body" />\n` +
          `  </Instance>`,
      ),
    ).diagnostics
    expect(found.map((d) => d.code)).toEqual([CODES.DUPLICATE_SLOT_FILL])
    expect(found[0]!.message).toMatch(/one slot takes one fill/)
  })

  it('does not see an inner instance’s fills as the outer component’s slots', () => {
    expect(
      codes(
        PAGE(
          CARD(
            `      <Slot name="body" />\n` +
              `      <Instance name="inner" component="Other">\n` +
              `        <Slot name="body" />\n` +
              `      </Instance>`,
          ),
        ),
      ),
    ).toEqual([])
  })
})

describe('the readers', () => {
  it('reads a component’s slots by name, and stops at an instance', () => {
    const doc = parseOrThrow(
      PAGE(
        CARD(
          `      <Slot name="body" />\n` +
            `      <Frame name="footer"><Slot name="actions" /></Frame>\n` +
            `      <Instance name="inner" component="Other"><Slot name="hidden" /></Instance>`,
        ),
      ),
    )
    const { declared } = slots(resolve(doc.tree, 'Card')!)
    expect([...declared.keys()]).toEqual(['body', 'actions'])
    expect(declared.get('actions')!.address).toBe('Card#container/footer/actions')
  })

  it('reads an instance’s fills by the slot name each one names', () => {
    const doc = parseOrThrow(
      PAGE(
        `  <Instance name="card-1" component="Card">\n` +
          `    <Slot name="body"><Text name="figure" characters="x" /></Slot>\n` +
          `  </Instance>`,
      ),
    )
    const { fills } = slotFills(resolve(doc.tree, 'card-1')!)
    expect([...fills.keys()]).toEqual(['body'])
    expect(fills.get('body')!.children[0]!.name).toBe('figure')
  })
})
