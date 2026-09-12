import { aliasTarget, type JsonValue, type UidxDocument, type UidxNode } from '@uidx/format'
import { resolveTokenValues } from '@uidx/schema'

/** How many mismatches a notice names before it starts counting. */
const MAX_NAMED = 2

/**
 * Props that must hold a string once every alias has been substituted.
 *
 * Only `characters` so far, and only because it is the one measured to be
 * fatal. The rule earns its narrowness the same way `overflows` does: a prop
 * whose type mismatch merely looks wrong is `uidx check`'s business, and a
 * warning nobody has seen fail is a warning that will be ignored.
 */
const MUST_BE_TEXT = new Set(['characters'])

export interface BadAlias {
  /** The node carrying it, by address. */
  address: string
  /** The prop the alias was written on. */
  prop: string
  /** The token address it points at. */
  target: string
  /** What that token actually holds. */
  got: JsonValue
}

/**
 * Token aliases bound to a prop whose type they cannot satisfy.
 *
 * Measured on a real run, and fatal. Asked to document a Switch's
 * measurements, Haiku 4.5 wrote `<Text characters="{radius#pill}" />` to show
 * the token's value in a spec table — a reasonable-looking thing to want. But
 * an alias is *substituted* for its value, so `characters` became the number
 * 999, and the SDK's font pass iterates a text node's string to collect the
 * glyphs it needs. A number is not iterable, the pass threw, and **the whole
 * page stopped rendering** — not merely that node, because the font pass walks
 * the entire graph before anything is drawn.
 *
 * Everything else called it healthy. It parses. `uidx check` answered "2 files
 * OK". `drawsNothing`, `overlaps` and `overflows` all returned clean, and the
 * e2e verdict read "renders clean" over a page that could not be rendered at
 * all. That combination — valid uidx, zero errors, nothing on screen — is the
 * exact family this harness's audits exist to close, and it took a new member.
 *
 * An alias that resolves to nothing is left alone: a dangling token is
 * `uidx check`'s to report, and guessing at the type of a value that does not
 * exist would be inventing a fault.
 */
export function badAliases(docs: readonly UidxDocument[], page: UidxDocument): BadAlias[] {
  const values = resolveTokenValues([...docs, page])
  const found: BadAlias[] = []

  const walk = (node: UidxNode): void => {
    for (const prop of MUST_BE_TEXT) {
      const value = node.attrs[prop]?.value
      if (value === undefined) continue
      // A component prop binding — `{label}` — carries no `#`, is resolved by
      // the instance rather than the token index, and is how a label reaches a
      // variant. `aliasTarget` matches both spellings, so the `#` is the test.
      const target = aliasTarget(value)
      if (target === null || !target.includes('#')) continue
      const resolved = values.get(target)
      if (resolved === undefined || typeof resolved === 'string') continue
      found.push({ address: node.address || '(page)', prop, target, got: resolved })
    }
    for (const child of node.children) walk(child)
  }

  walk(page.tree)
  return found
}

/** The audit as a sentence to append to a successful edit, or empty when every alias fits. */
export function badAliasNotice(docs: readonly UidxDocument[], page: UidxDocument): string {
  const bad = badAliases(docs, page)
  if (bad.length === 0) return ''
  const named = bad
    .slice(0, MAX_NAMED)
    .map(
      (b) =>
        `${b.address} binds ${b.target} into ${b.prop}, which resolves to ${JSON.stringify(b.got)}, not text`,
    )
  const rest = bad.length - named.length
  const more = rest > 0 ? `, (+${rest} more)` : ''
  const first = bad[0]!
  return (
    ` — but ${named.join('; ')}${more}: the whole page stops rendering.` +
    ` Type the value instead, e.g. ${first.prop}="${String(first.got)} (${first.target})".`
  )
}
