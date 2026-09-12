import { LENGTH_PROPS, isUnitLength } from '@uidx/format'
import {
  resolve,
  scopesForProp,
  toAlias,
  variableTypeOf,
  type JsonValue,
  type UidxDocument,
  type UidxNode,
  type UidxPatch,
  type VariableType,
} from '@uidx/format'
import type { TokenIndex } from '@uidx/schema'
import { colorToHex, type Rgba } from './paint-edit'

/**
 * Variables as the panel's popup lists them (spec §3): typed, grouped by the
 * collection half of their address, with the resolved literal as a preview.
 * Scoped since G8: a radius scale stops offering itself for a gap.
 * The tokens map is `App.vue`'s `resolveTokenValues` output, so alias chains
 * are already flattened — a candidate's value is always a literal.
 */
export interface VariableCandidate {
  address: string
  collection: string
  name: string
  type: VariableType
  value: JsonValue
  preview: string
}

export function variableCandidates(
  tokens: ReadonlyMap<string, JsonValue> | undefined,
  index: TokenIndex | undefined,
  type: VariableType | null,
  prop: string | null,
): VariableCandidate[] {
  if (!tokens || !type) return []
  // Two filters, in Figma's order: the one type this input takes, then the
  // property's scope. Scope is a picker filter and nothing more — a file that
  // binds outside it is warned about, never rejected, because Figma's own API
  // binds regardless and an imported file would otherwise refuse to open.
  const wanted = prop === null ? null : scopesForProp(prop)
  const out: VariableCandidate[] = []
  for (const [address, value] of tokens) {
    if ((index?.entries.get(address)?.type ?? variableTypeOf(value)) !== type) continue
    if (isUnitLength(value) && type === 'FLOAT' && prop !== null && !LENGTH_PROPS.has(prop))
      continue
    if (wanted) {
      const scopes = index?.entries.get(address)?.scopes ?? ['ALL_SCOPES']
      const shown = scopes.includes('ALL_SCOPES') || scopes.some((s) => wanted.includes(s))
      if (!shown) continue
    }
    const sep = address.indexOf('#')
    if (sep < 0) continue
    out.push({
      address,
      collection: address.slice(0, sep),
      name: address.slice(sep + 1),
      type,
      value,
      preview: type === 'COLOR' ? colorToHex(value as unknown as Rgba) : String(value),
    })
  }
  return out
}

/** The one variable type a control kind can read, or null when none can. */
export function variableTypeForControl(control: string): VariableType | null {
  return control === 'number'
    ? 'FLOAT'
    : control === 'text'
      ? 'STRING'
      : control === 'boolean'
        ? 'BOOLEAN'
        : null
}

/**
 * Bind an attribute to a variable. Structural like `bindProperty`, and for the
 * same reason: writing `"{radius#md}"` through the scene-graph commit route
 * would hand D4 a string where it reflows numbers. A patch says exactly what
 * the file should hold.
 */
export function bindVariable(
  doc: UidxDocument,
  address: string,
  prop: string,
  token: string,
): UidxPatch[] | null {
  const node = resolve(doc.tree, address)
  if (!node) return null
  const op = node.attrs[prop] === undefined ? 'add' : 'set'
  return [{ op, address, prop, value: toAlias(token) }]
}

/** The node's own `modes` map, copied so a caller can edit it. */
function modesOf(node: UidxNode): Record<string, string> {
  const value = node.attrs.modes?.value
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, string>) }
    : {}
}

/**
 * Select a mode for one collection on one node (story G8).
 *
 * Figma's `explicitVariableModes`. Structural like `bindVariable`, and for the
 * same reason recorded there: the scene-graph commit route resolves this away.
 */
export function setNodeMode(
  doc: UidxDocument,
  address: string,
  collection: string,
  mode: string,
): UidxPatch[] | null {
  const node = resolve(doc.tree, address)
  if (!node) return null
  const next = modesOf(node)
  const op = node.attrs.modes === undefined ? 'add' : 'set'
  next[collection] = mode
  return [{ op, address, prop: 'modes', value: next }]
}

/**
 * Return one collection to Auto — inheriting whatever an ancestor selected.
 *
 * Auto is the *absence* of an entry rather than a mode named Auto, so clearing
 * the last one removes the attribute entirely. A node that says nothing is a
 * node that inherits, which is the whole point of the two-property split.
 */
export function clearNodeMode(
  doc: UidxDocument,
  address: string,
  collection: string,
): UidxPatch[] | null {
  const node = resolve(doc.tree, address)
  if (!node || node.attrs.modes === undefined) return null
  const next = modesOf(node)
  delete next[collection]
  return Object.keys(next).length === 0
    ? [{ op: 'remove', address, prop: 'modes' }]
    : [{ op: 'set', address, prop: 'modes', value: next }]
}

/**
 * Detach a binding by writing the value it was resolving to (story G8).
 *
 * Not by clearing the property: a detach that blanks the value loses the
 * design. Figma's own equivalent — dragging an auto-layout handle — silently
 * drops the binding, which the G8 review named as fatal for bidirectional sync.
 *
 * `resolved` comes from the caller's resolver in the node's own mode tuple, so
 * detaching inside a dark subtree writes the dark value rather than the
 * default-mode one. Undefined means the token resolved to nothing, and there is
 * no literal to write — better to refuse than to blank the property.
 */
export function detachVariable(
  doc: UidxDocument,
  address: string,
  prop: string,
  resolved: JsonValue | undefined,
): UidxPatch[] | null {
  if (resolved === undefined) return null
  const node = resolve(doc.tree, address)
  if (!node) return null
  return [{ op: node.attrs[prop] === undefined ? 'add' : 'set', address, prop, value: resolved }]
}
