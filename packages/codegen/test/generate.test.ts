import { describe, expect, it } from 'vitest'
import { CODES, parseOrThrow } from '@uidx/format'
import { generate, tsType, componentModel, partTag } from '../src/index.js'
import { CHECKBOX, CONTACT_ITEM, CONTACT_LIST, FIELD, MANIFEST, TOKENS } from './fixtures.js'

/**
 * Code is a render target (ADR 0017 §3). These pin what each target gets
 * from the identity: the base tree and the styles table as CSS keyed by the
 * headless root's attributes and states; props, events, slots and repeats as
 * a typed React component; and the contract checked against the manifest.
 */
const PAGES = [
  { file: 'checkbox.uidx', doc: CHECKBOX },
  { file: 'field.uidx', doc: FIELD },
  { file: 'contact-item.uidx', doc: CONTACT_ITEM },
  { file: 'contact-list.uidx', doc: CONTACT_LIST },
]
const output = generate({ pages: PAGES, tokens: [TOKENS], manifest: MANIFEST })
const file = (path: string) => {
  const text = output.files.get(path)
  if (text === undefined) throw new Error(`no ${path}; have ${[...output.files.keys()].join(', ')}`)
  return text
}

describe('what an instance in a repeat receives (ADR 0017 §2)', () => {
  const TREE = `---
id: tree
---

## Visual Contract

<Page>
  <Component name="Tree" status="draft" layoutMode="VERTICAL">
    <Slot name="node" repeat="{nodes}">
      <Instance name="row" component="TreeItem" />
      <Frame name="children">
        <Instance name="child-row" component="TreeItem" repeat="{item.children}" as="child" props={{ depth: '{child.depth}' }} />
      </Frame>
    </Slot>
  </Component>
</Page>

## Contract

<Props>
  <Prop name="nodes" type="TreeNode[]">The top-level nodes.</Prop>
</Props>
<Slots>
  <Slot name="node">One per node.</Slot>
</Slots>
`
  const ITEM = `---
id: tree-item
---

## Visual Contract

<Page>
  <Component name="TreeItem" status="draft" layoutMode="HORIZONTAL">
    <Text name="label" characters="{node.label}" />
  </Component>
</Page>

## Contract

<Props>
  <Prop name="node" type="TreeNode">The node this row shows.</Prop>
  <Prop name="depth" type="number">How deep the row sits.</Prop>
</Props>

## Models

<Model name="TreeNode">
  One node.
  <Field name="id" type="string" key sample={['a', 'b']}>Identity.</Field>
  <Field name="label" type="string" sample={['Documents', 'Photos']}>Words.</Field>
  <Field name="depth" type="number" sample={[0, 1]}>Level.</Field>
  <Field name="children" type="TreeNode[]">Below it.</Field>
</Model>
`
  it('keeps a pen-drawn chevron stroked rather than filled, in HTML and React', () => {
    const stroked = ITEM.replace(
      '<Text name="label" characters="{node.label}" />',
      `<Vector name="chevron" width={12} height={12} strokes={[{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }]} strokeWeight={2} strokeCap="ROUND" strokeJoin="ROUND" vectorPaths={[{ windingRule: 'NONZERO', data: 'M0 0L12 6L0 12' }]} />
    <Text name="label" characters="{node.label}" />`,
    )
    const out = generate({
      pages: [{ file: 'tree-item.uidx', doc: parseOrThrow(stroked) }],
      tokens: [],
    })
    expect(out.files.get('html/tree-item.html')).toContain(
      '<path d="M0 0L12 6L0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />',
    )
    expect(out.files.get('react/TreeItem.tsx')).toContain(
      'fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"',
    )
  })

  it('hands the nearest item of the right type to the model prop, and an explicit item field as written', () => {
    const out = generate({
      pages: [
        { file: 'tree.uidx', doc: parseOrThrow(TREE) },
        { file: 'tree-item.uidx', doc: parseOrThrow(ITEM) },
      ],
      tokens: [],
    })
    const react = out.files.get('react/Tree.tsx')!
    expect(react).toContain('<TreeItem node={item} />')
    expect(react).toContain('<TreeItem depth={child.depth} node={child} />')
  })
})

