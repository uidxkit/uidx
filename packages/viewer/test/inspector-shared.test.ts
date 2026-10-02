import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { h } from 'vue'

import InspectorEmpty from '../src/InspectorEmpty.vue'
import InspectorSection from '../src/InspectorSection.vue'
import InspectorStatus from '../src/InspectorStatus.vue'
import type { StatusItem } from '../src/inspector-messages'

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

const item = (
  id: string,
  tone: StatusItem['tone'],
  extra: Partial<StatusItem> = {},
): StatusItem => ({
  id,
  tone,
  title: `${id} title`,
  ...extra,
})

/** The status line: the one place Contract, Connect and Code say something is wrong. */
describe('InspectorStatus', () => {
  it('renders nothing while there is nothing to say', () => {
    const status = mount(InspectorStatus, { props: { items: [], open: false } })
    expect(status.find('.inspector-status').exists()).toBe(false)
  })

  it('leads with the worst item, its title and how many more there are', () => {
    const status = mount(InspectorStatus, {
      props: {
        items: [item('note', 'info'), item('lib', 'danger'), item('dot', 'warn')],
        open: false,
      },
    })
    const root = status.find('.inspector-status')
    expect(root.attributes('data-tone')).toBe('danger')
    // Only the bar is live, never the list a reader opens under it.
    expect(root.attributes('role')).toBeUndefined()
    expect(status.find('.status-live').attributes('role')).toBe('alert')
    expect(status.find('.status-bar').attributes('aria-label')).toBe('Error: lib title (+2)')
    expect(status.find('.status-title').text()).toBe('lib title')
    expect(status.find('.status-count').text()).toBe('+2')
    expect(status.find('[data-icon="alert-circle"]').exists()).toBe(true)
    expect(status.find('.status-list').exists()).toBe(false)
  })

  it('prefers the item’s own count, and is a polite status below danger', () => {
    const status = mount(InspectorStatus, {
      props: { items: [item('code', 'warn', { count: '3 problems', detail: 'x' })], open: false },
    })
    expect(status.find('.status-count').text()).toBe('3 problems')
    expect(status.find('.status-live').attributes('role')).toBe('status')
    expect(status.find('.tone-dot[data-tone="warn"]').exists()).toBe(true)
  })

  it('opens to each item, in tone order, with its detail, path, rows and actions', async () => {
    const status = mount(InspectorStatus, {
      props: {
        items: [
          item('blocked', 'warn', { detail: 'That file has 1 problem.' }),
          item('library', 'danger', {
            detail: 'Part checks are paused.',
            path: '../vendor/hwc/missing/custom-elements.json',
            pathTitle: '/abs/vendor/hwc/missing/custom-elements.json',
            rows: ['a', 'b', 'c', 'd', 'e'].map((label) => ({
              label,
              meta: `${label}.uidx · line 1`,
            })),
            actions: [{ label: 'Retry', run: 'retry-library' }],
          }),
        ],
        open: false,
      },
    })
    const bar = status.find('button.status-bar')
    expect(bar.attributes('aria-expanded')).toBe('false')
    expect(bar.attributes('aria-controls')).toBeUndefined()
    await bar.trigger('click')
    expect(status.emitted('update:open')).toEqual([[true]])
    await status.setProps({ open: true })
    const list = status.find('.status-list')
    expect(bar.attributes('aria-controls')).toBe(list.attributes('id'))
    expect(status.find('.status-live .status-list').exists()).toBe(false)

    const rows = status.findAll('.status-row')
    expect(rows.map((row) => row.attributes('data-status'))).toEqual(['library', 'blocked'])
    expect(rows[0]!.find('.row-title').text()).toBe('library title')
    expect(rows[0]!.find('.status-detail').text()).toBe('Part checks are paused.')
    const chip = rows[0]!.find('.path-chip')
    expect(chip.text()).toBe('…/custom-elements.json')
    expect(chip.attributes('title')).toBe('/abs/vendor/hwc/missing/custom-elements.json')

    // Three rows, then the rest behind '+N more'.
    expect(rows[0]!.findAll('.row-label').map((l) => l.text())).toEqual(['a', 'b', 'c'])
    expect(rows[0]!.find('.status-rows li .row-meta').text()).toBe('a.uidx · line 1')
    const more = rows[0]!.findAll('.status-rows .link-button').at(-1)!
    expect(more.text()).toBe('+2 more')
    await more.trigger('click')
    expect(status.findAll('.status-row')[0]!.findAll('.row-label')).toHaveLength(5)

    await rows[0]!.find('.status-actions .link-button').trigger('click')
    expect(status.emitted('act')).toEqual([[{ label: 'Retry', run: 'retry-library' }]])
  })

  it('does not repeat the title of a single item, and keeps raw text behind Details', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const status = mount(InspectorStatus, {
      props: {
        items: [item('library', 'danger', { detail: 'Gone.', raw: 'ENOENT: no such file' })],
        open: true,
      },
    })
    expect(status.find('.row-title').exists()).toBe(false)
    expect(status.find('.status-bar').text()).toContain('library title')
    const raw = status.find('details.status-raw')
    expect(raw.find('summary').text()).toContain('Details')
    expect(raw.find('pre').text()).toBe('ENOENT: no such file')
    await raw.find('.link-button').trigger('click')
    expect(writeText).toHaveBeenCalledWith('ENOENT: no such file')
  })

  it('lists a row’s message first, then where it is from and its action', async () => {
    const status = mount(InspectorStatus, {
      props: {
        items: [
          item('code', 'danger', {
            rows: [
              {
                label: 'Unknown part “spinner-track”',
                meta: 'button.uidx · line 11',
                action: { label: 'Open contract', run: 'open-contract' },
              },
            ],
          }),
        ],
        open: true,
      },
    })
    const row = status.find('.status-rows li')
    expect([...row.element.children].map((child) => child.className)).toEqual([
      'row-label',
      'row-meta',
      'link-button row-action',
    ])
    await row.find('.row-action').trigger('click')
    expect(status.emitted('act')).toEqual([[{ label: 'Open contract', run: 'open-contract' }]])
  })

  it('shows the full path the chip shortens in its title', async () => {
    const status = mount(InspectorStatus, {
      props: {
        items: [item('library', 'danger', { path: '../vendor/hwc/missing/custom-elements.json' })],
        open: true,
      },
    })
    // The chip's budget is the narrowest pane's: the file name survives.
    const chip = status.find('.path-chip')
    expect(chip.text()).toBe('…/custom-elements.json')
    expect(chip.attributes('title')).toBe('../vendor/hwc/missing/custom-elements.json')
  })

  it('shows a lone action inline when there is nothing to open', async () => {
    const status = mount(InspectorStatus, {
      props: {
        items: [item('contract', 'warn', { actions: [{ label: 'Show', run: 'open-contract' }] })],
        open: false,
      },
    })
    expect(status.find('button.status-bar').exists()).toBe(false)
    expect(status.find('.chevron').exists()).toBe(false)
    // A plain bar takes no label; its tone is read out from hidden text.
    expect(status.find('.status-bar').attributes('aria-label')).toBeUndefined()
    expect(status.find('.status-bar .sr-only').text()).toBe('Warning:')
    await status.find('.status-bar .link-button').trigger('click')
    expect(status.emitted('act')).toEqual([[{ label: 'Show', run: 'open-contract' }]])
    expect(status.emitted('update:open')).toBeUndefined()
  })
})

