# @uidx/agent

## Project CLI and MCP tools

Installing `uidx` in an application brings this package, the server, and
the viewer into that project's `node_modules`. Run `uidx init`, then `npm run
uidx` to serve the project's `.uidx/` document. That server hosts the viewer
and MCP at `/mcp` on the port configured in `.uidx/config.json`.

Agents with shell access can use `uidx read`, `search`, `apply`, `create`,
`intent`, `eval`, `audit`, `render`, `architect`, `selection`, and `status`.
These commands call the same project tools as MCP and require no MCP client
setup. `uidx render page.uidx -o preview.png` produces a visual for the agent
to inspect. Commands discover the project from the working directory;
`--root` or an explicit root argument can select it.

`uidx mcp` (also available as `uidx-mcp`) bridges stdio MCP to that running
project server. `uidx init` registers it in `.mcp.json` and installs skills in
the repository. The server binds tools to one document and rejects another
project root. See the [CLI guide](../cli/README.md) for examples and configuration.

## Optional chat harness

An optional chat harness for uidx. It runs as its own process, indexes a
document's `.uidx` files, and answers requests from the viewer's chat panel by
writing those files. It never talks to the canvas: the uidx server already
watches the files, so an accepted edit appears on screen the same way a
hand edit does. The agent has no channel back to the canvas at all — it
cannot select a node, scroll the view, or know what render came out the other
end. If the canvas is not open or its dev server is not watching the
document, the write still lands on disk; it just does not show up anywhere
until something starts watching again.

## Running it

```bash
cp packages/agent/.env.example .env    # then edit
pnpm --filter @uidx/agent build
node packages/agent/dist/server/main.js
```

The service listens on the port from `UIDX_AGENT_URL` (the `.env.example`
default is `http://localhost:4500`, so port 4500) unless `UIDX_AGENT_PORT` is
set, which overrides it. It binds `127.0.0.1` and answers only browser origins
on this machine — it has no authentication and it rewrites your files, so it is
not something to expose to a network. It searches `UIDX_AGENT_ROOTS` (default:
the working directory) for `uidx.json` files, ignoring `node_modules`, `dist`
and hidden directories. The viewer panel finds the service at
`VITE_UIDX_AGENT_URL`.

## Models

`UIDX_AGENT_MODEL` is `provider:model`. vLLM and LM Studio speak the
OpenAI-compatible protocol directly; Ollama is reached through its own
provider instead, because its dedicated tool-call streaming is more reliable
than its OpenAI-compatible shim:

| Provider | Example | Default base URL |
|---|---|---|
| `vllm` | `vllm:gemma-3-27b-it` | `http://localhost:8000/v1` |
| `ollama` | `ollama:qwen2.5-coder` | `http://localhost:11434/api` |
| `lmstudio` | `lmstudio:qwen2.5-coder` | `http://localhost:1234/v1` |
| `anthropic` | `anthropic:claude-sonnet-4-5` | — (needs `ANTHROPIC_API_KEY`) |

An optional `UIDX_AGENT_REPAIR_MODEL`, same syntax, regenerates a malformed
tool call's arguments on a stronger model instead of just handing the error
back to the small one.

Each turn runs a small tool loop (`buildAgent` in `src/agent/agent.ts`). The
first step only offers the tools that do not write (`read`, `search`,
`use_skill`, `plan`) — a small model that can write immediately usually
writes before it has looked, and step 0 is there to make it look first, and
to let it write down what it intends to do. Every later step offers the full
tool set, including `edit`, `create_file`, `delete_file`, and `delegate`. A
model that tries to write on step 0 anyway has that call refused as an
unrecognised tool and loses the step; it gets the full set again on the next
one.

Once a conversation has run a few steps, the loop compacts its own history
rather than letting it grow without bound: older exchanges collapse into one
synthetic "earlier steps summarised" note, one line per elided tool call,
put back where the span it replaced used to sit. **The kept tail is bounded
by bytes, not by a count of exchanges.** The exchange that just finished is
always kept verbatim — a model that loses the result it just received redoes
the work — and the one before it is kept only when the pair still fits;
otherwise it is summarised like any older one. Two `read` results at
`readChars` apiece are 30,474 characters, well past what a 16,384-token turn
can carry beside its pack, tool schemas and output reserve, so a fixed
two-exchange tail was a floor compaction could not honour: it ran, reported
success, and left the turn over its window anyway. The budget itself is
measured on the exact strings the turn will send — the assembled
instructions and every tool's serialized schema — rather than estimated from
a constant that goes stale each time a tool is added. This is separate from
— and layered on top of — the read-time budgeting below; it is what keeps a
*long* conversation inside the window, the same way `read`'s outline mode is
what keeps a *large document* inside it.

