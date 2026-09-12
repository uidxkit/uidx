import type { LanguageModelMiddleware } from 'ai'

import type { ImageStash } from '../tools/view_image.js'

/**
 * Puts every rendered picture into the request as a user message.
 *
 * `view_image` cannot return one on its own. A `tool` message carries a
 * *string* in the OpenAI protocol, so an image part placed there is serialised
 * into JSON text — measured on the wire against qwen3.5, which received a
 * base64 blob as literature and reported, reasonably, that it could see
 * nothing at all. The identical bytes in a `user` message were read correctly
 * by the same model, naming both lines of text and their colours.
 *
 * This runs as model middleware rather than in `prepareStep` because
 * `prepareStep`'s `messages` override seeds *later* steps and does not touch
 * the request being assembled — measured too: a turn that called `view_image`
 * and then answered in the same step sent no image at all. `transformParams`
 * sees the final prompt for every call, which is the only place that is always
 * true.
 *
 * The stash entry is deliberately *not* consumed. The tool result stays in
 * history across later steps, and a picture that vanished from under it would
 * leave the model reasoning about something it can no longer see. It stops
 * being sent when compaction drops the tool result that anchors it, or when
 * `view_image` evicts it for a newer one.
 */
export function imageDelivery(stash: ImageStash): LanguageModelMiddleware {
  return {
    transformParams: async ({ params }) => {
      if (stash.pending.size === 0) return params

      const prompt: typeof params.prompt = []
      for (const message of params.prompt) {
        prompt.push(message)
        if (message.role !== 'tool') continue
        for (const part of message.content) {
          if (part.type !== 'tool-result') continue
          const waiting = stash.pending.get(part.toolCallId)
          if (!waiting) continue
          // One message per picture, each with its own words, so "the section"
          // and "the whole page" arrive as two things to compare rather than
          // one blur.
          for (const image of waiting) {
            prompt.push({
              role: 'user',
              content: [
                { type: 'text', text: image.note },
                {
                  type: 'file',
                  data: { type: 'data', data: image.png },
                  mediaType: image.mediaType ?? 'image/png',
                },
              ],
            })
          }
        }
      }
      return { ...params, prompt }
    },
  }
}
