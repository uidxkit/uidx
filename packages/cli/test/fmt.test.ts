import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { parse } from '@uidx/format'
import { applyFmt, fmt, migrateSource, run, type Io } from '../src/index.js'

/** Exactly what a file looked like before ADR 0003 — the migration's real input. */
const LEGACY = `---
id: legacy-button
status: stable
version: 1.2.0
tags: [cta]
---

## Core Intent

Draws focus.

## Visual Contract

<Component>
  <Frame name="container" layoutMode="HORIZONTAL" cornerRadius={8}>
    <Text name="label" characters="Click Me" />
  </Frame>
</Component>
`

const CURRENT = `---
id: modern
---

## Core Intent

Fine already.

## Visual Contract

<Page>
  <Component name="Card" status="draft">
    <Frame name="root" layoutMode="VERTICAL">
      <Text name="a" characters="A" />
    </Frame>
  </Component>
</Page>
`

let dir: string
const write = (name: string, body: string) => writeFile(join(dir, name), body, 'utf8')
const read = (name: string) => readFile(join(dir, name), 'utf8')

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uidx-fmt-'))
})

describe('migrateSource', () => {
  it('names the root component from the frontmatter id', () => {
    expect(migrateSource(LEGACY)).toContain('<Component name="legacy-button"')
  })

  it('moves status and version onto the element and out of the frontmatter', () => {
    const out = migrateSource(LEGACY)
    expect(out).toContain('status="stable"')
    expect(out).toContain('version="1.2.0"')
    expect(out).not.toMatch(/^status:/m)
    expect(out).not.toMatch(/^version:/m)
  })

  it('leaves unrelated frontmatter keys alone', () => {
    expect(migrateSource(LEGACY)).toMatch(/^tags: \[cta\]$/m)
  })

  it('produces something the current parser accepts', () => {
    const { doc, diagnostics } = parse(migrateSource(LEGACY))
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(doc!.tree.element).toBe('Page')
    expect(doc!.tree.children[0]!.name).toBe('legacy-button')
  })

  it('is a no-op on a file that already parses', () => {
    expect(migrateSource(CURRENT)).toBe(CURRENT)
  })
})

describe('uidx fmt', () => {
  it('reports a canonical file as unchanged', async () => {
    // Round-trip first, so the fixture is canonical by construction rather than
    // by me guessing the emitter's exact style.
    await write('a.uidx', CURRENT)
    const planned = await fmt(['.'], { cwd: dir })
    await applyFmt(planned, dir)

    const again = await fmt(['.'], { cwd: dir })
    expect(again.files[0]!.status).toBe('unchanged')
    expect(again.changed).toBe(0)
    expect(again.exitCode).toBe(0)
  })

  it('is idempotent — a second run changes nothing', async () => {
    await write('a.uidx', CURRENT)
    await applyFmt(await fmt(['.'], { cwd: dir }), dir)
    const once = await read('a.uidx')
    await applyFmt(await fmt(['.'], { cwd: dir }), dir)
    expect(await read('a.uidx')).toBe(once)
  })

  it('--check writes nothing but fails when a file would change', async () => {
    await write('a.uidx', CURRENT.replace('<Page>', '<Page >'))
    const result = await fmt(['.'], { cwd: dir, check: true })
    expect(result.changed).toBe(1)
    expect(result.exitCode).toBe(1)
    expect(await read('a.uidx')).toContain('<Page >')
  })

  it('refuses a file it cannot parse, and says why', async () => {
    await write('bad.uidx', LEGACY)
    const result = await fmt(['.'], { cwd: dir })
    expect(result.files[0]!.status).toBe('failed')
    expect(result.exitCode).toBe(1)
    expect(result.files[0]!.diagnostics!.map((d) => d.code)).toContain('UIDX101')
  })

  it('--migrate takes a legacy file all the way to canonical', async () => {
    await write('legacy.uidx', LEGACY)
    const result = await fmt(['.'], { cwd: dir, migrate: true })
    expect(result.files[0]!.status).toBe('migrated')
    await applyFmt(result, dir)

    const out = await read('legacy.uidx')
    expect(parse(out).diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(out).toContain('<Page>')
    expect(out).toContain('status="stable"')
    // The intent region survives a migration untouched (§3.1).
    expect(out).toContain('Draws focus.')
  })

  it('reports a file that migration still cannot rescue', async () => {
    await write('hopeless.uidx', LEGACY.replace('<Text name="label"', '<Blob name="label"'))
    const result = await fmt(['.'], { cwd: dir, migrate: true })
    expect(result.files[0]!.status).toBe('failed')
    expect(result.files[0]!.diagnostics!.map((d) => d.code)).toContain('UIDX100')
  })
})

describe('the fmt CLI', () => {
  const ioFor = (answer?: boolean) => {
    const out: string[] = []
    const err: string[] = []
    const io: Io = {
      out: (t) => out.push(t),
      err: (t) => err.push(t),
      cwd: dir,
      confirm: answer === undefined ? undefined : async () => answer,
    }
    return { io, out, err }
  }

  it('prompts before overwriting, and writes nothing when declined', async () => {
    await write('a.uidx', CURRENT.replace('<Page>', '<Page >'))
    const { io, out } = ioFor(false)
    expect(await run(['fmt', '.'], io)).toBe(1)
    expect(out.join('')).toContain('nothing written')
    expect(await read('a.uidx')).toContain('<Page >')
  })

  it('writes when the prompt is accepted', async () => {
    await write('a.uidx', CURRENT.replace('<Page>', '<Page >'))
    const { io } = ioFor(true)
    expect(await run(['fmt', '.'], io)).toBe(0)
    expect(await read('a.uidx')).not.toContain('<Page >')
  })

  it('--yes skips the prompt', async () => {
    await write('a.uidx', CURRENT.replace('<Page>', '<Page >'))
    const { io } = ioFor(undefined)
    expect(await run(['fmt', '.', '--yes'], io)).toBe(0)
    expect(await read('a.uidx')).not.toContain('<Page >')
  })

  it('refuses to write with no terminal and no --yes', async () => {
    await write('a.uidx', CURRENT.replace('<Page>', '<Page >'))
    const { io, err } = ioFor(undefined)
    expect(await run(['fmt', '.'], io)).toBe(1)
    expect(err.join('')).toContain('--yes')
    expect(await read('a.uidx')).toContain('<Page >')
  })

  it('errors when nothing matches', async () => {
    const { io, err } = ioFor(true)
    expect(await run(['fmt', 'nope/**/*.uidx'], io)).toBe(1)
    expect(err.join('')).toContain('no .uidx files matched')
  })
})
