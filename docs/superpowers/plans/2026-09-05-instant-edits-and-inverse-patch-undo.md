# Instant Edits and Inverse-Patch Undo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A viewer edit shows in the same frame, the server applies a patch with one parse and survives a 400-op batch, the canvas never writes layout results back into the file, and one undo stack covers the author, outside editors and LLM turns.

**Architecture:** The `.uidx` file stays the source of truth and the `FileSession` stays the ordering authority (revisions). The client keeps a confirmed `doc` and renders a `shown` document with in-flight patches predicted onto it. Undo is a new inverse patch dispatched through the same channel, never a rewind; inverses for revisions the client did not send are derived by diffing documents.

**Tech Stack:** TypeScript, Vue 3 (`<script setup>`), vitest, `magic-string`, `@open-pencil` scene graph, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-09-05-instant-edits-and-inverse-patch-undo-design.md`

## Global Constraints

- Run tests and builds with node 22: prefix every command with `export PATH=/Users/guybehar/.nvm/versions/node/v22.15.0/bin:$PATH &&` (default node 18 fails with `ERR_REQUIRE_ESM`).
- Work directly on `main`; commit after every task. No feature branch, no worktree.
- Every package uses `vitest run`; run one file with `pnpm --filter <pkg> exec vitest run test/<file>.test.ts`.
- The server and CLI run from `dist`: after changing `packages/format`, `packages/schema` or `packages/server`, run `pnpm build:cli` before a live check, then restart the viewer server (`preview_start` name `uidx-meridian-transit`, port 4620).
- The viewer runs from source through Vite; its changes hot-reload.
- Patch vocabulary is `UidxPatch` in `packages/format/src/types.ts:350`: `set`, `add`, `remove`, `set-mode`, `insert-node`, `remove-node`, `move-node`, `retag`.
- Addresses are scene ids (ADR 0003). `resolve(tree, address)` from `@uidx/format` finds a node; `''` is the root page.
- Never write a literal over an alias-bound attribute (`isAlias(value)` from `@uidx/format`) unless the author vouched for it.
- Byte identity of the file after undo is not promised; tree equality is.

---

## File Structure

**`packages/format`** (pure, no I/O):
- Modify `src/patch.ts` — `PatchResult.document`, attribute-batch single-parse path.
- Create `src/predict.ts` — `predictDocument(doc, patches)`: attribute ops applied to the tree without source.
- Create `src/inverse.ts` — `inversePatches(doc, patches)`.
- Create `src/diff-patches.ts` — `diffToPatches(prev, next)`.
- Modify `src/types.ts` — `UidxDocument.predicted?: true`.
- Modify `src/index.ts` — exports.

**`packages/server`:**
- Modify `src/session.ts` — use the returned document; `file:changed` carries `patchId`.
- Modify `src/protocol.ts` — `patchId?: string` on `file:changed`.

**`packages/agent`:**
- Modify `src/edit/apply.ts` — use the returned document; report written hashes.
- Modify `src/server/turn.ts` — `written` in message metadata.

**`packages/schema`:**
- Modify `src/from-scene.ts` — alias-bound attributes are never overwritten unvouched.
- Modify `src/reconcile.ts` — mode-aware diff and inserts; rebuild when a `modes` attribute changes.
- Modify `src/to-scene.ts` — export `withModes`.

**`packages/viewer`:**
- Create `src/definitions-moved.ts` — content comparison of instanced component definitions.
- Create `src/in-flight.ts` — the in-flight patch list and `shown` derivation.
- Create `src/undo-stack.ts` — the stack.
- Modify `src/CanvasPane.vue` — incremental path taken; definitions by content.
- Modify `src/App.vue` — `shown`, in-flight bookkeeping, stack wiring, ⌘Z.
- Modify `src/ChatPanel.vue` — emit `turn-finished` with written hashes.

---

### Task 1: `applyPatch` returns the document it already parsed

**Files:**
- Modify: `packages/format/src/patch.ts:37-40` (PatchResult), `:111-113` (applyPatch tail), `:150-165` (assertStillValid), `:178-200` (applyPatches)
- Test: `packages/format/test/patch.test.ts`

**Interfaces:**
- Produces: `PatchResult.document?: UidxDocument` — present whenever `validate !== false`; parsed from `result.source`.

- [ ] **Step 1: Write the failing test**

Append to `packages/format/test/patch.test.ts` (it already imports `applyPatch`, `applyPatches`, `parseOrThrow` and has a `SOURCE` fixture; use whatever fixture the file's first test uses, here called `SOURCE` with a node at address `demo#root`):

```ts
describe('the validating parse is returned, not thrown away', () => {
  it('applyPatch hands back the document for the patched source', () => {
    const result = applyPatch(SOURCE, { op: 'set', address: 'demo#root', prop: 'cornerRadius', value: 9 })
    expect(result.document).toBeDefined()
    expect(result.document!.source).toBe(result.source)
    expect(result.document!.tree.children[0]!.children[0]!.attrs.cornerRadius!.value).toBe(9)
  })

  it('applyPatch returns no document when validation is off', () => {
    const result = applyPatch(
      SOURCE,
      { op: 'set', address: 'demo#root', prop: 'cornerRadius', value: 9 },
      { validate: false },
    )
    expect(result.document).toBeUndefined()
  })

  it('applyPatches returns the document of the final source', () => {
    const result = applyPatches(SOURCE, [
      { op: 'set', address: 'demo#root', prop: 'cornerRadius', value: 9 },
      { op: 'add', address: 'demo#root', prop: 'visible', value: false },
    ])
    expect(result.document!.source).toBe(result.source)
    expect(result.document!.tree.children[0]!.children[0]!.attrs.visible!.value).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `export PATH=/Users/guybehar/.nvm/versions/node/v22.15.0/bin:$PATH && pnpm --filter @uidx/format exec vitest run test/patch.test.ts`
Expected: FAIL — `result.document` is `undefined`.

- [ ] **Step 3: Implement**

In `packages/format/src/patch.ts`:

```ts
export interface PatchResult {
  source: string
  /** Span in the *original* source that the patch touched. */
  changedRange: Range
  /**
   * The parsed result, when the patch was validated. The validating parse is
   * the one parse this function inherently owes; handing it back means the
   * caller — a `FileSession`, the agent harness — does not parse a second time.
   */
  document?: UidxDocument
}
```

Change `assertStillValid` to return the document:

```ts
function assertStillValid(source: string, patch: UidxPatch): UidxDocument {
  const { doc, diagnostics } = parse(source)
  if (doc) return doc
  const detail = diagnostics
    .filter((d) => d.severity === 'error')
    .map((d) => `${d.line}:${d.column} ${d.code}: ${d.message}`)
    .join('; ')
  throw new PatchError(
    `patch "${patch.op}" would produce an invalid document and was rejected — ${detail}`,
  )
}
```

Change the tail of `applyPatch`:

```ts
  const next = s.toString()
  const document = options.validate !== false ? assertStillValid(next, patch) : undefined
  return document ? { source: next, changedRange: changed, document } : { source: next, changedRange: changed }
```

In `applyPatches`, carry the last result's document and pass it forward so later ops do not re-parse the source they are handed:

```ts
export function applyPatches(
  source: string,
  patches: readonly UidxPatch[],
  options: PatchOptions = {},
): PatchResult {
  let current = source
  let document = options.document
  let lo = Number.POSITIVE_INFINITY
  let hi = -1
  for (const patch of patches) {
    // The document handed forward is always the parse of `current`: the
    // caller's for the first op, the validating parse's for every later one.
    const result = applyPatch(current, patch, { ...options, document })
    current = result.source
    document = result.document
    lo = Math.min(lo, result.changedRange.start)
    hi = Math.max(hi, result.changedRange.end)
  }
  const out: PatchResult = {
    source: current,
    changedRange: hi === -1 ? { start: 0, end: 0 } : { start: lo, end: hi },
  }
  if (document && document.source === current) out.document = document
  return out
}
```

- [ ] **Step 4: Run the format suite**

Run: `export PATH=/Users/guybehar/.nvm/versions/node/v22.15.0/bin:$PATH && pnpm --filter @uidx/format test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/format/src/patch.ts packages/format/test/patch.test.ts
git commit -m "format: applyPatch returns the document its validating parse produced"
```

---

### Task 2: The server parses once per patch and names its writes

**Files:**
- Modify: `packages/server/src/protocol.ts:12`
- Modify: `packages/server/src/session.ts:236-295` (patchNow)
- Test: `packages/server/test/session.test.ts`

**Interfaces:**
- Consumes: `PatchResult.document` from Task 1.
- Produces: `file:changed` messages carry `patchId?: string` when a patch caused them; watcher-driven ones carry none.

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/test/session.test.ts` (uses the existing `session`, `received`, `VALID` fixtures; the node in `VALID` is at address `c#root`):

```ts
import { vi } from 'vitest'
import * as format from '@uidx/format'

describe('one parse per patch', () => {
  it('does not call parse on the happy path', async () => {
    await session.start()
    const spy = vi.spyOn(format, 'parse')
    const reply = await session.patch({
      patchId: 'p1',
      baseRevision: session.revision,
      patches: [{ op: 'set', address: 'c#root', prop: 'cornerRadius', value: 8 }],
    })
    expect(reply.type).toBe('patch:applied')
    // The validating parse inside applyPatch is the only one; the session
    // must not add a second.
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('stamps its own write with the patch id, and a watcher reload with none', async () => {
    await session.start()
    await session.patch({
      patchId: 'p7',
      baseRevision: session.revision,
      patches: [{ op: 'set', address: 'c#root', prop: 'cornerRadius', value: 8 }],
    })
    const own = received.find((m) => m.type === 'file:changed' && m.revision === 2)
    expect(own).toMatchObject({ type: 'file:changed', patchId: 'p7' })

    await writeFile(file, VALID.replace('cornerRadius={4}', 'cornerRadius={5}'))
    await waitFor(() => received.some((m) => m.type === 'file:changed' && m.revision === 3))
    const external = received.find((m) => m.type === 'file:changed' && m.revision === 3)!
    expect((external as { patchId?: string }).patchId).toBeUndefined()
  })
})
```

`waitFor(predicate)` is the file's existing helper at line 46.

- [ ] **Step 2: Run and watch it fail**

Run: `export PATH=/Users/guybehar/.nvm/versions/node/v22.15.0/bin:$PATH && pnpm --filter @uidx/server exec vitest run test/session.test.ts`
Expected: FAIL — parse called twice; `patchId` missing.

- [ ] **Step 3: Implement**

`packages/server/src/protocol.ts`:

```ts
export type ServerMessage =
  | ({
      type: 'file:changed'
      revision: number
      doc: SerializedUidxDocument
      /**
       * Present when a `node:patch` produced this revision. The broadcast goes
       * out *before* the sender's `patch:applied`, so this is how a client tells
       * its own confirmation from someone else's edit.
       */
      patchId?: string
    } & PageRef)
  | ...rest unchanged
```

