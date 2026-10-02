import { aliasTarget, isAlias, isUnitLength, type JsonValue, type VariableType } from '@uidx/format'

import type { TokenEntry, TokenIndex } from './token-index.js'

/**
 * Tokens in and out as the Design Tokens Community Group format, 2025.10
 * (Format, Color and Resolver modules): what Figma variables export, what
 * Tokens Studio, Style Dictionary and Terrazzo read.
 *
 * A collection is a top-level group. A collection with one mode is one file;
 * a collection with modes is one file per mode, and a resolver document
 * names them as the contexts of a modifier, the mode listed first being the
 * default — exactly the collection's own rule. Aliases cross unchanged in
 * meaning: `{surface#accent}` is `{surface.accent}`.
 *
 * Pure: an index in, file contents out; a DTCG tree in, `.uidx` source out.
 */

export const DTCG_VERSION = '2025.10'

type Dtcg = { [key: string]: JsonValue }

export interface DtcgExport {
  /** File name → JSON text. */
  files: Map<string, string>
  /** The resolver document, present when any collection has modes. */
  resolver?: string
}

export function toDtcg(index: TokenIndex): DtcgExport {
  const files = new Map<string, string>()
  const sets: Dtcg = {}
  const modifiers: Dtcg = {}
  const order: JsonValue[] = []
  for (const collection of index.collections.values()) {
    const entries = [...index.entries.values()].filter((e) => e.collection === collection.name)
    if (!entries.length) continue
    const modes = collection.modes.length ? collection.modes : ['default']
    if (modes.length === 1) {
      const file = `${collection.name}.tokens.json`
      files.set(file, json(group(collection.name, entries, modes[0]!)))
      sets[collection.name] = { sources: [{ $ref: file }] }
      order.push({ $ref: `#/sets/${collection.name}` })
      continue
    }
    const contexts: Dtcg = {}
    for (const mode of modes) {
      const file = `${collection.name}.${mode}.tokens.json`
      files.set(file, json(group(collection.name, entries, mode)))
      contexts[mode] = [{ $ref: file }]
    }
    modifiers[collection.name] = { contexts, default: modes[0]! }
    order.push({ $ref: `#/modifiers/${collection.name}` })
  }
  if (!Object.keys(modifiers).length) return { files }
  const resolver: Dtcg = {
    $schema: `https://www.designtokens.org/schemas/${DTCG_VERSION}/resolver.json`,
    version: DTCG_VERSION,
    ...(Object.keys(sets).length ? { sets } : {}),
    modifiers,
    resolutionOrder: order,
  }
  return { files, resolver: json(resolver) }
}

function json(value: JsonValue): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function group(collection: string, entries: readonly TokenEntry[], mode: string): Dtcg {
  const tokens: Dtcg = {}
  for (const entry of entries) {
    const authored = entry.valuesByMode[mode] ?? Object.values(entry.valuesByMode)[0]
    if (authored === undefined) continue
    const type = dtcgType(entry, authored)
    const token: Dtcg = { $type: type, $value: dtcgValue(authored, type) }
    if (entry.description) token.$description = entry.description
    if (entry.deprecated) token.$deprecated = true
    tokens[entry.name] = token
  }
  return { [collection]: tokens }
}

/** What a FLOAT is: a dimension unless its name or scopes say it is a bare number. */
const BARE_NUMBER = /opacity|weight|z-?index|ratio|scale|line-?height|duration|delay|zoom/i

function dtcgType(entry: TokenEntry, value: JsonValue): string {
  switch (entry.type) {
    case 'COLOR':
      return 'color'
    case 'STRING':
      return /font|family|typeface/i.test(`${entry.collection}-${entry.name}`)
        ? 'fontFamily'
        : 'string'
    case 'BOOLEAN':
      return 'boolean'
    default:
      if (isUnitLength(value)) return 'dimension'
      if (entry.scopes.some((scope) => /OPACITY|FONT_WEIGHT/.test(scope))) return 'number'
      return BARE_NUMBER.test(`${entry.collection}-${entry.name}`) ? 'number' : 'dimension'
  }
}

