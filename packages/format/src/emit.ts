import { stringify as stringifyYaml } from 'yaml'
import { serializeValue } from './values.js'
import type { JsonValue, UidxDocument, UidxNode, UidxNodeSpec } from './types.js'

export const INDENT_UNIT = '  '

/**
 * Canonical style, single source of truth for both `uidx fmt` and `insert-node`
 * (spec §9.5 — created nodes must not introduce format churn).
 *
 * Rules, chosen for determinism over prettiness:
 *   - two-space indent
 *   - `name` first, remaining attributes in insertion order
 *   - 0 or 1 attributes inline; 2 or more one-per-line
 *   - childless elements self-close
 */
export function emitTree(spec: UidxNodeSpec, indent = ''): string {
  const entries = orderedAttrs(spec.attrs)
  const children = spec.children ?? []

  const parts = entries.map(([k, v]) => `${k}=${serializeValue(v)}`)
  const inline = parts.length <= 1

  const open = inline
    ? `<${spec.element}${parts.length ? ' ' + parts[0] : ''}`
    : `<${spec.element}\n${parts.map((p) => indent + INDENT_UNIT + p).join('\n')}\n${indent}`

  if (children.length === 0) {
    return `${indent}${open}${inline ? ' />' : '/>'}`
  }

  const body = children.map((c) => emitTree(c, indent + INDENT_UNIT)).join('\n')
  return `${indent}${open}>\n${body}\n${indent}</${spec.element}>`
}

function orderedAttrs(attrs: Record<string, JsonValue>): [string, JsonValue][] {
  const entries = Object.entries(attrs)
  const name = entries.find(([k]) => k === 'name')
  const rest = entries.filter(([k]) => k !== 'name')
  return name ? [name, ...rest] : rest
}

/** Converts a parsed node back into the spec shape `emitTree` consumes. */
export function toSpec(node: UidxNode, includeName = true): UidxNodeSpec {
  const attrs: Record<string, JsonValue> = {}
  for (const [key, attr] of Object.entries(node.attrs)) {
    if (key === 'name' && !includeName) continue
    attrs[key] = attr.value
  }
  return {
    element: node.element,
    attrs,
    children: node.children.map((c) => toSpec(c)),
  }
}

/**
 * Full canonical document re-emit, for `uidx fmt`. Destructive by design: it
 * discards original attribute layout and comments inside the contract region.
 * Never used on the round-trip edit path.
 */
export function emitDocument(doc: UidxDocument): string {
  // Hand-rolling this stringified nested objects as "[object Object]" and lost
  // quoting on values that need it. §3.2 requires unknown frontmatter keys to
  // survive, so it goes through a real YAML serialiser.
  const frontmatter = stringifyYaml(doc.frontmatter).trimEnd()

  // The root <Page> carries no name attribute; it takes it from the frontmatter
  // `id` (ADR 0003 §3). Emitting the tree also materialises a synthetic <Page>,
  // so `uidx fmt` performs that half of the migration by construction.
  const contract = emitTree(toSpec(doc.tree, false))
  const intent = doc.intent.raw.replace(/^\n+/, '').replace(/\n+$/, '')

  return `---\n${frontmatter}\n---\n\n${intent}\n\n## Visual Contract\n\n${contract}\n`
}

/** Auto-name per spec §3.4: `<element>-<n>`, bumped until siblings are unique. */
export function autoName(element: string, siblings: readonly { name: string }[]): string {
  const taken = new Set(siblings.map((s) => s.name))
  const base = element.toLowerCase()
  for (let n = 1; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}
