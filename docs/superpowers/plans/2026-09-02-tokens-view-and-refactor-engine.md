# Tokens View and Refactor Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-page tokens view (table with modes, alias chains and calculated
values, inline editing, creation) plus a symbol-general refactor engine giving
rename/delete/deprecate their blast radius — for tokens now and component
rename in the same stroke.

**Architecture:** Pure model layers first (`@uidx/schema`: dependents index and
refactor engine producing `Map<file, UidxPatch[]>`), then the viewer view
(`TokensPane` + `TokenDetailPane` fed by a pure `tokens-view-model`), dispatched
through the existing patch channel via `commitAcrossPages`. One format
prerequisite: `<Mode>` children get real addresses so patches can target them.

**Tech Stack:** TypeScript, Vue 3 (viewer), vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-02-tokens-view-and-refactor-engine-design.md`

## Global Constraints

- Run all tests with node 22: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"` first.
- Commit straight to `main` after each green task (project convention).
- TDD: every task writes its failing test first and watches it fail.
- Alias syntax is `{collection#variable}` (`isAlias`/`aliasTarget`/`toAlias` in `@uidx/format`).
- Patch ops available: `set` / `add` / `remove` (props), `insert-node` / `remove-node` / `move-node` / `retag`. Addressing is by node address only.
- The document = every file `uidx.json` names; all cross-file work operates on the whole set.
- Discovered during planning (spec deviations, both narrowing): (a) the parser
  tolerates unknown attributes and the emitter has no per-element attr order,
  so `deprecated` needs **no** format/parse change — only readers change;
  (b) `<Mode>` addressing (spec §5 seam) is resolved by giving modes real
  addresses (Task 1), not by special patch ops.

---

### Task 1: the `set-mode` patch op

> **Revised during execution.** The plan first gave `<Mode>` children real
> addresses; the parser refuses on purpose — a variable may itself be named
> with a slash (`surface/light`), so `semantic#surface/light` the mode-address
> silently collides with a variable owning that string (comment at
> `parse.ts:352`). The spec's §5 seam resolves the other way: an insert-or-set
> patch addressed to the parent variable.

**Files:**
- Modify: `packages/format/src/types.ts` (UidxPatch union), `packages/format/src/patch.ts`
- Test: `packages/format/test/mode-address.test.ts` (create)

