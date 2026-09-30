import { describe, expect, it } from 'vitest'
import { CODES, emitDocument, parse, parseOrThrow } from '../src/index.js'

/**
 * The regions after the visual contract (ADRs 0013–0016): a component's
 * contract, behaviour guidelines, models, examples, and the styles table.
 * Declarations, never computation — and never a change to the tree the
 * viewer draws.
 */
const CHECKBOX = `---
id: checkbox
---

Lets a user toggle one option.

## Visual Contract

<Component name="Checkbox" status="stable" implements="hwc-checkbox">
  <Frame name="root" part="root" width={20} height={20} cornerRadius="{radius#sm}">
    <Vector name="check" part="checked-indicator" visible={false}
      vectorPaths={[{ windingRule: 'NONZERO', data: 'M3 8 L7 12 L13 4' }]} />
  </Frame>
  <Slot name="label" />
</Component>

<Styles>
  <Style state="checked" root:fills="{surface#accent}" checked-indicator:visible={true} />
  <Style state="disabled" root:opacity={0.4} />
</Styles>

## Contract

<Props>
  <Prop name="checked" type="boolean" default={false} controllable visual>Whether the option is selected.</Prop>
  <Prop name="disabled" type="boolean" default={false} visual>Inert and dimmed.</Prop>
  <Prop name="name" type="string" sample="choice">Form field name.</Prop>
</Props>
<Events>
  <Event name="change" detail="{ checked: boolean }">Fires once per user toggle.</Event>
</Events>
<States>
  <State name="invalid">The element failed its own validation.</State>
</States>
<Parts>
  <Part name="checked-indicator">The mark shown while checked.</Part>
</Parts>
<Slots>
  <Slot name="label">Consumer text, styled here.</Slot>
</Slots>
<Form participates submits="value while checked, nothing otherwise" />
<Accessibility role="checkbox" keyboard="Space toggles" />
<Composes with="Field" />

## Behavior

- toggle: click or Space flips \`checked\`.
- change-event: \`change\` fires once per user toggle, never when \`checked\` is set from code.

## Models

<Model name="Contact">
  One row of the contacts list.
  <Field name="id" type="string" key>Stable identity.</Field>
  <Field name="name" type="string" sample={['Ada', 'Grace']}>Display name.</Field>
  <Field name="email" type="string" optional sample={['ada@example.com', null]}>Omitted when unknown.</Field>
</Model>

## Examples

<Example name="checked-and-disabled">
  <Set at="root" state="checked" />
  <Set slot="label" value="Remember me" />
</Example>
`

