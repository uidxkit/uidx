import { describe, expect, it } from 'vitest'
import { CODES, parseOrThrow, type Diagnostic } from '@uidx/format'
import { auditInstanceBox, componentIndex } from '../src/instance-box-audit.js'

/**
 * `uidx check`'s view of an instance's outer box (ADR 0018 §5, §6): a locked
 * attribute parses and does nothing (UIDX154), and so does a box value with
 * nowhere to act — padding where the box does not lay out, a text colour where
 * nothing draws text, a binding, or a token collection that would shadow the
 * generated hooks (UIDX155). Both are warnings, so neither fails a build.
 */
const page = (id: string, body: string, regions = '') =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n${regions}`

/**
 * Button1 as examples/design-system draws it: a hugging row with padding, a
 * pill radius, a solid fill, one bound label and a hover row. A styles table,
 * so its box is the derived `root` one level down — which lays out.
 */
const BUTTON1 = page(
  'button1',
  `  <Component name="Button1" status="draft"
    layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"
    paddingLeft={12} paddingRight={12} paddingTop={8} paddingBottom={8} cornerRadius={999}
    fills={[{ type: 'SOLID', color: { r: 0, g: 0.3333, b: 1, a: 1 } }]}>
    <Text name="label" characters="{label}" fontSize={14} />
  </Component>`,
  `
<Styles>
  <Style state="hover" root:fills={[{ type: 'SOLID', color: { r: 0.37, g: 0.57, b: 0.99, a: 1 } }]} />
</Styles>

## Contract

<Props>
  <Prop name="label" type="string" sample="Button1">The words it shows.</Prop>
</Props>
`,
)

/**
 * Shapes whose box does not lay out, or that draw no text:
 *
 * - Swatch is a fixed square that lays itself out by absolute position, and
 *   draws only a vector.
 * - Box wraps one frame with no layout.
 * - Tile wraps one laid-out frame and draws a text.
 * - Stack declares no geometry, so the build gives it a hugging column.
 * - Framed composes Swatch, and Labelled composes Tile.
 */
const KINDS = page(
  'kinds',
  `  <Component name="Swatch" status="draft" width={24} height={24} fills="{surface#raised}">
    <Vector name="dot" width={6} height={6}
      vectorPaths={[{ windingRule: 'NONZERO', data: 'M3 0 L6 3 L3 6 L0 3 Z' }]} />
  </Component>
  <Component name="Box" status="draft">
    <Frame name="inner" width={40} height={40} />
  </Component>
  <Component name="Tile" status="draft">
    <Frame name="body" layoutMode="VERTICAL" paddingLeft={8}>
      <Text name="title" characters="Title" />
    </Frame>
  </Component>
  <Component name="Stack" status="draft">
    <Rectangle name="a" width={8} height={8} />
    <Rectangle name="b" width={8} height={8} />
  </Component>
  <Component name="Framed" status="draft">
    <Instance name="swatch" component="Swatch" />
  </Component>
  <Component name="Labelled" status="draft">
    <Instance name="tile" component="Tile" />
  </Component>`,
)

/**
 * A styles table over a fixed frame, on a page of its own since a page's
 * regions belong to every component on it: its derived `root` is fixed too.
 */
const TOGGLE = page(
  'toggle',
  `  <Component name="Toggle" status="draft" width={32} height={18} cornerRadius={9}
    fills={[{ type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.8, a: 1 } }]}>
    <Ellipse name="knob" x={2} y={2} width={14} height={14} />
  </Component>`,
  `
<Styles>
  <Style state="checked" root:fills={[{ type: 'SOLID', color: { r: 0, g: 0.5, b: 1, a: 1 } }]} />
</Styles>

## Contract

<Props>
  <Prop name="checked" type="boolean" default={false} visual>Whether it is on.</Prop>
