import {
  aliasTarget,
  isAlias,
  type JsonValue,
  type UidxDocument,
  type VariableScope,
  type VariableType,
} from '@uidx/format'
import {
  IMPLICIT_MODE,
  type DependentsIndex,
  type TokenIndex,
  type TokenResolver,
} from '@uidx/schema'

/**
 * What the tokens view draws, computed away from the component (spec §§2–4):
 * collections as groups, rows in authored order, one cell per mode carrying
 * the authored value, the alias chain, and the calculated end value.
 *
 * Scoping is the per-page rule the user chose: a tokens page lists what it
 * declares; a scene page lists what it binds, grouped under the collections
 * that declare it — "what is in force here" rather than the whole document.
 */
export type TokenCategory =
  | 'color'
  | 'radius'
  | 'spacing'
  | 'size'
  | 'typography'
  | 'opacity'
  | 'stroke'
  | 'effect'
  | 'number'
  | 'text'
  | 'toggle'

export type TokenTier = 'primitive' | 'semantic' | 'component' | 'unassigned'

export interface TokenCell {
  mode: string
  /** The authored value: literal or alias string. */
  authored: JsonValue
  /** Alias chain from authored to literal — each hop's target, empty for a literal. */
  chain: readonly string[]
  /** The calculated end value, or null when the chain breaks. */
  resolved: JsonValue | null
  /** Why resolved is null, in words. */
  broken?: string
}

export interface TokenRow {
  tier?: TokenTier
  /** Display-only fallback for older files; never changes the authored scopes. */
  inferredScopes?: readonly VariableScope[]
  address: string
  name: string
  type: VariableType
  category: TokenCategory
  scopes: readonly VariableScope[]
  description: string
  deprecated: boolean
  cells: readonly TokenCell[]
  /** File that declares it — where edits go. */
  file: string
  dependents: number
}

export interface CollectionGroup {
  tier?: TokenTier
  name: string
  modes: readonly string[]
  /** File declaring the collection — where new tokens of it go. */
  file: string
  rows: readonly TokenRow[]
}

const TYPOGRAPHY_SCOPES: ReadonlySet<VariableScope> = new Set([
  'FONT_FAMILY',
  'FONT_STYLE',
  'FONT_WEIGHT',
  'FONT_SIZE',
  'LINE_HEIGHT',
  'LETTER_SPACING',
  'PARAGRAPH_SPACING',
  'PARAGRAPH_INDENT',
])

/** Type + scopes → the category a design system would file it under. */
export function categoryOf(type: VariableType, scopes: readonly VariableScope[]): TokenCategory {
  if (type === 'COLOR') return 'color'
  if (type === 'BOOLEAN') return 'toggle'
  const has = (scope: VariableScope) => scopes.includes(scope)
  if (type === 'STRING') {
    return scopes.some((s) => TYPOGRAPHY_SCOPES.has(s)) ? 'typography' : 'text'
  }
  if (has('CORNER_RADIUS')) return 'radius'
  if (has('GAP') || has('SPACING')) return 'spacing'
  if (has('WIDTH_HEIGHT')) return 'size'
  if (has('OPACITY')) return 'opacity'
  if (has('STROKE_FLOAT')) return 'stroke'
  if (has('EFFECT_FLOAT')) return 'effect'
  if (scopes.some((s) => TYPOGRAPHY_SCOPES.has(s))) return 'typography'
  return 'number'
}

export function tokensViewModel(input: {
  view: { kind: 'tokens'; file: string }
  pages: ReadonlyMap<string, UidxDocument>
  index: TokenIndex
  resolver: TokenResolver
  deps: DependentsIndex
}): CollectionGroup[] {
  const { view, pages, deps } = input
  const viewed = pages.get(view.file)
  if (!viewed) return []

  const declaringFiles = collectionFiles(pages)

  if (viewed.tree.element === 'Tokens') {
    return viewed.tree.children
      .filter((collection) => collection.element === 'Collection')
      .map((collection) => group(collection.name, view.file, null, input))
      .filter((g): g is CollectionGroup => g !== null)
  }

  // A scene page: the tokens it binds, grouped by their collections.
  const bound = new Set<string>()
  for (const [address, dependents] of deps.ofToken) {
    if (dependents.some((d) => d.file === view.file)) bound.add(address)
  }
  const collections = [...new Set([...bound].map((a) => a.slice(0, a.indexOf('#'))))]
  return collections
    .map((name) => group(name, declaringFiles.get(name) ?? view.file, bound, input))
    .filter((g): g is CollectionGroup => g !== null)
}

