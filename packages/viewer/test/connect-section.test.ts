import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
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
    expect((tab.find('[aria-label="Implements"]').element as HTMLSelectElement).value).toBe(
      'x-button',
    )
    expect(tab.find('[data-field="parts-progress"]').text()).toContain('1/2 parts bound')
  })

  it('counts the parts the library offers before the contract names them, as Contract does', () => {
    const shadow = parseHeadless('custom-elements.json', {
      modules: [{ declarations: [{ tagName: 'x-button', cssParts: [{ name: 'base' }] }] }],
    })
    const tab = mount(ConnectSection, {
      props: { doc, component, library: shadow, config: CONFIG, writable: true },
    })
    expect(tab.find('[data-field="parts-progress"]').text()).toContain('1/3 parts bound')
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

  it('names where it saves once, in sections whose (i) explains them', () => {
    const tab = mount(ConnectSection, {
      props: { doc, component, library, config: CONFIG, writable: true, relation: 'of Button' },
    })
    const heads = tab.findAll('.section-head .title').map((title) => title.text())
    expect(heads).toEqual([
      'Headless element',
      'Names in the library',
      'React component',
      'Project',
    ])
    expect(tab.find('[data-group="element"] .section-meta').text()).toBe('of Button')
    expect(tab.find('[data-group="element"] .info-tip').attributes('title')).toContain(
      'Saved in Button.uidx.',
    )
    expect(tab.find('.footnote').text()).toBe(
      'Element and parts save to Button.uidx; names, React and project to uidx.json.',
    )
    expect(tab.find('[data-group="project"] .section-meta').text()).toBe(
      'custom-elements.json · 2 elements',
    )
  })

  it('keeps the element a list and pauses its checks while the library is unreadable', () => {
    const tab = mount(ConnectSection, {
      props: { doc, component, library: null, config: CONFIG, writable: true, libraryFailed: true },
    })
    const select = tab.find('[aria-label="Implements"]')
    expect(select.element.tagName).toBe('SELECT')
    expect(select.findAll('option').map((option) => option.text())).toEqual([
      'None',
      'x-button · library unavailable',
    ])
    expect(tab.find('[data-field="parts-progress"]').exists()).toBe(false)
    expect(tab.find('[data-group="names"]').text()).not.toContain('No library connected')
    expect(tab.find('[data-group="project"] .section-meta').text()).toBe('Library unavailable')
    expect(tab.find('[data-field="library"]').text()).toContain('Unavailable')
    expect(tab.find('[data-field="library"] .tone-dot[data-tone="warn"]').exists()).toBe(true)
  })

  it('points to Project from where a library or an output folder is missing', async () => {
    const tab = mounted({ headless: null, codegen: null })
    expect(tab.find('[aria-label="Implements"]').element.tagName).toBe('SELECT')
    const bare = mount(ConnectSection, {
      props: {
        doc,
        component,
        library: null,
        config: { headless: null, codegen: null },
        writable: true,
      },
    })
    expect(bare.find('[aria-label="Implements"]').element.tagName).toBe('INPUT')
    expect(bare.find('[data-group="project"] .section-meta').text()).toBe('Not set up')
    await bare.find('[data-group="element"] .link-button').trigger('click')
    await bare.find('[data-group="react"] .field-help .link-button').trigger('click')
    expect(bare.emitted('act')).toEqual([
      [{ label: 'Choose library', run: 'open-project', arg: 'library' }],
      [{ label: 'Set folder', run: 'open-project', arg: 'output' }],
    ])
  })

  it('shows a refused value under its field', () => {
    const mapped: ConnectionConfig = {
      ...CONFIG,
      codegen: { ...CONFIG.codegen!, react: { Button: { from: '' } } },
    }
    const react = mount(ConnectSection, {
      props: {
        doc,
        component,
        library,
        config: mapped,
        writable: true,
        fieldError: { key: 'react', text: 'Name the module to import from' },
      },
    })
    expect(react.find('[data-group="react"] .field-error').text()).toBe(
      'Name the module to import from',
    )
    expect(react.find('[aria-label="Module"]').attributes('aria-invalid')).toBe('true')
    const output = mount(ConnectSection, {
      props: {
        doc,
        component,
        library,
        config: CONFIG,
        writable: true,
        fieldError: { key: 'codegen', text: 'Enter a folder' },
      },
    })
    expect(output.find('[data-group="project"] .field-error').text()).toBe('Enter a folder')
    expect(output.findAll('.field-error')).toHaveLength(1)
  })

  it('removes a React mapping from its section head', async () => {
    const tab = mounted({
      ...CONFIG,
      codegen: { ...CONFIG.codegen!, react: { Button: { from: '@acme/ui' } } },
    })
    expect(tab.find('[data-group="react"] .section-meta').text()).toBe('Button')
    await tab.find('[aria-label="Remove mapping"]').trigger('click')
    expect(tab.emitted('save')).toEqual([[{ key: 'react', component: 'Button', value: null }]])
  })

  it('changes the library from a closed row, by package name', async () => {
    const tab = mounted({
      ...CONFIG,
      headless: {
        ...CONFIG.headless!,
        manifest: '../node_modules/@shoelace-style/shoelace/dist/custom-elements.json',
      },
    })
    const row = tab.find('[data-field="library"]')
    expect(row.find('.value').text()).toBe('shoelace')
    expect(tab.find('[aria-label="Library path"]').exists()).toBe(false)
    await row.find('button').trigger('click')
    await tab.find('[aria-label="Library path"]').setValue('lib/custom-elements.json')
    await tab.find('[aria-label="Library path"]').trigger('keydown', { key: 'Enter' })
    expect(tab.emitted('chooseLibrary')).toEqual([['lib/custom-elements.json']])
    expect(tab.find('[aria-label="Library path"]').exists()).toBe(false)
  })

  it('opens Project at the field the status line asks for', async () => {
    const closed = mounted()
    expect(closed.find('[data-group="project"]').attributes('open')).toBeUndefined()
    const tab = mount(ConnectSection, {
      attachTo: document.body,
      props: {
        doc,
        component,
        library,
        config: CONFIG,
        writable: true,
        focus: { target: 'output', n: 101 },
      },
    })
    await nextTick()
    expect(tab.find('[data-group="project"]').attributes('open')).toBeDefined()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Output folder')
    await tab.setProps({ focus: { target: 'library', n: 102 } })
    await nextTick()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Library path')
    tab.unmount()
  })

  it('shows the first sentence of the library description, and the rest on request', async () => {
    const described = parseHeadless('custom-elements.json', {
      modules: [
        {
          declarations: [
            {
              tagName: 'x-button',
              description: 'A *headless* `button`. It renders\nno styles of its own.',
            },
          ],
        },
      ],
    })
    const tab = mount(ConnectSection, {
      props: { doc, component, library: described, config: CONFIG, writable: true },
    })
    const text = () => tab.find('[data-group="element"] .clamp').text()
    expect(text()).toBe('A headless button.')
    await tab.find('[data-group="element"] .description .link-button').trigger('click')
    expect(text()).toBe('A headless button. It renders no styles of its own.')
  })
})
