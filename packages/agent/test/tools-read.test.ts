import { describe, expect, it } from 'vitest'

import { budgetFor } from '../src/index/budget.js'
import { createStepBudget } from '../src/agent/step-budget.js'
import { readTools } from '../src/tools/read.js'
import { docsFixture } from './fixtures/docs.js'

const docs = docsFixture()

const workspace = {
  docOf: (file: string) => docs.get(file) ?? null,
  sourceOf: (file: string) => docs.get(file)?.source ?? null,
  members: () => [...docs.keys()].sort(),
}

const tools = () => readTools({ workspace, budget: budgetFor(16_384) })

// A budget built straight from a char count, not `budgetFor` — `budgetFor`
// clamps every window up to `MIN_WINDOW_TOKENS` (2,048 tokens, ~6,350
// characters), so it can never produce a `readChars` small enough to exercise
// the "too large" path against these tiny fixtures. Every field is set to the
// same `n` because these tests only ever probe one of them at a time.
const toolsWithBudget = (n: number) =>
  readTools({ workspace, budget: { windowTokens: n, packChars: n, outlineChars: n, readChars: n } })

const run = async (tool: { execute?: unknown }, input: unknown): Promise<string> => {
  const execute = tool.execute as (i: unknown, o: unknown) => Promise<string>
  return execute(input, { toolCallId: 't', messages: [] })
}

describe('read', () => {
  it('returns the exact source of a node', async () => {
    const out = await run(tools().read, { file: 'home.uidx', address: 'hero' })
    expect(out).toContain('name="hero"')
    expect(out).toContain('name="headline"')
  })

  it('returns a whole file when no address is given', async () => {
    const out = await run(tools().read, { file: 'tokens.uidx' })
    expect(out).toContain('<Tokens>')
  })

  // An address that misses used to end at the string that failed, leaving the
  // model to guess the grammar. The tree is right there.
  it('names what exists when an address does not resolve', async () => {
    const out = await run(tools().read, { file: 'home.uidx', address: 'hero#missing' })
    expect(out).toContain('hero holds hero#headline')
  })

  it('says what is available when the file is unknown', async () => {
    const out = await run(tools().read, { file: 'nope.uidx' })
    expect(out).toMatch(/no such page/i)
    expect(out).toContain('home.uidx')
  })

  it('says so when the address is not on that page', async () => {
    const out = await run(tools().read, { file: 'home.uidx', address: 'ghost' })
    expect(out).toMatch(/no node/i)
  })

  it('outlines a whole page instead of dumping it when the source exceeds the budget', async () => {
    const out = await run(toolsWithBudget(200).read, { file: 'home.uidx' })
    expect(out).toMatch(/outline|too large/i)
    expect(out).toContain('hero')
    expect(out.length).toBeLessThan(1_000)
  })

  it('still returns the whole page when it comfortably fits', async () => {
    const out = await run(tools().read, { file: 'tokens.uidx' })
    expect(out).toContain('<Tokens>')
  })

  it('returns an outline on request, without the node bodies', async () => {
    const out = await run(tools().read, { file: 'home.uidx', address: 'hero', mode: 'outline' })
    expect(out).toContain('hero#headline')
    expect(out).not.toContain('Welcome')
  })

  it('returns a single line in signature mode', async () => {
    const out = await run(tools().read, { file: 'home.uidx', address: 'hero', mode: 'signature' })
    expect(out.split('\n')).toHaveLength(1)
  })

  it('describes a node neighbourhood: its ancestors and its children', async () => {
    const out = await run(tools().read, {
      file: 'home.uidx',
      address: 'hero#headline',
      neighbourhood: true,
    })
    expect(out).toMatch(/within|ancestors/i)
    expect(out).toContain('hero')
  })

  it('outlines an oversized node instead of dumping it, in default mode', async () => {
    // hero's own source (~174 chars) exceeds this 100-char budget, the same
    // way the whole file can exceed the file-level budget.
    const out = await run(toolsWithBudget(100).read, { file: 'home.uidx', address: 'hero' })
    expect(out).toMatch(/refused/i)
    expect(out).not.toContain('cornerRadius')
    expect(out).toContain('hero#headline')
  })

  it('honours mode without an address instead of silently falling back to source', async () => {
    const out = await run(tools().read, { file: 'home.uidx', mode: 'signature' })
    expect(out.split('\n')).toHaveLength(1)
    expect(out).toContain('(page)')
  })

  it('honours neighbourhood without an address instead of silently ignoring it', async () => {
    const out = await run(tools().read, { file: 'home.uidx', neighbourhood: true })
    expect(out).toMatch(/within|ancestors/i)
    expect(out).toContain('hero')
    expect(out).toContain('revenue')
  })
})

