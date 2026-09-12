import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DeleteCollectionPlan } from '@uidx/schema'
import RemoveCollectionDialog from '../src/RemoveCollectionDialog.vue'

enableAutoUnmount(afterEach)
const original = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: vi.fn(),
  })
})
afterAll(() => {
  if (original) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', original)
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
})

const PLAN: DeleteCollectionPlan = {
  tokens: [],
  declaringFile: 'tokens.uidx',
  byFile: new Map(),
  dependents: [],
  flattened: [],
  modeOverrides: 0,
}

const mounted = (props: Partial<InstanceType<typeof RemoveCollectionDialog>['$props']> = {}) =>
  mount(RemoveCollectionDialog, {
    attachTo: document.body,
    props: { name: 'palette', tokens: [], plan: PLAN, blocked: null, ...props },
  })

describe('RemoveCollectionDialog', () => {
  it('explains an empty removal and waits for an explicit confirmation', async () => {
    const dialog = mounted()
    expect(dialog.text()).toContain('empty collection palette')
    expect(dialog.emitted('confirm')).toBeUndefined()
    await dialog.find('button.danger').trigger('click')
    expect(dialog.emitted('confirm')).toHaveLength(1)
  })

  it('lists all tokens and explains affected references and mode selections', () => {
    const tokens = ['palette#black', 'palette#white']
    const dialog = mounted({
      tokens,
      plan: {
        ...PLAN,
        tokens,
        modeOverrides: 1,
        dependents: [{ file: 'page.uidx', address: 'box', prop: 'fills', kind: 'scene' }],
      },
    })
    expect(dialog.text()).toContain('all 2 tokens inside it')
    expect(dialog.findAll('li').map((item) => item.text())).toEqual(['black', 'white'])
    expect(dialog.text()).toContain('1 reference will use resolved values')
    expect(dialog.text()).toContain('Values that depend on modes become fixed.')
    expect(dialog.text()).toContain('Mode selections for this collection will also be cleared.')
  })

  it('blocks removal when references cannot be resolved', async () => {
    const dialog = mounted({ plan: null, blocked: 'Fix the broken chain before deleting it.' })
    expect(dialog.find('[role="alert"]').text()).toContain('broken chain')
    expect(dialog.find('button.danger').attributes('disabled')).toBeDefined()
    await dialog.find('button.danger').trigger('click')
    expect(dialog.emitted('confirm')).toBeUndefined()
  })

  it('cancels without removal and restores the trigger without scrolling', async () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const focus = vi.spyOn(trigger, 'focus')
    const dialog = mounted()
    await dialog.find('button').trigger('click')
    expect(dialog.emitted('close')).toHaveLength(1)
    await dialog.find('dialog').trigger('cancel')
    expect(dialog.emitted('close')).toHaveLength(2)
    expect(dialog.emitted('confirm')).toBeUndefined()
    dialog.unmount()
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    trigger.remove()
  })
})
