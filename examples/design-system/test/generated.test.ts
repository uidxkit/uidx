import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from '@uidx/format'
import { auditDesignSystem } from '@uidx/schema/design-system-audit'
import { generate } from '@uidx/codegen'

/**
 * The cross-target conformance rule (ADR 0017 §4): the committed output is
 * what the identities render to, byte for byte, and every identity passes
 * the design-system audit against the vendored headless manifest.
 */
const root = resolve(import.meta.dirname, '..')

async function load() {
  const pages = []
  const tokens = []
  for (const name of (await readdir(resolve(root, '.uidx'))).filter((n) => n.endsWith('.uidx')).sort()) {
    const file = `.uidx/${name}`
    const { doc, diagnostics } = parse(await readFile(resolve(root, file), 'utf8'))
    expect(diagnostics, file).toEqual([])
    if (doc!.tree.element === 'Tokens') tokens.push(doc!)
    else pages.push({ file, doc: doc! })
  }
  const manifest = JSON.parse(await readFile(resolve(root, 'vendor/hwc/custom-elements.json'), 'utf8'))
  return { pages, tokens, manifest }
}

describe('the example design system', () => {
  it('passes the design-system audit for every page', async () => {
    const { pages } = await load()
    for (const { file, doc } of pages) {
      expect(auditDesignSystem(doc).map((d) => `${file}: ${d.message}`)).toEqual([])
    }
  })

  it('conforms to the headless manifest', async () => {
    const { pages, tokens, manifest } = await load()
    const result = generate({ pages, tokens, manifest, targets: ['contract'] })
    expect(result.diagnostics.map((d) => `${d.file}: ${d.message}`)).toEqual([])
  })

  it('has generated/ up to date with .uidx/', async () => {
    const { pages, tokens, manifest } = await load()
    const result = generate({ pages, tokens, manifest })
    for (const [path, text] of result.files) {
      const existing = await readFile(resolve(root, 'generated', path), 'utf8').catch(() => null)
      expect(existing, path).toBe(text)
    }
  })
})
