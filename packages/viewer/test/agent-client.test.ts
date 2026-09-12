import { describe, expect, it, vi } from 'vitest'

import { agentUrl, chatBody, probeAgent, revertTurn } from '../src/agent-client'

describe('agentUrl', () => {
  it('falls back to the documented default', () => {
    expect(agentUrl({})).toBe('http://localhost:4500')
  })

  it('prefers the configured url', () => {
    expect(agentUrl({ VITE_UIDX_AGENT_URL: 'http://gpu.local:9000' })).toBe('http://gpu.local:9000')
  })

  it('trims a trailing slash so route joins stay clean', () => {
    expect(agentUrl({ VITE_UIDX_AGENT_URL: 'http://localhost:4500/' })).toBe(
      'http://localhost:4500',
    )
  })
})

describe('probeAgent', () => {
  it('reports the version when the service answers', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, version: '0.0.0' })),
    )
    expect(await probeAgent('http://localhost:4500', fetchImpl)).toEqual({
      online: true,
      version: '0.0.0',
    })
  })

  it('reports offline rather than throwing when nothing is listening', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    expect(await probeAgent('http://localhost:4500', fetchImpl)).toEqual({ online: false })
  })

  it('reports offline on a non-ok response', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }))
    expect(await probeAgent('http://localhost:4500', fetchImpl)).toEqual({ online: false })
  })
})

describe('chatBody', () => {
  it('carries the document, the page and the selection', () => {
    expect(
      chatBody({ documentId: 'doc', page: 'home.uidx', selection: ['hero'], taskId: null }),
    ).toEqual({
      documentId: 'doc',
      page: 'home.uidx',
      selection: ['hero'],
    })
  })

  it('omits what the app does not know rather than sending nulls', () => {
    expect(chatBody({ documentId: null, page: 'home.uidx', selection: [], taskId: null })).toEqual({
      page: 'home.uidx',
      selection: [],
    })
  })

  it('carries the task id once the conversation has one', () => {
    expect(
      chatBody({ documentId: 'doc', page: 'home.uidx', selection: [], taskId: 'task-1' }),
    ).toEqual({
      documentId: 'doc',
      page: 'home.uidx',
      selection: [],
      taskId: 'task-1',
    })
  })
})

describe('revertTurn', () => {
  /** Typed with fetch's own parameters, so the recorded call can be read back. */
  const recordingFetch = (body: unknown, init: ResponseInit = {}) =>
    vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(body), init),
    )

  const sentBody = (init: RequestInit | undefined): unknown => JSON.parse(String(init?.body))

  it('posts the turn to the revert route and returns the files restored', async () => {
    const fetchImpl = recordingFetch({ ok: true, files: ['home.uidx'] })
    const files = await revertTurn(
      'http://localhost:4500',
      { documentId: 'doc', page: 'home.uidx', turnId: 't-1' },
      fetchImpl,
    )

    expect(files).toEqual(['home.uidx'])
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('http://localhost:4500/revert')
    expect(sentBody(init)).toEqual({ turnId: 't-1', documentId: 'doc', page: 'home.uidx' })
  })

  it('omits what the app does not know rather than sending nulls', async () => {
    const fetchImpl = recordingFetch({ ok: true, files: [] })
    await revertTurn(
      'http://localhost:4500',
      { documentId: null, page: null, turnId: 't-1' },
      fetchImpl,
    )
    expect(sentBody(fetchImpl.mock.calls[0]![1])).toEqual({ turnId: 't-1' })
  })

  it('throws with the service own words so the panel can show them', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'no checkpoint for turn t-1' }), { status: 404 }),
    )
    await expect(
      revertTurn(
        'http://localhost:4500',
        { documentId: 'doc', page: null, turnId: 't-1' },
        fetchImpl,
      ),
    ).rejects.toThrow(/no checkpoint for turn t-1/)
  })

  it('still throws when the refusal carried no readable body', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>gateway</html>', { status: 502 }))
    await expect(
      revertTurn(
        'http://localhost:4500',
        { documentId: 'doc', page: null, turnId: 't-1' },
        fetchImpl,
      ),
    ).rejects.toThrow(/502/)
  })
})
