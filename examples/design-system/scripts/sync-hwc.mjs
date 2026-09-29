import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Vendors the built headless components (`@hwc/components`) into
 * `vendor/hwc`, until the package is published. Run from a machine that has
 * the headless repository checked out; `HWC_DIR` points at its
 * `packages/components`. The copied files are committed, so a checkout of
 * this repository needs nothing outside it.
 */
const root = fileURLToPath(new URL('..', import.meta.url))
const source = resolve(
  process.env.HWC_DIR ?? resolve(root, '../../../headless-web-components/packages/components'),
)
const target = resolve(root, 'vendor/hwc')

await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
await cp(resolve(source, 'dist'), resolve(target, 'dist'), {
  recursive: true,
  filter: (path) => !/\.(test|map)\.(js|d\.ts)$|\.d\.ts\.map$/.test(path),
})
await cp(resolve(source, 'custom-elements.json'), resolve(target, 'custom-elements.json'))
const pkg = JSON.parse(await readFile(resolve(source, 'package.json'), 'utf8'))
await writeFile(
  resolve(target, 'VENDORED.md'),
  `# Vendored ${pkg.name}\n\nCopied from a local checkout of the headless-web-components repository by\n\`scripts/sync-hwc.mjs\`. Remove this folder and depend on the published package\nonce it exists on npm.\n`,
)
console.log(`vendored ${pkg.name} into vendor/hwc`)
