import { describe, expect, it } from 'vitest'
import { CODES, parseOrThrow, type JsonValue, type UidxNode } from '@uidx/format'
import { auditDesignSystem, contractJson, toSceneGraph } from '../src/index.js'

/**
 * The design-system model on the scene side (ADRs 0013–0017): a styles table
 * becomes the variant set the canvas draws, a model's samples fill the parts
 * bound to it, and a repeat multiplies one instance with the n-th sample.
 */
const page = (id: string, body: string, regions = '') =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n${regions}`

const TOKENS: Record<string, JsonValue> = {
  'surface#control': [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
  'surface#accent': [{ type: 'SOLID', color: { r: 0, g: 0.5, b: 1, a: 1 } }],
  'surface#accentHover': [{ type: 'SOLID', color: { r: 0, g: 0.4, b: 0.9, a: 1 } }],
  'radius#sm': 4,
}
const resolveAlias = (address: string) => TOKENS[address]

const CHECKBOX_SOURCE = page(
  'checkbox',
  `  <Component name="Checkbox" status="stable" implements="hwc-checkbox"
    width={20} height={20} cornerRadius="{radius#sm}" fills="{surface#control}">
    <Vector name="check" part="checked-indicator" visible={false}
      vectorPaths={[{ windingRule: 'NONZERO', data: 'M3 8 L7 12 L13 4' }]} />
    <Slot name="label" />
  </Component>`,
  `
<Styles>
  <Style state="checked" root:fills="{surface#accent}" checked-indicator:visible={true} />
  <Style state="hover" root:fills="{surface#accentHover}" />
  <Style size="sm" root:width={16} root:height={16} />
  <Style size="sm" state="hover" root:width={17} />
  <Style state="disabled" root:opacity={0.4} />
</Styles>

## Contract

<Props>
  <Prop name="checked" type="boolean" default={false} controllable visual>Whether the option is selected.</Prop>
  <Prop name="size" type="'sm' | 'md'" default="md" visual>Box size.</Prop>
  <Prop name="disabled" type="boolean" default={false} visual>Inert and dimmed.</Prop>
</Props>
<States structural={['checked']} styling={['hover', 'disabled']} />
<Parts>checked-indicator</Parts>
<Slots><Slot name="label">Consumer text.</Slot></Slots>
`,
)

const componentIndex = (...docs: ReturnType<typeof parseOrThrow>[]) => {
  const out = new Map<string, UidxNode>()
  for (const doc of docs)
    for (const node of doc.tree.children) if (node.element === 'Component') out.set(node.name, node)
  return out
}

describe('a styles table derives the variant set (ADR 0016)', () => {
  const doc = parseOrThrow(CHECKBOX_SOURCE)
  const scene = toSceneGraph(doc, { resolveAlias })
  const set = scene.graph.getNode('Checkbox')!

  it('draws the component as a set with one tree per combination, default first', () => {
    expect(set.type).toBe('COMPONENT_SET')
    const names = (set.childIds ?? []).map((id) => scene.graph.getNode(id)!.name)
    // Two sizes, default first, times four states, default first.
    expect(names).toHaveLength(8)
    expect(names[0]).toBe('size=md, state=default')
    expect(names).toContain('size=sm, state=checked')
    expect(set.componentPropertyDefinitions?.map((d) => [d.name, d.variantOptions])).toEqual([
      ['size', ['md', 'sm']],
      ['state', ['default', 'checked', 'hover', 'disabled']],
    ])
  })

  it('applies the matching rows to the root and the bound parts', () => {
    const root = (name: string) => scene.graph.getNode(`Checkbox#${name}/root`)!
    expect(root('size=md, state=default').fills![0]!.color).toMatchObject({ r: 1, g: 1, b: 1 })
    expect(root('size=md, state=checked').fills![0]!.color).toMatchObject({ r: 0, g: 0.5, b: 1 })
    expect(scene.graph.getNode('Checkbox#size=md, state=default/root/check')!.visible).toBe(false)
    expect(scene.graph.getNode('Checkbox#size=md, state=checked/root/check')!.visible).toBe(true)
    expect(root('size=md, state=disabled').opacity).toBe(0.4)
  })

  it('resolves rows by specificity: the more keys a row matches, the later it applies', () => {
    const root = (name: string) => scene.graph.getNode(`Checkbox#${name}/root`)!
    expect(root('size=sm, state=default').width).toBe(16)
    expect(root('size=sm, state=hover').width).toBe(17)
    expect(root('size=md, state=hover').width).toBe(20)
  })

  it('links the component and nothing derived: a derived tree has no source to patch', () => {
    expect(scene.addresses.sceneIdOf('Checkbox')).toBe('Checkbox')
    expect(scene.addresses.sceneIdOf('Checkbox#size=md, state=default')).toBeUndefined()
    expect(scene.addresses.sceneIdOf('Checkbox#size=md, state=default/root/check')).toBeUndefined()
    expect(scene.warnings).toEqual([])
  })

  it('lets an instance pick a derived combination the way it picks an authored one', () => {
    const uses = parseOrThrow(
      page(
        'home',
        `  <Instance name="plain" component="Checkbox" />
  <Instance name="on" component="Checkbox" props={{ state: 'checked', size: 'sm' }} />`,
      ),
    )
    const index = componentIndex(doc)
    const built = toSceneGraph(uses, { resolveAlias, resolveComponent: (name) => index.get(name) })
    expect(built.graph.getNode('plain#root')!.fills![0]!.color).toMatchObject({ r: 1, g: 1, b: 1 })
    expect(built.graph.getNode('on#root')!.fills![0]!.color).toMatchObject({ r: 0, g: 0.5, b: 1 })
    expect(built.graph.getNode('on#root')!.width).toBe(16)
    expect(built.warnings).toEqual([])
  })
})