/** The section: the Design tab's full-bleed head, for the other three tabs. */
describe('InspectorSection', () => {
  it('renders its title, meta, actions and body, with its hooks on the root', async () => {
    const section = mount(InspectorSection, {
      props: {
        title: 'Properties',
        meta: '10',
        metaTitle: 'Ten declarations',
        info: 'What an instance can change.',
        field: 'props',
        group: 'element',
        label: 'Properties',
      },
      slots: {
        default: '<p class="body">rows</p>',
        actions: '<button class="link-button fill">Fill from library</button>',
      },
    })
    const root = section.find('section.section')
    expect(root.attributes('data-field')).toBe('props')
    expect(root.attributes('data-group')).toBe('element')
    expect(root.attributes('aria-label')).toBe('Properties')
    expect(section.find('.head .title').text()).toBe('Properties')
    expect(section.find('.section-meta').text()).toBe('10')
    expect(section.find('.section-meta').attributes('title')).toBe('Ten declarations')
    expect(section.find('.section-actions .fill').exists()).toBe(true)
    expect(section.find('.section-body .body').text()).toBe('rows')
    expect(section.find('.chevron').exists()).toBe(false)

    const tip = section.find('button.info-tip')
    expect(tip.attributes('aria-label')).toBe('About Properties')
    expect(tip.attributes('title')).toBe('What an instance can change.')
    expect(tip.find('[data-icon="info"]').exists()).toBe(true)
    expect(section.find('.section-tip').exists()).toBe(false)
    await tip.trigger('click')
    expect(tip.attributes('aria-expanded')).toBe('true')
    expect(section.find('.section-tip').text()).toBe('What an instance can change.')
    await tip.trigger('click')
    expect(section.find('.section-tip').exists()).toBe(false)
  })

  it('leaves out what it is not given', () => {
    const section = mount(InspectorSection, { props: { title: 'States' } })
    expect(section.find('.section-meta').exists()).toBe(false)
    expect(section.find('.info-tip').exists()).toBe(false)
    expect(section.find('section').attributes('data-field')).toBeUndefined()
  })

  it('collapses as a disclosure whose toggle reports the reader’s choice', async () => {
    const section = mount(InspectorSection, {
      props: {
        title: 'Code binding',
        collapsible: true,
        field: 'code-binding',
        meta: 'for developers',
      },
      slots: { default: '<p class="body">element</p>' },
    })
    const root = section.find('section[data-field="code-binding"]')
    expect(root.exists()).toBe(true)
    const toggle = section.find('button.section-toggle')
    const body = section.find('.section-body')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(toggle.attributes('aria-controls')).toBe(body.attributes('id'))
    expect(toggle.text()).toContain('Code binding')
    expect(toggle.find('.section-meta').text()).toBe('for developers')
    const shown = (): boolean => (body.element as HTMLElement).style.display !== 'none'
    expect(shown()).toBe(false)
    expect(section.find('.head .chevron').exists()).toBe(true)

    await toggle.trigger('click')
    expect(section.emitted('toggle')).toEqual([[true]])
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(shown()).toBe(true)
    // The chevron folds it too.
    await section.find('.chevron').trigger('click')
    expect(section.emitted('toggle')).toEqual([[true], [false]])

    // `open` moves it when it changes; between changes, the reader's choice stands.
    await section.setProps({ open: true })
    expect(toggle.attributes('aria-expanded')).toBe('true')
    await section.setProps({ open: false })
    expect(toggle.attributes('aria-expanded')).toBe('false')
  })

  it('keeps head buttons out of the toggle, and shows the tip while closed', async () => {
    const onClick = vi.fn()
    const section = mount(InspectorSection, {
      props: { title: 'React component', collapsible: true, info: 'Render it.' },
      slots: { actions: () => [h('button', { class: 'cluster-btn remove', onClick }, 'x')] },
    })
    // Nothing interactive nests in the toggle: each button is its own control.
    expect(section.find('.section-toggle button').exists()).toBe(false)
    expect(section.find('.section-toggle').text()).toBe('React component')
    await section.find('.remove').trigger('click')
    expect(onClick).toHaveBeenCalled()
    const tip = section.find('.info-tip')
    await tip.trigger('click')
    expect(section.emitted('toggle')).toBeUndefined()
    expect(section.find('.section-toggle').attributes('aria-expanded')).toBe('false')
    // The (i) of a closed section still shows its text, under the head.
    expect(tip.attributes('aria-expanded')).toBe('true')
    const tipText = section.find('.section-tip')
    expect(tipText.element.closest('.section-body')).toBeNull()
    expect(tipText.text()).toBe('Render it.')
    // The (i) is last, after the chevron, at the right edge as on every section.
    const head = [...section.find('.head').element.children].map((child) => child.className)
    expect(head.slice(-2)).toEqual(['chevron', 'cluster-btn info-tip'])
  })

  it('opens on request, also after the reader closed it', async () => {
    const section = mount(InspectorSection, {
      props: { title: 'Code binding', collapsible: true, open: true },
    })
    await section.find('.section-toggle').trigger('click')
    expect(section.find('.section-toggle').attributes('aria-expanded')).toBe('false')
    ;(section.vm as unknown as { show(): void }).show()
    await section.vm.$nextTick()
    expect(section.find('.section-toggle').attributes('aria-expanded')).toBe('true')
    expect(section.emitted('toggle')).toEqual([[false], [true]])
  })
})

