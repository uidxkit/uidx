import { resolve } from 'node:path'
import { resolveDocumentRoot } from '../workspace/root.js'
export { resolveDocumentRoot } from '../workspace/root.js'
import type { UidxDocument } from '@uidx/format'

import { badAliases, type BadAlias } from '../edit/alias-types.js'
import { applyOps, createFile, setIntent, type ApplyContext } from '../edit/apply.js'
import { createCheckpointStore } from '../edit/checkpoint.js'
import { postPatches } from './viewer.js'
import { drawsNothing } from '../edit/draws-nothing.js'
import { missingGlyphs, type MissingGlyphs } from '../edit/missing-glyphs.js'
import { narrowOps, type EditOp } from '../edit/ops.js'
import { overflows, type Overflow } from '../edit/overflow.js'
import { overlaps } from '../edit/overlaps.js'
import { fixedWithoutSize, type SizingContradiction } from '../edit/sizing.js'
import { renderToPng, RenderError } from '../render.js'
import { refuseBadOps } from '../tools/edit.js'
import { createArchitectureStore, type ArchitectureStore } from '../plan/architecture.js'
import { renderDesignSection, spliceDesignSection } from '../plan/design-md.js'
import { buildIndex as buildIndexImpl } from '../index/build.js'
import { budgetFor } from '../index/budget.js'
import { readTools } from '../tools/read.js'
import { discoverManifests, type FoundDoc } from '../workspace/discover.js'
import { openWorkspace, type Workspace } from '../workspace/workspace.js'

/**
 * The one implementation behind every surface.
 *
 * Three things can drive a uidx document — the harness's own agent loop, a
 * CLI in Claude Code's hands, and an MCP server for a session that is not on
 * this machine — and they must not become three implementations. The measured
 * reason is this project's whole history: twelve silent-failure classes were
 * found one expensive run at a time, and each fix lives in exactly one module
 * below. A surface that re-implemented any of it would drift back to lying.
 * So the harness tools, the CLI commands and the MCP tools all call what this
 * file names, and an audit fixed once is fixed everywhere.
 */
export interface OpenedDocument {
  found: FoundDoc
  workspace: Workspace
  architectures: ArchitectureStore
  /** Everything a write needs — jail, checkpoints, globs — already assembled. */
  apply: ApplyContext
  close(): Promise<void>
}

/** Opens the document rooted at `root` (the directory holding `uidx.json`). */
export async function openDocument(root: string): Promise<OpenedDocument> {
  const dir = await resolveDocumentRoot(root)
  // Compared in one spelling: the discovered `dir` and the resolved root can
  // differ only in separator on Windows, and that is not a different document.
  const found = (await discoverManifests([dir])).find((doc) => resolve(doc.dir) === resolve(dir))
  if (!found) throw new Error(`no uidx.json under ${root}`)
  const workspace = await openWorkspace(found)
  return {
    found,
    workspace,
    architectures: createArchitectureStore(found.dir),
    apply: {
      workspace,
      checkpoints: createCheckpointStore(found.dir),
      globs: found.globs,
      turnId: crypto.randomUUID(),
      post: (file, patches) => postPatches(found.dir, file, patches),
    },
    close: () => workspace.close(),
  }
}

/** Every fault the audits can name about one page, as data rather than prose. */
export interface AuditReport {
  file: string
  blank: string[]
  stacked: [string, string][]
  overflowing: Overflow[]
  misbound: BadAlias[]
  contradicted: SizingContradiction[]
  unglyphed: MissingGlyphs[]
  /** Whether the page actually drew — the one check no prediction can fake. Absent when rendering was skipped. */
  renders?: boolean
  renderError?: string
  /** Every list above, flattened to sentences — what a surface prints. */
  faults: string[]
}

export interface AuditOptions {
  /** Rendering boots CanvasKit (~seconds); skip it for a fast pre-check. */
  render?: boolean
}

