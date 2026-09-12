import { describe, expect, it } from 'vitest'

import { anthropicCaching } from '../src/agent/cache-middleware.js'

/** Named through the middleware's own signature rather than imported from `@ai-sdk/provider` — same boundary argument as the image middleware's test. */
type Middleware = NonNullable<ReturnType<typeof anthropicCaching>['transformParams']>
type Params = Parameters<Middleware>[0]['params']
type Prompt = Params['prompt']

const PROMPT: Prompt = [
  { role: 'system', content: 'you are a harness' },
  { role: 'user', content: [{ type: 'text', text: 'build a page' }] },
  {
    role: 'assistant',
    content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'edit', input: {} }],
  },
  {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'c1',
        toolName: 'edit',
        output: { type: 'text', value: 'applied' },
      },
    ],
  },
]

const transform = async (prompt: Prompt) => {
  const middleware = anthropicCaching()
  const out = await middleware.transformParams!({
    params: { prompt } as never,
    type: 'stream',
    model: {} as never,
  })
  return out.prompt
}

/**
 * A tool loop's step N prompt is byte-for-byte step N-1's plus one exchange —
 * the perfect cache shape. Measured before this existed: ~105 requests per
 * page, each re-sending the whole history at full input price, with the flag
 * that would have made the prefix cost one tenth simply never set.
 */
describe('anthropicCaching', () => {
  it('stamps the system message and the last message, nothing else', async () => {
    const prompt = await transform(PROMPT)
    const marked = prompt.map(
      (message) =>
        (message.providerOptions as { anthropic?: { cacheControl?: unknown } } | undefined)
          ?.anthropic?.cacheControl !== undefined,
    )
    expect(marked).toEqual([true, false, false, true])
  })

  it('marks with the ephemeral type Anthropic expects', async () => {
    const prompt = await transform(PROMPT)
    expect(
      (prompt[3]!.providerOptions as { anthropic: { cacheControl: { type: string } } }).anthropic
        .cacheControl,
    ).toEqual({ type: 'ephemeral' })
  })

  // This middleware owns one key in the anthropic namespace; a message
  // already carrying others must keep them.
  it('keeps provider options a message already carries', async () => {
    const carrying: Prompt = [
      { role: 'system', content: 's', providerOptions: { anthropic: { other: 1 } } },
    ]
    const prompt = await transform(carrying)
    const options = prompt[0]!.providerOptions as { anthropic: Record<string, unknown> }
    expect(options.anthropic.other).toBe(1)
    expect(options.anthropic.cacheControl).toEqual({ type: 'ephemeral' })
  })

  it('touches nothing when the prompt is empty', async () => {
    expect(await transform([])).toEqual([])
  })
})