/** The empty state: a title, a hint, at most one action, and the tab's About. */
describe('InspectorEmpty', () => {
  it('renders its title, hint and action', async () => {
    const empty = mount(InspectorEmpty, {
      props: {
        kind: 'outside',
        title: 'Not in a component',
        hint: 'Only layers inside a component have a contract.',
        action: { label: 'Make component', run: 'make-component' },
      },
    })
    expect(empty.find('.empty-state').attributes('data-empty')).toBe('outside')
    expect(empty.find('.empty-title').text()).toBe('Not in a component')
    expect(empty.find('.empty-hint').text()).toBe('Only layers inside a component have a contract.')
    expect(empty.find('details.about').exists()).toBe(false)
    // A long name ellipsises on one line; the full label is the title.
    expect(empty.find('.link-button').attributes('title')).toBe('Make component')
    await empty.find('.link-button').trigger('click')
    expect(empty.emitted('act')).toEqual([[{ label: 'Make component', run: 'make-component' }]])
  })

  it('keeps the About disclosure closed until opened, then remembers it', async () => {
    const props = {
      kind: 'none',
      title: 'No component selected',
      about: { label: 'About Code', text: 'A live preview.' },
    }
    const first = mount(InspectorEmpty, { props })
    const about = first.find('details.about')
    expect(about.find('summary').text()).toContain('About Code')
    expect((about.element as HTMLDetailsElement).open).toBe(false)
    expect(first.find('.link-button').exists()).toBe(false)
    ;(about.element as HTMLDetailsElement).open = true
    await about.trigger('toggle')
    expect(localStorage.getItem('uidx.inspector.about')).toBe('open')
    const second = mount(InspectorEmpty, { props })
    expect((second.find('details.about').element as HTMLDetailsElement).open).toBe(true)
  })
})