describe('search', () => {
  it('finds a literal across every page and reports the enclosing address', async () => {
    const out = await run(tools().search, { query: 'Welcome' })
    expect(out).toContain('home.uidx')
    expect(out).toContain('hero#headline')
  })

  it('supports a regular expression', async () => {
    const out = await run(tools().search, { query: 'fontSize=\\{\\d+\\}', regex: true })
    expect(out).toContain('home.uidx')
  })

  it('says plainly when nothing matched', async () => {
    expect(await run(tools().search, { query: 'zzz-not-here' })).toMatch(/no matches/i)
  })

  it('caps the number of hits so a broad query cannot flood the context', async () => {
    const out = await run(tools().search, { query: 'name', limit: 2 })
    // Exactly two. `toBeLessThanOrEqual(4)` passed against the very off-by-one
    // it was there to catch.
    expect(out.split('\n').filter((line) => line.includes(':')).length).toBe(2)
  })

  it('refuses an empty query instead of scanning forever', async () => {
    const out = await run(tools().search, { query: '' })
    expect(out).toMatch(/empty/i)
  }, 1000)

  it('reports an invalid regex as text instead of throwing', async () => {
    const out = await run(tools().search, { query: '(', regex: true })
    expect(out).toMatch(/invalid regex/i)
  })

  it('refuses a regex query past the length cap', async () => {
    const out = await run(tools().search, { query: 'a'.repeat(500), regex: true })
    expect(out).toMatch(/too long/i)
  })
})

/**
 * `ai@7` runs one step's tool calls under `Promise.all`, and `readChars` sizes
 * exactly one read — two together measured roughly 27% over the window, ending
 * the turn on `finishReason: length` with nothing in the loop saying why.
 */
describe('the per-step read budget', () => {
  const budget = { windowTokens: 4_000, packChars: 4_000, outlineChars: 400, readChars: 400 }
  const withBudget = () => {
    const stepBudget = createStepBudget()
    return { stepBudget, tools: readTools({ workspace, budget, stepBudget }) }
  }

  it('lets the first read through and spends what it returned', async () => {
    const { tools, stepBudget } = withBudget()
    const out = await run(tools.read, { file: 'home.uidx', address: 'hero#headline' })
    expect(out).toContain('name="headline"')
    expect(stepBudget.spent).toBe(out.length)
  })

  it('refuses a second read that would not fit, naming what is left', async () => {
    const { tools, stepBudget } = withBudget()
    stepBudget.spent = 399
    const out = await run(tools.read, { file: 'home.uidx', address: 'hero' })
    expect(out).toContain('this step has 1 left')
    expect(out).toContain('ask again on your next step')
  })

  it('refuses outright once nothing is left, without reading at all', async () => {
    const { tools, stepBudget } = withBudget()
    stepBudget.spent = 400
    const out = await run(tools.read, { file: 'home.uidx', address: 'hero' })
    expect(out).toContain('already read its fill')
    expect(out).not.toContain('name="hero"')
  })

  // An outline squeezed into a nearly-spent step is noise, not help, so the
  // step refusal stands on its own — while a genuinely oversize node still
  // gets its outline when the step can afford one.
  it('does not pad a step refusal with a starved outline', async () => {
    const { tools, stepBudget } = withBudget()
    stepBudget.spent = 399
    const out = await run(tools.read, { file: 'home.uidx', address: 'hero' })
    expect(out).not.toContain('<Frame>')
    expect(out.length).toBeLessThan(200)
  })

  // `left` can never exceed `readChars`, so the floor only bites when
  // `readChars` is itself below it — which no real window is. At a realistic
  // one, an oversize node still gets its outline.
  it('still outlines an oversize node while the step can afford one', async () => {
    const tools = readTools({
      workspace,
      budget: { windowTokens: 4_000, packChars: 4_000, outlineChars: 400, readChars: 250 },
      stepBudget: createStepBudget(),
    })
    const out = await run(tools.read, { file: 'components.uidx' })
    expect(out).toContain('over the 250-character read limit')
    expect(out).toContain('<Component>')
  })

  it('starts fresh when the step resets', async () => {
    const { tools, stepBudget } = withBudget()
    stepBudget.spent = 400
    stepBudget.spent = 0
    expect(await run(tools.read, { file: 'home.uidx', address: 'hero#headline' })).toContain(
      'name="headline"',
    )
  })

  // A tool built with no budget is one used outside a loop, where there is no
  // step to spend.
  it('never refuses on these grounds when no step budget was given', async () => {
    const plain = readTools({ workspace, budget })
    await run(plain.read, { file: 'home.uidx', address: 'hero' })
    expect(await run(plain.read, { file: 'home.uidx', address: 'hero' })).toContain('name="hero"')
  })
})