</Props>
`,
)

/** The instances under test, on a page of their own: components live elsewhere. */
const uses = (body: string) => page('uses', body)

function audit(body: string, extra: string[] = []): Diagnostic[] {
  const doc = parseOrThrow(uses(body))
  const components = componentIndex([BUTTON1, KINDS, TOGGLE, ...extra].map((s) => parseOrThrow(s)))
  return auditInstanceBox(doc, components)
}

const coded = (found: Diagnostic[], code: string) => found.filter((d) => d.code === code)

describe('a locked attribute on an instance (UIDX154)', () => {
  it('warns once per locked attribute, naming the component', () => {
    const found = audit(
      `  <Instance name="b" component="Button1" layoutMode="VERTICAL" itemSpacing={4} />`,
    )
    const locked = coded(found, CODES.INSTANCE_LOCKED_PROP)
    expect(locked).toHaveLength(2)
    expect(locked.map((d) => d.severity)).toEqual(['warning', 'warning'])
    expect(locked[0]!.message).toMatch(/^layoutMode on an instance of Button1 is ignored/)
    expect(locked[1]!.message).toMatch(/^itemSpacing on an instance of Button1 is ignored/)
    expect(locked[0]!.message).toContain('change Button1 or detach')
    expect(found).toHaveLength(2)
  })

  it('points at the attribute, so an editor lands on the line to delete', () => {
    const source = uses(`  <Instance name="b" component="Button1"\n    itemSpacing={4} />`)
    const [found] = auditInstanceBox(parseOrThrow(source), componentIndex([parseOrThrow(BUTTON1)]))
    expect(found!.code).toBe(CODES.INSTANCE_LOCKED_PROP)
    expect(source.slice(found!.loc.start, found!.loc.end)).toBe('itemSpacing={4}')
  })

  it('says nothing about the box, placement, structure and textFills', () => {
    expect(
      audit(`  <Instance name="b" component="Button1" props={{ label: 'Delete' }}
    x={8} y={8} width={199} height={33} layoutGrow={1} visible={true} rotation={0}
    fills="{surface#danger}" strokes={[{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }]}
    strokeWeight={2} strokeAlign="INSIDE" dashPattern={[4, 2]} cornerRadius={4} topLeftRadius={0}
    cornerSmoothing={0.6} opacity={0.5} effects={[]} paddingLeft="{space#lg}" paddingTop={4}
    textFills="{text#onAccent}" overrides={{ label: { fontSize: 16 } }} />`),
    ).toEqual([])
  })

  it('leaves an unknown attribute to the unknown-prop lint', () => {
    expect(audit(`  <Instance name="b" component="Button1" borderRadius={4} />`)).toEqual([])
  })

  it('names the component even when no page defines it', () => {
    const [found] = audit(`  <Instance name="b" component="Ghost" clipsContent={true} />`)
    expect(found!.code).toBe(CODES.INSTANCE_LOCKED_PROP)
    expect(found!.message).toMatch(/^clipsContent on an instance of Ghost is ignored/)
  })

  it('checks instances inside a definition too', () => {
    const composed = page(
      'composed',
      `  <Component name="Pair" status="draft">
    <Instance name="first" component="Button1" counterAxisAlignItems="CENTER" />
  </Component>`,
    )
    const found = auditInstanceBox(parseOrThrow(composed), componentIndex([parseOrThrow(BUTTON1)]))
    expect(found.map((d) => d.code)).toEqual([CODES.INSTANCE_LOCKED_PROP])
  })
})

describe('a box value that does nothing (UIDX155)', () => {
  const hints = (body: string, extra: string[] = []) =>
    coded(audit(body, extra), CODES.INSTANCE_BOX_HINT)

  describe('padding where the box does not lay out', () => {
    it('warns for a component that is a fixed box of its own', () => {
      const [found, ...rest] = hints(`  <Instance name="s" component="Swatch" paddingLeft={8} />`)
      expect(rest).toEqual([])
      expect(found!.severity).toBe('warning')
      expect(found!.message).toMatch(
        /^paddingLeft does nothing here: Swatch's box does not lay out/,
      )
    })

    it('warns for a component that says it places its children itself', () => {
      const loose = page(
        'loose',
        `  <Component name="Loose" status="draft" layoutMode="NONE">
    <Text name="words" characters="Loose" />
  </Component>`,
      )
      expect(
        hints(`  <Instance name="l" component="Loose" paddingLeft={8} />`, [loose]),
      ).toHaveLength(1)
    })

    it('warns for a wrapped frame with no layout, and a derived root with none', () => {
      expect(hints(`  <Instance name="b" component="Box" paddingTop={8} />`)).toHaveLength(1)
      expect(hints(`  <Instance name="t" component="Toggle" paddingRight={2} />`)).toHaveLength(1)
    })

    it('reads the variants a styles table derives, as the build draws them', () => {
      // The derived `root` only wraps the frame, so the box goes through it to
      // that frame, which places its content where it says rather than laying
      // it out.
      const pane = page(
        'pane',
        `  <Component name="Pane" status="draft">
    <Frame name="body" width={80} height={40} />
  </Component>`,
        `
