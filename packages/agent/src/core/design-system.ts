import { readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import type { JsonValue, UidxDocument } from '@uidx/format'
import {
  buildTokenIndex,
  contractJson,
  defaultTuple,
  mergeModes,
  TokenResolver,
} from '@uidx/schema'

/**
 * The design system as a coding agent consumes it while building a product
 * feature — not while editing designs. Three questions, each answered from the
 * identities and nothing else: which components exist, what exactly does one
 * accept and how is it used, and what does each token resolve to. The
 * answers carry the words and the rules, so an agent never has to invent a
 * prop, guess a state or hard-code a colour.
 */

export interface ComponentSummary {
  name: string
  file: string
  status: string | null
  implements: string | null
  /** The first sentence of the component's intent. */
  summary: string
  props: string[]
  /** Axis → values, `state` included, as the canvas draws the set. */
  axes: Record<string, string[]>
}

function componentsOf(docs: ReadonlyMap<string, UidxDocument>) {
  const out: { file: string; doc: UidxDocument; name: string }[] = []
  for (const [file, doc] of docs) {
    if (doc.tree.element !== 'Page') continue
    for (const node of doc.tree.children)
      if (node.element === 'Component') out.push({ file, doc, name: node.name })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function intentOf(doc: UidxDocument): string {
  return doc.intent.raw
    .split('\n')
    .filter((line) => !/^#{1,6}\s/.test(line))
    .join('\n')
    .trim()
}

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const end = flat.search(/[.!?](\s|$)/)
  return end === -1 ? flat : flat.slice(0, end + 1)
}

export function listComponents(docs: ReadonlyMap<string, UidxDocument>): ComponentSummary[] {
  return componentsOf(docs).map(({ file, doc, name }) => {
    const json = contractJson(doc) as {
      components?: {
        name: string
        status?: string
        implements?: string
        axes?: Record<string, string[]>
      }[]
    }
    const component = json.components?.find((entry) => entry.name === name)
    return {
      name,
      file,
      status: component?.status ?? null,
      implements: component?.implements ?? null,
      summary: firstSentence(intentOf(doc)),
      props: (doc.spec?.contract?.props ?? []).map((prop) => prop.name),
      axes: component?.axes ?? {},
    }
  })
}

export interface ComponentDetail {
  name: string
  file: string
  intent: string
  /** `uidx contract`'s JSON: contract, behaviour, models, examples, styles. */
  contract: Record<string, unknown>
  /** Where the generated React component is imported from, when the project generates code. */
  import: string | null
  /** A usage line with every required prop given its sample. */
  usage: string
}

/**
 * One component, everything a caller needs: its words, its contract, its
 * behaviour rules, and how to import and call the generated component.
 * `from` is the directory the caller will import from (defaults to the
 * project root), so the import path is ready to paste.
 */
export async function describeComponent(
  docs: ReadonlyMap<string, UidxDocument>,
  root: string,
  name: string,
  from?: string,
): Promise<ComponentDetail> {
  const found = componentsOf(docs).find((entry) => entry.name === name)
  if (!found) {
    const names = componentsOf(docs).map((entry) => entry.name)
    throw new Error(
      `no component named "${name}"; the document declares ${names.join(', ') || 'none'}`,
    )
  }
  const { file, doc } = found
  const contract = contractJson(doc)
  const out = await codegenOut(root)
  const identifier = name.replace(
    /[^A-Za-z0-9]+(.)?/g,
    (_, c: string | undefined) => c?.toUpperCase() ?? '',
  )
  let importLine: string | null = null
  if (out) {
    let path = relative(resolve(from ?? join(root, '..')), join(out, 'react')).replace(/\\/g, '/')
    if (!path.startsWith('.')) path = `./${path}`
    importLine = `import { ${identifier} } from '${path}'`
  }
  const attrs: string[] = []
  for (const prop of doc.spec?.contract?.props ?? []) {
    const value: JsonValue | undefined =
      prop.sample ?? (prop.default === undefined ? undefined : null)
    if (value === undefined || value === null) continue
    attrs.push(
      typeof value === 'string'
        ? `${prop.name}="${value}"`
        : `${prop.name}={${JSON.stringify(value)}}`,
    )
  }
  return {
    name,
    file,
    intent: intentOf(doc),
    contract,
    import: importLine,
    usage: `<${identifier}${attrs.length ? ` ${attrs.join(' ')}` : ''} />`,
  }
}

/** `uidx.json`'s `codegen.out`, resolved, or null when the project generates no code. */
async function codegenOut(root: string): Promise<string | null> {
  try {
    const manifest = JSON.parse(await readFile(join(root, 'uidx.json'), 'utf8')) as {
      codegen?: { out?: string }
    }
    return manifest.codegen?.out ? resolve(root, manifest.codegen.out) : null
  } catch {
    return null
  }
}

export interface TokenRow {
  token: string
  type: string
  /** The resolved value in the requested modes; colours as `#rrggbb` or `rgba(…)`. */
  value: JsonValue
  /** The alias it is written as, when it is one. */
  alias: string | null
  /** The CSS custom property the code targets emit for it. */
  css: string
  description: string
}

/**
 * Every token, resolved. `modes` picks a mode per collection
 * (`{ color: 'dark' }`); unnamed collections use their default.
 */
export function listTokens(
  docs: ReadonlyMap<string, UidxDocument>,
  modes: Record<string, string> = {},
): TokenRow[] {
  const index = buildTokenIndex([...docs.values()])
  const tuple = mergeModes(defaultTuple(index), modes, index)
  const resolved = new TokenResolver(index).resolve(tuple)
  const rows: TokenRow[] = []
  for (const entry of index.entries.values()) {
    const mode = tuple.get(entry.collection) ?? Object.keys(entry.valuesByMode)[0]!
    const authored = entry.valuesByMode[mode] ?? Object.values(entry.valuesByMode)[0]
    rows.push({
      token: entry.address,
      type: entry.type,
      value: display(resolved.get(entry.address) ?? null),
      alias: typeof authored === 'string' && authored.startsWith('{') ? authored : null,
      css: `var(--${entry.address.replace('#', '-')})`,
      description: entry.description,
    })
  }
  return rows
}

function display(value: JsonValue): JsonValue {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'r' in value) {
    const { r = 0, g = 0, b = 0, a = 1 } = value as Record<string, number>
    const byte = (c: number) => Math.round(c * 255)
    if (a === 1) return `#${[r, g, b].map((c) => byte(c).toString(16).padStart(2, '0')).join('')}`
    return `rgba(${byte(r)}, ${byte(g)}, ${byte(b)}, ${a})`
  }
  return value
}
