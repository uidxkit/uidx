# UIDX Agent Harness — Design

Date: 2026-08-29
Status: Approved (design), phased implementation to follow

## Summary

A chat-driven AI harness for uidx: a **separate, optional agent service** that
indexes a document's `.uidx` files, answers requests from a floating chat panel
inside the viewer, and fulfills them by **creating, updating, or deleting
`.uidx` files only**. It never talks to the canvas — the uidx server's existing
file watching carries every agent write onto the canvas automatically. The
harness is built on the Vercel AI SDK, is provider-agnostic (local vLLM/Ollama/
LM Studio and hosted Anthropic), and is engineered so that **small open-source
models are first-class citizens**: the first target configuration is Gemma
served by local vLLM.

Product decisions made during design:

- **Edit flow: direct apply + undo.** Agent writes land on disk immediately
  (the canvas follows in real time); safety comes from validate-before-write
  and per-turn checkpoints with a revert action — uidx has no document-level
  undo, so the harness brings its own.
- **UI: functional panel now.** A plain floating chat panel toggled by a
  toolbar icon; the `design/option-4` command-deck language (halo, autonomy
  dial) is a later polish phase.
- **Active document comes from the app.** A machine may hold several
  `uidx.json` documents; the panel tells the service which one is open.
- **Model selection via `.env`.** Local or remote per role, one-line switch.

## 1. System topology

Two deliverables, cleanly separated:

### `packages/agent` — the harness service

A new workspace package with a bin entry (`uidx-agent [--port 4500]`, later
also `uidx agent` in the CLI). One process, standalone, no dependency on the
running uidx server. Responsibilities:

- **Documents on demand.** The service does not bind to a manifest at startup.
  Each chat request carries the active `uidx.json` path; the service opens that
  document lazily (parse all files per its manifest globs via `@uidx/format`),
  builds its index, and caches a workspace per manifest. Multiple documents can
  be live at once.
- **Own file watching.** chokidar per document keeps the index fresh — this
  also absorbs edits the user makes on canvas, since those land in the files.
- **HTTP surface** (CORS enabled for localhost viewer origins):
  - `POST /chat` — AI SDK UI-message stream (SSE): text deltas, tool activity,
    errors as typed parts.
  - `GET /health` — liveness + version, probed by the viewer icon.
  - `POST /status` — page/selection updates outside of messages (phase 3 live
    status; v1 sends status as message metadata only).
- **Writes are validated and atomic.** A write that fails to parse, fails
  patch validation, or introduces new `uidx check` errors is refused — the
  diagnostic goes back to the model as the tool result, never to disk.

### Viewer additions (the only app changes)

- A toolbar icon toggling a **floating chat panel** (Vue). The icon probes
  `/health` with backoff: healthy → active; absent → offline state. The app is
  fully functional without the agent.
- The panel uses `@ai-sdk/vue` `useChat` with a transport pointed at the agent
  URL, configured in `.env` (`VITE_UIDX_AGENT_URL`, default
  `http://localhost:4500`).
- Every outgoing message carries metadata: `{ manifest, page, selection }` —
  the entire canvas→agent status surface in v1.
- Tool activity renders as compact rows ("`edit` — home.uidx · save-button");
  each agent turn shows a **Revert this turn** action (see §5).

The uidx server is untouched.

## 2. Agent loop and model roles

One **flat tool loop** on the Vercel AI SDK (`ToolLoopAgent` / `streamText`
with `stopWhen: stepCountIs(N)` plus a token-budget stop). No graph framework.

**Role-based model registry.** Config maps roles → models; every role accepts
any provider:

| Role | Purpose | Default |
|---|---|---|
| `orchestrator` | plans, runs the main loop | the one configured model |
| `worker` | executes delegated missions (phase 3) | falls back to orchestrator |
| `repair` | regenerates malformed tool arguments | unset → retry-with-error only |
| `distiller` | end-of-turn memory distillation (phase 2) | best configured model |

Providers: the **OpenAI-compatible protocol is the lingua franca for local
models** — vLLM, LM Studio, llama.cpp, and Ollama all expose it, so any
OpenAI-compatible endpoint works out of the box via
`@ai-sdk/openai-compatible`. Ollama additionally gets the dedicated
`ai-sdk-ollama` provider (better tool-call streaming than raw OpenAI-compat),
and Claude connects via `@ai-sdk/anthropic`. First target: every role → Gemma
on local vLLM.

**Small-model scaffolding, built into the loop:**

- **Few tools per step.** `prepareStep`/`activeTools` exposes only the tools
  valid for the current phase; `toolChoice` forces a tool where the workflow
  demands one, removing the act/don't-act decision.
- **Grammar-constrained arguments.** When the provider is vLLM, tool argument
  schemas are enforced server-side (`guided_json`) so malformed JSON is
  structurally impossible. Constrain argument *shape*, never the decision to
  act (the "constraint tax"). Everything is still Zod-validated in-harness.
