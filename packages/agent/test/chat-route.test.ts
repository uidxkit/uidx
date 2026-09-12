import { describe, expect, it } from 'vitest'

import { createApp } from '../src/server/app.js'

const app = () =>
  createApp({
    version: '0.0.0',
    chat: async (body) => Response.json({ saw: body }),
    revert: async (body) => Response.json({ reverted: body }),
  })

describe('POST /chat', () => {
  it('hands the whole body to the runner, metadata included', async () => {
    const response = await app().request('/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [],
        documentId: 'doc',
        page: 'home.uidx',
        selection: ['hero'],
      }),
    })
    expect(await response.json()).toEqual({
      saw: { messages: [], documentId: 'doc', page: 'home.uidx', selection: ['hero'] },
    })
  })
})

describe('POST /revert', () => {
  it('hands the turn id to the runner', async () => {
    const response = await app().request('/revert', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documentId: 'doc', turnId: 't-1' }),
    })
    expect(await response.json()).toEqual({ reverted: { documentId: 'doc', turnId: 't-1' } })
  })
})
