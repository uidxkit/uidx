# Instant edits on a file that stays the truth

**Goal:** An edit made in the viewer shows on the canvas and in the layers rail
in the same frame, the `.uidx` file stays the single source of truth for every
writer — the author, an outside editor, the in-panel LLM, Claude Code through
the CLI, MCP or a direct write — and undo/redo covers all of those writers with
one stack.

**Approved:** 2026-09-05, in chat, after measuring the current loop on
`design-systems/meridian/atlas.uidx` and comparing the Word and Figma models
with the user. Amended the same day after a review pass that found the message
order, the inverse baseline, the second rebuild trigger and the reflow leak
described below.

## Current state

Measured on the running server (`uidx open`, atlas page, 63,396 lines, 7,141
nodes), four times, at two window sizes, all within a few hundred milliseconds
of each other:

| Stage | Time |
|---|---|
| Click to `node:patch` leaving the socket | 0.05 s |
| Server round trip until `file:changed` arrives | 2.6 s |
| One blocking main-thread task on the client | 4.1 to 4.4 s |
| Total until canvas and rail repaint | about 7 s |

Where it goes:

- **Server, 2.6 s.** A full parse of atlas costs about 1 s. `FileSession.patchNow`
  pays it twice: `applyPatch` re-parses to prove the result still parses
  (`assertStillValid`) and throws the document away, then the session calls
  `parse(next)` again to hold it. The 15 MB `file:changed` costs 50 ms to
  stringify and 40 ms to parse; it is not the problem.
- **Client, 4.3 s.** `CanvasPane.render` skips the incremental path whenever the
  page uses `modes` (atlas has four), because `diffDocuments` resolves aliases
  with the flat default-mode resolver and would paint a dark subtree light. So
  every save rebuilds: `toSceneGraph` (0.5 s in node) plus a full CanvasKit
  re-record of the page. The rail's rows update inside the same task, so both
  surfaces appear to change together at the end of it.
- **Nothing is optimistic on this path.** A canvas gesture already shows its
  result before the file confirms (`fromSceneChange` → burst → patch), and a
  panel scrub previews through `applyProp`. The rail's eye, a rename, and a
  panel commit emit patches and then wait for the round trip.

Three more findings from the review pass, each measured on the running viewer:

- **The canvas can write layout back into the file.** With the incremental
  path forced on atlas, one eye toggle made the canvas emit 413 `set width` /
  `set height` patches for hug-sized rule nodes across eleven sections — layout
  results the author never typed. `fromSceneChange` and `novelPatches` are
  meant to keep this "reflow burst" out and did not.
- **A batch costs the server N full parses.** `applyPatches` re-parses after
  every op, so those 413 ops pinned the server above 100% CPU for minutes and
  every later patch queued silently behind them. A leaked burst of fifteen ops
  is a 30 s wait; this is the most likely shape of the slowness reported.
- **`definitionsMoved` forces a rebuild on every save of a page that declares
  a component**, because it compares definition nodes by identity and a save
  re-parses the page into fresh nodes. Atlas declares `Atlas`, so removing the
  modes guard alone still read "rebuilt".

Two facts that shape the design: a full parse is inherently about 1 s on a
file this size, so anything that waits for "parse, then draw" has a 1 s floor;
and every writer already converges on the same `UidxPatch` vocabulary — the
harness compiles LLM ops to it, the canvas emits it, the server applies it.

**Cross-file cost is re-broadcast, not re-parse.** No file other than the
changed one is ever parsed. The workspace re-indexes symbols by walking
in-memory trees (no I/O), and the client's three global indexes cost about
60 ms over 33 pages. But after a change the workspace re-sends the *full
document* of every page that references a symbol the changed page declares,
at its unchanged revision. Atlas binds 45 tokens from `tokens.uidx`, so one
token edit re-sends atlas's 15 MB and rebuilds it.

## Research grounding

- **Word** keeps a private in-memory document while open and serialises it to
  disk on save. Edits and undo never touch disk, which is fast, but an outside
  change is invisible until reload and the two copies drift; co-authoring is a
  separate merge engine. Wrong model for files that agents and editors write.
