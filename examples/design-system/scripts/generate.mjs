import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, formatDiagnostic } from '@uidx/format'
import { generate } from '@uidx/codegen'

/**
 * Renders `generated/` from `.uidx/` (ADR 0017): HTML/CSS, React and the
 * contract JSON, checked against the vendored headless manifest. With
 * `--check`, compares instead of writing, so CI fails when the output moved
 * without the input moving — the cross-target conformance rule (ADR 0017 §4).
 */
const root = fileURLToPath(new URL('..', import.meta.url))
const check = process.argv.includes('--check')
const out = resolve(root, 'generated')

const pages = []
const tokens = []
for (const name of (await readdir(resolve(root, '.uidx'))).filter((n) => n.endsWith('.uidx')).sort()) {
  const file = `.uidx/${name}`
  const { doc, diagnostics } = parse(await readFile(resolve(root, file), 'utf8'))
  for (const d of diagnostics) console.error(formatDiagnostic(d, file))
  if (!doc) process.exit(1)
  if (doc.tree.element === 'Tokens') tokens.push(doc)
  else pages.push({ file, doc })
}
const manifest = JSON.parse(await readFile(resolve(root, 'vendor/hwc/custom-elements.json'), 'utf8'))
const result = generate({ pages, tokens, manifest })
for (const d of result.diagnostics) console.error(formatDiagnostic(d, d.file))
if (result.diagnostics.some((d) => d.severity === 'error')) process.exit(1)

if (check) {
  let drift = 0
  for (const [path, text] of result.files) {
    const existing = await readFile(resolve(out, path), 'utf8').catch(() => null)
    if (existing !== text) {
      drift++
      console.error(`${path}: out of date`)
    }
  }
  if (drift) {
    console.error(`${drift} generated file(s) out of date; run pnpm generate`)
    process.exit(1)
  }
  console.log(`${result.files.size} generated files up to date`)
} else {
  await rm(out, { recursive: true, force: true })
  for (const [path, text] of result.files) {
    await mkdir(dirname(resolve(out, path)), { recursive: true })
    await writeFile(resolve(out, path), text)
  }
  console.log(`wrote ${result.files.size} files to generated/`)
}