function group(
  name: string,
  file: string,
  only: ReadonlySet<string> | null,
  input: {
    pages: ReadonlyMap<string, UidxDocument>
    index: TokenIndex
    resolver: TokenResolver
    deps: DependentsIndex
  },
): CollectionGroup | null {
  const info = input.index.collections.get(name)
  if (!info) return null
  const declaredTier = input.pages
    .get(file)
    ?.tree.children.find((node) => node.element === 'Collection' && node.name === name)?.attrs
    .tier?.value
  // Tier is authored architecture, never guessed from a collection's name or alias depth.
  const tier: TokenTier =
    declaredTier === 'primitive' || declaredTier === 'semantic' || declaredTier === 'component'
      ? declaredTier
      : 'unassigned'
  const rows: TokenRow[] = []
  for (const entry of input.index.entries.values()) {
    if (entry.collection !== name) continue
    if (only && !only.has(entry.address)) continue
    const inferredScopes = inferVisualScopes(entry.address, input.index)
    rows.push({
      tier,
      address: entry.address,
      name: entry.name,
      type: entry.type,
      category: categoryOf(entry.type, inferredScopes ?? entry.scopes),
      ...(inferredScopes ? { inferredScopes } : {}),
      scopes: entry.scopes,
      description: entry.description,
      deprecated: entry.deprecated,
      cells: info.modes.map((mode) => cell(entry.address, mode, input.index)),
      file,
      dependents: (input.deps.ofToken.get(entry.address) ?? []).length,
    })
  }
  return { name, tier, modes: info.modes, file, rows }
}

/** Older scales predate scopes. Recognize only exact, conventional collection
 * names, or an alias whose every mode leads to the same visual scope. No token
 * name guessing: a token called `title` could be a size, color, or string. */
function inferVisualScopes(
  address: string,
  index: TokenIndex,
  seen = new Set<string>(),
): readonly VariableScope[] | undefined {
  const entry = index.entries.get(address)
  if (!entry || seen.has(address) || entry.scopes.some((scope) => scope !== 'ALL_SCOPES'))
    return undefined
  if (entry.type !== 'FLOAT') return undefined
  const convention: Record<string, VariableScope> = {
    space: 'SPACING',
    spacing: 'SPACING',
    radius: 'CORNER_RADIUS',
    type: 'FONT_SIZE',
    typography: 'FONT_SIZE',
    size: 'WIDTH_HEIGHT',
    opacity: 'OPACITY',
  }
  const scope = convention[entry.collection.toLowerCase()]
  if (scope) return [scope]
  const visited = new Set(seen).add(address)
  const modes = Object.values(entry.valuesByMode)
  if (!modes.length) return undefined
  let agreed: readonly VariableScope[] | undefined
  for (const value of modes) {
    if (!isAlias(value)) return undefined
    const targetAddress = aliasTarget(value)
    if (!targetAddress) return undefined
    const target = index.entries.get(targetAddress)
    if (!target || target.type !== entry.type) return undefined
    const scopes = target.scopes.some((item) => item !== 'ALL_SCOPES')
      ? target.scopes
      : inferVisualScopes(target.address, index, visited)
    if (!scopes || (agreed && [...agreed].sort().join() !== [...scopes].sort().join()))
      return undefined
    agreed = scopes
  }
  return agreed
}

/**
 * One mode's cell: the authored value and the chain walked to its literal.
 * The walk mirrors the resolver's, but keeps the path — the cell shows the
 * arithmetic, not only the answer.
 */
function cell(address: string, mode: string, index: TokenIndex): TokenCell {
  const entry = index.entries.get(address)!
  const authored = entry.valuesByMode[mode] ?? entry.valuesByMode[IMPLICIT_MODE] ?? null
  const chain: string[] = []
  const seen = new Set([address])
  let current: JsonValue | null = authored

  for (;;) {
    const target = current !== null && isAlias(current) ? aliasTarget(current) : null
    if (target === null) break
    if (seen.has(target)) {
      return { mode, authored, chain, resolved: null, broken: `alias cycle through ${target}` }
    }
    seen.add(target)
    chain.push(target)
    const next = index.entries.get(target)
    if (!next) {
      return {
        mode,
        authored,
        chain,
        resolved: null,
        broken: `no token at ${target}`,
      }
    }
    const info = index.collections.get(next.collection)
    const targetMode =
      next.valuesByMode[mode] !== undefined ? mode : (info?.modes[0] ?? IMPLICIT_MODE)
    current = next.valuesByMode[targetMode] ?? null
  }

  return { mode, authored, chain, resolved: current }
}

/** Which file declares each collection, for a scene view's groups. */
function collectionFiles(pages: ReadonlyMap<string, UidxDocument>): Map<string, string> {
  const files = new Map<string, string>()
  for (const [file, doc] of pages) {
    if (doc.tree.element !== 'Tokens') continue
    for (const collection of doc.tree.children) {
      if (!files.has(collection.name)) files.set(collection.name, file)
    }
  }
  return files
}
