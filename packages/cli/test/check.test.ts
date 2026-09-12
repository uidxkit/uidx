import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { check, NoMatchesError, renderJson, renderText, run, type Io } from '../src/index.js'

const VALID = `---
id: ok-button
---

## Core Intent

Fine.

## Visual Contract

<Component name="c" status="draft">
  <Frame name="root" cornerRadius={4} />
</Component>
`

const DUPLICATE_NAMES = `---
id: dupes
---

## Visual Contract

<Component name="c" status="draft">
  <Frame name="root">
    <Text name="label" characters="1" />
    <Text name="label" characters="2" />
  </Frame>
</Component>
`

const NO_CONTRACT = `---
id: bare
---

## Core Intent

Nothing else.
`

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uidx-check-'))
  await mkdir(join(dir, 'nested'), { recursive: true })
  await writeFile(join(dir, 'ok.uidx'), VALID)
  await writeFile(join(dir, 'nested', 'dupes.uidx'), DUPLICATE_NAMES)
  await writeFile(join(dir, 'nested', 'bare.uidx'), NO_CONTRACT)
  await writeFile(join(dir, 'notes.md'), '# not a uidx file')
})

const capture = () => {
  const out: string[] = []
  const err: string[] = []
  const io: Io = { out: (t) => out.push(t), err: (t) => err.push(t), cwd: dir }
  return { io, out: () => out.join(''), err: () => err.join('') }
}

describe('check', () => {
  it('passes a valid file with exit code 0', async () => {
    const result = await check(['ok.uidx'], { cwd: dir })
    expect(result.errors).toBe(0)
    expect(result.exitCode).toBe(0)
    expect(renderText(result, dir)).toContain('✔ 1 file OK')
  })

  it('reports errors and exits 1', async () => {
    const result = await check(['nested/dupes.uidx'], { cwd: dir })
    expect(result.exitCode).toBe(1)
    expect(result.errors).toBeGreaterThan(0)
    expect(renderText(result, dir)).toMatch(
      /nested\/dupes\.uidx:\d+:\d+ error UIDX102: duplicate sibling name "label"/,
    )
  })

  it('expands a bare directory to every .uidx beneath it', async () => {
    const result = await check(['.'], { cwd: dir })
    expect(result.files.map((f) => f.file).sort()).toEqual([
      'nested/bare.uidx',
      'nested/dupes.uidx',
      'ok.uidx',
    ])
  })

  it('ignores files that are not .uidx', async () => {
    const result = await check(['.'], { cwd: dir })
    expect(result.files.some((f) => f.file.endsWith('.md'))).toBe(false)
  })

  it('accepts explicit globs', async () => {
    const result = await check(['nested/*.uidx'], { cwd: dir })
    expect(result.files).toHaveLength(2)
  })

  it('treats no matches as an error rather than a silent pass', async () => {
    await expect(check(['does-not-exist/**/*.uidx'], { cwd: dir })).rejects.toThrow(NoMatchesError)
  })

  it('emits machine-readable diagnostics', async () => {
    const result = await check(['nested/dupes.uidx'], { cwd: dir })
    const json = JSON.parse(renderJson(result))
    expect(json.errors).toBeGreaterThan(0)
    expect(json.files[0].diagnostics[0]).toMatchObject({
      code: expect.stringMatching(/^UIDX\d{3}$/),
      severity: 'error',
      line: expect.any(Number),
      column: expect.any(Number),
    })
  })
})

describe('unknown-prop lint (§3.3)', () => {
  const withProp = (prop: string) => VALID.replace('cornerRadius={4}', `cornerRadius={4} ${prop}`)

  it('warns about a property outside the table, without failing', async () => {
    const lint = await mkdtemp(join(tmpdir(), 'uidx-lint-'))
    await writeFile(join(lint, 'a.uidx'), withProp('borderRadius={4}'))
    const result = await check(['.'], { cwd: lint })
    expect(result.warnings).toBe(1)
    expect(result.errors).toBe(0)
    // §3.3: unknown props are passed through, so they must not fail the build.
    expect(result.exitCode).toBe(0)
    expect(renderText(result, lint)).toMatch(/warning UIDX300: unknown property "borderRadius"/)
  })

  it('stays quiet for the documented vocabulary', async () => {
    const lint = await mkdtemp(join(tmpdir(), 'uidx-lint-'))
    await writeFile(join(lint, 'a.uidx'), withProp('strokeAlign="INSIDE" opacity={0.5}'))
    expect((await check(['.'], { cwd: lint })).warnings).toBe(0)
  })

  it('never flags name, which every element carries', async () => {
    const lint = await mkdtemp(join(tmpdir(), 'uidx-lint-'))
    await writeFile(join(lint, 'a.uidx'), VALID)
    expect((await check(['.'], { cwd: lint })).warnings).toBe(0)
  })
})

