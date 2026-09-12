# UIDX Agent Harness — Phase 2 Design

Date: 2026-08-30
Status: Approved (design), implementation to follow
Builds on: `2026-08-29-uidx-agent-harness-design.md` (Phase 1, shipped)

## Why this phase exists

Phase 1 proved the mechanism: a local 9B model creates, edits, validates and
reverts `.uidx` files safely, and the canvas follows. What it cannot do is
produce work of the quality the repo already contains.

The gap was measured, not guessed. Asked to build a checkbox design-system
page, the harness produced six frames holding six text labels — 1,237
characters. The repo's hand-authored `examples/checkbox.uidx` is **209,648
characters** — JS string length, which is what every budget in this phase is
measured against; 209,666 bytes on disk, since the file holds multi-byte
characters. At the 3.1 chars/token later measured against real `.uidx`
markup (`packages/agent/src/index/budget.ts`) that is ~67,600 tokens; the
~52,400 figure this document was drafted with assumed a flat 4 chars/token,
so the gap it describes is larger, not smaller. The file holds: a
`Control/Checkbox` component with three
variant axes, 18 authored variants, 37 instances forming a live state grid, 85
rectangles and 23 vector paths, auto-layout throughout, and prose sections
including anti-patterns and a knowingly-unfixed WCAG contrast failure.

That target is **3.2× the model's entire 16,384-token context window** at the
4 chars/token this was drafted with, and 4.1× at the 3.1 later measured. No
single-context agent produces it at any prompt quality. Three things are
missing, in this order of leverage:

1. The model cannot **study the exemplar** — `read` with no address returns the
   whole file, and 52k tokens does not fit in 16k.
2. The model has never been **taught the idiom** — the system prompt is ~1,200
   characters by design and says nothing about component/variant grammar,
   auto-layout, or the house documentation structure.
3. The model cannot **exceed one context** — there is no way to carry a long
   task across many turns, and no way to hand a sub-task to a fresh context.

## Product decisions

- **Single model, no parallelism.** Measured on the target machine: Ollama
  0.33.2 launches its model server with `-np 1` and serializes concurrent
  requests (0.94–0.97× speedup, i.e. none). Delegation is therefore
  **sequential**, and its value is context isolation, not throughput. The
  design must not depend on concurrency, and must not regress if concurrency
  later becomes available.
- **Small units of delegated work.** A mission must fit comfortably in one
  small-model window with room to think. The orchestrator's job is to cut work
  small, not to supervise big workers.
- **Long tasks must survive.** Progress lives on disk, not in the
  conversation, so a task can run for hours, be interrupted, and resume.

## 1. Context discipline

The foundation. Everything else assumes the model can look at a large document
without drowning in it.

### 1.1 Adaptive context budget

`packContext` takes a fixed `maxChars` of 12,000 today, regardless of whether
the window is 4k or 256k. Phase 2 derives the budget from the model's real
context window, declared per model in config (`UIDX_AGENT_CONTEXT_TOKENS`,
default 16384), and spends it as a stated split: instructions, context pack,
and a reserve for the model's own output. The pack never silently exceeds its
share; when it must drop content it says what it dropped.

### 1.2 `read` grows an outline mode

`read(file)` with no address currently returns the entire source. That is the
single trap that makes the exemplar unreadable. Phase 2:

- `read(file)` returns the whole page **only if it fits the budget**;
  otherwise it returns an outline and says so.