const ROW_SOURCE = page(
  'contact-item',
  `  <Component name="ContactItem" status="draft" implements="hwc-list-item" layoutMode="HORIZONTAL">
    <Text name="name" part="name" characters="{item.name}" />
    <Text name="email" part="email" characters="{item.email}" />
    <Text name="city" part="city" characters="{item.address.city}" />
  </Component>`,
  `
## Contract

<Props>
  <Prop name="item" model="{models#Contact}">The row to show.</Prop>
</Props>
<Parts>name, email, city</Parts>

## Models

<Model name="Address">
  Where a contact lives.
  <Field name="city" type="string" sample={['London', 'Boston']}>City.</Field>
</Model>
<Model name="Contact">
  One row.
  <Field name="id" type="string" key sample="c1">Identity.</Field>
  <Field name="name" type="string" sample={['Ada', 'Grace']}>Display name.</Field>
  <Field name="email" type="string" optional sample={['ada@example.com', null]}>Omitted when unknown.</Field>
  <Field name="address" type="{models#Address}">Where they live.</Field>
</Model>
`,
)

const LIST_SOURCE = page(
  'contact-list',
  `  <Component name="ContactList" status="draft" implements="hwc-list" layoutMode="VERTICAL">
    <Repeat slot="item" count={3}>
      <Instance name="row" component="ContactItem" />
    </Repeat>
    <Slot name="empty" />
  </Component>`,
  `
## Contract

<Props>
  <Prop name="items" type="Contact[]">Rows to show.</Prop>
</Props>
<Slots>
  <Slot name="item" repeats model="{models#Contact}" accepts="hwc-list-item">One per row.</Slot>
  <Slot name="empty">Shown while there are no rows.</Slot>
</Slots>

## Models

<Model name="Contact">
  One row.
  <Field name="id" type="string" key sample="c1">Identity.</Field>
  <Field name="name" type="string" sample={['Ada', 'Grace']}>Display name.</Field>
</Model>
`,
)

describe('models bind samples into the tree (ADR 0015)', () => {
  it('resolves {item.field} on a definition to the first sample, one model deep', () => {
    const scene = toSceneGraph(parseOrThrow(ROW_SOURCE))
    expect(scene.graph.getNode('ContactItem#name')!.text).toBe('Ada')
    expect(scene.graph.getNode('ContactItem#email')!.text).toBe('ada@example.com')
    expect(scene.graph.getNode('ContactItem#city')!.text).toBe('London')
    expect(scene.warnings).toEqual([])
  })
})