describe('generate', () => {
  it('is deterministic: the same input renders the same bytes', () => {
    const again = generate({ pages: PAGES, tokens: [TOKENS], manifest: MANIFEST })
    expect([...again.files]).toEqual([...output.files])
  })

  it('writes every target under its own folder', () => {
    expect([...output.files.keys()].sort()).toEqual([
      'contract/checkbox.json',
      'contract/contact-item.json',
      'contract/contact-list.json',
      'contract/field.json',
      'html/checkbox.css',
      'html/checkbox.html',
      'html/contact-item.css',
      'html/contact-item.html',
      'html/contact-list.css',
      'html/contact-list.html',
      'html/field.css',
      'html/field.html',
      'html/tokens.css',
      'react/Checkbox.tsx',
      'react/ContactItem.tsx',
      'react/ContactList.tsx',
      'react/Field.tsx',
      'react/checkbox.css',
      'react/contact-item.css',
      'react/contact-list.css',
      'react/elements.d.ts',
      'react/field.css',
      'react/index.ts',
      'react/models.ts',
      'react/runtime.ts',
      'react/tokens.css',
    ])
  })

  it('reports nothing against a manifest that agrees with the contracts', () => {
    expect(output.diagnostics).toEqual([])
  })
})

describe('tokens.css', () => {
  it('names every token as a custom property, colours as colours, numbers unitless', () => {
    expect(file('html/tokens.css')).toBe(
      `:root {\n  --radius-sm: 4;\n  --space-sm: 8;\n  --surface-accent: rgb(0 128 255);\n  --surface-control: rgb(255 255 255);\n}\n`,
    )
  })
})

describe('the HTML/CSS target', () => {
  const css = file('html/checkbox.css')

  it('styles the root and the parts from the base tree, tokens as variables', () => {
    expect(css).toContain(
      'hwc-checkbox {\n  width: 20px;\n  height: 20px;\n  border-radius: calc(var(--radius-sm) * 1px);\n  background-color: var(--surface-control);',
    )
    expect(css).toContain('hwc-checkbox hwc-checkbox-checked-indicator {\n  display: none;')
    // A vector's fill is its colour: its paths draw with currentColor.
    expect(css).toContain('  color: rgb(255 255 255);')
  })

  it('turns style rows into state and attribute rules on the root', () => {
    expect(css).toContain('hwc-checkbox[checked] {\n  background-color: var(--surface-accent);\n}')
    expect(css).toContain(
      'hwc-checkbox[checked] hwc-checkbox-checked-indicator {\n  display: inline-flex;\n}',
    )
    expect(css).toContain('hwc-checkbox:hover {')
    expect(css).toContain('hwc-checkbox[size="sm"] {\n  width: 16px;\n  height: 16px;\n}')
    expect(css).toContain('hwc-checkbox[disabled] {\n  opacity: 0.4;\n}')
  })

  it('renders the anatomy as markup with the parts as their elements', () => {
    expect(file('html/checkbox.html')).toContain(
      '<hwc-checkbox>\n  <hwc-checkbox-checked-indicator><svg viewBox="0 0 12 12"',
    )
    expect(file('html/field.html')).toContain('<hwc-field-label>Label</hwc-field-label>')
    expect(file('html/field.html')).toContain('<span data-slot="control">')
  })

  it("expands a repeat into the item component's markup at successive samples", () => {
    const html = file('html/contact-list.html')
    expect(html).toContain('<span data-node="name">Ada</span>')
    expect(html).toContain('<span data-node="name">Grace</span>')
    expect(html).toContain('<span data-node="email">ada@example.com</span>')
    expect(html).toContain('<span data-node="email"></span>')
    expect(html.split('<hwc-radio>')).toHaveLength(3)
  })
})

describe('a composition in the HTML target', () => {
  it("renders the instance it holds with this page's props laid over its samples", () => {
    const page = parseOrThrow(`---
id: checkbox-field
---

A checkbox with its words.

## Visual Contract

<Page>
  <Component name="CheckboxField" status="stable">
    <Instance name="field" component="Field" props={{ label: '{label}', description: 'Helper for this one' }}>
      <Slot name="control"><Instance name="box" component="Checkbox" /></Slot>
    </Instance>
  </Component>
</Page>

## Contract

<Props>
  <Prop name="label" type="string" sample="Remember me">The option's name.</Prop>
</Props>
<Composes with="Field, Checkbox" />
`)
    const out = generate({
      pages: [...PAGES, { file: 'checkbox-field.uidx', doc: page }],
      tokens: [TOKENS],
      manifest: MANIFEST,
    })
    const html = out.files.get('html/checkbox-field.html')!
    expect(html).toContain('<hwc-field-label>Remember me</hwc-field-label>')
    expect(html).toContain('<hwc-field-description>Helper for this one</hwc-field-description>')
    expect(html).toContain('<hwc-checkbox>')
  })
})

