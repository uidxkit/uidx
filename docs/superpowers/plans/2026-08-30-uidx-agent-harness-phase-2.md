# UIDX Agent Harness — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a single small local model carry out long, high-quality authoring tasks — by teaching it to read large documents selectively, teaching it the house idiom, letting a task outlive one context, and letting it hand small units of work to fresh contexts.

**Architecture:** Four additions to `packages/agent`, strictly dependency-ordered. Context discipline (outline reads + adaptive budget) makes large documents navigable. Skills teach the idiom without growing the prompt. A durable plan file plus step compaction makes the loop unbounded. Sequential single-model delegation keeps each unit's working out of the orchestrator's context.

**Tech Stack:** TypeScript 5.7 ESM, `ai@7.0.84`, `zod@4`, Vitest 2.1.8, Vue 3.5 (viewer panel).

**Spec:** `docs/superpowers/specs/2026-08-30-uidx-agent-harness-phase-2-design.md`

**Covers spec items §1–§4.** Items §5 (`view_image`), §6 (memory) and §7 (`web_search`) get a follow-on plan once these land — they improve judgement, while these determine whether the model can act at all.

## Global Constraints

- **Node:** prefix EVERY test/build/typecheck command with `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH";` — the default Node 18 fails with `ERR_REQUIRE_ESM`.
- **Modules:** relative imports inside `packages/agent/src` and its tests carry the `.js` extension. Viewer test imports carry NO extension.
- **Tests:** `packages/agent/test/*.test.ts`, kebab-case, sentence-style names. `fileParallelism: false` is already set and must stay.
- **Definition of done for every task:** `pnpm --filter @uidx/agent test` AND `pnpm --filter @uidx/agent typecheck` (zero errors) AND `pnpm format` AND `pnpm lint`. The repo compiles `strict` + `noUncheckedIndexedAccess: true`.
- **No new dependencies** unless a task says otherwise.
- **`console` is lint-restricted** to `packages/agent/src/server/main.ts`.
- **Address grammar** (verified against `@uidx/format`): page root is `""`, a top-level node is `hero`, its child is `hero#inner` (`#` bounds the entity), deeper levels join with `/` (`hero#inner/headline`). Model-facing strings must use this form and match the existing wording in `src/edit/ops.ts` and `src/tools/read.ts`.
- **Commit discipline:** scoped `git add` naming only what you touched. NEVER `git add -A` or `git add .` — the working tree holds the user's unrelated in-flight edit to `design/option-4/components.uidx`, plus untracked `.env`, `packages/viewer/.env.local` and `examples/checkbox-system.uidx`, none of which may be staged.
- **No parallelism anywhere.** The target Ollama serializes requests (measured `-np 1`, 0.94× speedup). Nothing may depend on concurrency.

## Reference points in the existing code

- `src/index/pack.ts` — `packContext(index, docs, focus, { maxChars })`, default 12,000.
- `src/tools/read.ts` — `readTools({ workspace })` returning `{ read, search }`; `read` returns `doc.source` whole when no address is given.
- `src/agent/agent.ts` — `buildAgent({ model, tools, maxSteps, maxTokens, context, repairModel })`, `prepareStep` restricting step 0 to `read`/`search`, `escapeContextFence`.
- `src/server/turn.ts` — `createTurnRunner`, per-turn `turnId`, `sessions` cache, `chat`/`revert`.
- `src/config.ts` — `loadConfig` producing `budgets: { maxSteps, maxFilesPerTurn, maxTokens }`.
- `examples/checkbox.uidx` — 209,648 chars, the exemplar the skills are written from.

---

### Task 1: Context budget derived from the model's window

**Files:**
- Modify: `packages/agent/src/config.ts`
- Create: `packages/agent/src/index/budget.ts`
- Test: `packages/agent/test/budget.test.ts`, `packages/agent/test/config.test.ts` (extend)

**Interfaces:**
- Consumes: `AgentConfig` from `src/config.ts`.
- Produces:
  ```ts
  interface ContextBudget {
    /** Total window in tokens, as configured. */
    windowTokens: number
    /** Characters the context pack may occupy. */
    packChars: number
    /** Characters an outline may occupy. */
    outlineChars: number
    /** Characters a single whole-file read may return before it must outline instead. */
    readChars: number
  }
  function budgetFor(windowTokens: number): ContextBudget
  ```
  and `AgentConfig.contextTokens: number`.

- [ ] **Step 1: Write the failing test**

`packages/agent/test/budget.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { budgetFor } from '../src/index/budget.js'

describe('budgetFor', () => {
  it('spends a fraction of the window on context, leaving the model room to think', () => {
    const b = budgetFor(16_384)
    // ~4 chars per token; the pack must not claim the whole window.
    expect(b.packChars).toBeLessThan(16_384 * 4 * 0.5)
    expect(b.packChars).toBeGreaterThan(0)
  })

  it('scales with the window rather than being a fixed number', () => {
    expect(budgetFor(32_768).packChars).toBeGreaterThan(budgetFor(16_384).packChars)
    expect(budgetFor(4_096).packChars).toBeLessThan(budgetFor(16_384).packChars)
  })

  it('keeps a whole-file read smaller than the pack, so reading cannot evict the context', () => {
    const b = budgetFor(16_384)
    expect(b.readChars).toBeLessThanOrEqual(b.packChars)
  })

  it('never returns a budget so small that nothing useful fits', () => {
    expect(budgetFor(2_048).packChars).toBeGreaterThan(500)
  })
})
```

