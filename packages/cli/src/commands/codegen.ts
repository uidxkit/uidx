import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { glob } from 'tinyglobby'
import { formatDiagnostic, parse, type UidxDocument } from '@uidx/format'
import { generate, type Manifest, type Target } from '@uidx/codegen'
import { findManifest } from '@uidx/server'
import type { Io } from '../cli.js'

/**
 * `uidx codegen <glob...> --out <dir> [--target html,react,contract] [--manifest custom-elements.json]`
 *
 * Renders the code targets (ADR 0017 §3) for every page matched. Token pages
 * among the matches become `tokens.css`. With a manifest, each component's
 * contract is checked against its headless element first, and a mismatch
 * fails the run without writing.
 */
export async function runCodegen(argv: string[], io: Io): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: 'string' },
        target: { type: 'string', default: 'html,react,contract' },
        manifest: { type: 'string' },
        check: { type: 'boolean', default: false },
      },
    })
  } catch (err) {
    io.err(`${(err as Error).message}\n`)
    return 1
  }
  const cwd = io.cwd ?? process.cwd()
  const out = parsed.values.out
  if (!out && !parsed.values.check) {
    io.err(
      'uidx codegen <glob...> --out <dir> [--target html,react,contract] [--manifest custom-elements.json] [--check]\n',
    )
    return 1
  }
  const patterns = parsed.positionals.length ? parsed.positionals : ['**/*.uidx']
  const files = (
    await glob(patterns, { cwd, ignore: ['**/node_modules/**', '**/.uidx-agent/**'] })
  ).sort()
  if (files.length === 0) {
    io.err(`no .uidx files matched ${patterns.join(', ')}\n`)
    return 1
  }
  const pages: { file: string; doc: UidxDocument }[] = []
  const tokens: UidxDocument[] = []
  let failed = false
  for (const file of files) {
    const { doc, diagnostics } = parse(await readFile(resolve(cwd, file), 'utf8'))
    for (const d of diagnostics)
      if (d.severity === 'error') io.err(`${formatDiagnostic(d, file)}\n`)
    if (!doc) {
      failed = true
      continue
    }
    if (doc.tree.element === 'Tokens') tokens.push(doc)
    else pages.push({ file, doc })
  }
  if (failed) return 1

  // The flag wins; otherwise the document's own `headless` (uidx.json) names
  // the library, so a checked-in config and the viewer's Contract tab read the
  // same file this command checks against.
  let manifestPath = parsed.values.manifest ? resolve(cwd, parsed.values.manifest) : undefined
  if (!manifestPath) {
    const found = await findManifest(cwd)
    if (found?.manifest.headless) manifestPath = resolve(found.dir, found.manifest.headless)
  }
  let manifest: Manifest | undefined
  if (manifestPath) {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest
  }
  const targets = parsed.values.target!.split(',').map((t) => t.trim()) as Target[]
  for (const target of targets) {
    if (!['html', 'react', 'contract'].includes(target)) {
      io.err(`unknown target "${target}"; choose from html, react, contract\n`)
      return 1
    }
  }

  const result = generate({ pages, tokens, manifest, targets })
  for (const d of result.diagnostics) io.err(`${formatDiagnostic(d, d.file)}\n`)
  if (result.diagnostics.some((d) => d.severity === 'error')) return 1

  if (parsed.values.check) {
    // Compare against what is on disk: a generator whose output moved without
    // its input moving is the drift ADR 0017 §4 exists to catch.
    let drifted = 0
    for (const [path, text] of result.files) {
      const existing = out
        ? await readFile(resolve(cwd, out, path), 'utf8').catch(() => null)
        : null
      if (existing !== text) {
        drifted++
        io.err(`${path}: differs from the generated output\n`)
      }
    }
    if (drifted) {
      io.err(`${drifted} generated file(s) out of date; run uidx codegen to update them\n`)
      return 1
    }
    io.out(`${result.files.size} generated files up to date\n`)
    return 0
  }

  for (const [path, text] of result.files) {
    const target = resolve(cwd, out!, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, text)
  }
  io.out(`wrote ${result.files.size} files to ${out}\n`)
  return 0
}
