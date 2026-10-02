import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseOrThrow, resolve, type UidxDocument, type UidxNode } from '@uidx/format'
import { instanceBase, instanceDefinition, type InstanceBase } from '@uidx/schema'
import { editableProps, isMapped, parentOf, sectionsFor, type EditableProp } from '../src/editable'

/**
 * The rows the panel offers for a selected instance (ADR 0018 §7): its outer
 * box and the text colour it hands down, each showing the component's own
 * value, dimmed, until the use states one — and nothing of the component's
 * inside, which is the component's business.
 */
const page = (id: string, body: string, regions = '') =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n${regions}`

/**
 * The schema's instance-box fixtures: Button1, a copy of the pill on the
 * design-system example's page1 (a styles table, so its box is the derived
 * `root`), and Chip, Tag and Badge, one per other place a box can land.
 */
const fixture = (file: string): UidxDocument =>
  parseOrThrow(
    readFileSync(join(__dirname, '../../schema/test/fixtures/instance-box', file), 'utf8'),
    file,
  )

/** Two texts in two colours, so the colour a use would hand down has no one value to show. */
const PAIR = page(
  'pair',
  `  <Component name="Pair" layoutMode="VERTICAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">
    <Text name="title" characters="Title" fontSize={14} fills={[{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }]} />
    <Text name="note" characters="Note" fontSize={12} fills={[{ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5, a: 1 } }]} />
  </Component>`,
)

/** A pill whose hover row colours its label as well as its frame. */
const TINTED = page(
  'tinted',
  `  <Component name="Tinted" status="draft" layoutMode="HORIZONTAL"
    primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO" paddingLeft={12}
    fills={[{ type: 'SOLID', color: { r: 0, g: 0.3333, b: 1, a: 1 } }]}>
    <Text name="label" characters="{label}" fontSize={14} />
  </Component>`,
  `
<Styles>
  <Style state="hover" root:fills={[{ type: 'SOLID', color: { r: 0.37, g: 0.57, b: 0.99, a: 1 } }]} label:fills={[{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }]} />
</Styles>

## Contract

<Props>
  <Prop name="label" type="string" sample="Tinted">The words it shows.</Prop>