Extend `packages/agent/test/config.test.ts` with:

```ts
it('defaults the context window to a small local model, and reads an override', () => {
  expect(loadConfig({ UIDX_AGENT_MODEL: 'vllm:g' }, '/work').contextTokens).toBe(16_384)
  expect(
    loadConfig({ UIDX_AGENT_MODEL: 'vllm:g', UIDX_AGENT_CONTEXT_TOKENS: '32768' }, '/work')
      .contextTokens,
  ).toBe(32_768)
})
```

- [ ] **Step 2: Run both to verify they fail**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test budget config`
Expected: FAIL — cannot resolve `../src/index/budget.js`, and `contextTokens` is undefined.

- [ ] **Step 3: Write the budget module**

`packages/agent/src/index/budget.ts`:

```ts
/**
 * How the context window is spent. The pack takes a share, not the lot: a
 * model that fills its window with document has no room left to answer, which
 * is how a small model ends a turn with `finishReason: length` instead of a
 * result.
 */
export interface ContextBudget {
  windowTokens: number
  packChars: number
  outlineChars: number
  readChars: number
}

/** Rule of thumb across the models this harness targets. */
const CHARS_PER_TOKEN = 4

/** The context pack's share of the window. The rest is instructions, tools, history and output. */
const PACK_SHARE = 0.35
const OUTLINE_SHARE = 0.2
const READ_SHARE = 0.3

const FLOOR_CHARS = 600

export function budgetFor(windowTokens: number): ContextBudget {
  const chars = windowTokens * CHARS_PER_TOKEN
  return {
    windowTokens,
    packChars: Math.max(FLOOR_CHARS, Math.floor(chars * PACK_SHARE)),
    outlineChars: Math.max(FLOOR_CHARS, Math.floor(chars * OUTLINE_SHARE)),
    readChars: Math.max(FLOOR_CHARS, Math.floor(chars * READ_SHARE)),
  }
}
```

In `src/config.ts`, add `contextTokens: number` to `AgentConfig` and populate it in `loadConfig`:

```ts
contextTokens: Number(env.UIDX_AGENT_CONTEXT_TOKENS ?? 16_384),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test budget config && pnpm --filter @uidx/agent typecheck`
Expected: PASS, zero type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/agent && git commit -m "The context budget follows the model, not a constant"
```

---

### Task 2: Outline rendering

**Files:**
- Create: `packages/agent/src/index/outline.ts`
- Test: `packages/agent/test/outline.test.ts`

**Interfaces:**
- Consumes: `UidxDocument`/`UidxNode` from `@uidx/format`.
- Produces:
  ```ts
  interface OutlineOptions { maxChars?: number; maxDepth?: number }
  /** One line per node: indent, element, name, address, and the props that identify it. */
  function renderOutline(doc: UidxDocument, root: UidxNode, options?: OutlineOptions): string
  /** A single line describing one node. */
  function renderSignature(node: UidxNode): string
  ```

- [ ] **Step 1: Write the failing test**

`packages/agent/test/outline.test.ts`:

```ts
import { parse, resolve, type UidxDocument } from '@uidx/format'
import { describe, expect, it } from 'vitest'

import { renderOutline, renderSignature } from '../src/index/outline.js'

const SRC = `---
id: page
---

## Visual Contract

<Page>
  <Frame name="hero" width={600} height={200} layoutMode="VERTICAL">
    <Text name="headline" characters="Welcome to the thing" fontSize={32} />
    <Frame name="inner" width={100} height={50}>
      <Text name="deep" characters="deeper" fontSize={12} />
    </Frame>
  </Frame>
  <Instance name="card" component="Card" x={0} y={0} />
