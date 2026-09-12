import { useChat, type UseChatHelpers } from '@ai-sdk/vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { UIMessage } from 'ai'
import { computed, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ChatPanel from '../src/ChatPanel.vue'

/**
 * `useChat` only reaches the network once `sendMessage` runs, so a message
 * carrying an exotic part type, or a live error, can't be produced by
 * mounting the panel alone — that would need a real streamed turn, which is
 * out of scope for this component's tests. These cases stub `useChat` at the
 * same module boundary the component calls through, so the rest of the
 * component (props, template, styling) still runs for real.
 */
vi.mock('@ai-sdk/vue', () => ({ useChat: vi.fn() }))

function stubChat(
  overrides: {
    messages?: UIMessage[]
    status?: 'submitted' | 'streaming' | 'ready' | 'error'
    error?: Error
  } = {},
) {
  const clearError = vi.fn()
  const sendMessage = vi.fn()
  const stop = vi.fn()
  const helpers = {
    id: computed(() => 'chat'),
    messages: ref(overrides.messages ?? []),
    status: ref(overrides.status ?? 'ready'),
    error: ref(overrides.error),
    sendMessage,
    stop,
    clearError,
    regenerate: vi.fn(),
    resumeStream: vi.fn(),
    addToolOutput: vi.fn(),
    addToolApprovalResponse: vi.fn(),
  } as unknown as UseChatHelpers<UIMessage>
  vi.mocked(useChat).mockReturnValue(helpers)
  return { clearError, sendMessage, stop }
}

const render = (props: Record<string, unknown> = {}) =>
  mount(ChatPanel, {
    props: {
      documentId: 'doc',
      page: 'home.uidx',
      selection: ['hero'],
      url: 'http://localhost:4500',
      ...props,
    },
  })

describe('ChatPanel message parts', () => {
  it('renders a fallback row for a message part that is neither text nor a tool call', () => {
    stubChat({
      messages: [{ id: 'm1', role: 'assistant', parts: [{ type: 'step-start' }] }],
    })
    const panel = render()
    const rows = panel.findAll('.tool').filter((row) => row.text() === 'step-start')
    expect(rows).toHaveLength(1)
  })
})

describe('ChatPanel error handling', () => {
  it('says nothing about a dismiss control when there is no error', () => {
    stubChat()
    expect(render().find('[aria-label="Dismiss error"]').exists()).toBe(false)
  })

  it('offers a control to dismiss the error once one appears', () => {
    stubChat({ error: new Error('the agent service is unreachable') })
    expect(render().find('[aria-label="Dismiss error"]').exists()).toBe(true)
  })

  it('clears the error when the dismiss control is pressed', async () => {
    const { clearError } = stubChat({ error: new Error('boom') })
    const panel = render()
    await panel.find('[aria-label="Dismiss error"]').trigger('click')
    expect(clearError).toHaveBeenCalledTimes(1)
  })
})

/**
 * uidx has no document-level undo under the harness, so the per-turn
 * checkpoint is the whole undo story — and the service has been stamping every
 * assistant message with the turn id it checkpointed under since the route was
 * written. Nothing in the panel offered it, so the story had no trigger a
 * designer could reach.
 */
describe('ChatPanel revert', () => {
  const reply = (turnId?: string): UIMessage => ({
    id: 'm1',
    role: 'assistant',
    parts: [{ type: 'text', text: 'done' }],
    ...(turnId === undefined ? {} : { metadata: { turnId } }),
  })

  const stubFetch = (response: Partial<Response> & { json?: () => Promise<unknown> }) => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, files: ['home.uidx'] }),
      ...response,
    })
    vi.stubGlobal('fetch', fetchImpl)
    return fetchImpl
  }

  afterEach(() => vi.unstubAllGlobals())

  it('offers no control on a message that carries no turn', () => {
    stubChat({ messages: [reply()] })
    expect(render().find('[aria-label="Revert this turn"]').exists()).toBe(false)
  })

  it('offers no control on the user own message', () => {
    stubChat({
      messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    })
    expect(render().find('[aria-label="Revert this turn"]').exists()).toBe(false)
  })

  it('offers one on each reply that names the turn it came out of', () => {
    stubChat({
      messages: [
        { ...reply('turn-a'), id: 'm1' },
        { ...reply('turn-b'), id: 'm2' },
      ],
    })
    expect(render().findAll('[aria-label="Revert this turn"]')).toHaveLength(2)
  })

  it('asks the service to undo that turn, with the document and page it belongs to', async () => {
    stubChat({ messages: [reply('turn-a')] })
    const fetchImpl = stubFetch({})

    const panel = render()
    await panel.find('[aria-label="Revert this turn"]').trigger('click')
    await flushPromises()

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('http://localhost:4500/revert')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      turnId: 'turn-a',
      documentId: 'doc',
      page: 'home.uidx',
    })
  })

  it('says so when the revert failed, rather than leaving the change looking undone', async () => {
    stubChat({ messages: [reply('turn-a')] })
    stubFetch({
      ok: false,
      status: 404,
      json: async () => ({ error: 'no checkpoint for turn turn-a' }),
    })

    const panel = render()
    await panel.find('[aria-label="Revert this turn"]').trigger('click')
    await flushPromises()

    expect(panel.text()).toContain('no checkpoint for turn turn-a')
    expect(panel.find('[aria-label="Dismiss revert error"]').exists()).toBe(true)
  })

  it('says nothing about a failure that did not happen', async () => {
    stubChat({ messages: [reply('turn-a')] })
    stubFetch({})

    const panel = render()
    await panel.find('[aria-label="Revert this turn"]').trigger('click')
    await flushPromises()

    expect(panel.find('[aria-label="Dismiss revert error"]').exists()).toBe(false)
  })

  it('reports a service that is unreachable at all', async () => {
    stubChat({ messages: [reply('turn-a')] })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('the agent service is unreachable')))

    const panel = render()
    await panel.find('[aria-label="Revert this turn"]').trigger('click')
    await flushPromises()

    expect(panel.text()).toContain('the agent service is unreachable')
  })
})