- **Figma** applies every edit to the local scene graph in the same frame, sends
  the operation to a server that orders operations by arrival and broadcasts
  them, resolves conflicts per property with last writer wins, and treats undo
  as a *new* inverse operation on your own edits, never a rewind of anyone
  else's. This is the model, with the file standing where Figma's database
  stands: the session is the ordering authority (revisions), the watcher turns
  an outside write into another writer's revision, and the client predicts.
- **Where the analogy strains.** Figma's writers all speak operations. An
  outside editor or an LLM rewriting the file speaks whole documents, so its
  change arrives as one revision that may touch a hundred nodes. The inverse
  of such a revision is derived by diffing, not recorded.

## Design

### 1. Three documents, one truth

The shell holds, per page:

- `doc` — the last document the server confirmed, with its `revision`. Every
  patch is written against this and carries its revision. Unchanged.
- `shown` — `doc` with the client's in-flight patches predicted onto it. The
  rail, the inspector and the canvas render `shown`. When nothing is in flight,
  `shown === doc`.
- The scene graph — built from `shown` by the existing diff/apply path.

The file remains the truth: any `file:changed` replaces `doc`, `shown` is
recomputed from the new `doc` plus whatever is still in flight, and the canvas
diffs against what it currently draws. A prediction can never outlive the
server's answer to it.

### 2. Server: one parse per patch, one parse per attribute batch

**One parse per op.** `applyPatch` already parses the patched source in
`assertStillValid`. It returns that document on `PatchResult`
(`document?: UidxDocument`, present when the patch changed the text), and
`FileSession.patchNow` uses it instead of calling `parse(next)`. The harness's
`applyOps` (`packages/agent/src/edit/apply.ts`) does the same double parse per
op and takes the same fix. Expected: 2.6 s → about 1.3 s on atlas; LLM edits
halve too.

**One parse per attribute batch.** A batch whose ops are all `set` / `add` /
`remove` / `set-mode` on nodes of the *initial* document can be applied as text
splices in one pass: resolve every address against the initial document,
compute each op's splice from that document's spans, apply the splices from
the highest offset to the lowest so no earlier span moves, then parse once.
Two ops touching the same node's attributes fall back to the sequential path,
as does any batch containing a structural op (`insert-node`, `remove-node`,
`move-node`), where §6.3's re-parse between ops is still required. Expected:
a 400-op burst costs about 1 s instead of 400 s.

**`file:changed` names its cause.** The session's broadcast for a patch write
carries `patchId`, so a client can tell its own confirmation from an external
revision. This matters because the server broadcasts `file:changed` *before*
it sends `patch:applied` to the sender, so the document is always the first
thing the client sees.

Out of scope here: incremental re-parsing of only the changed span. It is the
next server win if the 1 s floor ever matters, and it does not matter once §4
takes the wait off the screen.

### 3. Client: the incremental path is actually taken

Three things stop it today on atlas, and all three change:

- **Modes.** `diffDocuments(prev, next, resolveAlias)` gains the same option
  `toSceneGraph` already takes — `tokens: { resolver, index }` — and maintains
  a mode tuple as it descends, exactly as `to-scene.ts` does (`mergeModes` over
  each node's `modes` attribute, `aliasFor(tuple)` for the resolver at that
  node). `CanvasPane.render` drops the `!usesModes(doc)` guard. A rebuild is
  still taken when a `modes` attribute itself changed.
- **Definitions.** `definitionsMoved` compares each component definition by
  content — the source text of its span, which the parser already has — rather
  than by node identity, and only for components this page instances
  (`<Instance component=…>` anywhere in its tree). A save of a page that
  declares a component it does not instance no longer rebuilds it.
- **The reflow leak.** Changes the canvas applies from a document — the diff's
  `applyChanges`, and the layout pass the SDK runs after it — must never turn
  into outgoing patches. The `applyingRemote` flag is dropped before the SDK's
  deferred layout events fire, which is how 413 sizes leaked. The fix is
  whatever `watchGraph` needs to attribute those events to the remote apply
  (a generation counter on the graph, or draining the SDK's pending layout
  synchronously before the flag drops); the test is the contract: applying a
  remote document diff on atlas produces zero outgoing patches.

