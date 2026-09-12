import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { CREATABLE_ELEMENTS } from '@uidx/schema'

import EditToolbar from '../src/EditToolbar.vue'

const render = (
  props: Partial<InstanceType<typeof EditToolbar>['$props']> = {},
  attached = false,
) =>
  mount(EditToolbar, {
    attachTo: attached ? document.body : undefined,
    props: {
      tool: null,
      canDelete: true,
      canMakeComponent: true,
      placing: null,
      canPlaceInstance: true,
      canAddSlot: true,
      writable: true,
      ...props,
    },
  })

const labels = (w: ReturnType<typeof render>) =>
  w.findAll('button').map((b) => b.attributes('aria-label'))

describe('the creation toolbar', () => {
  it('exposes basic tools and the graphics palette', () => {
    // The structural buttons sit outside that whitelist deliberately: making a
    // component and placing an instance are not things a pointer sweeps out.
    expect(labels(render())).toEqual([
      'Select',
      ...CREATABLE_ELEMENTS.map((e) => (e === 'Vector' ? 'Pen' : e)),
      'Graphics tools',
      'Make component',
      'New slot',
      'Place instance',
      'Delete',
    ])
  })

  it('marks the armed tool, and marks Select when nothing is armed', () => {
    const idle = render()
    expect(idle.find('[aria-label="Select"]').attributes('data-armed')).toBe('true')
    const armed = render({ tool: 'Ellipse' })
    expect(armed.find('[aria-label="Ellipse"]').attributes('data-armed')).toBe('true')
    expect(armed.find('[aria-label="Select"]').attributes('data-armed')).toBe('false')
  })

  it('arms a tool on click, and puts it away when pressed again', async () => {
    const w = render()
    await w.find('[aria-label="Rectangle"]').trigger('click')
    expect(w.emitted('tool')?.[0]).toEqual(['Rectangle'])

    const armed = render({ tool: 'Rectangle' })
    await armed.find('[aria-label="Rectangle"]').trigger('click')
    expect(armed.emitted('tool')?.[0]).toEqual([null])
  })

  it('names the shortcut, so the keyboard is discoverable from the tray', () => {
    const w = render()
    expect(w.find('[aria-label="Rectangle"]').attributes('title')).toBe('Rectangle — R')
    expect(w.find('[aria-label="Pen"]').attributes('title')).toBe('Pen — P')
  })
})

describe('delete', () => {
  /**
   * D2's own wording: the sole child of a `<Component>` cannot be deleted, and
   * the UI disables the control rather than letting the patch throw.
   */
  it('is disabled when the selection is one the file will not let go of', () => {
    const w = render({ canDelete: false })
    expect(w.find('[aria-label="Delete"]').attributes('disabled')).toBeDefined()
    expect(w.emitted('remove')).toBeUndefined()
  })

  it('asks for the removal when it can', async () => {
    const w = render()
    await w.find('[aria-label="Delete"]').trigger('click')
    expect(w.emitted('remove')).toHaveLength(1)
  })
})

describe('with no connection to the server', () => {
  it('disables every control, because none of them can reach the file', () => {
    const w = render({ writable: false })
    for (const button of w.findAll('button')) {
      expect(button.attributes('disabled')).toBeDefined()
    }
  })
})

it('chooses Pencil and shape presets from the graphics menu', async () => {
  const w = render()
  await w.get('[aria-label="Graphics tools"]').trigger('click')
  expect(w.get('[role="menu"]').text()).toContain('Draw graphics')
  await w.get('[aria-label="Pencil tool"]').trigger('click')
  expect(w.emitted('tool')?.at(-1)).toEqual(['Pencil'])
  expect(w.find('[role="menu"]').exists()).toBe(false)
  await w.get('[aria-label="Graphics tools"]').trigger('click')
  await w.get('[aria-label="Star tool"]').trigger('click')
  expect(w.emitted('tool')?.at(-1)).toEqual(['Star'])
})

it('remembers the chosen graphic after drawing and reactivates it from the main button', async () => {
  const w = render()
  await w.get('[aria-label="Graphics tools"]').trigger('click')
  await w.get('[aria-label="Pencil tool"]').trigger('click')
  await w.setProps({ tool: 'Pencil' })
  expect(w.find('[aria-label="Pen"]').exists()).toBe(false)
  expect(w.get('.graphics-tool').attributes('aria-label')).toBe('Pencil')
  expect(w.get('.graphics-tool').attributes('aria-pressed')).toBe('true')

  // Drawing finishes in Select; using a basic tool must also retain Pencil.
  await w.setProps({ tool: null })
  await w.setProps({ tool: 'Rectangle' })
  expect(w.get('.graphics-tool').attributes('aria-pressed')).toBe('false')
  await w.get('.graphics-tool').trigger('click')
  expect(w.emitted('tool')?.at(-1)).toEqual(['Pencil'])
  expect(w.find('[role="menu"]').exists()).toBe(false)

  await w.setProps({ tool: 'Pencil' })
  await w.get('.graphics-tool').trigger('click')
  expect(w.emitted('tool')?.at(-1)).toEqual(['Pencil'])
})

it('updates the remembered graphic when a keyboard shortcut changes the active tool', async () => {
  const w = render({ tool: 'Star' })
  expect(w.get('.graphics-tool').attributes('aria-label')).toBe('Star')
  await w.setProps({ tool: 'Arrow' })
  expect(w.get('.graphics-tool').attributes('title')).toBe('Arrow — Shift+L')
  await w.setProps({ tool: null })
  await w.get('[aria-label="Graphics tools"]').trigger('click')
  expect(w.get('[aria-label="Arrow tool"]').attributes('data-active')).toBe('true')
  await w.get('[aria-label="Star tool"]').trigger('click')
  expect(w.get('.graphics-tool').attributes('aria-label')).toBe('Star')
  await w.get('.graphics-tool').trigger('click')
  expect(w.emitted('tool')?.at(-1)).toEqual(['Star'])
})

it('keeps keyboard focus in the floating graphics menu and returns it on Escape', async () => {
  const w = render({}, true)
  try {
    await w.get('[aria-label="Graphics tools"]').trigger('click')
    expect(document.activeElement).toBe(w.get('[aria-label="Pen tool"]').element)
    await w.get('[aria-label="Pen tool"]').trigger('keydown', { key: 'End', code: 'End' })
    expect(document.activeElement).toBe(w.get('[aria-label="Star tool"]').element)
    await w.get('[aria-label="Star tool"]').trigger('keydown', { key: 'Escape', code: 'Escape' })
    expect(w.find('[role="menu"]').exists()).toBe(false)
    expect(document.activeElement).toBe(w.get('[aria-label="Graphics tools"]').element)
  } finally {
    w.unmount()
  }
})

it('restores focus to the chosen graphics tool and skips disabled tools with arrow keys', async () => {
  const w = render({ canMakeComponent: false, canAddSlot: false, canPlaceInstance: false }, true)
  try {
    await w.get('[aria-label="Graphics tools"]').trigger('click')
    await w.get('[aria-label="Pencil tool"]').trigger('click')
    expect(document.activeElement).toBe(w.get('.graphics-tool').element)
    const trigger = w.get('[aria-label="Graphics tools"]')
    ;(trigger.element as HTMLButtonElement).focus()
    await trigger.trigger('keydown', { key: 'ArrowRight', code: 'ArrowRight' })
    expect(document.activeElement).toBe(w.get('[aria-label="Delete"]').element)
    expect(w.emitted('remove')).toBeUndefined()
  } finally {
    w.unmount()
  }
})