describe('a shadow part (cssParts in the manifest)', () => {
  const manifest = {
    modules: [
      {
        declarations: [
          {
            tagName: 'sl-switch',
            attributes: [{ name: 'checked' }],
            events: [{ name: 'change' }],
            cssParts: [{ name: 'thumb' }, { name: 'label' }],
          },
        ],
      },
    ],
  }
  const page = parseOrThrow(`---
id: switch
---

A switch whose parts live in the library's shadow tree.

## Visual Contract

<Page>
  <Component name="Switch" status="stable" implements="sl-switch" layoutMode="HORIZONTAL">
    <Frame name="thumb" part="thumb" width={16} height={16} fills="{surface#control}" />
    <Text name="label" part="label" characters="{label}" fontSize={14} />
  </Component>
</Page>

<Styles>
  <Style state="checked" thumb:fills="{surface#accent}" />
</Styles>

## Contract

<Props>
  <Prop name="checked" type="boolean" default={false} controllable visual>On or off.</Prop>
  <Prop name="label" type="string">The words.</Prop>
</Props>
<Events>
  <Event name="change" detail="{ checked: boolean }">Fires on toggle.</Event>
</Events>
`)
  const out = generate({
    pages: [{ file: 'switch.uidx', doc: page }],
    tokens: [TOKENS],
    manifest,
  })

  it('styles it through ::part() and emits no element for it', () => {
    const css = out.files.get('html/switch.css')!
    expect(css).toContain('sl-switch::part(thumb) {')
    expect(css).toContain('sl-switch[checked]::part(thumb) {')
    expect(css).toContain('sl-switch::part(label) {')
    const html = out.files.get('html/switch.html')!
    expect(html).not.toContain('sl-switch-thumb')
    expect(html).not.toContain('sl-switch-label')
    expect(html).toContain('<sl-switch>')
    const tsx = out.files.get('react/Switch.tsx')!
    expect(tsx).not.toContain('Switch.Label')
    expect(tsx).not.toContain('sl-switch-label')
  })

  it('conforms without comment: the library drawing the part is how it works', () => {
    expect(out.diagnostics).toEqual([])
  })
})

describe('a library profile and bindings (ADR 0013 §3)', () => {
  const shoelace = {
    modules: [
      {
        declarations: [
          {
            tagName: 'sl-checkbox',
            attributes: [{ name: 'checked' }, { name: 'disabled' }, { name: 'indeterminate' }],
            events: [{ name: 'sl-change' }],
            cssParts: [{ name: 'control' }],
          },
        ],
      },
    ],
  }
  const bindings = {
    components: {
      Checkbox: {
        tag: 'sl-checkbox',
        parts: { 'checked-indicator': 'control' },
        events: { change: 'sl-change' },
      },
    },
  }
  const out = generate({
    pages: [{ file: 'checkbox.uidx', doc: CHECKBOX }],
    tokens: [TOKENS],
    manifest: shoelace,
    library: bindings,
  })

  it("renders the same identity over another library's names, without editing the file", () => {
    const css = out.files.get('html/checkbox.css')!
    expect(css).toContain('sl-checkbox {')
    expect(css).toContain('sl-checkbox[checked]::part(control) {')
    expect(out.files.get('html/checkbox.html')!).toContain('<sl-checkbox>')
    const tsx = out.files.get('react/Checkbox.tsx')!
    expect(tsx).toContain('<sl-checkbox ref={ref}')
    expect(tsx).toContain(`useElementEvent(ref, 'sl-change', onChange)`)
    expect(out.diagnostics).toEqual([])
  })

  it('spells props and element states the way the profile says', () => {
    const page = parseOrThrow(`---
id: toggle
---

A toggle over a class-driven library.

## Visual Contract

<Page>
  <Component name="Toggle" status="stable" implements="x-toggle" layoutMode="HORIZONTAL">
    <Frame name="knob" part="knob" width={10} height={10} />
  </Component>
</Page>

<Styles>
  <Style state="on" root:opacity={1} />
  <Style state="busy" root:opacity={0.5} />
  <Style tone="warm" root:opacity={0.9} />
</Styles>

## Contract

<Props>
  <Prop name="on" type="boolean" default={false} visual>Whether it is on.</Prop>
  <Prop name="tone" type="'cool' | 'warm'" default="cool" visual>Colour.</Prop>
</Props>
<States><State name="busy">Working.</State></States>
`)
    const dataDriven = generate({
      pages: [{ file: 'toggle.uidx', doc: page }],
      library: {
        profile: { props: 'data-attribute', customStates: 'data-attribute', parts: 'data-part' },
      },
    })
    const css = dataDriven.files.get('html/toggle.css')!
    expect(css).toContain('x-toggle[data-on] {')
    expect(css).toContain('x-toggle[data-busy] {')
    expect(css).toContain('x-toggle[data-tone="warm"] {')
    expect(css).toContain('x-toggle [data-part="knob"] {')
    expect(dataDriven.files.get('html/toggle.html')!).toContain('<span data-part="knob">')
    expect(dataDriven.files.get('react/Toggle.tsx')!).toContain('data-on={on || undefined}')

    const classDriven = generate({
      pages: [{ file: 'toggle.uidx', doc: page }],
      library: { profile: { props: 'class', customStates: 'class' } },
    })
    const classCss = classDriven.files.get('html/toggle.css')!
    expect(classCss).toContain('x-toggle.on {')
    expect(classCss).toContain('x-toggle.busy {')
    expect(classCss).toContain('x-toggle.tone-warm {')
    expect(classDriven.files.get('react/Toggle.tsx')!).toContain(
      "className={[className, on ? 'on' : undefined, tone !== undefined ? `tone-${tone}` : undefined].filter(Boolean).join(' ')}",
    )
  })
})

