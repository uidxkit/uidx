import { aliasTarget, type JsonValue, type UidxDocument, type UidxNode } from '@uidx/format'

export interface TokenUse {
  /** How many token references this page makes. */
  references: number
  /** Every collection the document declares, in declaration order. */
  declared: string[]
  /** Those the page reaches for. */
  used: string[]
  /** Those it never does. */
  unused: string[]
}

/**
 * The collection half of a `collection#variable` address.
 *
 * A reference that names no collection is malformed, and `uidx check` reports
 * that properly; here it simply counts as a reference to nothing.
 */
function collectionOf(target: string): string | null {
  const [collection] = target.split('#')
  return collection && collection !== target ? collection : null
}

/**
 * Every token address a node binds, in the two positions the schema actually
 * resolves one.
 *
 * Those two positions are not a guess: `to-scene.ts` substitutes an alias when
 * it is the whole value of a prop, and when it is the `color` of a paint inside
 * a `fills` or `strokes` array. Nothing else is a binding, and counting a
 * braced address that happens to appear inside a `characters` string would
 * credit a page for writing *about* a token instead of using one.
 */
function bindings(node: UidxNode): string[] {
  const found: string[] = []
  for (const attr of Object.values(node.attrs)) {
    const value: JsonValue | undefined = attr?.value
    if (value === undefined) continue
    const whole = aliasTarget(value)
    if (whole !== null) {
      found.push(whole)
      continue
    }
    if (!Array.isArray(value)) continue
    for (const entry of value) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
      const color = (entry as Record<string, JsonValue>).color
      const target = color === undefined ? null : aliasTarget(color)
      if (target !== null) found.push(target)
    }
  }
  return found
}

/**
 * Which of the document's token scales this page actually binds to.
 *
 * Counted rather than judged, and the distinction was measured. Two audits
 * that *accuse* — "this literal equals a token you could have bound" — were
 * tried first, against this repo's 39 hand-authored pages and three real model
 * runs. The wide reading fired 340 times on `design/option-4` alone, matching
 * a `fontSize` of 16 against `radius#lg`. The narrow reading, restricted to
 * props the document itself binds somewhere, still fired 22-27 times per
 * design — and, decisively, scored the *worst* of the three model runs at zero
 * while scoring both clean runs at 13 and 28. It rewards a page for binding
 * nothing.
 *
 * The reason both fail is the same: a documentation page draws a radius scale
 * by writing each radius out literally, on purpose. No rule can tell that
 * specimen from a shortcut, because the difference is intent.
 *
 * So this claims nothing about intent. A page either reaches for a collection
 * or it does not; saying which cannot be a false positive. On the run that
 * prompted it, that fact was stark — fourteen references, all to `radius`, and
 * the entire `space` scale left untouched while every gap and pad in the page
 * was typed as a number.
 */
export function tokenUse(docs: readonly UidxDocument[], page: UidxDocument): TokenUse {
  const declared: string[] = []
  for (const doc of docs) {
    if (doc.tree.element !== 'Tokens') continue
    for (const collection of doc.tree.children) {
      if (collection.name && !declared.includes(collection.name)) declared.push(collection.name)
    }
  }

  const hit = new Set<string>()
  let references = 0
  const walk = (node: UidxNode): void => {
    for (const target of bindings(node)) {
      references += 1
      const collection = collectionOf(target)
      if (collection) hit.add(collection)
    }
    for (const child of node.children) walk(child)
  }
  walk(page.tree)

  return {
    references,
    declared,
    used: declared.filter((c) => hit.has(c)),
    unused: declared.filter((c) => !hit.has(c)),
  }
}

/** English for a list, so a fact reads as a sentence rather than an array. */
function series(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * The token picture as one line for `review`'s facts, or null when the
 * document declares no tokens and there is nothing to be said.
 *
 * A fact rather than a fault, which is why it belongs beside the render in
 * `review` and not appended to an edit. Declaring a scale and binding it are
 * separate acts, and an author is entitled to do them in that order.
 */
export function tokenFacts(docs: readonly UidxDocument[], page: UidxDocument): string | null {
  const use = tokenUse(docs, page)
  if (use.declared.length === 0) return null
  if (use.references === 0) {
    return `- binds no tokens at all, though ${series(use.declared)} are declared.`
  }
  const count = use.references === 1 ? '1 token' : `${use.references} tokens`
  if (use.unused.length === 0) return `- binds ${count}, across every collection declared.`
  const [are, it] = use.unused.length === 1 ? ['is', 'it'] : ['are', 'them']
  return `- binds ${count}; ${series(use.unused)} ${are} declared and this page never uses ${it}.`
}