describe('<Repeat> multiplies one instance (ADR 0017 §2)', () => {
  const row = parseOrThrow(ROW_SOURCE)
  const list = parseOrThrow(LIST_SOURCE)
  const index = componentIndex(row, list)
  const scene = toSceneGraph(list, { resolveComponent: (name) => index.get(name) })

  it('draws count clones, the n-th filled from the n-th sample, wrapping and blanking', () => {
    const text = (n: number, part: string) =>
      scene.graph.getNode(`ContactList#row-${n}/${part}`)!.text
    expect(scene.graph.getNode('ContactList#row-1')!.type).toBe('INSTANCE')
    expect([text(1, 'name'), text(2, 'name'), text(3, 'name')]).toEqual(['Ada', 'Grace', 'Ada'])
    expect(text(2, 'email')).toBe('')
    expect(scene.graph.getNode('ContactList#row-4')).toBeUndefined()
    expect(scene.warnings).toEqual([])
  })

  it('links neither the repeat nor its clones', () => {
    expect(scene.addresses.sceneIdOf('ContactList#repeat(item)')).toBeUndefined()
    expect(scene.addresses.sceneIdOf('ContactList#row')).toBeUndefined()
    expect(scene.addresses.sceneIdOf('ContactList#empty')).toBe('ContactList#empty')
  })

  it('expands inside an instance of the list as well', () => {
    const home = parseOrThrow(page('home', `  <Instance name="people" component="ContactList" />`))
    const built = toSceneGraph(home, { resolveComponent: (name) => index.get(name) })
    expect(built.graph.getNode('people#row-1/name')!.text).toBe('Ada')
    expect(built.graph.getNode('people#row-2/name')!.text).toBe('Grace')
    expect(built.warnings).toEqual([])
  })
})

describe('auditDesignSystem', () => {
  const codes = (source: string) => auditDesignSystem(parseOrThrow(source)).map((d) => d.code)

  it('passes the fixtures', () => {
    expect(auditDesignSystem(parseOrThrow(CHECKBOX_SOURCE))).toEqual([])
    expect(auditDesignSystem(parseOrThrow(ROW_SOURCE))).toEqual([])
  })

  it('demands every declared part be bound once, by a declared name', () => {
    expect(codes(CHECKBOX_SOURCE.replace('part="checked-indicator"', ''))).toContain(
      CODES.PART_BINDING,
    )
    expect(codes(CHECKBOX_SOURCE.replace('part="checked-indicator"', 'part="tick"'))).toContain(
      CODES.PART_BINDING,
    )
  })

  it('checks style rows against the axes, the parts and the vocabulary', () => {
    expect(codes(CHECKBOX_SOURCE.replace('state="hover"', 'state="pressed"'))).toContain(
      CODES.STYLE_ROW,
    )
    expect(codes(CHECKBOX_SOURCE.replace('root:opacity', 'halo:opacity'))).toContain(
      CODES.STYLE_ROW,
    )
  })

  it('warns about an axis value nothing styles', () => {
    const found = auditDesignSystem(
      parseOrThrow(CHECKBOX_SOURCE.replace('<Style state="disabled" root:opacity={0.4} />', '')),
    )
    expect(found.map((d) => [d.code, d.severity])).toContainEqual([CODES.AXIS_UNCOVERED, 'warning'])
  })

  it('ties declared slots to <Slot> nodes', () => {
    expect(codes(CHECKBOX_SOURCE.replace('<Slot name="label" />', ''))).toContain(
      CODES.SLOT_BINDING,
    )
    expect(
      codes(CHECKBOX_SOURCE.replace('<Slot name="label" />', '<Slot name="hint" />')),
    ).toContain(CODES.SLOT_BINDING)
  })

  it('demands samples, keys and real fields of models', () => {
    expect(codes(ROW_SOURCE.replace(` sample={['Ada', 'Grace']}`, ''))).toContain(CODES.MODEL_FIELD)
    expect(codes(LIST_SOURCE.replace(' key sample="c1"', ' sample="c1"'))).toContain(
      CODES.MODEL_FIELD,
    )
    expect(codes(ROW_SOURCE.replace('{item.email}', '{item.phone}'))).toContain(CODES.BINDING)
    expect(codes(ROW_SOURCE.replace('{item.email}', '{row.email}'))).toContain(CODES.BINDING)
  })

  it('accepts a repeat only on a repeating slot with an accepted instance', () => {
    expect(codes(LIST_SOURCE.replace('slot="item" count', 'slot="empty" count'))).toContain(
      CODES.BAD_REPEAT,
    )
    expect(codes(LIST_SOURCE)).toEqual([])
  })
})

describe('contractJson', () => {
  it('prints the spec as plain data with the tree facts a generator needs', () => {
    const json = contractJson(parseOrThrow(CHECKBOX_SOURCE))
    expect(json.components).toEqual([
      {
        name: 'Checkbox',
        implements: 'hwc-checkbox',
        status: 'stable',
        boundParts: ['checked-indicator'],
        treeSlots: ['label'],
        axes: { size: ['md', 'sm'], state: ['default', 'checked', 'hover', 'disabled'] },
      },
    ])
    expect(JSON.stringify(json)).not.toContain('"loc"')
    expect((json.contract as { props: { name: string }[] }).props.map((p) => p.name)).toEqual([
      'checked',
      'size',
      'disabled',
    ])
  })
})
