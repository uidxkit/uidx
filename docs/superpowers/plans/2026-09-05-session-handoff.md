# Session handoff — 2026-09-05

> **For whoever picks this up:** this is the state of the `uidx` repo at commit
> `498dea4` on `main`, written so a fresh session can continue without
> re-deriving it. It supersedes the
> [2026-08-22 handoff](2026-08-22-session-handoff.md), which stays as the
> record of the canvas-editing era; everything since is summarised here.
>
> **The one thing to know before anything else: the gate is red, and has been
> red on GitHub since 2026-08-30.** CI fails at its *Format* step, which runs
> before *Test*, so no push in the last week has had its tests run by CI. Run
> locally today, the gate is: typecheck ✅, build ✅, `uidx check examples` ✅,
> **format ✖ (151 files), lint ✖ (261 errors, all in
> `design-systems/*/build`), test ✖ (2 failures: one in `@uidx/format`, one
> in `@uidx/agent`)**. Details
> and the fix order are in [§2](#2-the-gate-what-is-red-and-why).

## 1. Read in this order

1. This document, all of it.
2. [backlog.md](../../backlog.md) — "Picking this up cold", the phase table
   under "Where things stand", and the three **Measured — 2026-09-05** sections
   near the end. The backlog is the roadmap and the record; it is 3,500 lines
   and you do not need the middle until a story sends you there.
3. [needs-review.md](../../needs-review.md) — **21 entries are ⬜ waiting on
   the user, one is 🔁**. Work does not wait on that queue, but a defect found
   in something already called done outranks whatever is next.
4. The two newest spec/plan pairs, because the code they describe landed today
   and is the least settled:
   [instant edits and inverse-patch undo](../specs/2026-09-05-instant-edits-and-inverse-patch-undo-design.md)
   and [viewer at scale](../specs/2026-09-05-viewer-at-scale-design.md).
5. Before touching the agent or a design system:
   [packages/agent/README.md](../../../packages/agent/README.md), the two repo
   skills under `.claude/skills/`, and the document-side skills under
   `.uidx-agent/skills/`.
6. Before touching any gesture or overlay maths:
   [the C10 status doc](2026-08-21-canvas-manipulation-c10.md). Its coordinate
   facts still hold and still cost hours when assumed rather than read.

## 2. The gate: what is red, and why

The CI workflow (`.github/workflows/ci.yml`) is format → lint → typecheck →
build:cli → test → check:examples, fail-fast. The last green run on `main` was
`b49cc49` on 2026-08-29. Every run since 2026-08-30 fails, and every one of
those except `47b15b7` (a Test failure) fails at **Format**.

Measured locally on 2026-09-05 with Node 22.15.0 and pnpm 9.12.2:

| Step | Result | What it is |
|---|---|---|
| `pnpm typecheck` | ✅ all six packages | |
| `pnpm build:cli` | ✅ `dist/uidx.js` 35.6 KB | |
| `pnpm check:examples` | ✅ 11 files OK | |
| `pnpm format:check` | ✖ 151 files | 123 of them are `design-systems/{meridian,vantage,simple}/build/**/*.mjs`; the other 28 are test and source files in `packages/` that were never run through Prettier |
| `pnpm lint` | ✖ 261 errors | All in `design-systems/*/build` (and two in gitignored `.build/` output that is present locally). Rules: `no-console` 102, `no-unused-vars` 82, `no-undef` 77 — the generators are Node scripts linted under a browser/TS config |
| `pnpm test` | ✖ 2 failed, 2,753 passed across six packages (`--no-bail`; the plain recursive run stops at `format`) | `format/test/incremental.test.ts › on the meridian atlas › an attribute op inside a variant…` and `agent/test/skills.test.ts › the skills this repo actually ships › loads both shipped skills` |

**The failing test.** It reads the real `design-systems/meridian/atlas.uidx`
and applies `set visible=false` to `Atlas#station=approach, land=mesh/atlas`.
`setProp` in `packages/format/src/patch.ts:303` now refuses: the node has no
`visible` attribute, and `set` does not create one. `atlas.uidx` has no
`visible=` anywhere, at HEAD or at `e44b3fd` where the test was written, so
either the test always relied on a `set`-creates-if-missing behaviour that a
later commit today made strict (candidates: `958e852`, which changed which
nodes take the conservative re-lowering, and `83b4248`), or it was red from the
start and CI's fail-fast hid it. Bisect between `e44b3fd` and `498dea4` with
`pnpm --filter @uidx/format test -- test/incremental.test.ts`; the fix is
either `op: 'add'` in the test or restoring add-or-set in the variant path,
and the second is a product decision the patch format's tests should settle.

**The second failing test** is a stale fixture: `skills.test.ts:62` expects
`.uidx-agent/skills/` to hold exactly `component-doc-page` and
`uidx-authoring`; a third skill, `uidx-eval-api`, was added in `47d155b` on 2026-09-01 and
the assertion was never widened — that commit is the one CI run since 08-30
that got past Format, and it failed at Test for exactly this reason. Add the
name to the expected list.

**Fix order.** Format first (it is what CI trips on): either run
`pnpm format` and commit, or add `design-systems/*/build/**` to
`.prettierignore` and `eslint.config.js` `ignores` if the generators are meant
to be authored freehand — the READMEs treat them as source, so formatting them
is the honest choice, and lint wants an `.mjs` Node override rather than an
ignore. Then the test. Then confirm the GitHub run is green before trusting the
"CI green on every push" claims still standing in README.md and backlog.md.

Per-package totals from `pnpm -r --no-bail test`, 2026-09-05:

| Package | Files | Tests |
|---|---|---|
| format | 19 / 20 | 297 passed, **1 failed** |
| schema | 29 | 377 |
| server | 15 | 142 |
| viewer | 74 | 1,282 |
| agent | 48 / 49 | 556 passed, **1 failed** |
| cli | 9 | 99 |
| **Total** | | **2,753 passed, 2 failed** |

## 3. What this repo is, in one screen

`.uidx` is *UI Design in MDX*: one plain-text file carrying human-readable
intent (Markdown) and a declarative JSX tree in Figma Plugin API vocabulary
(the Visual Contract). `uidx open` renders the contract on a CanvasKit canvas;
edits flow both ways by **span replacement over recorded byte offsets** — never
a reprint. A file is a **page**; a `uidx.json` manifest groups pages into a
**document** with one global namespace for component names and tokens
(ADRs 0003/0004). Addresses are `Entity#path/inside` and double as scene-graph
node ids.

Six workspace packages (pnpm, Node ≥ 20.19, `.nvmrc` says 22.15.0):

| Package | Lines | What it owns |
|---|---|---|
| `@uidx/format` | 4.7k | Parse, validate, patch, emit, `fmt`. New today: `applyPatchesIncremental`, `predictDocument`, `inversePatches`, `diffToPatches` |
| `@uidx/schema` | 5.5k | `.uidx` ⇄ open-pencil scene graph, both directions; `diffDocuments` / `applyChanges` for in-place scene updates |
| `@uidx/server` | 3.0k | Manifest, symbol table, a watched session per page with revision + echo ledger, WebSocket; now also `POST /__uidx/patch` and deltas on the wire |
| `@uidx/viewer` | 24.8k | Vue 3 shell: Home dashboard, Layers rail, Canvas, Inspector, Tokens view, chat panel; undo stack; prediction; renderer chunking |
| `@uidx/cli` | 1.6k | `uidx open/check/fmt/migrate` plus the **agent surface**: `audit apply create intent eval read search render architect selection` |
| `@uidx/agent` | 9.0k | Optional chat harness (Vercel AI SDK, Hono) that edits files only; ships the same tools as an **MCP server** (`uidx_*`, stdio or Streamable HTTP) |

The README's package table still lists five packages and says "1792 tests";
both are stale (see §8).

Two vendored patches under `patches/` modify `@open-pencil/core` (renderer
retained backing, chunk pictures, `.fig` io, selection labels) and
`@open-pencil/scene-graph` (`updateNode` drops unchanged keys). **`pnpm patch`
extracts the pristine package, not the patched one** — apply the existing
patch into the edit dir first or `patch-commit` silently drops every earlier
hunk.

## 4. What shipped since the 2026-08-22 handoff

In rough order. Each row has a spec and/or plan under `docs/superpowers/` and,
where it changed the grammar, an ADR.

| When | What | Where to read |
|---|---|---|
| 08-23 → 08-25 | Panel UI3 pass; **typed tokens, modes and scopes** (G8); Home dashboard (G9) | plans `2026-08-23-panel-ui3-and-variables`, `2026-08-25-typed-tokens-and-modes` |
| 08-26 → 08-28 | **Slots** (F5, ADR 0007, 0010); **a component is a frame** (ADR 0008); **`status` optional** (ADR 0009); `retag` (F14); changed artwork reaches the screen (G10) | ADRs 0007–0010, backlog F5/F14/F15/F16 |
| 08-29 → 08-30 | **Pins** — a child states its offset (H1, H2, H3; ADR 0011). H2 is 🔁 in needs-review | spec `2026-08-29-pins-and-constraints-design`, plans `pins-h1`, `pins-h2` |
| 08-29 → 08-31 | **Agent harness**, phases 1–3b: tool loop with a read-only step 0, budgeted `read` (source/outline/signature), skills, plans, delegation, per-turn checkpoints and revert, history compaction, `eval` (a JS sandbox over the document with gated writes) | spec `2026-08-29-uidx-agent-harness-design` and the phase-2/3 specs; `packages/agent/README.md` |
| 09-01 | Ten-run measurement day; **eval closed both recurring failure modes** (component phase, states grid): Haiku + eval 17/17, $1.43, zero retries. Hosted models are now fine; small-model affordances stay | spec `2026-09-01-design-system-wow-roadmap` |
| 09-02 | **Tokens view and refactor engine** (rename/delete/deprecate with blast radius; component rename rides it); **CLI agent surface + MCP server**; `uidx selection`; **Simple** design system (EDS register, 22 pages); the `uidx-design-system` and `design-system-review` skills | specs `2026-09-02-*`, `design-systems/simple/README.md` |
| 09-03 | **Vantage** (game-HUD C4I console, built by parallel agents); **Meridian** (globe with five stations, five colour modes, real coastlines) — 33 pages, the largest document in the repo | specs `2026-09-03-*`, `design-systems/{vantage,meridian}/README.md` and `backlog.md` |
| 09-04 | Pan and zoom on an 11.5k-node page: `requestRepaint` instead of `requestRender`, two stacked canvases, windowed layers rail. 220–420 ms per wheel tick → 0 ms blit | backlog "Known problems — cleared", last row |
| 09-05 | **Instant edits and inverse-patch undo**: predicted document on the click, one parse per patch on the server, mode-aware diff, ⌘Z/⇧⌘Z over author, external and LLM edits | spec+plan `2026-09-05-instant-edits-and-inverse-patch-undo` |
| 09-05 | **Viewer at scale**: incremental re-lower of one element, patches + hash on the wire, `POST /__uidx/patch` for writers, chunked renderer pictures that split recursively, no-op writes dropped in the scene graph, `startsOf` cache fixed (1.2 s → 23 ms) | spec+plan `2026-09-05-viewer-at-scale`; backlog's three Measured sections |

The headline numbers, all measured on `design-systems/meridian/atlas.uidx`
(63k lines, 7–11k nodes), toggling one eye in the states grid:

| Stage | Start of 09-05 | End of 09-05 |
|---|---|---|
| Click → painted | ~7 s | 66–92 ms (one task) |
| Server confirmation | 2.6 s | ~130 ms |
| `file:changed` on the wire | 15 MB document | 212-byte delta |
| Renderer work per toggle | whole page re-recorded | 1 of 676 cached pictures |

The renderer chunking was timed in Node and by counts; **it has not been timed
in a visible browser tab**, because hidden panes never initialise the canvas.
That is the one measurement still owed.

## 5. Where the work is queued

- **[needs-review.md](../../needs-review.md)** — 21 ⬜ entries from C10b through
  today's two stories, oldest first; H2 (pins in the inspector) is 🔁 with a
  finding. Only ADR 0006 has ever reached Reviewed. The entries say exactly
  what to click and what the diff should look like.
- **[backlog.md](../../backlog.md)** — Phases 0–3b complete, 4 partial, 5 in
  progress. Open stories worth knowing by name: **F3b** (authoring an
  override; wants a product call), **F9's axis half** (add/rename a variant
  *axis* — not buildable under the current one-node-per-op patch invariant;
  wants a decision), **F2** (export to Figma; S4/S5 measured what `.fig` keeps),
  **F4** (libraries), **F1** (snap-to-token lint), **A4/E2/E3** (polish). One
  open known problem: one image fetched twice per session (waste, not a
  defect).
