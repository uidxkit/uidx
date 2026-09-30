import { execFile } from 'node:child_process'
import { relative } from 'node:path'
import { parseArgs } from 'node:util'
import { promisify } from 'node:util'
import { parse, type UidxDocument } from '@uidx/format'
import { designDiff, designDiffMarkdown } from '@uidx/schema/design-diff'
import { loadDocs } from './components.js'
import type { Io } from '../cli.js'

const exec = promisify(execFile)

/**
 * `uidx diff [--base origin/main] [--format md|json] [--fail-on-breaking]`:
 * the design system's changes since a git ref — removed or retyped props,
 * events, slots, model fields and tokens marked breaking — as the Markdown a
 * pull request comment carries.
 */
export async function runDiff(argv: string[], io: Io): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      base: { type: 'string', default: 'origin/main' },
      root: { type: 'string' },
      format: { type: 'string', default: 'md' },
      'fail-on-breaking': { type: 'boolean', default: false },
    },
  })
  const cwd = io.cwd ?? process.cwd()
  const { root, docs: after } = await loadDocs(cwd, values.root)
  const git = async (...args: string[]) =>
    (await exec('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 })).stdout
  const top = (await git('rev-parse', '--show-toplevel')).trim()
  const prefix = relative(top, root).replace(/\\/g, '/')
  const listed = await git('ls-tree', '-r', '--name-only', '--full-name', values.base!, '--', '.')
  const before = new Map<string, UidxDocument>()
  for (const path of listed.split('\n').filter((line) => line.endsWith('.uidx'))) {
    if (path.includes('/.uidx-agent/')) continue
    const { doc } = parse(await git('show', `${values.base}:${path}`))
    if (doc) before.set(prefix ? path.slice(prefix.length + 1) : path, doc)
  }
  const changes = designDiff(before, after)
  io.out(
    values.format === 'json'
      ? `${JSON.stringify(changes, null, 2)}\n`
      : designDiffMarkdown(changes),
  )
  return values['fail-on-breaking'] && changes.some((change) => change.breaking) ? 1 : 0
}
