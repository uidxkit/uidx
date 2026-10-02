import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { parse, type UidxDocument } from '@uidx/format'
import {
  describeComponent,
  listComponents,
  listTokens,
  resolveDocumentRoot,
} from '@uidx/agent/core'
import { expand } from './check.js'
import type { Io } from '../cli.js'

/** Every page of the document around `cwd`, parsed; unparseable pages are left out. */
export async function loadDocs(
  cwd: string,
  rootArg?: string,
): Promise<{ root: string; docs: Map<string, UidxDocument> }> {
  const root = await resolveDocumentRoot(resolve(cwd, rootArg ?? '.'))
  const docs = new Map<string, UidxDocument>()
  for (const file of await expand(['**/*.uidx'], root)) {
    if (file.includes('/.uidx-agent/')) continue
    const { doc } = parse(await readFile(resolve(root, file), 'utf8'))
    if (doc) docs.set(file, doc)
  }
  return { root, docs }
}

/** `uidx components [--root dir] [--json]`: the design system's components, one line each. */
export async function runComponents(argv: string[], io: Io): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { root: { type: 'string' }, json: { type: 'boolean', default: false } },
  })
  const { docs } = await loadDocs(io.cwd ?? process.cwd(), values.root)
  const list = listComponents(docs)
  if (values.json) io.out(`${JSON.stringify(list, null, 2)}\n`)
  else
    for (const item of list)
      io.out(
        `${item.name}${item.status ? ` (${item.status})` : ''} — ${item.summary}\n  props: ${item.props.join(', ') || 'none'}\n`,
      )
  return 0
}

/** `uidx component <Name> [--root dir] [--from dir]`: one component's contract and usage, as JSON. */
export async function runComponent(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { root: { type: 'string' }, from: { type: 'string' } },
  })
  if (positionals.length !== 1) {
    io.err('usage: uidx component <Name> [--root dir] [--from dir]\n')
    return 1
  }
  const cwd = io.cwd ?? process.cwd()
  const { root, docs } = await loadDocs(cwd, values.root)
  const detail = await describeComponent(
    docs,
    root,
    positionals[0]!,
    resolve(cwd, values.from ?? '.'),
  )
  io.out(`${JSON.stringify(detail, null, 2)}\n`)
  return 0
}

/** `uidx tokens list [--mode collection=mode ...] [--root dir]`: every token resolved, as JSON. */
export async function runTokenList(argv: string[], io: Io): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { root: { type: 'string' }, mode: { type: 'string', multiple: true } },
  })
  const modes: Record<string, string> = {}
  for (const pair of values.mode ?? []) {
    const [collection, mode] = pair.split('=')
    if (!collection || !mode) {
      io.err(`--mode takes collection=mode, got "${pair}"\n`)
      return 1
    }
    modes[collection] = mode
  }
  const { docs } = await loadDocs(io.cwd ?? process.cwd(), values.root)
  io.out(`${JSON.stringify(listTokens(docs, modes), null, 2)}\n`)
  return 0
}