## Reading a document too large for the window

`examples/checkbox.uidx` is 209,648 characters (JS string length — 209,666
bytes on disk; the character count is what every budget here is measured
against) — far more than any of this
harness's small local models can hold in one request alongside its own
instructions, tools, and a place to write an answer. `UIDX_AGENT_CONTEXT_TOKENS`
(default 16,384, floored at 2,048) sets the model's context window in tokens;
`budgetFor` (`src/index/budget.ts`) turns that into character budgets for
three things that share the window:

| Share | Default (16,384 tokens) | Governs |
|---|---|---|
| `packChars` (35%) | 17,776 chars | The context pack sent as `instructions` on every step — current page, selection, document map |
| `outlineChars` (20%) | 10,158 chars | One `read` call's outline — `mode: 'outline'`, or the outline shown alongside a refusal |
| `readChars` (30%) | 15,237 chars | The largest whole source `read` will return before refusing; also the cap on one `use_skill` body |

The remaining ~15% covers the system prompt, tool schemas, and the model's
own output. Chars-per-token (3.1) is measured against real `.uidx` markup,
not assumed — see `src/index/budget.ts`'s own comment for the samples.

`read(file, address?, mode?, neighbourhood?)` is what makes a document this
size navigable instead of fatal:

- **`mode: 'source'`** (the default) — exact text. If the requested
  node's source is over `readChars`, the tool refuses with a one-line notice
  (`refused: ... over the N-character read limit — showing its outline
  instead`) followed by that node's outline, rather than truncating the
  source silently or erroring the turn out with `finishReason: length`. This
  is the whole premise of Phase 2: before it, asking the harness to read
  `checkbox.uidx` killed the turn; after it, the same call comes back as a
  ~10,300-character outline the model can act on.
