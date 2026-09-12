import { describe, expect, it } from 'vitest'

import { createApp } from '../src/server/app.js'

const app = () =>
  createApp({
    version: '0.0.0',
    chat: async () => new Response('unused'),
    revert: async () => new Response('unused'),
  })

describe('GET /health', () => {
  it('answers with the harness version so the panel can show it is live', async () => {
    const response = await app().request('/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, version: '0.0.0' })
  })

  it('allows the viewer origin to read the response', async () => {
    const response = await app().request('/health', {
      headers: { Origin: 'http://localhost:4400' },
    })
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:4400')
  })

  it('allows the loopback address and any port the dev server settled on', async () => {
    for (const origin of ['http://127.0.0.1:4413', 'http://localhost:5173', 'https://localhost']) {
      const response = await app().request('/health', { headers: { Origin: origin } })
      expect(response.headers.get('access-control-allow-origin')).toBe(origin)
    }
  })
})

/**
 * The service has no authentication and writes the designer's files. Reflecting
 * every origin meant any page they happened to have open could POST a turn and
 * *read the stream back*, and that stream quotes `.uidx` source. Only the
 * negative case proves the allowlist; the positive one above passed just as
 * happily when the answer was `*`.
 */
describe('an origin that is not this machine', () => {
  it('is not allowed to read a health probe', async () => {
    const response = await app().request('/health', {
      headers: { Origin: 'https://evil.example' },
    })
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  /**
   * A cross-origin POST that counts as a "simple request" is sent before the
   * browser checks who may read the answer, so withholding the header alone
   * would still let a page the designer visited start a turn — and a turn
   * writes their files.
   */
  it('cannot start a turn it would not be allowed to read', async () => {
    let reached = false
    const withSpy = createApp({
      version: '0.0.0',
      chat: async () => {
        reached = true
        return new Response('unused')
      },
      revert: async () => new Response('unused'),
    })
    const response = await withSpy.request('/chat', {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'content-type': 'text/plain' },
      body: JSON.stringify({ messages: [] }),
    })
    expect(response.status).toBe(403)
    expect(reached).toBe(false)
  })

  it('is not allowed to read a turn, however it dresses the host up', async () => {
    for (const origin of [
      'https://evil.example',
      'http://localhost.evil.example',
      'http://127.0.0.1.evil.example',
      'http://notlocalhost',
    ]) {
      const response = await app().request('/chat', {
        method: 'POST',
        headers: { Origin: origin, 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [] }),
      })
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
    }
  })

  it('is turned away at the preflight, so the browser never sends the turn', async () => {
    const response = await app().request('/chat', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example',
        'Access-Control-Request-Method': 'POST',
      },
    })
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('a body that is not JSON', () => {
  it('comes back in the same shape every other refusal does', async () => {
    const response = await app().request('/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'request body must be JSON' })
  })

  it('does not reach the turn runner at all', async () => {
    let reached = false
    const withSpy = createApp({
      version: '0.0.0',
      chat: async () => {
        reached = true
        return new Response('unused')
      },
      revert: async () => new Response('unused'),
    })
    await withSpy.request('/chat', { method: 'POST', body: '{' })
    expect(reached).toBe(false)
  })
})
