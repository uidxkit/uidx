import type { UidxDocument, UidxNode } from '@uidx/format'

/** How many contradictions a notice names before it starts counting. */
const MAX_NAMED = 3

/**
 * Which authored dimension each sizing-mode axis governs, per layout
 * direction: a VERTICAL layout's primary axis is its height and its counter
 * axis its width; HORIZONTAL is the transpose. A node without a valid layout
 * mode has no axes to govern.
 */
const DIMENSION: Record<string, Record<string, 'width' | 'height'>> = {
  VERTICAL: { primaryAxisSizingMode: 'height', counterAxisSizingMode: 'width' },
  HORIZONTAL: { primaryAxisSizingMode: 'width', counterAxisSizingMode: 'height' },
}

export interface SizingContradiction {
  /** The node, by address. */
  address: string
  /** The axis prop claiming FIXED. */
  axis: string
  /** The dimension it fixed nothing of. */
  dimension: 'width' | 'height'
}

/**
 * Nodes that declare a FIXED axis and never state the size to fix it at.
 *
 * An authored contradiction, measured on a real run: a page's every section
 * carried `counterAxisSizingMode="FIXED"` with no `width` anywhere, so the
 * engine fell back to hugging content and the whole page collapsed into a
 * ~370px column — cover text colliding with the variant grid. Every other
 * audit passed, because by their rules nothing was wrong: nothing blank,
 * nothing stacked, nothing overflowing, nothing misbound. "My width is fixed"
 * with no width is not a style choice; it is a sentence missing its object.
 *
 * Measured before shipping, the same way every audit here was: zero hits
 * across all 39 hand-authored pages and every clean model run, nine on the
 * broken one — every FIXED in this repo's own designs states its size.
 */
export function fixedWithoutSize(doc: UidxDocument): SizingContradiction[] {
  const found: SizingContradiction[] = []
  const walk = (node: UidxNode): void => {
    const layout = node.attrs.layoutMode?.value
    const axes = typeof layout === 'string' ? DIMENSION[layout] : undefined
    if (axes) {
      for (const [axis, dimension] of Object.entries(axes)) {
        if (node.attrs[axis]?.value === 'FIXED' && node.attrs[dimension]?.value === undefined) {
          found.push({ address: node.address || '(page)', axis, dimension })
        }
      }
    }
    for (const child of node.children) walk(child)
  }
  walk(doc.tree)
  return found
}

/** The audit as a sentence to append to a successful edit, or empty when every FIXED has its size. */
export function fixedWithoutSizeNotice(doc: UidxDocument): string {
  const contradictions = fixedWithoutSize(doc)
  if (contradictions.length === 0) return ''
  const named = contradictions
    .slice(0, MAX_NAMED)
    .map((c) => `${c.address} says ${c.axis}="FIXED" but has no ${c.dimension}`)
  const rest = contradictions.length - named.length
  const more = rest > 0 ? `, (+${rest} more)` : ''
  return (
    ` — but ${named.join('; ')}${more}: FIXED with no size falls back to hugging content` +
    ` and the layout collapses. State the ${contradictions[0]!.dimension}, or use "AUTO".`
  )
}