- **Instances (added 2026-09-05, after the first live pass).** The diff used
  to answer "rebuild" for any attribute change inside a `<Component>` on a page
  with instances (F3's coarse rule), which on atlas — fifteen `Atlas` instances,
  a change inside one variant — meant the predicted render itself paid the
  full rebuild on the click. Now an attribute change on a node inside a
  component emits, besides the definition node's own `update`, one
  `update-generated` per instance that expands that component (and chose that
  variant): `applyChanges` recomputes the copy's props exactly as
  `expandInstance` does, overrides last, and writes the difference. Structural
  changes inside a component, changes to an instance's own attributes, to a
  `<Component>` or `<Variant>` node, or to a component instanced from *inside*
  another component still rebuild. Because the incremental path now owns
  same-page definition changes, it records the component index it accounted
  for, so the components watch no longer forces a second, full rebuild for the
  same save; definitions from other pages still do.

- **Layout after an incremental apply (added after the second live pass).**
  `applyChanges` used to re-run layout over every top-level entity, which on
  atlas is the whole 7k-node `doc` frame: 0.6–0.9 s per edit, on the click.
  It now lays out only what a change can have moved — each touched node's
  subtree, then one pass over each auto-layout ancestor (the SDK editor's own
  `runLayoutForNode` rule), then the entity's variant arrangement and pins.
  Measured in node on the atlas toggle: `applyChanges` 36 ms. The diff itself
  skips nodes a predicted document shares by identity with its source, so the
  click-time diff no longer resolves scene props for every node on the page.
- **The components watch compares foreign definitions only.** It runs after
  the doc watch has already drawn a same-page definition change, but a tick
  later, once the new component index has reached the pane's props — so
  comparing the whole index there read "changed" and rebuilt. Only a
  definition declared on another page can move without this page's document
  moving, so only those are compared.

Expected after all three: the client task for a one-attribute change is the
diff (about 0.3 s on atlas) plus one re-record (about 0.3 s, per the last
viewer commit), so roughly 0.6 s instead of 4.3 s, and no `toSceneGraph`. That
is still a visible stall; §4 is what takes it off the click.

### 4. Prediction: property patches apply in the same frame

`predictDocument(doc, patches): UidxDocument` in `@uidx/format` applies patches
to the parsed tree without touching source or spans:

- `set` / `add` / `remove` / `set-mode` — replace, add or delete the attribute
  on the addressed node. Spans on the result are stale and it is marked
  `predicted: true` so nothing tries to patch *against* it (patches are always
  written against `doc`).
- `insert-node` / `remove-node` / `move-node` — **not predicted in this
  iteration.** They come from the canvas, which already shows its own result,
  and from the rail's drag, which waits today and keeps waiting. The function
  returns the input unchanged for a batch containing them and the caller falls
  back to waiting, as now. Address recomputation for a moved subtree is the
  reason to defer, not any conceptual problem.

`commitPatches` in `App.vue` pushes the batch onto the in-flight list before
dispatching; `shown` is a `computed` of `doc` and that list. The
`file:changed` carrying the batch's `patchId` (§2) removes it — that message
arrives before `patch:applied`, so it is the one to key on. `patch:rejected`
and a `dropped` send remove the batch too, which is the rollback for predicted
attributes. The existing `onRollback` re-render stays for what `shown` does
not hold: a canvas gesture's own optimistic result. `patch:stale` leaves the
batch in flight while the existing rebase re-sends it; if the rebase gives up,
the batch is removed. `predictDocument` skips an address the current `doc` no
longer has — an external revision can remove a node while a `set` on it is in
flight — rather than throwing.

The canvas already handles the "document arrives, diff against what I draw"
half. Because it now watches `shown`, a predicted attribute reaches the graph
through the same `diffDocuments`/`applyChanges` path as a confirmed one, and
the confirming `file:changed` diffs to nothing for that attribute. The rail
is `layerRows(shown)`, so the eye flips in the same tick. The inspector reads
`shown` too, so a typed value does not snap back to the file's value for a
second.

Edits made while a patch is in flight carry the old `baseRevision`, come back
`patch:stale`, rebase and re-send — one server round trip each, serialised
behind the first. That is the same as today, but the author no longer sees it
because `shown` already has both edits.

### 5. Inverse patches and the undo stack

**Inverse of a batch, computed against the document it was written for:**

| Forward | Inverse |
|---|---|
| `set` (address, prop, new) | `set` with the old value |
| `add` | `remove` |
| `remove` | `add` with the old value |
| `set-mode` | `set-mode` with the old value, or its removal if it was unset |
| `insert-node` | `remove-node` at the inserted address |
| `remove-node` | `insert-node` with a `UidxNodeSpec` rebuilt from the removed node (attrs and children) |
| `move-node` | `move-node` back to the old parent and index |

`inversePatches(doc, patches): UidxPatch[]` lives in `@uidx/format`, next to
`applyPatches`, so the two are tested against each other: applying a batch and
then its inverse must yield a document that parses to the same tree. Byte
identity is not promised — an attribute removed and re-added may sit on a
different line — and `uidx fmt` is the normaliser, as it is for every other
write. `set-mode` has no removal op, so its inverse when the mode was unset is
a `set` of the whole prior `modes` object, or a `remove` of `modes` if there
was none. The inverse of an author batch is computed against **`shown`**, not
`doc`: two quick edits to one property before the first confirms must each
record the value the author actually saw, or undoing the second jumps back two
steps.

**Revisions the client did not send** need a document-level diff that yields
patches rather than scene changes: `diffToPatches(prev, next): UidxPatch[]` in
`@uidx/format`, indexing both trees by address the way `reconcile.ts` does and
emitting attribute ops per surviving node plus `insert-node` / `remove-node` /
`move-node` for structure. Its inverse is `diffToPatches(next, prev)`. This is
what makes an LLM turn, a `uidx apply`, an MCP call or a direct write
undoable without any of them knowing undo exists.

**The stack** is one list per open document in the shell, in memory, lost on
reload (acceptable now; persistence is a later story). An entry is:

```
{ label, files: Map<file, { forward: UidxPatch[]; inverse: UidxPatch[] }>, origin }
origin: 'author' | { turn: string } | 'external'
```

- An author batch pushes an entry when dispatched, with its inverse computed
  against `shown` at that moment. If the batch is later rejected or its rebase
  gives up, the entry is removed.
- A `file:changed` that carries no `patchId` this client sent pushes an entry
  with `forward = diffToPatches(doc, incoming)` and
  `inverse = diffToPatches(incoming, doc)`. A re-broadcast at an unchanged
  revision (a dependent page re-sent after a token edit, §6) is not a change
  to this page and pushes nothing. Revisions belonging to an LLM turn coalesce
  into one `{ turn }` entry (forward appended, inverse prepended); a revision
  belongs to a turn when its `doc.sourceHash` is one the harness reports having
  written for that turn — by hash, not by timing, because the panel can report
  a turn finished before the watcher's 40 ms settle delivers the last write.
  Every other revision is its own `'external'` entry. A group id carried by
  `uidx apply` and `uidx_apply` for Claude Code batches is a later, cheap
  addition; time-window coalescing is not planned.
- Only the element tree is undoable. A revision that changed prose or
  frontmatter alone diffs to no patches; it is recorded as an entry whose undo
  is a no-op and says so in its label, rather than silently skipped, so the
  author can see the history is not complete for that write.
- Undo dispatches the top entry's inverse through `commitPatches`
  (`commitAcrossPages` for a multi-file entry, open page last, as today), so it
  is predicted, written, confirmed and broadcast like any edit — a new
  revision other writers see, never a private rewind. The entry moves to the
  redo list. Redo dispatches `forward`. Any new entry clears the redo list.
- Undo does not wait for pending confirmations. If the top entry is still in
  flight, its inverse goes out with the current `baseRevision`, comes back
  stale, and rebases. If the inverse's target is gone (someone removed the node
  meanwhile), the rebase returns null and the author sees the existing stale
  banner; the entry is dropped rather than retried.
