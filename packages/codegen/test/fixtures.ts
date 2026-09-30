import { parseOrThrow } from '@uidx/format'

export const TOKENS = parseOrThrow(`---
id: tokens
---

## Visual Contract

<Tokens>
  <Collection name="surface">
    <Variable name="control" type="COLOR" value={{ r: 1, g: 1, b: 1, a: 1 }} />
    <Variable name="accent" type="COLOR" value={{ r: 0, g: 0.5, b: 1, a: 1 }} />
  </Collection>
  <Collection name="radius">
    <Variable name="sm" type="FLOAT" value={4} />
  </Collection>
  <Collection name="space">
    <Variable name="sm" type="FLOAT" value={8} />
  </Collection>
</Tokens>
`)

export const CHECKBOX = parseOrThrow(`---
id: checkbox
---

Lets a user toggle one option.

## Visual Contract

<Page>
  <Component name="Checkbox" status="stable" implements="hwc-checkbox"
    width={20} height={20} cornerRadius="{radius#sm}" fills="{surface#control}"
    strokes={[{ type: 'SOLID', color: { r: 0.6, g: 0.6, b: 0.6, a: 1 } }]} strokeWeight={1}>
    <Vector name="check" part="checked-indicator" visible={false} width={12} height={12}
      fills={[{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }]}
      vectorPaths={[{ windingRule: 'NONZERO', data: 'M2 6 L5 9 L10 3' }]} />
  </Component>
</Page>

<Styles>
  <Style state="checked" root:fills="{surface#accent}" checked-indicator:visible={true} />
  <Style state="hover" root:strokes={[{ type: 'SOLID', color: { r: 0, g: 0.5, b: 1, a: 1 } }]} />
  <Style size="sm" root:width={16} root:height={16} />
  <Style state="disabled" root:opacity={0.4} />
</Styles>

## Contract

<Props>
  <Prop name="checked" type="boolean" default={false} controllable visual>Whether the option is selected.</Prop>
  <Prop name="indeterminate" type="boolean" default={false} controllable visual>Mixed state.</Prop>
  <Prop name="size" type="'sm' | 'md'" default="md" visual>Box size.</Prop>
  <Prop name="disabled" type="boolean" default={false} visual>Inert and dimmed.</Prop>
  <Prop name="name" type="string">Form field name.</Prop>
  <Prop name="value" type="string" default="on">Submitted while checked.</Prop>
</Props>
<Events>
  <Event name="change" detail="{ checked: boolean }">Fires once per user toggle.</Event>
</Events>

## Behavior

- toggle: click or Space flips \`checked\`.
`)

export const FIELD = parseOrThrow(`---
id: field
---

Pairs a control with its label, description and error.

## Visual Contract

<Page>
  <Component name="Field" status="stable" implements="hwc-field" layoutMode="HORIZONTAL" itemSpacing="{space#sm}">
    <Slot name="control" />
    <Frame name="text" layoutMode="VERTICAL">
      <Text name="label" part="label" characters="{label}" fontSize={14} />
      <Text name="description" part="description" characters="{description}" fontSize={12} />
    </Frame>
  </Component>
</Page>

## Contract

<Props>
  <Prop name="label" type="string">The control's name.</Prop>
  <Prop name="description" type="string">Helper text.</Prop>
  <Prop name="error" type="boolean" default={false} visual>Shows the error state.</Prop>
</Props>
<Slots><Slot name="control">The wrapped control.</Slot></Slots>
`)

export const CONTACT_ITEM = parseOrThrow(`---
id: contact-item
---

## Visual Contract

<Page>
  <Component name="ContactItem" status="draft" implements="hwc-radio" layoutMode="HORIZONTAL">
    <Vector name="dot" part="checked-indicator" visible={false} width={8} height={8}
      vectorPaths={[{ windingRule: 'NONZERO', data: 'M4 0a4 4 0 110 8 4 4 0 010-8z' }]} />
    <Text name="name" characters="{item.name}" />
    <Text name="email" characters="{item.email}" fontSize={12} />
  </Component>
</Page>

<Styles>
  <Style state="checked" checked-indicator:visible={true} />
</Styles>

## Contract

<Props>
  <Prop name="item" type="Contact">The row to show.</Prop>
  <Prop name="checked" type="boolean" default={false} controllable visual>Whether this row is the chosen one.</Prop>
  <Prop name="disabled" type="boolean" default={false} visual>Inert.</Prop>
  <Prop name="value" type="string">Submitted when chosen.</Prop>
  <Prop name="name" type="string">Form field name.</Prop>
</Props>
<Events><Event name="change" detail="{ checked: boolean }">Fires when chosen.</Event></Events>

## Models

<Model name="Contact">
  One row of the list.
  <Field name="id" type="string" key sample="c1">Identity.</Field>
  <Field name="name" type="string" sample={['Ada', 'Grace']}>Display name.</Field>
  <Field name="email" type="string" optional sample={['ada@example.com', null]}>Omitted when unknown.</Field>
</Model>
`)

export const CONTACT_LIST = parseOrThrow(`---
id: contact-list
---

## Visual Contract

<Page>
  <Component name="ContactList" status="draft" implements="hwc-radio-group" layoutMode="VERTICAL">
    <Slot name="item" repeat="{items}">
      <Instance name="row" component="ContactItem" />
    </Slot>
    <Slot name="empty" />
  </Component>
</Page>

## Contract

<Props>
  <Prop name="items" type="Contact[]">Rows to show.</Prop>
  <Prop name="name" type="string">Form field name shared by the rows.</Prop>
  <Prop name="disabled" type="boolean" default={false} visual>Inert.</Prop>
</Props>
<Slots>
  <Slot name="item" accepts="hwc-radio">One per row.</Slot>
  <Slot name="empty">Shown while empty.</Slot>
</Slots>
`)

export const MANIFEST = {
  modules: [
    {
      declarations: [
        {
          name: 'Checkbox',
          tagName: 'hwc-checkbox',
          attributes: [
            { name: 'checked' },
            { name: 'indeterminate' },
            { name: 'disabled' },
            { name: 'value' },
            { name: 'name' },
          ],
          events: [{ name: 'change' }],
        },
        { name: 'CheckboxCheckedIndicator', tagName: 'hwc-checkbox-checked-indicator' },
        { name: 'Field', tagName: 'hwc-field', attributes: [{ name: 'error' }] },
        { name: 'FieldLabel', tagName: 'hwc-field-label' },
        { name: 'FieldDescription', tagName: 'hwc-field-description' },
        {
          name: 'Radio',
          tagName: 'hwc-radio',
          attributes: [
            { name: 'checked' },
            { name: 'disabled' },
            { name: 'value' },
            { name: 'name' },
          ],
          events: [{ name: 'change' }],
        },
        { name: 'RadioCheckedIndicator', tagName: 'hwc-radio-checked-indicator' },
        {
          name: 'RadioGroup',
          tagName: 'hwc-radio-group',
          attributes: [{ name: 'name' }, { name: 'disabled' }],
        },
      ],
    },
  ],
}
