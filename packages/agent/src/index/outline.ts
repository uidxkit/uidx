import type { UidxDocument, UidxNode } from '@uidx/format'

export interface OutlineOptions {
  maxChars?: number
  maxDepth?: number
}

const DEFAULT_MAX_CHARS = 4000

/**
 * Admission is breadth-first (see renderOutline), so — unlike the old
 * depth-first walk — a shallow sibling can never be starved by an earlier
 * sibling's deep subtree; the char budget is what decides how deep any
 * given call actually reaches, and maxDepth is only a ceiling on top of
 * that. Swept against `examples/checkbox.uidx` at the default 16,384-token
 * window (outlineChars = 10,158, real tree depth 9): maxDepth 4 through 12
 * all produce the byte-for-byte identical 10,079-char outline with all
 * 12/12 top-level sections and 558 nodes correctly reported omitted — the
 * budget is the only thing binding once the ceiling is generous enough.
 * maxDepth=3 is measurably worse (9,329 chars, ~8% of the budget left
 * unused, because the walk hits the ceiling with room to spare rather than
 * the budget). 8 sits inside that flat "budget-bound" range with margin to
 * spare, so it costs nothing on real content while still being a real,
 * finite ceiling rather than pretending unbounded depth is free.
 */
const DEFAULT_MAX_DEPTH = 8

/** Props worth showing in a signature, because they say what a node IS. */
const IDENTIFYING = ['component', 'characters', 'layoutMode', 'status'] as const

function shorten(value: unknown, max = 16): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/**
 * One line describing a node — never its body. `characters` is deliberately
 * truncated: the model needs to know a Text exists and roughly what it says,
 * not to receive the copy.
 */
export function renderSignature(node: UidxNode): string {
  const address = node.address === '' ? '(page)' : node.address
  const props = IDENTIFYING.filter((p) => node.attrs[p] !== undefined)
    .map((p) => `${p}=${shorten(node.attrs[p]!.value)}`)
    .join(' ')
  const kids = node.children.length > 0 ? ` (${node.children.length})` : ''
  return `<${node.element}> ${node.name} @${address}${kids}${props ? ` ${props}` : ''}`
}

/**
 * The shape of a subtree, budget-bounded and depth-bounded. Always states what
 * it left out, so a model knows to descend rather than assuming it saw the lot.
 *
 * Admission is decided breadth-first: every node at depth d is offered a
 * place before any node at depth d+1 is even considered. A depth-first walk
 * that stops the instant the budget runs out has a fatal flaw — whichever
 * sibling comes first in document order gets to spend the *whole* budget on
 * its own subtree, and every sibling after it vanishes with no trace at all,
 * not even its name. The outline is the only way a model learns a large
 * page's shape; a sibling it was never told about is a section it will never
 * think to ask for. Breadth-first admission guarantees every sibling at a
 * level is seen before any grandchild is, which is the ordering a navigator
 * actually needs. The retained set is then rendered as the usual indented
 * tree, in document order, so it still reads the way the source does.
 */
export function renderOutline(
  _doc: UidxDocument,
  root: UidxNode,
  options: OutlineOptions = {},
): string {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH

  // Total descendant count per node, walked once. This is what lets the
  // trailer report an exact absence count from both causes (past maxDepth,
  // or past the budget) instead of the old direct-children-only estimate.
  const descendantCount = new Map<UidxNode, number>()
  const countDescendants = (node: UidxNode): number => {
    let total = 0
    for (const child of node.children) total += 1 + countDescendants(child)
    descendantCount.set(node, total)
    return total
  }
  countDescendants(root)

  // Breadth-first admission. `probe` makes the same running budget check the
  // old code used ("does the next line still fit?"), now walked level by
  // level instead of branch by branch. `admittedOrder` records the exact
  // order nodes were admitted in: a parent always precedes its own children
  // in that order (a child is only ever considered after its parent was
  // admitted), which is what makes it safe to revoke from the tail below —
  // the last-admitted nodes are always the deepest, most marginal ones,
  // never a still-admitted sibling's line.
  const admitted = new Set<UidxNode>()
  const admittedOrder: UidxNode[] = []
  const probe: string[] = []
  let frontier: UidxNode[] = [root]
  let depth = 0
  let budgetExhausted = false

  while (frontier.length > 0 && !budgetExhausted) {
    const next: UidxNode[] = []
    for (const node of frontier) {
      const line = `${'  '.repeat(depth)}${renderSignature(node)}`
      if (probe.join('\n').length + line.length + 1 > maxChars) {
        budgetExhausted = true
        break
      }
      probe.push(line)
      admitted.add(node)
      admittedOrder.push(node)
      if (depth < maxDepth) next.push(...node.children)
    }
    frontier = next
    depth += 1
  }

  const totalNodes = 1 + (descendantCount.get(root) ?? 0)

  // Render the currently-admitted set as the indented tree, in document
  // order. A node whose children are only partly admitted — by depth or by
  // budget, either way — says so on its own line, so "some of this is
  // missing" is always visible right where a model would think to descend.
  const render = (): string[] => {
    const rendered: string[] = []
    const visit = (node: UidxNode, nodeDepth: number): void => {
      if (!admitted.has(node)) return
      const total = node.children.length
      const shown = node.children.filter((child) => admitted.has(child)).length
      const partial = total > 0 && shown < total ? ` — showing ${shown}/${total} children` : ''
      rendered.push(`${'  '.repeat(nodeDepth)}${renderSignature(node)}${partial}`)
      for (const child of node.children) visit(child, nodeDepth + 1)
    }
    visit(root, 0)
    return rendered
  }

  const notesFor = (truncated: boolean): string[] => {
    const notes: string[] = []
    const absentNodes = totalNodes - admitted.size
    if (absentNodes > 0) {
      notes.push(`${absentNodes} node(s) omitted — read a child address to descend`)
    }
    if (truncated) notes.push('outline truncated to fit the budget')
    return notes
  }

  let lines = render()
  let truncated = budgetExhausted
  let notes = notesFor(truncated)

  if (notes.length === 0) return lines.join('\n')

  // The trailer that explains what got left out must itself live inside
  // maxChars — a budget the trailer alone could blow past is not a budget.
  // Shrinking by popping *rendered* lines from the end would undo the whole
  // point of breadth-first admission the instant a deep node happens to
  // render after a shallow sibling in document order — so instead revoke
  // admission from the tail of admission order (always the deepest, most
  // marginal nodes; never an already-admitted sibling, per the invariant
  // above) and re-render, until the whole thing fits; if even an empty body
  // plus trailer cannot fit, hard-cut as a last resort rather than ever
  // exceed what the caller asked for.
  let suffix = `\n(${notes.join('; ')})`
  while (admittedOrder.length > 0 && lines.join('\n').length + suffix.length > maxChars) {
    const revoked = admittedOrder.pop()!
    admitted.delete(revoked)
    truncated = true
    lines = render()
    notes = notesFor(truncated)
    suffix = `\n(${notes.join('; ')})`
  }

  const combined = `${lines.join('\n')}${suffix}`
  return combined.length <= maxChars ? combined : combined.slice(0, maxChars)
}
