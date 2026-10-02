import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { formatDiagnostic, parse, type UidxDocument, type UidxNode } from '@uidx/format'
import { contractJson } from '@uidx/schema/design-system'
import type { Io } from '../cli.js'

/**
 * `uidx contract <page.uidx...>` — the spec regions as JSON (ADR 0017 §3).
 *
 * For generators and agents that do not parse MDX: one object per page with
 * the contract, behaviour, models, examples and styles as written, source
 * spans dropped, plus each component's name, headless root, bound parts and
 * tree slots. A page that fails to parse is reported and the command exits 1.
 *
 * A composition's outer box is in the component it holds (ADR 0018 §2), so
 * the pages are read first and each one's components are found across all.
 */
export async function runContract(argv: string[], io: Io): Promise<number> {
  const files = argv.filter((arg) => !arg.startsWith('--'))
  if (files.length === 0) {
    io.err('uidx contract <page.uidx...>\n')
    return 1
  }
  const cwd = io.cwd ?? process.cwd()
  const pages: { file: string; doc: UidxDocument }[] = []
  let failed = false
  for (const file of files) {
    const source = await readFile(resolve(cwd, file), 'utf8')
    const { doc, diagnostics } = parse(source)
    for (const d of diagnostics) io.err(`${formatDiagnostic(d, file)}\n`)
    if (!doc) {
      failed = true
      continue
    }
    pages.push({ file, doc })
  }
  const components = new Map<string, UidxNode>()
  for (const { doc } of pages)
    for (const node of doc.tree.children)
      if (node.element === 'Component') components.set(node.name, node)
  const out = pages.map(({ file, doc }) => ({ file, ...contractJson(doc, components) }))
  io.out(`${JSON.stringify(out.length === 1 ? out[0] : out, null, 2)}\n`)
  return failed ? 1 : 0
}
