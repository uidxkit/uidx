import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
export function dependencyRoot(from, name) {
  const require = createRequire(join(from, 'package.json'))
  for (const path of require.resolve.paths(name) ?? []) {
    try {
      const candidate = join(path, name)
      JSON.parse(readFileSync(join(candidate, 'package.json'), 'utf8'))
      return realpathSync(candidate)
    } catch {
      /* Continue Node's dependency search. */
    }
  }
  throw new Error(`Cannot find ${name} from ${from}`)
}

export function verifyDependencyFixes(from = join(root, 'packages/schema')) {
  const core = dependencyRoot(from, '@open-pencil/core')
  const pptx = dependencyRoot(core, 'pptxgenjs')
  const imageSize = dependencyRoot(pptx, 'image-size')
  assert.equal(JSON.parse(readFileSync(join(imageSize, 'package.json'), 'utf8')).version, '1.2.1')
  // These hashes intentionally change only after review of a new parser patch.
  const hashes = {
    'icns.js': '60a7b5794ca5f1752a686e69b147903ab058e06fca8c12e8db2c84077c48bf1d',
    'utils.js': '18783b9474eece928097f115b36ff8c69cc465bdbfa30cf15de44da8c8b87bb2',
  }
  for (const [file, expected] of Object.entries(hashes)) {
    const actual = createHash('sha256')
      .update(readFileSync(join(imageSize, 'dist/types', file)))
      .digest('hex')
    assert.equal(actual, expected, `Missing reviewed image-size patch: ${file}`)
  }
  const result = spawnSync(
    process.execPath,
    [join(root, 'scripts/test-image-size.mjs'), imageSize],
    { timeout: 5000, encoding: 'utf8' },
  )
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  const require = createRequire(join(core, 'package.json'))
  const expr = dependencyRoot(core, 'expr-eval')
  const exprPkg = JSON.parse(readFileSync(join(expr, 'package.json'), 'utf8'))
  assert.equal(exprPkg.name, 'expr-eval-fork')
  assert.equal(exprPkg.version, '3.0.3')
  assert.equal(new (require('expr-eval').Parser)().evaluate('2 + 3 * 4'), 14)
  const xml = dependencyRoot(core, '@xmldom/xmldom')
  assert.equal(JSON.parse(readFileSync(join(xml, 'package.json'), 'utf8')).version, '0.9.12')
  return imageSize
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyDependencyFixes(
    process.argv[2] ? dirname(resolve(process.argv[2], 'package.json')) : undefined,
  )
  console.log('Dependency patches and replacement packages verified.')
}