**Interfaces:**
- Produces: `{ op: 'set-mode'; address: string; mode: string; value: JsonValue }`
  — `address` names the `<Variable>`; sets the named `<Mode>` child's `value`
  when the child exists, inserts `<Mode name value />` (before any existing
  siblings' order is disturbed — append last) when it does not; refused when
  the address is not a `<Variable>`. Tasks 5 and 9 emit this op for every
  moded write.

- [ ] **Step 1: failing tests** — set-mode on an existing mode rewrites its
  value span; set-mode for a mode with no child inserts one; set-mode on a
  non-variable address throws the patcher's refusal.
- [ ] **Step 2: watch them fail** (`unknown op` / no change).
- [ ] **Step 3: implement** — extend the `UidxPatch` union; in `applyPatch`,
  resolve the variable node, find the Mode child by `name`, and reuse the
  existing `set`-on-child / `insert-node`-under-parent span machinery.
- [ ] **Step 4: new tests pass; full format suite green; server + viewer +
  schema + agent + cli suites green** (the op rides the wire inside existing
  envelopes — no protocol change).
- [ ] **Step 5: commit.**

---

### Task 2: `deprecated` on the token index

**Files:**
- Modify: `packages/schema/src/token-index.ts`
- Test: `packages/schema/test/token-index.test.ts` (extend)

**Interfaces:**
- Produces: `TokenEntry.deprecated: boolean` — read as
  `variable.attrs.deprecated?.value === true`. Consumed by the view model
  (badge, autocomplete filtering).

- [ ] **Step 1: Failing test** — a `<Variable name="old" type="FLOAT" value={4} deprecated={true} />` yields `entry.deprecated === true`; one without yields `false`.
- [ ] **Step 2: Watch it fail.**
- [ ] **Step 3: Add `deprecated: boolean` to `TokenEntry`, set it in `buildTokenIndex`.**
- [ ] **Step 4: Schema suite green.**
- [ ] **Step 5: Commit.**

---

### Task 3: The dependents index

**Files:**
- Create: `packages/schema/src/symbol-deps.ts`
- Modify: `packages/schema/src/index.ts` (export)
- Test: `packages/schema/test/symbol-deps.test.ts`

**Interfaces:**
- Consumes: parsed documents.
- Produces (exact):

```ts
export interface Dependent {
  file: string
  /**
   * Address of the node carrying the reference — except kind 'mode', where a
   * `<Mode>` has no address of its own (parse.ts:352) and this is its
   * *variable's* address, with `mode` naming the child.
   */
  address: string
  /** The attribute holding it: 'value' on Variable/Mode, 'component' on Instance, any prop on scene nodes. */
  prop: string
  kind: 'variable' | 'mode' | 'scene' | 'instance' | 'instance-swap'
  /** Only for kind 'mode'. */
  mode?: string
}
export interface DependentsIndex {
  ofToken: ReadonlyMap<string, readonly Dependent[]>
  ofComponent: ReadonlyMap<string, readonly Dependent[]>
}
export function buildDependentsIndex(
  pages: ReadonlyMap<string, UidxDocument>,
): DependentsIndex
```

- [ ] **Step 1: Failing tests** — build a two-file map from source strings
  (helper: parse both, `new Map([[file, doc]])`):
  - a variable aliasing `{palette#blue-500}` appears under `ofToken.get('palette#blue-500')` with kind `'variable'`;
  - a `<Mode value="{palette#blue-500}">` appears with kind `'mode'`, its variable's address, and `mode` naming the child;
  - a scene attr `fills={[{ type: 'SOLID', color: '{palette#blue-500}' }]}` — walk **nested** JsonValues, not just top-level attr values — appears with kind `'scene'`;
  - `<Instance component="Card">` appears under `ofComponent.get('Card')` with kind `'instance'` and prop `'component'`;
  - an instance-swap prop value naming a known component (`props={{ icon: 'Icon/Check' }}` where `Icon/Check` is a `<Component>` in the document) appears with kind `'instance-swap'` and prop `'props'`;
  - a token nobody references maps to an empty/absent list.
- [ ] **Step 2: Watch them fail.**
- [ ] **Step 3: Implement** — first pass collects component names; second walks
  every node's attrs. For alias detection inside structured values, recurse
  through arrays/objects with a `visitStrings(value, fn)` helper; `isAlias` +
  `aliasTarget` classify. Kind from the node's element.
- [ ] **Step 4: Green; schema suite green.**
- [ ] **Step 5: Commit.**

---

### Task 4: `renameToken`

**Files:**
- Create: `packages/schema/src/refactor.ts`
- Modify: `packages/schema/src/index.ts` (export)
- Test: `packages/schema/test/refactor.test.ts`

**Interfaces:**
- Consumes: `buildDependentsIndex`, `toAlias`.
- Produces (exact):

```ts
export interface RefactorPlan {
  /** file → ordered patches. The declaring file's batch includes the rename itself. */
  byFile: ReadonlyMap<string, readonly UidxPatch[]>
  /** For blast-radius UI. */
  dependents: readonly Dependent[]
}
export function renameToken(
  pages: ReadonlyMap<string, UidxDocument>,
  deps: DependentsIndex,
  address: string,          // 'palette#blue-500'
  newName: string,          // 'azure-500'
): RefactorPlan
```

- [ ] **Step 1: Failing tests**
  - rename produces, in the declaring file: `{ op: 'set', address, prop: 'name', value: newName }`;
  - every dependent gets its carrying prop rewritten to `{collection#newName}`
    — a `set` for variable/scene kinds, a `set-mode` (Task 1) for kind 'mode';
    for a **nested** alias (inside `fills`), the whole JsonValue is cloned with
    only the matching alias strings replaced;
  - a token with zero dependents yields one single-patch batch;
  - `dependents` echoes the index's list.
- [ ] **Step 2: Fail.**
- [ ] **Step 3: Implement** — `rewriteAliases(value, from, to)` clones a
  JsonValue replacing exact alias targets; build per-file arrays with the
  declaring file's rename appended **after** its same-file reference rewrites
  (one atomic batch), other files' batches independent.
- [ ] **Step 4: Green.**
- [ ] **Step 5: Commit.**

---

### Task 5: `deleteToken` — inline values, then remove

**Files:**
- Modify: `packages/schema/src/refactor.ts`, `packages/schema/src/index.ts`
- Test: `packages/schema/test/refactor.test.ts` (extend)

**Interfaces:**
- Consumes: `TokenIndex`, `TokenResolver`, `defaultTuple`, `tupleAt`, `DependentsIndex`.
- Produces (exact):

```ts
export interface DeletePlan extends RefactorPlan {
  /** Scene dependents whose mode variance is flattened by inlining. */
  flattened: readonly Dependent[]
}
export function deleteToken(
  pages: ReadonlyMap<string, UidxDocument>,
  index: TokenIndex,
  deps: DependentsIndex,
  address: string,
): DeletePlan
```

- [ ] **Step 1: Failing tests**
  - a dependent variable in a single-mode collection gets `set value` to the
    **resolved literal** (resolver at default tuple), then the deleted
    variable gets `remove-node` — inlines strictly before the removal in the
    declaring file's batch;
  - a dependent variable whose own collection has modes, aliasing a moded
    token: gets one `set-mode` op (Task 1) per mode when resolved values
    differ per mode, a single `set value` when they do not;
  - a scene dependent gets its carrying prop rewritten with the literal it
    resolves to at `tupleAt(root, dependent.address, index)`; if the deleted
    token's per-mode values differ, the dependent appears in `flattened`;
  - deleting a token nobody references is just `remove-node`.
- [ ] **Step 2: Fail.**
- [ ] **Step 3: Implement** — resolve per tuple with `TokenResolver`; reuse
  `rewriteAliases` with a literal instead of a new alias (generalise it to
  `rewriteAliases(value, from, replacement: JsonValue | ((mode?: string) => JsonValue))`
  or add `inlineAliases`; keep both exported for the viewer's re-check).
- [ ] **Step 4: Green.**
- [ ] **Step 5: Commit.**

---

### Task 6: `renameComponent`

**Files:**
- Modify: `packages/schema/src/refactor.ts`, `packages/schema/src/index.ts`
- Test: `packages/schema/test/refactor.test.ts` (extend)

**Interfaces:**
- Produces (exact):

```ts
export function renameComponent(
  pages: ReadonlyMap<string, UidxDocument>,
  deps: DependentsIndex,
  name: string,             // 'Control/Checkbox' — exact component name
  newName: string,
): RefactorPlan
```

- [ ] **Step 1: Failing tests** — the `<Component>`'s `set name`; every
  `<Instance component="old">` gets `set component newName` (exact match only
  — `Card` must not rewrite `CardHeader`); an instance-swap prop value equal
  to the old name is rewritten inside its `props` object; cross-file covered.
- [ ] **Step 2–5: Fail → implement → green → commit.**

---

### Task 7: The tokens view kind in the URL

**Files:**
- Modify: `packages/viewer/src/page-url.ts`
- Test: `packages/viewer/test/page-url.test.ts` (extend)

**Interfaces:**
- Produces: `View` union gains `{ kind: 'tokens'; file: string }`;
  `urlWithView` writes `?page=<file>&view=tokens`; `viewToOpen` reads it back
  (unknown `view` values fall back to the page view). Consumed by App wiring
  (Task 12).

- [ ] **Steps: failing test on round-trip (`urlWithView` → `viewToOpen`), fail, implement, viewer suite green, commit.**

---

### Task 8: The pure view model

**Files:**
- Create: `packages/viewer/src/tokens-view-model.ts`
- Test: `packages/viewer/test/tokens-view-model.test.ts`

**Interfaces:**
- Consumes: `TokenIndex`, `TokenResolver`, `DependentsIndex`, `UidxDocument`.
- Produces (exact):

```ts
export type TokenCategory =
  | 'color' | 'radius' | 'spacing' | 'size' | 'typography'
  | 'opacity' | 'number' | 'text' | 'toggle'

export interface TokenCell {
  mode: string
  /** The authored value: literal or alias string. */
  authored: JsonValue
  /** Alias chain from authored to literal, empty for a literal. */
  chain: readonly string[]
  /** The calculated end value, or null when the chain breaks. */
  resolved: JsonValue | null
  /** Why resolved is null, in words. */
  broken?: string
}

export interface TokenRow {
  address: string
  name: string
  type: VariableType
  category: TokenCategory
  scopes: readonly VariableScope[]
  description: string
  deprecated: boolean
  cells: readonly TokenCell[]
  /** File that declares it — where edits go. */
  file: string
  dependents: number
}

export interface CollectionGroup {
  name: string
  modes: readonly string[]
  file: string
  rows: readonly TokenRow[]
}

export function tokensViewModel(input: {
  view: { kind: 'tokens'; file: string }
  pages: ReadonlyMap<string, UidxDocument>
  index: TokenIndex
  resolver: TokenResolver
  deps: DependentsIndex
}): CollectionGroup[]

export function categoryOf(type: VariableType, scopes: readonly VariableScope[]): TokenCategory
```

- [ ] **Step 1: Failing tests**
  - `categoryOf`: COLOR → color; FLOAT+CORNER_RADIUS → radius; FLOAT+GAP →
    spacing (SPACING too); FLOAT+WIDTH_HEIGHT → size; FLOAT+FONT_SIZE (or any
    FONT_*/LINE_HEIGHT/LETTER_SPACING/PARAGRAPH_*) → typography; FLOAT+OPACITY
    → opacity; FLOAT otherwise → number; STRING+FONT_FAMILY → typography;
    STRING otherwise → text; BOOLEAN → toggle;
  - a **tokens page** view lists exactly its collections, rows in authored
    order, one cell per collection mode;
  - a **scene page** view lists only collections with at least one token the
    page binds (via deps), rows filtered to bound tokens, groups carrying the
    declaring file;
  - an alias cell carries `chain: ['semantic#brand', 'palette#blue-500']` and
    the resolved literal; a broken alias carries `resolved: null` and a
    `broken` message naming the missing target;
  - `deprecated` and `dependents` populated.
- [ ] **Step 2–5: Fail → implement → green → commit.** Chain-walking mirrors
  `TokenResolver.#build`'s loop but records the path; keep it here (the
  resolver's cache stays value-only).

---

### Task 9: Pure edit builders

**Files:**
- Create: `packages/viewer/src/token-edits.ts`
- Test: `packages/viewer/test/token-edits.test.ts`

**Interfaces:**
- Consumes: `TokenIndex`, `fitsVariableType`, `toAlias`, `variableTypeOf`.
- Produces (exact):

```ts
/** A cell edit. Returns null with `reason` when refused (type mismatch, unknown alias target). */
export function editCellPatch(input: {
  index: TokenIndex
  row: { address: string; type: VariableType; file: string }
  mode: string
  /** Single-mode collections pass IMPLICIT_MODE. */
  collectionModes: readonly string[]
  /** What the editor holds: literal or '{...}' alias text. */
  value: JsonValue
}): { file: string; patches: UidxPatch[] } | { refused: string }

export function addTokenPatch(input: {
  collection: string
  file: string
  name: string
  type: VariableType
  value: JsonValue
  /** Insert position: end of the collection's children. */
  at: number
}): { file: string; patches: UidxPatch[] }

export function addCollectionPatch(input: {
  file: string
  name: string
  at: number
}): { file: string; patches: UidxPatch[] }

/** Autocomplete: compatible, non-deprecated, non-self, non-cyclic targets. */
export function aliasTargets(
  index: TokenIndex,
  forType: VariableType,
  selfAddress: string,
): TokenEntry[]
```

- [ ] **Step 1: Failing tests**
  - single-mode edit → one `set value` on the variable address;
  - moded edit → one `set-mode` op `{ op: 'set-mode', address: row.address,
    mode, value }` (the op upserts, so the pane never needs to know whether
    the `<Mode>` child exists);
  - alias text whose target's type mismatches → `{ refused }` naming both types;
  - alias to an unknown address → refused;
  - `addTokenPatch` → `insert-node` of a `<Variable>` spec;
  - `aliasTargets` excludes self, deprecated entries, mismatched types, and
    anything whose chain already passes through self (no cycles).
- [ ] **Step 2–5: Fail → implement → green → commit.**

---

### Task 10: `TokensPane.vue` — the table, read-only, selectable

**Files:**
- Create: `packages/viewer/src/TokensPane.vue`
- Test: `packages/viewer/test/tokens-pane.test.ts`

**Interfaces:**
- Props: `{ groups: CollectionGroup[]; selection: string[] }`.
- Emits: `select(address: string)`, `edit(payload: { row: TokenRow; mode: string; value: JsonValue })` (wired in Task 11), `add-token(collection: string)`, `add-collection()` (wired in Task 11).
- Renders: collection sections → category subheads → rows; value cells by
  type (COLOR: swatch `div` with inline background + hex text; FLOAT/STRING/
  BOOLEAN: text); alias cells render `→ target` plus the resolved swatch/
  literal; broken cells render the `broken` message with a `finding` class;
  deprecated rows get a `deprecated` class and badge. Clicking a row emits
  `select`.

- [ ] **Step 1: Failing component tests** (follow the mount style of
  `packages/viewer/test/chat-panel.test.ts`): renders group and row; color
  swatch carries the hex; alias cell shows chain target and resolved value;
  broken alias shows the message; row click emits `select` with the address;
  selected row carries a `selected` class.
- [ ] **Step 2–5: Fail → implement → green → commit.**

---

### Task 11: Inline editing and creation in the pane

**Files:**
- Modify: `packages/viewer/src/TokensPane.vue`
- Test: `packages/viewer/test/tokens-pane.test.ts` (extend)

**Interfaces:**
- Consumes: `editCellPatch`, `aliasTargets` (Task 9) stay in App (Task 12);
  the pane stays dumb: double-click a cell opens the right editor (color
  swatch button opening the existing `ColorPickerDialog.vue`, text/number
  input, boolean toggle, or an alias input with a datalist fed by an
  `aliasOptions: TokenEntry[]` prop), then emits `edit` with the raw value.
  `+ New token` per collection emits `add-token`; `+ New collection` (only
  when the viewed page is the declaring file) emits `add-collection`.

- [ ] **Step 1: Failing tests** — double-click turns a FLOAT cell into an
  input; Enter emits `edit` with `{ row, mode, value: 12 }`; typing `{sem` in
  the alias input filters `aliasOptions`; `+ New token` emits with the
  collection name.
- [ ] **Step 2–5: Fail → implement → green → commit.**

---

### Task 12: App wiring — toggle, routing, dispatch

**Files:**
- Modify: `packages/viewer/src/App.vue`, `packages/viewer/src/HomePane.vue`
- Test: `packages/viewer/test/tokens-view-routing.test.ts` (create; pure parts), existing suites stay green

**Interfaces:**
- Consumes: everything above. Key wirings, all in App.vue:
  - computeds: `deps = buildDependentsIndex(pages)`, `tokenGroups = tokensViewModel(...)` when `view.kind === 'tokens'`;
  - the **Elements | Tokens** segmented control in the top bar (next to the
    existing page title), disabled-Elements when the open page is a
    `<Tokens>` root; the not-a-scene placeholder is REPLACED by auto-opening
    the tokens view for `<Tokens>` pages;
  - `onTokenEdit(payload)` → `editCellPatch` → refused → notice; else
    `channel.dispatch(file, revisions.get(file), patches, pages.get(file))`;
  - `onAddToken` / `onAddCollection` → builders → dispatch;
  - selection: token row select sets `selection.value = [address]` (the
    selection channel from the previous feature reports it for free);
  - HomePane's Tokens card navigates to the tokens view of the first
    `<Tokens>` page.
- [ ] **Step 1: Failing test for the pure routing bits** (view switch keeps
  file, tokens page auto-opens tokens view — extract `viewFor(page, doc):
  View` helper into `page-url.ts` if App-local logic resists testing).
- [ ] **Step 2–5: Fail → implement → full viewer suite green → commit.**

---

### Task 13: `TokenDetailPane.vue` — record, dependents, blast-radius actions

**Files:**
- Create: `packages/viewer/src/TokenDetailPane.vue`
- Modify: `packages/viewer/src/App.vue` (render it in the right column when `view.kind === 'tokens'` and a token is selected)
- Test: `packages/viewer/test/token-detail-pane.test.ts`

**Interfaces:**
- Props: `{ row: TokenRow; dependents: Dependent[] }`.
- Emits: `jump(dependent: Dependent)` (App: open that file/view and select),
  `rename(newName: string)`, `delete()`, `deprecate(value: boolean)`.
- Renders: the record (type, scopes, description, per-mode values with
  resolved literals, declaring file); the dependents list (file + address,
  one row each, click emits `jump`); action buttons labelled with the radius —
  `Rename (updates N references in M files)`, `Delete (inlines value into N
  dependents)` — and a confirm block listing dependents before either fires;
  the delete confirm flags each `flattened` dependent with a
  mode-variance-lost warning line; `Deprecate` is a toggle, no confirm.
- App side: `rename` → `renameToken(...)` → confirm accepted →
  `commitAcrossPages(plan.byFile)`; `delete` → `deleteToken(...)` likewise;
  `deprecate` → single `set deprecated` patch (or `remove` when false).
  After a rename/delete dispatch, re-run `buildDependentsIndex` on the next
  `file:changed` and surface any straggler as a notice ("2 references in
  sign-in.uidx could not be updated — they now show as broken aliases").

- [ ] **Step 1: Failing component tests** — labels carry counts; confirm
  lists dependents; flattened warning renders; emits fire with payloads.
- [ ] **Step 2–5: Fail → implement → viewer suite green → commit.**

---

### Task 14: Component rename rides the engine

**Files:**
- Modify: `packages/viewer/src/App.vue` (the existing layers-rename path), `packages/viewer/src/layer-moves.ts` if the rename entry point lives there
- Test: `packages/viewer/test/component-rename.test.ts` (create — pure part: given docs + deps, renaming a component with instances produces the multi-file plan; the confirm gating logic as a pure function `componentRenamePlan(pages, deps, name, newName): RefactorPlan | null`)

**Interfaces:**
- Consumes: `renameComponent` (Task 6), `commitAcrossPages`.
- Behavior: when the rename target is a `<Component>` and
  `deps.ofComponent.get(oldName)` is non-empty, the plain `renameFor` patch is
  replaced by the engine's plan behind a confirm ("Rename (updates N instances
  in M files)"). Zero-dependent components keep today's direct path.
- Also here (spec §12's component half): `PickComponentDialog.vue` filters out
  components whose node carries `deprecated={true}`
  (`node.attrs.deprecated?.value === true`) — with a test that a deprecated
  component is absent from the offered list while its existing instances keep
  rendering.

- [ ] **Step 1–5: Failing test → fail → implement → green → commit.**

---

### Task 15: Live verification and record

**Files:**
- Modify: `docs/superpowers/specs/2026-09-01-design-system-wow-roadmap.md` (one line: tokens view shipped), `.claude/launch.json` (a verify entry)

- [ ] **Step 1: Build (`pnpm build:cli && pnpm --filter @uidx/agent build`), launch `examples/` via preview_start.**
- [ ] **Step 2: Verify in the running viewer, per spec's testing section:**
  toggle Elements|Tokens on `dashboard.uidx` (bound tokens only);
  open `core-tokens.uidx` (auto-lands in tokens view, no placeholder);
  edit `radius#md` to 10 (file changes, canvas of a bound page follows);
  add a token; rename `palette#blue-500` → confirm dialog shows radius →
  aliases in `semantic` rewritten in the file; delete a token with a
  dependent → dependent holds the literal, file no longer has the variable;
  select a token row → `uidx selection .` answers its address.
- [ ] **Step 3: Full workspace test run + typecheck + lint.**
- [ ] **Step 4: Update the roadmap line, commit.**