<Styles>
  <Style state="hover" root:opacity={0.9} />
</Styles>
`,
      )
      expect(
        hints(`  <Instance name="p" component="Pane" paddingLeft={8} />`, [pane]),
      ).toHaveLength(1)
    })

    it('warns once per padding side', () => {
      expect(
        hints(`  <Instance name="s" component="Swatch" paddingLeft={8} paddingRight={8} />`),
      ).toHaveLength(2)
    })

    it('stays quiet where the box lays out', () => {
      expect(hints(`  <Instance name="b" component="Button1" paddingLeft={24} />`)).toEqual([])
      expect(hints(`  <Instance name="t" component="Tile" paddingLeft={24} />`)).toEqual([])
      expect(hints(`  <Instance name="s" component="Stack" paddingLeft={24} />`)).toEqual([])
    })

    it('follows a composition to the box of the instance it holds', () => {
      expect(hints(`  <Instance name="f" component="Framed" paddingLeft={8} />`)).toHaveLength(1)
      expect(hints(`  <Instance name="l" component="Labelled" paddingLeft={8} />`)).toEqual([])
    })

    it('stays quiet when the component cannot be found', () => {
      expect(hints(`  <Instance name="g" component="Ghost" paddingLeft={8} />`)).toEqual([])
    })

    it('warns only when no variant of an authored set lays out', () => {
      const badges = page(
        'badges',
        `  <Component name="Badge" status="draft" variants={{ tone: ['info', 'warn'] }}>
    <Variant tone="info">
      <Frame name="badge" layoutMode="HORIZONTAL"><Text name="t" characters="Info" /></Frame>
    </Variant>
    <Variant tone="warn">
      <Frame name="badge" width={20} height={20} />
    </Variant>
  </Component>
  <Component name="Dot" status="draft" variants={{ tone: ['info', 'warn'] }}>
    <Variant tone="info"><Frame name="dot" width={8} height={8} /></Variant>
    <Variant tone="warn"><Frame name="dot" width={8} height={8} /></Variant>
  </Component>`,
      )
      expect(hints(`  <Instance name="b" component="Badge" paddingLeft={8} />`, [badges])).toEqual(
        [],
      )
      expect(
        hints(`  <Instance name="d" component="Dot" paddingLeft={8} />`, [badges]),
      ).toHaveLength(1)
    })
  })

  describe('textFills where nothing draws text', () => {
    it('warns for a component with no text anywhere in it', () => {
      const [found, ...rest] = hints(
        `  <Instance name="s" component="Swatch" textFills="{text#onAccent}" />`,
      )
      expect(rest).toEqual([])
      expect(found!.message).toMatch(/^textFills does nothing here: Swatch draws no text/)
    })

    it('follows a composition, and nested instances, to the texts they draw', () => {
      expect(hints(`  <Instance name="f" component="Framed" textFills="{text#x}" />`)).toHaveLength(
        1,
      )
      expect(hints(`  <Instance name="l" component="Labelled" textFills="{text#x}" />`)).toEqual([])
    })

    it('counts the texts the use fills a slot with', () => {
      const slotted = page(
        'slotted',
        `  <Component name="Well" status="draft" width={80} height={40}>
    <Slot name="content" />
  </Component>`,
      )
      const body = (fill: string) => `  <Instance name="w" component="Well" textFills="{text#x}">
    <Slot name="content">${fill}</Slot>
  </Instance>`
      expect(hints(body('<Text name="t" characters="Hi" />'), [slotted])).toEqual([])
      expect(hints(body('<Rectangle name="r" width={4} height={4} />'), [slotted])).toHaveLength(1)
    })

    it('stays quiet for a component that draws text, or cannot be found', () => {
      expect(hints(`  <Instance name="b" component="Button1" textFills="{text#x}" />`)).toEqual([])
      expect(hints(`  <Instance name="g" component="Ghost" textFills="{text#x}" />`)).toEqual([])
    })

    it('ends on a component that composes itself', () => {
      const loop = page(
        'loop',
        `  <Component name="Loop" status="draft">
    <Instance name="again" component="Loop" />
  </Component>`,
      )
      expect(
        hints(`  <Instance name="l" component="Loop" paddingLeft={4} textFills="{text#x}" />`, [
          loop,
        ]).map((d) => d.message.split(':')[0]),
      ).toEqual(['paddingLeft does nothing here', 'textFills does nothing here'])
    })
  })

  describe('a binding', () => {
    it('warns for a component-property binding on the whole attribute', () => {
      const [found, ...rest] = hints(`  <Instance name="b" component="Button1" fills="{label}" />`)
      expect(rest).toEqual([])
      expect(found!.message).toMatch(/^fills binds "\{label\}"/)
      expect(found!.message).toContain('visual prop')
    })

    it('warns for an item binding inside a paint', () => {
      const found = hints(
        `  <Instance name="b" component="Button1" textFills={[{ type: 'SOLID', color: '{item.tone}' }]} />`,
      )
      expect(found.map((d) => d.message)).toEqual([
        expect.stringMatching(/^textFills binds "\{item\.tone\}"/),
      ])
    })

    it('stays quiet for a token, and for a binding in placement', () => {
      expect(
        hints(`  <Instance name="b" component="Button1" fills="{surface#danger}"
    strokes={[{ type: 'SOLID', color: '{border#danger}' }]} visible="{shown}" />`),
      ).toEqual([])
    })
  })

  describe('a token collection named uidx', () => {
    const tokens = (name: string) => `---
