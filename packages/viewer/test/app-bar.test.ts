import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { applyPatches, parseOrThrow, resolve } from '@uidx/format'

import AppBar from '../src/AppBar.vue'
import InsertPanel from '../src/InsertPanel.vue'
import { BLOCKS } from '../src/insert-blocks'
import { theme } from '../src/theme'

/**
 * The editor's top bar and its Insert panel: where you are, which face is
 * on, the session's controls, and what can be added.
 */
const bar = (over: Record<string, unknown> = {}) =>
  mount(AppBar, {
    props: {
      title: 'acme',
      page: 'button',
      view: 'page',
      renderable: true,
      connection: 'open',
      saved: true,
      canUndo: true,
      canRedo: false,
      codeOut: 'src/ds',
      codeRunning: false,
      codeNotice: '',
      agentOnline: false,
      agentOpen: false,
      ...over,
    },
  })

describe('the top bar', () => {
  it('shows document › page, the faces, and which one is on', async () => {
    const wrapper = bar()
    expect(wrapper.findAll('.crumb').map((c) => c.text())).toEqual(['acme', 'button'])
    const faces = wrapper.findAll('.face')
    expect(faces.map((f) => f.text())).toEqual(['Design', 'Docs', 'Tokens', 'Fonts', 'Models'])
    expect(faces[0]!.attributes('aria-pressed')).toBe('true')
    await faces[2]!.trigger('click')
    expect(wrapper.emitted('face')).toEqual([['tokens']])
    await wrapper.find('.crumb').trigger('click')
    expect(wrapper.emitted('home')).toHaveLength(1)
  })

  it('offers undo when there is history, says it saved, and hides the assistant when offline', async () => {
    const wrapper = bar()
    const [undo, redo] = wrapper.findAll('.history button')
    expect(redo!.attributes('disabled')).toBeDefined()
    await undo!.trigger('click')
    expect(wrapper.emitted('undo')).toHaveLength(1)
    expect(wrapper.find('.status').text()).toBe('Saved')
    expect(wrapper.find('[data-action="agent"]').exists()).toBe(false)
    expect(bar({ agentOnline: true }).find('[data-action="agent"]').text()).toBe('Ask AI')
    expect(bar({ connection: 'reconnecting' }).find('.status').text()).toBe('Reconnecting…')
  })

  it('generates code where uidx.json says, and explains how when it says nowhere', async () => {
    const configured = bar()
    await configured.find('[data-action="code"]').trigger('click')
    expect(configured.emitted('code')).toHaveLength(1)
    const unconfigured = bar({ codeOut: null })
    await unconfigured.find('[data-action="code"]').trigger('click')
    expect(unconfigured.emitted('code')).toBeUndefined()
    expect(unconfigured.find('.popover').text()).toContain('codegen')
  })

  it('switches theme and remembers it', async () => {
    const wrapper = bar()
    const before = theme.value
    await wrapper.find('[data-action="theme"]').trigger('click')
    expect(theme.value).not.toBe(before)
    expect(document.documentElement.dataset.theme).toBe(theme.value)
    expect(localStorage.getItem('uidx.theme')).toBe(theme.value)
  })

  it('hides the faces on the overview', () => {
    expect(bar({ view: 'home' }).find('.faces').exists()).toBe(false)
  })
})

describe('the Insert panel', () => {
  const page = parseOrThrow(`---
id: lib
---

## Visual Contract

<Page>
  <Component name="Card" status="stable" width={10} height={10} />
  <Component name="Avatar" status="draft" width={10} height={10} />
</Page>
`)
  const components = new Map([
    ['Card', resolve(page.tree, 'Card')!],
    ['Avatar', resolve(page.tree, 'Avatar')!],
  ])
  const panel = () =>
    mount(InsertPanel, { props: { components, writable: true, tool: null, placing: null } })

  it('arms drawing tools, inserts blocks and places components', async () => {
    const wrapper = panel()
    await wrapper.find('[data-tool="Rectangle"]').trigger('click')
    expect(wrapper.emitted('tool')).toEqual([['Rectangle']])
    await wrapper.find('[data-block="card"]').trigger('click')
    expect((wrapper.emitted('insert')![0]![0] as { element: string }).element).toBe('Frame')
    expect(wrapper.findAll('[data-component]').map((c) => c.attributes('data-component'))).toEqual([
      'Avatar',
      'Card',
    ])
    await wrapper.find('[data-component="Card"]').trigger('click')
    expect(wrapper.emitted('place')).toEqual([['Card']])
  })

  it('filters blocks and components by search', async () => {
    const wrapper = panel()
    await wrapper.find('input[type="search"]').setValue('car')
    expect(wrapper.findAll('[data-block]').map((b) => b.attributes('data-block'))).toEqual(['card'])
    expect(wrapper.findAll('[data-component]').map((c) => c.attributes('data-component'))).toEqual([
      'Card',
    ])
    expect(wrapper.find('[data-tool="Frame"]').exists()).toBe(false)
  })

  it('offers only blocks the file accepts', () => {
    const source = `---\nid: p\n---\n\n## Visual Contract\n\n<Page>\n</Page>\n`
    for (const block of BLOCKS) {
      const next = applyPatches(source, [
        { op: 'insert-node', parent: '', index: 0, node: block.node() },
      ]).source
      expect(parseOrThrow(next).tree.children[0]!.name, block.id).toBe(block.node().attrs.name)
    }
  })
})