</Page>
`

const doc = (): UidxDocument => {
  const r = parse(SRC)
  if (!r.doc) throw new Error(r.diagnostics.map((d) => d.message).join('; '))
  return r.doc
}

describe('renderSignature', () => {
  it('names the element, the name and the address on one line', () => {
    const d = doc()
    const line = renderSignature(resolve(d.tree, 'hero#headline')!)
    expect(line).toContain('Text')
    expect(line).toContain('headline')
    expect(line).toContain('hero#headline')
  })

  it('carries the identifying prop of an instance, so the model knows what it is', () => {
    const d = doc()
    expect(renderSignature(resolve(d.tree, 'card')!)).toContain('Card')
  })

  it('does not carry a node body', () => {
    const d = doc()
    expect(renderSignature(resolve(d.tree, 'hero#headline')!)).not.toContain(
      'Welcome to the thing',
    )
  })
})

describe('renderOutline', () => {
  it('shows the shape of a subtree, one line per node', () => {
    const d = doc()
    const out = renderOutline(d, d.tree)
    expect(out).toContain('hero')
    expect(out).toContain('hero#headline')
    expect(out).toContain('hero#inner/deep')
  })

  it('indents to show nesting', () => {
    const d = doc()
    const lines = renderOutline(d, d.tree).split('\n')
    const hero = lines.find((l) => l.includes('hero') && !l.includes('#'))!
    const headline = lines.find((l) => l.includes('hero#headline'))!
    expect(headline.length - headline.trimStart().length).toBeGreaterThan(
      hero.length - hero.trimStart().length,
    )
  })

  it('stops at the requested depth and says what it did not show', () => {
    const d = doc()
    const out = renderOutline(d, d.tree, { maxDepth: 1 })
    expect(out).toContain('hero')
    expect(out).not.toContain('hero#inner/deep')
    expect(out).toMatch(/deeper|more|omitted|not shown/i)
  })

  it('stays within the character budget and says it truncated', () => {
    const d = doc()
    const out = renderOutline(d, d.tree, { maxChars: 120 })
    expect(out.length).toBeLessThanOrEqual(200)
    expect(out).toMatch(/omitted|truncated/i)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test outline`
Expected: FAIL — cannot resolve `../src/index/outline.js`.

- [ ] **Step 3: Write the outline module**

`packages/agent/src/index/outline.ts`:

```ts
import type { UidxDocument, UidxNode } from '@uidx/format'

export interface OutlineOptions {
  maxChars?: number
  maxDepth?: number
}

const DEFAULT_MAX_CHARS = 4000
const DEFAULT_MAX_DEPTH = 6

/** Props worth showing in a signature, because they say what a node IS. */
const IDENTIFYING = ['component', 'characters', 'layoutMode', 'status'] as const

function shorten(value: unknown, max = 24): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/**
 * One line describing a node — never its body. `characters` is deliberately
 * truncated: the model needs to know a Text exists and roughly what it says,
 * not to receive the copy.
 */
export function renderSignature(node: UidxNode): string {
  const address = node.address === '' ? '(page)' : node.address
  const props = IDENTIFYING.filter((p) => node.attrs[p] !== undefined)
    .map((p) => `${p}=${shorten(node.attrs[p]!.value)}`)
    .join(' ')
  const kids = node.children.length > 0 ? ` (${node.children.length})` : ''
  return `<${node.element}> ${node.name} @${address}${kids}${props ? ` ${props}` : ''}`
}

/**
 * The shape of a subtree, budget-bounded and depth-bounded. Always states what
 * it left out, so a model knows to descend rather than assuming it saw the lot.
 */
export function renderOutline(
  _doc: UidxDocument,
  root: UidxNode,
  options: OutlineOptions = {},
): string {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH

  const lines: string[] = []
  let omittedDepth = 0
  let truncated = false

  const walk = (node: UidxNode, depth: number): void => {
    if (truncated) return
    const line = `${'  '.repeat(depth)}${renderSignature(node)}`
    if (lines.join('\n').length + line.length + 1 > maxChars) {
      truncated = true
      return
    }
    lines.push(line)
    if (depth >= maxDepth) {
      if (node.children.length > 0) omittedDepth += node.children.length
      return
    }
    for (const child of node.children) walk(child, depth + 1)
  }

  walk(root, 0)

  const notes: string[] = []
  if (omittedDepth > 0) {
    notes.push(`${omittedDepth} deeper node(s) omitted — read a child address to descend`)
  }
  if (truncated) notes.push('outline truncated to fit the budget')

  return notes.length > 0 ? `${lines.join('\n')}\n(${notes.join('; ')})` : lines.join('\n')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test outline && pnpm --filter @uidx/agent typecheck`
Expected: PASS (8 tests), zero type errors.

- [ ] **Step 5: Prove it against the real exemplar**

This is the point of the task, so verify it rather than assuming. Write a throwaway script (do NOT commit it) that parses `examples/checkbox.uidx` and renders the page outline at the default budget, and record in your report: the outline's character count, and that it is under the budget while the source is 209,648 characters. If the outline is unusably large or unusably empty, adjust `DEFAULT_MAX_DEPTH` and say why.

- [ ] **Step 6: Commit**

```bash
git add packages/agent && git commit -m "A page can be seen in outline before it is read"
```

---

### Task 3: `read` becomes budget-aware and gains modes

**Files:**
- Modify: `packages/agent/src/tools/read.ts`, `packages/agent/src/tools/index.ts`, `packages/agent/src/server/turn.ts`
- Test: `packages/agent/test/tools-read.test.ts` (extend)

