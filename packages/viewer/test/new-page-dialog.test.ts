import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import NewPageDialog from '../src/NewPageDialog.vue'

afterEach(() => vi.unstubAllGlobals())

describe('creating pages', () => {
  it('submits a name once, shows progress, and opens the created page', async () => {
    let finish!: (response: Response) => void
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    )
    vi.stubGlobal('fetch', fetcher)
    const dialog = mount(NewPageDialog)
    await dialog.get('input').setValue('Checkout')
    await dialog.get('form').trigger('submit')
    await dialog.get('form').trigger('submit')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]).toEqual([
      '/__uidx/pages',
      expect.objectContaining({ method: 'POST', body: '{"name":"Checkout"}' }),
    ])
    expect(dialog.text()).toContain('Creating…')
    finish(new Response('{"file":"checkout.uidx"}', { status: 201 }))
    await flushPromises()
    expect(dialog.emitted('created')).toEqual([['checkout.uidx']])
    dialog.unmount()
  })

  it('keeps the name and displays a server refusal, allowing correction', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"error":"Already exists"}', { status: 409 })),
    )
    const dialog = mount(NewPageDialog)
    await dialog.get('input').setValue('Welcome')
    await dialog.get('form').trigger('submit')
    await flushPromises()
    expect(dialog.get('[role="alert"]').text()).toBe('Already exists')
    expect(dialog.get('input').element.value).toBe('Welcome')
    expect(dialog.emitted('created')).toBeUndefined()
    expect(dialog.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
    dialog.unmount()
  })

  it('can be cancelled without writing anything', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const dialog = mount(NewPageDialog)
    await dialog.get('button[type="button"]').trigger('click')
    expect(dialog.emitted('close')).toHaveLength(1)
    expect(fetcher).not.toHaveBeenCalled()
    dialog.unmount()
  })
})