/**
 * The panel's answer to "is it still going?". A local model thinks for minutes
 * with nothing to stream, so a log that has gone quiet is not evidence of
 * anything — these assert the panel says what it is doing and keeps counting.
 */
describe('the working indicator', () => {
  const toolPart = (name: string, state: string, input: Record<string, unknown>) =>
    ({ type: `tool-${name}`, toolCallId: 'c1', state, input }) as unknown as UIMessage['parts'][0]

  const working = (parts: UIMessage['parts']): UIMessage => ({
    id: 'a1',
    role: 'assistant',
    parts,
  })

  it('says nothing at all when no turn is running', () => {
    stubChat({ status: 'ready' })
    expect(render().find('.working').exists()).toBe(false)
  })

  it('says it is thinking before the first token arrives', () => {
    stubChat({ status: 'submitted' })
    expect(render().find('.working').text()).toContain('Thinking…')
  })

  it('names the tool and what it is pointed at', () => {
    stubChat({
      status: 'streaming',
      messages: [working([toolPart('read', 'input-available', { file: 'examples/card.uidx' })])],
    })
    expect(render().find('.working').text()).toContain('Reading examples/card.uidx…')
  })

  it('reads a partial input mid-stream without inventing a filename', () => {
    stubChat({
      status: 'streaming',
      messages: [working([toolPart('edit', 'input-streaming', {})])],
    })
    expect(render().find('.working').text()).toContain('Editing…')
  })

  // The distinction that keeps the line honest: a finished tool call is not
  // what the agent is doing now.
  it('stops naming a tool whose output has already come back', () => {
    stubChat({
      status: 'streaming',
      messages: [working([toolPart('read', 'output-available', { file: 'a.uidx' })])],
    })
    const text = render().find('.working').text()
    expect(text).toContain('Thinking…')
    expect(text).not.toContain('Reading')
  })

  it('says it is writing once text starts arriving', () => {
    stubChat({
      status: 'streaming',
      messages: [
        working([
          toolPart('read', 'output-available', { file: 'a.uidx' }),
          { type: 'text', text: 'The page' } as UIMessage['parts'][0],
        ]),
      ],
    })
    expect(render().find('.working').text()).toContain('Writing…')
  })

  it('names an unfamiliar tool rather than falling silent about it', () => {
    stubChat({
      status: 'streaming',
      messages: [working([toolPart('view_image', 'input-available', {})])],
    })
    expect(render().find('.working').text()).toContain('Running view_image…')
  })

  it('counts the seconds, and starts over on the next turn', async () => {
    vi.useFakeTimers()
    try {
      stubChat({ status: 'submitted' })
      const panel = render()
      // The watcher starts the clock, so the first tick needs a flush first.
      await flushPromises()
      expect(panel.find('.elapsed').text()).toBe('0s')

      await vi.advanceTimersByTimeAsync(75_000)
      expect(panel.find('.elapsed').text()).toBe('1m 15s')
    } finally {
      vi.useRealTimers()
    }
  })
})
