import { TOKEN_ELEMENTS, type UidxDocument, type UidxNode } from '@uidx/format'

/** How many collisions a notice names before it starts counting. */
const MAX_NAMED = 3

/**
 * Siblings that were never given a position, and so all draw from the same
 * origin.
 *
 * A deliberately narrow rule, and the narrowness is the point. The first
 * version of this audit compared rectangles and reported any intersection: it
 * found 121 collisions on a page that renders perfectly, and 90 more across
 * this repo's own hand-authored designs. Every one of those was *intentional*
 * — `row-outline` over a row, `veil` over a field, `canvas-dots` behind an
 * artboard, a `halo` around a control. Layering is how design works, and no
 * geometry rule can tell an intended layer from an accident.
 *
 * What cannot be intentional is omission. A node with no `x` and no `y` sits
 * at (0, 0) because nobody said where it goes — and two of those are stacked
 * by default rather than by choice. That is exactly the failure this exists
 * for: Haiku 4.5 built nine documentation sections as page children, gave none
 * of them a position, and every one drew from the origin. Good prose in every
 * section, and unreadable.
 *
 * Skipped, because something other than the author does the placing:
 *   auto-layout   the layout engine positions its children
 *   a Component   `arrangeVariants` lays its variants out on a grid
 *   a Component child, which the canvas places as a definition beside the page
 *   the token tree, which declares variables and has no geometry at all
 *   a slot fill — a <Slot> inside an <Instance> — whose layout is the
 *   component's declaration, not the fill's: UIDX131 refuses a layoutMode on
 *   the fill, so its children are laid out by a node this file cannot see
 */
export function overlaps(doc: UidxDocument): [string, string][] {
  const found: [string, string][] = []

  const walk = (node: UidxNode, insideInstance = false): void => {
    // The layout mode's *value* is checked, not its presence: measured on a
    // real run, `layoutMode="vertical"` (lowercase — the engine only knows
    // "VERTICAL") was ignored by the layout pass, the children stacked at the
    // origin, and this audit said nothing because "has a layoutMode" was
    // taken to mean "places its children". NONE never placed them either.
    const layout = node.attrs.layoutMode?.value
    const placesOwnChildren =
      layout === 'HORIZONTAL' ||
      layout === 'VERTICAL' ||
      layout === 'GRID' ||
      node.element === 'Component' ||
      (node.element === 'Slot' && insideInstance) ||
      TOKEN_ELEMENTS.has(node.element)

    if (!placesOwnChildren) {
      // A page-level Component is NOT exempt, and the first version's
      // exemption was a wrong assumption caught by a user's eye: it read "the
      // canvas places a definition beside the page", but the canvas draws a
      // Component at its authored position — the *author* places it beside
      // the page, which is why the exemplar gives its Component x={1600}. A
      // run left the position off and the variant grid drew under the doc
      // frame. What stays exempt is the Component's *inside*: its variants
      // are arrangeVariants' business, handled at the walk level above.
      const unplaced = node.children.filter(
        (child) =>
          !TOKEN_ELEMENTS.has(child.element) &&
          child.attrs.x === undefined &&
          child.attrs.y === undefined &&
          // Something with neither extent nor content draws nothing, and
          // `drawsNothing` is the audit with something to say about that.
          (child.attrs.width !== undefined ||
            child.attrs.height !== undefined ||
            child.children.length > 0),
      )
      for (let i = 1; i < unplaced.length; i += 1) {
        found.push([unplaced[0]!.address || '(page)', unplaced[i]!.address || '(page)'])
      }
    }
    for (const child of node.children) walk(child, insideInstance || node.element === 'Instance')
  }

  walk(doc.tree)
  return found
}

/** The audit as a sentence to append to a successful edit, or empty when nothing stacks. */
export function overlapNotice(doc: UidxDocument): string {
  const collisions = overlaps(doc)
  if (collisions.length === 0) return ''
  const named = collisions.slice(0, MAX_NAMED).map(([a, b]) => `${a} and ${b}`)
  const rest = collisions.length - named.length
  const more = rest > 0 ? `, (+${rest} more)` : ''
  return ` — but ${named.join('; ')}${more} have no position, so they all draw from the same spot: give them x and y, or put them in a parent with layoutMode so it places them.`
}
