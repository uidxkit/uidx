import { tool, type Tool } from 'ai'
import { z } from 'zod'

import { RenderError, renderToPng } from '../render.js'
import type { Workspace } from '../workspace/workspace.js'

export const NO_VISION =
  'refused: this model cannot see images. Set UIDX_AGENT_VISION=true only for a model that can.'

/**
 * What a returned image is scaled to.
 *
 * An image is spent from the same window a `read` is, so it has to be worth its
 * place. Halved, a documentation page is still legible enough to answer "is
 * this laid out right", which is the question this tool exists for. "What does
 * this say" is `read`'s question, and `read` answers it exactly.
 */
const SCALE = 0.5

/**
 * The biggest a rendered image may be, as base64 characters.
 *
 * An image is spent from the same window a `read` is, and a full documentation
 * page at full size is worth more than the whole budget. When the first render
 * overruns this, the tool halves the scale once and tries again; still over, it
 * refuses and says to ask for one node instead — the same teaching refusal
 * everything else here gives.
 */
const MAX_IMAGE_CHARS = 180_000

/**
 * Pictures waiting to be handed to the model, keyed by the tool call that
 * produced them.
 *
 * They cannot ride back on the tool result itself. The OpenAI chat protocol
 * gives a `tool` message a *string* body, so an image part put there is
 * serialised into JSON text — measured on the wire, the model received a
 * base64 blob as literature and reported, reasonably, that it could see
 * nothing. The same bytes in a `user` message are read correctly by the same
 * model. So the tool returns words, and `imageDelivery` — model middleware —
 * places the picture in a user message on the way out. See its own comment for
 * why that rather than `prepareStep`.
 */
export interface Rendered {
  png: string
  note: string
  /** How the bytes are encoded — `image/png` when absent, which every render is. A fetched reference may be a JPEG or WebP instead. */
  mediaType?: string
  /**
   * A reference that must survive working screenshots. Measured without it: a
   * model fetched three real switches, studied them — and by the time it drew
   * its own, every reference had been evicted by its own `review` shots, so it
   * drew from prose again, thumb floating mid-track, an anatomy *name*
   * literalised into a visible dot. Comparison only beats prose while both
   * pictures are actually in view.
   */
  pinned?: boolean
}

export interface ImageStash {
  /**
   * Pictures per tool call — a list, because one `review` hands over two: the
   * thing just built, and the whole page it now sits in. A section can be
   * right on its own and wrong in the page, which is exactly the failure that
   * prompted this: every one of Haiku's sections was fine alone and the page
   * was unreadable.
   */
  pending: Map<string, Rendered[]>
}

export const createImageStash = (): ImageStash => ({ pending: new Map() })

/**
 * How many pictures stay deliverable at once. Each is re-sent on every request
 * whose history still holds the tool result it belongs to, so an unbounded
 * stash would keep re-paying for every page the turn ever looked at. Two is
 * "the one I just drew, and the one I am comparing it against".
 */
const MAX_PENDING = 2
/** Pinned references get their own allowance — three is a study set, not a gallery. */
const MAX_PINNED = 3

/**
 * Records a call's pictures. Working shots evict the oldest working shots
 * once past their cap; pinned references evict only each other, so a study
 * set fetched at the start of a task is still in view when the drawing it was
 * fetched for finally happens.
 */
export function stash(into: ImageStash, toolCallId: string, images: Rendered[]): void {
  into.pending.set(toolCallId, images)
  const isPinned = (id: string) => into.pending.get(id)!.some((image) => image.pinned)
  const evictOldest = (pinned: boolean, cap: number) => {
    const keys = [...into.pending.keys()].filter((id) => isPinned(id) === pinned)
    while (keys.length > cap) into.pending.delete(keys.shift()!)
  }
  evictOldest(false, MAX_PENDING)
  evictOldest(true, MAX_PINNED)
}

export interface ViewImageDeps {
  workspace: Workspace
  /** Whether the configured model can read an image at all. */
  vision: boolean
  /** Where a rendered picture waits for `imageDelivery` to place it. */
  stash?: ImageStash
}

export function viewImageTools(deps: ViewImageDeps): { view_image: Tool } {
  const view_image = tool({
    description:
      'Look at a page, or one node of it, as an image drawn the way the canvas draws it. Use it to check a layout you just built.',
    inputSchema: z.object({
      file: z.string().describe('page path, e.g. home.uidx'),
      address: z
        .string()
        .optional()
        .describe('node address, e.g. hero#headline. Omit for the whole page.'),
    }),
    execute: async ({ file, address }, { toolCallId }): Promise<string> => {
      if (!deps.vision) return NO_VISION
      const what = address === undefined ? file : `${address} on ${file}`
      try {
        const docs = deps.workspace.docs()
        const render = async (scale: number): Promise<string> =>
          Buffer.from(
            await renderToPng({ docs, file, scale, ...(address === undefined ? {} : { address }) }),
          ).toString('base64')

        let png = await render(SCALE)
        if (png.length > MAX_IMAGE_CHARS) png = await render(SCALE / 2)
        if (png.length > MAX_IMAGE_CHARS) {
          return `refused: ${what} is too large to look at whole. Ask for one node's address instead.`
        }

        const note = `${what}, as the canvas draws it`
        if (deps.stash) stash(deps.stash, toolCallId, [{ png, note }])
        return `${note}. The image follows this message.`
      } catch (error) {
        // A render that cannot happen is a refusal like any other, and the
        // model has to be able to act on it — so `render.ts`'s own words go
        // through unchanged rather than being flattened into "an error
        // occurred". Anything that is not a RenderError is a real fault and
        // belongs to the turn, not to the model.
        if (error instanceof RenderError) return `refused: ${error.message}`
        throw error
      }
    },
  })

  return { view_image }
}