`packages/server/src/session.ts` — in `patchNow`, replace the apply-and-reparse block:

```ts
    let next: string
    let doc: UidxDocument | undefined
    try {
      const result = applyPatches(state.doc.source, request.patches, { document: state.doc })
      next = result.source
      doc = result.document
    } catch (err) {
      return this.refuse(patchId, (err as Error).message)
    }

    if (next === state.doc.source) {
      return { type: 'patch:applied', file: this.page, patchId, revision: state.revision }
    }

    // `applyPatches` validated the result and handed the parse back; the second
    // parse this used to do here was the one measured at a full second on a
    // 63k-line page. The fallback only runs if a caller turned validation off.
    if (!doc) {
      const parsed = parse(next)
      if (!parsed.doc) {
        return this.refuse(patchId, 'the patched file did not parse; nothing was written')
      }
      doc = parsed.doc
    }
```

and in the broadcast after the write:

```ts
    this.broadcast({
      type: 'file:changed',
      file: this.page,
      revision: this.state.revision,
      doc,
      patchId,
    })
```

- [ ] **Step 4: Run the server suite and typecheck**

Run: `export PATH=/Users/guybehar/.nvm/versions/node/v22.15.0/bin:$PATH && pnpm --filter @uidx/server test && pnpm --filter @uidx/server typecheck`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/protocol.ts packages/server/src/session.ts packages/server/test/session.test.ts
git commit -m "server: one parse per patch; file:changed names the patch that caused it"
```

---

### Task 3: The harness stops parsing twice per op

**Files:**
- Modify: `packages/agent/src/edit/apply.ts:60-88`
- Test: `packages/agent/test/apply.test.ts` (already exercises `applyOps` with a `ctx` built by its own helper).

- [ ] **Step 1: Write the failing test**

In that test file, alongside its existing `applyOps` setup:

```ts
it('parses once per op — the validating parse is reused', async () => {
  const spy = vi.spyOn(format, 'parse')
  const outcome = await applyOps(ctx, 'page.uidx', [
    { kind: 'set_prop', address: 'c#root', prop: 'cornerRadius', value: 8 },
  ])
  expect(outcome.ok).toBe(true)
  expect(spy).toHaveBeenCalledTimes(1)
  spy.mockRestore()
})
```

(`import * as format from '@uidx/format'` and `vi` from vitest.)

- [ ] **Step 2: Run and watch it fail**

Run: `export PATH=/Users/guybehar/.nvm/versions/node/v22.15.0/bin:$PATH && pnpm --filter @uidx/agent exec vitest run test/apply.test.ts`
Expected: FAIL — called twice.

- [ ] **Step 3: Implement**

In `applyOps`, replace the re-parse after `applyPatches`:

```ts
      const result = applyPatches(source, [patch], { document: doc })
      if (result.source === source) continue

      source = result.source
      // The validating parse is handed back; a missing one means validation was
      // off, which this call never asks for — so it is the same refusal as a
      // failed re-parse used to be.
      if (!result.document) {
        throw new Error(`${file}: op "${op.kind}" produced a document that failed to re-parse`)
      }
      doc = result.document
      changed++
```

- [ ] **Step 4: Run the agent suite**

Run: `export PATH=/Users/guybehar/.nvm/versions/node/v22.15.0/bin:$PATH && pnpm --filter @uidx/agent test`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/edit/apply.ts packages/agent/test
git commit -m "agent: reuse the validating parse instead of parsing every op twice"
```

---

### Task 4: An attribute-only batch is one parse

**Files:**
- Modify: `packages/format/src/patch.ts` (applyPatches)
- Test: `packages/format/test/patch.test.ts`

**Interfaces:**
- Produces: same `applyPatches` signature; behaviour: a batch of `set`/`add`/`remove`/`set-mode` on distinct addresses parses once.

- [ ] **Step 1: Write the failing tests**

```ts
describe('attribute batches parse once', () => {
  const TWO = `---
id: two
---

## Visual Contract

<Page>
  <Frame name="a" cornerRadius={4}>
    <Rectangle name="r1" width={10} />
    <Rectangle name="r2" width={10} />
  </Frame>
</Page>
`
  it('applies many attribute ops with a single validating parse', () => {
    const spy = vi.spyOn(format, 'parse')
    const doc = parseOrThrow(TWO)
    spy.mockClear()
    const result = applyPatches(
      TWO,
      [
        { op: 'set', address: 'a', prop: 'cornerRadius', value: 8 },
        { op: 'set', address: 'a/r1', prop: 'width', value: 20 },
        { op: 'add', address: 'a/r2', prop: 'visible', value: false },
      ],
      { document: doc },
    )
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
    expect(result.source).toContain('cornerRadius={8}')
    expect(result.source).toContain('name="r1" width={20}')
    expect(result.source).toContain('name="r2" width={10} visible={false}')
    expect(result.document!.source).toBe(result.source)
  })

  it('matches the sequential path byte for byte', () => {
    const doc = parseOrThrow(TWO)
    const patches: UidxPatch[] = [
      { op: 'set', address: 'a/r2', prop: 'width', value: 1 },
      { op: 'remove', address: 'a', prop: 'cornerRadius' },
      { op: 'add', address: 'a/r1', prop: 'height', value: 2 },
    ]
    const batched = applyPatches(TWO, patches, { document: doc }).source
    const sequential = patches.reduce((src, p) => applyPatch(src, p).source, TWO)
    expect(batched).toBe(sequential)
  })

  it('falls back to the sequential path when two ops touch one node', () => {
    const spy = vi.spyOn(format, 'parse')
    const doc = parseOrThrow(TWO)
    spy.mockClear()
    applyPatches(
      TWO,
      [
        { op: 'set', address: 'a/r1', prop: 'width', value: 20 },
        { op: 'add', address: 'a/r1', prop: 'height', value: 5 },
      ],
      { document: doc },
    )
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })

  it('falls back when a structural op is in the batch', () => {
    const spy = vi.spyOn(format, 'parse')
    const doc = parseOrThrow(TWO)
    spy.mockClear()
    applyPatches(
      TWO,
      [
        { op: 'set', address: 'a/r1', prop: 'width', value: 20 },
        { op: 'remove-node', address: 'a/r2' },
      ],
      { document: doc },
    )
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })
})
```

(`import * as format from '../src/index.js'` for the spy; `vi` from vitest; `UidxPatch` type import.)

- [ ] **Step 2: Run and watch it fail**

Expected: the first test FAILS with 3 parse calls.

- [ ] **Step 3: Implement**

In `packages/format/src/patch.ts`, above `applyPatches`:

```ts
const ATTRIBUTE_OPS = new Set<UidxPatch['op']>(['set', 'add', 'remove', 'set-mode'])

/**
 * Whether a batch can be applied as independent splices over one document.
 *
 * Attribute ops write inside one node's open tag (or one variable's mode
 * child), so two of them on different addresses never overlap and every
 * offset stays valid — `MagicString` maps edits by original offset. Two ops on
 * the same node can collide (an `add` and a `remove` on adjacent attributes),
 * and a structural op moves everything after it, so both take the re-parsing
 * path (spec §6.3).
 */
function isIndependentAttributeBatch(patches: readonly UidxPatch[]): boolean {
  if (patches.length < 2) return false
  const seen = new Set<string>()
  for (const patch of patches) {
    if (!ATTRIBUTE_OPS.has(patch.op)) return false
    const address = (patch as { address: string }).address
    if (seen.has(address)) return false
    seen.add(address)
  }
  return true
}

/**
 * The 400-op reflow burst measured on the atlas page cost the server one full
 * parse per op — minutes. Here it is one pass of splices and one parse.
 */
function applyAttributeBatch(
  source: string,
  patches: readonly UidxPatch[],
  options: PatchOptions,
): PatchResult {
  const doc = options.document ?? parseOrThrow(source)
  const s = new MagicString(source)
  const eol = detectEol(source)
  let lo = Number.POSITIVE_INFINITY
  let hi = -1
  for (const patch of patches) {
    let range: Range
    try {
      range = applyOne(doc, s, patch, eol)
    } catch (err) {
      if (err instanceof PatchError) throw err
      throw new PatchError(
        `the "${patch.op}" op on ${JSON.stringify(addressOfPatch(patch))} failed unexpectedly: ` +
          `${err instanceof Error ? err.message : String(err)}. This is a bug in the patcher — ` +
          'the file has not been written to',
        { cause: err },
      )
    }
    lo = Math.min(lo, range.start)
    hi = Math.max(hi, range.end)
  }
  const next = s.toString()
  const out: PatchResult = {
    source: next,
    changedRange: hi === -1 ? { start: 0, end: 0 } : { start: lo, end: hi },
  }
  if (options.validate !== false) out.document = assertStillValid(next, patches[0]!)
  return out
}
```

At the top of `applyPatches`:

```ts
  if (options.document && options.document.source !== source) {
    throw new PatchError(
      'the document passed to applyPatches was parsed from different source than the ' +
        'text being patched; its offsets do not describe this file',
    )
  }
  if (isIndependentAttributeBatch(patches)) return applyAttributeBatch(source, patches, options)
```

- [ ] **Step 4: Run the format suite**

Expected: pass, including the byte-for-byte test.

- [ ] **Step 5: Commit**

```bash
git add packages/format/src/patch.ts packages/format/test/patch.test.ts
git commit -m "format: an attribute-only batch on distinct nodes is one splice pass and one parse"
```

---

### Task 5: The canvas never writes a literal over an alias

**Files:**
- Modify: `packages/schema/src/from-scene.ts:160-200` (the per-prop loop)
- Test: `packages/schema/test/authorship.test.ts`

**Interfaces:**
- Consumes: `isAlias` from `@uidx/format`.
- Produces: `fromSceneChange` emits nothing for an unvouched change to an attribute whose file value is an alias.

- [ ] **Step 1: Write the failing test**

Append to `packages/schema/test/authorship.test.ts` (it already builds a document and graph and calls `fromSceneChange` with a context; reuse its helper that constructs `{ doc, graph, addresses }`, here called `contextFor(doc)`; if the helper has another name, use that):

```ts
describe('alias-bound attributes are the author’s, not the layout’s (the 413-patch leak)', () => {
  const RULE = parseOrThrow(`---
id: leak
---

## Visual Contract

<Page>
  <Frame name="doc" layoutMode="VERTICAL">
    <Rectangle name="rule" width="{layout#doc-inner}" height="{stroke#hair}" />
  </Frame>
