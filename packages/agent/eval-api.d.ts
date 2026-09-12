/**
 * The uidx eval API — everything a script passed to `uidx eval` / `uidx_eval`
 * can reach. This file is the contract: read it before writing a script.
 *
 * It sits at the package root, outside compilation, on purpose: these are the
 * *sandbox's* globals, not this package's, and `test/eval-api.test.ts` keeps
 * it honest against the real sandbox in `src/core/eval.ts`.
 *
 * ## Semantics — the four rules
 *
 * 1. **Reads are a snapshot.** `doc()` sees the document as of script start;
 *    queued ops apply AFTER the script ends. A script cannot read its own
 *    writes — chain two evals for read-modify-read.
 * 2. **Writes are queued, then gated.** `ops(file)` builds a batch per file;
 *    each batch runs through the same path as every other surface — unknown
 *    props refused with a did-you-mean, enum values checked
 *    (`layoutMode: 'vertical'` is refused, it is `'VERTICAL'`), instances of
 *    undefined components refused (components the batch itself defines count
 *    as known), then applied atomically with audits appended. One bad op
 *    refuses the whole file's batch; nothing half-lands.
 * 3. **The script is one synchronous function body.** `return` a value and it
 *    comes back as JSON. 2s timeout; no `eval`/`new Function`; no imports, no
 *    filesystem, no network — the five globals below are the whole world.
 * 4. **Compose big structures in memory.** A `<Component>` inserted with all
 *    its `<Variant>` children in ONE `insert` can never hit the
 *    shell-without-variants refusal (UIDX121). Prefer generating structure in
 *    loops over emitting it piecemeal.
 * 5. **Work step by step: one section per script.** Keep each script mid-size
 *    — build one section, read the `applied` message (audits ride on it) and
 *    run the audit tool for the full gate with a real render, then write the
 *    next script. The next eval's snapshot includes everything the last one
 *    applied, so chaining is the natural shape; a giant everything-script
 *    just makes its one refusal expensive.
 *
 * Prop vocabulary (what `attrs` may hold) is the uidx dialect — see
 * `.uidx-agent/skills/uidx-authoring/SKILL.md`. Values may bind tokens as
 * `"{collection#name}"` — but never into `characters`.
 */

/** One node, as plain data. No methods, no live handles — mutate through `ops`. */
interface NodeView {
  /** Page | Frame | Text | Rectangle | Ellipse | Vector | Instance | Component | Variant | Slot | Tokens | Collection | Variable */
  element: string
  name: string | null
  /** The node's address — the handle every op takes. `#` bounds an entity, `/` walks deeper. */
  address: string
  /** Authored values only (numbers, strings, arrays, objects) — defaults are not filled in. */
  attrs: Record<string, unknown>
  children: NodeView[]
}

/** The whole page as plain data. Throws if no such page. */
declare function doc(file: string): NodeView

/** Every page of the document, by file name (tokens documents included). */
declare function pages(): string[]

/** Depth-first walk over a view. */
declare function visit(node: NodeView, fn: (node: NodeView) => void): void

/** Every node under `node` (itself included) matching the predicate. */
declare function find(node: NodeView, predicate: (node: NodeView) => boolean): NodeView[]

/**
 * The op builder for one file. Calls queue ops; nothing touches the file
 * until the script ends and the batch passes the gates.
 */
declare function ops(file: string): {
  /** Set one prop on the node at `address`. */
  set(address: string, prop: string, value: unknown): void
  /** Remove one prop from the node at `address`. */
  removeProp(address: string, prop: string): void
  /**
   * Insert a node tree under `parent` (`''` or `'/'` is the page root).
   * `node` is `{ element, attrs?, children? }`, nested to any depth — compose
   * whole components here.
   */
  insert(parent: string, node: unknown, index?: number): void
  /** Remove the node at `address`, subtree and all. */
  remove(address: string): void
  /** Move the node at `address` under `newParent` at `index`. */
  move(address: string, newParent: string, index: number): void
  /** Rename the node at `address` (its address changes with it). */
  rename(address: string, name: string): void
}

/** Captured and returned in the outcome's `logs` (capped at 200 lines). */
declare namespace console {
  function log(...parts: unknown[]): void
}
