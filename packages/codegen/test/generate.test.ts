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

  it('turns a repeating slot into items plus renderItem, generic over the model', () => {
    const tsx = file('react/ContactList.tsx')
    expect(tsx).toContain(`items: Contact[]`)
    expect(tsx).toContain(`renderItem?: (item: Contact, index: number) => ReactNode`)
    expect(tsx).toContain(`ItemComponent?: ComponentType<{ item: Contact }>`)
    expect(tsx).toContain(`<Fragment key={String(item.id)}>`)
    expect(tsx).toContain(`<ContactItem item={item} />`)
    expect(tsx).toContain(`import { ContactItem } from './ContactItem'`)
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
    expect(tsType(model, undefined, '{models#Contact}')).toBe('Contact')
    expect(tsType(model, 'Contact[]')).toBe('Contact[]')
    expect(tsType(model, 'image')).toBe('string')
    expect(tsType(model, "'a' | 'b'")).toBe("'a' | 'b'")
  })
})