</Props>
`,
)

/** A dot and no text: nothing a text colour could reach. */
const SWATCH = page(
  'swatch',
  `  <Component name="Swatch" status="draft" layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">
    <Vector name="dot" width={6} height={6} fills={[{ type: 'SOLID', color: { r: 0, g: 0.6, b: 0, a: 1 } }]}
      vectorPaths={[{ windingRule: 'NONZERO', data: 'M3 0 L6 3 L3 6 L0 3 Z' }]} />
  </Component>`,
)

const LIBRARY = [
  fixture('button1.uidx'),
  fixture('kinds.uidx'),
  parseOrThrow(PAIR, 'pair.uidx'),
  parseOrThrow(TINTED, 'tinted.uidx'),
  parseOrThrow(SWATCH, 'swatch.uidx'),
]

/** Button1's blue, exactly as the fixture writes it. */
const BLUE = [{ opacity: 1, visible: true, type: 'SOLID', color: { r: 0, g: 0.3333, b: 1, a: 1 } }]
/** The hover row's lighter blue. */
const LIGHT_BLUE = [
  { opacity: 1, visible: true, type: 'SOLID', color: { r: 0.3678, g: 0.5744, b: 0.9875, a: 1 } },
]
/** What a text that states no fills draws in: the engine's own black. */
const ENGINE_TEXT = [
  { type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true },
]
const RED = `[{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }]`

/** The use named `name` on a page holding `body`, its parent, and what it inherits. */
function use(body: string, name = 'b') {
  const doc = parseOrThrow(page('use', body), 'use.uidx')
  const components = new Map<string, UidxNode>()
  for (const source of [...LIBRARY, doc])
    for (const child of source.tree.children)
      if (child.element === 'Component') components.set(child.name, child)
  const scope = { resolveComponent: (component: string) => components.get(component) }
  const instance = resolve(doc.tree, name)!
  const parent = parentOf(doc.tree, instance.address)
  const base = instanceBase(instance, instanceDefinition(instance, scope), scope)
  return { doc, instance, parent, base }
}

/** The rows `editableProps` gives the use, keyed by prop. */
function rowsOf(body: string, name = 'b', withBase = true): Map<string, EditableProp> {
  const { instance, parent, base } = use(body, name)
  const fields = editableProps(instance, parent, withBase ? base : null)
  return new Map(fields.map((field) => [field.name, field]))
}

const BUTTON1 = `  <Instance name="b" component="Button1" props={{ label: 'Go' }} />`

describe('an instance offers its outer box and nothing inside it', () => {
  it('has padding rows and a Text color row', () => {
    const rows = rowsOf(BUTTON1)
    for (const prop of ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'textFills'])
      expect(rows.has(prop), prop).toBe(true)
    expect(rows.get('textFills')).toMatchObject({ group: 'textColor', control: 'paint' })
  })

  it('has no row for the component’s layout, stroke ends or typography', () => {
    const rows = rowsOf(BUTTON1)
    for (const prop of [
      'layoutMode',
      'itemSpacing',
      'counterAxisSpacing',
      'primaryAxisAlignItems',
      'counterAxisAlignItems',
      'counterAxisAlignContent',
      'layoutWrap',
      'clipsContent',
      'itemReverseZIndex',
      'strokesIncludedInLayout',
      'strokeCap',
      'strokeJoin',
      'strokeMiterLimit',
      'characters',
      'fontSize',
      'fontFamily',
      'fontWeight',
      'lineHeight',
      'letterSpacing',
      'textAlignHorizontal',
    ])
      expect(rows.has(prop), prop).toBe(false)
  })

  it('groups the box into the sections a frame has, with Text color after Fill', () => {
    const { instance, parent, base } = use(BUTTON1)
    const sections = sectionsFor(instance, editableProps(instance, parent, base), parent)
    expect(sections.map((section) => section.group)).toEqual([
      'position',
      'layout',
      'appearance',
      'fill',
      'textColor',
      'stroke',
      'effects',
    ])
    const layout = sections
      .find((section) => section.group === 'layout')!
      .fields.flatMap((row) => [row.field.name, row.pairedWith?.name])
    expect(layout).toEqual(expect.arrayContaining(['width', 'paddingLeft', 'paddingTop']))
    expect(layout).not.toContain('layoutMode')
    expect(layout).not.toContain('itemSpacing')
  })
})

describe('an unset row shows the component’s value', () => {
  it('Fill shows Button1’s paint, from the component', () => {
    const fills = rowsOf(BUTTON1).get('fills')!
    expect(fills.value).toEqual(BLUE)
    expect(fills.origin).toBe('component')
    expect(fills.authored).toBe(false)
    expect(fills.control).toBe('paint')
    expect(fills.boundTo).toBeNull()
  })

  it('padding and the corner radius are Button1’s too', () => {
    const rows = rowsOf(BUTTON1)
    expect(rows.get('paddingLeft')).toMatchObject({ value: 12, origin: 'component' })
    expect(rows.get('paddingTop')).toMatchObject({ value: 8, origin: 'component' })
    expect(rows.get('cornerRadius')).toMatchObject({ value: 999, origin: 'component' })
  })

  it('leaves what the component says nothing about to the engine', () => {
    const rows = rowsOf(BUTTON1)
    // A list row keeps its empty `+`: the component draws no stroke.
    expect(rows.get('strokes')).toMatchObject({ value: null, origin: 'engine' })
    expect(rows.get('opacity')).toMatchObject({ value: 1, origin: 'engine' })
  })

  it('reads a token the component binds as a binding', () => {
    const rows = rowsOf(`  <Instance name="c" component="Chip" props={{ label: 'Chip' }} />`, 'c')
    const fills = rows.get('fills')!
    expect(fills).toMatchObject({ value: '{surface#raised}', origin: 'component' })
    expect(fills.boundTo).toBe('surface#raised')
    expect(rows.get('cornerRadius')).toMatchObject({ value: 6, origin: 'component' })
  })

  it('reads the frame a bare component wraps, and the variant the use chose', () => {
    const tag = rowsOf(`  <Instance name="t" component="Tag" props={{ label: 'Tag' }} />`, 't')
    expect(tag.get('strokes')).toMatchObject({ value: '{border#default}', origin: 'component' })
    expect(tag.get('strokes')!.boundTo).toBe('border#default')
    expect(tag.get('strokeWeight')).toMatchObject({ value: 1, origin: 'component' })

    const badge = rowsOf(`  <Instance name="w" component="Badge" props={{ tone: 'warn' }} />`, 'w')
    expect(badge.get('fills')).toMatchObject({ value: '{surface#danger}', origin: 'component' })
    expect(badge.get('topLeftRadius')).toMatchObject({ value: 8, origin: 'component' })
  })
})

describe('a component that draws its look inside a frame that only wraps it', () => {
  /** The Shoelace example's own Button, whose look is on its `base` part (ADR 0018 §2). */
  const SHOELACE = parseOrThrow(
    readFileSync(join(__dirname, '../../../examples/shoelace/.uidx/button.uidx'), 'utf8'),
    'button.uidx',
  )
  const rows = (): Map<string, EditableProp> => {
    const doc = parseOrThrow(page('use', BUTTON1.replace('Button1', 'Button')), 'use.uidx')
    const button = SHOELACE.tree.children.find((node) => node.element === 'Component')!
    const scope = { resolveComponent: (name: string) => (name === 'Button' ? button : undefined) }
    const instance = resolve(doc.tree, 'b')!
    const base = instanceBase(instance, instanceDefinition(instance, scope), scope)
    const fields = editableProps(instance, parentOf(doc.tree, instance.address), base)
    return new Map(fields.map((field) => [field.name, field]))
  }

  it('shows the paint, padding and corners of that frame, not the wrapper’s none', () => {
    const shown = rows()
    expect(shown.get('fills')).toMatchObject({ value: '{color#accent}', origin: 'component' })
    expect(shown.get('fills')!.boundTo).toBe('color#accent')
    expect(shown.get('paddingLeft')).toMatchObject({ value: '{space#lg}', origin: 'component' })
    expect(shown.get('cornerRadius')).toMatchObject({ value: '{radius#md}', origin: 'component' })
  })
})

describe('a stated row is the use’s own', () => {
  it('shows the use’s value, marked own', () => {
    const fills = rowsOf(`  <Instance name="b" component="Button1" fills={${RED}} />`).get('fills')!
    expect(fills.value).toEqual([{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }])
    expect(fills.origin).toBe('own')
    expect(fills.authored).toBe(true)
    expect(fills.shadow).toBeNull()
  })

  it('says which state the use’s props select sets the same property', () => {
    const rows = rowsOf(
      `  <Instance name="b" component="Button1" props={{ state: 'hover' }} fills={${RED}} />`,
    )
    expect(rows.get('fills')).toMatchObject({ origin: 'own', shadow: { state: 'hover' } })
    // The hover row sets no corner, so the use's would show.
    expect(rows.get('cornerRadius')!.shadow).toBeNull()
  })

  it('an unset row under that state shows the state’s value, and says so', () => {
    const fills = rowsOf(
      `  <Instance name="b" component="Button1" props={{ state: 'hover' }} />`,
    ).get('fills')!
    expect(fills.value).toEqual(LIGHT_BLUE)
    expect(fills.origin).toBe('component')
    expect(fills.shadow).toEqual({ state: 'hover' })
  })
})

describe('an attribute an instance cannot style', () => {
  const LOCKED = `  <Instance name="b" component="Button1" layoutMode="VERTICAL" itemSpacing={4} strokeCap="ROUND" />`

  it('shows read-only and unsectioned, offered for removal', () => {
    const rows = rowsOf(LOCKED)
    for (const prop of ['layoutMode', 'itemSpacing', 'strokeCap']) {
      const row = rows.get(prop)!
      expect(row, prop).toMatchObject({
        group: null,
        control: 'readonly',
        authored: true,
        origin: 'own',
        removable: true,
      })
    }
    expect(rows.get('layoutMode')!.value).toBe('VERTICAL')
    expect(rows.get('layoutMode')!.readonlyReason).toMatch(/the component’s own layout/)
    expect(rows.get('itemSpacing')!.readonlyReason).toMatch(/the component’s own layout/)
    expect(rows.get('strokeCap')!.readonlyReason).toMatch(/inside the component/)
  })

  it('sits in no section', () => {
    const { instance, parent, base } = use(LOCKED)
    const named = sectionsFor(instance, editableProps(instance, parent, base), parent).flatMap(
      (section) => section.fields.flatMap((row) => [row.field.name, row.pairedWith?.name]),
    )
    expect(named).not.toContain('layoutMode')
    expect(named).not.toContain('itemSpacing')
    expect(named).not.toContain('strokeCap')
  })

  it('is read-only even without a definition: the role is the attribute’s, not the component’s', () => {
    const row = rowsOf(
      `  <Instance name="b" component="Nowhere" layoutMode="VERTICAL" />`,
      'b',
      false,
    ).get('layoutMode')!
    expect(row).toMatchObject({ group: null, control: 'readonly', removable: true })
  })
})

describe('the Text color row', () => {
  it('shows what the texts the use reaches draw: the engine’s black for a label with no fills', () => {
    expect(rowsOf(BUTTON1).get('textFills')).toMatchObject({
      value: ENGINE_TEXT,
      origin: 'component',
      authored: false,
    })
  })

  it('reads a token the texts draw in as a binding', () => {
    const row = rowsOf(`  <Instance name="t" component="Tag" props={{ label: 'Tag' }} />`, 't').get(
      'textFills',
    )!
    expect(row).toMatchObject({ value: '{text#muted}', origin: 'component' })
    expect(row.boundTo).toBe('text#muted')
  })

  it('has no one value when the texts disagree', () => {
    expect(rowsOf(`  <Instance name="p" component="Pair" />`, 'p').get('textFills')).toMatchObject({
      value: null,
      origin: 'component',
    })
  })

  it('is the use’s own once it states one', () => {
    const row = rowsOf(`  <Instance name="b" component="Button1" textFills={${RED}} />`).get(
      'textFills',
    )!
    expect(row).toMatchObject({ origin: 'own', authored: true, group: 'textColor' })
    expect(isMapped('textFills')).toBe(true)
  })

  it('says when a state the use selects colours the text instead, and shows the state’s colour', () => {
    const hover = rowsOf(
      `  <Instance name="t" component="Tinted" props={{ label: 'Hi', state: 'hover' }} />`,
      't',
    ).get('textFills')!
    // The hover row colours the only text, so the row shows what it draws, as
    // Fill shows the hover row's paint: the component's value, never the
    // engine's.
    expect(hover).toMatchObject({
      value: [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }],
      origin: 'component',
      authored: false,
      shadow: { state: 'hover' },
    })
    const rest = rowsOf(`  <Instance name="t" component="Tinted" props={{ label: 'Hi' }} />`, 't')
    expect(rest.get('textFills')).toMatchObject({
      value: ENGINE_TEXT,
      origin: 'component',
      shadow: null,
    })
  })

  it('leaves to the engine only a component that draws no text', () => {
    expect(
      rowsOf(`  <Instance name="s" component="Swatch" />`, 's').get('textFills'),
    ).toMatchObject({ value: null, origin: 'engine', shadow: null })
  })
})

describe('without a definition', () => {
  const NOWHERE = `  <Instance name="b" component="Nowhere" props={{ label: 'Go' }} fills={${RED}} />`

  it('gives the rows it always gave', () => {
    const { instance, parent } = use(NOWHERE)
    const without = editableProps(instance, parent)
    const nulled = editableProps(instance, parent, null)
    const strip = (fields: EditableProp[]) =>
      fields.map(({ name, value, control, group, authored, boundTo, readonlyReason }) => ({
        name,
        value,
        control,
        group,
        authored,
        boundTo,
        readonlyReason,
      }))
    expect(strip(nulled)).toEqual(strip(without))
    const rows = new Map(without.map((field) => [field.name, field]))
    // An unset list row is its empty `+`, a number the engine's default.
    expect(rows.get('strokes')).toMatchObject({ value: null, origin: 'engine', shadow: null })
    expect(rows.get('paddingLeft')).toMatchObject({ value: 0, origin: 'engine' })
    expect(rows.get('fills')).toMatchObject({ origin: 'own', shadow: null })
  })

  it('reads no base when the component is missing', () => {
    expect(use(NOWHERE).base).toBeNull()
  })
})

describe('a node that is not an instance', () => {
  it('marks authored rows own and unset rows the engine’s, with nothing to shadow them', () => {
    const doc = parseOrThrow(
      page('frame', `  <Frame name="f" layoutMode="VERTICAL" fills={${RED}} />`),
    )
    const frame = resolve(doc.tree, 'f')!
    const base: InstanceBase = {
      target: { kind: 'self', id: 'f' },
      values: { strokes: '{border#default}' },
      stateWins: new Map([['fills', 'hover']]),
      text: null,
      layout: {},
    }
    // A base handed in for a frame is ignored: only an instance inherits.
    for (const fields of [editableProps(frame, doc.tree), editableProps(frame, doc.tree, base)]) {
      const rows = new Map(fields.map((field) => [field.name, field]))
      expect(rows.get('fills')).toMatchObject({ origin: 'own', shadow: null })
      expect(rows.get('strokes')).toMatchObject({ value: null, origin: 'engine', shadow: null })
      expect(rows.get('layoutMode')).toMatchObject({ group: 'layout', control: 'enum' })
      expect(rows.get('layoutMode')!.removable).toBeUndefined()
    }
  })
})
