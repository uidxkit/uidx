import { stat } from 'node:fs/promises'
import { applyPatches, parse, type UidxDocument, type UidxPatch } from '@uidx/format'
import type { PostPatchesResult } from '../core/viewer.js'

import type { Workspace } from '../workspace/workspace.js'
import type { CheckpointStore } from './checkpoint.js'
import { compileOps } from './compile.js'
import { assertWritable, resolveInside } from './jail.js'
import type { EditOp } from './ops.js'

export interface ApplyContext {
  workspace: Workspace
  checkpoints: CheckpointStore
  /** The manifest's `files` globs. */
  globs: readonly string[]
  turnId: string
  /**
   * Called after each successful write with the written document's hash, so a
   * turn can say which revisions were its own (spec §5, turn attribution).
   */
  onWrite?(file: string, sourceHash: string): void
  /**
   * Hands the compiled patches to a running viewer's session instead of
   * writing the file (viewer-at-scale spec §3). Absent, or answering that no
   * viewer is open, the file is written here as before.
   */
  post?(file: string, patches: readonly UidxPatch[]): Promise<PostPatchesResult>
}

export type ApplyOutcome =
  { ok: true; file: string; changed: number } | { ok: false; file: string; error: string }

const PAGE_SKELETON = (id: string): string =>
  `---\nid: ${id}\n---\n\n## Core Intent\n\nDescribe what this page is for.\n\n## Visual Contract\n\n<Page>\n</Page>\n`

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * Nothing reaches disk that does not parse. `compileOps` resolves a defaulted
 * `insert_node` index against the one document snapshot it is handed — for a
 * batch of more than one op, compiling the whole thing up front would size
 * that default off a stale sibling list whenever an earlier op in the same
 * batch touched the same parent (see the doc comment on `compileOps`).
 *
 * So this compiles and applies one op at a time: each op is compiled against
 * the document produced by the previous op, then applied, then the resulting
 * source is re-parsed to build the document the *next* op compiles against.
 * `applyPatches` requires its `document` option to match the `source` it is
 * given exactly, so the source and the parsed document are advanced together
 * on every iteration.
 *
 * Everything happens in memory — the workspace is never written to mid-batch.
 * If any op throws, the whole call fails and returns the refusal outcome
 * without writing a partially applied batch to disk.
 */
export async function applyOps(
  ctx: ApplyContext,
  file: string,
  ops: readonly EditOp[],
): Promise<ApplyOutcome> {
  try {
    assertWritable(ctx.workspace.root, ctx.globs, file)

    const initial = ctx.workspace.docOf(file)
    if (!initial) {
      return { ok: false, file, error: `${file}: not a parsed page in this document` }
    }

    const originalSource = initial.source
    let source = originalSource
    let doc: UidxDocument = initial
    let changed = 0
    const compiled: UidxPatch[] = []

    for (const op of ops) {
      const patches = compileOps(doc, [op])
      const patch = patches[0]
      if (patches.length !== 1 || !patch) {
        // compileOps emits exactly one patch per op today; a mismatch here is
        // a bug in the compiler, not something a model-supplied op can trigger.
        throw new Error(
          `internal error: compiling op "${op.kind}" produced ${patches.length} patches, expected 1`,
        )
      }

      const result = applyPatches(source, [patch], { document: doc })
      if (result.source === source) continue
      compiled.push(patch)

      source = result.source
      // The validating parse is handed back; a missing one means validation was
      // off, which this call never asks for — so it is the same refusal a
      // failed re-parse used to be.
      if (!result.document) {
        throw new Error(`${file}: op "${op.kind}" produced a document that failed to re-parse`)
      }
      doc = result.document
      changed++
    }

    if (source === originalSource) return { ok: true, file, changed: 0 }

    await ctx.checkpoints.capture(ctx.turnId, file)
    // Through the viewer's session when one is open: it writes the file once
    // and the canvas gets a delta. The local apply above already proved the
    // ops compile and the result parses, so a refusal here is a race — the
    // file moved under us — and is reported as one.
    const posted = ctx.post ? await ctx.post(file, compiled) : null
    if (posted?.posted) {
      if (posted.sourceHash === doc.sourceHash && ctx.workspace.adopt) {
        ctx.workspace.adopt(file, source, doc)
      } else {
        await ctx.workspace.reload(file)
      }
      ctx.onWrite?.(file, posted.sourceHash)
      return { ok: true, file, changed }
    }
    if (posted && posted.reason !== 'no-viewer') {
      return { ok: false, file, error: `${file}: the viewer refused the edit — ${posted.message}` }
    }
    await ctx.workspace.writeFile(file, source, doc)
    ctx.onWrite?.(file, doc.sourceHash)
    return { ok: true, file, changed }
  } catch (error) {
    return { ok: false, file, error: message(error) }
  }
}

