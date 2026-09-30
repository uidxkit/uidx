import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { formatDiagnostic, parse, type JsonValue, type UidxDocument } from '@uidx/format'
import { fromDtcg, toDtcg } from '@uidx/schema/dtcg'
import { buildTokenIndex } from '@uidx/schema/token-index'
import { expand } from './check.js'
import type { Io } from '../cli.js'

const USAGE =
  'usage: uidx tokens import <file.json...> [--out tokens.uidx] [--modes light,dark] [--id tokens]\n' +
  '       uidx tokens export [glob...] --out <dir>\n'

/**
 * `uidx tokens import|export`: the document's tokens as Design Tokens (DTCG
 * 2025.10) files, and DTCG files — a Figma variables export, Tokens Studio,
 * Style Dictionary sources, a resolver document — as a `<Tokens>` page.
 */
export async function runTokens(argv: string[], io: Io): Promise<number> {
  const [verb, ...rest] = argv
  if (verb === 'import') return importTokens(rest, io)
  if (verb === 'export') return exportTokens(rest, io)
  io.err(USAGE)
  return 1
}

type Tree = { [key: string]: JsonValue }

async function importTokens(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string', default: 'tokens.uidx' },
      modes: { type: 'string' },
      id: { type: 'string', default: 'tokens' },
    },
  })
  if (!positionals.length) {
    io.err(USAGE)
    return 1
  }
  const cwd = io.cwd ?? process.cwd()
  let trees: Tree[] = []
  let modes = values.modes?.split(',').map((mode) => mode.trim())
  for (const file of positionals) {
    const path = resolve(cwd, file)
    const tree = JSON.parse(await readFile(path, 'utf8')) as Tree
    if (Array.isArray(tree.resolutionOrder)) {
      const resolved = await fromResolver(tree, dirname(path))
      trees = resolved.trees
      modes ??= resolved.modes
      continue
    }
    trees.push(tree)
  }
  // Several files without modes are one set, merged in order.
  if (!modes && trees.length > 1) trees = [Object.assign({}, ...trees) as Tree]
  const { source, skipped } = fromDtcg(trees, {
    id: values.id!,
    ...(modes ? { modes } : {}),
  })
  const { doc, diagnostics } = parse(source)
  if (!doc) {
    for (const d of diagnostics) io.err(`${formatDiagnostic(d, values.out!)}\n`)
    return 1
  }
  const out = resolve(cwd, values.out!)
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, source, { flag: 'wx' }).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error
    throw new Error(`${values.out} exists; choose another --out`)
  })
  const count = buildTokenIndex([doc]).entries.size
  io.out(`wrote ${count} tokens to ${values.out}\n`)
  for (const reason of skipped) io.err(`skipped ${reason}\n`)
  return 0
}

/**
 * A resolver document with one modifier (the usual light/dark): each context
 * is a mode, and every set is merged beneath each of them.
 */
async function fromResolver(doc: Tree, base: string): Promise<{ trees: Tree[]; modes: string[] }> {
  const load = async (refs: JsonValue): Promise<Tree> => {
    const merged: Tree = {}
    for (const source of Array.isArray(refs) ? refs : []) {
      if (!source || typeof source !== 'object' || Array.isArray(source)) continue
      const ref = (source as Tree).$ref
      const tree =
        typeof ref === 'string'
          ? ref.startsWith('#/sets/')
            ? await load(((doc.sets as Tree)[ref.slice(7)] as Tree).sources ?? [])
            : (JSON.parse(await readFile(join(base, ref), 'utf8')) as Tree)
          : (source as Tree)
      deepMerge(merged, tree)
    }
    return merged
  }
  const sets: Tree = {}
  for (const set of Object.values((doc.sets ?? {}) as Tree))
    deepMerge(sets, await load((set as Tree).sources ?? []))
  const modifiers = Object.values((doc.modifiers ?? {}) as Tree)
  if (modifiers.length > 1)
    throw new Error('a resolver with more than one modifier: import each context file directly')
  const modifier = modifiers[0] as Tree | undefined
  if (!modifier) return { trees: [sets], modes: ['default'] }
  const contexts = (modifier.contexts ?? {}) as Tree
  const names = Object.keys(contexts)
  const first = typeof modifier.default === 'string' ? modifier.default : names[0]!
  const modes = [first, ...names.filter((name) => name !== first)]
  const trees: Tree[] = []
  for (const mode of modes) {
    const tree = structuredClone(sets)
    deepMerge(tree, await load(contexts[mode] ?? []))
    trees.push(tree)
  }
  return { trees, modes }
}

function deepMerge(into: Tree, from: Tree): void {
  for (const [key, value] of Object.entries(from)) {
    const current = into[key]
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !('$value' in value) &&
      current &&
      typeof current === 'object' &&
      !Array.isArray(current)
    )
      deepMerge(current as Tree, value as Tree)
    else into[key] = value
  }
}

async function exportTokens(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { out: { type: 'string' } },
  })
  if (!values.out) {
    io.err(USAGE)
    return 1
  }
  const cwd = io.cwd ?? process.cwd()
  const files = await expand(positionals.length ? positionals : ['**/*.uidx'], cwd)
  const docs: UidxDocument[] = []
  for (const file of files) {
    const { doc } = parse(await readFile(resolve(cwd, file), 'utf8'))
    if (doc?.tree.element === 'Tokens') docs.push(doc)
  }
  if (!docs.length) {
    io.err('no <Tokens> page matched\n')
    return 1
  }
  const exported = toDtcg(buildTokenIndex(docs))
  const out = resolve(cwd, values.out)
  await mkdir(out, { recursive: true })
  for (const [name, text] of exported.files) await writeFile(join(out, name), text)
  if (exported.resolver) await writeFile(join(out, 'resolver.json'), exported.resolver)
  io.out(
    `wrote ${exported.files.size} token file${exported.files.size === 1 ? '' : 's'}` +
      `${exported.resolver ? ' and resolver.json' : ''} to ${values.out}\n`,
  )
  return 0
}