function dtcgValue(value: JsonValue, type: string): JsonValue {
  if (isAlias(value)) return `{${aliasTarget(value)!.replace('#', '.')}}`
  if (type === 'color' && value && typeof value === 'object' && !Array.isArray(value)) {
    const { r = 0, g = 0, b = 0, a = 1 } = value as Record<string, number>
    return { colorSpace: 'srgb', components: [r, g, b], alpha: a, hex: hex(r, g, b) }
  }
  if (type === 'dimension') {
    if (typeof value === 'number') return { value, unit: 'px' }
    const text: unknown = value
    const match = typeof text === 'string' ? /^(-?[\d.]+)(px|rem)$/.exec(text.trim()) : null
    if (match) return { value: Number(match[1]), unit: match[2]! }
  }
  return value
}

function hex(r: number, g: number, b: number): string {
  const byte = (channel: number) =>
    Math.round(Math.min(1, Math.max(0, channel)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${byte(r)}${byte(g)}${byte(b)}`
}

/* ------------------------------------------------------------------ import */

export interface DtcgImport {
  /** A `<Tokens>` page. */
  source: string
  /** Tokens left out, with why: composite types the variable model has no slot for. */
  skipped: string[]
}

/**
 * A DTCG tree, or several — one per mode — as a `<Tokens>` page. Each
 * top-level group is a collection; deeper groups flatten into the token's
 * name with `-` (`color.blue.500` → `color#blue-500`), since a variable name
 * cannot hold the address separator. Several trees become the modes of the
 * collections they share, named by `modes`, the first the default.
 */
export function fromDtcg(
  trees: readonly Dtcg[],
  options: { id?: string; modes?: readonly string[] } = {},
): DtcgImport {
  const modes = options.modes ?? trees.map((_, at) => (at === 0 ? 'default' : `mode-${at + 1}`))
  const skipped: string[] = []
  /** collection → name → { type, description, values by mode } */
  const collections = new Map<
    string,
    Map<
      string,
      { type: VariableType; description?: string; values: JsonValue[]; untyped?: boolean }
    >
  >()
  trees.forEach((tree, at) => {
    const walk = (node: Dtcg, path: string[], inherited: string | undefined): void => {
      const type = typeof node.$type === 'string' ? node.$type : inherited
      if ('$value' in node) {
        const [collection, ...rest] = path
        if (!collection || !rest.length) {
          skipped.push(`${path.join('.')}: a token needs a group to be its collection`)
          return
        }
        const converted = variableOf(type, node.$value!, path.join('.'))
        if ('skip' in converted) {
          skipped.push(converted.skip)
          return
        }
        const name = rest.join('-')
        const byName = collections.get(collection) ?? new Map()
        collections.set(collection, byName)
        const existing = byName.get(name) ?? {
          type: converted.type,
          ...(type === undefined && isDtcgAlias(node.$value!) ? { untyped: true } : {}),
          ...(typeof node.$description === 'string' ? { description: node.$description } : {}),
          values: [],
        }
        existing.values[at] = converted.value
        byName.set(name, existing)
        return
      }
      for (const [key, child] of Object.entries(node)) {
        if (key.startsWith('$') || !child || typeof child !== 'object' || Array.isArray(child))
          continue
        walk(child as Dtcg, [...path, key], type)
      }
    }
    walk(tree, [], undefined)
  })

  // An alias with no $type of its own takes its target's.
  for (const variables of collections.values()) {
    for (const variable of variables.values()) {
      if (!variable.untyped) continue
      const target = aliasTarget(variable.values.find((v) => v !== undefined) ?? '')
      if (!target) continue
      const [collection, name] = target.split('#')
      const found = collections.get(collection!)?.get(name!)
      if (found && !found.untyped) variable.type = found.type
    }
  }

  const lines = [
    '---',
    `id: ${options.id ?? 'tokens'}`,
    '---',
    '',
    'Imported from Design Tokens (DTCG) files.',
    '',
    '## Visual Contract',
    '',
    '<Tokens>',
  ]
  for (const [collection, variables] of collections) {
    const moded = trees.length > 1
    lines.push(
      moded
        ? `  <Collection name="${collection}" modes={${literal(modes as JsonValue)}}>`
        : `  <Collection name="${collection}">`,
    )
    for (const [name, variable] of variables) {
      const words = variable.description ? ` description=${literal(variable.description)}` : ''
      if (!moded) {
        lines.push(
          `    <Variable name="${name}" type="${variable.type}" value={${literal(variable.values[0]!)}}${words} />`,
        )
        continue
      }
      lines.push(`    <Variable name="${name}" type="${variable.type}"${words}>`)
      modes.forEach((mode, at) => {
        const value = variable.values[at] ?? variable.values[0]
        if (value !== undefined)
          lines.push(`      <Mode name="${mode}" value={${literal(value)}} />`)
      })
      lines.push('    </Variable>')
    }
    lines.push('  </Collection>')
  }
  lines.push('</Tokens>', '')
  return { source: lines.join('\n'), skipped }
}

function isDtcgAlias(value: JsonValue): boolean {
  return typeof value === 'string' && /^\{[^}#]+\}$/.test(value.trim())
}

function literal(value: JsonValue): string {
  return JSON.stringify(value)
}

function variableOf(
  type: string | undefined,
  value: JsonValue,
  path: string,
): { type: VariableType; value: JsonValue } | { skip: string } {
  if (typeof value === 'string' && isDtcgAlias(value)) {
    const [collection, ...rest] = value.trim().slice(1, -1).split('.')
    const target = `{${collection}#${rest.join('-')}}`
    return { type: variableType(type) ?? 'FLOAT', value: target }
  }
  switch (type) {
    case 'color': {
      const color = colorOf(value)
      return color ? { type: 'COLOR', value: color } : { skip: `${path}: unreadable color` }
    }
    case 'dimension': {
      if (typeof value === 'number') return { type: 'FLOAT', value }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const { value: amount, unit } = value as { value?: number; unit?: string }
        if (typeof amount === 'number') {
          return { type: 'FLOAT', value: unit === 'rem' ? `${amount}rem` : amount }
        }
      }
      if (typeof value === 'string') {
        const match = /^(-?[\d.]+)(px|rem)?$/.exec(value.trim())
        if (match)
          return { type: 'FLOAT', value: match[2] === 'rem' ? value.trim() : Number(match[1]) }
      }
      return { skip: `${path}: unreadable dimension` }
    }
    case 'number':
    case 'fontWeight':
      return typeof value === 'number'
        ? { type: 'FLOAT', value }
        : { skip: `${path}: ${type} is not a number` }
    case 'duration':
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const { value: amount, unit } = value as { value?: number; unit?: string }
        if (typeof amount === 'number')
          return { type: 'FLOAT', value: unit === 's' ? amount * 1000 : amount }
      }
      return { skip: `${path}: unreadable duration` }
    case 'fontFamily':
      return {
        type: 'STRING',
        value: Array.isArray(value) ? value.map(String).join(', ') : String(value),
      }
    case 'boolean':
      return typeof value === 'boolean'
        ? { type: 'BOOLEAN', value }
        : { skip: `${path}: not a boolean` }
    case 'string':
      return { type: 'STRING', value: String(value) }
    case undefined:
      if (typeof value === 'number') return { type: 'FLOAT', value }
      if (typeof value === 'string' && colorOf(value))
        return { type: 'COLOR', value: colorOf(value)! }
      if (typeof value === 'string') return { type: 'STRING', value }
      return { skip: `${path}: no $type` }
    default:
      return { skip: `${path}: "${type}" is a composite token the variable model has no slot for` }
  }
}

function variableType(type: string | undefined): VariableType | undefined {
  switch (type) {
    case 'color':
      return 'COLOR'
    case 'fontFamily':
    case 'string':
      return 'STRING'
    case 'boolean':
      return 'BOOLEAN'
    case 'dimension':
    case 'number':
    case 'fontWeight':
    case 'duration':
      return 'FLOAT'
    default:
      return undefined
  }
}

function colorOf(value: JsonValue): { r: number; g: number; b: number; a: number } | null {
  if (typeof value === 'string') {
    const match = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value.trim())
    if (!match) return null
    let digits = match[1]!
    if (digits.length <= 4) digits = [...digits].map((d) => d + d).join('')
    const channel = (at: number) => round(parseInt(digits.slice(at, at + 2), 16) / 255)
    return { r: channel(0), g: channel(2), b: channel(4), a: digits.length === 8 ? channel(6) : 1 }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const {
      colorSpace,
      components,
      alpha,
      hex: fallback,
    } = value as {
      colorSpace?: string
      components?: JsonValue[]
      alpha?: number
      hex?: string
    }
    if ((colorSpace === undefined || colorSpace === 'srgb') && Array.isArray(components)) {
      const [r, g, b] = components.map((c) => (typeof c === 'number' ? c : 0))
      return { r: round(r ?? 0), g: round(g ?? 0), b: round(b ?? 0), a: alpha ?? 1 }
    }
    if (typeof fallback === 'string') {
      const color = colorOf(fallback)
      return color ? { ...color, a: alpha ?? color.a } : null
    }
  }
  return null
}

function round(channel: number): number {
  return Math.round(channel * 1000) / 1000
}
