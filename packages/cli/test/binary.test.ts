import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'

const run = promisify(execFile)

/**
 * These run the *built* CLI, not the source.
 *
 * The unit tests import `run()` directly and pass while the shipped binary is
 * broken: bundling turned a transitive CJS dependency into a dynamic `require`
 * that throws before any of our code executes. Only executing the artifact
 * catches that class of bug.
 */
const BIN = fileURLToPath(new URL('../dist/uidx.js', import.meta.url))
const REPO = fileURLToPath(new URL('../../../', import.meta.url))

const exec = async (args: string[], cwd = REPO) => {
  try {
    const { stdout, stderr } = await run(process.execPath, [BIN, ...args], { cwd })
    return { code: 0, stdout, stderr }
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string }
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

let badDir: string

beforeAll(async () => {
  badDir = await mkdtemp(join(tmpdir(), 'uidx-bin-'))
  await writeFile(
    join(badDir, 'bad.uidx'),
    `---
id: bad
---

## Visual Contract

<Component name="c" status="draft">
  <Frame name="a">
    <Text name="dup" characters="1" />
    <Text name="dup" characters="2" />
  </Frame>
</Component>
`,
  )
})

describe('built binary', () => {
  it('has been built', () => {
    expect(existsSync(BIN), 'run `pnpm --filter uidx build` first').toBe(true)
  })

  it('starts without a module-resolution error', async () => {
    const { code, stdout, stderr } = await exec(['--version'])
    expect(stderr).not.toMatch(/Dynamic require|Cannot find module|ERR_MODULE_NOT_FOUND/)
    expect(code).toBe(0)
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    expect(stdout.trim()).toBe(pkg.version)
  })

  it('checks a valid document and exits 0', async () => {
    const file = join(badDir, 'valid.uidx')
    await writeFile(file, '---\nid: valid\n---\n\n## Visual Contract\n\n<Page></Page>\n')
    const { code, stdout, stderr } = await exec(['check', file])
    expect(stderr).toBe('')
    expect(stdout).toContain('OK')
    expect(code).toBe(0)
  })

  it('exits 1 with diagnostics on a broken file', async () => {
    const { code, stdout } = await exec(['check', '.'], badDir)
    expect(stdout).toMatch(/bad\.uidx:\d+:\d+ error UIDX102/)
    expect(code).toBe(1)
  })

  it('emits parseable json', async () => {
    const { stdout } = await exec(['check', '.', '--format', 'json'], badDir)
    const parsed = JSON.parse(stdout)
    expect(parsed.errors).toBeGreaterThan(0)
    expect(parsed.files[0].file).toBe('bad.uidx')
  })
})