id: tokens
---

## Visual Contract

<Tokens>
  <Collection name="${name}">
    <Variable name="fill" type="COLOR" value={{ r: 1, g: 0, b: 0, a: 1 }} />
  </Collection>
</Tokens>
`

    it('warns, since its variables would be the --uidx-* hooks', () => {
      const source = tokens('uidx')
      const found = auditInstanceBox(parseOrThrow(source))
      expect(found.map((d) => [d.code, d.severity])).toEqual([[CODES.INSTANCE_BOX_HINT, 'warning']])
      expect(found[0]!.message).toContain('--uidx-fill')
      expect(source.slice(found[0]!.loc.start, found[0]!.loc.end)).toBe('name="uidx"')
    })

    it('warns for a name that spells into the same prefix', () => {
      expect(auditInstanceBox(parseOrThrow(tokens('uidx-padding')))).toHaveLength(1)
    })

    it('stays quiet for any other name', () => {
      expect(auditInstanceBox(parseOrThrow(tokens('surface')))).toEqual([])
      expect(auditInstanceBox(parseOrThrow(tokens('uidxkit')))).toEqual([])
    })
  })
})

describe('componentIndex', () => {
  it('finds components across pages, first page first', () => {
    const shadow = BUTTON1.replace('id: button1', 'id: shadow').replace('cornerRadius={999}', '')
    const index = componentIndex([BUTTON1, KINDS, TOGGLE, shadow].map((s) => parseOrThrow(s)))
    expect([...index.keys()].sort()).toEqual(
      ['Box', 'Button1', 'Framed', 'Labelled', 'Stack', 'Swatch', 'Tile', 'Toggle'].sort(),
    )
    expect(index.get('Button1')!.attrs.cornerRadius).toBeDefined()
  })

  it('defaults to the page its own components, without an index', () => {
    const doc = parseOrThrow(
      KINDS.replace(
        '  <Component name="Framed"',
        '  <Instance name="use" component="Swatch" paddingLeft={4} />\n  <Component name="Framed"',
      ),
    )
    expect(auditInstanceBox(doc).map((d) => d.code)).toEqual([CODES.INSTANCE_BOX_HINT])
  })
})
