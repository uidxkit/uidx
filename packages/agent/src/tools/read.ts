import { resolve, resolveParent, type UidxDocument, type UidxNode } from '@uidx/format'
import { tool, type Tool } from 'ai'
import { z } from 'zod'

import type { StepBudget } from '../agent/step-budget.js'
import type { ContextBudget } from '../index/budget.js'
import { renderOutline, renderSignature } from '../index/outline.js'
import { describeNearest } from '../address.js'

interface ReadInput {
  file: string
  address?: string
  mode?: 'source' | 'outline' | 'signature'
  neighbourhood?: boolean
}

export interface ReadDeps {
  workspace: {
    docOf(file: string): UidxDocument | null
    sourceOf(file: string): string | null
    members(): readonly string[]
  }
  budget: ContextBudget
  /**
   * What this assistant step has already read. Absent outside a loop, where
   * there is no step to spend. See `StepBudget`.
   */
  stepBudget?: StepBudget
}

/**
 * Ancestors of `address`, outermost first — the page root itself is never
 * included (ADR 0003 §2: it carries no name worth showing, and every address
 * is implicitly within it). Walks `resolveParent` repeatedly: each call
 * answers "what contains this address", so re-feeding its own address back in
 * climbs one level at a time until the page root is reached.
 */
function ancestorChain(root: UidxNode, address: string): UidxNode[] {
  const chain: UidxNode[] = []
  let current = address
  for (;;) {
    const parent = resolveParent(root, current)
    if (!parent || parent === root) return chain
    chain.unshift(parent)
    current = parent.address
  }
}

/**
 * Fixed opening of every refusal `read` can return. Exported so a reader
 * elsewhere — `delegate.ts`'s worker-refusal detector — can recognise one
 * without re-typing the literal text: the same "author it once, import it at
 * the read site" shape `agent.ts` already uses for `SUMMARY_HEADER`, so the
 * two can never drift silently out of sync.
 */
export const REFUSED_PREFIX = 'refused:'
export const NO_SUCH_PAGE_PREFIX = 'no such page'
export const NO_NODE_AT_PREFIX = 'no node at'

/**
 * The one idiom for "this was too big to return whole" — used identically
 * whether the whole page or a single node was refused, so a model only ever
 * has to learn it once. `subject` is what didn't fit (`checkbox.uidx`, or
 * `Control/Checkbox on checkbox.uidx`); the caller appends the outline.
 */
function oversizeNotice(subject: string, length: number, readChars: number): string {
  return (
    `${REFUSED_PREFIX} ${subject} is ${length} characters, over the ${readChars}-character read limit — ` +
    `showing its outline instead. Pick an address from the "@address" on a line below and call ` +
    `read again with that address (add mode: 'outline' to descend further before reading source).`
  )
}

/**
 * The smallest outline worth returning. Below it the tree is truncated to
 * nothing useful, and a refusal that says so plainly beats one padded with a
 * fragment.
 */
const MIN_USEFUL_OUTLINE = 200

const MAX_HITS = 20
/**
 * Blunts catastrophic backtracking risk by bounding how much pattern text a
 * caller can hand to `new RegExp`. Not a guarantee — a short pattern can still
 * backtrack badly — just removes the easiest way to construct one.
 */
const MAX_REGEX_QUERY_LENGTH = 200

/** The deepest authored node containing `offset`, for locating a search hit. */
function enclosing(node: UidxNode, offset: number): UidxNode | null {
  if (offset < node.loc.start || offset >= node.loc.end) return null
  for (const child of node.children) {
    const deeper = enclosing(child, offset)
    if (deeper) return deeper
  }
  return node
}

function lineOf(source: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset; i += 1) if (source[i] === '\n') line += 1
  return line
}