</Page>
`)

  it('a reflow that re-announces resolved sizes writes nothing', () => {
    const scene = toSceneGraph(RULE, { resolveAlias: (a) => (a === 'layout#doc-inner' ? 1456 : 1) })
    const patches = fromSceneChange('doc/rule', { width: 1456, height: 1 }, {
      doc: RULE,
      graph: scene.graph,
      addresses: scene.addresses,
    })
    expect(patches).toEqual([])
  })

  it('a vouched write still replaces the alias with the typed value', () => {
    const scene = toSceneGraph(RULE, { resolveAlias: (a) => (a === 'layout#doc-inner' ? 1456 : 1) })
    const patches = fromSceneChange('doc/rule', { width: 300 }, {
      doc: RULE,
      graph: scene.graph,
      addresses: scene.addresses,
      authored: new Set(['width']),
      authoredFor: 'doc/rule',
    })
    expect(patches).toEqual([{ op: 'set', address: 'doc/rule', prop: 'width', value: 300 }])
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `export PATH=/Users/guybehar/.nvm/versions/node/v22.15.0/bin:$PATH && pnpm --filter @uidx/schema exec vitest run test/authorship.test.ts`
Expected: FAIL — first test emits `set width 1456` and `set height 1`.

- [ ] **Step 3: Implement**

In `from-scene.ts`, import `isAlias` from `@uidx/format` and add, at the top of the `if (!vouched)` block inside the per-prop loop:

```ts
    if (!vouched) {
      // An alias in the file is a binding, and the scene only ever holds what
      // it resolved to. Comparing the two always "differs", which is how the
      // layout engine came to write `width={1456}` over `{layout#doc-inner}`
      // on 413 nodes of one page. Only the author may replace a binding.
      if (existing && isAlias(existing.value)) continue
      if (VOUCHED_ONLY.has(prop)) continue
      ...
```

- [ ] **Step 4: Run the schema suite**

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/from-scene.ts packages/schema/test/authorship.test.ts
git commit -m "schema: an unvouched scene change never overwrites an alias-bound attribute"
```

---

### Task 6: The document diff understands modes

**Files:**
- Modify: `packages/schema/src/to-scene.ts:550` (export `withModes`)
- Modify: `packages/schema/src/reconcile.ts` (SceneChange insert carries a tuple; diffDocuments takes tokens; applyChanges resolves inserts by tuple)
- Test: `packages/schema/test/reconcile.test.ts`

**Interfaces:**
- Produces: `diffDocuments(prev, next, resolveAlias?, tokens?: { resolver: TokenResolver; index: TokenIndex })`; `SceneChange` insert gains `tuple?: ModeTuple`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/schema/test/reconcile.test.ts`:

```ts
import { buildTokenIndex } from '../src/token-index.js'
import { TokenResolver } from '../src/resolve-modes.js'

const TOKENS = parseOrThrow(`---
id: t
---

## Visual Contract

<Tokens>
  <Collection name="density" modes={['comfy', 'compact']}>
    <Variable name="pad" type="FLOAT">
      <Mode name="comfy" value={16} />
      <Mode name="compact" value={4} />
    </Variable>
  </Collection>
</Tokens>
`)
const tokensFor = () => {
  const index = buildTokenIndex([TOKENS])
  return { index, resolver: new TokenResolver(index) }
}
const page = (body: string) =>
  parseOrThrow(`---\nid: p\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`)

describe('diffDocuments under modes (spec §3)', () => {
  it('resolves an alias inside a compact subtree to the compact value', () => {
    const before = page(`  <Frame name="outer" modes={{ density: 'compact' }}>
    <Frame name="inner" cornerRadius={1} />
  </Frame>`)
    const after = page(`  <Frame name="outer" modes={{ density: 'compact' }}>
    <Frame name="inner" cornerRadius="{density#pad}" />
  </Frame>`)
    const changes = diffDocuments(before, after, undefined, tokensFor())
    expect(changes).toEqual([{ kind: 'update', address: 'outer/inner', props: { cornerRadius: 4 } }])
  })

  it('rebuilds when a modes attribute itself changes', () => {
    const before = page(`  <Frame name="outer" modes={{ density: 'compact' }} />`)
    const after = page(`  <Frame name="outer" modes={{ density: 'comfy' }} />`)
    expect(diffDocuments(before, after, undefined, tokensFor())).toBeNull()
  })

  it('an insert under a compact subtree carries the tuple and applies compact', () => {
    const before = page(`  <Frame name="outer" modes={{ density: 'compact' }} />`)
    const after = page(`  <Frame name="outer" modes={{ density: 'compact' }}>
    <Frame name="added" cornerRadius="{density#pad}" />
  </Frame>`)
    const tokens = tokensFor()
    const scene = toSceneGraph(before, { tokens })
    const changes = diffDocuments(before, after, undefined, tokens)!
    expect(changes[0]).toMatchObject({ kind: 'insert', parent: 'outer' })
    applyChanges(scene, changes, { tokens })
    expect(scene.graph.getNode('outer/added')!.cornerRadius).toBe(4)
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Expected: FAIL — first test resolves `cornerRadius` to `16` (default mode) or leaves the alias; second returns changes.

- [ ] **Step 3: Implement**

`to-scene.ts`: change `function withModes(` to `export function withModes(`.

`reconcile.ts`:

```ts
import { defaultTuple, mergeModes, type ModeTuple } from './resolve-modes.js'
import { withModes, ... } from './to-scene.js'

export type SceneChange =
  | { kind: 'update'; address: string; props: Partial<SceneNode> }
  /** `tuple` is the mode tuple in force at `parent`, so the subtree resolves as the page would. */
  | { kind: 'insert'; parent: string; index: number; node: UidxNode; tuple?: ModeTuple }
  | ...unchanged

/**
 * The mode tuple in force at every address, merged on the way down exactly as
 * `toSceneGraph` merges it (story G8). Without tokens every address maps to
 * null and the flat resolver is used, which is the pre-modes behaviour.
 */
function tuplesOf(doc: UidxDocument, tokens?: SceneOptions['tokens']): Map<string, ModeTuple | null> {
  const out = new Map<string, ModeTuple | null>()
  const walk = (node: UidxNode, inherited: ModeTuple | null): void => {
    const declared = node.attrs.modes?.value
    const tuple =
      tokens && inherited && declared !== null && typeof declared === 'object' && !Array.isArray(declared)
        ? mergeModes(inherited, declared as Record<string, string>, tokens.index)
        : inherited
    out.set(node.address, tuple)
    for (const child of node.children) walk(child, tuple)
  }
  walk(doc.tree, tokens ? defaultTuple(tokens.index) : null)
  return out
}

function resolverFor(
  base: AliasResolver | undefined,
  tokens: SceneOptions['tokens'],
  tuple: ModeTuple | null | undefined,
): AliasResolver | undefined {
  return tokens && tuple ? withModes(base, tokens.resolver.resolve(tuple)) : base
}
```

Change the signature and body of `diffDocuments`:

```ts
export function diffDocuments(
  prev: UidxDocument,
  next: UidxDocument,
  resolveAlias?: AliasResolver,
  tokens?: SceneOptions['tokens'],
): SceneChange[] | null {
  if (prev.frontmatter.id !== next.frontmatter.id) return null

  const before = indexNodes(prev)
  const after = indexNodes(next)
  const tuples = tuplesOf(next, tokens)

  // A `modes` attribute changing re-resolves everything beneath it, which is
  // more than a per-node diff can see; the rebuild is the honest answer.
  for (const [address, entry] of after) {
    const previous = before.get(address)
    if (previous && !deepEqual(previous.node.attrs.modes?.value, entry.node.attrs.modes?.value)) return null
  }
  ...existing instance/composition guard...

  // inserts:
    changes.push({
      kind: 'insert',
      parent: entry.parent,
      index: entry.index,
      node: entry.node,
      ...(tuples.get(entry.parent) ? { tuple: tuples.get(entry.parent)! } : {}),
    })

  // survivors:
    const props = diffProps(previous.node, entry.node, resolverFor(resolveAlias, tokens, tuples.get(address)))
```

In `applyChanges`, the insert case:

```ts
      case 'insert':
        insertSubtree(
          graph,
          change.node,
          sceneIdOf(change.parent, rootId),
          change.index,
          addresses,
          pins,
          change.tuple && options.tokens
            ? { ...options, resolveAlias: resolverFor(options.resolveAlias, options.tokens, change.tuple) }
            : options,
        )
        break
```

Check `insertSubtree` (below `applyChanges`) uses `options.resolveAlias` for the subtree it builds; it already takes `options`, so no further change.

- [ ] **Step 4: Run the schema suite and typecheck**

Run: `export PATH=/Users/guybehar/.nvm/versions/node/v22.15.0/bin:$PATH && pnpm --filter @uidx/schema test && pnpm --filter @uidx/schema typecheck`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/reconcile.ts packages/schema/src/to-scene.ts packages/schema/test/reconcile.test.ts
git commit -m "schema: diffDocuments and applyChanges resolve aliases under the mode tuple in force"
```

---

### Task 7: The canvas takes the incremental path on atlas

**Files:**
- Create: `packages/viewer/src/definitions-moved.ts`
- Test: `packages/viewer/test/definitions-moved.test.ts`
- Modify: `packages/viewer/src/CanvasPane.vue:1001-1002` (guard and diff call), `:1509-1537` (definitionsMoved and its watch)

**Interfaces:**
- Produces: `definitionsMoved(before, next, instanced): boolean` and `instancedComponents(doc): Set<string>`.

- [ ] **Step 1: Write the failing test**

`packages/viewer/test/definitions-moved.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { componentIndex } from '../src/layer-rows'
import { definitionsMoved, instancedComponents } from '../src/definitions-moved'

const LIB = (radius: number) =>
  parseOrThrow(`---
id: lib
---

## Visual Contract

<Page>
  <Component name="Chip" status="draft">
    <Frame name="root" cornerRadius={${radius}} />
  </Component>
  <Component name="Unused" status="draft">
    <Frame name="root" />
  </Component>
</Page>
`)

const USER = parseOrThrow(`---
id: user
---

## Visual Contract

<Page>
  <Frame name="doc">
    <Instance name="chip" component="Chip" />
  </Frame>
</Page>
`)

describe('definitionsMoved', () => {
  it('lists the components a page instances', () => {
    expect(instancedComponents(USER)).toEqual(new Set(['Chip']))
  })

  it('is false when a save re-parses the definitions into fresh but identical nodes', () => {
    const before = componentIndex([LIB(4)])
    const after = componentIndex([LIB(4)])
    expect(definitionsMoved(before, after, new Set(['Chip']))).toBe(false)
  })

  it('is true when an instanced definition changes', () => {
    expect(definitionsMoved(componentIndex([LIB(4)]), componentIndex([LIB(8)]), new Set(['Chip']))).toBe(true)
  })

  it('ignores a change to a component the page does not instance', () => {
    const before = componentIndex([LIB(4)])
    const after = componentIndex([
      parseOrThrow(LIB(4).source.replace('<Frame name="root" />', '<Frame name="root" cornerRadius={2} />')),
    ])
    expect(definitionsMoved(before, after, new Set(['Chip']))).toBe(false)
  })

  it('is true on first render and when an instanced definition appears or vanishes', () => {
    expect(definitionsMoved(undefined, componentIndex([LIB(4)]), new Set(['Chip']))).toBe(true)
    expect(definitionsMoved(componentIndex([LIB(4)]), new Map(), new Set(['Chip']))).toBe(true)
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `export PATH=/Users/guybehar/.nvm/versions/node/v22.15.0/bin:$PATH && pnpm --filter @uidx/viewer exec vitest run test/definitions-moved.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

`packages/viewer/src/definitions-moved.ts`:

```ts
import type { UidxDocument, UidxNode } from '@uidx/format'

/** Names of every `<Component>` this page instances, anywhere in its tree. */
export function instancedComponents(doc: UidxDocument | null): Set<string> {
  const out = new Set<string>()
  if (!doc) return out
  const walk = (node: UidxNode): void => {
    if (node.element === 'Instance') {
      const name = node.attrs.component?.value
      if (typeof name === 'string') out.add(name)
    }
    node.children.forEach(walk)
  }
  walk(doc.tree)
  return out
}

/**
 * A definition's content, independent of which parse produced it: element,
 * attribute values and children, recursively. Spans are left out on purpose —
 * a save moves every offset without changing what the component draws.
 */
function signature(node: UidxNode): string {
  const attrs = Object.entries(node.attrs)
    .map(([k, a]) => [k, a.value] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return JSON.stringify([node.element, attrs, node.children.map(signature)])
}

/**
 * Whether any component this page instances has changed content since the
 * graph was built. Identity was the old test, and a save re-parses every
 * definition into a fresh node — so a page that declared a component rebuilt
 * on every one of its own saves.
 */
export function definitionsMoved(
  before: ReadonlyMap<string, UidxNode> | undefined,
  next: ReadonlyMap<string, UidxNode> | undefined,
  instanced: ReadonlySet<string>,
): boolean {
  if (before === next) return false
  if (!before || !next) return true
  for (const name of instanced) {
    const a = before.get(name)
    const b = next.get(name)
    if (!a || !b) {
      if (a !== b) return true
      continue
    }
    if (a !== b && signature(a) !== signature(b)) return true
  }
  return false
}
```

- [ ] **Step 4: Wire it into CanvasPane**

In `CanvasPane.vue`:

- Replace the `definitionsMoved` function and `renderedWith` block (lines ~1509-1528) with:

```ts
import { definitionsMoved, instancedComponents } from './definitions-moved'

let renderedWith: ReadonlyMap<string, UidxNode> | undefined
const instanced = computed(() => instancedComponents(props.doc))
```

- In the components watch:

```ts
watch(
  () => props.components,
  (next) => {
    if (!definitionsMoved(renderedWith, next, instanced.value)) return
    void renderWithAssets(props.doc, true)
  },
)
```

- At line 1001, drop the modes guard and pass tokens:

```ts
    if (!rebuild && current && scene.value) {
      const changes = diffDocuments(current, doc, resolveAlias, props.sceneTokens)
```

- Delete `usesModes` if nothing else uses it (`grep -n usesModes packages/viewer/src/CanvasPane.vue`).

- [ ] **Step 5: Run the viewer suite and typecheck**

Run: `export PATH=/Users/guybehar/.nvm/versions/node/v22.15.0/bin:$PATH && pnpm --filter @uidx/viewer test && pnpm --filter @uidx/viewer typecheck`
Expected: pass. If a test asserted the modes rebuild (`grep -rn usesModes packages/viewer/test`), update it to assert the incremental path.

- [ ] **Step 6: Commit**

```bash
git add packages/viewer/src/definitions-moved.ts packages/viewer/test/definitions-moved.test.ts packages/viewer/src/CanvasPane.vue
git commit -m "viewer: the incremental path handles modes; definitions compared by content, only where instanced"
```

---

### Task 8: Phase 1 live check

**Files:** none changed. Measurement only.

- [ ] **Step 1: Build and restart**

Run: `export PATH=/Users/guybehar/.nvm/versions/node/v22.15.0/bin:$PATH && pnpm build:cli`
Then stop and start the viewer server (preview_stop the running `uidx-meridian-transit`, preview_start it again).

- [ ] **Step 2: Measure an eye toggle on atlas**

Open `http://localhost:4620`, open the atlas page, install the probe below with `javascript_tool`, click an eye on `doc#cover` via `document.querySelector` and `.click()`, wait 10 s, read the probe.

```js
window.__probe = { longTasks: [], sends: [], t0: 0 }
new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__probe.longTasks.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) }) }).observe({ entryTypes: ['longtask'] })
const send = WebSocket.prototype.send
WebSocket.prototype.send = function (m) { window.__probe.sends.push({ at: Math.round(performance.now()), head: String(m).slice(0, 120) }); return send.call(this, m) }
```

Expected: server round trip about 1.3 s (the `data-hidden` flip), one long task under 1 s, status text reads "1 change(s)" not "rebuilt", exactly one `node:patch` send. Record the numbers in the commit message of Task 9 or in `docs/backlog.md` under a dated note.

- [ ] **Step 3: Confirm no leak**

After the toggle, wait 15 s and check `window.__probe.sends` holds no second `node:patch`. Revert the toggle by clicking again. `git diff design-systems/meridian/atlas.uidx` must show only the user's pre-existing three lines.

---

### Task 9: `predictDocument` — attribute patches on the tree, no source

**Files:**
- Create: `packages/format/src/predict.ts`
- Modify: `packages/format/src/types.ts:338` (`predicted?: true`), `packages/format/src/index.ts`
- Test: `packages/format/test/predict.test.ts`

**Interfaces:**
- Produces: `predictDocument(doc: UidxDocument, patches: readonly UidxPatch[]): UidxDocument` — returns `doc` itself when there is nothing to predict (empty, all structural, or every address missing); otherwise a new document with `predicted: true`, sharing untouched subtrees.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { parseOrThrow, predictDocument, resolve } from '../src/index.js'

const DOC = parseOrThrow(`---
id: p
---

## Visual Contract

<Page>
  <Frame name="doc">
    <Rectangle name="cover" width={10} visible={true} />
    <Rectangle name="other" width={10} />
  </Frame>
</Page>
`)

describe('predictDocument', () => {
  it('sets an attribute on the addressed node and nothing else', () => {
    const next = predictDocument(DOC, [{ op: 'set', address: 'doc/cover', prop: 'visible', value: false }])
    expect(next).not.toBe(DOC)
    expect(next.predicted).toBe(true)
    expect(resolve(next.tree, 'doc/cover')!.attrs.visible!.value).toBe(false)
    expect(resolve(next.tree, 'doc/other')).toBe(resolve(DOC.tree, 'doc/other'))
    expect(resolve(DOC.tree, 'doc/cover')!.attrs.visible!.value).toBe(true)
  })

  it('adds and removes attributes', () => {
    const next = predictDocument(DOC, [
      { op: 'add', address: 'doc/other', prop: 'visible', value: false },
      { op: 'remove', address: 'doc/cover', prop: 'width' },
    ])
    expect(resolve(next.tree, 'doc/other')!.attrs.visible!.value).toBe(false)
    expect(resolve(next.tree, 'doc/cover')!.attrs.width).toBeUndefined()
  })

  it('returns the same document for structural ops and for missing addresses', () => {
    expect(predictDocument(DOC, [{ op: 'remove-node', address: 'doc/cover' }])).toBe(DOC)
    expect(predictDocument(DOC, [{ op: 'set', address: 'doc/gone', prop: 'visible', value: false }])).toBe(DOC)
    expect(predictDocument(DOC, [])).toBe(DOC)
  })

  it('applies later patches over earlier ones', () => {
    const next = predictDocument(DOC, [
      { op: 'set', address: 'doc/cover', prop: 'width', value: 20 },
      { op: 'set', address: 'doc/cover', prop: 'width', value: 30 },
    ])
    expect(resolve(next.tree, 'doc/cover')!.attrs.width!.value).toBe(30)
  })

  it('predicts a mode value on a variable', () => {
    const tokens = parseOrThrow(`---
id: t
---

## Visual Contract

<Tokens>
  <Collection name="c" modes={['a', 'b']}>
    <Variable name="v" type="FLOAT">
      <Mode name="a" value={1} />
      <Mode name="b" value={2} />
    </Variable>
  </Collection>
</Tokens>
`)
    const next = predictDocument(tokens, [{ op: 'set-mode', address: 'c/v', mode: 'b', value: 9 }])
    const variable = resolve(next.tree, 'c/v')!
    expect(variable.children.find((m) => m.attrs.name?.value === 'b')!.attrs.value!.value).toBe(9)
  })
})
```

Check the address of the variable in that Tokens fixture with `resolve` on the parsed doc (`c/v` or `c#v`) and use whichever `parseOrThrow` assigns, printed via a quick `console.log(resolve(tokens.tree, ...))` while writing the test.

- [ ] **Step 2: Run and watch it fail**

Expected: FAIL — `predictDocument` not exported.

- [ ] **Step 3: Implement**

`packages/format/src/types.ts` — add to `UidxDocument`:

```ts
  /**
   * Set on a document produced by `predictDocument`: its attribute values are
   * what the author will see once in-flight patches land, but its spans are
   * stale. Nothing may patch *against* a predicted document.
   */
  predicted?: true
```

`packages/format/src/predict.ts`:

```ts
import { isWithin, resolve } from './parse.js'
import { serializeValue } from './values.js'
import type { JsonValue, UidxAttr, UidxDocument, UidxNode, UidxPatch } from './types.js'

type AttributePatch = Extract<UidxPatch, { op: 'set' | 'add' | 'remove' | 'set-mode' }>

const isAttributePatch = (p: UidxPatch): p is AttributePatch =>
  p.op === 'set' || p.op === 'add' || p.op === 'remove' || p.op === 'set-mode'

const attr = (name: string, value: JsonValue, previous?: UidxAttr): UidxAttr => ({
  name,
  value,
  raw: serializeValue(value),
  loc: previous?.loc ?? { start: 0, end: 0 },
  valueLoc: previous?.valueLoc ?? { start: 0, end: 0 },
})

/**
 * The document as it will read once `patches` land, computed from the tree
 * alone (spec §4). Attribute ops only: a structural op needs address
 * recomputation for a moved subtree, and the canvas already shows its own
 * result for those, so such a batch is left to the round trip.
 *
 * Untouched subtrees are shared with `doc`, which is what keeps this cheap on
 * a 7k-node page and lets `===` on a node mean "unchanged" downstream.
 */
export function predictDocument(doc: UidxDocument, patches: readonly UidxPatch[]): UidxDocument {
  if (patches.length === 0) return doc
  if (!patches.every(isAttributePatch)) return doc

  const edits = new Map<string, ((node: UidxNode) => UidxNode)[]>()
  for (const patch of patches) {
    if (!resolve(doc.tree, patch.address)) continue // gone underneath us (spec §4)
    const list = edits.get(patch.address) ?? []
    list.push(editFor(patch))
    edits.set(patch.address, list)
  }
  if (edits.size === 0) return doc

  const rebuild = (node: UidxNode): UidxNode => {
    const own = edits.get(node.address)
    const touchesBelow = [...edits.keys()].some((a) => a !== node.address && isWithin(node.address, a))
    if (!own && !touchesBelow) return node
    let next: UidxNode = touchesBelow ? { ...node, children: node.children.map(rebuild) } : { ...node }
    for (const edit of own ?? []) next = edit(next)
    return next
  }

  return { ...doc, tree: rebuild(doc.tree), predicted: true }
}

function editFor(patch: AttributePatch): (node: UidxNode) => UidxNode {
  switch (patch.op) {
    case 'set':
    case 'add':
      return (node) => ({
        ...node,
        attrs: { ...node.attrs, [patch.prop]: attr(patch.prop, patch.value, node.attrs[patch.prop]) },
      })
    case 'remove':
      return (node) => {
        const { [patch.prop]: _dropped, ...rest } = node.attrs
        return { ...node, attrs: rest }
      }
    case 'set-mode':
      return (node) => ({
        ...node,
        children: node.children.map((child) =>
          child.element === 'Mode' && child.attrs.name?.value === patch.mode
            ? { ...child, attrs: { ...child.attrs, value: attr('value', patch.value, child.attrs.value) } }
            : child,
        ),
      })
  }
}
```

`isWithin(ancestor, address)` (`parse.ts:1535`) is true when `address` is inside `ancestor`. Export from `index.ts`: `export { predictDocument } from './predict.js'`.

- [ ] **Step 4: Run the format suite and typecheck**

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/format/src/predict.ts packages/format/src/types.ts packages/format/src/index.ts packages/format/test/predict.test.ts
git commit -m "format: predictDocument applies attribute patches to the tree without source"
```

---

### Task 10: The shell renders `shown`

**Files:**
- Create: `packages/viewer/src/in-flight.ts`
- Test: `packages/viewer/test/in-flight.test.ts`
- Modify: `packages/viewer/src/App.vue` — declarations near `:83`, `commitPatches` `:837-851`, `channel` options `:788-800`, `file:changed` `:377-390`, `sceneDoc` `:566`

**Interfaces:**
- Produces: `createInFlight()` returning `{ push(patchId, patches), settle(patchId): boolean, has(patchId), patches(): UidxPatch[], readonly size, readonly version }`; `App.vue` computed `shown`.
- Consumes: `predictDocument` (Task 9); `file:changed.patchId` (Task 2); `channel.dispatch` returning the patch id.

- [ ] **Step 1: Write the failing test**

`packages/viewer/test/in-flight.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createInFlight } from '../src/in-flight'

describe('createInFlight', () => {
  it('holds batches in dispatch order until settled', () => {
    const flight = createInFlight()
    flight.push('p1', [{ op: 'set', address: 'a', prop: 'visible', value: false }])
    flight.push('p2', [{ op: 'set', address: 'a', prop: 'visible', value: true }])
    expect(flight.size).toBe(2)
    expect(flight.patches().map((p) => (p as { value: unknown }).value)).toEqual([false, true])
    expect(flight.settle('p1')).toBe(true)
    expect(flight.settle('p1')).toBe(false)
    expect(flight.patches()).toHaveLength(1)
    expect(flight.has('p2')).toBe(true)
  })

  it('bumps a version on every change so a computed can depend on it', () => {
    const flight = createInFlight()
    const v0 = flight.version
    flight.push('p1', [{ op: 'set', address: 'a', prop: 'visible', value: false }])
    expect(flight.version).toBeGreaterThan(v0)
    const v1 = flight.version
    flight.settle('p1')
    expect(flight.version).toBeGreaterThan(v1)
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

`packages/viewer/src/in-flight.ts`:

```ts
import { shallowRef } from 'vue'
import type { UidxPatch } from '@uidx/format'

/**
 * The patches this client has sent and not yet seen land (spec §4).
 *
 * Reactive through one counter rather than a reactive array: the shell's
 * `shown` computed reads `version`, so a push or a settle recomputes the
 * prediction exactly once, and nothing deep-watches patch objects.
 */
export interface InFlight {
  push(patchId: string, patches: readonly UidxPatch[]): void
  /** True if the id was in flight. */
  settle(patchId: string): boolean
  has(patchId: string): boolean
  /** Every in-flight patch, oldest batch first. */
  patches(): UidxPatch[]
  readonly size: number
  readonly version: number
}

export function createInFlight(): InFlight {
  const batches = new Map<string, readonly UidxPatch[]>()
  const version = shallowRef(0)
  return {
    push(patchId, patches) {
      batches.set(patchId, patches)
      version.value += 1
    },
    settle(patchId) {
      const had = batches.delete(patchId)
      if (had) version.value += 1
      return had
    },
    has: (patchId) => batches.has(patchId),
    patches: () => [...batches.values()].flat(),
    get size() {
      return batches.size
    },
    get version() {
      return version.value
    },
  }
}
```

- [ ] **Step 4: Wire the shell**

In `App.vue`:

```ts
import { predictDocument } from '@uidx/format'
import { createInFlight } from './in-flight'

const inFlight = createInFlight()

/**
 * What the panes render: the confirmed document with this client's in-flight
 * attribute patches predicted onto it (spec §4). Equal to `doc` when nothing
 * is in flight. Patches are always written against `doc`, never this.
 */
const shown = computed<UidxDocument | null>(() => {
  const base = doc.value
  void inFlight.version
  if (!base || inFlight.size === 0) return base
  return predictDocument(base, inFlight.patches())
})
```

Change `sceneDoc`:

```ts
const sceneDoc = computed(() => (renderable.value ? shown.value : null))
```

In `commitPatches`, after `channel.dispatch(...)`:

```ts
  const patchId = channel.dispatch(page, revision.value, patches, doc.value ?? undefined)
  if (patchId) inFlight.push(patchId, patches)
```

`commitAcrossPages` dispatches per file; predict only the open page's batch:

```ts
    const patchId = channel.dispatch(file, at, patches, pages.value.get(file))
    if (patchId && file === open) inFlight.push(patchId, patches)
```

In the channel's `onRollback`, settle first, keep the re-render:

```ts
  onRollback: (entry) => {
    inFlight.settle(entry.patchId)
    const authoritative = doc.value
    doc.value = null
    doc.value = authoritative
  },
```

In `file:changed`:

```ts
      case 'file:changed': {
        if (message.patchId) inFlight.settle(message.patchId)
        pages.value.set(message.file, message.doc)
        ...unchanged
```

- [ ] **Step 5: Run the viewer suite and typecheck**

Expected: pass.

- [ ] **Step 6: Live check**

With the server from Task 8 running, toggle an eye on atlas with the probe installed. Expected: the row's `data-hidden` flips within the same tick as the click (record `performance.now()` before `.click()` and in a `MutationObserver` on `data-hidden`; the difference is under 50 ms), the canvas hides the node before the server answers, and when `file:changed` arrives the status shows `0 change(s)` or `1 change(s)` with no visible flicker.

- [ ] **Step 7: Commit**

```bash
git add packages/viewer/src/in-flight.ts packages/viewer/test/in-flight.test.ts packages/viewer/src/App.vue
git commit -m "viewer: panes render the confirmed document with in-flight attribute patches predicted onto it"
```

---

### Task 11: `inversePatches`

**Files:**
- Create: `packages/format/src/inverse.ts`
- Modify: `packages/format/src/index.ts`
- Test: `packages/format/test/inverse.test.ts`

**Interfaces:**
- Produces: `inversePatches(doc: UidxDocument, patches: readonly UidxPatch[]): UidxPatch[]` — the batch that takes the patched document back; throws `PatchError` for an `insert-node` without a `name` attribute or a `retag`.
- Consumes: `predictDocument` to advance the baseline between attribute ops.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { applyPatches, inversePatches, parseOrThrow, type UidxNode, type UidxPatch } from '../src/index.js'

const SRC = `---
id: p
---

## Visual Contract

<Page>
  <Frame name="doc">
    <Rectangle name="cover" width={10} visible={true} />
    <Rectangle name="other" width={10} />
    <Frame name="group">
      <Text name="label" characters="Hi" />
    </Frame>
  </Frame>
</Page>
`

/** Element, name, attribute values and children — what "the same tree" means. */
const shape = (node: UidxNode): unknown => [
  node.element,
  Object.fromEntries(Object.entries(node.attrs).map(([k, a]) => [k, a.value])),
  node.children.map(shape),
]

function roundTrips(patches: UidxPatch[]): void {
  const doc = parseOrThrow(SRC)
  const inverse = inversePatches(doc, patches)
  const forward = applyPatches(SRC, patches)
  const back = applyPatches(forward.source, inverse)
  expect(shape(back.document!.tree)).toEqual(shape(doc.tree))
}

describe('inversePatches', () => {
  it('set → set old', () => {
    const doc = parseOrThrow(SRC)
    expect(inversePatches(doc, [{ op: 'set', address: 'doc/cover', prop: 'width', value: 20 }])).toEqual([
      { op: 'set', address: 'doc/cover', prop: 'width', value: 10 },
    ])
  })
  it('add → remove, remove → add old', () => {
    const doc = parseOrThrow(SRC)
    expect(inversePatches(doc, [{ op: 'add', address: 'doc/other', prop: 'visible', value: false }])).toEqual([
      { op: 'remove', address: 'doc/other', prop: 'visible' },
    ])
    expect(inversePatches(doc, [{ op: 'remove', address: 'doc/cover', prop: 'visible' }])).toEqual([
      { op: 'add', address: 'doc/cover', prop: 'visible', value: true },
    ])
  })
  it('two edits to one property invert in reverse order against the running value', () => {
    const doc = parseOrThrow(SRC)
    expect(
      inversePatches(doc, [
        { op: 'set', address: 'doc/cover', prop: 'width', value: 20 },
        { op: 'set', address: 'doc/cover', prop: 'width', value: 30 },
      ]),
    ).toEqual([
      { op: 'set', address: 'doc/cover', prop: 'width', value: 20 },
      { op: 'set', address: 'doc/cover', prop: 'width', value: 10 },
    ])
  })
  it('round-trips attribute batches', () => {
    roundTrips([
      { op: 'set', address: 'doc/cover', prop: 'width', value: 20 },
      { op: 'add', address: 'doc/other', prop: 'visible', value: false },
      { op: 'remove', address: 'doc/cover', prop: 'visible' },
    ])
  })
  it('round-trips remove-node', () => {
    roundTrips([{ op: 'remove-node', address: 'doc/group' }])
  })
  it('round-trips insert-node', () => {
    roundTrips([
      { op: 'insert-node', parent: 'doc', index: 1, node: { element: 'Rectangle', attrs: { name: 'added', width: 5 } } },
    ])
  })
  it('round-trips move-node', () => {
    roundTrips([{ op: 'move-node', address: 'doc/cover', newParent: 'doc/group', index: 0 }])
  })
  it('refuses an insert without a name', () => {
    const doc = parseOrThrow(SRC)
    expect(() =>
      inversePatches(doc, [{ op: 'insert-node', parent: 'doc', index: 0, node: { element: 'Rectangle', attrs: {} } }]),
    ).toThrow(/name/)
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

`packages/format/src/inverse.ts`:

```ts
import { addressOf, resolve, resolveParent } from './parse.js'
import { PatchError } from './patch.js'
import { predictDocument } from './predict.js'
import type { UidxDocument, UidxNode, UidxNodeSpec, UidxPatch } from './types.js'

/** A node as an insert spec: attrs by value, children recursively. */
export function toNodeSpec(node: UidxNode): UidxNodeSpec {
  const attrs = Object.fromEntries(Object.entries(node.attrs).map(([k, a]) => [k, a.value]))
  return node.children.length
    ? { element: node.element, attrs, children: node.children.map(toNodeSpec) }
    : { element: node.element, attrs }
}

/**
 * The batch that undoes `patches`, computed against the document they were
 * written for (spec §5). Later ops in a batch are inverted against the
 * document as the earlier ones leave it, and the result is emitted newest
 * first, so applying it walks the edit back step by step.
 */
export function inversePatches(doc: UidxDocument, patches: readonly UidxPatch[]): UidxPatch[] {
  const out: UidxPatch[] = []
  let current = doc
  for (const patch of patches) {
    out.unshift(...invertOne(current, patch))
    current = advance(current, patch)
  }
  return out
}

function mustResolve(doc: UidxDocument, address: string): UidxNode {
  const node = resolve(doc.tree, address)
  if (!node) throw new PatchError(`no node at address ${JSON.stringify(address)}`)
  return node
}

function invertOne(doc: UidxDocument, patch: UidxPatch): UidxPatch[] {
  switch (patch.op) {
    case 'set': {
      const node = mustResolve(doc, patch.address)
      const attr = node.attrs[patch.prop]
      if (!attr) throw new PatchError(`${patch.address} has no attribute "${patch.prop}" to restore`)
      return [{ op: 'set', address: patch.address, prop: patch.prop, value: attr.value }]
    }
    case 'add':
      return [{ op: 'remove', address: patch.address, prop: patch.prop }]
    case 'remove': {
      const node = mustResolve(doc, patch.address)
      const attr = node.attrs[patch.prop]
      if (!attr) throw new PatchError(`${patch.address} has no attribute "${patch.prop}" to restore`)
      return [{ op: 'add', address: patch.address, prop: patch.prop, value: attr.value }]
    }
    case 'set-mode': {
      const variable = mustResolve(doc, patch.address)
      const mode = variable.children.find((c) => c.element === 'Mode' && c.attrs.name?.value === patch.mode)
      const value = mode?.attrs.value?.value
      if (value === undefined) throw new PatchError(`${patch.address} has no mode "${patch.mode}" to restore`)
      return [{ op: 'set-mode', address: patch.address, mode: patch.mode, value }]
    }
    case 'insert-node': {
      const name = patch.node.attrs.name
      if (typeof name !== 'string') {
        throw new PatchError('an insert-node without a name attribute cannot be inverted')
      }
      mustResolve(doc, patch.parent)
      return [{ op: 'remove-node', address: addressOf(patch.parent, name) }]
    }
    case 'remove-node': {
      const node = mustResolve(doc, patch.address)
      const parent = resolveParent(doc.tree, patch.address)
      if (!parent) throw new PatchError(`cannot remove the root`)
      const index = parent.children.indexOf(node)
      return [{ op: 'insert-node', parent: parent.address, index, node: toNodeSpec(node) }]
    }
    case 'move-node': {
      const node = mustResolve(doc, patch.address)
      const parent = resolveParent(doc.tree, patch.address)
      if (!parent) throw new PatchError(`cannot move the root`)
      const index = parent.children.indexOf(node)
      mustResolve(doc, patch.newParent)
      return [
        { op: 'move-node', address: addressOf(patch.newParent, node.name), newParent: parent.address, index },
      ]
    }
    default:
      throw new PatchError(`the "${patch.op}" op cannot be inverted`)
  }
}

/** The document after `patch`, well enough for the next inversion to read. */
function advance(doc: UidxDocument, patch: UidxPatch): UidxDocument {
  switch (patch.op) {
    case 'set':
    case 'add':
    case 'remove':
    case 'set-mode':
      return predictDocument(doc, [patch])
    default:
      // A structural op moves addresses; a batch mixing them with later ops on
      // the moved nodes is rare and the server re-parses between them anyway.
      // Inverting against the pre-op document is right for every op that does
      // not name what this one moved.
      return doc
  }
}
```

`addressOf(parentAddress, name)` (`parse.ts:121`) is the one address rule; `resolveParent(root, address)` (`parse.ts:1516`) returns the parent node. Export from `index.ts`: `export { inversePatches, toNodeSpec } from './inverse.js'`.

- [ ] **Step 4: Run the format suite**

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/format/src/inverse.ts packages/format/src/index.ts packages/format/test/inverse.test.ts
git commit -m "format: inversePatches — the batch that takes a patched document back"
```

---

### Task 12: `diffToPatches`

**Files:**
- Create: `packages/format/src/diff-patches.ts`
- Modify: `packages/format/src/index.ts`
- Test: `packages/format/test/diff-patches.test.ts`

**Interfaces:**
- Produces: `diffToPatches(prev: UidxDocument, next: UidxDocument): UidxPatch[]` such that applying them to `prev.source` parses to `next`'s tree shape. Empty when trees are identical. Prose and frontmatter differences are ignored.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { applyPatches, diffToPatches, parseOrThrow, type UidxNode } from '../src/index.js'

const shape = (node: UidxNode): unknown => [
  node.element,
  Object.fromEntries(Object.entries(node.attrs).map(([k, a]) => [k, a.value])),
  node.children.map(shape),
]
const page = (body: string) => parseOrThrow(`---\nid: p\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`)

function reaches(prev: ReturnType<typeof page>, next: ReturnType<typeof page>): void {
  const patches = diffToPatches(prev, next)
  const result = applyPatches(prev.source, patches)
  expect(shape(result.document!.tree)).toEqual(shape(next.tree))
}

describe('diffToPatches', () => {
  it('is empty for identical trees, even with different prose', () => {
    const a = page(`  <Frame name="a" />`)
    const b = parseOrThrow(a.source.replace('## Visual Contract', '## Visual Contract\n\nSome prose.'))
    expect(diffToPatches(a, b)).toEqual([])
  })
  it('emits set/add/remove for attribute differences', () => {
    const a = page(`  <Frame name="a" cornerRadius={4} visible={true} />`)
    const b = page(`  <Frame name="a" cornerRadius={8} opacity={0.5} />`)
    expect(diffToPatches(a, b)).toEqual(
      expect.arrayContaining([
        { op: 'set', address: 'a', prop: 'cornerRadius', value: 8 },
        { op: 'add', address: 'a', prop: 'opacity', value: 0.5 },
        { op: 'remove', address: 'a', prop: 'visible' },
      ]),
    )
    reaches(a, b)
  })
  it('emits remove-node and insert-node for structure', () => {
    reaches(page(`  <Frame name="a">\n    <Text name="t" characters="x" />\n  </Frame>`), page(`  <Frame name="a" />`))
    reaches(page(`  <Frame name="a" />`), page(`  <Frame name="a">\n    <Text name="t" characters="x" />\n  </Frame>`))
  })
  it('emits move-node for reordering', () => {
    reaches(
      page(`  <Frame name="a">\n    <Text name="x" characters="x" />\n    <Text name="y" characters="y" />\n  </Frame>`),
      page(`  <Frame name="a">\n    <Text name="y" characters="y" />\n    <Text name="x" characters="x" />\n  </Frame>`),
    )
  })
  it('a rename is a remove plus an insert', () => {
    reaches(page(`  <Frame name="a" />`), page(`  <Frame name="b" />`))
  })
  it('round-trips the meridian atlas against itself and against a one-attribute change', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    const src = fs.readFileSync(`${__dirname}/../../../design-systems/meridian/atlas.uidx`, 'utf8')
    const a = parseOrThrow(src)
    expect(diffToPatches(a, parseOrThrow(src))).toEqual([])
    const b = applyPatches(src, [{ op: 'set', address: 'doc#cover', prop: 'visible', value: false }]).document!
    expect(diffToPatches(a, b)).toEqual([{ op: 'add', address: 'doc#cover', prop: 'visible', value: false }])
  })
})
```

(The last expectation is `add` if `doc#cover` has no `visible` in the checked-in file, `set` if it has; read the file to decide and assert the true one. Use an ESM-friendly read — `readFileSync` imported from `node:fs` and `fileURLToPath(import.meta.url)` — if `require` is unavailable in the test runner.)

- [ ] **Step 2: Run and watch it fail**

Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

`packages/format/src/diff-patches.ts`:

```ts
import { isWithin } from './parse.js'
import { toNodeSpec } from './inverse.js'
import type { JsonValue, UidxDocument, UidxNode, UidxPatch } from './types.js'

type Entry = { node: UidxNode; parent: string | null; index: number }

function indexNodes(doc: UidxDocument): Map<string, Entry> {
  const out = new Map<string, Entry>()
  const walk = (node: UidxNode, parent: string | null, index: number): void => {
    out.set(node.address, { node, parent, index })
    node.children.forEach((child, i) => walk(child, node.address, i))
  }
  walk(doc.tree, null, 0)
  return out
}

const depth = (address: string): number => (address === '' ? 0 : address.split(/[/#]/).length)

function deepEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * The patches that take `prev`'s tree to `next`'s (spec §5). This is how a
 * revision this client did not send — an outside editor, an LLM turn, a
 * `uidx apply` — gets an inverse: `diffToPatches(next, prev)`.
 *
 * Address-keyed like `diffDocuments`, and for the same reason: addresses are
 * identity (ADR 0003), so a rename is a remove plus an insert. Prose and
 * frontmatter are outside the patch vocabulary and are not expressed.
 */
export function diffToPatches(prev: UidxDocument, next: UidxDocument): UidxPatch[] {
  const before = indexNodes(prev)
  const after = indexNodes(next)
  const out: UidxPatch[] = []

  // Removals, deepest first, skipping anything an ancestor's removal covers.
  const removed = [...before.keys()].filter((a) => !after.has(a)).sort((a, b) => depth(b) - depth(a))
  for (const address of removed) {
    if (removed.some((other) => other !== address && isWithin(other, address))) continue
    out.push({ op: 'remove-node', address })
  }

  // Inserts, shallowest first; a child of an inserted node arrives inside it.
  const added = [...after.keys()].filter((a) => !before.has(a)).sort((a, b) => depth(a) - depth(b))
  const addedSet = new Set(added)
  for (const address of added) {
    const entry = after.get(address)!
    if (entry.parent === null) continue
    if (addedSet.has(entry.parent)) continue
    out.push({ op: 'insert-node', parent: entry.parent, index: entry.index, node: toNodeSpec(entry.node) })
  }

  // Survivors: attributes, then position.
  for (const [address, entry] of after) {
    const previous = before.get(address)
    if (!previous) continue
    for (const [prop, attr] of Object.entries(entry.node.attrs)) {
      const old = previous.node.attrs[prop]
      if (!old) out.push({ op: 'add', address, prop, value: attr.value })
      else if (!deepEqual(old.value, attr.value)) out.push({ op: 'set', address, prop, value: attr.value })
    }
    for (const prop of Object.keys(previous.node.attrs)) {
      if (!(prop in entry.node.attrs)) out.push({ op: 'remove', address, prop })
    }
    if (entry.parent !== null && (previous.parent !== entry.parent || previous.index !== entry.index)) {
      out.push({ op: 'move-node', address, newParent: entry.parent, index: entry.index })
    }
  }
  return out
}
```

`isWithin(ancestor, address)` (`parse.ts:1535`) is true when `address` is inside `ancestor`. Export: `export { diffToPatches } from './diff-patches.js'`.

- [ ] **Step 4: Run the format suite**

Expected: pass. If `move-node` ordering makes the sequential apply land a node at the wrong index (moves interact), sort move-node patches by target parent then index ascending before emitting and re-run; the `reaches` helper is the arbiter.

- [ ] **Step 5: Commit**

```bash
git add packages/format/src/diff-patches.ts packages/format/src/index.ts packages/format/test/diff-patches.test.ts
git commit -m "format: diffToPatches — the patches from one document's tree to another's"
```

---

### Task 13: The undo stack

**Files:**
- Create: `packages/viewer/src/undo-stack.ts`
- Test: `packages/viewer/test/undo-stack.test.ts`

**Interfaces:**
- Produces:

```ts
export type Origin = 'author' | { turn: string } | 'external'
export interface StackEntry {
  label: string
  origin: Origin
  files: Map<string, { forward: UidxPatch[]; inverse: UidxPatch[] }>
  /** Source hashes of the revisions this entry covers, for turn attribution. */
  hashes: string[]
}
export interface UndoStack {
  pushAuthor(file: string, forward: UidxPatch[], inverse: UidxPatch[], label: string): void
  pushExternal(file: string, forward: UidxPatch[], inverse: UidxPatch[], sourceHash: string): void
  /** Merges consecutive external entries whose hashes are all in `written` into one turn entry. */
  attributeTurn(turn: string, written: readonly string[]): void
  undo(): StackEntry | null
  redo(): StackEntry | null
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly entries: readonly StackEntry[]
  readonly version: number
}
export function createUndoStack(): UndoStack
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import type { UidxPatch } from '@uidx/format'
import { createUndoStack } from '../src/undo-stack'

const set = (value: boolean): UidxPatch => ({ op: 'set', address: 'a', prop: 'visible', value })

describe('createUndoStack', () => {
  it('undo returns the top entry and moves it to redo; redo brings it back', () => {
    const stack = createUndoStack()
    stack.pushAuthor('p.uidx', [set(false)], [set(true)], 'Hide a')
    expect(stack.canUndo).toBe(true)
    const entry = stack.undo()!
    expect(entry.files.get('p.uidx')!.inverse).toEqual([set(true)])
    expect(stack.canUndo).toBe(false)
    expect(stack.canRedo).toBe(true)
    expect(stack.redo()!.files.get('p.uidx')!.forward).toEqual([set(false)])
    expect(stack.canRedo).toBe(false)
  })

  it('a new entry clears redo', () => {
    const stack = createUndoStack()
    stack.pushAuthor('p.uidx', [set(false)], [set(true)], 'one')
    stack.undo()
    stack.pushExternal('p.uidx', [set(false)], [set(true)], 'h1')
    expect(stack.canRedo).toBe(false)
  })

  it('external entries are labelled and carry their hash', () => {
    const stack = createUndoStack()
    stack.pushExternal('p.uidx', [set(false)], [set(true)], 'h1')
    expect(stack.entries[0]).toMatchObject({ origin: 'external', hashes: ['h1'] })
  })

  it('attributeTurn merges the consecutive external entries a turn wrote, newest first', () => {
    const stack = createUndoStack()
    stack.pushAuthor('p.uidx', [set(false)], [set(true)], 'mine')
    stack.pushExternal('p.uidx', [set(true)], [set(false)], 'h1')
    stack.pushExternal('q.uidx', [set(false)], [set(true)], 'h2')
    stack.pushExternal('p.uidx', [set(false)], [set(true)], 'h9') // not the turn's
    stack.attributeTurn('t1', ['h1', 'h2'])
    expect(stack.entries.map((e) => e.origin)).toEqual(['author', { turn: 't1' }, 'external'])
    const turn = stack.entries[1]!
    expect([...turn.files.keys()].sort()).toEqual(['p.uidx', 'q.uidx'])
    // forward in arrival order, inverse newest first
    expect(turn.files.get('p.uidx')!.forward).toEqual([set(true)])
  })

  it('a turn entry undoes both files', () => {
    const stack = createUndoStack()
    stack.pushExternal('p.uidx', [set(true)], [set(false)], 'h1')
    stack.pushExternal('p.uidx', [set(false)], [set(true)], 'h2')
    stack.attributeTurn('t1', ['h1', 'h2'])
    const entry = stack.undo()!
    // Two revisions on one file: forward appended, inverse prepended.
    expect(entry.files.get('p.uidx')!.forward).toEqual([set(true), set(false)])
    expect(entry.files.get('p.uidx')!.inverse).toEqual([set(true), set(false)])
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/viewer/src/undo-stack.ts`:

```ts
import { shallowRef } from 'vue'
import type { UidxPatch } from '@uidx/format'

export type Origin = 'author' | { turn: string } | 'external'

export interface StackEntry {
  label: string
  origin: Origin
  files: Map<string, { forward: UidxPatch[]; inverse: UidxPatch[] }>
  hashes: string[]
}

export interface UndoStack {
  pushAuthor(file: string, forward: UidxPatch[], inverse: UidxPatch[], label: string): void
  pushExternal(file: string, forward: UidxPatch[], inverse: UidxPatch[], sourceHash: string): void
  attributeTurn(turn: string, written: readonly string[]): void
  undo(): StackEntry | null
  redo(): StackEntry | null
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly entries: readonly StackEntry[]
  readonly version: number
}

const MAX_ENTRIES = 200

/**
 * One linear history for every writer (spec §5). Undo hands back the entry;
 * dispatching its inverse is the shell's job, because that is a write like any
 * other — predicted, sent, confirmed — never a private rewind.
 */
export function createUndoStack(): UndoStack {
  const past: StackEntry[] = []
  const future: StackEntry[] = []
  const version = shallowRef(0)
  const bump = (): void => void (version.value += 1)

  const push = (entry: StackEntry): void => {
    past.push(entry)
    if (past.length > MAX_ENTRIES) past.shift()
    future.length = 0 // one shared stack has one linear history
    bump()
  }

  return {
    pushAuthor(file, forward, inverse, label) {
      push({ label, origin: 'author', files: new Map([[file, { forward, inverse }]]), hashes: [] })
    },
    pushExternal(file, forward, inverse, sourceHash) {
      const label = forward.length ? `Change to ${file}` : `Change to ${file} (prose only — nothing to undo)`
      push({ label, origin: 'external', files: new Map([[file, { forward, inverse }]]), hashes: [sourceHash] })
    },
    attributeTurn(turn, written) {
      const owned = new Set(written)
      // The turn's revisions are a contiguous run of external entries; an
      // author edit made after the turn sits above the run and stays put.
      const run: StackEntry[] = []
      for (let i = past.length - 1; i >= 0; i--) {
        const entry = past[i]!
        if (entry.origin === 'external' && entry.hashes.every((h) => owned.has(h))) run.unshift(entry)
        else if (run.length) break
      }
      if (run.length === 0) return
      const first = past.indexOf(run[0]!)
      const merged: StackEntry = {
        label: `LLM turn`,
        origin: { turn },
        files: new Map(),
        hashes: run.flatMap((e) => e.hashes),
      }
      for (const entry of run) {
        for (const [file, { forward, inverse }] of entry.files) {
          const slot = merged.files.get(file) ?? { forward: [], inverse: [] }
          slot.forward.push(...forward)
          slot.inverse.unshift(...inverse)
          merged.files.set(file, slot)
        }
      }
      past.splice(first, run.length, merged)
      bump()
    },
    undo() {
      const entry = past.pop() ?? null
      if (entry) {
        future.push(entry)
        bump()
      }
      return entry
    },
    redo() {
      const entry = future.pop() ?? null
      if (entry) {
        past.push(entry)
        bump()
      }
      return entry
    },
    get canUndo() {
      void version.value
      return past.length > 0
    },
    get canRedo() {
      void version.value
      return future.length > 0
    },
    get entries() {
      void version.value
      return past
    },
    get version() {
      return version.value
    },
  }
}
```

- [ ] **Step 4: Run the viewer test**

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/viewer/src/undo-stack.ts packages/viewer/test/undo-stack.test.ts
git commit -m "viewer: the undo stack — one linear history for author, external and turn entries"
```

---

### Task 14: Wire undo into the shell

**Files:**
- Modify: `packages/viewer/src/App.vue` — `commitPatches` and `commitAcrossPages` (`:837-895`), `file:changed` (`:377-390`), `onKeyDown` (`:1170-1198`)

**Interfaces:**
- Consumes: `inversePatches`, `diffToPatches` (format); `createUndoStack` (Task 13); `inFlight` (Task 10).

- [ ] **Step 1: Bookkeeping for author batches**

In `App.vue`:

```ts
import { diffToPatches, inversePatches } from '@uidx/format'
import { createUndoStack } from './undo-stack'

const history = createUndoStack()
/** Patch ids dispatched *by* undo/redo: their confirmations must not push entries. */
const historyPatchIds = new Set<string>()

function labelFor(patches: readonly UidxPatch[]): string {
  const first = patches[0]
  if (!first) return 'Edit'
  if (first.op === 'set' || first.op === 'add' || first.op === 'remove') return `${first.prop} on ${first.address}`
  return first.op
}

/** Sends one page's patches and records them, unless they are history replaying itself. */
function dispatch(file: string, patches: readonly UidxPatch[], record: boolean): string | null {
  const at = revisions.value.get(file)
  const base = pages.value.get(file)
  if (at === undefined || !base) return null
  // The inverse is taken against what the author is looking at — `shown` for
  // the open page — so two quick edits to one property each record the value
  // that was on screen (spec §5).
  const baseline = file === entry.value ? shown.value ?? base : base
  let inverse: UidxPatch[] | null = null
  if (record) {
    try {
      inverse = inversePatches(baseline, patches)
    } catch {
      inverse = null // a structural batch we cannot invert up front; see file:changed
    }
  }
  const patchId = channel.dispatch(file, at, patches, base)
  if (!patchId) return null
  if (file === entry.value) inFlight.push(patchId, patches)
  if (!record) historyPatchIds.add(patchId)
  else if (inverse) history.pushAuthor(file, [...patches], inverse, labelFor(patches))
  else pendingInverse.set(patchId, { file, forward: [...patches], before: base })
  return patchId
}

/** Author batches whose inverse waits for the confirmed document. */
const pendingInverse = new Map<string, { file: string; forward: UidxPatch[]; before: UidxDocument }>()
```

Rewrite `commitPatches` to call `dispatch(page, patches, true)` after the rename-plan check, and `commitAcrossPages` to call `dispatch(file, patches, true)` per file (replacing the two direct `channel.dispatch` calls and the `inFlight.push` added in Task 10).

- [ ] **Step 2: Bookkeeping on `file:changed`**

Replace the case body's start:

```ts
      case 'file:changed': {
        const previous = pages.value.get(message.file)
        const ownPatch = message.patchId !== undefined && (inFlight.has(message.patchId) || historyPatchIds.has(message.patchId) || pendingInverse.has(message.patchId))
        if (message.patchId) {
          inFlight.settle(message.patchId)
          historyPatchIds.delete(message.patchId)
          const pending = pendingInverse.get(message.patchId)
          if (pending) {
            pendingInverse.delete(message.patchId)
            history.pushAuthor(pending.file, pending.forward, diffToPatches(message.doc, pending.before), labelFor(pending.forward))
          }
        }
        const priorRevision = revisions.value.get(message.file)
        // Someone else's revision (spec §5). A re-broadcast at an unchanged
        // revision is a dependent page re-sent after a token edit, not a change.
        if (!ownPatch && previous && priorRevision !== undefined && message.revision !== priorRevision) {
          history.pushExternal(
            message.file,
            diffToPatches(previous, message.doc),
            diffToPatches(message.doc, previous),
            message.doc.sourceHash,
          )
        }
        pages.value.set(message.file, message.doc)
        ...rest unchanged
```

- [ ] **Step 3: Undo and redo**

```ts
function applyHistory(entry: StackEntry, direction: 'undo' | 'redo'): void {
  const open = entry.value
  const files = [...entry.files.keys()].sort((a, b) => Number(a === open) - Number(b === open))
  for (const file of files) {
    const patches = direction === 'undo' ? entry.files.get(file)!.inverse : entry.files.get(file)!.forward
    if (patches.length) dispatch(file, patches, false)
  }
}

function undo(): void {
  const top = history.undo()
  if (top) applyHistory(top, 'undo')
}
function redo(): void {
  const next = history.redo()
  if (next) applyHistory(next, 'redo')
}
```

Import `type StackEntry` from `./undo-stack`. Note the local `entry` ref (open page) shadows the parameter name — call the parameter `item` instead of `entry` in `applyHistory` to avoid the clash.

In `onKeyDown`, before the `toolFor` check:

```ts
  if ((event.metaKey || event.ctrlKey) && !event.altKey && event.code === 'KeyZ') {
    if (isTypingTarget(event)) return
    event.preventDefault()
    if (event.shiftKey) redo()
    else undo()
    return
  }
```

The canvas SDK's command registry binds `$mod+KeyZ` in `@open-pencil/vue`, but the viewer imports only `provideEditor`, `useCanvas` and field components from it (`grep -rn "from '@open-pencil/vue'" packages/viewer/src`), never the command registry, so no second handler fires. Confirm with `grep -rn "KeyZ" packages/viewer/src` — only this handler.

- [ ] **Step 4: Run the viewer suite and typecheck**

Expected: pass.

- [ ] **Step 5: Live check**

Server from Task 8 running. On atlas: toggle an eye; press ⌘Z; the eye flips back in the same frame and `git diff design-systems/meridian/atlas.uidx` shows the attribute restored after the round trip. Press ⇧⌘Z; it hides again. Then edit atlas from outside:

```bash
sed -i '' 's/name="cover"/name="cover" opacity={0.5}/' design-systems/meridian/atlas.uidx
```

The canvas shows the change; ⌘Z removes `opacity={0.5}` from the file. Finally restore the file to the user's three-line diff (`git diff -U0 design-systems/meridian/atlas.uidx | grep "^@@"` shows hunks at 401, 7750, 7881 only).

- [ ] **Step 6: Commit**

```bash
git add packages/viewer/src/App.vue
git commit -m "viewer: undo and redo dispatch inverse patches; external revisions join the stack"
```

---

### Task 15: LLM turns coalesce by the hashes they wrote

**Files:**
- Modify: `packages/agent/src/edit/apply.ts` (`ApplyContext.onWrite`), `packages/agent/src/server/turn.ts:437,458,513` (collect and expose `written`)
- Modify: `packages/viewer/src/ChatPanel.vue` (emit `turn-finished`), `packages/viewer/src/App.vue:1354` (listen)
- Test: `packages/agent/test/` (the applyOps test file from Task 3), `packages/viewer/test/chat-panel.test.ts`

- [ ] **Step 1: Harness test**

In the applyOps test file:

```ts
it('reports the source hash of every file it writes', async () => {
  const written: { file: string; sourceHash: string }[] = []
  const outcome = await applyOps({ ...ctx, onWrite: (file, sourceHash) => written.push({ file, sourceHash }) }, 'page.uidx', [
    { kind: 'set_prop', address: 'c#root', prop: 'cornerRadius', value: 8 },
  ])
  expect(outcome.ok).toBe(true)
  expect(written).toHaveLength(1)
  expect(written[0]!.file).toBe('page.uidx')
  expect(written[0]!.sourceHash).toBe(ctx.workspace.docOf('page.uidx')!.sourceHash)
})
```

- [ ] **Step 2: Implement in the harness**

`apply.ts`:

```ts
export interface ApplyContext {
  workspace: Workspace
  checkpoints: CheckpointStore
  globs: readonly string[]
  turnId: string
  /** Called after each successful write with the written document's hash (spec §5 turn attribution). */
  onWrite?(file: string, sourceHash: string): void
}
```

and after `await ctx.workspace.writeFile(file, source)`:

```ts
    ctx.onWrite?.(file, doc.sourceHash)
```

`turn.ts`: where the per-turn deps object with `turnId` is built (lines ~437 and ~458), add a `written: { file: string; sourceHash: string }[] = []` declared beside `turnId` (line ~335) and pass `onWrite: (file, sourceHash) => written.push({ file, sourceHash })`. In `messageMetadata` add `written` to the returned object. The metadata callback runs per stream part, so by the `finish` part it holds every write.

- [ ] **Step 3: Viewer test**

In `packages/viewer/test/chat-panel.test.ts`, `stubChat` builds the `useChat` helpers from `ref`s but returns only the spies. Change its return to also expose the refs — `return { clearError, sendMessage, stop, messages: helpers.messages, status: helpers.status }` (cast `helpers` back through `as unknown as { messages: Ref<UIMessage[]>; status: Ref<string> }`) — then add:

```ts
it('emits turn-finished with the hashes the turn wrote when a reply completes', async () => {
  const reply = {
    id: 'm1',
    role: 'assistant',
    parts: [{ type: 'text', text: 'Done.' }],
    metadata: { turnId: 't1', written: [{ file: 'p.uidx', sourceHash: 'h1' }] },
  } as unknown as UIMessage
  const { status } = stubChat({ messages: [reply], status: 'streaming' })
  const wrapper = render()
  status.value = 'ready'
  await nextTick()
  expect(wrapper.emitted('turn-finished')).toEqual([[{ turnId: 't1', written: ['h1'] }]])
})
```

(`nextTick` from vue.)

- [ ] **Step 4: Implement in the viewer**

`ChatPanel.vue`:

```ts
const emit = defineEmits<{ close: []; 'turn-finished': [{ turnId: string; written: string[] }] }>()

watch(status, (now, before) => {
  if (before !== 'streaming' && before !== 'submitted') return
  if (now !== 'ready') return
  const last = [...messages.value].reverse().find((m) => m.role === 'assistant')
  const metadata = last?.metadata as { turnId?: unknown; written?: unknown } | undefined
  if (typeof metadata?.turnId !== 'string') return
  const written = Array.isArray(metadata.written)
    ? metadata.written
        .map((w) => (w as { sourceHash?: unknown }).sourceHash)
        .filter((h): h is string => typeof h === 'string')
    : []
  emit('turn-finished', { turnId: metadata.turnId, written })
})
```

`App.vue`:

```vue
    <ChatPanel
      ...
      @turn-finished="({ turnId, written }) => history.attributeTurn(turnId, written)"
    />
```

- [ ] **Step 5: Run agent and viewer suites; typecheck all**

Run: `export PATH=/Users/guybehar/.nvm/versions/node/v22.15.0/bin:$PATH && pnpm test && pnpm typecheck`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/edit/apply.ts packages/agent/src/server/turn.ts packages/viewer/src/ChatPanel.vue packages/viewer/src/App.vue packages/agent/test packages/viewer/test/chat-panel.test.ts
git commit -m "agent+viewer: a turn reports the hashes it wrote; the stack folds those revisions into one entry"
```

---

### Task 16: End-to-end verification and record

**Files:**
- Modify: `docs/backlog.md` — a dated note with the measured numbers.

- [ ] **Step 1: Full build, tests, lint**

```bash
export PATH=/Users/guybehar/.nvm/versions/node/v22.15.0/bin:$PATH && pnpm build:cli && pnpm test && pnpm typecheck && pnpm lint
```

Expected: all green.

- [ ] **Step 2: Restart the viewer server and measure the whole loop on atlas**

Using the Task 8 probe: (a) eye toggle — rail and canvas change within one frame, one `node:patch`, `file:changed` back in about 1.3 s, status "1 change(s)", no second send within 20 s; (b) ⌘Z — same shape; (c) a 400-op attribute batch sent from the console against the current revision (`{"type":"node:patch",...}` with 400 `set` ops on distinct `doc#…` addresses, values equal to current ones so the file is unchanged) answers `patch:applied` in under 3 s; (d) heap: `ps -o rss= -p <server pid>` before and after 20 toggles differs by less than 200 MB.

- [ ] **Step 3: Confirm nothing was lost**

`git status` shows only `design-systems/meridian/atlas.uidx` with the user's three original lines. Every viewer flow still works: drag a node on the canvas (patch lands, no reflow burst — `sends` shows one `node:patch`), rename a layer in the rail, edit a number in the inspector, switch pages, open the tokens view and edit a token (atlas re-resolves without "rebuilt").

- [ ] **Step 4: Record and commit**

Append to `docs/backlog.md` under a heading `### 2026-09-05 — instant edits, measured`, the before/after table (7 s → click-to-paint under one frame, confirm about 1.3 s) and the three bugs closed (double parse, alias overwrite leak, identity-compared definitions). Commit:

```bash
git add docs/backlog.md
git commit -m "backlog: instant-edit loop measured after the spec landed"
```
