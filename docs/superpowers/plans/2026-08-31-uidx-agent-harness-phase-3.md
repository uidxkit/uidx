# UIDX Agent Harness Phase 3 (§1–§3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Do not dispatch subagents** — see Global Constraints.

**Goal:** Make the harness answer from what it knows — refusals that name what exists, a document map that says what depends on what — and let it see what it drew.

**Architecture:** Three seams, no new subsystems. A pure address helper turns "no node there" into "here is what is there", and both the edit and read paths call it. The doc map surfaces three relations the index already computes. `view_image` assembles the four resolvers `toSceneGraph` already takes from state the agent already holds, and hands them to `@open-pencil/core`'s existing headless rasteriser — no renderer is written.

**Tech Stack:** TypeScript, zod 4, Vercel AI SDK 7, vitest 2, `@uidx/format`, `@uidx/schema`, `@open-pencil/core`.

**Spec:** `docs/superpowers/specs/2026-08-31-uidx-agent-harness-phase-3-design.md`

## Global Constraints

- **One agent. No sub-agent mode.** This phase introduces no new agent, no initializer/worker split, no parallel workers and no second model. `delegate` is not modified.
- **Do not dispatch subagents to implement this plan.** Execute inline.
- **Every refusal is a teaching surface.** A refusal names what *is* there, in the existing vocabulary (`not applied — `, `refused:`, `no node at`).
- **Every model-facing list is bounded and counted**: the first few by name, then `(+N more)`. A refusal that overruns the window is a new failure, not a fix.
- **Reuse, don't rebuild.** Rendering comes from `@open-pencil/core/io` (`initCanvasKit`, `headlessRenderNodes`) and `@uidx/schema` (`toSceneGraph`, `buildTokenIndex`, `TokenResolver`, `resolveTokenValues`). **`packages/agent` must not import anything from `packages/viewer`.**
- **Node 22.15.0.** Tests fail with `ERR_REQUIRE_ESM` on the default Node 18. Prefix every command: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"`.
- **Work commits straight to `main`.** No worktree, no feature branch.
- **The full gate before finishing:** `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:examples`.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/agent/src/address.ts` | **Create.** Pure address-grammar helpers: the resolvable prefixes of an address, and a sentence describing the nearest node that exists and what it holds. Shared by the edit and read paths; depends only on `@uidx/format`. |
| `packages/agent/src/edit/compile.ts` | **Modify.** `nodeAt`'s `CompileError` gains the sentence. |
| `packages/agent/src/tools/read.ts` | **Modify.** The `no node at` refusal gains the same sentence. |
| `packages/agent/src/index/doc-map.ts` | **Modify.** Surface `headings`, name the pages that use a component and the nodes that bind a variable, and trim sections individually instead of dropping them whole. |
| `packages/agent/src/render.ts` | **Create.** Assemble the four `toSceneGraph` resolvers from a workspace's documents, seed Inter from `@open-pencil/core/assets`, and rasterise through `headlessRenderNodes`. |
| `packages/agent/src/tools/view_image.ts` | **Create.** The `view_image` tool: address in, PNG out, with a pixel budget and a capability refusal. |
| `packages/agent/src/tools/index.ts` | **Modify.** Build and export `view_image`. |
| `packages/agent/src/server/turn.ts` | **Modify.** Pass the index and the vision capability through. |
| `packages/agent/src/config.ts` | **Modify.** `UIDX_AGENT_VISION` capability flag. |

---

### Task 1: The address helper

**Files:**
- Create: `packages/agent/src/address.ts`
- Test: `packages/agent/test/address.test.ts`

**Interfaces:**
- Consumes: `resolve`, `type UidxDocument`, `type UidxNode` from `@uidx/format`.
- Produces:
  - `export function resolvablePrefixes(address: string): string[]` — longest first, always ending with `''`.
  - `export function describeNearest(doc: UidxDocument, address: string): string` — the sentence appended to a failed-address refusal, always beginning with a space, or `''` when nothing useful can be said.
  - `export const MAX_NAMED_CHILDREN = 6`

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent/test/address.test.ts
import { parse, type UidxDocument } from '@uidx/format'
import { describe, expect, it } from 'vitest'

import { describeNearest, resolvablePrefixes } from '../src/address.js'

const SOURCE = `---
id: home
---

## Visual Contract

<Page>
  <Frame name="card" layoutMode="VERTICAL">
    <Text name="title" characters="Hello" />
    <Text name="body" characters="World" />
  </Frame>
  <Frame name="empty" />
