import { resolve, type UidxDocument, type UidxNode } from '@uidx/format'

/**
 * How many sibling addresses a refusal names before it starts counting. Six is
 * a line's worth: enough that the right one is usually present, few enough that
 * a refusal on a wide node cannot itself become the thing that overruns the
 * window.
 */
export const MAX_NAMED_CHILDREN = 6

/**
 * Every address that could be an ancestor of `address`, longest first, ending
 * at the page root.
 *
 * The grammar, verified against the parser: `#` bounds an entity from the nodes
 * inside it, and after the `#` every `/` walks one level deeper. A `/` *before*
 * the `#` is part of a top-level name — that is how Figma groups a component
 * set — so `Control/Checkbox#state=on` has exactly two ancestors, not three.
 */
export function resolvablePrefixes(address: string): string[] {
  if (address === '') return ['']
  const prefixes = [address]
  const hash = address.indexOf('#')
  if (hash >= 0) {
    let inside = address.slice(hash + 1)
    while (inside.includes('/')) {
      inside = inside.slice(0, inside.lastIndexOf('/'))
      prefixes.push(`${address.slice(0, hash)}#${inside}`)
    }
    prefixes.push(address.slice(0, hash))
  }
  prefixes.push('')
  return prefixes
}

/** How a node is named in a refusal — the page root has no address of its own. */
function label(node: UidxNode): string {
  return node.address === '' ? 'the page' : node.address
}

/**
 * What the nearest existing ancestor of a failed address actually holds.
 *
 * A refusal that reports only absence leaves the model to guess, and it guesses
 * badly: asked to fill a page it had just created, qwen3.5 tried `card#title`,
 * `card#`, `Frame#` and `/card#title` in turn — twelve refusals across
 * twenty-four steps, while the harness held the whole tree and said nothing.
 * The tree is right here, so say what is in it.
 *
 * Returns a fragment ready to append to an existing refusal, opening with its
 * own separator so no caller has to decide whether to add one.
 */
export function describeNearest(doc: UidxDocument, address: string): string {
  if (resolve(doc.tree, address)) return ''

  for (const prefix of resolvablePrefixes(address)) {
    const node = prefix === '' ? doc.tree : resolve(doc.tree, prefix)
    if (!node) continue
    const children = node.children
    if (children.length === 0) return ` — ${label(node)} has no children yet`
    const named = children.slice(0, MAX_NAMED_CHILDREN).map((child) => child.address)
    const rest = children.length - named.length
    const more = rest > 0 ? `, (+${rest} more)` : ''
    return ` — ${label(node)} holds ${named.join(', ')}${more}`
  }
  return ''
}