/** Runs every audit this harness has against one page. */
export async function auditAll(
  docs: ReadonlyMap<string, UidxDocument>,
  file: string,
  options: AuditOptions = {},
): Promise<AuditReport> {
  const page = docs.get(file)
  if (!page) {
    return {
      file,
      blank: [],
      stacked: [],
      overflowing: [],
      misbound: [],
      contradicted: [],
      unglyphed: [],
      faults: [`no such page: ${file}`],
    }
  }
  const all = [...docs.values()]
  const report: AuditReport = {
    file,
    blank: drawsNothing(page),
    stacked: overlaps(page),
    overflowing: overflows(page),
    misbound: badAliases(all, page),
    contradicted: fixedWithoutSize(page),
    unglyphed: await missingGlyphs(page),
    faults: [],
  }
  if (options.render !== false) {
    try {
      await renderToPng({ docs, file, scale: 0.2 })
      report.renders = true
    } catch (error) {
      report.renders = false
      report.renderError =
        error instanceof RenderError ? error.message : `render failed: ${String(error)}`
    }
  }
  report.faults = [
    ...report.blank.map((a) => `${a} draws nothing`),
    ...report.stacked.map(
      ([a, b]) => `${a} and ${b} have no position, so they draw from the same spot`,
    ),
    ...report.overflowing.map(
      (o) => `${o.address} is ${o.width} wide inside ${o.inner} — overflows its parent`,
    ),
    ...report.misbound.map(
      (b) => `${b.address} binds ${b.target} into ${b.prop} (${JSON.stringify(b.got)} is not text)`,
    ),
    ...report.contradicted.map(
      (c) => `${c.address} says ${c.axis}="FIXED" but has no ${c.dimension} — the layout collapses`,
    ),
    ...report.unglyphed.map(
      (m) =>
        `${m.address} uses ${m.chars.join(' ')} — no glyph in the bundled fonts, draws as nothing`,
    ),
    ...(report.renders === false ? [`the page does not render: ${report.renderError}`] : []),
  ]
  return report
}

/**
 * The query surface, for an agent that must understand a long page without
 * swallowing it.
 *
 * A component page runs to ~150k characters; an agent that can only `read`
 * whole files spends its window on one look. The harness's own model never
 * does that — it reads one node's exact source by address, or a subtree's
 * *outline* (shape without bodies), or a one-line *signature*, and it
 * searches by text getting back addresses rather than files. Those are the
 * very tools re-used here — not re-implementations of them — so an external
 * agent sees the same slices, the same budget refusals, and the same words
 * the harness's model sees.
 */
export function queryDocument(opened: OpenedDocument, windowTokens = 32_000) {
  const { read, search } = readTools({
    workspace: opened.workspace,
    budget: budgetFor(windowTokens),
  })
  const call = (tool: { execute?: unknown }, input: unknown): Promise<string> =>
    (tool.execute as (i: unknown, o: unknown) => Promise<string>)(input, {
      toolCallId: 'query',
      messages: [],
    })
  return {
    /** One node's exact source by address, a subtree outline, or a signature — never a whole file by accident. */
    read: (input: { file: string; address?: string; mode?: 'source' | 'outline' | 'signature' }) =>
      call(read, input),
    /** Text search across every page; addresses come back, not files. */
    search: (input: { query: string; regex?: boolean; limit?: number }) => call(search, input),
  }
}

/**
 * The gated write: narrow → refuse (prop names, enum values, instances of
 * nothing) → apply → audit. The harness's edit tool has always written this
 * way; every other surface goes through here so it cannot forget to.
 */
export async function applyGated(
  opened: OpenedDocument,
  file: string,
  raw: unknown,
): Promise<{ ok: boolean; message: string }> {
  const narrowed = narrowOps(raw as never)
  if (!narrowed.ok) return { ok: false, message: `not applied — ${narrowed.message}` }
  const index = buildIndexOf(opened)
  const refusal = refuseBadOps(narrowed.value, index)
  if (refusal) return { ok: false, message: `not applied — ${refusal}` }
  const result = await applyOps(opened.apply, file, narrowed.value)
  if (!result.ok) return { ok: false, message: `not applied — ${result.error}` }
  const report = await auditAll(opened.workspace.docs(), file, { render: false })
  const audit = report.faults.length > 0 ? `\n${report.faults.map((f) => `- ${f}`).join('\n')}` : ''
  return { ok: true, message: `applied ${result.changed} change(s) to ${file}${audit}` }
}

function buildIndexOf(opened: OpenedDocument) {
  return buildIndexImpl(opened.found.id, opened.workspace.docs())
}

// The write path, the render, the architecture and the design.md — the same
// functions the harness tools call, re-exported under the facade so a surface
// imports one module and cannot half-adopt it.
export { applyOps, createFile, setIntent, narrowOps, renderToPng, RenderError }
export type { EditOp, ApplyContext }
export { createArchitectureStore, renderDesignSection, spliceDesignSection }
export type { Architecture, ArchitectureStore } from '../plan/architecture.js'
export { gateArchitecture } from '../tools/architect.js'
export { refuseBadOps }
export { buildIndex } from '../index/build.js'
export { viewerSelection } from './viewer.js'
export type { ViewerSelection, ViewerSelectionResult } from './viewer.js'

export { readProjectConfig, validatePort } from '../workspace/config.js'
