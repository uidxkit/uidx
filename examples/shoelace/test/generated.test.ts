import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from '@uidx/format'
import { modelIndex } from '@uidx/schema/design-system'
import { auditDesignSystem } from '@uidx/schema/design-system-audit'
import { generate } from '@uidx/codegen'

/**
 * The same rule as the design-system example (ADR 0017 §4), against a
 * library uidx does not ship: every identity passes the audit, conforms to
 * Shoelace's own manifest under the connection in `.uidx/uidx.json`, and
 * `generated/` is what the identities render to, byte for byte.
 */
const root = resolve(import.meta.dirname, '..')

async function load() {
  const config = JSON.parse(await readFile(resolve(root, '.uidx/uidx.json'), 'utf8'))
  const pages = []
  const tokens = []
  for (const name of (await readdir(resolve(root, '.uidx')))
    .filter((n) => n.endsWith('.uidx'))
    .sort()) {
    const file = `.uidx/${name}`
    const { doc, diagnostics } = parse(await readFile(resolve(root, file), 'utf8'))
    expect(diagnostics, file).toEqual([])
    if (doc!.tree.element === 'Tokens') tokens.push(doc!)
    else pages.push({ file, doc: doc! })
  }
  const manifest = JSON.parse(
    await readFile(resolve(root, '.uidx', config.headless.manifest), 'utf8'),
  )
  const options = {
    pages,
    tokens,
    manifest,
    library: { profile: config.headless.profile, components: config.headless.bindings },
    targets: config.codegen.targets,
    react: config.codegen.react,
  }
  return { options, out: resolve(root, '.uidx', config.codegen.out) }
}

describe('the Shoelace example', () => {
  it('passes the design-system audit for every page', async () => {
    const { options } = await load()
    const models = modelIndex(options.pages.map((page) => page.doc))
    for (const { file, doc } of options.pages) {
      expect(auditDesignSystem(doc, models).map((d) => `${file}: ${d.message}`)).toEqual([])
    }
  })

  it("conforms to Shoelace's manifest", async () => {
    const { options } = await load()
    const result = generate(options)
    expect(result.diagnostics.map((d) => `${d.file}: ${d.message}`)).toEqual([])
  })

  it('has generated/ up to date with .uidx/', async () => {
    const { options, out } = await load()
    for (const [path, text] of generate(options).files) {
      const existing = await readFile(resolve(out, path), 'utf8').catch(() => null)
      expect(existing, path).toBe(text)
    }
  })
})