export function readTools(deps: ReadDeps): { read: Tool; search: Tool } {
  const read = tool({
    description: 'Read the exact source of one node, or of a whole page.',
    inputSchema: z.object({
      file: z.string().describe('page path, e.g. home.uidx'),
      address: z
        .string()
        .optional()
        .describe(
          'node address, e.g. hero#headline; "#" bounds an entity, "/" walks deeper. ' +
            'Omit to target the page as a whole — mode and neighbourhood still apply.',
        ),
      mode: z
        .enum(['source', 'outline', 'signature'])
        .optional()
        .describe(
          "source (default) returns exact text; outline returns the subtree's shape without bodies; signature returns one line",
        ),
      neighbourhood: z
        .boolean()
        .optional()
        .describe('describe where this node sits: its ancestors and its immediate children'),
    }),
    execute: async ({ file, address, mode, neighbourhood }) => {
      // What this step may still pull in. `ai@7` runs one step's tool calls
      // under `Promise.all`, and `readChars` sizes one read — two together
      // measured ~27% over the window, which ends the turn on
      // `finishReason: length` with nothing in the loop saying why.
      const left = deps.stepBudget
        ? Math.max(0, deps.budget.readChars - deps.stepBudget.spent)
        : Number.POSITIVE_INFINITY
      if (left <= 0) {
        return `${REFUSED_PREFIX} this step has already read its fill. Read a smaller address, or ask again on your next step.`
      }
      const answer = await readAnswer({ file, address, mode, neighbourhood }, left)
      // Spent on every answer including a refusal: refusals are a line or two,
      // and charging for them keeps the accounting a single rule rather than a
      // rule with an exception nobody remembers.
      if (deps.stepBudget) deps.stepBudget.spent += answer.length
      return answer
    },
  })

  const readAnswer = async (
    { file, address, mode, neighbourhood }: ReadInput,
    left: number,
  ): Promise<string> => {
    const doc = deps.workspace.docOf(file)
    if (!doc) {
      return `${NO_SUCH_PAGE_PREFIX}: ${file}. Pages: ${deps.workspace.members().join(', ')}`
    }

    // `address === undefined` targets the page root itself — not the same
    // test as `!address`, which also (wrongly) swallows an explicit `''`,
    // the documented spelling for the page root (ADR 0003 §2). Both must
    // still let `mode` and `neighbourhood` run below, not short-circuit.
    const node = address === undefined ? doc.tree : resolve(doc.tree, address)
    if (!node) {
      return `${NO_NODE_AT_PREFIX} ${address} on ${file}${describeNearest(doc, address ?? '')}`
    }

    if (neighbourhood) {
      const ancestors = ancestorChain(doc.tree, node.address)
      const breadcrumb =
        node === doc.tree
          ? '(this is the page root — it has no ancestors)'
          : ancestors.length > 0
            ? ancestors.map((n) => renderSignature(n)).join('\n')
            : '(top-level — no ancestors below the page)'
      const children =
        node.children.length > 0
          ? node.children.map((c) => renderSignature(c)).join('\n')
          : '(no children)'
      return [
        `ancestors of ${node.address === '' ? '(page)' : node.address}, outermost first:`,
        breadcrumb,
        '',
        `this node, within its ancestors:`,
        renderSignature(node),
        '',
        'children:',
        children,
      ].join('\n')
    }

    if (mode === 'outline') {
      return renderOutline(doc, node, { maxChars: deps.budget.outlineChars })
    }
    if (mode === 'signature') {
      return renderSignature(node)
    }

    // Default `mode: 'source'`. The whole-page case reads `doc.source`
    // directly rather than `doc.source.slice(node.loc.start, node.loc.end)`
    // — the root node's own `.loc` covers just the `<Page>...</Page>`
    // element, not the frontmatter and Core Intent prose above it, and a
    // whole-page read has always meant the whole file.
    const source = node === doc.tree ? doc.source : doc.source.slice(node.loc.start, node.loc.end)
    // The tighter of the two caps: what one read may ever be, and what this
    // step has left to spend.
    const cap = Math.min(deps.budget.readChars, left)
    const subject = node === doc.tree ? file : `${node.address} on ${file}`

    // Too big for any single read: the long-standing answer, an outline
    // instead, so the call still teaches the shape of what was refused.
    if (source.length > deps.budget.readChars) {
      const notice = oversizeNotice(subject, source.length, deps.budget.readChars)
      // An outline squeezed into a nearly-spent *step* is noise — one
      // character of tree teaches nothing. The floor applies only when the
      // step's remainder is what is short: a deliberately small
      // `outlineChars` is a configured answer and is honoured as given.
      if (left < MIN_USEFUL_OUTLINE) {
        return `${notice} This step has too little left to outline it either — ask again on your next step.`
      }
      return `${notice}\n\n${renderOutline(doc, node, { maxChars: Math.min(deps.budget.outlineChars, left) })}`
    }

    // Small enough to read, but not out of what this step has left. No
    // outline: the node fits, so the answer is simply "not now".
    if (source.length > cap) {
      return `${REFUSED_PREFIX} ${subject} is ${source.length} characters and this step has ${cap} left. Read a smaller address, or ask again on your next step.`
    }
    return source
  }

  const search = tool({
    description: 'Search every page for text. Returns addresses, not whole files.',
    inputSchema: z.object({
      query: z.string().min(1),
      regex: z.boolean().optional().describe('treat the query as a regular expression'),
      limit: z.number().int().min(1).max(MAX_HITS).optional(),
    }),
    execute: async ({ query, regex, limit }) => {
      // Defense in depth: the schema's min(1) stops a well-formed caller, but
      // `execute` is reachable directly (tests call it without zod parsing the
      // input, and nothing guarantees every future caller validates first). A
      // literal empty query never advances `indexOf`, so without this guard
      // the scan below runs forever.
      if (query.length === 0) return 'query must not be empty'

      const cap = limit ?? MAX_HITS

      let matcher: RegExp | null = null
      if (regex) {
        if (query.length > MAX_REGEX_QUERY_LENGTH) {
          return `regex query too long: ${query.length} characters (max ${MAX_REGEX_QUERY_LENGTH})`
        }
        try {
          matcher = new RegExp(query, 'g')
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return `invalid regex: ${message}`
        }
      }

      const hits: string[] = []

      for (const file of deps.workspace.members()) {
        const doc = deps.workspace.docOf(file)
        const source = deps.workspace.sourceOf(file)
        if (!doc || !source) continue

        const offsets: number[] = []
        if (matcher) {
          matcher.lastIndex = 0
          for (const match of source.matchAll(matcher)) {
            if (match.index !== undefined) offsets.push(match.index)
          }
        } else {
          let at = source.indexOf(query)
          while (at !== -1) {
            offsets.push(at)
            at = source.indexOf(query, at + query.length)
          }
        }

        for (const offset of offsets) {
          if (hits.length >= cap) break
          const node = enclosing(doc.tree, offset)
          const line = lineOf(source, offset)
          const address = node?.address === '' ? '(page)' : (node?.address ?? '(page)')
          const text = source.slice(offset, offset + 80).split('\n')[0] ?? ''
          hits.push(`${file}:${line} ${address} — ${text.trim()}`)
        }
      }

      if (hits.length === 0) return `no matches for ${query}`
      const more = hits.length >= cap ? `\n(stopped at ${cap} hits)` : ''
      return hits.join('\n') + more
    },
  })

  return { read, search }
}