- **`mode: 'outline'`** — the requested node's shape (element, name, address,
  a few identifying props, child count), breadth-first and budget-bounded, so
  every sibling at a level is represented before any child is — a page with
  many top-level sections never loses one to an earlier sibling's deep
  subtree. States plainly what it left out ("N node(s) omitted — read a child
  address to descend").
- **`mode: 'signature'`** — one line for one node. Cheapest way to confirm
  what something is before committing a full read to it.
- **`neighbourhood: true`** — a node's ancestor chain and immediate children,
  each as a signature line. Useful for orienting on an address found via
  `search` without reading its whole subtree.
- Omitting `address` targets the page as a whole; `mode` and `neighbourhood`
  still apply to it.

The practiced shape on a large page: `read(file)` (outline via refusal, or
`mode: 'outline'` directly) → pick an address off the `@address` in a line →
`read(file, address)` for the exact source, or `mode: 'outline'` again to
descend one more level first.

## Skills

`use_skill({ name })` loads one skill's full `SKILL.md` body by name — the
model calls it before starting work a skill covers, rather than being handed
every skill's full text on every turn. Only a one-line `name (origin):
description` per skill sits in the system prompt unasked (`renderSkillListing`);
the body loads on demand and is capped the same way a read is, with a
truncation notice naming what was cut if a body ever runs long. Each
description is capped at 160 characters and the listing as a whole at 1,200,
with a count of the skills it could not fit — the listing rides in
`instructions` every single turn, so a large personal skills directory would
otherwise spend the window silently.

Skills live in a directory named `.uidx-agent/skills/<name>/SKILL.md`, one
subdirectory per skill, frontmatter `name:`/`description:` fields plus a
Markdown body below the fence. Two roots are searched, docroot first: the open
document's own `<docroot>/.uidx-agent/skills/` (shipped with the design
system, so anyone who opens the document gets them), then the operator's own
`~/.uidx-agent/skills/` (personal, machine-local). A docroot skill shadows a
user skill of the same name.

Two skills ship with this repo, at `.uidx-agent/skills/`:

- **`uidx-authoring`** — the node grammar: elements, containment rules,
  component props, variants, instances, slots, token aliases.
- **`component-doc-page`** — how this repo structures a component
  documentation page, using `examples/checkbox.uidx` as the worked example
  (the same 209,648-character file the budgeting above exists for — the
  skill itself says to read it with `mode: 'outline'` rather than whole). A
  test loads both shipped skills from disk on every run, because
  `discoverSkills` skips a malformed one silently and a typo in either
  frontmatter fence would otherwise remove them with no signal at all.

A skill's name, description, and body all pass through the same
`</context>`-escaping the document context pack does before they reach the
prompt — a skill file the harness didn't author (any docroot skill) is
untrusted the same way a design file's own text is, even though *where* it
can be planted differs (see `agent.ts`'s own comment on the distinction).

## Plans

`plan({ action, ... })` keeps a durable record of a job too big for one HTTP
turn, on disk at `.uidx-agent/plans/<taskId>.json`, rendered into the model's
own instructions on every turn that continues the same task so it resumes
instead of restarting:

- **`set`** — write the goal and an ordered list of step descriptions.
  Refuses (returns the existing plan instead of overwriting it) if the
  current plan already has a `done` or `blocked` step, unless the call passes
  `replace: true` — a small model cannot discard recorded progress by
  accident, only on purpose.
- **`complete` / `block`** — mark one step by id, with a one-line result (what
  it produced, or why it's stuck).
- **`show`** — re-read the current plan, e.g. after resuming a break.

A plan whose every step is `done` is treated as **absent**: it is not
injected into a later turn's instructions, `planRemaining` reports 0 for it,
and `set` may start a new task over it without `replace: true`. A task id
lives as long as the panel's conversation, so a finished job's plan is still
on disk when an unrelated request arrives in that same conversation; without
this the model would be told to keep a plan it has no way to keep. The file
is not deleted — `plan show` still reads it back.

The render is bounded: goal, step text and results are clipped, and the
whole thing is capped at 2,000 characters with a count of what it left out.
It rides in `instructions` on every turn of the task, and nothing about a
model-authored plan's length was otherwise limited.

`ChatBody.taskId` is what threads one plan across turns: the **service**
mints one with `randomUUID()` (`chat()` in `src/server/turn.ts`) when a
request arrives without one, and returns it in the `x-uidx-task` header and
every reply's metadata; the panel then reads it back off the first reply that
carried one and sends the same id on every later message in that conversation
(`ChatPanel.vue`). Every reply's metadata carries `turnId` (this HTTP turn,
for revert), `taskId` (this task, for the next turn), and `planRemaining`
(steps not yet `done`, computed *after* this turn's own `plan` calls settle).
The panel's
**Continue** control appears under a reply exactly when `planRemaining > 0`
on the *latest* message, and clicking it sends a plain "Continue." on the same
task id — the mechanism that lets a small model work through a plan spanning
more turns than fit in one context window.

A hand-edited or half-written plan file is recovered from, not fatal: a
corrupt plan is treated as "no plan yet" for the turn that hit it, with the
`plan` tool's own read explaining how to recover (`set` with `replace: true`)
the next time the model calls it.

## Delegation

`delegate({ kind, mission })` hands one small, self-contained job to a fresh
worker — its own `ToolLoopAgent`, its own short role prompt, its own
mission-scoped context, and only the tool subset its `kind` is trusted with:

| Kind | Tools | For |
|---|---|---|
| `read-mission` | `read`, `search` | Investigate and report — never writes |
| `edit-mission` | `read`, `edit` | Change one existing page |
| `author-mission` | `read`, `edit`, `create_file` | Create and fill in a new page |

`delegate`, `plan`, and `delete_file` are never in any worker's tool set —
not a prompt instruction a model could be argued out of, but a lookup table
(`TOOLS_BY_KIND` in `src/agent/delegate.ts`) a worker's tools are built from
and nothing else. Only the worker's own short summary — a few sentences, hard
capped at 500 characters — comes back into the orchestrator's context; its
tool calls, its role prompt, its own read/edit history never do. That's the
whole point of delegating a large job: the orchestrator's own context stays
small regardless of how much a worker had to read or try to get there.

**Delegation is sequential, and runs on the same single model as the
orchestrator — by design, not as a current limitation.** Two missions never
run concurrently; a second `delegate` call queues behind the first
(`enqueue` in `delegate.ts`). This is not a caution against a hypothetical
race — the target this harness runs against is a local model server started
with a fixed parallel-sequence count of one (`-np 1`), which serialises
every request it receives regardless of how many a caller fires at once.
Measured directly: running requests concurrently against that server produced
a 0.94× "speedup" — i.e. none, and marginally worse than running them one at
a time. Queuing missions is simply naming what the server already does,
rather than pretending a client-side `Promise.all` buys anything a
single-stream server can't actually deliver.

A worker's own context pack is a *fraction* of the orchestrator's own pack
budget — `budget.packChars / 4` (`MISSION_CONTEXT_CHARS_DIVISOR` in
`src/server/turn.ts`), not the full pack reused — so a worker starts
near-empty and spends its small window on its mission rather than a second
copy of the whole document map. **That divisor is a judgment call, not a
measurement**: unlike `PACK_SHARE` (measured against a live model in Task 1),
a worker's request has no comparable fixed cost to measure against yet, and
the code's own comment says so plainly rather than presenting `/ 4` with more
confidence than it has earned. Revisit it with a real measurement if a
mission ever turns out to need more orientation than it currently leaves room
for.

## Safety

- Only `.uidx` files inside the document root and covered by the manifest's
  `files` globs can be written.
- Every write is validated by re-parsing; a patch that would produce an invalid
  document is refused and the diagnostic goes back to the model. Parse-level
  only: a write that parses but that `uidx check` would flag — an alias
  resolving to no variable, an `<Instance>` naming a component that does not
  exist, a new page whose frontmatter `id` duplicates another's — lands, and
  the model is told it succeeded. Spec §5 says what closing that costs and
  when.
- Every turn snapshots the files it is about to change under
  `.uidx-agent/checkpoints/<turn>/` before touching them. `POST /revert`
  restores those snapshots, and each reply in the panel carries a **Revert this
  turn** control that calls it. **This is the whole undo story** — uidx itself
  has no document-level undo underneath it, so a turn that is not reverted
  through this mechanism (or through `git`) is permanent. Deleting
  `.uidx-agent/` deletes the ability to revert past turns.
- The document context sent to the model is wrapped in a `<context>...
  </context>` fence and labelled as data the model should not treat as
  instructions. That fence is a convention the model is asked to honor, not a
  parser boundary enforced by code: the harness only neutralises the literal
  closing delimiter (in its usual spellings and a few case/whitespace
  variants) so a design file that contains the text `</context>` — in a
  layer name, a text node's `characters`, anything — cannot prematurely end
  the trusted zone and get its own content read back as instructions. It is
  not a guarantee against a determined prompt injection dressed up some other
  way, and it is not a substitute for reviewing what the model actually
  wrote.
- `delete_file` exists and is reachable in every turn once step 0 has passed;
  nothing in code stops it from firing. The only restraint is a line in the
  system prompt asking the model to use it only when the user asked for a
  page to be removed. There is no confirmation step, no dry run, and no
  separate permission gate — treat it the same as any other write a model in
  the loop can make on its own, and rely on `git` or the checkpoint above if
  it deletes the wrong thing.
- `search`'s `regex` option caps the query string at 200 characters, which
  rules out pasting in a very long malicious pattern, but it does not analyse
  the pattern itself. A short pattern can still exhibit catastrophic
  backtracking against a large document; the cap reduces the attack surface,
  it does not close it.

## Routes

| Route | Purpose |
|---|---|
| `GET /health` | Liveness; the panel's icon probes this |
| `POST /chat` | One turn. Body: `{ messages, documentId?, page?, selection?, taskId? }` |
| `POST /revert` | Undo one turn. Body: `{ documentId?, page?, turnId }` |

`taskId` is optional on the first message of a conversation (the service
mints one and returns it, in both the `x-uidx-task` header and every reply's
metadata) and is how a `plan` survives across turns — see Plans, above.

## Manual verification

The automated suite (`test/end-to-end.test.ts` for a single turn,
`test/phase2-end-to-end.test.ts` for the read/skill/plan/delegate mechanisms
together against a document sized to force them) proves the harness with
scripted models. To see it work for real:

1. Start a model: `vllm serve google/gemma-3-27b-it --port 8000` (or
   `ollama serve` with `UIDX_AGENT_MODEL=ollama:<model>`).
2. Start the agent from the repo root: `node packages/agent/dist/server/main.js`.
3. Start the viewer on a design document:
   `node packages/cli/dist/uidx.js open design/option-4/home.uidx`.
4. The chat icon in the top bar should be enabled. Open it, select a frame on
   canvas, and ask for a change (e.g. "make the hero 800 wide").
5. Confirm: the file on disk changes, the canvas updates without a reload, and
   `git diff` shows a minimal patch.

Two more, specific to what Phase 2 added, against the real exemplar:

6. Open the viewer on `examples/checkbox.uidx` and ask *"Read
   examples/checkbox.uidx and tell me how its state grid is built."* It
   should outline the page, read selectively by address, and answer —
   without the turn ending in `finishReason: length`.
7. Ask *"Build a checkbox documentation page following the
   component-doc-page skill."* It should load the skill with `use_skill`,
   write a plan, and work through it across turns using **Continue**.

## Not in this plan

Deferred, per the spec: `view_image` (§5, node and page rendering), memory
and the learning loop (§6), and `web_search` (§7) — a follow-on plan once
these land.