**Interfaces:**
- Consumes: `renderOutline`/`renderSignature` (Task 2), `ContextBudget` (Task 1).
- Produces: `readTools({ workspace, budget })` — `read` gains `mode?: 'source' | 'outline' | 'signature'` and `neighbourhood?: boolean`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/agent/test/tools-read.test.ts` (keep every existing test passing; the existing `tools()` helper needs a `budget` added):

```ts
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test tools-read`
Expected: FAIL — `mode` is rejected by the schema / whole-file read is returned regardless of size.

- [ ] **Step 3: Extend the read tool**

In `src/tools/read.ts`:

- add `budget: ContextBudget` to `ReadDeps`;
- add to the input schema: `mode: z.enum(['source','outline','signature']).optional()` described as *"source (default) returns exact text; outline returns the subtree's shape without bodies; signature returns one line"*, and `neighbourhood: z.boolean().optional()` described as *"describe where this node sits: its ancestors and its immediate children"*;
- when no `address` is given and `doc.source.length > budget.readChars`, return the page outline prefixed with a line saying the source was too large to return whole and giving its size, so the model knows to read a child address;
- when `mode` is `outline`, return `renderOutline(doc, node, { maxChars: budget.outlineChars })`; when `signature`, return `renderSignature(node)`;
- when `neighbourhood` is set, return the ancestor breadcrumb (walk `resolveParent`, skipping the page root) plus the node's signature plus one signature per child.

Update `buildTools` in `src/tools/index.ts` to thread `budget` through, and `turn.ts` to pass `budgetFor(config.contextTokens)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test tools-read && pnpm --filter @uidx/agent typecheck`
Expected: PASS, all previous read tests still green.

- [ ] **Step 5: Commit**

```bash
git add packages/agent && git commit -m "Reading a large page returns its shape, not its weight"
```

---

### Task 4: The context pack respects the budget

**Files:**
- Modify: `packages/agent/src/index/pack.ts`, `packages/agent/src/server/turn.ts`
- Test: `packages/agent/test/pack.test.ts` (extend)

**Interfaces:**
- Consumes: `ContextBudget` (Task 1).
- Produces: `packContext(index, docs, focus, { maxChars })` unchanged in shape; `turn.ts` supplies `budget.packChars` instead of the default.

- [ ] **Step 1: Write the failing test**

Add to `packages/agent/test/pack.test.ts`:

```ts
it('honours a small budget without dropping the doc map, which is the orientation', () => {
  const pack = packContext(index, docs, { file: 'home.uidx', selection: ['hero'] }, {
    maxChars: 900,
  })
  expect(pack.text.length).toBeLessThanOrEqual(1_100)
  expect(pack.text).toContain('COMPONENTS')
})
```

- [ ] **Step 2: Run it**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test pack`
Expected: may already pass — the SELECTED block is capped at half the budget from Phase 1. If it passes, say so in your report and keep the test as a regression guard; if it fails, fix the accounting so the doc map survives.

- [ ] **Step 3: Wire the budget through**

In `src/server/turn.ts`, replace the default `packContext(...)` call with one passing `maxChars: budget.packChars`, where `budget = budgetFor(config.contextTokens)` (compute it once per runner, not per turn).

- [ ] **Step 4: Verify and commit**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test && pnpm --filter @uidx/agent typecheck`

```bash
git add packages/agent && git commit -m "The pack spends what the window allows"
```

---

### Task 5: Skills — loading and the `use_skill` tool

**Files:**
- Create: `packages/agent/src/skills/discover.ts`, `packages/agent/src/skills/tool.ts`
- Modify: `packages/agent/src/tools/index.ts`, `packages/agent/src/agent/agent.ts`, `packages/agent/src/server/turn.ts`
- Test: `packages/agent/test/skills.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface SkillEntry { name: string; description: string; dir: string; bodyPath: string }
  function discoverSkills(roots: readonly string[]): Promise<SkillEntry[]>
  function renderSkillListing(skills: readonly SkillEntry[]): string
  function skillTools(deps: { skills: () => readonly SkillEntry[]; maxChars: number }): { use_skill: Tool }
  ```

- [ ] **Step 1: Write the failing test**

`packages/agent/test/skills.test.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { discoverSkills, renderSkillListing } from '../src/skills/discover.js'
import { skillTools } from '../src/skills/tool.js'

const SKILL = `---
name: component-doc-page
description: How to structure a component documentation page in this repo.
---

Put the state grid in instances, never a screenshot.
`

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'uidx-skills-'))
  const dir = join(root, 'component-doc-page')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), SKILL)
  const empty = join(root, 'not-a-skill')
  await mkdir(empty, { recursive: true })
  return root
}

const run = async (tool: { execute?: unknown }, input: unknown): Promise<string> =>
  (tool.execute as (i: unknown, o: unknown) => Promise<string>)(input, {
    toolCallId: 't',
    messages: [],
  })

describe('discoverSkills', () => {
  it('finds a skill by its SKILL.md frontmatter', async () => {
    const skills = await discoverSkills([await fixture()])
    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({
      name: 'component-doc-page',
      description: 'How to structure a component documentation page in this repo.',
    })
  })

  it('ignores a directory with no SKILL.md rather than failing', async () => {
    await expect(discoverSkills([await fixture()])).resolves.toHaveLength(1)
  })

  it('survives a root that does not exist', async () => {
    await expect(discoverSkills(['/no/such/place'])).resolves.toEqual([])
  })
})

