import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { discoverManifests, matchDocument } from '../src/workspace/discover.js'

const PAGE = `---\nid: home\n---\n\n## Visual Contract\n\n<Page>\n  <Frame name="a" width={10} height={10} />\n</Page>\n`

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'uidx-agent-'))
  for (const [dir, id] of [
    ['alpha', 'alpha-doc'],
    ['beta', 'beta-doc'],
  ] as const) {
    await mkdir(join(root, dir), { recursive: true })
    await writeFile(join(root, dir, 'uidx.json'), JSON.stringify({ id, files: ['**/*.uidx'] }))
    // One page both documents hold, and one only this document holds.
    await writeFile(join(root, dir, 'home.uidx'), PAGE)
    await writeFile(join(root, dir, `${dir}-only.uidx`), PAGE)
  }
  return root
}

/** Two checkouts of one document, which is what a worktree or a build copy is. */
async function twoCopies(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'uidx-agent-copies-'))
  for (const [dir, page] of [
    ['main', 'home.uidx'],
    ['copy', 'other.uidx'],
  ] as const) {
    await mkdir(join(root, dir), { recursive: true })
    await writeFile(
      join(root, dir, 'uidx.json'),
      JSON.stringify({ id: 'uidx', files: ['**/*.uidx'] }),
    )
    await writeFile(join(root, dir, page), PAGE)
  }
  return root
}

describe('discoverManifests', () => {
  it('discovers .uidx workspaces inside projects and excludes hidden copies', async () => {
    const root = await fixture()
    for (const location of [
      '.uidx',
      'app/.uidx',
      '.worktrees/copy/.uidx',
      'dist/app/.uidx',
      'node_modules/pkg/.uidx',
    ]) {
      await mkdir(join(root, location), { recursive: true })
      await writeFile(
        join(root, location, 'uidx.json'),
        JSON.stringify({ id: location, files: ['**/*.uidx'] }),
      )
      await writeFile(join(root, location, 'home.uidx'), PAGE)
    }
    const found = await discoverManifests([root, join(root, '.uidx')])
    expect(found.map((doc) => doc.id).sort()).toEqual([
      '.uidx',
      'alpha-doc',
      'app/.uidx',
      'beta-doc',
    ])
    expect(found.find((doc) => doc.id === '.uidx')?.files).toEqual(['home.uidx'])
  })

  it('finds every document beneath the roots', async () => {
    const found = await discoverManifests([await fixture()])
    expect(found.map((f) => f.id).sort()).toEqual(['alpha-doc', 'beta-doc'])
  })

  it('lists each document members, workspace-relative', async () => {
    const found = await discoverManifests([await fixture()])
    expect(found[0]?.files).toEqual(['alpha-only.uidx', 'home.uidx'])
  })

  it('keeps the raw manifest globs, which is what authorises a write', async () => {
    const found = await discoverManifests([await fixture()])
    expect(found[0]?.globs).toEqual(['**/*.uidx'])
  })

  it('skips a manifest that fails to parse, and still finds the rest', async () => {
    const root = await fixture()
    await mkdir(join(root, 'broken'), { recursive: true })
    await writeFile(join(root, 'broken', 'uidx.json'), '{ not valid json')
    const found = await discoverManifests([root])
    expect(found.map((f) => f.id).sort()).toEqual(['alpha-doc', 'beta-doc'])
  })

  /**
   * A repository routinely holds copies of its own documents — a build output,
   * a worktree under a dot-directory — and every copy carries the same manifest
   * id. Walking into them is what made a document that is plainly the only one
   * anybody is editing look ambiguous.
   */
  it('does not go looking inside build output or hidden directories', async () => {
    const root = await fixture()
    for (const hidden of ['dist', join('.worktrees', 'wt'), join('node_modules', 'pkg')]) {
      await mkdir(join(root, hidden), { recursive: true })
      await writeFile(
        join(root, hidden, 'uidx.json'),
        JSON.stringify({ id: 'alpha-doc', files: ['**/*.uidx'] }),
      )
      await writeFile(join(root, hidden, 'home.uidx'), PAGE)
    }

    const found = await discoverManifests([root])
    expect(found.map((f) => f.id).sort()).toEqual(['alpha-doc', 'beta-doc'])
  })
})

describe('matchDocument', () => {
  it('picks the document whose manifest id the app reported', async () => {
    const found = await discoverManifests([await fixture()])
    expect(matchDocument(found, { id: 'beta-doc' }).id).toBe('beta-doc')
  })

  it('falls back to the document that contains the open page', async () => {
    const found = await discoverManifests([await fixture()])
    // No id at all — a viewer that never sent one, or one this service cannot
    // place. The page it is showing belongs to exactly one document, and that
    // is answer enough.
    expect(matchDocument(found, { page: 'beta-only.uidx' }).id).toBe('beta-doc')
  })

  it('says so when the open page belongs to more than one document', async () => {
    const found = await discoverManifests([await fixture()])
    expect(() => matchDocument(found, { page: 'home.uidx' })).toThrow(/2 uidx documents match/i)
  })

  /**
   * The one that made the README's own instructions fail. Following "start the
   * agent from the repo root" put several checkouts of one document in view,
   * and every chat message came back as an ambiguity error — even though the
   * viewer had said, in the same request, exactly which page it was showing.
   */
  it('uses the open page to tell two checkouts of one document apart', async () => {
    const found = await discoverManifests([await twoCopies()])
    expect(matchDocument(found, { id: 'uidx', page: 'home.uidx' }).dir).toMatch(/main$/)
    expect(matchDocument(found, { id: 'uidx', page: 'other.uidx' }).dir).toMatch(/copy$/)
  })

  it('gives up only when the page cannot tell them apart either', async () => {
    const root = await twoCopies()
    // Both copies now hold the same page, so nothing distinguishes them.
    await writeFile(join(root, 'copy', 'home.uidx'), PAGE)
    const found = await discoverManifests([root])
    expect(() => matchDocument(found, { id: 'uidx', page: 'home.uidx' })).toThrow(
      /2 uidx documents match id "uidx"/i,
    )
  })

  it('says how many matched and what would fix it, without handing over paths', async () => {
    const root = await twoCopies()
    await writeFile(join(root, 'copy', 'home.uidx'), PAGE)
    const found = await discoverManifests([root])

    let message = ''
    try {
      matchDocument(found, { id: 'uidx', page: 'home.uidx' })
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).toContain('UIDX_AGENT_ROOTS')
    expect(message).not.toContain(root)
    expect(message).not.toContain('/')
  })

  it('says so plainly when nothing matches', async () => {
    const found = await discoverManifests([await fixture()])
    expect(() => matchDocument(found, { id: 'nope' })).toThrow(/no uidx document/i)
  })
})
