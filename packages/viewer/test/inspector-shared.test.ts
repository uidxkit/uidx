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
    expect(root.attributes('role')).toBe('alert')
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
    expect(status.find('.inspector-status').attributes('role')).toBe('status')
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
    await bar.trigger('click')
    expect(status.emitted('update:open')).toEqual([[true]])
    await status.setProps({ open: true })

    const rows = status.findAll('.status-row')
    expect(rows.map((row) => row.attributes('data-status'))).toEqual(['library', 'blocked'])
    expect(rows[0]!.find('.row-title').text()).toBe('library title')
    expect(rows[0]!.find('.status-detail').text()).toBe('Part checks are paused.')
    const chip = rows[0]!.find('.path-chip')
    expect(chip.text()).toBe('../vendor/…/custom-elements.json')
    expect(chip.attributes('title')).toBe('/abs/vendor/hwc/missing/custom-elements.json')

    // Three rows, then the rest behind '+N more'.
    expect(rows[0]!.findAll('.row-label').map((l) => l.text())).toEqual(['a', 'b', 'c'])
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

  it('shows a lone action inline when there is nothing to open', async () => {
    const status = mount(InspectorStatus, {
      props: {
        items: [item('contract', 'warn', { actions: [{ label: 'Show', run: 'open-contract' }] })],
        open: false,
      },
    })
    expect(status.find('button.status-bar').exists()).toBe(false)
    expect(status.find('.chevron').exists()).toBe(false)
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

  it('collapses as a details whose toggle reports the reader’s choice', async () => {
    const section = mount(InspectorSection, {
      props: {
        title: 'Code binding',
        collapsible: true,
        field: 'code-binding',
        meta: 'for developers',
      },
      slots: { default: '<p class="body">element</p>' },
    })
    const details = section.find('details[data-field="code-binding"]')
    expect(details.exists()).toBe(true)
    expect((details.element as HTMLDetailsElement).open).toBe(false)
    expect(details.text()).toContain('for developers')
    expect(section.find('summary .chevron').exists()).toBe(true)
    ;(details.element as HTMLDetailsElement).open = true
    await details.trigger('toggle')
    expect(section.emitted('toggle')).toEqual([[true]])

    await section.setProps({ open: false })
    await section.setProps({ open: true })
    expect((details.element as HTMLDetailsElement).open).toBe(true)
  })

  it('keeps head buttons from toggling a collapsible section', async () => {
    const onClick = vi.fn()
    const section = mount(InspectorSection, {
      props: { title: 'React component', collapsible: true, info: 'Render it.' },
      slots: { actions: () => [h('button', { class: 'cluster-btn remove', onClick }, 'x')] },
    })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    section.find('.remove').element.dispatchEvent(event)
    expect(onClick).toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
    await section.find('.info-tip').trigger('click')
    expect((section.find('details').element as HTMLDetailsElement).open).toBe(false)
    expect(section.find('.section-tip').exists()).toBe(true)
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