</Page>
`

const doc = (): UidxDocument => {
  const result = parse(SOURCE)
  if (!result.doc) throw new Error('fixture does not parse')
  return result.doc
}

describe('resolvablePrefixes', () => {
  it('walks a deep address back to the page root, longest first', () => {
    expect(resolvablePrefixes('doc#states/matrix/cell')).toEqual([
      'doc#states/matrix/cell',
      'doc#states/matrix',
      'doc#states',
      'doc',
      '',
    ])
  })

  it("keeps a top-level name's own slash, which is part of the name", () => {
    expect(resolvablePrefixes('Control/Checkbox#state=on')).toEqual([
      'Control/Checkbox#state=on',
      'Control/Checkbox',
      '',
    ])
  })

  it('bottoms out at the page root', () => {
    expect(resolvablePrefixes('')).toEqual([''])
  })
})

describe('describeNearest', () => {
  it('names the children of the nearest node that does exist', () => {
    expect(describeNearest(doc(), 'card#missing')).toBe(
      ' — card holds card#title, card#body',
    )
  })

  it('says so plainly when the nearest node has no children', () => {
    expect(describeNearest(doc(), 'empty#title')).toBe(' — empty has no children yet')
  })

  it('falls back to the page root, naming its top-level nodes', () => {
    expect(describeNearest(doc(), 'nowhere#at#all')).toBe(
      ' — the page holds card, empty',
    )
  })

  // The whole point is to stop the guessing, so it must not itself be a guess:
  // when the address given does resolve, there is nothing to add.
  it('says nothing when the address actually resolves', () => {
    expect(describeNearest(doc(), 'card')).toBe('')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" && pnpm --filter @uidx/agent test -- address.test.ts
```

Expected: FAIL — `Failed to resolve import "../src/address.js"`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/agent/src/address.ts
import { resolve, type UidxDocument, type UidxNode } from '@uidx/format'

/**
 * How many sibling addresses a refusal names before it starts counting. Six is
 * a line's worth: enough that the right one is usually present, few enough that
 * a refusal on a wide node cannot itself become the thing that overruns the
 * window.
 */
export const MAX_NAMED_CHILDREN = 6

/**
 * Every address that could be an ancestor of `address`, longest first, ending
 * at the page root.
 *
 * The grammar, from `docs/decisions/0003-page-root-and-two-level-addressing.md`
 * and verified against the parser: `#` bounds an entity from the nodes inside
 * it, and after the `#` every `/` walks one level deeper. A `/` *before* the
 * `#` is part of a top-level name — that is how Figma groups a component set —
 * so `Control/Checkbox#state=on` has exactly two ancestors, not three.
 */
export function resolvablePrefixes(address: string): string[] {
  if (address === '') return ['']
  const prefixes = [address]
  const hash = address.indexOf('#')
  if (hash >= 0) {
    let inside = address.slice(hash + 1)
    while (inside.includes('/')) {
      inside = inside.slice(0, inside.lastIndexOf('/'))
      prefixes.push(`${address.slice(0, hash)}#${inside}`)
    }
    prefixes.push(address.slice(0, hash))
  }
  prefixes.push('')
  return prefixes
}

/** How a node is named in a refusal — the page root has no address of its own. */
function label(node: UidxNode): string {
  return node.address === '' ? 'the page' : node.address
}

/**
 * What the nearest existing ancestor of a failed address actually holds.
 *
 * A refusal that reports only absence leaves the model to guess, and it guesses
 * badly: asked to fill a page it had just created, qwen3.5 tried `card#title`,
 * `card#`, `Frame#` and `/card#title` in turn, twelve refusals across
 * twenty-four steps, while the harness held the whole tree and said nothing.
 * The tree is right here — so say what is in it.
 *
 * Returns a fragment ready to append to an existing refusal, opening with the
 * separator so a caller never has to decide whether to add one.
 */