describe('renderSkillListing', () => {
  it('lists only names and descriptions, so the prompt stays small', async () => {
    const listing = renderSkillListing(await discoverSkills([await fixture()]))
    expect(listing).toContain('component-doc-page')
    expect(listing).toContain('How to structure')
    expect(listing).not.toContain('state grid')
  })
})

describe('use_skill', () => {
  it('returns the full body when asked for by name', async () => {
    const skills = await discoverSkills([await fixture()])
    const out = await run(skillTools({ skills: () => skills, maxChars: 8_000 }).use_skill, {
      name: 'component-doc-page',
    })
    expect(out).toContain('state grid')
  })

  it('says which skills exist when the name is unknown', async () => {
    const skills = await discoverSkills([await fixture()])
    const out = await run(skillTools({ skills: () => skills, maxChars: 8_000 }).use_skill, {
      name: 'nope',
    })
    expect(out).toMatch(/no skill/i)
    expect(out).toContain('component-doc-page')
  })

  it('truncates a very long body to the budget and says so', async () => {
    const skills = await discoverSkills([await fixture()])
    const out = await run(skillTools({ skills: () => skills, maxChars: 20 }).use_skill, {
      name: 'component-doc-page',
    })
    expect(out).toMatch(/truncated/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test skills`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement discovery and the tool**

`src/skills/discover.ts`: read each immediate subdirectory of each root, look for `SKILL.md`, parse its YAML frontmatter for `name` and `description` (the repo already depends on `yaml` transitively through `@uidx/format`; if it is not directly available, parse the two fields with a small regex rather than adding a dependency — say which you did). Skip anything without both fields. A missing root yields no skills rather than an error.

`renderSkillListing` emits one line per skill: `- <name>: <description>`.

`src/skills/tool.ts`: `use_skill` takes `{ name: string }`, returns the body of that skill's `SKILL.md` with its frontmatter stripped, truncated to `maxChars` with an explicit marker. An unknown name returns actionable text naming the skills that do exist.

Wire into `buildTools` and into `buildAgent`'s instructions: append the skill listing under a heading saying these may be loaded with `use_skill`. Skills are discovered from `<docroot>/.uidx-agent/skills` and `~/.uidx-agent/skills`.

- [ ] **Step 4: Verify**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test && pnpm --filter @uidx/agent typecheck`

- [ ] **Step 5: Commit**

```bash
git add packages/agent && git commit -m "Skills the model can pick up when it needs them"
```

---

### Task 6: Write the two shipped skills

**Files:**
- Create: `.uidx-agent/skills/uidx-authoring/SKILL.md`, `.uidx-agent/skills/component-doc-page/SKILL.md`
- Modify: `.gitignore` (the agent dir is ignored; these two skills must be tracked)

**Interfaces:** none — content, not code.

- [ ] **Step 1: Make the shipped skills tracked**

`.gitignore` currently ignores `.uidx-agent/`. Add a negation so the shipped skills are versioned while checkpoints and plans stay ignored:

```
.uidx-agent/*
!.uidx-agent/skills/
```

Verify with `git check-ignore -v .uidx-agent/skills/uidx-authoring/SKILL.md` (should NOT be ignored) and `git check-ignore -v .uidx-agent/checkpoints` (should be ignored).

- [ ] **Step 2: Write `uidx-authoring/SKILL.md`**

Frontmatter `name: uidx-authoring`, `description: The uidx node grammar — components, variants, instances, slots, auto-layout and token aliases.`

Body must be derived from the real code and the real exemplar, not from memory. Read `packages/format/src/types.ts` for the element list and the `PROPERTY_TYPES`, and `examples/checkbox.uidx` for a working `Component`. Cover, tersely:

- the element list, and which elements may contain which;
- `Component` with `props` (`TEXT`/`BOOLEAN`/`INSTANCE_SWAP`, each bound to `characters`/`visible`/`component`) and `variants` axes, with the real example from `checkbox.uidx` (`state`, `interaction`, `size`);
- `Variant` children keyed by axis values;
- `Instance` with `component=` and a `Slot` fill;
- auto-layout: `layoutMode`, `itemSpacing`, `padding*`, `primaryAxisSizingMode`, `counterAxisSizingMode`, alignment;
- token aliases as `"{collection#name}"`;
- the address grammar;
- the rule that a `Component` is a page child and can never be a frame's child.

Keep it under 4,000 characters. It is prompt text.

- [ ] **Step 3: Write `component-doc-page/SKILL.md`**

Frontmatter `name: component-doc-page`, `description: How this repo structures a component documentation page, from examples/checkbox.uidx.`

Read `examples/checkbox.uidx`'s markdown sections and the shape of its state grid first — quote what is actually there. Cover:

- the prose sections in order (`Core Intent`, `Page Structure`, `Anti-Patterns`, `Visual Contract`) and what each is for;
- that the state grid is built from `Instance` cells resolving to the component, never a screenshot, and why (a screenshot goes stale the day a variant changes);
- that the `Component` definition sits beside the page, captioned as the source, because a `Component` is a page child by grammar;
- that two different axes exist — what the user said (unchecked/checked/indeterminate) versus what the control is doing (default/hover/focus/active/disabled/invalid) — and they must not be folded into one list;
- that presence-type things (does the label show, is it required) are props, not axes;
- the convention of stating an accessibility failure on the page rather than hiding it;
- point at `examples/checkbox.uidx` by path and tell the model to `read` it with `mode: "outline"` first — it is 209,648 characters and will not fit in one window.

Under 5,000 characters.

- [ ] **Step 4: Verify the skills load**

Run a throwaway script (do not commit) that calls `discoverSkills` against the repo's `.uidx-agent/skills` and prints the listing. Confirm both appear with their descriptions. Paste the output into your report.

- [ ] **Step 5: Commit**

```bash
git add .gitignore .uidx-agent/skills && git commit -m "Two skills: the grammar, and what a good page looks like here"
```

---

### Task 7: The durable plan file

**Files:**
- Create: `packages/agent/src/plan/store.ts`, `packages/agent/src/plan/tool.ts`
- Modify: `packages/agent/src/tools/index.ts`, `packages/agent/src/server/turn.ts`
- Test: `packages/agent/test/plan.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type StepStatus = 'todo' | 'doing' | 'done' | 'blocked'
  interface PlanStep { id: number; text: string; status: StepStatus; result?: string }
  interface Plan { taskId: string; goal: string; steps: PlanStep[] }
  interface PlanStore {
    read(taskId: string): Promise<Plan | null>
    write(plan: Plan): Promise<void>
    render(plan: Plan): string
  }
  function createPlanStore(root: string): PlanStore
  function planTools(deps: { store: PlanStore; taskId: string }): { plan: Tool }
  ```

- [ ] **Step 1: Write the failing test**

`packages/agent/test/plan.test.ts`:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { createPlanStore } from '../src/plan/store.js'
import { planTools } from '../src/plan/tool.js'

const root = () => mkdtemp(join(tmpdir(), 'uidx-plan-'))

const run = async (tool: { execute?: unknown }, input: unknown): Promise<string> =>
  (tool.execute as (i: unknown, o: unknown) => Promise<string>)(input, {
    toolCallId: 't',
    messages: [],
  })

describe('PlanStore', () => {
  it('round-trips a plan through disk', async () => {
    const store = createPlanStore(await root())
    await store.write({
      taskId: 't1',
      goal: 'Build a checkbox page',
      steps: [{ id: 1, text: 'Create the file', status: 'todo' }],
    })
    const back = await store.read('t1')
    expect(back?.goal).toBe('Build a checkbox page')
    expect(back?.steps[0]).toMatchObject({ id: 1, status: 'todo' })
  })

  it('returns null for a task it has never seen', async () => {
    expect(await createPlanStore(await root()).read('nope')).toBeNull()
  })

  it('renders compactly, so reloading it costs little', async () => {
    const store = createPlanStore(await root())
    const plan = {
      taskId: 't1',
      goal: 'g',
      steps: [
        { id: 1, text: 'one', status: 'done' as const, result: 'created home.uidx' },
        { id: 2, text: 'two', status: 'todo' as const },
      ],
    }
    const text = store.render(plan)
    expect(text).toContain('one')
    expect(text).toContain('created home.uidx')
    expect(text.length).toBeLessThan(400)
  })
})

describe('plan tool', () => {
  it('creates a plan with steps and reports the first todo', async () => {
    const store = createPlanStore(await root())
    const out = await run(planTools({ store, taskId: 't1' }).plan, {
      action: 'set',
      goal: 'Build a checkbox page',
      steps: ['Create the file', 'Add the states'],
    })
    expect(out).toContain('Create the file')
    expect((await store.read('t1'))?.steps).toHaveLength(2)
  })

  it('marks a step done with its result and shows what remains', async () => {
    const store = createPlanStore(await root())
    await run(planTools({ store, taskId: 't1' }).plan, {
      action: 'set',
      goal: 'g',
      steps: ['one', 'two'],
    })
    const out = await run(planTools({ store, taskId: 't1' }).plan, {
      action: 'complete',
      id: 1,
      result: 'created home.uidx',
    })
    expect(out).toContain('two')
    expect((await store.read('t1'))?.steps[0]).toMatchObject({
      status: 'done',
      result: 'created home.uidx',
    })
  })

  it('reads back the plan so a later turn can resume it', async () => {
    const store = createPlanStore(await root())
    await run(planTools({ store, taskId: 't1' }).plan, {
      action: 'set',
      goal: 'g',
      steps: ['one'],
    })
    // A *different* tool instance, same task id — this is the resume path.
    const out = await run(planTools({ store, taskId: 't1' }).plan, { action: 'show' })
    expect(out).toContain('one')
  })

  it('says plainly when there is no plan yet', async () => {
    const out = await run(planTools({ store: createPlanStore(await root()), taskId: 'x' }).plan, {
      action: 'show',
    })
    expect(out).toMatch(/no plan/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm --filter @uidx/agent test plan`

- [ ] **Step 3: Implement**

`store.ts` writes `<root>/.uidx-agent/plans/<taskId>.json` (JSON on disk for a lossless round-trip; `render` produces the compact markdown the model sees). Reuse `resolveInside` from `src/edit/jail.ts` for the path, and validate `taskId` the way `checkpoint.ts` validates a turn id — reject anything that is not a UUID-shaped or simple slug id, so a task id can never escape the directory.

`tool.ts` exposes one `plan` tool with `action: 'set' | 'complete' | 'block' | 'show'`, described for the model as the place to keep a long task's progress, with a note that it survives across turns.

Wire into `buildTools`; the task id is the turn's task id (see Task 9).

- [ ] **Step 4: Verify and commit**

```bash
git add packages/agent && git commit -m "A plan that outlives the conversation"
```

---

### Task 8: Compaction between steps

**Files:**
- Modify: `packages/agent/src/agent/agent.ts`
- Test: `packages/agent/test/agent.test.ts` (extend)

**Interfaces:**
- Consumes: `AgentDeps` gains `compactAfterSteps?: number` (default 4) and `budget: ContextBudget`.
- Produces: `prepareStep` returns a `messages` override once history exceeds the budget.

- [ ] **Step 1: Write the failing test**

Add to `packages/agent/test/agent.test.ts`:

```ts
it('compacts older history once the conversation outgrows the budget', async () => {
  const model = recordingModel('ok')
  const agent = buildAgent({
    ...deps(model),
    budget: budgetFor(2_048),
    compactAfterSteps: 1,
  })
  await agent.generate({
    prompt: 'x',
    messages: manyPriorMessages(12), // helper in the test file: 12 long assistant/tool exchanges
  })
  const sent = JSON.stringify(model.doGenerateCalls.at(-1)?.prompt ?? [])
  expect(sent).toContain('earlier steps summarised')
  expect(sent.length).toBeLessThan(JSON.stringify(manyPriorMessages(12)).length)
})

it('leaves a short conversation alone', async () => {
  const model = recordingModel('ok')
  await buildAgent({ ...deps(model), budget: budgetFor(16_384) }).generate({ prompt: 'x' })
  const sent = JSON.stringify(model.doGenerateCalls[0]?.prompt ?? [])
  expect(sent).not.toContain('earlier steps summarised')
})
```

Write `manyPriorMessages` and `recordingModel` as local helpers modelled on the existing `MockLanguageModelV4` fixtures in that file.

- [ ] **Step 2: Run to verify it fails**

- [ ] **Step 3: Implement compaction in `prepareStep`**

Keep the existing step-0 `activeTools` behaviour. Add: when `stepNumber >= compactAfterSteps` and the serialized `messages` exceed the budget's pack share, return a `messages` override consisting of the first user message, a single synthetic assistant note beginning `earlier steps summarised:` followed by one line per elided step (tool name and its one-line result), and the most recent two exchanges verbatim. Never elide the current step's own tool results.

Document in a comment that the AI SDK carries a `messages` override forward to later steps, so this compacts once and stays compact.

- [ ] **Step 4: Verify and commit**

```bash
git add packages/agent && git commit -m "The loop forgets what it no longer needs"
```

---

### Task 9: Task identity, and Continue

**Files:**
- Modify: `packages/agent/src/server/turn.ts`, `packages/agent/src/server/app.ts`, `packages/viewer/src/ChatPanel.vue`, `packages/viewer/src/agent-client.ts`
- Test: `packages/agent/test/turn.test.ts` (extend), `packages/viewer/test/chat-panel.test.ts` (extend)

**Interfaces:**
- `ChatBody` gains `taskId?: string`. When absent the runner mints one and returns it as `x-uidx-task` and in message metadata alongside `turnId`.
- The panel keeps the task id for the conversation and sends it on every message, so successive turns share one plan.

- [ ] **Step 1: Write the failing tests**

Agent side, add to `turn.test.ts`: a chat response carries an `x-uidx-task` header; passing the same `taskId` twice reaches the same plan file; the plan is included in the model's instructions when one exists for that task.

Viewer side, add to `chat-panel.test.ts`: the panel sends the same `taskId` on a second message; and when a reply's metadata reports unfinished plan steps, a **Continue** control appears that sends a follow-up turn with the same task id.

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement**

Runner: mint `taskId` when absent (`randomUUID()`), thread it into `planTools`, include `store.render(plan)` in the agent's context when a plan exists, and report `{ turnId, taskId, planRemaining }` in message metadata where `planRemaining` is the count of steps not `done`.

Panel: hold `taskId` in a ref, set it from the first reply's metadata, send it thereafter; render **Continue** when the latest assistant message reports `planRemaining > 0`, following the existing icon-button conventions (theme tokens, `viewBox="0 0 12 12"`, `aria-hidden` on the svg, `aria-label` on the button).

- [ ] **Step 4: Verify both packages and commit**

```bash
git add packages/agent packages/viewer && git commit -m "One task, many turns"
```

---

### Task 10: Delegation

**Files:**
- Create: `packages/agent/src/agent/delegate.ts`
- Modify: `packages/agent/src/tools/index.ts`, `packages/agent/src/agent/agent.ts`, `packages/agent/src/agent/prompt.ts`, `packages/agent/src/server/turn.ts`
- Test: `packages/agent/test/delegate.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type MissionKind = 'read-mission' | 'edit-mission' | 'author-mission'
  interface MissionResult { ok: boolean; summary: string; files: string[] }
  function delegateTool(deps: {
    model: LanguageModel
    tools: ToolSet          // the full set; the worker gets a subset per mission kind
    budget: ContextBudget
    maxSteps: number        // worker step cap, deliberately small
    context: (mission: string) => string
  }): { delegate: Tool }
  ```

- [ ] **Step 1: Write the failing test**

`packages/agent/test/delegate.test.ts` — cover, with `MockLanguageModelV4`:

- a worker runs its own loop and returns a summary string rather than a transcript;
- the worker is given only the tools its mission kind allows (assert on the tool names in the model call: a `read-mission` worker is never offered `edit`);
- a worker cannot delegate — `delegate` is absent from every worker's tool set;
- the worker's step budget is enforced and a worker that exhausts it returns a summary saying so, rather than throwing;
- the summary returned to the orchestrator is short — assert it is under a stated character cap;
- execution is sequential: two `delegate` calls in one turn run one after the other (assert call ordering on the shared mock).

- [ ] **Step 2: Run to verify it fails**

- [ ] **Step 3: Implement**

`delegate.ts` builds a fresh `ToolLoopAgent` per mission: its own short role prompt naming the mission kind, the mission text as the user prompt, a mission-scoped context string, `isStepCount(maxSteps)`, and a tool subset — `read-mission` gets `read`/`search`; `edit-mission` gets `read`/`edit`; `author-mission` gets `read`/`edit`/`create_file`. No worker ever receives `delegate`, `plan`, or `delete_file`.

The worker's final text becomes the summary, truncated to a cap with a marker. Return `{ ok, summary, files }` serialized as compact text for the orchestrator.

Add `delegate` to the orchestrator's tools only (not to workers), and add two sentences to the system prompt telling the model to break a large job into small missions and delegate them one at a time, keeping only summaries. Stay inside the 2,400-character prompt budget — report the new count.

- [ ] **Step 4: Verify and commit**

```bash
git add packages/agent && git commit -m "Small missions, fresh minds, short reports"
```

---

### Task 11: End-to-end proof against the real exemplar

**Files:**
- Test: `packages/agent/test/phase2-end-to-end.test.ts`
- Modify: `packages/agent/README.md`

**Interfaces:** none.

- [ ] **Step 1: Write the end-to-end test**

With a scripted `MockLanguageModelV4`, prove the phase's success criteria against a real temp document that includes a large page:

- the model outlines a page whose source exceeds the read budget, and the returned text is an outline within budget rather than the source;
- it then reads one node's source by address and gets exact text;
- it loads a skill by name and receives that skill's body;
- it writes a plan, completes a step, and a second turn with the same task id sees the remaining steps;
- it delegates one `edit-mission`, the file changes on disk, and the orchestrator receives a short summary rather than the worker's transcript.

- [ ] **Step 2: Prove the exemplar is navigable — this is the phase's whole point**

Write a throwaway script (do not commit) that, against the real `examples/checkbox.uidx`:

1. renders the page outline at the configured budget and reports its character count;
2. picks the `Control/Checkbox` component address from the outline and reads its signature;
3. reads one `Variant`'s source by address.

Record all three sizes in your report, next to the source's 209,648 characters. If step 1 does not fit the budget, the phase has not met its criteria — say so plainly rather than adjusting the budget to make it pass.

- [ ] **Step 3: Update the README**

Document the new tools (`use_skill`, `plan`, `delegate`), the `read` modes, `UIDX_AGENT_CONTEXT_TOKENS`, where skills live and that two ship with the repo, and — honestly — that delegation is sequential and single-model because the target runtime serializes requests.

- [ ] **Step 4: Run the full CI gate**

```bash
export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"; pnpm format && pnpm lint && pnpm typecheck && pnpm build:cli && pnpm test && pnpm check:examples
```

Paste the real output. Fix anything that fails.

- [ ] **Step 5: Commit**

```bash
git add packages/agent && git commit -m "Phase 2 proves itself against the page it was built for"
```

## Manual verification (after Task 11)

With the local model running:

1. `node packages/agent/dist/server/main.js` and the viewer on the examples document.
2. Ask: *"Read examples/checkbox.uidx and tell me how its state grid is built."* It should outline, then read selectively, and answer — without ending in `finishReason: length`.
3. Ask: *"Build a checkbox documentation page following the component-doc-page skill."* It should load the skill, write a plan, and work through it across turns using Continue.

## Not in this plan

Spec §5 (`view_image`), §6 (memory) and §7 (`web_search`) — a follow-on plan once these land.
