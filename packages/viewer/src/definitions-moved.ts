import type { UidxDocument, UidxNode } from '@uidx/format'

/** Names of every `<Component>` this page instances, anywhere in its tree. */
export function instancedComponents(doc: UidxDocument | null): Set<string> {
  const out = new Set<string>()
  if (!doc) return out
  const walk = (node: UidxNode): void => {
    if (node.element === 'Instance') {
      const name = node.attrs.component?.value
      if (typeof name === 'string') out.add(name)
    }
    node.children.forEach(walk)
  }
  walk(doc.tree)
  return out
}

/** Names of every `<Component>` this page declares at its top level. */
export function declaredComponents(doc: UidxDocument | null): Set<string> {
  const out = new Set<string>()
  if (!doc) return out
  for (const node of doc.tree.children) if (node.element === 'Component') out.add(node.name)
  return out
}

/**
 * A definition's content, independent of which parse produced it: element,
 * attribute values and children, recursively. Spans are left out on purpose —
 * a save moves every offset without changing what the component draws.
 */
function signature(node: UidxNode): string {
  const attrs = Object.entries(node.attrs)
    .map(([k, a]) => [k, a.value] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return JSON.stringify([node.element, attrs, node.children.map(signature)])
}

/**
 * Whether any component this page instances has changed content since the
 * graph was built (spec §3).
 *
 * Identity was the old test, and a save re-parses every definition into a
 * fresh node — so a page that declared a component rebuilt its whole scene on
 * every one of its own saves, modes guard or not. Content is what an instance
 * copies, so content is what decides.
 */
export function definitionsMoved(
  before: ReadonlyMap<string, UidxNode> | undefined,
  next: ReadonlyMap<string, UidxNode> | undefined,
  instanced: ReadonlySet<string>,
): boolean {
  if (before === next) return false
  if (!before || !next) return true
  for (const name of instanced) {
    const a = before.get(name)
    const b = next.get(name)
    if (!a || !b) {
      if (a !== b) return true
      continue
    }
    if (a !== b && signature(a) !== signature(b)) return true
  }
  return false
}
