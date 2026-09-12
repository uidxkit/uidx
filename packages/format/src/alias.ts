import { ENTITY_SEP } from './types.js'
import { isUnitLength } from './lengths.js'
import type { JsonValue, VariableType } from './types.js'

/**
 * A value that references a design token instead of stating a number.
 *
 * Written as a braced string so it needs no new value syntax and survives the
 * existing span machinery untouched:
 *
 *   cornerRadius="{radius#md}"
 *
 * Figma serialises the same idea as `{ type: 'VARIABLE_ALIAS', id }`, which no
 * designer would type. Per ADR 0002 the file gets the readable spelling and the
 * schema layer produces the engine shape — the same trade `strokeAlign` makes.
 *
 * The target is an ordinary UIDX address (`collection#variable`), *not* a third
 * separator. ADR 0004 §2 sketched `{radius.md}` before §3 of the same ADR
 * settled `#` as the entity boundary, and the two were never reconciled; one
 * address law is worth more than matching a convention from other token tools.
 */
const ALIAS = /^\{\s*([^{}\s][^{}]*?)\s*\}$/

export interface Alias {
  /** The referenced address, e.g. `radius#md`. */
  target: string
}

/** Whether an authored value is a token reference. */
export function isAlias(value: JsonValue): value is string {
  return typeof value === 'string' && ALIAS.test(value)
}

/** The address an alias points at, or null if the value is not an alias. */
export function aliasTarget(value: JsonValue): string | null {
  if (typeof value !== 'string') return null
  const match = ALIAS.exec(value)
  return match ? match[1]! : null
}

/** Renders an address back into the authored spelling. */
export function toAlias(target: string): string {
  return `{${target}}`
}

/**
 * The Figma variable type a literal value implies.
 *
 * Inferred rather than declared, because a designer expresses a *value* — the
 * type is a fact about it, and every case is unambiguous: a colour is the only
 * object shape the vocabulary admits. An alias has no type of its own; it takes
 * the type of whatever it resolves to, which is why this returns null for one.
 */
export function variableTypeOf(value: JsonValue): VariableType | null {
  if (isAlias(value)) return null
  if (typeof value === 'number') return 'FLOAT'
  if (isUnitLength(value)) return 'FLOAT'
  if (typeof value === 'boolean') return 'BOOLEAN'
  if (typeof value === 'string') return 'STRING'
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value)
    if (keys.includes('r') && keys.includes('g') && keys.includes('b')) return 'COLOR'
  }
  return null
}

/**
 * Whether `target` is shaped like a variable address rather than a node one.
 *
 * Both live in the same address space, so this is a readability check for
 * diagnostics, not a resolution rule — resolution is the symbol table's job.
 */
export function looksLikeVariableAddress(target: string): boolean {
  return target.includes(ENTITY_SEP)
}

/**
 * Whether an authored value may sit under a declared type.
 *
 * An alias is always allowed: it has no type of its own and takes whatever its
 * target resolves to, which the symbol table settles across documents. This is
 * the validation half of `variableTypeOf` — inference stopped being the source
 * of truth in G8, but the logic was always right, only in the wrong position.
 */
export function fitsVariableType(value: JsonValue, type: VariableType): boolean {
  if (isAlias(value)) return true
  if (type === 'STRING' && typeof value === 'string') return true
  if (typeof value === 'number' && !Number.isFinite(value)) return false
  return variableTypeOf(value) === type
}
