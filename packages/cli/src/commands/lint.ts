import { readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { glob } from 'tinyglobby'
import { appLintContext, lintAppSource, type AppFinding } from '@uidx/agent/core'
import { loadDocs } from './components.js'
import type { Io } from '../cli.js'

const SOURCES = '**/*.{ts,tsx,js,jsx,mjs,css,scss,vue,svelte,html,astro}'

/**
 * `uidx lint [path...] [--root dir] [--format json]`: application code checked
 * against the design system — colour literals a token names, raw elements a
 * component stands for. Exits 1 on any finding, so it can gate CI.
 */
export async function runLint(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { root: { type: 'string' }, format: { type: 'string', default: 'text' } },
  })
  const cwd = io.cwd ?? process.cwd()
  const { docs } = await loadDocs(cwd, values.root)
  const context = appLintContext(docs)
  const bases = positionals.length ? positionals : ['src']
  const findings: AppFinding[] = []
  let scanned = 0
  for (const base of bases) {
    const dir = resolve(cwd, base)
    const files = await glob([SOURCES], {
      cwd: dir,
      ignore: ['**/node_modules/**', '**/dist/**', '**/.uidx/**', '**/*.d.ts'],
    })
    for (const file of files.sort()) {
      const path = resolve(dir, file)
      scanned++
      findings.push(...lintAppSource(relative(cwd, path), await readFile(path, 'utf8'), context))
    }
  }
  if (values.format === 'json') io.out(`${JSON.stringify(findings, null, 2)}\n`)
  else {
    for (const f of findings) io.out(`${f.file}:${f.line}:${f.column} ${f.rule} ${f.message}\n`)
    io.out(
      findings.length
        ? `✖ ${findings.length} finding${findings.length === 1 ? '' : 's'} in ${scanned} files\n`
        : `✔ ${scanned} files on-system\n`,
    )
  }
  return findings.length ? 1 : 0
}