describe('the React target', () => {
  it('types props and events from the contract and wraps the headless root', () => {
    const tsx = file('react/Checkbox.tsx')
    expect(tsx).toContain(`  /** Whether the option is selected. */\n  checked?: boolean`)
    expect(tsx).toContain(`size?: 'sm' | 'md'`)
    expect(tsx).toContain(`onChange?: (detail: { checked: boolean }) => void`)
    expect(tsx).toContain(`useElementEvent(ref, 'change', onChange)`)
    expect(tsx).toContain(
      `<hwc-checkbox ref={ref} className={className} style={style} checked={checked || undefined}`,
    )
    expect(tsx).toContain(`size = "md"`)
    expect(tsx).not.toContain('ReactNode')
  })

  it('turns slots into ReactNode props and text parts into compound sub-components', () => {
    const tsx = file('react/Field.tsx')
    expect(tsx).toContain(`label?: ReactNode`)
    expect(tsx).toContain(`control?: ReactNode`)
    expect(tsx).toContain(`<hwc-field-label>{label}</hwc-field-label>`)
    expect(tsx).toContain(
      `{control !== undefined ? <span data-slot="control">{control}</span> : null}`,
    )
    expect(tsx).toContain(
      `export const Field = Object.assign(FieldBase, {\n  Label: FieldLabel,\n  Description: FieldDescription,\n})`,
    )
  })

  it('maps a repeating slot over its list, with a render prop named after the slot', () => {
    const tsx = file('react/ContactList.tsx')
    expect(tsx).toContain(`items: Contact[]`)
    expect(tsx).toContain(`renderItem?: (item: Contact, index: number) => ReactNode`)
    expect(tsx).not.toContain('ItemComponent')
    expect(tsx).toContain(`{items.map((item, index) => (`)
    expect(tsx).toContain(`<Fragment key={String(item.id)}>`)
    expect(tsx).toContain(`{renderItem ? renderItem(item, index) : (`)
    expect(tsx).toContain(`<ContactItem item={item} />`)
    expect(tsx).toContain(`import { ContactItem } from './ContactItem'`)
  })

  it('repeats a plain frame inline, nesting and binding the item, with no render prop', () => {
    const page = parseOrThrow(`---
id: team
---

A team.

## Visual Contract

<Page>
  <Component name="Team" status="stable" layoutMode="VERTICAL">
    <Frame name="row" repeat="{people}" as="person" layoutMode="HORIZONTAL">
      <Text name="name" characters="{person.name}" fontSize={14} />
      <Frame name="tags" repeat="{person.tags}" as="tag" layoutMode="HORIZONTAL">
        <Text name="tag-name" characters="{tag.label}" fontSize={12} />
      </Frame>
    </Frame>
  </Component>
</Page>

## Contract

<Props>
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
`)
    const out = generate({ pages: [{ file: 'team.uidx', doc: page }], tokens: [TOKENS] })
    const tsx = out.files.get('react/Team.tsx')!
    expect(tsx).toContain(`people: Person[]`)
    expect(tsx).not.toContain('renderRow')
    expect(tsx).toContain(`{people.map((person, index) => (`)
    expect(tsx).toContain(`<Fragment key={String(person.id)}>`)
    expect(tsx).toContain(`{person?.name}`)
    expect(tsx).toContain(`{person.tags.map((tag, index) => (`)
    expect(tsx).toContain(`{tag?.label}`)
    const html = out.files.get('html/team.html')!
    expect(html).toContain('<span data-node="name">Ada</span>')
    expect(html).toContain('<span data-node="name">Grace</span>')
    expect(html).toContain('<span data-node="tag-name">lead</span>')
    expect(out.diagnostics).toEqual([])
  })

  it("binds a model prop's fields into the parts", () => {
    const tsx = file('react/ContactItem.tsx')
    expect(tsx).toContain(`item: Contact`)
    expect(tsx).toContain(`<span data-node="name">{item?.name}</span>`)
    expect(tsx).toContain(`<hwc-radio-checked-indicator>`)
  })

  it('emits the models as documented interfaces, the runtime hook and the element types', () => {
    const models = file('react/models.ts')
    expect(models).toContain(`export interface Contact {`)
    expect(models).toContain(`  /** Omitted when unknown. */\n  email?: string`)
    expect(file('react/runtime.ts')).toContain('export function useElementEvent')
    expect(file('react/elements.d.ts')).toContain(`'hwc-checkbox':`)
    expect(file('react/elements.d.ts')).toContain(`'hwc-field-label':`)
    expect(file('react/index.ts')).toContain(`export * from './Checkbox'`)
  })
})

