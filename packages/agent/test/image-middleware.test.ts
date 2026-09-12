import { describe, expect, it } from 'vitest'

import { imageDelivery } from '../src/agent/image-middleware.js'
import { createImageStash } from '../src/tools/view_image.js'

/**
 * The provider-level prompt, named through the middleware's own signature
 * rather than imported from `@ai-sdk/provider` — that package is a transitive
 * dependency here, not a declared one, and a test must not be the only thing
 * reaching past the package boundary.
 */
type Middleware = NonNullable<ReturnType<typeof imageDelivery>['transformParams']>
type Params = Parameters<Middleware>[0]['params']
type Prompt = Params['prompt']

const afterAViewCall = (): Prompt => [
  { role: 'user', content: [{ type: 'text', text: 'look at the card' }] },
  {
    role: 'assistant',
    content: [
      { type: 'tool-call', toolCallId: 'v1', toolName: 'view_image', input: '{"file":"a.uidx"}' },
    ],
  },
  {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'v1',
        toolName: 'view_image',
        output: { type: 'text', value: 'a.uidx. The image follows this message.' },
      },
    ],
  },
]

const transform = async (stash: ReturnType<typeof createImageStash>) => {
  const middleware = imageDelivery(stash)
  const params = { prompt: afterAViewCall() } as Params
  const out = await middleware.transformParams!({ type: 'generate', params, model: {} as never })
  return out.prompt
}

/**
 * The measured failure this exists for: an image returned from the tool itself
 * is serialised into the `tool` message's string body, and the model receives
 * base64 as literature. The same bytes in a `user` message are read correctly.
 */
describe('imageDelivery', () => {
  it('puts the picture in a user message straight after the tool result', async () => {
    const stash = createImageStash()
    stash.pending.set('v1', [{ png: 'aGVsbG8=', note: 'a.uidx, as the canvas draws it' }])

    const prompt = await transform(stash)

    expect(prompt).toHaveLength(4)
    const delivered = prompt[3]!
    expect(delivered.role).toBe('user')
    expect(delivered.content).toEqual([
      { type: 'text', text: 'a.uidx, as the canvas draws it' },
      { type: 'file', data: { type: 'data', data: 'aGVsbG8=' }, mediaType: 'image/png' },
    ])
  })

  // Not consumed on delivery: the tool result stays in history across later
  // steps, and a picture that vanished from under it would leave the model
  // reasoning about something it can no longer see.
  it('keeps delivering across calls rather than spending the picture once', async () => {
    const stash = createImageStash()
    stash.pending.set('v1', [{ png: 'aGVsbG8=', note: 'n' }])
    await transform(stash)
    const second = await transform(stash)
    expect(second).toHaveLength(4)
  })

  it('leaves the prompt untouched when nothing is waiting', async () => {
    const prompt = await transform(createImageStash())
    expect(prompt).toHaveLength(3)
  })

  it('ignores a picture whose tool call is no longer in the history', async () => {
    const stash = createImageStash()
    stash.pending.set('gone', [{ png: 'aGVsbG8=', note: 'n' }])
    expect(await transform(stash)).toHaveLength(3)
  })
})
