import { TOKEN_ELEMENTS, type UidxDocument, type UidxNode } from '@uidx/format'

/** How many overflowing children a notice names before it starts counting. */
const MAX_NAMED = 3

export interface Overflow {
  /** The child that does not fit, by address. */
  address: string
  /** The width it was given. */
  width: number
  /** The width its parent actually leaves it, after padding. */
  inner: number
}

/** An authored number, or undefined when the prop was not written down. */
function authored(node: UidxNode, prop: string): number | undefined {
  const value = node.attrs[prop]?.value
  return typeof value === 'number' ? value : undefined
}

/**
 * Children given more width than their parent has room for.
 *
 * The defect this exists for was invisible to everything else in the harness.
 * Haiku 4.5 built a documentation page whose `doc` frame was `width={1440}`
 * with 72px of padding on each side, and gave all twelve of its sections
 * `width={1440}` as well. Each one was 144px wider than the space it had, and
 * every section's text ran past its container.
 *
 * `overlaps` cannot see it — the sections are laid out by their parent, which
 * is exactly what that audit tells you to do. `drawsNothing` cannot see it —
 * every frame is full. And `review` cannot see it either: a 144px spill in a
 * 1440px page, shown at half scale, is a few soft pixels at the margin.
 *
 * The rule is deliberately the narrowest one that catches it, and the
 * narrowness was measured rather than assumed. Three wider readings were tried
 * against this repo's 39 hand-authored pages and against three real model runs:
 *
 *   width, x-aware (`x + width`)   8 false alarms on a clean page, 1 in design/
 *   height                          1 in design/option-4
 *   height, y-aware                 1 in design/option-4
 *   width alone                     0 false alarms, all 12 real defects
 *
 * So: width alone, ignoring where the child sits. A node placed at an `x` may
 * hang past its parent on purpose — that is a bleed, and design does it — but
 * nobody sets a child *wider than the box it is in* on purpose.
 *
 * Only authored numbers are compared. A child with no width of its own is
 * sized by the layout engine or by its content, and guessing at that number is
 * how `overlaps` first arrived at 121 false positives.
 */
export function overflows(doc: UidxDocument): Overflow[] {
  const found: Overflow[] = []

  const walk = (node: UidxNode): void => {
    // A Component's children are variants, and `arrangeVariants` sizes and
    // places them: their authored geometry is not what the canvas draws.
    const judges = node.element !== 'Component' && !TOKEN_ELEMENTS.has(node.element)
    const width = authored(node, 'width')
    if (judges && width !== undefined) {
      const inner =
        width - (authored(node, 'paddingLeft') ?? 0) - (authored(node, 'paddingRight') ?? 0)
      for (const child of node.children) {
        const childWidth = authored(child, 'width')
        if (childWidth !== undefined && childWidth > inner) {
          found.push({ address: child.address || '(page)', width: childWidth, inner })
        }
      }
    }
    for (const child of node.children) walk(child)
  }

  walk(doc.tree)
  return found
}

/** The audit as a sentence to append to a successful edit, or empty when everything fits. */
export function overflowNotice(doc: UidxDocument): string {
  const spilling = overflows(doc)
  if (spilling.length === 0) return ''
  const named = spilling
    .slice(0, MAX_NAMED)
    .map((o) => `${o.address} is ${o.width} wide inside ${o.inner} of space`)
  const rest = spilling.length - named.length
  const more = rest > 0 ? `, (+${rest} more)` : ''
  const verb = spilling.length === 1 ? 'it overflows its parent' : 'they overflow their parents'
  return (
    ` — but ${named.join('; ')}${more}, so ${verb}: subtract the parent’s left and right padding` +
    ` from its width, or drop the child’s width and let the parent size it.`
  )
}