- `read(file, address, mode)` where `mode` is `source` (today's behaviour),
  `outline` (the subtree's shape — element, name, address, and the props that
  identify it, with bodies elided), or `signature` (one line for the node).
- An outline is depth-bounded and budget-bounded, and always states what it
  omitted, so the model knows to descend rather than assuming it saw
  everything.

This is what lets a model in a 16k window navigate a 6,400-line page: outline
the page, pick the node, read that node's source.

### 1.3 Local zoom

`read` gains `neighbourhood: true`, returning a node's ancestors as a
breadcrumb plus its immediate children as signatures. Cheap orientation
without pulling a subtree.

## 2. Skills

The vehicle for taste. The system prompt stays small; knowledge lives in
skills that load only when relevant.

- A skill is a directory under `<docroot>/.uidx-agent/skills/<name>/` (or
  global `~/.uidx-agent/skills/`) containing `SKILL.md` with YAML frontmatter
  (`name`, `description`) and markdown instructions, plus optional reference
  files.
- **Three tiers.** At session start only each skill's name and one-line
  description enter the prompt (~30 tokens each). The model loads a full
  `SKILL.md` with the `use_skill` tool. Reference files load only when the
  skill's body points at them.
- **Ships with two skills**, both written against the repo's own work so they
  teach what is actually true here:
  - `uidx-authoring` — the node grammar a model gets wrong: `Component` with
    `props` and `variants` axes, `Variant` children, `Instance` with `Slot`
    fills, auto-layout properties, token aliases, and the address rules.
  - `component-doc-page` — the house structure for a component documentation
    page, derived from `examples/checkbox.uidx`: the prose sections and their
    order, the state grid built from `Instance` cells rather than screenshots,
    the component definition sitting beside the page, and the anti-patterns
    convention.

Skills are how the user teaches the harness their own conventions without
touching code or growing the prompt.

## 3. Durable plan and compaction — the long-running loop

A task larger than one context needs its progress outside the context.

### 3.1 The plan file

`.uidx-agent/plans/<taskId>.md` — a checklist the agent owns:

- The orchestrator writes it at the start of a long task: the goal, and the
  work cut into small steps.
- Each step carries a status (`todo`, `doing`, `done`, `blocked`) and, when
  done, a one-line result.
- A `plan` tool reads and updates it. Reading costs a few hundred tokens;
  the conversation that produced it costs nothing, because it is gone.

The plan is the memory of the task. It is also the resume point: a turn that
ends — for any reason — leaves the next turn a complete picture.

### 3.2 Compaction

Between steps, `prepareStep` rewrites history: completed steps collapse to a
line, and their tool results are dropped. What remains is the system prompt,
the current plan, the current step's context, and the last few exchanges.

The loop is then **bounded by construction** rather than by luck, and can run
indefinitely on a 16k window.

### 3.3 Continue

A turn that hits its step budget with plan items still `todo` ends by saying
so, and the panel offers **Continue**, which starts a fresh turn against the
same plan. Long tasks proceed in comfortable bites rather than one heroic run.

## 4. Delegation — sequential, single model

One level deep. No concurrency.

- The orchestrator calls `delegate(mission)`. A worker runs its own bounded
  tool loop in a **fresh context** containing only: a narrow role prompt, the
  mission text, a mission-scoped context pack, and 1–3 tools.
- The worker returns a **structured summary** (what it did, what it changed,
  what it could not do) of a few hundred tokens. Its transcript is discarded.
- Missions are typed and deliberately small: `read-mission` (answer one
  question about the document), `edit-mission` (make one scoped change to one
  file), `author-mission` (create one node subtree from a described intent).
- The orchestrator holds only the plan and the summaries, so its context grows
  by a few hundred tokens per completed mission rather than by a transcript.
- Workers may not delegate. Depth is one, enforced.
- Because execution is sequential, a worker's writes are visible to the next
  worker with no coordination — the plan is the only shared state.

Delegation and the plan file are the same idea seen twice: the plan keeps the
task's progress out of context; delegation keeps each unit's *working* out of
context.

## 5. Eyes — `view_image`

`view_image` accepts an asset path, a node address, or a whole page, and
returns a PNG the model can see. Rendering is headless: `@uidx/schema`'s
`toSceneGraph` plus the open-pencil/CanvasKit renderer in Node, with the wasm
and Inter fonts the repo already ships.

Scheduled after the items above because it improves *judgement*, while they
determine whether the model can act at all. On a vision-capable local model
(qwen3.5:9b and gemma4 both qualify) it closes the loop: build, look, correct.

## 6. Memory

`.uidx-agent/memory/` — a `MEMORY.md` index always loaded, plus typed topic
files read on demand. When a turn ends after a user correction, a distillation
pass writes a lesson: situation, what went wrong, what to do instead. Hygiene
is enforced: merge duplicates, cap the index.

## 7. Web search

`web_search` behind a pluggable provider chosen in config. Lowest priority of
this phase: research can be pasted into a request today, and every other item
above is a precondition for the model doing anything useful with what it finds.

## Build order

Strictly dependency-ordered, and front-loaded on the user's stated goal —
long tasks, small delegated units, single model:

1. **Context discipline** (§1) — nothing else works without it.
2. **Skills** (§2) — the largest quality gain per unit of effort, and it
   depends on §1 to let a skill point the model at a real exemplar.
3. **Plan + compaction** (§3) — the long-running loop.
4. **Delegation** (§4) — needs §1 for mission-scoped packs and §3 for the plan
   that decides what to delegate.
5. **`view_image`** (§5).
6. **Memory** (§6).
7. **`web_search`** (§7).

Each is independently shippable and independently useful.

## Success criteria

The phase is done when, on a single local 9B model in a 16k window:

- The model can study `examples/checkbox.uidx` — outline it, then read the
  parts it needs — without exceeding its window.
- Asked for a component documentation page, it produces one with a
  `Component` carrying variant axes, `Instance` cells, and the house prose
  sections — because a skill taught it that shape.
- A task too large for one turn is carried across turns by its plan file, and
  resumes correctly after an interruption.
- The orchestrator's context grows by summaries rather than transcripts, so a
  long task does not end in `finishReason: length`.

## Explicitly not in this phase

Parallel workers, multi-level delegation, the option-4 command deck, the
autonomy dial, and the agent halo.