describe('document-wide uniqueness (§3.2, ADR 0004 §2)', () => {
  /** A second page differing in both its id and its component name. */
  const other = VALID.replace('id: ok-button', 'id: other-button').replace(
    'name="c"',
    'name="other"',
  )

  it('flags two pages claiming the same id', async () => {
    const dupe = await mkdtemp(join(tmpdir(), 'uidx-ids-'))
    await writeFile(join(dupe, 'a.uidx'), VALID)
    await writeFile(join(dupe, 'b.uidx'), VALID) // same frontmatter id
    const result = await check(['.'], { cwd: dupe })
    expect(result.exitCode).toBe(1)
    expect(renderText(result, dupe)).toMatch(/duplicate page id "ok-button"/)
  })

  it('flags two pages declaring the same component name', async () => {
    const dupe = await mkdtemp(join(tmpdir(), 'uidx-names-'))
    await writeFile(join(dupe, 'a.uidx'), VALID)
    // Different page id, same component name — global naming makes this a clash.
    await writeFile(join(dupe, 'b.uidx'), VALID.replace('id: ok-button', 'id: other-button'))
    const result = await check(['.'], { cwd: dupe })
    expect(result.exitCode).toBe(1)

    const text = renderText(result, dupe)
    expect(text).toMatch(/duplicate component name "c"/)
    // Both declarations are named, and the message suggests the way out.
    expect(text).toMatch(/also declared at a\.uidx:\d+:\d+/)
    expect(text).toMatch(/group them with "\/"/)
  })

  it('is happy when ids and component names both differ', async () => {
    const fine = await mkdtemp(join(tmpdir(), 'uidx-ids-'))
    await writeFile(join(fine, 'a.uidx'), VALID)
    await writeFile(join(fine, 'b.uidx'), other)
    expect((await check(['.'], { cwd: fine })).exitCode).toBe(0)
  })

  it('collects every component into the symbol table', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'uidx-symbols-'))
    await writeFile(join(dir, 'a.uidx'), VALID)
    await writeFile(join(dir, 'b.uidx'), other)
    const { symbols } = await check(['.'], { cwd: dir })

    expect(symbols.entries.map((e) => e.name).sort()).toEqual(['c', 'other'])
    expect(symbols.get('other')).toMatchObject({ kind: 'component', file: 'b.uidx' })
    expect(symbols.get('nope')).toBeUndefined()
  })
})

describe('cli', () => {
  it('exits 0 and prints the summary for a clean file', async () => {
    const { io, out } = capture()
    expect(await run(['check', 'ok.uidx'], io)).toBe(0)
    expect(out()).toContain('✔ 1 file OK')
  })

  it('exits 1 and prints diagnostics on stdout for a broken file', async () => {
    const { io, out, err } = capture()
    expect(await run(['check', 'nested/dupes.uidx'], io)).toBe(1)
    expect(out()).toContain('UIDX102')
    expect(err()).toBe('')
  })

  it('sends operational failures to stderr', async () => {
    const { io, out, err } = capture()
    expect(await run(['check', 'nope/*.uidx'], io)).toBe(1)
    expect(err()).toContain('no .uidx files matched')
    expect(out()).toBe('')
  })

  it('rejects an unknown --format', async () => {
    const { io, err } = capture()
    expect(await run(['check', 'ok.uidx', '--format', 'yaml'], io)).toBe(1)
    expect(err()).toContain('--format must be')
  })

  it('rejects an unknown command', async () => {
    const { io, err } = capture()
    expect(await run(['frobnicate'], io)).toBe(1)
    expect(err()).toContain('unknown command')
  })

  it('shows usage on --help and on no arguments', async () => {
    const help = capture()
    expect(await run(['--help'], help.io)).toBe(0)
    expect(help.out()).toContain('uidx check')

    const bare = capture()
    expect(await run([], bare.io)).toBe(1)
    expect(bare.err()).toContain('Usage:')
  })
})
