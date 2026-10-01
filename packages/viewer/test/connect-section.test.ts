import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { parseOrThrow, resolve } from '@uidx/format'

import ConnectSection from '../src/ConnectSection.vue'
import { parseHeadless, type ConnectionConfig } from '../src/headless'

/**
 * The Connect tab: the element a component implements (in its file), its
 * names in the library and the React component it renders onto (in
 * uidx.json), and the project's library, profile and output.
 */
const SOURCE = `---
id: button
---

## Visual Contract

<Page>
  <Component name="Button" status="draft" implements="x-button" width={20} height={20}>
    <Text name="label" part="label" characters="{label}" />
  </Component>
</Page>

## Contract

<Props>
  <Prop name="label" type="string" sample="Go">Words.</Prop>
  <Prop name="isPrimary" type="boolean" default={false} visual>Loud.</Prop>
</Props>
<Events>
  <Event name="press">Fires once.</Event>
</Events>
<Parts>
  <Part name="label">The words.</Part>
  <Part name="icon">An icon.</Part>
</Parts>
`
const doc = parseOrThrow(SOURCE)
const component = resolve(doc.tree, 'Button')!
const library = parseHeadless('custom-elements.json', {
  modules: [
    {
      declarations: [
        { tagName: 'x-button', attributes: [{ name: 'primary' }], events: [{ name: 'click' }] },
        { tagName: 'x-link' },
      ],
    },
  ],
})
const CONFIG: ConnectionConfig = {
  headless: { manifest: 'custom-elements.json', profile: {}, bindings: {} },
  codegen: { out: 'src/ds', targets: null, react: {} },
}
const mounted = (config: ConnectionConfig = CONFIG) =>
  mount(ConnectSection, { props: { doc, component, library, config, writable: true } })

describe('the Connect tab', () => {
  it('says what the component is in code, and how many parts are bound', () => {
    const tab = mounted()
    expect(tab.find('.status-line').text()).toContain('Button→<x-button>')
    expect(tab.find('.status-card').text()).toContain('1/2 parts bound')
  })

  it('writes the element into the component file', async () => {
    const tab = mounted()
    await tab.find('[aria-label="Implements"]').setValue('x-link')
    expect(tab.emitted('patches')).toEqual([
      [[{ op: 'set', address: 'Button', prop: 'implements', value: 'x-link' }]],
    ])
  })

  it("saves the library's names for props and events, empty keeping the identity's", async () => {
    const tab = mounted()
    expect(tab.find('[data-attribute="isPrimary"] input').attributes('placeholder')).toBe(
      'is-primary',
    )
    await tab.find('[data-attribute="isPrimary"] input').setValue('primary')
    await tab.find('[data-event="press"] input').setValue('click')
    expect(tab.emitted('save')).toEqual([
      [{ key: 'binding', component: 'Button', value: { attributes: { isPrimary: 'primary' } } }],
      [{ key: 'binding', component: 'Button', value: { events: { press: 'click' } } }],
    ])
  })

  it('maps the component onto an existing React component', async () => {
    const tab = mounted()
    await tab.find('[data-action="map-react"]').trigger('click')
    await tab.find('[aria-label="Module"]').setValue('@acme/ui')
    expect(tab.emitted('save')![0]).toEqual([
      { key: 'react', component: 'Button', value: { from: '@acme/ui' } },
    ])
    const mapped = mounted({
      ...CONFIG,
      codegen: { ...CONFIG.codegen!, react: { Button: { from: '@acme/ui' } } },
    })
    await mapped.find('[data-react-prop="label"] input').setValue('children')
    await mapped.find('[aria-label="Omit isPrimary"]').setValue(true)
    expect(mapped.emitted('save')).toEqual([
      [
        {
          key: 'react',
          component: 'Button',
          value: { from: '@acme/ui', props: { label: 'children' } },
        },
      ],
      [{ key: 'react', component: 'Button', value: { from: '@acme/ui', omit: ['isPrimary'] } }],
    ])
  })

  it('manages the project: naming profile, output and targets', async () => {
    const tab = mounted()
    await tab.find('[data-profile="props"] select').setValue('data-attribute')
    await tab.find('[data-target="cem"] input').setValue(true)
    expect(tab.emitted('save')).toEqual([
      [{ key: 'profile', value: { props: 'data-attribute' } }],
      [{ key: 'codegen', value: { out: 'src/ds', targets: ['html', 'react', 'contract', 'cem'] } }],
    ])
    const fresh = mounted({ headless: null, codegen: null })
    expect(fresh.find('[data-action="map-react"]').attributes('disabled')).toBeDefined()
    await fresh.find('[aria-label="Library path"]').setValue('lib/custom-elements.json')
    await fresh.find('[aria-label="Library path"]').trigger('keydown', { key: 'Enter' })
    expect(fresh.emitted('chooseLibrary')).toEqual([['lib/custom-elements.json']])
  })
})
