import { tool, type Tool } from 'ai'
import { z } from 'zod'

import { escapeContextFence } from '../agent/fence.js'
import { badAliases } from '../edit/alias-types.js'
import { drawsNothing } from '../edit/draws-nothing.js'
import { missingGlyphs } from '../edit/missing-glyphs.js'
import { overflows } from '../edit/overflow.js'
import { fixedWithoutSize } from '../edit/sizing.js'
import { overlaps } from '../edit/overlaps.js'
import { tokenFacts } from '../edit/token-use.js'
import { RenderError, renderToPng } from '../render.js'
import type { Workspace } from '../workspace/workspace.js'
import { stash, type ImageStash, type Rendered } from './view_image.js'

export const NO_VISION =
  'refused: this model cannot see images, so it cannot review a page. Set UIDX_AGENT_VISION=true only for a model that can.'

/** Half size, the same as `view_image`: enough to judge a layout, not enough to read every word. */
const SCALE = 0.5

/** The biggest a rendered image may be, as base64 characters. */
const MAX_IMAGE_CHARS = 180_000

export interface ReviewDeps {
  workspace: Workspace
  vision: boolean
  stash?: ImageStash
  /**
   * What the page is meant to satisfy, when a skill with a checklist has been
   * loaded this turn — so the judgement is against a standard rather than
   * against taste alone.
   */
  requirements?: () => string | null
}

/**
 * Look at the page and say whether it is what it was meant to be.
 *
 * `view_image` already returns a picture, and it is not enough: measured on a
 * real run, Haiku 4.5 called it four times while building a page whose
 * sections were stacked on top of each other, and never once concluded that
 * anything was wrong. A picture invites a glance. A question demands a verdict.
 *
 * So this hands over three things at once — the rendering, the facts the
 * harness can compute about it, and the requirements it is working to — and
 * then asks a direct question. The model does the judging; the tool only makes
 * the moment where judging happens, and refuses to let it pass as a glance.
 */
