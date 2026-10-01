import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, formatDiagnostic } from '@uidx/format'
import { generate } from '@uidx/codegen'

/**
 * Renders `generated/` from `.uidx/`, the way the viewer's Get code button
 * does: the library, its naming profile and each component's names in it
 * come from `.uidx/uidx.json`, as the Connect tab wrote them. With
 * `--check`, compares instead of writing, so a test fails when the design
 * moved and the code did not.
 */
const root = fileURLToPath(new URL('..', import.meta.url))
const check = process.argv.includes('--check')
const config = JSON.parse(await readFile(resolve(root, '.uidx/uidx.json'), 'utf8'))
const out = resolve(root, '.uidx', config.codegen.out)

const pages = []
const tokens = []
for (const name of (await readdir(resolve(root, '.uidx')))
  .filter((n) => n.endsWith('.uidx'))
  .sort()) {
  const file = `.uidx/${name}`
  const { doc, diagnostics } = parse(await readFile(resolve(root, file), 'utf8'))
  for (const d of diagnostics) console.error(formatDiagnostic(d, file))
  if (!doc) process.exit(1)
  if (doc.tree.element === 'Tokens') tokens.push(doc)
  else pages.push({ file, doc })
}
const headless =
  typeof config.headless === 'string' ? { manifest: config.headless } : config.headless
const manifest = JSON.parse(await readFile(resolve(root, '.uidx', headless.manifest), 'utf8'))
const result = generate({
  pages,
  tokens,
  manifest,
  library: { profile: headless.profile, components: headless.bindings },
  targets: config.codegen.targets,
  react: config.codegen.react,
})
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
  console.log(`wrote ${result.files.size} files to ${config.codegen.out}`)
}
