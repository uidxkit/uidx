import { resolve, resolveParent, type UidxDocument, type UidxNode } from '@uidx/format'

import { renderDocMap } from './doc-map.js'
import { renderSignature } from './outline.js'
import type { DocumentIndex } from './types.js'

export interface MissionFocus {
  /** Workspace-relative path of the page the user is looking at. */
  file: string | null
  /** Addresses of the selected nodes. */
  selection: readonly string[]
}

export interface ContextPack {
  text: string
  /** Files whose source this pack quoted. */
  files: string[]
}

const DEFAULT_MAX_CHARS = 12_000
const TRUNCATION_MARKER = '\n… (node source truncated)'

/**
 * Enough of the page's own words to tell it apart from a page with a similar
 * name, and not enough to be worth reading instead of the file.
 */
const INTENT_CHARS = 220

/**
 * The page's opening paragraph, rewrapped onto one line.
 *
 * The current page used to reach the model as one bare `address <element>`
 * line while every *other* component in the document got a full signature in
 * the doc map. Asked about `bound-card.uidx` — whose whole content is one
 * `Card/Basic <Component>` — a model answered about `Card`, from `card.uidx`,
 * which was the richest thing in front of it. The page a designer is looking
 * at has to be the best-described thing in the pack, not the thinnest.
 */
function intentSummary(doc: UidxDocument): string | null {
  const paragraph: string[] = []
  for (const line of doc.intent.raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#')) continue
    if (trimmed === '') {
      if (paragraph.length > 0) break
      continue
    }
    paragraph.push(trimmed)
  }
  const text = paragraph.join(' ')
  if (text === '') return null
  return text.length > INTENT_CHARS ? `${text.slice(0, INTENT_CHARS)}…` : text
}

function sourceOf(doc: UidxDocument, node: UidxNode): string {
  return doc.source.slice(node.loc.start, node.loc.end)
}

/**
 * Outermost-first chain of ancestors strictly between the page root and
 * `address`. The page root is never included — "within the page" is not
 * information a small model needs spelled out.
 */
function ancestorChain(doc: UidxDocument, address: string): UidxNode[] {
  const chain: UidxNode[] = []
  let current = address
  for (;;) {
    const parent = resolveParent(doc.tree, current)
    if (!parent || parent.address === '') break
    chain.unshift(parent)
    current = parent.address
  }
  return chain
}

function breadcrumb(chain: readonly UidxNode[]): string {
  return chain.map((n) => `${n.address} <${n.element}>`).join(' > ')
}

/**
 * Ranking is deterministic graph proximity, not similarity: the selection, then
 * the page it lives on, then the definitions it depends on. Everything else the
 * model can fetch with `read` when it decides it needs to.
 */
export function packContext(
  index: DocumentIndex,
  docs: ReadonlyMap<string, UidxDocument>,
  focus: MissionFocus,
  options: { maxChars?: number } = {},
): ContextPack {
  const max = options.maxChars ?? DEFAULT_MAX_CHARS
  const blocks: string[] = []
  const files = new Set<string>()

  const doc = focus.file ? (docs.get(focus.file) ?? null) : null

  if (focus.file && !doc) {
    // The caller asked about a page that is not (or no longer) loaded. Saying
    // "nothing selected" here would be a false statement in both halves: a
    // selection was requested, and it was silently dropped.
    blocks.push(
      `SELECTED\n  (${focus.file} is not loaded — its content is unavailable; ` +
        `use read to fetch it before selecting inside it)`,
    )
  } else if (doc && focus.selection.length > 0) {
    // The selected node's source is the single most valuable thing in the
    // pack, but a subtree can be arbitrarily large — it must never be allowed
    // to push the doc map (below) out of the budget entirely, so it gets a
    // hard cap of its own rather than relying on the final catch-all slice.
    const selectedBudget = Math.floor(max / 2)
    let remaining = selectedBudget
    const quoted: string[] = []

    const appendEntry = (header: string, body: string): boolean => {
      if (remaining <= 0) return false
      const full = `${header}${body}`
      if (full.length <= remaining) {
        quoted.push(full)
        remaining -= full.length
        return true
      }
      const bodyBudget = remaining - header.length - TRUNCATION_MARKER.length
      if (bodyBudget <= 0) {
        remaining = 0
        return false
      }
      quoted.push(`${header}${body.slice(0, bodyBudget)}${TRUNCATION_MARKER}`)
      remaining = 0
      return true
    }

    for (const address of focus.selection) {
      const node = resolve(doc.tree, address)
      if (!node) continue

      const chain = ancestorChain(doc, address)
      const within = chain.length > 0 ? `\n  within: ${breadcrumb(chain)}` : ''
      const header = `${address} <${node.element}>${within}\n`
      if (!appendEntry(header, sourceOf(doc, node))) break

      // A component definition the selection points at is the next thing the
      // model will need, and it usually lives on another page.
      const component = node.attrs.component?.value
      if (typeof component === 'string') {
        const entry = index.components.get(component)
        const definition = entry ? docs.get(entry.file) : undefined
        if (entry && definition) {
          const defNode = resolve(definition.tree, entry.address)
          if (defNode) {
            const defHeader = `definition of ${component} (${entry.file})\n`
            if (appendEntry(defHeader, sourceOf(definition, defNode))) {
              files.add(entry.file)
            } else {
              break
            }
          }
        }
      }
    }
    if (quoted.length > 0) {
      files.add(focus.file!)
      blocks.push(`SELECTED\n${quoted.join('\n\n')}`)
    }
  } else if (doc && focus.file) {
    blocks.push('SELECTED\n  (nothing selected — the user is looking at the whole page)')
  }

  if (doc && focus.file) {
    files.add(focus.file)
    // A `<Component>` on a page is a definition by grammar — it cannot sit
    // anywhere else — and saying so is the difference between "this page
    // defines Card/Basic" and the answer a model actually gave: "this page
    // contains a draft instance of Card/Basic". The page holds no instance
    // at all.
    const intent = intentSummary(doc)
    const skeleton = doc.tree.children
      .map((node) => `  ${node.element === 'Component' ? 'defines ' : ''}${renderSignature(node)}`)
      .join('\n')
    blocks.push(
      [
        `CURRENT PAGE ${focus.file}`,
        ...(intent ? [`  intent: ${intent}`] : []),
        skeleton || '  (empty)',
      ].join('\n'),
    )
  }

  blocks.push(renderDocMap(index, { maxChars: Math.floor(max / 2), currentFile: focus.file }))

  let text = blocks.join('\n\n')
  if (text.length > max) text = `${text.slice(0, max)}\n(context truncated)`

  return { text, files: [...files].sort() }
}
