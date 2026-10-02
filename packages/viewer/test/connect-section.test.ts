import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { parseOrThrow, resolve } from '@uidx/format'

import ConnectSection from '../src/ConnectSection.vue'
import { headlessChoiceError, parseHeadless, type ConnectionConfig } from '../src/headless'
import { classifyFailure } from '../src/inspector-messages'

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
  afterEach(() => {
    headlessChoiceError.value = null
  })

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
      props: {
        doc,
        component,
        library,
        config: CONFIG,
        writable: true,
        relation: 'of Button',
        file: 'button.uidx',
      },
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
      'Saved in button.uidx.',
    )
    expect(tab.find('.footnote').text()).toBe(
      'Element and parts save to button.uidx; names, React and project to uidx.json.',
    )
    expect(tab.find('[data-group="project"] .section-meta').text()).toBe(
      'custom-elements.json · 2 elements',
    )
  })

  it('keeps the element a list while the library loads, so the control does not flip', () => {
    const tab = mount(ConnectSection, {
      props: { doc, component, library: null, config: CONFIG, writable: true },
    })
    const select = tab.find('[aria-label="Implements"]')
    expect(select.element.tagName).toBe('SELECT')
    expect(select.findAll('option').map((option) => option.text())).toEqual(['None', 'x-button'])
  })

  it('lets the element be typed and pauses its checks while the library is unreadable', async () => {
    const tab = mount(ConnectSection, {
      props: { doc, component, library: null, config: CONFIG, writable: true, libraryFailed: true },
    })
    const input = tab.find('[aria-label="Implements"]')
    expect(input.element.tagName).toBe('INPUT')
    expect((input.element as HTMLInputElement).value).toBe('x-button')
    await input.setValue('x-link')
    expect(tab.emitted('patches')).toEqual([
      [[{ op: 'set', address: 'Button', prop: 'implements', value: 'x-link' }]],
    ])
    // The status line says why; nothing here claims no library is connected.
    expect(tab.text()).not.toContain('No library connected')
    expect(tab.find('[data-field="parts-progress"]').exists()).toBe(false)
    expect(tab.find('[data-group="project"] .section-meta').text()).toBe('Library unavailable')
    expect(tab.find('[data-field="library"]').text()).toContain('Unavailable')
    // The same fault, in the same colour as the status line and the tab's dot.
    expect(tab.find('[data-field="library"] .tone-dot[data-tone="danger"]').exists()).toBe(true)
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
    // Names live under the library: no library, no section of inputs that cannot save.
    expect(bare.find('[data-group="names"]').exists()).toBe(false)
    expect(
      bare.findAll('.link-button').filter((link) => link.text() === 'Choose library'),
    ).toHaveLength(1)
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
    const profile = mount(ConnectSection, {
      props: {
        doc,
        component,
        library,
        config: CONFIG,
        writable: true,
        fieldError: { key: 'profile', text: 'Profile values must be strings' },
      },
    })
    const naming = profile.find('[data-group="project"] .grid2 + .field-error')
    expect(naming.text()).toBe('Profile values must be strings')
    expect(profile.findAll('.field-error')).toHaveLength(1)
  })

  it('marks the Names field a refused save came from', async () => {
    const tab = mounted()
    await tab.find('[data-event="press"] input').setValue('click')
    await tab.setProps({ fieldError: { key: 'binding', text: "Couldn't save the change" } })
    expect(tab.find('[data-event="press"] input').attributes('aria-invalid')).toBe('true')
    expect(tab.find('[aria-label="Tag in the library"]').attributes('aria-invalid')).toBeUndefined()
    expect(tab.find('[data-group="names"] .field-error').text()).toBe("Couldn't save the change")
  })

  it('captions the React prop and omit columns over their rows', () => {
    const tab = mounted({
      ...CONFIG,
      codegen: { ...CONFIG.codegen!, react: { Button: { from: '@acme/ui' } } },
    })
    const head = tab.find('[data-group="react"] .pair-head')
    expect(head.attributes('aria-hidden')).toBe('true')
    expect(head.findAll('span').map((cell) => cell.text())).toEqual(['', 'React prop', 'Omit'])
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
    // The count is the section head's; the row does not repeat it.
    expect(row.text()).not.toContain('elements')
    expect(tab.find('[aria-label="Library path"]').exists()).toBe(false)
    await row.find('button').trigger('click')
    // Opens on the configured path, so a typo is fixed rather than retyped.
    expect((tab.find('[aria-label="Library path"]').element as HTMLInputElement).value).toBe(
      '../node_modules/@shoelace-style/shoelace/dist/custom-elements.json',
    )
    await tab.find('[aria-label="Library path"]').setValue('lib/custom-elements.json')
    await tab.find('[aria-label="Library path"]').trigger('keydown', { key: 'Enter' })
    expect(tab.emitted('chooseLibrary')).toEqual([['lib/custom-elements.json']])
    // Open until the choice lands in uidx.json, so a refusal can say why under it.
    expect(tab.find('[aria-label="Library path"]').exists()).toBe(true)
    await tab.setProps({
      config: {
        ...CONFIG,
        headless: { ...CONFIG.headless!, manifest: 'lib/custom-elements.json' },
      },
    })
    expect(tab.find('[aria-label="Library path"]').exists()).toBe(false)
  })

  it('says under the path why the library chosen was refused, until it is edited', async () => {
    const tab = mounted()
    await tab.find('[data-field="library"] button').trigger('click')
    const path = tab.find('[aria-label="Library path"]')
    await path.setValue('lib/missing.json')
    await path.trigger('keydown', { key: 'Enter' })
    headlessChoiceError.value = classifyFailure(
      new Error("ENOENT: no such file or directory, open '/abs/lib/missing.json'"),
    )
    await nextTick()
    expect(tab.find('.field-error').text()).toBe('Library file not found')
    expect(path.attributes('aria-invalid')).toBe('true')
    await path.setValue('lib/custom-elements.json')
    expect(tab.find('.field-error').exists()).toBe(false)
    expect(path.attributes('aria-invalid')).toBeUndefined()
  })

  it('offers the dependencies that ship a library, or a typed path', async () => {
    const tab = mount(ConnectSection, {
      props: {
        doc,
        component,
        library: null,
        config: { headless: null, codegen: null },
        writable: true,
        candidates: [{ package: '@acme/kit', path: 'node_modules/@acme/kit/custom-elements.json' }],
      },
    })
    const pick = tab.find('[aria-label="Library from your dependencies"]')
    expect(pick.findAll('option').map((option) => option.text())).toEqual([
      'From your dependencies…',
      '@acme/kit',
    ])
    await pick.setValue('node_modules/@acme/kit/custom-elements.json')
    expect(tab.emitted('chooseLibrary')).toEqual([['node_modules/@acme/kit/custom-elements.json']])
    const use = tab.findAll('button').find((button) => button.text() === 'Use library')!
    expect(use.attributes('disabled')).toBeDefined()
    await tab.find('[aria-label="Library path"]').setValue('lib/custom-elements.json')
    expect(use.attributes('disabled')).toBeUndefined()
    await use.trigger('click')
    expect(tab.emitted('chooseLibrary')![1]).toEqual(['lib/custom-elements.json'])
  })

  it('opens Project at the field the status line asks for', async () => {
    const closed = mounted()
    expect(closed.find('[data-group="project"] .section-toggle').attributes('aria-expanded')).toBe(
      'false',
    )
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
    expect(tab.find('[data-group="project"] .section-toggle').attributes('aria-expanded')).toBe(
      'true',
    )
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Output folder')
    await tab.setProps({ focus: { target: 'library', n: 102 } })
    await nextTick()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Library path')
    // On the configured path, all of it selected, ready to fix or replace.
    const path = document.activeElement as HTMLInputElement
    expect(path.value).toBe('custom-elements.json')
    expect([path.selectionStart, path.selectionEnd]).toEqual([0, path.value.length])
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
