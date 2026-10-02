import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { exportFig } from '@uidx/agent/core'
import { loadDocs } from './components.js'
import type { Io } from '../cli.js'
import { runDesignMd } from './design-md.js'

/** `uidx export fig [--root dir] --out <dir>`: one Figma file per page. */
export async function runExport(argv: string[], io: Io): Promise<number> {
  const [format, ...rest] = argv
  if (format === 'design-md') return runDesignMd(rest, io)
  if (format !== 'fig') {
    io.err(
      'usage: uidx export fig [--root dir] --out <dir>\n       uidx export design-md [--out DESIGN.md]\n',
    )
    return 1
  }
  const { values } = parseArgs({
    args: rest,
    options: { root: { type: 'string' }, out: { type: 'string', default: 'figma' } },
  })
  const cwd = io.cwd ?? process.cwd()
  const { docs } = await loadDocs(cwd, values.root)
  const files = await exportFig(docs)
  const out = resolve(cwd, values.out!)
  for (const [name, bytes] of files) {
    const path = join(out, name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes)
  }
  io.out(
    `wrote ${files.size} .fig file${files.size === 1 ? '' : 's'} to ${values.out} — import them in Figma\n`,
  )
  return 0
}
