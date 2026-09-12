import type { UidxDocument, UidxNode } from '@uidx/format'

/** How many invisible nodes an audit names before it starts counting. */
const MAX_NAMED = 4

/**
 * Whether a node has been given any way to be seen.
 *
 * Deliberately generous — this reports, it does not refuse, so a false alarm
 * costs a line of noise while a missed one costs a page that looks finished
 * and is blank. A node counts as visible if it paints, if it takes up space,
 * if it lays out its children, if it says something, or if it stands for
 * something else that does.
 */
function invisible(node: UidxNode): boolean {
  const has = (prop: string): boolean => node.attrs[prop] !== undefined
  const nonEmpty = (prop: string): boolean => {
    const value = node.attrs[prop]?.value
    return Array.isArray(value) ? value.length > 0 : value !== undefined
  }

  // An instance draws its component's tree, and a slot draws its fill: neither
  // needs geometry of its own to be worth something.
  if (node.element === 'Instance' || node.element === 'Slot') return false
  // A component and its variants are definitions. They are drawn through
  // instances, and judging them by their own geometry would be wrong.
  if (node.element === 'Component' || node.element === 'Variant') return false

  if (node.element === 'Text') {
    const characters = node.attrs.characters?.value
    if (typeof characters === 'string' && characters.trim() !== '') return false
    // The audit's own advice offers wordless text a way out — "a width if it
    // is meant as a spacer" — and a model took it, verbatim, with
    // `characters="" width={90}` as the corner cell of a state grid… and was
    // flagged anyway, because the rule had never learned its own exception.
    // A spacer with a stated width occupies exactly the space it was asked to.
    return !has('width')
  }

  if (nonEmpty('fills') || nonEmpty('strokes')) return false
  if (has('width') || has('height')) return false
  // Auto-layout with children sizes itself from them, so it is visible as long
  // as it has something to lay out.
  if (has('layoutMode') && node.children.length > 0) return false
  // A container whose children are visible is doing its job even unpainted.
  return !node.children.some((child) => !invisible(child))
}

/**
 * Which nodes in this page will draw nothing, named by address.
 *
 * The failure this catches is the quiet one. A `Frame` with no size, no fill
 * and no children is valid uidx: it parses, it validates, `uidx check` reports
 * zero errors, and the page renders blank. Measured on a real run, a local
 * model built thirteen such frames, marked its plan steps done, and reported
 * success — and nothing in the loop disagreed, because nothing was wrong in
 * any way the harness could see.
 *
 * Computed rather than looked at: the model would otherwise have to call
 * `view_image` to discover it, which it did not do once across six turns. A
 * fact appended to the edit that created the node arrives at the moment it can
 * still be cheaply fixed.
 */
function blankNodes(doc: UidxDocument): UidxNode[] {
  const found: UidxNode[] = []
  const walk = (node: UidxNode): void => {
    if (node !== doc.tree && invisible(node)) {
      found.push(node)
      // Its children are invisible for the same reason; naming them too would
      // bury the one address worth fixing.
      return
    }
    for (const child of node.children) walk(child)
  }
  walk(doc.tree)
  return found
}

export function drawsNothing(doc: UidxDocument): string[] {
  return blankNodes(doc).map((node) => (node.address === '' ? '(page)' : node.address))
}

/**
 * The audit as a sentence to append to a successful edit, or empty when all is
 * well.
 *
 * A `<Text>` gets its own way out, because the general one is wrong for it. An
 * empty text node has no fill to give and no children to add, and telling it
 * so wastes the one line the model reads. This was measured on a real page: a
 * `<Text characters="" />` was placed as the blank corner cell of a state
 * grid, where the row labels below it were sized by their own words. Auto-sized
 * and wordless, it took no width at all, so every column header sat shifted
 * left of the column it named — and `width` was exactly the fix.
 */
export function drawsNothingNotice(doc: UidxDocument): string {
  const blank = blankNodes(doc)
  if (blank.length === 0) return ''
  const named = blank
    .slice(0, MAX_NAMED)
    .map((node) => (node.address === '' ? '(page)' : node.address))
  const rest = blank.length - named.length
  const more = rest > 0 ? `, (+${rest} more)` : ''
  const subject = blank.length === 1 ? 'draws nothing' : 'draw nothing'
  const text = ' an empty <Text> needs characters, or a width if it is meant as a spacer'
  const how = blank.every((node) => node.element === 'Text')
    ? `${text.trimStart()}.`
    : blank.some((node) => node.element === 'Text')
      ? `give it a size, a fill, or children —${text}.`
      : 'give it a size, a fill, or children.'
  return ` — but ${named.join(', ')}${more} ${subject} yet: ${how}`
}
