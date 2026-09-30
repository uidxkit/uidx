import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ContextMenu, { type MenuItem } from '../src/ContextMenu.vue'

/**
 * The right-click menu: the toolbar's actions at the pointer, with their
 * shortcuts beside them, the way Figma, Plasmic and Builder list theirs.
 */
describe('the context menu', () => {
  const items = (run = vi.fn()): MenuItem[] => [
    { label: 'Make component', shortcut: '⌘⌥K', run },
    { label: 'New slot', disabled: true, run },
    { kind: 'separator' },
    { label: 'Delete', shortcut: '⌫', danger: true, run },
  ]

  it('lists every action with its shortcut and disables what the selection cannot do', () => {
    const menu = mount(ContextMenu, { props: { x: 10, y: 10, items: items() } })
    const rows = menu.findAll('[role="menuitem"]')
    expect(rows.map((r) => r.text())).toEqual(['Make component⌘⌥K', 'New slot', 'Delete⌫'])
    expect(rows[1]!.attributes('disabled')).toBeDefined()
    expect(rows[2]!.classes()).toContain('danger')
    expect(menu.findAll('[role="separator"]')).toHaveLength(1)
  })

  it('runs the picked action and closes', async () => {
    const run = vi.fn()
    const menu = mount(ContextMenu, { props: { x: 10, y: 10, items: items(run) } })
    await menu.findAll('[role="menuitem"]')[0]!.trigger('click')
    expect(run).toHaveBeenCalledTimes(1)
    expect(menu.emitted('close')).toHaveLength(1)
  })

  it('does nothing for a disabled action', async () => {
    const run = vi.fn()
    const menu = mount(ContextMenu, { props: { x: 10, y: 10, items: items(run) } })
    await menu.findAll('[role="menuitem"]')[1]!.trigger('click')
    expect(run).not.toHaveBeenCalled()
    expect(menu.emitted('close')).toBeUndefined()
  })

  it('closes on Escape', () => {
    const menu = mount(ContextMenu, { props: { x: 10, y: 10, items: items() } })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(menu.emitted('close')).toHaveLength(1)
    menu.unmount()
  })
})