- **Repair ladder.** Invalid call → one retry carrying the actionable error →
  if a `repair` model is configured, regenerate just the arguments there
  (AI SDK `experimental_repairToolCall`) → fail the step with a clear message.

## 3. Context engine

**No embeddings.** A deterministic index, rebuilt incrementally per file
change, derived from `@uidx/format` ASTs (which carry exact source spans):

- per file: pages, components (props/variants/slots), instances (component +
  location), token collections/variables, intent-markdown headings;
- cross-file: component→usage graph, token→usage graph (the same facts the
  server's symbol table derives; the agent builds its own via the format
  library and stays decoupled from `@uidx/server`).

Two products:

1. **The doc map** — an Aider-style compact text rendering (names, signatures,
   component props, page inventories — never bodies) within a strict token
   budget. It gives a small model *orientation and scope*: what exists, what
   is relevant, what to reuse — without asking it to search well, which is the
   known weakness of 7–27B models.
2. **Mission context packs** — per request, a packer ranks index entries by
   deterministic graph proximity: selected node and ancestors first, then the
   current page, then components/tokens it references, then the rest of the
   map. The pack includes full source only for the spans likely to be edited;
   everything else is a lightweight identifier the model can pull just-in-time
   with `read`/`search`.

## 4. Tools

A tiny, closed toolset — the sandbox *is* the toolset (no shell, no generic
filesystem access):

| Tool | Phase | Behavior |
|---|---|---|
| `read` | 1 | Exact source of a node (by `entity#path` address) or file |
| `search` | 1 | Exact/regex search across the document; addresses + snippets |
| `edit` | 1 | Batch of semantic ops: `set_prop`, `remove_prop`, `insert_node` (JSX source), `remove_node`, `move_node`, `rename`. Harness compiles ops → `UidxPatch` span edits, validates, writes atomically |
| `create_file` / `delete_file` | 1 | New page/token file with a valid skeleton, or removal — within manifest globs |
| `view_image` | 2 | Accepts an **asset path, a node address, or a page** and returns a PNG as image content for multimodal models. Node/page rendering is headless: `@uidx/schema` `toSceneGraph` + the open-pencil/CanvasKit renderer in Node (same wasm + Inter fonts the repo ships). Fallback if headless CanvasKit proves infeasible: ask the open viewer to render offscreen |
| `use_skill` | 2 | Load a skill's full body (§7) |
| `web_search` | 3 | Pluggable provider selected in config |
| `delegate` | 3 | Orchestrator-only; hand a typed mission to a fresh-context worker (§9) |

Models never do span math or author raw MDX around the tree — they express
intent; the harness does the surgery.

**Modularity enforcement** (a core requirement): the system prompt's authoring
rules mandate reuse-first (instantiate existing components — visible in the
doc map, not merely discoverable), extraction of repeated structures into
`<Component>`s, and small files/pages. The harness feeds `uidx check`
diagnostics and size warnings back into the loop as tool results, so the model
is corrected by evidence, not vibes.

## 5. Safety and undo

- **Path jail.** Every path resolves inside the active document root and must
  match the manifest globs; only `.uidx` files are writable.
- **Validate-before-write (parse-level, as delivered).** Every op is applied to
  a re-parsed document and the result is re-parsed again; a batch that would
  produce a file that does not parse is refused whole, with the diagnostic as
  the tool result, and nothing is written. Broken files never reach disk; the
  canvas never sees them.

  This is narrower than the "no new `uidx check` errors" this section
  originally promised, and Phase 1 does not deliver that. Three kinds of write
  parse cleanly, are reported to the model as applied, and would be flagged by
  `uidx check`: a `{collection#variable}` alias that resolves to nothing, an
  `<Instance component="…">` naming a component the document does not declare,
  and a new page whose frontmatter `id` duplicates an existing page's. The
  designer sees them on canvas — an unresolved alias drops the paint rather
  than drawing a literal — but the model is told it succeeded and so does not
  correct itself.

  Closing that subset is Phase 2 work, and it is cheap: duplicate page id,
  unknown component, and unknown variable are all computable from the
  `DocumentIndex` the harness already builds for the doc map, with no second
  parse and no `uidx check` process. The remainder of `check` — asset
  references, size warnings, layout diagnostics — stays out of the write path.
- **Per-turn checkpoints.** Before a turn's first write to a file, its prior
  content is snapshotted under `.uidx-agent/checkpoints/<turn>/`. The panel's
  per-turn **Revert** restores the files; the canvas follows via file watch.
  (Later this same machinery is "Propose" mode for the option-4 autonomy dial.)
- **Budgets.** Max steps/turn, max files/turn, max tokens; panel stop button
  aborts the stream and loop.

