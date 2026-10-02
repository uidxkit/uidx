import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { parse } from '@uidx/format'
import { adoptElement } from '@uidx/schema/adopt'
import { parseHeadless } from '@uidx/schema/headless'
import type { Io } from '../cli.js'

const USAGE = 'usage: uidx adopt <custom-elements.json> [--tags a,b] [--out .uidx]\n'

/**
 * `uidx adopt`: one draft identity per root element a headless library's
 * `custom-elements.json` declares, its contract filled from the manifest.
 * Existing pages are never overwritten.
 */
export async function runAdopt(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { tags: { type: 'string' }, out: { type: 'string', default: '.uidx' } },
  })
  if (positionals.length !== 1) {
    io.err(USAGE)
    return 1
  }
  const cwd = io.cwd ?? process.cwd()
  const manifestPath = resolve(cwd, positionals[0]!)
  const library = parseHeadless(manifestPath, JSON.parse(await readFile(manifestPath, 'utf8')))
  const wanted = values.tags?.split(',').map((tag) => tag.trim())
  const roots = library.roots.filter((root) => !wanted || wanted.includes(root.tag))
  if (!roots.length) {
    io.err(`no root elements${wanted ? ` named ${wanted.join(', ')}` : ''} in ${positionals[0]}\n`)
    return 1
  }
  const out = resolve(cwd, values.out!)
  await mkdir(out, { recursive: true })
  let written = 0
  for (const root of roots) {
    const page = adoptElement(root)
    if (!parse(page.source).doc) {
      io.err(`skipped ${root.tag}: the draft did not parse\n`)
      continue
    }
    try {
      await writeFile(join(out, page.file), page.source, { flag: 'wx' })
      io.out(`${page.file}  ${page.name} implements ${root.tag}\n`)
      written++
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      io.err(`kept ${page.file}: it exists\n`)
    }
  }
  io.out(
    `wrote ${written} draft identit${written === 1 ? 'y' : 'ies'}. ` +
      `Name the library in uidx.json ("headless") so the Contract tab and codegen read it.\n`,
  )
  return 0
}