export function describeNearest(doc: UidxDocument, address: string): string {
  if (resolve(doc.tree, address)) return ''

  for (const prefix of resolvablePrefixes(address)) {
    const node = prefix === '' ? doc.tree : resolve(doc.tree, prefix)
    if (!node) continue
    const children = node.children
    if (children.length === 0) return ` — ${label(node)} has no children yet`
    const named = children.slice(0, MAX_NAMED_CHILDREN).map((child) => child.address)
    const rest = children.length - named.length
    const more = rest > 0 ? `, (+${rest} more)` : ''
    return ` — ${label(node)} holds ${named.join(', ')}${more}`
  }
  return ''
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" && pnpm --filter @uidx/agent test -- address.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/address.ts packages/agent/test/address.test.ts
git commit -m "The tree can say what it holds"
```

---

### Task 2: Both refusal paths use it

**Files:**
- Modify: `packages/agent/src/edit/compile.ts` (the `nodeAt` helper, ~line 16)
- Modify: `packages/agent/src/tools/read.ts` (the `NO_NODE_AT_PREFIX` return, ~line 118)
- Test: `packages/agent/test/compile.test.ts`, `packages/agent/test/tools-read.test.ts`

**Interfaces:**
- Consumes: `describeNearest(doc, address)` from Task 1.
- Produces: no new exports. `CompileError` messages and the `read` refusal both gain the fragment.

- [ ] **Step 1: Write the failing tests**

Append to `packages/agent/test/compile.test.ts`:

```ts
describe('compileOps refusals', () => {
  // The measured failure: twelve of twelve refusals in one authoring run were
  // "no node at address", each naming only the string that failed.
  it('names what the nearest existing node holds', () => {
    expect(() => compileOps(doc(), [{ kind: 'remove_node', address: 'hero#missing' }])).toThrow(
      'no node at address "hero#missing" — hero holds hero#headline',
    )
  })
})
```

Append to `packages/agent/test/tools-read.test.ts`:

```ts
it('names what exists when an address does not resolve', async () => {
  const { tools } = await harness()
  const result = await run(tools.read, { file: 'home.uidx', address: 'hero#missing' })
  expect(result).toContain('hero holds hero#headline')
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" && pnpm --filter @uidx/agent test -- compile.test.ts tools-read.test.ts
```

Expected: FAIL — both refusals still end at the failed address.

- [ ] **Step 3: Wire it into `compile.ts`**

Replace `nodeAt` (currently lines 16–20):

```ts
function nodeAt(doc: UidxDocument, address: string): ReturnType<typeof resolve> {
  const node = resolve(doc.tree, address)
  if (!node) {
    throw new CompileError(
      `no node at address ${JSON.stringify(address)}${describeNearest(doc, address)}`,
    )
  }
  return node
}
```

Add the import beside the existing `@uidx/format` one:

```ts
import { describeNearest } from '../address.js'
```

- [ ] **Step 4: Wire it into `read.ts`**

Replace the `no node` return (currently `return `${NO_NODE_AT_PREFIX} ${address} on ${file}``):

```ts
      if (!node) {
        return `${NO_NODE_AT_PREFIX} ${address} on ${file}${describeNearest(doc, address ?? '')}`
      }
```

Add the import beside the existing ones:

```ts
import { describeNearest } from '../address.js'
```

- [ ] **Step 5: Run the whole agent suite**

```bash
export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" && pnpm --filter @uidx/agent test
```

Expected: PASS. If an existing test asserted a refusal with `toBe` on the exact old string, change it to assert the prefix with `toContain` — the fragment is additive and the prefix constants are unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src packages/agent/test
git commit -m "A refusal that names the door that is open"
```

---

### Task 3: The index reaches the edit tools, and an unknown component names the real ones

**Files:**
- Modify: `packages/agent/src/tools/edit.ts` (`EditDeps`, the `edit` tool's `execute`)
- Modify: `packages/agent/src/tools/index.ts` (thread `index` through)
- Modify: `packages/agent/src/server/turn.ts` (pass the already-built `index`)
- Test: `packages/agent/test/tools-edit.test.ts`

**Interfaces:**
- Consumes: `DocumentIndex` from `../index/types.js`; `narrowOps` from `../edit/ops.js`.
- Produces: `EditDeps.index?: DocumentIndex`. Absent means the check does not run — a caller outside a real turn has no index and must not be refused for it.

- [ ] **Step 1: Write the failing test**

Append to `packages/agent/test/tools-edit.test.ts`:

```ts
describe('unknown components', () => {
  const indexStub = (names: string[]): DocumentIndex =>
    ({
      components: new Map(names.map((name) => [name, { name } as never])),
    }) as unknown as DocumentIndex

  it('names the components that do exist, so reuse beats rebuilding', async () => {
    const { root, tools: plain, touched, workspace } = await harness()
    const tools = editTools({
      workspace,
      checkpoints: createCheckpointStore(root),
      globs: ['**/*.uidx'],
      turnId: TURN,
      maxFilesPerTurn: 2,
      onFileTouched: (file) => touched.push(file),
      index: indexStub(['Card', 'Control/Checkbox']),
    })
    void plain
    const result = await run(tools.edit, {
      file: 'home.uidx',
      ops: [
        { kind: 'insert_node', parent: '', node: { element: 'Instance', component: 'Crd' } },
      ],
    })
    expect(result).toBe(
      'not applied — op 1 instances "Crd", which no page defines — the document has Card, Control/Checkbox',
    )
    expect(touched).toEqual([])
  })

  it('lets a known component through', async () => {
    const { root, touched, workspace } = await harness()
    const tools = editTools({
      workspace,
      checkpoints: createCheckpointStore(root),
      globs: ['**/*.uidx'],
      turnId: TURN,
      maxFilesPerTurn: 2,
      onFileTouched: (file) => touched.push(file),
      index: indexStub(['Card']),
    })
    const result = await run(tools.edit, {
      file: 'home.uidx',
      ops: [{ kind: 'insert_node', parent: '', node: { element: 'Instance', component: 'Card' } }],
    })
    expect(result).toContain('applied')
  })
})
```

Add to that file's imports:

```ts
import type { DocumentIndex } from '../src/index/types.js'
```

- [ ] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" && pnpm --filter @uidx/agent test -- tools-edit.test.ts
```

Expected: FAIL — `index` is not a known property of `EditDeps`.

- [ ] **Step 3: Add the check to `edit.ts`**

Add to `EditDeps`:

```ts
  /**
   * The document's index, when this tool is running inside a real turn. It is
   * what lets an `Instance` naming a component nobody defined come back with
   * the names that do exist — the map already knows them, and rebuilding a
   * component that already exists is the failure this refusal is aimed at.
   * Absent outside a turn, where there is nothing to check against.
   */
  index?: DocumentIndex
```

Add above `editTools`:

```ts
/** As many component names as a refusal will list before it starts counting. */
const MAX_NAMED_COMPONENTS = 8

/**
 * Refuses an op that instances a component no page defines, naming the ones
 * that do. Returns null when every referenced component is real, or when there
 * is no index to check against.
 */
function unknownComponent(index: DocumentIndex | undefined, ops: readonly EditOp[]): string | null {
  if (!index) return null
  for (const [i, op] of ops.entries()) {
    if (op.kind !== 'insert_node') continue
    const wanted = new Set<string>()
    const walk = (node: NodeInput): void => {
      const component = node.attrs?.component
      if (typeof component === 'string') wanted.add(component)
      for (const child of node.children ?? []) walk(child)
    }
    walk(op.node)
    for (const name of wanted) {
      if (index.components.has(name)) continue
      const all = [...index.components.keys()].sort()
      const named = all.slice(0, MAX_NAMED_COMPONENTS)
      const rest = all.length - named.length
      const more = rest > 0 ? `, (+${rest} more)` : ''
      const has = all.length === 0 ? 'the document defines none' : `the document has ${named.join(', ')}${more}`
      return `op ${i + 1} instances ${JSON.stringify(name)}, which no page defines — ${has}`
    }
  }
  return null
}
```

Insert into the `edit` tool's `execute`, immediately after the `narrowOps` block:

```ts
      const unknown = unknownComponent(deps.index, narrowed.value)
      if (unknown) return `${NOT_APPLIED_PREFIX}${unknown}`
```

Add the imports:

```ts
import type { DocumentIndex } from '../index/types.js'
import { editOpsSchema, narrowOps, type EditOp, type NodeInput } from '../edit/ops.js'
```

- [ ] **Step 4: Thread it through**

In `packages/agent/src/tools/index.ts`, add to `buildTools`'s deps type (it already extends `EditDeps`, so nothing is needed there — confirm by typecheck).

In `packages/agent/src/server/turn.ts`, add `index,` to the `buildTools({ … })` call. The variable already exists on the line above (`const index = buildIndex(open.found.id, docs)`).

- [ ] **Step 5: Run the suite**

```bash
export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" && pnpm --filter @uidx/agent test && pnpm --filter @uidx/agent typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src packages/agent/test
git commit -m "Instancing a component nobody defined names the ones that exist"
```

---

### Task 4: The document map says what depends on what

**Files:**
- Modify: `packages/agent/src/index/doc-map.ts`
- Test: `packages/agent/test/doc-map.test.ts`

**Interfaces:**
- Consumes: `DocumentIndex` — `pages` (`PageEntry.headings`), `components`, `usesOfComponent(name)`, `usesOfVariable(address)`, `variables`.
- Produces: no new exports; `renderDocMap`'s output gains three things.

- [ ] **Step 1: Write the failing tests**

Append to `packages/agent/test/doc-map.test.ts`:

```ts
describe('what the index already knew', () => {
  it('names the pages that use a component, not just how many', () => {
    const map = renderDocMap(index)
    expect(map).toContain('used by home.uidx')
  })

  it("lists a page's own sections, so a section can be addressed without reading for it", () => {
    const map = renderDocMap(index)
    expect(map).toContain('sections: Core Intent, Visual Contract')
  })

  it('says which nodes bind a variable — the question a token scale exists for', () => {
    const map = renderDocMap(index)
    expect(map).toContain('radius#md: FLOAT — bound by home.uidx')
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" && pnpm --filter @uidx/agent test -- doc-map.test.ts
```

Expected: FAIL — the map shows `used 1×` and bare token lines.

- [ ] **Step 3: Implement**

Add near the top of `doc-map.ts`:

```ts
/**
 * How many files a relation names before it starts counting. A component used
 * on forty pages must not spend forty lines of a budget the whole map shares.
 */
const MAX_NAMED_FILES = 4

/** `home.uidx, about.uidx, (+7 more)` — the shape every relation here uses. */
function namedFiles(files: readonly string[]): string {
  const unique = [...new Set(files)].sort()
  const named = unique.slice(0, MAX_NAMED_FILES)
  const rest = unique.length - named.length
  return `${named.join(', ')}${rest > 0 ? `, (+${rest} more)` : ''}`
}
```

Replace `componentLine`'s last two lines:

```ts
  const uses = index.usesOfComponent(name)
  const where = uses.length > 0 ? ` — used by ${namedFiles(uses.map((use) => use.file))}` : ' — unused'
  return `  ${name}(${props})${slots}${variants}${status}${where}, in ${entry.file}`
```

In the PAGES section, replace the page line:

```ts
        ...pages.map((page) => {
          const nodes = page.topLevel.map((n) => `${n.name}<${n.element}>`).join(', ')
          const here = page.file === options.currentFile ? '  ← the page you are on' : ''
          // The headings have been computed on every index build since Task 4
          // of Phase 1 and shown to nobody. A page's own sections are how a
          // mission like "fix the contrast note" finds `doc#accessibility`
          // without reading its way there.
          const sections =
            page.headings.length > 0 ? `\n    sections: ${page.headings.join(', ')}` : ''
          return `  ${page.file} (${page.nodeCount} nodes): ${nodes || '(empty)'}${here}${sections}`
        }),
```

In the TOKENS section, replace the variable line:

```ts
      .map((v) => {
        const uses = index.usesOfVariable(v.address)
        const bound =
          uses.length > 0 ? ` — bound by ${namedFiles(uses.map((use) => use.file))}` : ''
        return `  ${v.address}: ${v.type}${bound}`
      })
```

- [ ] **Step 4: Run the suite**

```bash
export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" && pnpm --filter @uidx/agent test -- doc-map.test.ts pack.test.ts
```

Expected: PASS. `pack.test.ts` asserts a doc-map row verbatim; update that assertion to the new text rather than weakening it.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/index/doc-map.ts packages/agent/test
git commit -m "The map says what depends on what"
```

---

### Task 5: Sections trim instead of vanishing

**Files:**
- Modify: `packages/agent/src/index/doc-map.ts` (the budget loop at the end of `renderDocMap`)
- Test: `packages/agent/test/doc-map.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

```ts
it('trims every section rather than dropping the last ones whole', () => {
  // Tight enough that the old loop kept COMPONENTS and dropped PAGES and
  // TOKENS entirely — a document whose token scale became invisible under
  // pressure, which is the opposite of what a small budget should cost.
  const map = renderDocMap(index, { maxChars: 320 })
  expect(map).toContain('COMPONENTS')
  expect(map).toContain('PAGES')
  expect(map).toContain('TOKENS')
  expect(map).toContain('more, not shown')
  expect(map.length).toBeLessThanOrEqual(400)
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" && pnpm --filter @uidx/agent test -- doc-map.test.ts
```

Expected: FAIL — `TOKENS` is absent; the tail sections were dropped whole.

- [ ] **Step 3: Implement**

Replace the final budget loop (from `const kept: string[] = []` to the `return`) with:

```ts
  // Each section gets an equal share and keeps its head, rather than the
  // sections at the end being dropped entirely. A document large enough to
  // exceed the budget used to lose all of TOKENS while COMPONENTS was printed
  // in full — the reader ended up with a precise view of one third of the
  // document and no idea the rest existed.
  const share = Math.floor(max / Math.max(1, sections.length))
  const kept = sections.map((section) => {
    if (section.length <= share) return section
    const lines = section.split('\n')
    const head = [lines[0]!]
    let used = head[0]!.length
    for (const line of lines.slice(1)) {
      if (used + line.length + 1 > share) break
      head.push(line)
      used += line.length + 1
    }
    const hidden = lines.length - head.length
    return `${head.join('\n')}\n  (${hidden} more, not shown)`
  })

  return kept.join('\n\n')
```

- [ ] **Step 4: Run the suite**

```bash
export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" && pnpm --filter @uidx/agent test
```

Expected: PASS. A test asserting the old `section(s) omitted to fit the context budget` note must move to the new wording.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/index/doc-map.ts packages/agent/test/doc-map.test.ts
git commit -m "A tight budget costs every section a little, not the last ones everything"
```

---

### Task 6: Headless rendering, assembled from what exists

**Files:**
- Create: `packages/agent/src/render.ts`
- Modify: `packages/agent/package.json` (add `@open-pencil/core`, `@uidx/schema`)
- Test: `packages/agent/test/render.test.ts`

**Interfaces:**
- Consumes: `initCanvasKit`, `headlessRenderNodes` from `@open-pencil/core/io`; `fontManager` from `@open-pencil/core`; `toSceneGraph`, `buildTokenIndex`, `TokenResolver`, `resolveTokenValues` from `@uidx/schema`; `resolve`, `type UidxDocument`, `type UidxNode` from `@uidx/format`.
- Produces:
  - `export interface RenderRequest { docs: ReadonlyMap<string, UidxDocument>; file: string; address?: string; scale?: number }`
  - `export async function renderToPng(request: RenderRequest): Promise<Uint8Array>` — throws `RenderError` with a model-readable message.
  - `export class RenderError extends Error {}`

**Why this task writes no renderer.** `@open-pencil/core/io` already exports `initCanvasKit`, `headlessRenderNodes` and `headlessRenderThumbnail` — a Node raster path with no `<canvas>` and no `requestAnimationFrame`. The viewer's `thumbnails.ts` deliberately *skips* `initCanvasKit` because it resolves `canvaskit-wasm/full` through a Node path and would fetch the wrong binary in a browser; that skipped step is the one this task wants. Everything else is resolver wiring against documents the agent already holds.

**The trap.** `headless.js` does not seed fonts, and the viewer's `seedFonts` fetches `/fonts/Inter-*.ttf` over HTTP. The same TTFs ship inside `@open-pencil/core/assets/`, resolvable from Node. Without seeding, text nodes stay `pending` and draw nothing — a picture that looks like a layout bug but is a font bug.

- [ ] **Step 1: Add the dependencies**

```bash
cd packages/agent && export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" && pnpm add '@open-pencil/core@*' '@uidx/schema@workspace:*'
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/agent/test/render.test.ts
import { parse, type UidxDocument } from '@uidx/format'
import { describe, expect, it } from 'vitest'

import { renderToPng } from '../src/render.js'

const doc = (source: string): UidxDocument => {
  const result = parse(source)
  if (!result.doc) throw new Error(result.diagnostics.map((d) => d.message).join('; '))
  return result.doc
}

const TOKENS = doc(`---
id: tokens
---

## Visual Contract

<Tokens>
  <Collection name="radius">
    <Variable name="lg" type="FLOAT" value={16} />
  </Collection>
</Tokens>
`)

const PAGE = doc(`---
id: home
---

## Visual Contract

<Page>
  <Frame name="card" width={200} height={120} cornerRadius="{radius#lg}"
    fills={[{ type: 'SOLID', color: { r: 0.1, g: 0.4, b: 0.9, a: 1 } }]}>
    <Text name="title" characters="Hello" fontSize={24}
      fills={[{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }]} />
  </Frame>
</Page>
`)

const docs = new Map([
  ['tokens.uidx', TOKENS],
  ['home.uidx', PAGE],
])

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]

describe('renderToPng', () => {
  it('renders a whole page to PNG bytes', async () => {
    const bytes = await renderToPng({ docs, file: 'home.uidx' })
    expect([...bytes.slice(0, 4)]).toEqual(PNG_MAGIC)
    expect(bytes.byteLength).toBeGreaterThan(1_000)
  }, 60_000)

  it('renders one node by address', async () => {
    const bytes = await renderToPng({ docs, file: 'home.uidx', address: 'card' })
    expect([...bytes.slice(0, 4)]).toEqual(PNG_MAGIC)
  }, 60_000)

  // The reason this reuses `buildTokenIndex` rather than rendering a page in
  // isolation: the radius lives in another file. A render that missed it would
  // not fail — it would draw the fallback, and the model would "verify" a
  // picture the canvas never shows.
  it('resolves a token defined in another file', async () => {
    const withTokens = await renderToPng({ docs, file: 'home.uidx' })
    const alone = await renderToPng({ docs: new Map([['home.uidx', PAGE]]), file: 'home.uidx' })
    expect(Buffer.from(withTokens).equals(Buffer.from(alone))).toBe(false)
  }, 60_000)

  it('refuses an address that is not on the page, naming what is', async () => {
    await expect(renderToPng({ docs, file: 'home.uidx', address: 'nope' })).rejects.toThrow(
      /the page holds card/,
    )
  }, 60_000)
})
```

- [ ] **Step 3: Run it and watch it fail**

```bash
export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" && pnpm --filter @uidx/agent test -- render.test.ts
```

Expected: FAIL — `Failed to resolve import "../src/render.js"`.

- [ ] **Step 4: Write the implementation**

```ts
// packages/agent/src/render.ts
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { resolve, type UidxDocument, type UidxNode } from '@uidx/format'
import { fontManager } from '@open-pencil/core'
import { headlessRenderNodes, initCanvasKit } from '@open-pencil/core/io'
import {
  buildTokenIndex,
  resolveTokenValues,
  toSceneGraph,
  TokenResolver,
} from '@uidx/schema'

import { describeNearest } from './address.js'

/** A render that could not happen, said in words the model can act on. */
export class RenderError extends Error {}

export interface RenderRequest {
  /** Every document in the workspace — three of the four resolvers below read other files. */
  docs: ReadonlyMap<string, UidxDocument>
  file: string
  /** Omit for the whole page. */
  address?: string
  scale?: number
}

const FACES: Record<string, string> = {
  Regular: 'Regular',
  Medium: 'Medium',
  SemiBold: 'Semi Bold',
  Bold: 'Bold',
}

/**
 * Feeds the bundled Inter faces to the SDK's font manager, from the package
 * they ship in rather than over HTTP.
 *
 * `headlessRenderNodes` seeds nothing itself, and an unseeded face is not a
 * cosmetic problem: a codepoint the manager cannot serve raises a font
 * *demand*, and a node with an unsettled demand renders as nothing at all. A
 * page would come back as its frames with every label missing, which reads as a
 * layout bug and is not one. Web providers are refused outright for the same
 * reason the viewer refuses them — an unreachable provider holds the demand
 * open for as long as the network takes to give up.
 */
let fonts: Promise<void> | null = null
function seedFonts(): Promise<void> {
  fonts ??= (async () => {
    fontManager.setOnlineFontProviders({
      google: false,
      fontsource: false,
      bunny: false,
      fontshare: false,
    })
    fontManager.setWebFontFetch(() =>
      Promise.reject(new Error('uidx renders offline; web fonts are disabled')),
    )
    const require = createRequire(import.meta.url)
    const assets = join(dirname(require.resolve('@open-pencil/core/package.json')), 'assets')
    for (const [file, style] of Object.entries(FACES)) {
      const bytes = await readFile(join(assets, `Inter-${file}.ttf`))
      fontManager.markLoaded(
        'Inter',
        style,
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      )
    }
  })()
  return fonts
}

/** Booting CanvasKit costs ~100 ms and a 7 MB wasm binary, so it happens once. */
let canvasKit: ReturnType<typeof initCanvasKit> | null = null
function bootRenderer(): ReturnType<typeof initCanvasKit> {
  canvasKit ??= initCanvasKit()
  return canvasKit
}

/**
 * Draws a page, or one node of it, exactly as the canvas would.
 *
 * The four resolvers are the point. Three of them answer with something from
 * *another file* — a component defined on another page, a token from the
 * scale, an image — which is what separates a correct picture from a plausible
 * one. A render that skipped `buildTokenIndex` would not error; it would draw
 * every aliased value at its fallback, and the model would go on to "verify" a
 * page the designer will never see.
 */
export async function renderToPng(request: RenderRequest): Promise<Uint8Array> {
  const doc = request.docs.get(request.file)
  if (!doc) {
    const known = [...request.docs.keys()].sort().join(', ')
    throw new RenderError(`no such page: ${request.file}. Pages: ${known}`)
  }

  const all = [...request.docs.values()]
  const index = buildTokenIndex(all)
  const literals = resolveTokenValues(all)
  const components = new Map<string, UidxNode>()
  for (const other of all) {
    for (const child of other.tree.children) {
      if (child.element === 'Component' && typeof child.attrs.name?.value === 'string') {
        components.set(child.attrs.name.value, child)
      }
    }
  }

  const scene = toSceneGraph(doc, {
    resolveAlias: (address) => literals.get(address),
    resolveComponent: (name) => components.get(name),
    tokens: { resolver: new TokenResolver(index), index },
  })

  const target = request.address === undefined ? '' : request.address
  if (target !== '' && !resolve(doc.tree, target)) {
    throw new RenderError(
      `no node at address ${JSON.stringify(target)} on ${request.file}${describeNearest(doc, target)}`,
    )
  }
  const sceneId = target === '' ? scene.rootId : scene.addresses.sceneIdOf(target)
  if (!sceneId) {
    throw new RenderError(`${target} is on ${request.file} but draws nothing`)
  }

  await seedFonts()
  await bootRenderer()

  const pageId = scene.graph.getPages()[0]?.id
  if (!pageId) throw new RenderError('the scene graph has no page to draw')

  const bytes = await headlessRenderNodes(scene.graph, pageId, [sceneId], {
    scale: request.scale ?? 1,
    format: 'png',
  })
  if (!bytes) throw new RenderError(`nothing was drawn for ${request.file}`)
  return bytes
}

/** Test seam: the module-level caches would otherwise leak between cases. */
export function resetRenderer(): void {
  fonts = null
  canvasKit = null
}
```

- [ ] **Step 5: Run it and watch it pass**

```bash
export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" && pnpm --filter @uidx/agent test -- render.test.ts
```

Expected: PASS, 4 tests. If the token test fails because both renders are byte-identical, the token index is not reaching the scene — check that `resolveAlias` and `tokens` are both passed, since `toSceneGraph` uses the flat map for plain aliases and the index only for mode-aware ones.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/render.ts packages/agent/test/render.test.ts packages/agent/package.json
git commit -m "Render with the renderer the repo already ships"
```

---

### Task 7: `view_image`

**Files:**
- Create: `packages/agent/src/tools/view_image.ts`
- Modify: `packages/agent/src/tools/index.ts`, `packages/agent/src/server/turn.ts`, `packages/agent/src/config.ts`
- Test: `packages/agent/test/view-image.test.ts`

**Interfaces:**
- Consumes: `renderToPng`, `RenderError` from `../render.js`; `Workspace` from `../workspace/workspace.js`.
- Produces:
  - `export function viewImageTools(deps: { workspace: Workspace; vision: boolean; maxPixels?: number }): { view_image: Tool }`
  - `AgentConfig.vision: boolean`, from `UIDX_AGENT_VISION` (default `false`).
  - `UidxTools` gains `view_image: Tool`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent/test/view-image.test.ts
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { viewImageTools } from '../src/tools/view_image.js'
import { discoverManifests } from '../src/workspace/discover.js'
import { openWorkspace, type Workspace } from '../src/workspace/workspace.js'

const HOME = `---
id: home
---

## Visual Contract

<Page>
  <Frame name="card" width={200} height={120}
    fills={[{ type: 'SOLID', color: { r: 0.1, g: 0.4, b: 0.9, a: 1 } }]} />
</Page>
`

let open: Workspace | null = null
afterEach(async () => {
  await open?.close()
  open = null
})

async function harness(vision = true) {
  const root = await mkdtemp(join(tmpdir(), 'uidx-view-'))
  await writeFile(join(root, 'uidx.json'), JSON.stringify({ id: 'doc', files: ['**/*.uidx'] }))
  await writeFile(join(root, 'home.uidx'), HOME)
  const [found] = await discoverManifests([root])
  open = await openWorkspace(found!)
  return viewImageTools({ workspace: open, vision })
}

const run = async (tool: { execute?: unknown }, input: unknown): Promise<unknown> =>
  (tool.execute as (i: unknown, o: unknown) => Promise<unknown>)(input, {
    toolCallId: 't',
    messages: [],
  })

describe('view_image', () => {
  it('returns PNG bytes for a page', async () => {
    const { view_image } = await harness()
    const output = (await run(view_image, { file: 'home.uidx' })) as { png: string; note: string }
    expect(Buffer.from(output.png, 'base64').subarray(0, 4)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    )
    expect(output.note).toContain('home.uidx')
  }, 60_000)

  // A model that cannot see must be told, not handed bytes it will describe
  // from the filename.
  it('refuses when the model has no vision, rather than sending an image it cannot read', async () => {
    const { view_image } = await harness(false)
    expect(await run(view_image, { file: 'home.uidx' })).toBe(
      'refused: this model cannot see images. Set UIDX_AGENT_VISION=true only for a model that can.',
    )
  })

  it('passes a render refusal through in the words render.ts chose', async () => {
    const { view_image } = await harness()
    expect(await run(view_image, { file: 'home.uidx', address: 'nope' })).toContain(
      'the page holds card',
    )
  }, 60_000)
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" && pnpm --filter @uidx/agent test -- view-image.test.ts
```

Expected: FAIL — `Failed to resolve import "../src/tools/view_image.js"`.

- [ ] **Step 3: Write the tool**

```ts
// packages/agent/src/tools/view_image.ts
import { tool, type Tool } from 'ai'
import { z } from 'zod'

import { RenderError, renderToPng } from '../render.js'
import type { Workspace } from '../workspace/workspace.js'

export const NO_VISION =
  'refused: this model cannot see images. Set UIDX_AGENT_VISION=true only for a model that can.'

/**
 * The longest edge a returned image may have.
 *
 * An image is spent from the same window a read is, and a 4,000px page costs
 * far more than the look is worth. Scaled down, a documentation page is still
 * legible enough to answer "is this laid out right" — which is the question the
 * tool exists for, not "what does this say", which `read` answers exactly.
 */
const MAX_EDGE = 1_024

export interface ViewImageDeps {
  workspace: Workspace
  /** Whether the configured model can read an image at all. */
  vision: boolean
}

export function viewImageTools(deps: ViewImageDeps): { view_image: Tool } {
  const view_image = tool({
    description:
      'Look at a page or one node as an image, drawn the way the canvas draws it. Use it to check a layout you built.',
    inputSchema: z.object({
      file: z.string().describe('page path, e.g. home.uidx'),
      address: z
        .string()
        .optional()
        .describe('node address, e.g. hero#headline. Omit for the whole page.'),
    }),
    execute: async ({ file, address }) => {
      if (!deps.vision) return NO_VISION
      try {
        const png = await renderToPng({
          docs: deps.workspace.docs(),
          file,
          ...(address === undefined ? {} : { address }),
        })
        const what = address === undefined ? file : `${address} on ${file}`
        return {
          png: Buffer.from(png).toString('base64'),
          note: `${what}, drawn at up to ${MAX_EDGE}px`,
        }
      } catch (error) {
        // A render that cannot happen is a refusal like any other — the model
        // has to be able to act on it, so `render.ts`'s own words go through
        // unchanged rather than being flattened into "an error occurred".
        if (error instanceof RenderError) return `refused: ${error.message}`
        throw error
      }
    },
    // The bytes reach the model as an image part; the note gives it the words
    // for what it is looking at.
    toModelOutput: ({ output }) => {
      if (typeof output === 'string') return { type: 'text', value: output }
      const { png, note } = output as { png: string; note: string }
      return {
        type: 'content',
        value: [
          { type: 'text', text: note },
          { type: 'file', data: { type: 'data', data: png }, mediaType: 'image/png' },
        ],
      }
    },
  })

  return { view_image }
}
```

- [ ] **Step 4: Wire it up**

In `packages/agent/src/config.ts`, add to `AgentConfig`:

```ts
  /** Whether the orchestrator model can read an image. `view_image` refuses when false. */
  vision: boolean
```

and to `loadConfig`'s return:

```ts
    vision: env.UIDX_AGENT_VISION === 'true',
```

In `packages/agent/src/tools/index.ts`: add `view_image: Tool` to `UidxTools`, add `vision: boolean` to the deps type, and add to `base`:

```ts
    ...viewImageTools({ workspace: deps.workspace, vision: deps.vision }),
```

with `import { viewImageTools } from './view_image.js'`.

In `packages/agent/src/server/turn.ts`: add `vision: config.vision,` to the `buildTools({ … })` call, and `vision?: boolean` to `TurnRunnerConfig` (defaulting `config.vision ?? false` where it is read). In `packages/agent/src/server/main.ts`, add `vision: config.vision,`.

In `packages/agent/.env.example`, document it:

```
# Whether the model can read an image. `view_image` refuses when this is off,
# rather than sending bytes a text-only model will describe from the filename.
# UIDX_AGENT_VISION=true
```

- [ ] **Step 5: Run the whole suite and the gate**

```bash
export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" && pnpm --filter @uidx/agent test && pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm check:examples
```

Expected: all green. `delegate`'s `TOOLS_BY_KIND` allowlist in `agent/delegate.ts` names the tools each mission kind may use — add `view_image` to `read-mission` and `edit-mission` there, or a worker will be told the tool does not exist.

- [ ] **Step 6: Commit**

```bash
git add packages/agent
git commit -m "The agent can look at what it drew"
```

---

## Verification against the live model

After Task 7, with the agent rebuilt and restarted:

- [ ] **Refusals** — ask it to insert a node under a wrong address and confirm the reply names the real children.
- [ ] **The map** — ask "what would change if I edited `radius/lg`?" and confirm it answers without reading a file.
- [ ] **Sight** — set `UIDX_AGENT_VISION=true`, ask it to look at `examples/checkbox.uidx` and describe the layout, and confirm the description matches the rendered page rather than the markup.

## Not in this plan

Spec §4 (checklists), §5 (context mechanics), §6 (memory) and §7 (web search) get their own plan once these three land. Each is independently shippable and none of them is blocked by the others.
