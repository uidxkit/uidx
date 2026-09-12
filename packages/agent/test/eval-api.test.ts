import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `eval-api.d.ts` is the contract an agent reads before writing a script; the
 * sandbox in `src/core/eval.ts` is what actually runs it. Documentation that
 * drifts from the implementation teaches lies, so this test holds the two
 * together mechanically: every sandbox global and every op-builder method
 * must be declared in the contract, and vice versa.
 */
const HERE = join(fileURLToPath(new URL('.', import.meta.url)), '..')

const GLOBALS = ['doc', 'pages', 'visit', 'find', 'ops', 'console'] as const
const BUILDER = ['set', 'removeProp', 'insert', 'remove', 'move', 'rename'] as const

describe('the eval API contract', () => {
  it('declares every sandbox global, and nothing else', async () => {
    const contract = await readFile(join(HERE, 'eval-api.d.ts'), 'utf8')
    for (const name of GLOBALS.filter((g) => g !== 'console')) {
      expect(contract).toMatch(new RegExp(`declare function ${name}\\(`))
    }
    expect(contract).toContain('declare namespace console')
    const declared = [...contract.matchAll(/declare (?:function|namespace) (\w+)/g)].map(
      (m) => m[1],
    )
    expect(declared.sort()).toEqual([...GLOBALS].sort())
  })

  it('declares every op-builder method the sandbox offers', async () => {
    const contract = await readFile(join(HERE, 'eval-api.d.ts'), 'utf8')
    const sandbox = await readFile(join(HERE, 'src/core/eval.ts'), 'utf8')
    for (const method of BUILDER) {
      expect(contract).toMatch(new RegExp(`${method}\\(`))
      expect(sandbox).toMatch(new RegExp(`${method}: \\(`))
    }
    // And the sandbox offers nothing the contract does not name.
    const offered = [...sandbox.matchAll(/^\s{8}(\w+): \(/gm)].map((m) => m[1])
    expect(offered.sort()).toEqual([...BUILDER].sort())
  })

  it('states the five semantics an agent must know', async () => {
    const contract = await readFile(join(HERE, 'eval-api.d.ts'), 'utf8')
    expect(contract).toContain('Reads are a snapshot')
    expect(contract).toContain('queued, then gated')
    expect(contract).toContain('one synchronous function body')
    expect(contract).toContain('Compose big structures in memory')
    expect(contract).toContain('one section per script')
  })
})
