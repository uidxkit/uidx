import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import WorkspaceStatus from '../src/WorkspaceStatus.vue'

/**
 * A designer never opens the file, so the strip is how they learn their
 * last change reached it — Webflow's check mark, Penpot's file status.
 */
describe('the workspace status strip', () => {
  it('says nothing about the file until something has been written', () => {
    const strip = mount(WorkspaceStatus, { props: { connection: 'open', revision: 1 } })
    expect(strip.text()).toContain('Connected')
    expect(strip.find('.file-state').exists()).toBe(false)
  })

  it('shows Saving while edits are in flight, then that all changes are saved', async () => {
    const strip = mount(WorkspaceStatus, {
      props: { connection: 'open', revision: 1, saving: true, saved: false },
    })
    expect(strip.find('.file-state').text()).toBe('Saving…')
    await strip.setProps({ saving: false, saved: true })
    expect(strip.find('.file-state').text()).toBe('All changes saved')
    expect(strip.find('.file-state').attributes('data-state')).toBe('saved')
  })

  it('drops the claim while the connection is down: nothing can reach the file', () => {
    const strip = mount(WorkspaceStatus, {
      props: { connection: 'reconnecting', revision: 1, saved: true },
    })
    expect(strip.text()).toContain('Reconnecting')
    expect(strip.find('.file-state').exists()).toBe(false)
  })
})
