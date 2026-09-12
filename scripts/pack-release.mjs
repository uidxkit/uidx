import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const destination = resolve(root, 'dist/packages')
// Only current release artifacts belong here (including after a package rename).
await rm(destination, { recursive: true, force: true })
await mkdir(destination, { recursive: true })
const scratch = await mkdtemp(join(tmpdir(), 'uidx-pack-'))
const stage = join(scratch, 'release')
const bundled = new Map()
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const rootManifest = await manifest(root)

async function manifest(dir) {
  return JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
}

async function dependencyRoot(from, name) {
  const require = createRequire(join(from, 'package.json'))
  for (const dir of require.resolve.paths(name) ?? []) {
    const candidate = join(dir, name)
    try {
      if ((await manifest(candidate)).name === name) return await realpath(candidate)
    } catch {
      /* Try the next Node resolution directory. */
    }
  }
  throw new Error(`Cannot locate ${name} from ${from}`)
}

async function bundleDependency(source) {
  const pkg = await manifest(source)
  const target = join(stage, 'node_modules', pkg.name)
  await cp(source, target, {
    recursive: true,
    filter: (entry) => basename(entry) !== 'node_modules',
  })
  if (pkg.name.startsWith('@open-pencil/')) {
    await cp(join(root, 'third-party/licenses/open-pencil-MIT.txt'), join(target, 'LICENSE'))
  }
  bundled.set(pkg.name, pkg)
}

try {
  // pnpm translates workspace references and selects only published files.
  // Stage our packages together so every consumer uses one patched SDK instance.
  for (const name of ['cli', 'format', 'schema', 'server', 'agent', 'viewer']) {
    const cwd = resolve(root, 'packages', name)
    const pkg = await manifest(cwd)
    if (pkg.private) throw new Error(`${pkg.name} is private`)
    execFileSync('pnpm', ['pack', '--pack-destination', scratch], { cwd, stdio: 'pipe' })
    const archive = join(
      scratch,
      `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`,
    )
    const target = name === 'cli' ? stage : join(stage, 'node_modules', pkg.name)
    await mkdir(target, { recursive: true })
    execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', target], {
      env: { ...process.env, LC_ALL: 'C' },
    })
    if (name !== 'cli') bundled.set(pkg.name, await manifest(target))
  }

  // pnpm's workspace patches are not carried by normal npm dependencies.
  // Copy the installed, patched packages with their licenses and runtime assets.
  const schema = join(root, 'packages/schema')
  const core = await dependencyRoot(schema, '@open-pencil/core')
  const pptx = await dependencyRoot(core, 'pptxgenjs')
  const imageSize = await dependencyRoot(pptx, 'image-size')
  for (const spec of Object.keys(rootManifest.pnpm.patchedDependencies)) {
    const name = spec.replace(/@[^/]+$/, '')
    await bundleDependency(name === 'image-size' ? imageSize : await dependencyRoot(schema, name))
  }
  // Keep the patched image parser beside its importer so npm cannot resolve an
  // unpatched copy outside this bundle.
  await bundleDependency(pptx)

  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'third-party']) {
    await cp(join(root, name), join(stage, name), { recursive: true })
  }

  const pkg = await manifest(stage)
  pkg.files.push('THIRD_PARTY_NOTICES.md', 'third-party')
  // Overrides in this workspace do not apply to an npm consumer. Encode the
  // reviewed replacements in each shipped manifest as well as the root one.
  for (const item of [pkg, ...bundled.values()]) {
    for (const [name, range] of Object.entries(rootManifest.pnpm.overrides)) {
      if (item.dependencies?.[name]) item.dependencies[name] = range
    }
    if (item !== pkg) {
      await writeFile(
        join(stage, 'node_modules', item.name, 'package.json'),
        `${JSON.stringify(item, null, 2)}\n`,
      )
    }
  }
  // External dependencies stay under npm's control, including platform-specific
  // Vite/esbuild binaries. Promote the bundles' requirements so npm installs them
  // even though their parent packages are already present in this tarball.
  const dependencies = { ...pkg.dependencies }
  for (const item of bundled.values()) {
    for (const [name, range] of Object.entries(item.dependencies ?? {})) {
      if (bundled.has(name)) continue
      if (dependencies[name] && dependencies[name] !== range) {
        throw new Error(
          `Conflicting runtime ranges for ${name}: ${dependencies[name]} and ${range}`,
        )
      }
      dependencies[name] = range
    }
  }
  for (const [name, item] of bundled) dependencies[name] = item.version
  pkg.dependencies = dependencies
  pkg.bundledDependencies = [...bundled.keys()]
  await writeFile(join(stage, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
  execFileSync(npm, ['pack', '--ignore-scripts', '--pack-destination', destination], {
    cwd: stage,
    env: { ...process.env, npm_config_cache: join(scratch, 'npm-cache') },
    stdio: 'pipe',
  })
  const archiveName = `uidx-${pkg.version}.tgz`
  const digest = createHash('sha256')
    .update(await readFile(join(destination, archiveName)))
    .digest('hex')
  await writeFile(join(destination, `${archiveName}.sha256`), `${digest}  ${archiveName}\n`)
  console.log(`Release tarball: ${join(destination, archiveName)}`)
} finally {
  await rm(scratch, { recursive: true, force: true })
}