export function reviewTools(deps: ReviewDeps): { review: Tool } {
  const review = tool({
    description:
      'Look at a page as the canvas draws it and judge whether it is what you intended. Call it after building a section, and before saying a step is done.',
    inputSchema: z.object({
      file: z.string().describe('page path, e.g. home.uidx'),
      address: z
        .string()
        .optional()
        .describe('what you just built, e.g. doc#states. Omit to judge the page alone.'),
      intent: z
        .string()
        .describe('what you were trying to build, in one sentence — what you will judge against'),
    }),
    execute: async ({ file, address, intent }, { toolCallId }) => {
      if (!deps.vision) return NO_VISION

      // Two pictures, and the second is the one that catches what a section
      // cannot show about itself. Every section Haiku built was right on its
      // own; the page they made together was unreadable.
      const shots: Rendered[] = []
      try {
        const docs = deps.workspace.docs()
        const shoot = async (target: string | undefined, caption: string): Promise<void> => {
          const render = async (scale: number): Promise<string> =>
            Buffer.from(
              await renderToPng({ docs, file, scale, ...(target ? { address: target } : {}) }),
            ).toString('base64')
          let png = await render(SCALE)
          if (png.length > MAX_IMAGE_CHARS) png = await render(SCALE / 2)
          if (png.length <= MAX_IMAGE_CHARS) shots.push({ png, note: caption })
        }
        if (address !== undefined) {
          await shoot(address, `${address} on its own, as the canvas draws it.`)
        }
        await shoot(undefined, `The whole of ${file}, so you can see where it sits.`)
      } catch (error) {
        if (error instanceof RenderError) return `refused: ${error.message}`
        throw error
      }
      if (shots.length === 0) {
        return `refused: ${file} renders too large to review. Review one section by giving its address.`
      }

      // Facts first, so the judgement starts from what is known rather than
      // from what the picture happens to suggest at half size.
      const doc = deps.workspace.docOf(file)
      const blank = doc ? drawsNothing(doc) : []
      const stacked = doc ? overlaps(doc) : []
      const spilling = doc ? overflows(doc) : []
      const contradicted = doc ? fixedWithoutSize(doc) : []
      const unglyphed = doc ? await missingGlyphs(doc) : []
      const facts: string[] = []
      if (blank.length > 0) facts.push(`- ${blank.join(', ')} draw nothing.`)
      // The render in this very review shows those nodes as blanks with no
      // reason; the fact names the reason.
      if (unglyphed.length > 0) {
        facts.push(
          `- ${unglyphed.map((m) => `${m.address} uses ${m.chars.join(' ')}`).join('; ')} — the bundled fonts have no glyph for these, so those texts draw as nothing. Substitute characters Inter covers.`,
        )
      }
      // A collapse the picture *does* show but reads as a style choice: a
      // ~370px column looks like a narrow design until the arithmetic says
      // its author asked for FIXED and never gave a size.
      if (contradicted.length > 0) {
        facts.push(
          `- ${contradicted.map((c) => `${c.address} says ${c.axis}="FIXED" but has no ${c.dimension}`).join('; ')} — the layout falls back to hugging and collapses.`,
        )
      }
      if (stacked.length > 0) {
        facts.push(
          `- ${stacked.map(([a, b]) => `${a} and ${b}`).join('; ')} have no position, so they draw from the same spot.`,
        )
      }
      // The one the picture cannot carry. A 144px spill in a 1440px page is a
      // soft edge at half scale, and twelve of them went unremarked across six
      // `review` calls in a real run — the model looked, and looking was not
      // enough. Stated as arithmetic, it is unmissable.
      if (spilling.length > 0) {
        facts.push(
          `- ${spilling.map((o) => `${o.address} is ${o.width} wide inside ${o.inner}`).join('; ')}, so they overflow their parents.`,
        )
      }
      // Fatal rather than untidy, so it leads. A token alias substituted into
      // `characters` stops the entire page rendering, and every other audit
      // reports clean over it.
      const misbound = doc ? badAliases([...deps.workspace.docs().values()], doc) : []
      if (misbound.length > 0) {
        facts.unshift(
          `- ${misbound.map((b) => `${b.address} binds ${b.target} into ${b.prop}, which is ${JSON.stringify(b.got)} and not text`).join('; ')} — this stops the whole page rendering.`,
        )
      }
      if (facts.length === 0)
        facts.push('- nothing empty, nothing unpositioned, nothing overflowing.')
      // Not a fault, so it sits below the faults and outside that summary: a
      // page is allowed to declare a scale before it binds one. It is here
      // because "the right tokens when needed" is a judgement, and this is the
      // only part of it a machine can hand over honestly.
      const tokens = doc ? tokenFacts([...deps.workspace.docs().values()], doc) : null
      if (tokens) facts.push(tokens)

      const requirements = deps.requirements?.()
      const note = [
        `${file}, as the canvas draws it. You said you were building: ${escapeContextFence(intent)}`,
        '',
        'What the harness can measure:',
        ...facts,
        ...(requirements
          ? ['', 'What it is meant to satisfy:', escapeContextFence(requirements)]
          : []),
        '',
        address === undefined
          ? 'Now look at the page and judge it. Answer these, specifically and by address:'
          : 'Two images follow: what you just built, then the whole page. Judge both — a section can be right on its own and wrong in the page. Answer specifically, by address:',
        '1. Does what you see match what you were building? Where does it not?',
        '2. Is anything overlapping, cut off, misaligned, or empty that should not be?',
        '3. Does it sit correctly in the page — spaced, aligned, inside its parent, and not on top of anything?',
        '4. Is anything missing that the requirements ask for?',
        // The judgement no rule could make. Two audits that tried to decide it
        // by arithmetic were measured and thrown away: a documentation page
        // draws a radius scale by writing each radius out literally, on
        // purpose, and nothing but intent separates that specimen from a
        // shortcut. So the count is handed over as a fact and the reading of it
        // is asked for here.
        '5. Where this page types a number that a declared token already names, should it bind the token instead?',
        // Only when references are actually in view — comparison beats prose
        // under no other condition. Measured: a model studied three real
        // switches, its own screenshots evicted them, and it drew a thumb
        // floating mid-track with an anatomy *name* literalised into a dot.
        ...(deps.stash && [...deps.stash.pending.values()].flat().some((image) => image.pinned)
          ? [
              '6. Put your render beside the reference images still in view: the same parts, drawn in the same layering, resting in the same places? Name every disagreement — the reference is how the real thing looks.',
            ]
          : []),
        '',
        'If it is right, say so plainly and move on. If it is not, fix it before marking any step done — a page that looks wrong is not finished, however much of it exists.',
      ].join('\n')

      if (deps.stash) stash(deps.stash, toolCallId, shots)
      const count = shots.length === 1 ? 'the image follows' : 'the images follow'
      return `${note}\n\n(${count} this message)`
    },
  })

  return { review }
}
