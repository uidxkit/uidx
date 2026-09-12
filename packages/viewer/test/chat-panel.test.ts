import { useChat, type UseChatHelpers } from '@ai-sdk/vue'
import { mount } from '@vue/test-utils'
import type { UIMessage } from 'ai'
import { computed, nextTick, ref, type Ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ChatPanel from '../src/ChatPanel.vue'

/**
 * `useChat` only reaches the network once `sendMessage` runs, so a reply
 * carrying task-id or plan metadata can't be produced by mounting the panel
 * alone — that would need a real streamed turn. Stubbed at the same module
 * boundary the component calls through, same pattern `chat-panel-log.test.ts`
 * uses, so the rest of the component (props, template, styling) still runs
 * for real.
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
  const refs = helpers as unknown as { messages: Ref<UIMessage[]>; status: Ref<string> }
  return { clearError, sendMessage, stop, messages: refs.messages, status: refs.status }
}

// The pre-existing tests below (structural checks that never send a message)
// don't care what `useChat` returns, as long as it returns *something* shaped
// like the real hook — this default stands in for a freshly mounted panel
// with nothing sent yet, the same state the real hook would report. A test
// below that needs a particular reply calls `stubChat` again itself.
beforeEach(() => stubChat())

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

describe('ChatPanel', () => {
  it('offers a prompt box and a send button', () => {
    const panel = render()
    expect(panel.find('textarea').exists()).toBe(true)
    expect(panel.find('[aria-label="Send"]').exists()).toBe(true)
  })

  it('shows what the agent can see, so the user knows the context it has', () => {
    expect(render().text()).toContain('home.uidx')
    expect(render().text()).toContain('hero')
  })

  it('says nothing is selected rather than showing an empty slot', () => {
    expect(render({ selection: [] }).text()).toMatch(/nothing selected/i)
  })

  it('closes when the close button is pressed', async () => {
    const panel = render()
    await panel.find('[aria-label="Close chat"]').trigger('click')
    expect(panel.emitted('close')).toHaveLength(1)
  })

  it('keeps the send button out of reach while the prompt is empty', () => {
    expect(render().find('[aria-label="Send"]').attributes('disabled')).toBeDefined()
  })

  it('marks the message log as a live region so replies are announced as they stream in', () => {
    const log = render().find('.log')
    expect(log.attributes('role')).toBe('log')
    expect(log.attributes('aria-live')).toBe('polite')
  })
})

/**
 * A task too big for one turn needs its plan to land in the same file every
 * time, and the service can only do that if the panel sends back the task id
 * it was handed — so the panel holds onto the first reply's task id for the
 * rest of the conversation and resends it with every later message.
 */
describe('ChatPanel task id', () => {
  const reply = (taskId?: string): UIMessage => ({
    id: 'm1',
    role: 'assistant',
    parts: [{ type: 'text', text: 'done' }],
    ...(taskId === undefined ? {} : { metadata: { taskId } }),
  })

  const sentBody = (sendMessage: ReturnType<typeof vi.fn>): Record<string, unknown> =>
    (sendMessage.mock.calls[0]![1] as { body: Record<string, unknown> }).body

  it('sends no task id before any reply has supplied one', async () => {
    const { sendMessage } = stubChat({ messages: [] })
    const panel = render()
    await panel.find('textarea').setValue('hi')
    await panel.find('form').trigger('submit')

    expect(sentBody(sendMessage)).not.toHaveProperty('taskId')
  })

  it('sends the task id a reply carried, on the next message', async () => {
    const { sendMessage } = stubChat({ messages: [reply('task-1')] })
    const panel = render()
    await panel.find('textarea').setValue('keep going')
    await panel.find('form').trigger('submit')

    expect(sentBody(sendMessage).taskId).toBe('task-1')
  })
})

/**
 * A plan too big for one turn leaves work behind when the turn ends — the
 * service reports how many steps are still not `done`, and this is the
 * control that lets the designer ask for another turn on the same task
 * without retyping the request.
 */
describe('ChatPanel continue', () => {
  const reply = (metadata: Record<string, unknown>): UIMessage => ({
    id: 'm1',
    role: 'assistant',
    parts: [{ type: 'text', text: 'working on it' }],
    metadata,
  })

  it('offers no control when the message carries no plan', () => {
    stubChat({ messages: [reply({ taskId: 'task-1' })] })
    expect(render().find('[aria-label="Continue"]').exists()).toBe(false)
  })

  it('offers no control once the plan has nothing left', () => {
    stubChat({ messages: [reply({ taskId: 'task-1', planRemaining: 0 })] })
    expect(render().find('[aria-label="Continue"]').exists()).toBe(false)
  })

  it('offers no control on the user’s own message, even after a finished plan', () => {
    stubChat({
      messages: [
        reply({ taskId: 'task-1', planRemaining: 2 }),
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'thanks' }] },
      ],
    })
    expect(render().find('[aria-label="Continue"]').exists()).toBe(false)
  })

  it('offers a control while the latest reply reports steps left', () => {
    stubChat({ messages: [reply({ taskId: 'task-1', planRemaining: 2 })] })
    expect(render().find('[aria-label="Continue"]').exists()).toBe(true)
  })

  it('sends a follow-up turn carrying the same task id when pressed', async () => {
    const { sendMessage } = stubChat({ messages: [reply({ taskId: 'task-1', planRemaining: 1 })] })
    const panel = render()
    await panel.find('[aria-label="Continue"]').trigger('click')

    expect(sendMessage).toHaveBeenCalledTimes(1)
    const body = sendMessage.mock.calls[0]![1] as { body: Record<string, unknown> }
    expect(body.body.taskId).toBe('task-1')
  })
})

describe('turn-finished (spec §5)', () => {
  it('emits the turn id and the hashes the turn wrote when a reply completes', async () => {
    const reply = {
      id: 'm1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Done.' }],
      metadata: {
        turnId: 't1',
        written: [
          { file: 'p.uidx', sourceHash: 'h1' },
          { file: 'q.uidx', sourceHash: 'h2' },
        ],
      },
    } as unknown as UIMessage
    const { status } = stubChat({ messages: [reply], status: 'streaming' })
    const wrapper = render()
    status.value = 'ready'
    await nextTick()
    expect(wrapper.emitted('turn-finished')).toEqual([[{ turnId: 't1', written: ['h1', 'h2'] }]])
  })

  it('emits nothing when a reply ends without a turn id, or when status merely settles', async () => {
    const { status } = stubChat({ messages: [], status: 'ready' })
    const wrapper = render()
    status.value = 'ready'
    await nextTick()
    expect(wrapper.emitted('turn-finished')).toBeUndefined()
  })
})
