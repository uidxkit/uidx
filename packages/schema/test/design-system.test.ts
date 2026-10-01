import { describe, expect, it } from 'vitest'
import { CODES, parseOrThrow, resolve, type JsonValue, type UidxNode } from '@uidx/format'
import { deriveVariants } from '../src/design-system.js'
import {
  auditDesignSystem,
  contractJson,
  defaultVariantAddress,
  defaultVariantName,
  derivedTarget,
  modelIndex,
  repeatListType,
  toSceneGraph,
} from '../src/index.js'

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
<Parts><Part name="checked-indicator">The mark drawn while checked.</Part></Parts>
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

  it('names where a base layer is drawn: its twin under the default combination', () => {
    const name = defaultVariantName(resolve(doc.tree, 'Checkbox')!)!
    const twin = defaultVariantAddress(doc, 'Checkbox#check')
    expect(twin).toBe(`Checkbox#${name}/root/check`)
    expect(scene.graph.getNode(twin!)).toBeDefined()
    expect(derivedTarget(doc, twin!)).toMatchObject({
      isDefault: true,
      target: 'checked-indicator',
    })
    expect(defaultVariantAddress(doc, 'Checkbox')).toBe(`Checkbox#${name}/root`)
    // Already into the set, or outside any derived component: nothing to map.
    expect(defaultVariantAddress(doc, twin!)).toBeNull()
    expect(defaultVariantAddress(parseOrThrow(ROW_SOURCE), 'ContactOption#who')).toBeNull()
  })

  it('draws the component as a set with one tree per combination, default first', () => {
    expect(set.type).toBe('COMPONENT_SET')
    const names = (set.childIds ?? []).map((id) => scene.graph.getNode(id)!.name)
    // Two sizes, default first, times four states: default, then the visual
    // booleans in prop order, then the interaction states the table names.
    expect(names).toHaveLength(8)
    expect(names[0]).toBe('size=md, state=default')
    expect(names).toContain('size=sm, state=checked')
    expect(set.componentPropertyDefinitions?.map((d) => [d.name, d.variantOptions])).toEqual([
      ['size', ['md', 'sm']],
      ['state', ['default', 'checked', 'disabled', 'hover']],
    ])
  })

  it('leaves the set itself unpainted: paint and layout live on each root', () => {
    expect(set.fills ?? []).toEqual([])
    expect(set.layoutMode).toBe('NONE')
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

  it('links the derived tree too: an edit to a state has a style row to go to', () => {
    expect(scene.addresses.sceneIdOf('Checkbox')).toBe('Checkbox')
    expect(scene.addresses.sceneIdOf('Checkbox#size=md, state=default')).toBe(
      'Checkbox#size=md, state=default',
    )
    expect(scene.addresses.sceneIdOf('Checkbox#size=md, state=hover/root/check')).toBe(
      'Checkbox#size=md, state=hover/root/check',
    )
    expect(scene.warnings).toEqual([])
  })

  it('names what a derived address is: its row, its target, its base, whether it is the default', () => {
    const hoverCheck = derivedTarget(doc, 'Checkbox#size=md, state=hover/root/check')!
    expect(hoverCheck.keys).toEqual({ size: 'md', state: 'hover' })
    expect(hoverCheck.target).toBe('checked-indicator')
    expect(hoverCheck.base.address).toBe('Checkbox#check')
    expect(hoverCheck.isDefault).toBe(false)
    const defaultRoot = derivedTarget(doc, 'Checkbox#size=md, state=default/root')!
    expect(defaultRoot).toMatchObject({ target: 'root', isDefault: true })
    expect(defaultRoot.base.address).toBe('Checkbox')
    expect(derivedTarget(doc, 'Checkbox#size=md, state=hover')).toMatchObject({ target: 'root' })
    expect(derivedTarget(doc, 'Checkbox#check')).toBeNull()
    expect(derivedTarget(doc, 'Checkbox#size=xl, state=hover/root')).toBeNull()
    expect(derivedTarget(doc, 'Checkbox')).toBeNull()
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
  <Prop name="item" type="Contact">The row to show.</Prop>
</Props>

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
  <Field name="address" type="Address">Where they live.</Field>
</Model>
`,
)

const LIST_SOURCE = page(
  'contact-list',
  `  <Component name="ContactList" status="draft" implements="hwc-list" layoutMode="VERTICAL">
    <Slot name="item" repeat="{items}">
      <Instance name="row" component="ContactItem" props={{ item: '{item}' }} />
    </Slot>
    <Slot name="empty" />
  </Component>`,
  `
## Contract

<Props>
  <Prop name="items" type="Contact[]">Rows to show.</Prop>
</Props>
<Slots>
  <Slot name="item" accepts="hwc-list-item">One per row.</Slot>
  <Slot name="empty">Shown while there are no rows.</Slot>
</Slots>
`,
)

/** An inline repeat: the frame is the row, drawn once per item, with a nested repeat below it. */
const INLINE_SOURCE = page(
  'inline-list',
  `  <Component name="Team" status="draft" layoutMode="VERTICAL">
    <Text name="title" characters="{title}" />
    <Frame name="row" repeat="{people}" as="person" layoutMode="HORIZONTAL">
      <Text name="name" characters="{person.name}" />
      <Text name="also" characters="{title}" />
      <Frame name="tags" repeat="{person.tags}" as="tag">
        <Text name="tag-name" characters="{tag.label}" />
      </Frame>
    </Frame>
  </Component>`,
  `
## Contract

<Props>
  <Prop name="title" type="string" sample="Team">Heading.</Prop>
  <Prop name="people" type="Person[]">Rows.</Prop>
</Props>

## Models

<Model name="Tag">
  A label.
  <Field name="label" type="string" key sample={['lead', 'new']}>Words.</Field>
</Model>
<Model name="Person">
  One person.
  <Field name="id" type="string" key sample={['a', 'b']}>Identity.</Field>
  <Field name="name" type="string" sample={['Ada', 'Grace']}>Display name.</Field>
  <Field name="tags" type="Tag[]">Their tags.</Field>
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

  it('shows a prop by its sample before its default, and a text with neither stays empty', () => {
    const scene = toSceneGraph(
      parseOrThrow(
        page(
          'labelled',
          `  <Component name="Labelled" status="draft" layoutMode="VERTICAL">
    <Text name="a" characters="{label}" />
    <Text name="b" characters="{hint}" />
    <Text name="c" characters="{note}" />
  </Component>`,
          `
## Contract

<Props>
  <Prop name="label" type="string" default="Button" sample="Save changes">Text.</Prop>
  <Prop name="hint" type="string" default="A hint">Text.</Prop>
  <Prop name="note" type="string">Text.</Prop>
</Props>
`,
        ),
      ),
    )
    expect(scene.graph.getNode('Labelled#a')!.text).toBe('Save changes')
    expect(scene.graph.getNode('Labelled#b')!.text).toBe('A hint')
    expect(scene.graph.getNode('Labelled#c')!.text).toBe('')
  })
})

describe('a composition passes its own props through (ADR 0017 §3)', () => {
  const field = parseOrThrow(
    page(
      'field',
      `  <Component name="Field" status="stable" implements="hwc-field" layoutMode="VERTICAL">
    <Slot name="control" />
    <Text name="label" part="label" characters="{label}" />
  </Component>`,
      `
## Contract

<Props>
  <Prop name="label" type="string" sample="Email">The control's name.</Prop>
</Props>
<Slots><Slot name="control">The control.</Slot></Slots>
`,
    ),
  )
  const outer = (props: string) =>
    parseOrThrow(
      page(
        'checkbox-field',
        `  <Component name="CheckboxField" status="stable">
    <Instance name="field" component="Field" props={${props}} />
  </Component>`,
        `
## Contract

<Props>
  <Prop name="label" type="string" sample="Remember me">The option's name.</Prop>
</Props>
<Composes with="Field" />
`,
      ),
    )
  const build = (props: string) => {
    const doc = outer(props)
    const index = componentIndex(doc, field)
    return toSceneGraph(doc, { resolveComponent: (name) => index.get(name) })
  }

  it("resolves '{label}' in the consumer's scope, not the definition's", () => {
    const scene = build(`{ label: '{label}' }`)
    expect(scene.graph.getNode('CheckboxField#field/label')!.text).toBe('Remember me')
    expect(scene.warnings).toEqual([])
  })

  it('accepts a literal for a prop the contract alone declares', () => {
    expect(build(`{ label: 'Hi' }`).graph.getNode('CheckboxField#field/label')!.text).toBe('Hi')
  })

  it('keeps the default when the passed value is of the wrong type or unresolved', () => {
    expect(build(`{ label: true }`).graph.getNode('CheckboxField#field/label')!.text).toBe('Email')
    expect(build(`{ label: '{nothing}' }`).graph.getNode('CheckboxField#field/label')!.text).toBe(
      'Email',
    )
  })
})

describe('a slot that says nothing about its size', () => {
  it('hugs its placeholder rather than sitting in the engine default box', () => {
    const scene = toSceneGraph(parseOrThrow(LIST_SOURCE))
    const empty = scene.graph.getNode('ContactList#empty')
    expect(empty).toBeDefined()
    expect(empty!.primaryAxisSizing).toBe('HUG')
    expect(empty!.counterAxisSizing).toBe('HUG')
  })
})

describe('repeat draws an element once per item (ADR 0017 §2)', () => {
  const row = parseOrThrow(ROW_SOURCE)
  const list = parseOrThrow(LIST_SOURCE)
  const index = componentIndex(row, list)
  const scene = toSceneGraph(list, { resolveComponent: (name) => index.get(name) })

  it('draws one row per sample of a repeating slot, the n-th filled from the n-th, wrapping and blanking', () => {
    const at = (n: number) => (n === 1 ? 'ContactList#item' : `ContactList#item-${n}`)
    const text = (n: number, part: string) => scene.graph.getNode(`${at(n)}/row/${part}`)!.text
    expect(scene.graph.getNode('ContactList#item')!.type).toBe('FRAME')
    expect(scene.graph.getNode('ContactList#item/row')!.type).toBe('INSTANCE')
    expect(scene.graph.getNode('ContactList#item-3')!.type).toBe('FRAME')
    expect(scene.graph.getNode('ContactList#item-4')).toBeUndefined()
    expect([text(1, 'name'), text(2, 'name'), text(3, 'name')]).toEqual(['Ada', 'Grace', 'Ada'])
    expect([text(1, 'email'), text(2, 'email')]).toEqual(['ada@example.com', ''])
    expect(scene.warnings).toEqual([])
  })

  it('links the first row as the layer itself, and nothing after it', () => {
    expect(scene.addresses.sceneIdOf('ContactList')).toBe('ContactList')
    expect(scene.addresses.sceneIdOf('ContactList#empty')).toBe('ContactList#empty')
    // The layer is its first row: selectable, and an edit lands on the source.
    expect(scene.addresses.sceneIdOf('ContactList#item')).toBe('ContactList#item')
    expect(scene.addresses.addressOf('ContactList#item/row')).toBe('ContactList#item/row')
    // The echoes are generated content with no source to patch.
    expect(scene.addresses.addressOf('ContactList#item-2')).toBeUndefined()
    expect(scene.addresses.addressOf('ContactList#item-2/row/name')).toBeUndefined()
  })

  it('repeats a plain frame inline, binding {as.field} and nesting, beside the component props', () => {
    const inline = toSceneGraph(parseOrThrow(INLINE_SOURCE))
    expect(inline.graph.getNode('Team#row/name')!.text).toBe('Ada')
    expect(inline.graph.getNode('Team#row-2/name')!.text).toBe('Grace')
    expect(inline.graph.getNode('Team#row-3')).toBeUndefined()
    // A row still reads its component's own props.
    expect(inline.graph.getNode('Team#row/also')!.text).toBe('Team')
    // The nested repeat draws the nested model's samples.
    expect(inline.graph.getNode('Team#row/tags/tag-name')!.text).toBe('lead')
    expect(inline.graph.getNode('Team#row/tags-2/tag-name')!.text).toBe('new')
    expect(inline.graph.getNode('Team#row-2/tags/tag-name')).toBeDefined()
    expect(inline.warnings).toEqual([])
  })
})

describe('a use asks for a state with a bound value (ADR 0017 §2, ADR 0016)', () => {
  const LIST = page(
    'todo',
    `  <Component name="Todo" status="draft" layoutMode="VERTICAL">
    <Instance name="row" component="Checkbox" repeat="{items}" props={{ checked: '{item.done}' }} />
  </Component>`,
    `
## Contract

<Props>
  <Prop name="items" type="Task[]">Rows.</Prop>
</Props>

## Models

<Model name="Task">
  One task.
  <Field name="id" type="string" key sample={['a', 'b']}>Identity.</Field>
  <Field name="done" type="boolean" sample={[true, false]}>Whether it is checked.</Field>
</Model>
`,
  )
  it('spells out a text bound to a boolean or a number rather than crashing the layout', () => {
    const source = LIST.replace(
      `<Instance name="row" component="Checkbox" repeat="{items}" props={{ checked: '{item.done}' }} />`,
      `<Frame name="row" repeat="{items}"><Text name="flag" characters="{item.done}" /></Frame>`,
    )
    const scene = toSceneGraph(parseOrThrow(source), { resolveAlias })
    expect(scene.graph.getNode('Todo#row/flag')!.text).toBe('true')
    expect(scene.graph.getNode('Todo#row-2/flag')!.text).toBe('false')
  })

  it('draws the set of a component with a visual prop before any style row exists', () => {
    const bare = CHECKBOX_SOURCE.replace(/<Styles>[\s\S]*?<\/Styles>\n/, '')
    const doc = parseOrThrow(bare)
    expect(doc.spec?.styles ?? []).toEqual([])
    const scene = toSceneGraph(doc, { resolveAlias })
    expect(scene.graph.getNode('Checkbox')!.type).toBe('COMPONENT_SET')
    const set = scene.graph.getNode('Checkbox')!
    const names = (set.childIds as string[]).map((id) => id.slice('Checkbox#'.length))
    expect(names.some((name) => name.includes('state=checked'))).toBe(true)
  })

  it('draws each row in the state its sample says', () => {
    const checkbox = parseOrThrow(CHECKBOX_SOURCE)
    const index = componentIndex(checkbox, parseOrThrow(LIST))
    const scene = toSceneGraph(parseOrThrow(LIST), {
      resolveAlias,
      resolveComponent: (name) => index.get(name),
    })
    // `state="checked"` shows the indicator; the default hides it.
    expect(scene.graph.getNode('Todo#row/root/check')!.visible).toBe(true)
    expect(scene.graph.getNode('Todo#row-2/root/check')!.visible).toBe(false)
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
    // The model lives on the row's page; the list's repeat still needs its key.
    const noKey = modelIndex([parseOrThrow(ROW_SOURCE.replace(' key sample="c1"', ' sample="c1"'))])
    expect(auditDesignSystem(parseOrThrow(LIST_SOURCE), noKey).map((d) => d.code)).toContain(
      CODES.MODEL_FIELD,
    )
    expect(
      auditDesignSystem(parseOrThrow(LIST_SOURCE), modelIndex([parseOrThrow(ROW_SOURCE)])),
    ).toEqual([])
    expect(codes(ROW_SOURCE.replace('{item.email}', '{item.phone}'))).toContain(CODES.BINDING)
    expect(codes(ROW_SOURCE.replace('{item.email}', '{row.email}'))).toContain(CODES.BINDING)
  })

  it('checks what a repeat names, what it calls the item, and what an accepting slot holds', () => {
    expect(codes(LIST_SOURCE.replace('repeat="{items}"', 'repeat="{rows}"'))).toContain(
      CODES.BAD_REPEAT,
    )
    expect(codes(INLINE_SOURCE.replace('as="tag"', 'as="person"'))).toContain(CODES.BAD_REPEAT)
    expect(codes(INLINE_SOURCE.replace('{person.tags}', '{person.name}'))).toContain(
      CODES.BAD_REPEAT,
    )
    expect(codes(INLINE_SOURCE.replace('{tag.label}', '{tag.colour}'))).toContain(CODES.BINDING)
    expect(codes(INLINE_SOURCE)).toEqual([])
    expect(
      auditDesignSystem(parseOrThrow(LIST_SOURCE), modelIndex([parseOrThrow(ROW_SOURCE)])),
    ).toEqual([])
  })

  it('tells a list of a shared model from no list at all', () => {
    // The list page alone: `items` is a `Contact[]` prop, its model on the
    // row's page. Placed by type, so a page audited by itself says nothing.
    expect(codes(LIST_SOURCE)).toEqual([])
    // With every page indexed and still no such model, the type names nothing.
    const found = auditDesignSystem(parseOrThrow(LIST_SOURCE), modelIndex([]))
    expect(found.map((d) => d.code)).toEqual([CODES.BAD_REPEAT])
    expect(found[0]!.message).toContain('which no page declares')
    const list = parseOrThrow(LIST_SOURCE)
    const repeat = { list: 'items', as: 'item' }
    expect(repeatListType(repeat, list.spec, [])).toBe('Contact[]')
    expect(repeatListType({ ...repeat, list: 'rows' }, list.spec, [])).toBeUndefined()
    // Under an item whose model is unknown here, nothing can be said either way.
    expect(
      repeatListType({ list: 'item.tags', as: 'tag' }, list.spec, [
        { as: 'item', model: undefined },
      ]),
    ).toBeNull()
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
        axes: { size: ['md', 'sm'], state: ['default', 'checked', 'disabled', 'hover'] },
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

describe('a whole-attribute paint alias', () => {
  it('resolves a COLOR token on fills and strokes to one solid paint', () => {
    const doc = parseOrThrow(
      page(
        'paint',
        `  <Frame name="box" fills="{color#brand}" strokes="{color#brand}" strokeWeight={2} />`,
      ),
    )
    const scene = toSceneGraph(doc, {
      resolveAlias: (address) =>
        address === 'color#brand' ? { r: 0, g: 0.5, b: 1, a: 1 } : undefined,
    })
    const box = scene.graph.getNode('box')!
    expect(box.fills).toHaveLength(1)
    expect(box.fills![0]).toMatchObject({ type: 'SOLID', color: { r: 0, g: 0.5, b: 1, a: 1 } })
    // Strokes go through the composition that folds `strokeWeight` in; a
    // stroke that skipped it would keep the colour and lose its weight, and
    // draw as nothing.
    expect(box.strokes?.[0]).toMatchObject({
      color: { r: 0, g: 0.5, b: 1, a: 1 },
      weight: 2,
      align: 'INSIDE',
    })
    expect(scene.warnings).toEqual([])
  })
})

describe('derivable variants (ADR 0016 §5)', () => {
  const page = (variants: string) =>
    parseOrThrow(`---
id: toggle
---

## Visual Contract

<Page>
  <Component name="Toggle" status="draft" variants={{ state: ['off', 'on'] }}>
${variants}
  </Component>
</Page>
`)
  const codes = (doc: ReturnType<typeof parseOrThrow>) => auditDesignSystem(doc).map((d) => d.code)

  it('suggests a styles table when every variant shares one anatomy', () => {
    const doc =
      page(`    <Variant state="off"><Frame name="track" width={40} height={24} /></Variant>
    <Variant state="on"><Frame name="track" width={40} height={24} opacity={0.5} /></Variant>`)
    expect(codes(doc)).toContain('UIDX153')
  })

  it('leaves structural variants alone', () => {
    const doc =
      page(`    <Variant state="off"><Frame name="track" width={40} height={24} /></Variant>
    <Variant state="on"><Frame name="track" width={40} height={24}><Frame name="knob" width={8} height={8} /></Frame></Variant>`)
    expect(codes(doc)).not.toContain('UIDX153')
  })
})

describe('the empty state (ADR 0017 §4)', () => {
  const doc = parseOrThrow(
    page(
      'list',
      `  <Component name="List" status="draft" layoutMode="VERTICAL">
    <Frame name="row" repeat="{items}" width={100} height={20} />
    <Text name="nobody" characters="Nobody yet" visible={false} />
  </Component>`,
      `
<Styles>
  <Style state="empty" nobody:visible={true} />
</Styles>

## Contract

<Props>
  <Prop name="items" type="Row[]">The rows.</Prop>
</Props>

## Models

<Model name="Row">
  One row.
  <Field name="id" type="string" key sample={['a', 'b']}>Identity.</Field>
</Model>
`,
    ),
  )

  it('joins the state axis of a component with a list prop', () => {
    expect(contractJson(doc)).toMatchObject({
      components: [{ axes: { state: ['default', 'empty'] } }],
    })
  })

  it('draws no rows for the list in the empty state', () => {
    const set = deriveVariants(doc.tree.children[0]!)
    const rows = (variant: string) =>
      set.children
        .find((node) => node.name === variant)!
        .children[0]!.children.map((node) => node.name)
    expect(rows('state=default')).toEqual(['row', 'nobody'])
    expect(rows('state=empty')).toEqual(['nobody'])
  })
})
