import JSON5 from 'json5'
import type { JsonValue } from './types.js'

export class ValueError extends Error {}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * Parses the inner text of an expression attribute (`{...}` with the braces
 * stripped) under the restricted grammar of spec §3.3.
 *
 * JSON5 does the heavy lifting: identifiers, calls and template strings are not
 * JSON5 literals, so they throw here rather than silently becoming something the
 * patch engine cannot write back.
 */
export function parseExpression(text: string): JsonValue {
  const trimmed = text.trim()
  if (trimmed === '') throw new ValueError('empty expression')
  let parsed: unknown
  try {
    parsed = JSON5.parse(trimmed)
  } catch (err) {
    throw new ValueError(
      `not a statically evaluable literal (${(err as Error).message}). ` +
        'Only strings, numbers, booleans, null and JSON5 object/array literals are allowed.',
    )
  }
  assertJsonValue(parsed)
  return parsed
}

function assertJsonValue(value: unknown, path = ''): asserts value is JsonValue {
  const at = path ? ` at ${path}` : ''
  if (value === null) return
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return
    case 'number':
      // JSON5 accepts Infinity and NaN; neither survives a round trip as data.
      if (!Number.isFinite(value)) throw new ValueError(`non-finite number${at}`)
      return
    case 'object': {
      if (Array.isArray(value)) {
        value.forEach((v, i) => assertJsonValue(v, `${path}[${i}]`))
        return
      }
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        assertJsonValue(v, path ? `${path}.${k}` : k)
      }
      return
    }
    default:
      throw new ValueError(`unsupported value of type ${typeof value}${at}`)
  }
}

/**
 * Canonical number rounding (spec §4.1): three decimals for geometry, four for
 * colour channels. Integers pass through untouched so `{16}` never becomes
 * `{16.0}`.
 */
export function roundNumber(n: number, inColor: boolean): number {
  if (Number.isInteger(n)) return n
  return Number.parseFloat(n.toFixed(inColor ? 4 : 3))
}

function quoteSingle(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
}

function quoteDouble(s: string): string {
  return `"${s}"`
}

/** Serialises a value to JSON5 source text, without the outer `{}`. */
export function serializeJson5(value: JsonValue, inColor = false): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string':
      return quoteSingle(value)
    case 'boolean':
      return String(value)
    case 'number':
      return String(roundNumber(value, inColor))
    default:
      break
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => serializeJson5(v, inColor)).join(', ')}]`
  }
  const entries = Object.entries(value).map(([k, v]) => {
    const key = IDENTIFIER.test(k) ? k : quoteSingle(k)
    // Colour channels get the finer rounding; the flag latches on for the
    // subtree under a `color` key.
    return `${key}: ${serializeJson5(v, inColor || k === 'color')}`
  })
  return entries.length ? `{ ${entries.join(', ')} }` : '{}'
}

/**
 * Serialises a value to a complete, delimited attribute value — the exact text
 * that occupies an attribute's `valueLoc`.
 *
 * Strings become JSX string attributes (`"label"`). A string carrying a double
 * quote or a newline cannot be written that way, so it falls back to an
 * expression with single quotes.
 */
export function serializeValue(value: JsonValue): string {
  if (typeof value === 'string') {
    return value.includes('"') || value.includes('\n')
      ? `{${quoteSingle(value)}}`
      : quoteDouble(value)
  }
  return `{${serializeJson5(value)}}`
}
