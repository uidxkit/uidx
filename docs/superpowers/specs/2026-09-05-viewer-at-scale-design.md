# A viewer that scales: work proportional to the edit

**Goal:** Editing a 60k-line page — from the rail, the inspector, the canvas,
an LLM turn, `uidx apply`, or an outside editor — costs work proportional to
the edit, not the page: the file stays the single truth, the server stays the
ordering authority, every writer speaks patches, and the picture re-records
only the chunk that changed.

**Approved:** 2026-09-05, in chat ("implement all according to how you see the
plan"), after the instant-edits story landed and the atlas toggle was measured
end to end with the canvas ready.

## Current state (after the instant-edits story)

Atlas: 63,397 lines, 7,141 nodes, 11.5k scene nodes. Globe: 82,823 lines.

| Stage | Cost | Proportional to |
|---|---|---|
| Server parse per patch | 1.0 s | the file |
| `file:changed` on the wire | 15 MB per revision, plus dependents re-sent whole | the file |
| Client diff on a confirmed revision | 0.3 s (fresh parse shares no nodes) | the page |
| Re-record of the scene picture | 0.2–0.4 s | the page |
| LLM write | the harness writes the file; watcher re-parses it: 1 s | the file |
| Prediction, layout after apply | 36 ms | the edit |

The renderer (open-pencil 0.14, npm, already carried with a pnpm patch) records
one display list for the whole page, keyed by `sceneVersion`; its subtree
picture cache is also keyed by `sceneVersion`, so any change discards it whole.

## Design

### 1. Format: incremental re-parse by element

`applyPatchesIncremental(doc, patches): { doc, changed: string[] }` in
`@uidx/format`:

1. Splice the text with `applyPatches(..., { validate: false })`, which returns
   the new source and the changed range in the old source.
2. Find the deepest node whose span contains the changed range. Step up to the
   parent while the parent is a `Component`, `Variant`, `Instance`, `Slot`,
   `Variable` or `Collection`, because those elements carry shape checks over
   their children (variant arity and coverage, slot names, mode coverage).
3. Re-lower that element alone: take its new text from the start of its line
   to its new end, wrap it as the only child of a synthetic `<Page>`, parse the
   fragment, and run the `Lowerer` on the child with the context the real tree
   gives it — parent address and element, the enclosing component's variant
   axes, the enclosing collection's modes, whether it sits in a slot fill or a
   component, whether the parent flows. Shift every offset in the result by
   the fragment's position in the file.
4. Replace the node in its parent, check the parent's sibling names are still
   unique, and shift every offset after the element by the text delta —
   ancestors extend, later siblings and everything below them move.
5. Recompute `sourceHash`. Assert the offset invariant in development.

Fallback to a full `parse` when: the change touches the root or the region
outside the tree (frontmatter, prose), the fragment does not lower cleanly, the
element cannot be located, or a shape check fails. The fallback is the
correctness floor; the fast path is an optimisation over identical results,
and a test compares the two trees on every op kind.

### 2. Server and wire: deltas

- `FileSession.patchNow` uses `applyPatchesIncremental`. The validating full
  parse goes: a document that lowers cleanly at the element and passes the
  parent's sibling check is valid, and the same invariants the full parse
  enforced are the ones the fragment lowering enforces.
- `file:changed` gains `patches?: UidxPatch[]`, `sourceHash: string` and
  `base?: number` (the revision the patches apply to). When a client holds
  `base`, `doc` is omitted. A watcher reload (outside write) broadcasts
  `patches = diffToPatches(previous, next)` against the previous revision when
  the previous document parsed, else the full document. Prose-only changes
  produce an empty patch list with a new hash, and the client requests the
  document.
- Clients apply the delta with `applyPatchesIncremental`, compare
  `sourceHash`, and on any mismatch or missing base send `page:request { file }`,
  which the server answers with a full `file:changed`. Connect still sends full
  documents, tokens pages first, entry page next.
- The dependents re-broadcast becomes `page:reresolve { file }`: the client
  already holds the new declaring page, so it re-renders the dependent from
  what it has.
- Prediction uses the same `applyPatchesIncremental` on `doc`, which makes
  structural ops predictable too; `predictDocument` remains for `inversePatches`.

### 3. Writers speak patches to the session

- `POST /__uidx/patch` on the viewer server: `{ file, patches, baseRevision? }`.
  Without `baseRevision` the patches apply to the session's head. The reply is
  `{ revision, sourceHash }` or `{ error }` with the patcher's sentence.
- The harness's `applyOps` compiles its ops as today, then — when a viewer
  server is discovered through `.uidx-server.json` and answers — posts the
  patches instead of writing the file. The server writes the file once, no
  watcher round trip, and the viewer gets a delta. Without a server the harness
  writes the file exactly as before. Checkpoints are captured either way.
- The CLI's `uidx apply` takes the same route through the same function.

### 4. Renderer: chunked pictures with dirty tracking

A pnpm patch on `@open-pencil/core`'s renderer, on top of the existing one:

- The single scene picture becomes a list of chunk pictures. A chunk is a page
  child, or — when a page child has more than `CHUNK_LIMIT` (512) descendants —
  each of its children in turn, recursively. Each chunk picture is keyed by
  the chunk's own dirty state, not by `sceneVersion`.
- `renderer.markDirty(nodeId)` marks the chunk containing the node. The viewer
  calls it from `watchGraph` for every `node:updated` and `node:previewUpdated`,
  and from `applyChanges` for every touched id, so every mutation path is
  covered. A `sceneVersion` change with no dirty chunk re-records everything —
  the safe default for a change the viewer failed to report.
- Chunk pictures outside the viewport are skipped when drawing; recording is
  per dirty chunk only. Expected: the atlas toggle re-records one section
  (about 1/12 of `doc`) rather than the page.

### 5. Deferred, with reasons

- **Layout and measurement in a worker.** Worth doing once 1–4 have shrunk the
  work; today's remaining click-time cost after 1–4 is the chunk record, tens
  of milliseconds, and a worker would add a copy of the graph to keep in sync.
- **Pages on demand.** Connect already sends the entry page second; the
  client's indexes need declaring pages, and the refactor engine needs every
  page for a correct blast radius. Measure first in a visible tab; the honest
  expectation is that opening is dominated by the entry page's own build.

## Order of work

1. §1 format incremental re-parse, tested against the full parse.
2. §2 server deltas and client application; `page:request`; `page:reresolve`.
3. §3 the patch route and the harness/CLI using it.
4. §4 the renderer patch.
5. Live measurement on atlas and globe with the pane visible; record.

## Testing

- §1: for every op kind and for the atlas file, `applyPatchesIncremental`
  yields a tree equal in shape and offsets to `parse(applyPatches(...).source)`;
  the offset invariant holds; a fragment that would break shape (duplicate
  sibling, variant arity) falls back and reports the same diagnostic the full
  parse does; timing on atlas under 50 ms for an attribute op.
- §2: session broadcasts `patches` with `base` and `sourceHash`; a client with
  the base applies and matches the hash; a client without it requests and
  receives the document; an outside write broadcasts a diff-derived delta;
  prose-only produces an empty delta and a request.
- §3: the route applies and answers revision and hash; the harness posts when a
  server answers and writes the file when none does; the turn's `written`
  hashes match the server's.
- §4: a unit test against the patched renderer is not practical in jsdom;
  verified live with the profiler stats (`scenePictureMode`, record time) and
  the atlas toggle.
