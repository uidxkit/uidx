import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))
const pkg = await readJson(join(root, 'package.json'))
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, 'This workflow publishes stable semver releases')
assert.notEqual(pkg.version, '0.0.0', 'Choose a release version before publishing')
assert.equal(process.env.RELEASE_TAG, `v${pkg.version}`, 'Tag must match the package version')
for (const dir of await readdir(join(root, 'packages'), { withFileTypes: true })) {
  if (!dir.isDirectory()) continue
  assert.equal(
    (await readJson(join(root, 'packages', dir.name, 'package.json'))).version,
    pkg.version,
  )
}
const destination = join(root, 'dist/packages')
const archives = (await readdir(destination)).filter((file) => file.endsWith('.tgz'))
const name = `uidxkit-uidx-${pkg.version}.tgz`
assert.deepEqual(archives, [name], 'Publish exactly one tested tarball')
const archive = join(destination, name)
const hash = createHash('sha256')
  .update(await readFile(archive))
  .digest('hex')
assert.equal(
  await readFile(`${archive}.sha256`, 'utf8'),
  `${hash}  ${name}\n`,
  'Artifact checksum mismatch',
)
const extract = (path) =>
  execFileSync('tar', ['-xOf', archive, `package/${path}`], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  })
const shipped = JSON.parse(extract('package.json'))
assert.equal(shipped.name, '@uidxkit/uidx')
assert.equal(shipped.version, pkg.version)
assert.equal(shipped.license, 'MIT')
assert.match(extract('LICENSE'), /MIT License/)
assert.match(extract('THIRD_PARTY_NOTICES.md'), /Open Pencil/)
assert.match(
  extract('node_modules/@uidx/viewer/dist/third-party-notices.txt'),
  /SIL OPEN FONT LICENSE/,
)
assert(shipped.bundledDependencies.includes('image-size'))
assert(shipped.bundledDependencies.includes('pptxgenjs'))
console.log(`Verified release artifact: ${name}`)
