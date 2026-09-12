import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

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

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'uidx-memory-'))
  roots.push(root)
  return root
}

async function shelf(name: string, body: string) {
  const root = await project()
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

describe('project memories', () => {
  it('starts empty in a fresh project without a memory directory', async () => {
    const dir = join(await project(), '.uidx-agent', MEMORY_DIR)
    const memories = await discoverMemories([{ dir, origin: 'docroot' }])
    expect(memories).toEqual([])
    const { use_memory } = memoryTools({ memories: () => memories, maxChars: 10_000 })
    expect(await run(use_memory, { name: 'missing' })).toContain('missing')
  })

  it('discovers and reads a project-authored lesson without repository-local state', async () => {
    const dir = join(await project(), '.uidx-agent', MEMORY_DIR)
    const file = join(dir, 'prefer-tokens', 'SKILL.md')
    await mkdir(join(dir, 'prefer-tokens'), { recursive: true })
    await writeFile(
      file,
      `---
name: prefer-tokens
description: Use the project tokens when assigning a color.
---
Resolve the shared token before changing a fill.
`,
    )
    const memories = await discoverMemories([{ dir, origin: 'docroot' }])
    expect(memories.map((memory) => memory.name)).toEqual(['prefer-tokens'])
    expect(renderMemoryListing(memories)).toContain('Use the project tokens')
    const { use_memory } = memoryTools({ memories: () => memories, maxChars: 10_000 })
    expect(await run(use_memory, { name: 'prefer-tokens' })).toContain('Resolve the shared token')
  })
})
