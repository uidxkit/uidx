import { describe, expect, it } from 'vitest'
import { CODES, parseOrThrow } from '@uidx/format'
import {
  cssDeclarations,
  generate,
  tsType,
  componentModel,
  partTag,
  stateSelector,
} from '../src/index.js'
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
      <Instance name="row" component="TreeItem" props={{ node: '{item}' }} />
      <Frame name="children">
        <Instance name="child-row" component="TreeItem" repeat="{item.children}" as="child" props={{ depth: '{child.depth}', node: '{child}' }} />
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

  it('passes the item, and an item field, to a nested component exactly as bound', () => {
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

  it('adds a block per extra mode holding only what that mode changes', () => {
    const moded = parseOrThrow(`---
id: tokens
---

## Visual Contract

<Tokens>
  <Collection name="color" modes={['light', 'dark']}>
    <Variable name="surface" type="COLOR">
      <Mode name="light" value={{ r: 1, g: 1, b: 1, a: 1 }} />
      <Mode name="dark" value={{ r: 0, g: 0, b: 0, a: 1 }} />
    </Variable>
    <Variable name="accent" type="COLOR">
      <Mode name="light" value={{ r: 0, g: 0, b: 1, a: 1 }} />
      <Mode name="dark" value={{ r: 0, g: 0, b: 1, a: 1 }} />
    </Variable>
  </Collection>
</Tokens>
`)
    const css = generate({ pages: [], tokens: [moded], targets: ['html'] }).files.get(
      'html/tokens.css',
    )
    expect(css).toBe(
      `:root {\n  --color-accent: rgb(0 0 255);\n  --color-surface: rgb(255 255 255);\n}\n\n[data-color="dark"] {\n  --color-surface: rgb(0 0 0);\n}\n`,
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
      `<hwc-checkbox ref={ref} className={className} style={style} checked={!!checked}`,
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

describe('sizing like the canvas', () => {
  it('draws a frame that hugs its width as inline-flex, a fixed one as flex', () => {
    const doc = parseOrThrow(`---
id: chip
---

## Visual Contract

<Page>
  <Component name="Chip" status="draft" layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO">
    <Frame name="bar" layoutMode="HORIZONTAL" width={200} />
  </Component>
</Page>

## Contract

<Props>
  <Prop name="label" type="string" sample="Hi">Words.</Prop>
</Props>
`)
    const css = generate({ pages: [{ file: 'chip.uidx', doc }], targets: ['html'] }).files.get(
      'html/chip.css',
    )!
    expect(css).toMatch(/\.chip \{\n {2}display: inline-flex;/)
    expect(css).toMatch(/\[data-node="bar"\] \{\n {2}display: flex;/)
  })
})

describe('a component with no headless element', () => {
  const doc = parseOrThrow(`---
id: tag
---

## Visual Contract

<Page>
  <Component name="Tag" status="draft" layoutMode="HORIZONTAL">
    <Text name="label" characters="{label}" />
  </Component>
</Page>

<Styles>
  <Style tone="warn" root:opacity={0.5} />
</Styles>

## Contract

<Props>
  <Prop name="label" type="string" sample="New">Words.</Prop>
  <Prop name="tone" type="'info' | 'warn'" default="info" visual>Tone.</Prop>
</Props>
`)
  const files = generate({ pages: [{ file: 'tag.uidx', doc }], targets: ['react'] }).files

  it('renders a div carrying its class and data attributes, as its CSS selects', () => {
    const tsx = files.get('react/Tag.tsx')!
    expect(tsx).toContain('useRef<HTMLDivElement>(null)')
    expect(tsx).toContain(`className={['tag', className].filter(Boolean).join(' ')}`)
    expect(tsx).toContain('data-tone={tone}')
    expect(files.get('react/tag.css')).toContain('.tag[data-tone="warn"]')
  })

  it('writes models.ts as a module even when no model is declared', () => {
    expect(files.get('react/models.ts')).toContain('export {}')
  })
})

describe('mapping onto an existing React library (codegen.react)', () => {
  it('writes an adapter that speaks the library, and no stylesheet', () => {
    const files = generate({
      pages: [{ file: 'checkbox.uidx', doc: CHECKBOX }],
      targets: ['react'],
      react: {
        Checkbox: {
          from: '@acme/ui',
          export: 'Toggle',
          props: { checked: 'isOn' },
          events: { change: 'onToggle' },
        },
      },
    }).files
    const tsx = files.get('react/Checkbox.tsx')!
    expect(tsx).toContain("import { Toggle as Library } from '@acme/ui'")
    expect(tsx).toContain('isOn={checked}')
    expect(tsx).toContain('onToggle={onChange}')
    expect(files.has('react/checkbox.css')).toBe(false)
  })
})

describe('the cem target', () => {
  it('writes a 2.1.0 manifest with accessibility and behaviour in x-uidx', () => {
    const files = generate({ pages: PAGES, tokens: [TOKENS], targets: ['cem'] }).files
    const cem = JSON.parse(files.get('custom-elements.json')!)
    expect(cem.schemaVersion).toBe('2.1.0')
    const checkbox = cem.modules
      .flatMap((module: { declarations: { tagName: string }[] }) => module.declarations)
      .find((declaration: { tagName: string }) => declaration.tagName === 'hwc-checkbox')
    expect(checkbox.attributes.map((a: { name: string }) => a.name)).toContain('checked')
    expect(checkbox.cssParts.map((p: { name: string }) => p.name)).toContain('checked-indicator')
    expect(checkbox['x-uidx']).toHaveProperty('accessibility')
  })
})

describe('a general web-component library (Shoelace)', () => {
  const MANIFEST = {
    modules: [
      {
        declarations: [
          {
            tagName: 'sl-button',
            attributes: [{ name: 'variant' }, { name: 'href' }, { name: 'disabled' }],
            events: [{ name: 'sl-focus' }],
            slots: [{ name: '' }, { name: 'prefix' }],
            cssParts: [{ name: 'base' }, { name: 'label' }],
          },
        ],
      },
    ],
  }
  const PAGE = parseOrThrow(`---
id: button
---

## Visual Contract

<Page>
  <Component name="Button" status="stable" implements="sl-button">
    <Frame name="base" part="base" fills="{color#accent}" cornerRadius={6}>
      <Slot name="prefix" />
      <Frame name="label" part="label" layoutMode="HORIZONTAL">
        <Slot name="default">
          <Text name="text" characters="{label}" />
        </Slot>
      </Frame>
    </Frame>
  </Component>
</Page>

## Contract

<Props>
  <Prop name="label" type="string" sample="Save">Words.</Prop>
  <Prop name="variant" type="'primary' | 'neutral'" default="primary" visual>Emphasis.</Prop>
</Props>
<Events>
  <Event name="press">Activation.</Event>
</Events>
<Slots>
  <Slot name="prefix">An icon.</Slot>
  <Slot name="default">The label.</Slot>
</Slots>
<Parts>
  <Part name="base">The box.</Part>
  <Part name="label">The label.</Part>
</Parts>
`)
  const run = (profile: Record<string, string>) =>
    generate({
      pages: [{ file: 'button.uidx', doc: PAGE }],
      tokens: [],
      manifest: MANIFEST,
      library: { profile, components: { Button: { events: { press: 'click' } } } },
      targets: ['html', 'react'],
    })

  it('requires the whole element under full coverage, a declared subset under subset', () => {
    const full = run({}).diagnostics.map((d) => d.message)
    expect(full.some((m) => m.includes('"href"'))).toBe(true)
    expect(full.some((m) => m.includes('sl-focus'))).toBe(true)
    // press is renamed to the DOM's own click, which no manifest lists.
    expect(full.some((m) => m.includes('"press"'))).toBe(false)
    expect(run({ coverage: 'subset' }).diagnostics).toEqual([])
  })

  it('colours an outlined vector with its stroke, as currentColor, never a border', () => {
    const check = parseOrThrow(`---
id: tick
---

## Visual Contract

<Page>
  <Component name="Tick" status="draft" layoutMode="HORIZONTAL">
    <Vector name="mark" width={12} height={12} strokes="{color#ink}" strokeWeight={2}
      vectorPaths={[{ windingRule: 'NONZERO', data: 'M2 6 L5 9 L10 3' }]} />
  </Component>
</Page>

## Contract

<Props>
  <Prop name="size" type="number">Unused.</Prop>
</Props>
`)
    const files = generate({
      pages: [{ file: 'tick.uidx', doc: check }],
      tokens: [],
      targets: ['html'],
    }).files
    const css = files.get('html/tick.css')!
    expect(css).toContain('color: var(--color-ink);')
    expect(css).not.toContain('border:')
    expect(files.get('html/tick.html')).toContain('stroke="currentColor" stroke-width="2"')
  })

  it('selects focus on a shadow host as :focus-within, which it matches, not :focus-visible', () => {
    const shadowed = componentModel(PAGE.tree.children[0]!, PAGE, MANIFEST)
    expect(stateSelector('focus', undefined, shadowed)).toBe(':focus-within')
    expect(stateSelector('focus')).toBe(':focus-visible')
  })

  it("passes slot content through the library's shadow parts, with slot names it declares", () => {
    const files = run({ coverage: 'subset' }).files
    const html = files.get('html/button.html')!
    expect(html).toContain('<sl-button')
    // An empty slot of the library's prints nothing; its name is not content.
    expect(html).not.toContain('prefix')
    expect(html).toContain('<span data-slot="default">')
    expect(html).toContain('Save')
    expect(files.get('html/button.css')).toContain('sl-button::part(base)')
    // `label` is sl-button's own part, not some other element ending in -label.
    expect(files.get('html/button.css')).toContain('sl-button::part(label)')
    const react = files.get('react/Button.tsx')!
    expect(react).toContain('slot="prefix"')
    expect(react).toContain('data-slot="default"')
  })

  it('writes sample text the element takes as an attribute onto it, in HTML and React', () => {
    const field = parseOrThrow(`---
id: input
---

## Visual Contract

<Page>
  <Component name="Input" status="stable" implements="sl-input">
    <Frame name="form-control" part="form-control">
      <Text name="label" part="form-control-label" characters="{label}" />
      <Frame name="base" part="base">
        <Text name="value" part="input" characters="{placeholder}" />
      </Frame>
    </Frame>
  </Component>
</Page>

## Contract

<Props>
  <Prop name="label" type="string" sample="Email">Asks.</Prop>
  <Prop name="placeholder" type="string" sample="you@example.com">Hint.</Prop>
</Props>
`)
    const output = generate({
      pages: [{ file: 'input.uidx', doc: field }],
      tokens: [],
      manifest: {
        modules: [
          {
            declarations: [
              {
                tagName: 'sl-input',
                attributes: [{ name: 'label' }, { name: 'placeholder' }],
                cssParts: [
                  { name: 'form-control' },
                  { name: 'form-control-label' },
                  { name: 'base' },
                  { name: 'input' },
                ],
              },
            ],
          },
        ],
      },
      library: { profile: { coverage: 'subset' } },
      targets: ['html', 'react'],
    })
    expect(output.files.get('html/input.html')).toContain(
      '<sl-input label="Email" placeholder="you@example.com">',
    )
    const react = output.files.get('react/Input.tsx')!
    expect(react).toContain('label?: string')
    expect(react).toContain('label={label} placeholder={placeholder}')
  })
})

describe('what a frame drawn on the canvas becomes in CSS', () => {
  it('sizes a hugging axis by its content, whatever number was measured beside it', () => {
    const css = cssDeclarations(
      {
        layoutMode: 'HORIZONTAL',
        primaryAxisSizingMode: 'AUTO',
        counterAxisSizingMode: 'FIXED',
        width: 89,
        height: 20,
      },
      'container',
    )
    expect(css.width).toBeUndefined()
    expect(css.height).toBe('20px')
    expect(css.display).toBe('inline-flex')
    // A column hugs its height on the primary axis, its width on the counter.
    const column = cssDeclarations(
      { layoutMode: 'VERTICAL', counterAxisSizingMode: 'AUTO', width: 45, height: 17 },
      'container',
    )
    expect([column.width, column.height]).toEqual([undefined, '17px'])
  })

  it('draws a stroke with the weights set per side, over the uniform one', () => {
    const css = cssDeclarations(
      {
        strokes: [{ type: 'SOLID', color: '{color#text}' }],
        strokeWeight: 1,
        strokeTopWeight: 2,
        strokeRightWeight: 2,
        strokeBottomWeight: 2,
        strokeLeftWeight: 2,
      },
      'container',
    )
    expect(css.border).toBe('1px solid var(--color-text)')
    expect(css['border-width']).toBe('2px 2px 2px 2px')
  })
})

describe('a list whose items are injected (ADR 0017 §2)', () => {
  const docs = [
    parseOrThrow(`---
id: row
---

## Visual Contract

<Page>
  <Component name="Row" status="draft" layoutMode="HORIZONTAL">
    <Text name="name" characters="{item.name}" />
  </Component>
</Page>

## Contract

<Props>
  <Prop name="item" type="Person">One person.</Prop>
</Props>

## Models

<Model name="Person">
  One person.
  <Field name="id" type="string" key sample={['a', 'b']}>Id.</Field>
  <Field name="name" type="string" sample={['Ada', 'Grace']}>Name.</Field>
</Model>
`),
    parseOrThrow(`---
id: list
---

## Visual Contract

<Page>
  <Component name="List" status="draft" layoutMode="VERTICAL" counterAxisAlignItems="CENTER">
    <Slot name="item" repeat="{items}" layoutMode="VERTICAL" layoutAlign="STRETCH">
      <Instance name="row" component="Row" layoutAlign="STRETCH" props={{ item: '{item}' }} />
    </Slot>
  </Component>
</Page>

## Contract

<Props>
  <Prop name="items" type="Person[]">People.</Prop>
</Props>
<Slots>
  <Slot name="item">One per person.</Slot>
</Slots>
`),
  ]
  const files = generate({
    pages: docs.map((doc, i) => ({ file: `${['row', 'list'][i]}.uidx`, doc })),
    tokens: [],
    targets: ['html', 'react'],
  }).files

  it('places rows as the canvas does, though a repeated slot has no element of its own', () => {
    const css = files.get('html/list.css')!
    // The slot stretches, so each row — injected or not — sits at its start…
    expect(css).toContain('.list > * {\n  align-self: flex-start;\n}')
    // …and the default row stretches across, as its instance says.
    expect(css).toContain('.list > .row {\n  align-self: stretch;\n}')
    expect(css).not.toContain('[data-slot="item"]')
  })

  it('exposes the slot as a typed render prop with the row component as its default', () => {
    const react = files.get('react/List.tsx')!
    expect(react).toContain('renderItem?: (item: Person, index: number) => ReactNode')
    expect(react).toContain('{renderItem ? renderItem(item, index) : (')
    expect(react).toContain('<Row item={item} />')
  })
})

describe('an ellipse', () => {
  it('renders round, as the canvas draws it', () => {
    const dot = parseOrThrow(`---
id: dot
---

## Visual Contract

<Page>
  <Component name="Dot" status="draft" layoutMode="HORIZONTAL">
    <Ellipse name="avatar" width={32} height={32} />
  </Component>
</Page>

## Contract

<Props>
  <Prop name="size" type="number">Unused.</Prop>
</Props>
`)
    const css = generate({
      pages: [{ file: 'dot.uidx', doc: dot }],
      tokens: [],
      targets: ['html'],
    }).files.get('html/dot.css')!
    expect(css).toContain(
      '.dot [data-node="avatar"] {\n  width: 32px;\n  height: 32px;\n  border-radius: 50%;',
    )
  })
})