describe('spec regions', () => {
  it('parses the contract, behaviour, models, examples and styles beside the tree', () => {
    const { doc, diagnostics } = parse(CHECKBOX)
    expect(diagnostics).toEqual([])
    const spec = doc!.spec!
    expect(spec.contract!.props.map((p) => [p.name, p.type, p.controllable, p.visual])).toEqual([
      ['checked', 'boolean', true, true],
      ['disabled', 'boolean', false, true],
      ['name', 'string', false, false],
    ])
    expect(spec.contract!.props[0]!.default).toBe(false)
    expect(spec.contract!.props[0]!.description).toBe('Whether the option is selected.')
    expect(spec.contract!.events).toMatchObject([
      { name: 'change', detail: '{ checked: boolean }' },
    ])
    expect(spec.contract!.states.map((state) => [state.name, state.description])).toEqual([
      ['invalid', 'The element failed its own validation.'],
    ])
    expect(spec.contract!.parts.map((part) => [part.name, part.description])).toEqual([
      ['checked-indicator', 'The mark shown while checked.'],
    ])
    expect(spec.contract!.slots).toMatchObject([{ name: 'label' }])
    expect(spec.contract!.form).toEqual({
      participates: true,
      submits: 'value while checked, nothing otherwise',
    })
    expect(spec.contract!.accessibility).toEqual({ role: 'checkbox', keyboard: 'Space toggles' })
    expect(spec.contract!.composes).toEqual(['Field'])

    expect(spec.behavior!.map((rule) => rule.id)).toEqual(['toggle', 'change-event'])
    expect(spec.behavior![0]!.text).toBe('click or Space flips checked.')

    const contact = spec.models![0]!
    expect(contact.name).toBe('Contact')
    expect(contact.description).toBe('One row of the contacts list.')
    expect(contact.fields.map((f) => [f.name, f.key, f.optional])).toEqual([
      ['id', true, false],
      ['name', false, false],
      ['email', false, true],
    ])
    expect(contact.fields[2]!.sample).toEqual(['ada@example.com', null])
    expect(spec.contract!.props.find((p) => p.name === 'name')!.sample).toBe('choice')

    expect(spec.examples).toMatchObject([
      {
        name: 'checked-and-disabled',
        sets: [
          { at: 'root', state: 'checked' },
          { slot: 'label', value: 'Remember me' },
        ],
      },
    ])

    expect(spec.styles).toMatchObject([
      {
        keys: { state: 'checked' },
        values: { root: { fills: '{surface#accent}' }, 'checked-indicator': { visible: true } },
      },
      { keys: { state: 'disabled' }, values: { root: { opacity: 0.4 } } },
    ])
  })

  it('leaves the visual tree exactly as it was: the regions are not nodes', () => {
    const doc = parseOrThrow(CHECKBOX)
    const component = doc.tree.children[0]!
    expect(component.attrs.implements!.value).toBe('hwc-checkbox')
    expect(component.children.map((c) => c.element)).toEqual(['Frame', 'Slot'])
    expect(component.children[0]!.children[0]!.attrs.part!.value).toBe('checked-indicator')
  })

  it('keeps the trailing regions and the styles table through the emitter', () => {
    const doc = parseOrThrow(CHECKBOX)
    const printed = emitDocument(doc)
    expect(printed).toContain('<Styles>')
    expect(printed).toContain('## Contract')
    expect(printed).toContain('## Behavior')
    expect(printed).toContain('- toggle: click or Space flips `checked`.')
    expect(printed.trimEnd().endsWith('</Example>')).toBe(true)
    // Printed once, not twice: the styles table is not part of the trailing text.
    expect(printed.split('<Styles>')).toHaveLength(2)
    const again = parse(printed)
    expect(again.diagnostics).toEqual([])
    expect(again.doc!.spec).toEqual(doc.spec === undefined ? undefined : expect.any(Object))
    expect(again.doc!.spec!.behavior!.map((r) => r.id)).toEqual(['toggle', 'change-event'])
  })

  it('is absent for a file that declares none', () => {
    const doc = parseOrThrow(
      '---\nid: plain\n---\n\n## Visual Contract\n\n<Page><Frame name="a" /></Page>\n',
    )
    expect(doc.spec).toBeUndefined()
    expect(doc.trailing).toBeUndefined()
  })

  it('names an unknown region and a duplicate one', () => {
    const base = '---\nid: r\n---\n\n## Visual Contract\n\n<Page><Frame name="a" /></Page>\n'
    expect(parse(`${base}\n## Notes\n\ntext\n`).diagnostics.map((d) => d.code)).toEqual([
      CODES.UNKNOWN_REGION,
    ])
    expect(
      parse(`${base}\n## Behavior\n\n- a: one.\n\n## Behavior\n\n- b: two.\n`).diagnostics.map(
        (d) => d.code,
      ),
    ).toEqual([CODES.DUPLICATE_REGION])
  })

  it('demands a description on props and fields, and an id on a behaviour bullet', () => {
    const base = '---\nid: r\n---\n\n## Visual Contract\n\n<Page><Frame name="a" /></Page>\n'
    const noDescription = parse(
      `${base}\n## Contract\n\n<Props><Prop name="x" type="string" /></Props>\n`,
    )
    expect(noDescription.diagnostics.map((d) => d.code)).toEqual([CODES.BAD_SPEC])
    expect(noDescription.diagnostics[0]!.message).toContain('description')

    const noId = parse(`${base}\n## Behavior\n\n- clicking toggles the box.\n`)
    expect(noId.diagnostics.map((d) => d.code)).toEqual([CODES.BAD_BEHAVIOR_RULE])

    const noSample = parse(
      `${base}\n## Models\n\n<Model name="M"><Field name="a" type="string">A.</Field></Model>\n`,
    )
    // Missing samples are the audit's business (ADR 0015 §1), not the parser's.
    expect(noSample.diagnostics).toEqual([])
  })

  it('names the old spellings and says what replaced them', () => {
    const base = '---\nid: r\n---\n\n## Visual Contract\n\n<Page><Frame name="a" /></Page>\n'
    const messages = (region: string) =>
      parse(`${base}\n## Contract\n\n${region}\n`).diagnostics.map((d) => d.message)
    expect(messages(`<States structural={['checked']} styling={['hover']} />`)[0]).toContain(
      'visual is a state already',
    )
    expect(messages('<Parts>a, b</Parts>')[0]).toContain('<Part name=')
    expect(
      messages('<Props><Prop name="item" model="{models#Contact}">Row.</Prop></Props>')[0],
    ).toContain('type="Contact"')
    expect(
      messages(
        '<Slots><Slot name="item" repeats of="items" accepts="x-row">Rows.</Slot></Slots>',
      )[0],
    ).toContain('repeat="{items}"')
  })

  it('reports an element a region does not know, with what it allows', () => {
    const base = '---\nid: r\n---\n\n## Visual Contract\n\n<Page><Frame name="a" /></Page>\n'
    const { diagnostics } = parse(`${base}\n## Contract\n\n<Frame name="x" />\n`)
    expect(diagnostics.map((d) => d.code)).toEqual([CODES.UNKNOWN_SPEC_ELEMENT])
    expect(diagnostics[0]!.message).toContain('Props')
  })
})

describe('repeat (ADR 0017 §2)', () => {
  const page = (body: string) =>
    `---\nid: r\n---\n\n## Visual Contract\n\n<Page>\n  <Component name="List" status="draft">\n    <Frame name="root" layoutMode="VERTICAL">\n${body}\n    </Frame>\n  </Component>\n</Page>\n`

  it('is an attribute of the element that repeats, with its item name', () => {
    const doc = parseOrThrow(
      page(
        '      <Frame name="row" repeat="{items}" as="contact"><Text name="t" characters="{contact.name}" /></Frame>',
      ),
    )
    const row = doc.tree.children[0]!.children[0]!.children[0]!
    expect(row.element).toBe('Frame')
    expect(row.address).toBe('List#root/row')
    expect(row.attrs.repeat?.value).toBe('{items}')
    expect(row.attrs.as?.value).toBe('contact')
  })

  it('checks the shape of repeat and as', () => {
    const codes = (body: string) => parse(page(body)).diagnostics.map((d) => d.code)
    expect(codes('      <Frame name="row" repeat="items" />')).toEqual([CODES.BAD_REPEAT])
    expect(codes('      <Frame name="row" repeat="{space#md}" />')).toEqual([CODES.BAD_REPEAT])
    expect(codes('      <Frame name="row" as="x" />')).toEqual([CODES.BAD_REPEAT])
    expect(codes('      <Frame name="row" repeat="{items}" as="not a word" />')).toEqual([
      CODES.BAD_REPEAT,
    ])
    expect(codes('      <Frame name="row" repeat="{items}" />')).toEqual([])
  })
})
