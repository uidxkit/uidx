import { tool, type Tool } from 'ai'
import { z } from 'zod'

import { escapeContextFence } from '../agent/fence.js'
import { FetchRefused, guardedFetch, readableText, type LookupImpl } from '../net/guarded-fetch.js'
import { stash, type ImageStash } from './view_image.js'

/**
 * The image types a model can actually read, by their content type. SVG is
 * deliberately absent — it is markup, arrives as text, and the text path
 * already handles it better than a vision channel would.
 */
const IMAGE_TYPES: Record<string, string> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
}

/** The biggest reference image passed through, as base64 characters — the same order of ceiling `view_image` keeps. */
const MAX_IMAGE_CHARS = 1_400_000

export interface FetchUrlDeps {
  /** The same ceiling one `read` gets: a page must not be able to swallow the window. */
  maxChars: number
  /** Whether the configured model can read an image at all. See `view_image.ts`. */
  vision?: boolean
  /** Where a fetched reference image waits for `imageDelivery` to place it. */
  stash?: ImageStash
  /** Injected so a test never reaches the network. */
  fetchImpl?: typeof fetch
  /**
   * Also injected, and for the same reason: the guard resolves the hostname
   * *before* it fetches, so stubbing `fetch` alone still leaves a live DNS
   * query in the middle of a unit test — which duly failed under parallel load
   * while passing alone.
   */
  lookupImpl?: LookupImpl
}

export function fetchUrlTools(deps: FetchUrlDeps): { fetch_url: Tool } {
  const fetch_url = tool({
    description:
      'Read a public web page as text, or fetch an image to look at. Use it for a specification you were given the address of — or for a reference picture of a real control, to study proportions before drawing your own.',
    inputSchema: z.object({
      url: z.string().describe('an http or https address — a page for words, an image for the eye'),
    }),
    execute: async ({ url }, { toolCallId }) => {
      let page
      try {
        page = await guardedFetch(url, {
          ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
          ...(deps.lookupImpl ? { lookupImpl: deps.lookupImpl } : {}),
        })
      } catch (error) {
        // A page that cannot be fetched is a refusal like any other: the model
        // can carry on without it, and the words say why so it does not simply
        // try the same address again.
        if (error instanceof FetchRefused) return `refused: ${error.message}`
        throw error
      }

      // An image goes to the eye, not the transcript. The failure this serves
      // was visual: a model wrote the correct anatomy of a switch in its own
      // annotation — thumb overlapping the track's edge — and then drew the
      // thumb dead centre, because it had never seen one in the whole flow.
      // A reference image beside its own render turns judgement from
      // taste-against-memory into comparison-against-reality.
      const mediaType = IMAGE_TYPES[page.contentType.split(';')[0]?.trim().toLowerCase() ?? '']
      if (mediaType) {
        if (!deps.vision) {
          return `refused: ${page.url} is an image, and this model cannot see images. Set UIDX_AGENT_VISION=true only for a model that can.`
        }
        if (page.truncated) {
          return `refused: ${page.url} is too large an image to pass through whole. Find a smaller copy.`
        }
        const encoded = Buffer.from(page.bytes).toString('base64')
        if (encoded.length > MAX_IMAGE_CHARS) {
          return `refused: ${page.url} is too large an image to pass through whole. Find a smaller copy.`
        }
        if (deps.stash) {
          // Pinned: a reference fetched at the start of a task must still be
          // in view when the drawing it was fetched for finally happens —
          // working screenshots must not evict it.
          stash(deps.stash, toolCallId, [
            {
              png: encoded,
              mediaType,
              pinned: true,
              note: `A reference image fetched from ${page.url} — study it, don't copy it: proportions, where parts sit, what touches what. It stays in view; compare your own work against it.`,
            },
          ])
        }
        return `${page.url} — the image follows this message. It is a reference to learn proportions from, not artwork to copy.`
      }

      const text = /html/i.test(page.contentType) ? readableText(page.body) : page.body.trim()
      if (text === '') return `refused: ${page.url} had nothing readable on it`

      // The pictures a page carries, listed so they can be fetched — because
      // `readableText` strips tags, a model reading a research page could
      // never discover its diagrams otherwise. Only formats the eye accepts;
      // an SVG is markup and belongs to the text path.
      const images: string[] = []
      if (/html/i.test(page.contentType) && deps.vision) {
        for (const match of page.body.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)) {
          const src = match[1]!
          if (src.startsWith('data:') || !/\.(png|jpe?g|webp|gif)(\?|$)/i.test(src)) continue
          const alt = /\balt="([^"]*)"/i.exec(match[0])?.[1] ?? ''
          try {
            const absolute = new URL(src, page.url).href
            images.push(`- ${absolute}${alt ? ` (${alt.slice(0, 80)})` : ''}`)
          } catch {
            // A src that is not a resolvable URL is not worth listing.
          }
          if (images.length >= 10) break
        }
      }
      const imageList =
        images.length > 0
          ? `\n\nImages on the page — fetch one with fetch_url to look at it:\n${images.join('\n')}`
          : ''

      // A fetched page is the least trustworthy text this harness handles —
      // more so than a design file, which at least belongs to the person
      // asking. It gets the same fence, for the stronger reason.
      const fenced = escapeContextFence(text)
      const head = `${page.url}\n\n`
      const room = deps.maxChars - head.length - imageList.length
      if (fenced.length <= room) return `${head}${fenced}${imageList}`
      return `${head}${fenced.slice(0, room)}\n\n(cut here — ${fenced.length - room} more characters on the page)${imageList}`
    },
  })

  return { fetch_url }
}