## 6. Skills

All agent-owned state for a document lives in one dot-directory:
`.uidx-agent/` (checkpoints, memory, skills, config). Skills follow the
SKILL.md standard with three-tier progressive disclosure:

1. Session start: only `name` + `description` of each skill in the prompt
   (~30 tokens each), from `<docroot>/.uidx-agent/skills/*/SKILL.md` and
   global `~/.uidx-agent/skills/`.
2. `use_skill` loads a skill's full body when the model judges it relevant.
3. Skills may carry reference files (pattern libraries, house conventions,
   "how to build a settings page here") loaded only when followed.

## 7. Memory, learning, and the prompt budget

**The static system prompt stays under ~600 tokens**: identity, authoring
rules, tool conduct. Everything else is data, not prompt — doc map, memory
index, and skills listing are context blocks sized to the weakest model.

**Two-track memory:**

- `.uidx-agent/AGENT.md` — human-written rules for the document. Always
  loaded, kept short, user-edited.
- `.uidx-agent/memory/` — model-written: `MEMORY.md` index (one line per
  memory, always loaded) + typed topic files (`user`, `feedback`, `project`,
  `reference`) read on demand.

**Learning loop.** When a turn ends after a user correction (explicit 👎 in
the panel, or the distiller detecting "no / wrong / I meant" patterns), a
distillation pass on the `distiller` model writes a lesson — situation → what
went wrong → what to do instead — then enforces hygiene: merge duplicates,
drop stale entries, cap index size.

## 8. Delegation (phase 3)

Orchestrator–worker, **one level deep**. The orchestrator calls
`delegate(mission)`; a worker is a fresh context holding only a narrow role
prompt, the mission, its mission context pack, and 1–3 tools, running a
bounded loop and returning a structured summary (~1–2k tokens), never its
transcript. Missions are typed — `edit-mission`, `research-mission`,
`lookup-mission` — keeping workers single-purpose, which is where small local
models perform best. Fan-out: "create five settings pages" → five parallel
edit-missions over disjoint files.

## 9. Configuration

- `.env` — providers/models per role, secrets, and the service address:
  `UIDX_AGENT_MODEL=vllm:gemma-4`, `UIDX_AGENT_BASE_URL=…` (the model
  endpoint's OpenAI-compatible base URL),
  `UIDX_AGENT_REPAIR_MODEL=anthropic:claude-…`, `ANTHROPIC_API_KEY=…`,
  `UIDX_AGENT_SEARCH_PROVIDER=…`, and `UIDX_AGENT_URL=http://localhost:4500`
  — the address the agent service listens on. The viewer's panel reads the
  same address through a Vite env var (`VITE_UIDX_AGENT_URL`), falling back
  to `http://localhost:4500`. One-model default; per-role overrides optional.
- `.uidx-agent/config.json` — budgets, search provider options.

## 10. Testing

Vitest, matching the repo. Deterministic parts (indexer, context packer,
edit-op compiler, checkpoint store, path jail) get plain unit tests. The loop
gets tests against the AI SDK mock language model (scripted tool-call
sequences, repair-ladder cases, budget stops). An opt-in **golden missions**
script runs real missions against local vLLM for regression checking (not in
CI).

## 11. Phasing

1. **Phase 1 — the working slice.** Service skeleton; `.env` model registry
   (vLLM/Ollama/LM Studio/Anthropic); indexer + doc map + context packs;
   `read`/`search`/`edit`/`create_file`/`delete_file`; parse-level
   validate-before-write (§5); checkpoints + revert; `/chat` SSE endpoint;
   viewer icon + floating panel with `{manifest, page, selection}` metadata.
   Demo: Gemma on local vLLM edits the open page from chat, live on canvas.
2. **Phase 2 — eyes and memory.** `view_image` incl. headless node/page
   rendering; skills; memory + learning loop; the index-computable half of
   `uidx check` in the write path — duplicate page id, unknown component,
   unknown variable (§5).
3. **Phase 3 — scale-out.** Delegation; `web_search`; live status channel +
   agent halo; autonomy dial "Propose" mode (checkpoint-gated apply); option-4
   command-deck UI polish.

## Notes and constraints discovered during design

- The README's "no LLM sits in the sync loop" holds: the agent is exactly the
  sanctioned "offline agent" writing files; the live loop stays deterministic.
- uidx has **no document-level undo** — checkpoints are not optional polish,
  they are the undo story.
- Any agent-authored value carrying a `{collection#variable}` alias must be
  written as a document patch (never via scene mutation) — automatic here,
  since the service only ever writes documents.
- Patches are page-addressed with no cross-file atomicity; multi-file missions
  sequence writes per file and surface cross-page disagreements as UIDX405–407
  diagnostics fed back to the model.
- The viewer is Vue 3 — panel work uses `@ai-sdk/vue`, not React.