- **Left by today's specs (§7 / §5 of each):** structural-op prediction (insert,
  remove, move still wait for the round trip); group ids from `uidx apply`;
  undo-stack persistence across reload; **pages on demand** (startup still
  parses all 33 Meridian pages, 3.4 s, and holds them — named as "the next
  architectural step"); a layout worker; the canvas diff still walks both
  trees instead of skipping shared subtrees by identity.
- **Wow roadmap** (`docs/superpowers/specs/2026-09-01-design-system-wow-roadmap.md`):
  items 3 and 4 done, 6 and 7 shipped; **item 5** (page-style research from
  published design-system docs, and the brand-seed → three-tier tokens idea)
  is the next unstarted item. Staged from the tokens-view spec: component
  delete-as-detach.
- **Per-system backlogs** at `design-systems/*/backlog.md`. Meridian's is the
  live one: M6 (no second type family — the renderer bundles Inter alone) is
  open and probably permanent; M5, M7, M8, M9 closed with rules.
- **From the previous handoff, still true:** an `INSTANCE_SWAP` property
  pointing at a component with variants is untested; C7's dimmed fallback
  probes a bare `INSTANCE` so an instance's W/H read as unset; and the user's
  2026-08-22 message about asset folder conventions was cut off mid-sentence
  and the second half was never re-asked.

## 6. Facts this repo measured — do not re-derive

**Environment**

- The login shell's default Node is 18; **prefix every command with
  `export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH`**. On 18 the viewer
  suite dies at boot with `ERR_REQUIRE_ESM` and looks like a broken suite.
- A fresh clone fails five `packages/cli` tests until `pnpm build:cli` runs;
  `binary.test.ts` executes the built artifact on purpose.
- `pnpm lint` and `pnpm format:check` from the root see everything not
  ignored. `.claude/**` is ignored (three stale worktrees live there);
  `design-systems/*/build` is not, which is the red gate.
- The `.env` at the root is gitignored and **contains a live
  `ANTHROPIC_API_KEY`** and `UIDX_AGENT_MODEL=anthropic:…` with a 200k context.
  `packages/agent/.env.example` is the tracked record of what belongs in one.

**Viewer and live verification**

- After any Vite transform error, the page keeps running the *last good*
  modules; check the console for `[vite] Failed to reload` before trusting a
  probe, and restart the server rather than reloading.
- Screenshot → client is scale-only: `client = shot × (viewportWidth /
  shotWidth)`. Do not add `getBoundingClientRect().left`.
- The world transform pivots on a node's *origin*; `getAbsoluteRotation` is
  sign-inverted; hit-test against `getWorldHandles`. (C10 status doc.)
- A live pass **writes to the file it opens** — always a scratch copy, never a
  repo example. The viewer needs a document (a `uidx.json`), not a bare file.
- `uidx open --root` is the *viewer's* project root, not the document root.
- Any write carrying an alias (`{collection#variable}`) must go out as an
  explicit patch, not through the canvas commit path — the scene resolves
  aliases and a resolved-equal write produces no patch at all.

**Renderer (the defects that pass every audit)**

- An unbundled `fontFamily` paints **no glyphs**, box reserved; so does
  `fontWeight: 300`. Only Inter ships. Carry a type voice with size, weight
  and tracking.
- Frame fill alpha is not honoured; text fill alpha is. Pre-blend surfaces.
- A single near-360° arc lands ~45 px off; use many short arcs.
- `EVENODD` only punches holes when every subpath closes with `Z`.
- Stretch fills the parent's cross axis only when the child's own size on that
  axis is AUTO; an `<Instance>` with STRETCH grows its box but its content lays
  out at the component's natural width. `maxWidth` did not cap a growing child.
- No dash support; dotted dividers draw solid.
- **Checks pass, render wrong is the recurring defect class.** Look at the PNG
  (`uidx render`), then assert what you saw. Nearly every real design-system
  defect lived here, none in an audit.

**Authoring through the agent surface**

- `uidx apply` gates each op against the document *as it stands*, not against
  earlier ops in the same batch: a component instanced by another must land in
  an earlier batch.
- An `<Instance>` cannot override its component's width; size must be an axis.
  A slot fill inside an instance carries no layout props (UIDX131). `status`
  cannot be an axis name (UIDX109).
- `uidx audit --page tokens.uidx` reports false faults; audit the whole root.
- Tool schemas stay flat: a top-level `oneOf` is uncallable by small models and
  varies across MCP clients.

**Process**

- A test that compares a thing to itself passes for free. When a test guards a
  fix, watch it go red without the fix first.
- Unit tests cannot see the canvas (spike S1); budget a live pass for anything
  touching rendering, the server or a gesture. Four of six real bugs in the
  canvas era came from live passes.
- Parallel agents on one uidx root: one foundation agent writes the shared
  files once and pre-marks one line per component; later agents edit only their
  own line. Subagents cannot see attached images — the spec's appearance lines
  are the reference.

## 7. Running things

All from the repo root, after the PATH export above.

```sh
pnpm install && pnpm build:cli        # postinstall copies canvaskit.wasm + Inter into packages/viewer/public
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm check:examples
```

Viewer on a document (writes to the file it opens):

```sh
node packages/cli/dist/uidx.js open design-systems/meridian/atlas.uidx --port 4620 --no-open
```

`.claude/launch.json` holds fifteen named launch configurations for the
desktop browser pane; several point at scratchpad paths from earlier sessions
that no longer exist. `uidx-example`, `uidx-simple-dashboard` and
`uidx-meridian-transit` are the live ones.

Agent surface without the harness (what the skills use):

```sh
node packages/cli/dist/uidx.js audit design-systems/simple
node packages/cli/dist/uidx.js render design-systems/simple dashboard.uidx -o /tmp/dash.png --scale 0.5
node packages/cli/dist/uidx.js apply design-systems/simple button.uidx --ops ops.json
node packages/cli/dist/uidx.js selection design-systems/simple --format json   # needs an open viewer
```

Design-system pages are generated: `node build/run.mjs <id>` inside a system's
root, from `build/components/*.mjs`; `tokens.uidx` is hand-authored and its
`## Design` section is the contract. The playbook is
`.claude/skills/uidx-design-system/SKILL.md`; the review loop is
`.claude/skills/design-system-review/SKILL.md`; the end-to-end driver that
produced the measurement day is `packages/agent/scripts/e2e-arch.mjs`.

Chat harness and MCP:

```sh
pnpm --filter @uidx/agent build
node packages/agent/dist/server/main.js          # Hono service on UIDX_AGENT_URL (default :4500), files only
node packages/agent/dist/mcp/main.js             # stdio MCP server exposing uidx_* tools
node packages/agent/dist/mcp/main.js --http 4610 # Streamable HTTP at /mcp, binds 127.0.0.1
```

Both bind loopback, have no authentication and rewrite files.

## 8. Loose ends and stale surfaces

- **README.md** says "1792 tests, CI green on every push" and lists five
  packages. CI has been red for a week, the count is old, and `@uidx/agent`
  and the CLI's agent surface are absent. Worth a rewrite once the gate is
  green.
- **backlog.md** says "Last updated 2026-09-04" and still points fresh readers
  at the 2026-08-22 handoff; the pointer is updated alongside this document.
- **Six local branches and three checked-out worktrees** under
  `.claude/worktrees/` are 343–522 commits behind `main` with nothing
  unmerged except `worktree-c6-properties-panel` (6 commits from 2026-08-17,
  superseded by C6/C7 on main). Seven `claude/*` remote branches likewise.
  Safe to prune, not pruned here.
- `examples/checkbox copy.uidx` is tracked, with a space in its name, and is
  part of the `check:examples` gate.
- `pnpm-workspace.yaml` lists a `spike` package directory that no longer
  exists; pnpm reports "6 of 7 workspace projects" because of it.
- `design/` holds four editor-redesign concepts from 2026-08 as `.uidx`
  documents; option 4's command-deck language is what the agent panel is meant
  to grow into. `inspirations/` holds the globe reference Meridian was drawn
  against.
- `.uidx-agent/` at the root: `skills/` and `memory/` are tracked (the
  document-side skills the harness and the CLI skills load); `checkpoints/` and
  `plans/` are gitignored per-turn state.
- `.superpowers/sdd/` holds subagent briefs, reports and review diffs from the
  harness phase-1 build; scratch, tracked.

