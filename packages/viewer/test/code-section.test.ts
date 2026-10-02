import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'

import AppBar from '../src/AppBar.vue'
import CodeSection from '../src/CodeSection.vue'
import { headlessFailure } from '../src/headless'

// The tab watches the shared library state; a section left mounted would answer for this one.
enableAutoUnmount(afterEach)
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  headlessFailure.value = null
})

/** The uidx server's JSON, as `unavailable()` expects it. */
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const codegen = (extra: object = {}) => ({
  out: '../generated',
  running: false,
  notice: '',
  result: null,
  ...extra,
})

/** The manifest miss every new part binding hits. */
const spinner = {
  file: 'button.uidx',
  line: 11,
  column: 3,
  message:
    'part "spinner-track" has no element in the manifest (looked for hwc-button-spinner-track)',
  severity: 'error',
}

/** The Code tab: a component's generated files, live, one tab per target. */
describe('the Code tab', () => {
  const files = [
    { path: 'html/button.css', text: '.button {}\n' },
    { path: 'react/Button.tsx', text: 'export function Button() {}\n' },
    { path: 'contract/button.json', text: '{}\n' },
  ]

  it('asks the server for the component and shows React first, with a tab per file', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ files, diagnostics: [] }))
    vi.stubGlobal('fetch', fetcher)
    const section = mount(CodeSection, {
      props: { component: 'Button', stamp: 'a', writable: true, codegen: codegen() },
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
    expect(section.find('[data-file="html/button.css"]').attributes('aria-selected')).toBe('true')
    await section.find('[data-file="html/button.css"]').trigger('keydown', { key: 'ArrowRight' })
    expect(section.find('.path').text()).toBe('contract/button.json')
    await section.find('[data-action="write"]').trigger('click')
    expect(section.emitted('generateCode')).toHaveLength(1)
    expect(section.emitted('status')).toEqual([[{ component: 'Button', state: 'live', items: [] }]])
  })

  it('says what to select when nothing has a component, and how to configure writing', async () => {
    vi.stubGlobal('fetch', vi.fn())
    expect(
      mount(CodeSection, { props: { component: null, stamp: '', writable: true } }).text(),
    ).toContain('Select a component')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ files, diagnostics: [] })))
    const section = mount(CodeSection, {
      props: { component: 'Button', stamp: '', writable: true },
    })
    await flushPromises()
    expect(section.find('.write').text()).toContain('No output folder')
    await section.find('.write .link-button').trigger('click')
    expect(section.emitted('act')).toEqual([
      [{ label: 'Set folder', run: 'open-project', arg: 'output' }],
    ])
  })

  it('writes code from the footer and says how many files the last run wrote', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ files, diagnostics: [] })))
    const section = mount(CodeSection, {
      props: {
        component: 'Button',
        stamp: '',
        writable: true,
        codegen: codegen({
          result: { kind: 'ok', written: 3, out: '../generated', at: Date.now() },
        }),
      },
    })
    await flushPromises()
    const write = section.find('[data-action="write"]')
    expect(write.text()).toBe('Write code')
    expect(write.attributes('disabled')).toBeUndefined()
    expect(write.attributes('title')).toBe('Write every component into ../generated')
    expect(section.find('.write').text()).toContain('All components → ../generated')
    expect(section.find('.write').text()).toContain('Wrote 3 files')
    await section.setProps({ writable: false })
    expect(section.find('[data-action="write"]').attributes('title')).toBe(
      'Reconnect to write code',
    )
  })

  it('disables Copy and Write while the generator reports problems, and reports them up', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json({
          files: [],
          diagnostics: [
            spinner,
            { ...spinner, file: 'checkbox-field.uidx', line: 4 },
            { ...spinner, line: 2, severity: 'warning' },
          ],
        }),
      ),
    )
    const section = mount(CodeSection, {
      props: {
        component: 'Button',
        stamp: '',
        writable: true,
        file: 'button.uidx',
        declaredIn: (file: string) =>
          file === 'checkbox-field.uidx' ? 'CheckboxField' : undefined,
        codegen: codegen({
          result: { kind: 'ok', written: 3, out: '../generated', at: Date.now() },
        }),
      },
    })
    await flushPromises()
    expect(section.find('[data-action="copy"]').attributes('disabled')).toBeDefined()
    const write = section.find('[data-action="write"]')
    expect(write.attributes('disabled')).toBeDefined()
    expect(write.attributes('title')).toBe('Fix 2 problems to write code')
    // What the last run wrote is no longer what shows.
    expect(section.find('.caption.done').exists()).toBe(false)
    expect(section.find('pre').exists()).toBe(false)
    expect(section.find('.hint').text()).toBe('Code appears here once the problem above is fixed.')
    // The raw diagnostic is the status line's, never the tab body's.
    expect(section.text()).not.toContain('looked for')
    const [[report]] = section.emitted('status') as [
      [{ state: string; items: { id: string; actions?: unknown[] }[] }],
    ]
    expect(report.state).toBe('blocked')
    expect(report.items.map((item) => item.id)).toEqual(['code', 'blocked:checkbox-field.uidx'])
    // The file that blocks this one opens at the component it declares.
    expect(report.items[1]!.actions).toEqual([
      { label: 'Open CheckboxField', run: 'open-component', arg: 'CheckboxField' },
    ])
  })

  it('disables Copy when there is no code, and says so when nothing renders the component', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ files: [], diagnostics: [] })))
    const section = mount(CodeSection, {
      props: { component: 'Button', stamp: '', writable: true, codegen: codegen() },
    })
    expect(section.find('[data-action="copy"]').attributes('disabled')).toBeDefined()
    await flushPromises()
    expect(section.find('[data-action="copy"]').attributes('disabled')).toBeDefined()
    expect(section.find('[data-action="write"]').exists()).toBe(false)
    expect(section.find('[data-empty="no-files"]').text()).toContain('No code for Button')
    // The preview renders every target whatever is chosen: targets are never why.
    expect(section.find('[data-empty="no-files"] .link-button').exists()).toBe(false)
    expect(section.emitted('act')).toBeUndefined()
  })

  it('reports a failed request, retries on reload, and drops the failure once code arrives', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('<html>Bad gateway</html>', {
          status: 502,
          headers: { 'content-type': 'text/html' },
        }),
      )
      .mockResolvedValueOnce(json({ files, diagnostics: [] }))
    vi.stubGlobal('fetch', fetcher)
    const section = mount(CodeSection, {
      props: { component: 'Button', stamp: '', writable: true, reload: 0, codegen: codegen() },
    })
    await flushPromises()
    const reports = section.emitted('status') as [
      { state: string; items: { title: string; detail?: string; actions?: unknown[] }[] },
    ][]
    expect(reports[0]![0].state).toBe('failed')
    expect(reports[0]![0].items[0]).toMatchObject({
      title: "Couldn't render code",
      detail: 'The server sent an unexpected response.',
      actions: [{ label: 'Retry', run: 'retry-code' }],
    })
    expect(section.find('[data-action="copy"]').attributes('disabled')).toBeDefined()
    // The footer stays, disabled, as it does for a blocked render.
    const write = section.find('[data-action="write"]')
    expect(write.attributes('disabled')).toBeDefined()
    expect(write.attributes('title')).toBe('Fix the problem above to write code')
    await section.setProps({ reload: 1 })
    await flushPromises()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(reports[1]![0]).toEqual({ component: 'Button', state: 'live', items: [] })
    expect(section.find('.hint').exists()).toBe(false)
    expect(section.find('[data-action="copy"]').attributes('disabled')).toBeUndefined()
  })

  it("names a component the server can't render", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ error: 'Name a component of this document.' }, 404)),
    )
    const section = mount(CodeSection, {
      props: { component: 'Bad$Name', stamp: '', writable: true },
    })
    await flushPromises()
    const [[report]] = section.emitted('status') as [[{ items: { title: string }[] }]]
    expect(report.items.map((item) => item.title)).toEqual(["Can't render this component"])
  })

  it('leaves a failure the unreadable library caused to the library, and renders once it loads', async () => {
    const missing =
      "ENOENT: no such file or directory, open '/p/vendor/missing/custom-elements.json'"
    headlessFailure.value = {
      code: 'not-found',
      raw: `Could not read the headless library: ${missing}`,
    }
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ error: missing }, 400))
      .mockResolvedValueOnce(json({ files, diagnostics: [] }))
    vi.stubGlobal('fetch', fetcher)
    const section = mount(CodeSection, {
      props: { component: 'Button', stamp: '', writable: true },
    })
    await flushPromises()
    const reports = section.emitted('status') as [{ state: string; items: unknown[] }][]
    expect(reports[0]![0]).toEqual({ component: 'Button', state: 'failed', items: [] })
    expect(section.text()).not.toContain('ENOENT')
    headlessFailure.value = null
    await flushPromises()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(reports.at(-1)![0]).toEqual({ component: 'Button', state: 'live', items: [] })
    expect(section.find('pre').exists()).toBe(true)
  })

  it('wraps long lines on request, remembers it, and copies the file on show', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ files, diagnostics: [] })))
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const section = mount(CodeSection, {
      props: { component: 'Button', stamp: '', writable: true, relation: 'of List' },
    })
    await flushPromises()
    expect(section.find('.section-meta').text()).toBe('of List')
    expect(section.find('pre').attributes('data-wrap')).toBe('false')
    await section.find('[data-action="wrap"]').trigger('click')
    expect(section.find('pre').attributes('data-wrap')).toBe('true')
    expect(localStorage.getItem('uidx.code.wrap')).toBe('true')
    const again = mount(CodeSection, { props: { component: 'Button', stamp: '', writable: true } })
    await flushPromises()
    expect(again.find('[data-action="wrap"]').attributes('aria-pressed')).toBe('true')

    const copy = section.find('[data-action="copy"]')
    expect(copy.attributes('aria-label')).toBe('Copy react/Button.tsx')
    await copy.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('export function Button() {}\n')
    expect(section.find('[data-action="copy"] [data-icon="check"]').exists()).toBe(true)
    expect(section.find('.sr-only').text()).toBe('Copied')
  })

  it('shows a copy the browser refused on the button, not only to a screen reader', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ files, diagnostics: [] })))
      vi.stubGlobal('navigator', {
        ...navigator,
        clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      })
      const section = mount(CodeSection, {
        props: { component: 'Button', stamp: '', writable: true },
      })
      await flushPromises()
      await section.find('[data-action="copy"]').trigger('click')
      await flushPromises()
      const copy = section.find('[data-action="copy"]')
      expect(copy.find('[data-icon="alert-circle"]').classes()).toContain('copy-failed')
      expect(copy.attributes('title')).toBe("Couldn't copy. Select the text instead")
      expect(section.find('.sr-only').text()).toBe("Couldn't copy")
      await vi.advanceTimersByTimeAsync(1500)
      expect(copy.find('[data-icon="copy"]').exists()).toBe(true)
      expect(copy.attributes('title')).toBe('Copy react/Button.tsx')
    } finally {
      vi.useRealTimers()
    }
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