- Keyboard: ⌘/Ctrl+Z and ⇧⌘/Ctrl+Z on the shell, when focus is not in a text
  field. The canvas SDK keeps its own gesture-level history for in-progress
  edits (`useCanvasControls` commits "through the SDK's own helper so undo
  sees" them); the plan must confirm that history is not also bound to ⌘Z, or
  route it here, so one keystroke does not undo twice.

**Stated rules, Figma's:**

- Undo reverses the top entry regardless of who wrote it. This is the one
  departure from Figma, where undo touches only your own edits: here an
  external revision or an LLM turn is an entry like any other, because the
  file is shared and the entry's label says who wrote it. There is no way to
  undo your own edit underneath an external one without undoing that one
  first.
- Undoing a turn that inserted a frame removes the frame with any later edits
  inside it.
- Any new entry — including one pushed by another writer — clears the redo
  list. One shared stack has one linear history.
- A direct write that does not parse never becomes a revision, so it never
  becomes an entry: the canvas keeps the last good document under the
  diagnostics until the file parses again.

### 6. Transport stays as it is, with one known follow-up

`file:changed` keeps carrying the whole document. At 15 MB it costs the client
about 90 ms and the server 50 ms; a delta protocol would save little once §3
removes the rebuild and §4 removes the wait, and it would give up the property
that a client can always be corrected by one message.

The one place this is wrong in principle is the dependent re-broadcast: after
a token or component page changes, every page referencing it is re-sent whole
so its client re-resolves. The client already holds the new declaring page
from the first broadcast, so a one-line "re-resolve against your current
documents" message would do. With §3 in place the re-broadcast lands as a diff
that touches only the nodes whose resolved values moved, which makes it
tolerable; the message shape is the first thing to change if the socket ever
becomes what an author feels.

### 7. Order of work

1. **§2 and §3** — no new concepts, all measurable, 7 s → about 1.5 s, and
   a leaked burst can no longer wedge the server. Includes a heap check on a
   long-running server: the wedged process had reached 1.7 GB after ten hours,
   which suggests old documents or sources are retained across revisions.
2. **§4** — prediction for property patches; the rail, panel and inspector go
   instant.
3. **§5** — inverse patches, document diff to patches, the stack, keyboard.
4. Later, as separate stories: prediction for structural ops; group ids from
   the CLI and MCP; persistence of the stack; incremental re-parse on the
   server; delta transport if ever warranted.

## Out of scope

- Multi-client cursors or presence; collaborative merge beyond last writer wins
  per property, which the server already implements through revisions.
- Undo across a page reload or across two viewer tabs.
- Changing the harness's per-turn checkpoint Revert. It stays as the coarse,
  file-level escape hatch; the stack is the fine one.
- Undoing an unparseable outside write.

## Testing

- **§2** — `applyPatch` returns the parsed document; `FileSession.patchNow`
  calls `parse` zero times on the happy path (spy), once on a batch that nets no
  change, and the returned revision's `doc.source` equals the written file. An
  attribute-only batch of 400 ops on atlas parses once and produces the same
  source as the sequential path; a batch with a structural op or two ops on one
  node takes the sequential path. `file:changed` for a patch write carries the
  `patchId`; a watcher-driven one carries none.
- **§3** — `diffDocuments` on a document with `modes` resolves a token inside a
  dark subtree to the dark value; `CanvasPane.render` takes the incremental path
  for a `modes` page (`lastUpdate` reads "N change(s)", not "rebuilt"), and
  still rebuilds when a `modes` attribute itself changes. `definitionsMoved` is
  false for a save that leaves every instanced definition's text unchanged and
  true when one changes. Applying a remote diff of atlas produces zero outgoing
  patches (the reflow leak), asserted on the socket send, not on the burst
  array.
- **§4** — `predictDocument` covers each attribute op and returns its input for
  structural ops; in the shell, toggling an eye flips `layerRows(shown)` before
  any server message and `doc` is unchanged; a `patch:rejected` removes the
  prediction; a stale-then-rebased batch stays predicted throughout; the
  confirming `file:changed` produces no scene change for the predicted
  attribute.
- **§5** — for every op: apply forward then inverse, parse, compare trees.
  `diffToPatches(a, b)` applied to `a` parses to `b`'s tree, on the meridian
  pages pairwise and on a document against a copy of itself (must be empty; the
  existing `diffDocuments` is empty on identical atlas with the real resolver
  — the 55 changes seen in one probe were an artefact of an identity alias
  resolver, not a defect). Stack behaviour: author entry pushed on dispatch and
  removed on rejection; external revision pushes one entry; revisions during a
  running turn coalesce; undo dispatches the inverse and moves the entry to
  redo; a new entry clears redo; undo of an in-flight entry goes stale, rebases
  and lands.
- **Live** — the atlas eye toggle: rail and canvas change within one frame of
  the click; the file lands and the canvas does not flicker; ⌘Z restores the
  attribute and the file follows; an LLM turn in the chat panel that edits ten
  nodes is one ⌘Z.
