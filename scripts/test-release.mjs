import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('publishing requires a matching tag, intact tarball and shipped license notices', async () => {
  const root = await mkdtemp(join(tmpdir(), 'uidx-release-test-'))
  try {
    const stage = join(root, 'stage/package')
    const dist = join(root, 'dist/packages')
    for (const dir of [
      'scripts',
      'packages/cli',
      'dist/packages',
      'stage/package/node_modules/@uidx/viewer/dist',
    ]) {
      await mkdir(join(root, dir), { recursive: true })
    }
    await cp(
      new URL('./check-release.mjs', import.meta.url),
      join(root, 'scripts/check-release.mjs'),
    )
    for (const file of ['package.json', 'packages/cli/package.json']) {
      await writeFile(join(root, file), JSON.stringify({ version: '0.1.0' }))
    }
    await writeFile(join(root, 'packages/.DS_Store'), 'unrelated macOS metadata')
    await writeFile(
      join(stage, 'package.json'),
      JSON.stringify({
        name: '@uidxkit/uidx',
        version: '0.1.0',
        license: 'MIT',
        bundledDependencies: ['pptxgenjs', 'image-size'],
      }),
    )
    await writeFile(join(stage, 'LICENSE'), 'MIT License')
    await writeFile(join(stage, 'THIRD_PARTY_NOTICES.md'), 'Open Pencil')
    await writeFile(
      join(stage, 'node_modules/@uidx/viewer/dist/third-party-notices.txt'),
      'SIL OPEN FONT LICENSE',
    )
    const archive = join(dist, 'uidxkit-uidx-0.1.0.tgz')
    const pack = async () => {
      execFileSync('tar', ['-czf', archive, '-C', join(root, 'stage'), 'package'])
      const hash = createHash('sha256')
        .update(await readFile(archive))
        .digest('hex')
      await writeFile(`${archive}.sha256`, `${hash}  uidxkit-uidx-0.1.0.tgz\n`)
    }
    const check = (tag = 'v0.1.0') =>
      spawnSync(process.execPath, [join(root, 'scripts/check-release.mjs')], {
        env: { ...process.env, RELEASE_TAG: tag },
        encoding: 'utf8',
      })
    await pack()
    assert.equal(check().status, 0)
    assert.match(check('v0.2.0').stderr, /Tag must match/)
    await writeFile(archive, 'corrupt artifact')
    assert.match(check().stderr, /Artifact checksum mismatch/)
    const manifest = await readFile(join(stage, 'package.json'), 'utf8')
    await writeFile(join(stage, 'package.json'), manifest.replace('@uidxkit/uidx', 'uidx'))
    await pack()
    assert.notEqual(check().status, 0, 'An unscoped package must not be published')
    await writeFile(join(stage, 'package.json'), manifest)
    await rm(join(stage, 'LICENSE'))
    await pack()
    assert.notEqual(check().status, 0, 'Missing license must prevent publishing')
    await writeFile(join(root, 'package.json'), '{"version":"0.0.0"}')
    assert.match(check('v0.0.0').stderr, /Choose a release version/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
