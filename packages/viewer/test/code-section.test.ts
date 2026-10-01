import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import AppBar from '../src/AppBar.vue'
import CodeSection from '../src/CodeSection.vue'

afterEach(() => vi.unstubAllGlobals())

/** The Code tab: a component's generated files, live, one tab per target. */
describe('the Code tab', () => {
  const files = [
    { path: 'html/button.css', text: '.button {}\n' },
    { path: 'react/Button.tsx', text: 'export function Button() {}\n' },
    { path: 'contract/button.json', text: '{}\n' },
  ]

  it('asks the server for the component and shows React first, with a tab per file', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ files, diagnostics: [] })))
    vi.stubGlobal('fetch', fetcher)
    const section = mount(CodeSection, {
      props: {
        component: 'Button',
        stamp: 'a',
        writable: true,
        codegen: { out: 'src/ds', running: false, notice: '' },
      },
    })
    await flushPromises()
    expect(fetcher.mock.calls[0]![0]).toBe('/__uidx/code?component=Button')
    expect(section.findAll('.files button').map((b) => b.text())).toEqual([
      'React',
      'CSS',
      'Contract',
    ])
    expect(section.find('.path').text()).toBe('react/Button.tsx')
    expect(section.find('pre').text()).toContain('export function Button()')
    await section.find('[data-file="html/button.css"]').trigger('click')
    expect(section.find('.path').text()).toBe('html/button.css')
    await section.find('[data-action="write"]').trigger('click')
    expect(section.emitted('generateCode')).toHaveLength(1)
  })

  it('says what to select when nothing has a component, and how to configure writing', async () => {
    vi.stubGlobal('fetch', vi.fn())
    expect(
      mount(CodeSection, { props: { component: null, stamp: '', writable: true } }).text(),
    ).toContain('Select a component')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ files, diagnostics: [] }))),
    )
    const section = mount(CodeSection, {
      props: { component: 'Button', stamp: '', writable: true },
    })
    await flushPromises()
    expect(section.find('.write').text()).toContain('codegen')
  })
})

describe('the file switcher', () => {
  it('lists every file under the page name and opens the one picked', async () => {
    const bar = mount(AppBar, {
      props: {
        title: 'acme',
        page: 'button',
        view: 'page',
        renderable: true,
        connection: 'open',
        canUndo: false,
        canRedo: false,
        codeOut: null,
        codeRunning: false,
        codeNotice: '',
        agentOnline: false,
        agentOpen: false,
        current: 'button.uidx',
        files: [
          { file: 'button.uidx', label: 'button', renderable: true },
          { file: 'tokens.uidx', label: 'tokens', renderable: false },
        ],
      },
    })
    await bar.find('[data-action="switch-file"]').trigger('click')
    expect(bar.findAll('.menu [data-file]').map((item) => item.text())).toEqual([
      'button',
      'tokens',
    ])
    await bar.find('.menu [data-file="tokens.uidx"]').trigger('click')
    expect(bar.emitted('open')).toEqual([['tokens.uidx']])
    expect(bar.find('.menu').exists()).toBe(false)
    await bar.find('[data-action="switch-file"]').trigger('click')
    await bar.find('[data-action="new-file"]').trigger('click')
    expect(bar.emitted('newFile')).toHaveLength(1)
  })
})