describe('conformance (ADR 0013 §4)', () => {
  it('reports an element attribute the contract does not declare, and a missing part element', () => {
    const drifted = {
      modules: [
        {
          declarations: [
            {
              name: 'Checkbox',
              tagName: 'hwc-checkbox',
              attributes: [{ name: 'checked' }, { name: 'shape' }],
              events: [{ name: 'change' }],
            },
          ],
        },
      ],
    }
    const result = generate({
      pages: [{ file: 'checkbox.uidx', doc: CHECKBOX }],
      manifest: drifted,
      targets: ['contract'],
    })
    const messages = result.diagnostics.map((d) => d.message)
    expect(result.diagnostics.every((d) => d.code === CODES.CONFORMANCE)).toBe(true)
    expect(messages).toContainEqual(expect.stringContaining('"shape"'))
    expect(messages).toContainEqual(expect.stringContaining('hwc-checkbox-checked-indicator'))
  })

  it("maps a part to the manifest tag that shares the root's prefix", () => {
    const tags = new Set(['hwc-breadcrumbs', 'hwc-breadcrumb-item', 'hwc-field-label'])
    expect(partTag('hwc-breadcrumbs', 'item', tags)).toBe('hwc-breadcrumb-item')
    expect(partTag('hwc-field', 'label', tags)).toBe('hwc-field-label')
    expect(partTag('hwc-field', 'error', tags)).toBe('hwc-field-error')
  })
})

describe('types', () => {
  it("resolves model references and the format's image and date types", () => {
    const model = componentModel(CONTACT_ITEM.tree.children[0]!, CONTACT_ITEM)
    expect(tsType(model, 'Contact')).toBe('Contact')
    expect(tsType(model, 'Contact[]')).toBe('Contact[]')
    expect(tsType(model, 'image')).toBe('string')
    expect(tsType(model, "'a' | 'b'")).toBe("'a' | 'b'")
  })
})

describe('the empty state of a list (ADR 0017 §4)', () => {
  it('keys the empty rows on data-empty and keeps a slot a slot', () => {
    const css = file('html/contact-list.css')
    expect(css).toContain('hwc-radio-group [data-slot="empty"] {\n  display: none;')
    expect(css).toContain('hwc-radio-group[data-empty] [data-slot="empty"] {\n  display: contents;')
  })

  it('has the React wrapper say when its list is empty', () => {
    expect(file('react/ContactList.tsx')).toContain(
      'data-empty={((items?.length ?? 0) === 0) || undefined}',
    )
  })
})

describe('the stories target (ADR 0015 §3)', () => {
  const stories = generate({
    pages: PAGES,
    tokens: [TOKENS],
    manifest: MANIFEST,
    targets: ['react', 'stories'],
  }).files

  it('writes one CSF file per React component', () => {
    expect([...stories.keys()].filter((path) => path.endsWith('.stories.tsx')).sort()).toEqual([
      'react/Checkbox.stories.tsx',
      'react/ContactItem.stories.tsx',
      'react/ContactList.stories.tsx',
      'react/Field.stories.tsx',
    ])
  })

  it('gives a list prop its model samples and each visual value a story', () => {
    const list = stories.get('react/ContactList.stories.tsx')!
    expect(list).toContain(`import type { Meta, StoryObj } from '@storybook/react'`)
    expect(list).toContain('component: ContactList,')
    expect(list).toMatch(/items: \[\s*\{/)
    expect(list).toContain('export const Disabled: Story = { args: { disabled: true } }')
  })

  it('is not written without the React target', () => {
    const only = generate({ pages: PAGES, tokens: [TOKENS], targets: ['stories'] }).files
    expect([...only.keys()]).toEqual([])
  })
})
