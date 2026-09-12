import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  discoverMemories,
  memoryTools,
  MEMORY_DIR,
  renderMemoryListing,
} from '../src/memory/shelf.js'

const run = async (tool: { execute?: unknown }, input: unknown): Promise<string> =>
  (tool.execute as (i: unknown, o: unknown) => Promise<string>)(input, {
    toolCallId: 't',
    messages: [],
  })

async function shelf(name: string, body: string) {
  const root = await mkdtemp(join(tmpdir(), 'uidx-memory-'))
  await mkdir(join(root, name), { recursive: true })
  await writeFile(join(root, name, 'SKILL.md'), body)
  return discoverMemories([{ dir: root, origin: 'docroot' }])
}

describe('the memory shelf', () => {
  const LESSON = `---
name: element-not-type
description: A node in an edit op is {element}, never {type}.
---

The field is \`element\`, and its value comes from a fixed list.
`

  it('lists a memory by its description, the way skills are listed', async () => {
    const listing = renderMemoryListing(await shelf('element-not-type', LESSON))
    expect(listing).toContain('element-not-type')
    expect(listing).toContain('never {type}')
  })

  it('reads one on demand and no sooner', async () => {
    const memories = await shelf('element-not-type', LESSON)
    // The entry carries a path, never the body — the same rule the skills
    // shelf follows, and the reason a shelf costs nothing until it is used.
    expect(JSON.stringify(memories)).not.toContain('fixed list')
    const { use_memory } = memoryTools({ memories: () => memories, maxChars: 10_000 })
    expect(await run(use_memory, { name: 'element-not-type' })).toContain('The field is `element`')
  })

  it('names the memories that do exist when asked for one that does not', async () => {
    const memories = await shelf('element-not-type', LESSON)
    const { use_memory } = memoryTools({ memories: () => memories, maxChars: 10_000 })
    expect(await run(use_memory, { name: 'nope' })).toContain('element-not-type')
  })

  it('describes itself as memory rather than as a skill', async () => {
    const { use_memory } = memoryTools({ memories: () => [], maxChars: 10_000 })
    expect((use_memory as { description?: string }).description).toContain('got wrong before')
  })
})

/**
 * The shipped lessons, checked against the harness they describe. Each was
 * written from a correction measured on the wire this week, and a lesson that
 * drifts from the schema it teaches is worse than none — a model that follows
 * it confidently gets a refusal it was told would not come.
 */
describe('the memories this repo ships', () => {
  const dir = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    '.uidx-agent',
    MEMORY_DIR,
  )

  it('discovers every one of them, each with a name and a description', async () => {
    const memories = await discoverMemories([{ dir, origin: 'docroot' }])
    const names = memories.map((m) => m.name).sort()
    expect(names).toEqual([
      'insert-node-takes-element',
      'page-root-is-empty-string',
      'text-says-characters',
    ])
    for (const memory of memories) expect(memory.description.length).toBeGreaterThan(20)
  })

  it('has a directory for every memory and no strays', async () => {
    const dirs = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
    expect(dirs).toHaveLength(3)
  })

  it('teaches the field name the schema actually uses', async () => {
    const body = await readFile(join(dir, 'insert-node-takes-element', 'SKILL.md'), 'utf8')
    expect(body).toContain('"element"')
    // The aliases it promises have to be the ones `narrowOps` accepts.
    const root = await readFile(join(dir, 'page-root-is-empty-string', 'SKILL.md'), 'utf8')
    for (const alias of ['"/"', '"page"', '"root"']) expect(root).toContain(alias)
  })

  it('fits the listing without crowding out the skills beside it', async () => {
    const listing = renderMemoryListing(await discoverMemories([{ dir, origin: 'docroot' }]))
    expect(listing.length).toBeLessThan(600)
    expect(listing).not.toContain('not listed')
  })
})