/**
 * Replaces a page's Markdown intent — everything between the frontmatter and
 * `## Visual Contract`.
 *
 * A `.uidx` file is prose *and* a tree, and until this existed the harness
 * could only write the tree. Three of the shipped documentation checklist's
 * seventeen requirements are prose sections, so they were unreachable: asked
 * for them, Claude Sonnet spent three turns probing for a way in, writing
 * `<Page coreIntent="test-value-check" intent="TEST-INTENT-CHANGE">` and
 * getting "applied" each time, because a capability that does not exist
 * cannot refuse.
 *
 * Spliced into the source rather than expressed as a patch: `UidxPatch` is
 * node-oriented — set, remove, insert-node, move-node, remove-node, retag —
 * and there is no op for the prose half of the format. The splice re-parses
 * before it writes, so a body that would break the file is refused rather
 * than saved, which is the same guarantee `applyOps` gives.
 */
export async function setIntent(
  ctx: ApplyContext,
  file: string,
  body: string,
): Promise<ApplyOutcome> {
  try {
    assertWritable(ctx.workspace.root, ctx.globs, file)

    const doc = ctx.workspace.docOf(file)
    if (!doc) return { ok: false, file, error: `${file}: not a parsed page in this document` }

    const { start, end } = doc.intent.loc
    // Exactly one blank line each side: the intent sits between the
    // frontmatter above and `## Visual Contract` below, and a missing
    // separator there changes which Markdown block the heading belongs to.
    const source = `${doc.source.slice(0, start)}\n${body.trim()}\n\n${doc.source.slice(end)}`
    if (source === doc.source) return { ok: true, file, changed: 0 }

    const reparsed = parse(source)
    if (!reparsed.doc) {
      const why = reparsed.diagnostics.map((d) => d.message).join('; ')
      return { ok: false, file, error: `that intent would not parse — ${why}` }
    }

    await ctx.checkpoints.capture(ctx.turnId, file)
    await ctx.workspace.writeFile(file, source)
    return { ok: true, file, changed: 1 }
  } catch (error) {
    return { ok: false, file, error: message(error) }
  }
}

/** Whether something already occupies this path on disk. */
async function occupied(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    // A path we cannot even stat is not one to write blind over.
    throw error
  }
}

export async function createFile(
  ctx: ApplyContext,
  file: string,
  pageId: string,
): Promise<ApplyOutcome> {
  try {
    assertWritable(ctx.workspace.root, ctx.globs, file)
    // Asked of the filesystem, not of the member index. The index is a cache
    // fed by a watcher, and a page the designer created a moment ago is not in
    // it yet — a `create_file` for that page passed this guard and destroyed
    // their work while reporting success. Disk is the authority on what exists,
    // and it cannot be stale.
    if (await occupied(resolveInside(ctx.workspace.root, file))) {
      return { ok: false, file, error: `${file}: already exists — edit it instead` }
    }
    await ctx.checkpoints.capture(ctx.turnId, file)
    await ctx.workspace.writeFile(file, PAGE_SKELETON(pageId))
    return { ok: true, file, changed: 1 }
  } catch (error) {
    return { ok: false, file, error: message(error) }
  }
}

export async function deleteFile(ctx: ApplyContext, file: string): Promise<ApplyOutcome> {
  try {
    assertWritable(ctx.workspace.root, ctx.globs, file)
    if (!ctx.workspace.members().includes(file)) {
      return { ok: false, file, error: `${file}: no such page` }
    }
    await ctx.checkpoints.capture(ctx.turnId, file)
    await ctx.workspace.removeFile(file)
    return { ok: true, file, changed: 1 }
  } catch (error) {
    return { ok: false, file, error: message(error) }
  }
}
