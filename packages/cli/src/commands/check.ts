import { readFile, stat } from 'node:fs/promises'
import { dirname, relative, resolve as resolvePath } from 'node:path'
import { glob } from 'tinyglobby'
import {
  assetRefs,
  CODES,
  diagnostic,
  formatDiagnostic,
  METADATA_ATTRS,
  parse,
  resolve as resolveNode,
  TOKEN_ELEMENTS,
  positionAt,
  type Diagnostic,
  type UidxDocument,
  type UidxNode,
} from '@uidx/format'
import { isKnownProp } from '@uidx/schema/known-props'
import {
  assetProblem,
  documentAssets,
  documentMembers,
  findManifest,
  MANIFEST_NAME,
} from '@uidx/server/document'
import {
  buildSymbolTable,
  WORKSPACE_CODES,
  type PageSource,
  type SymbolTable,
} from '@uidx/server/symbols'

/**
 * Kept for compatibility; the table of workspace-scoped codes now lives in
 * `symbols.ts`, which is also why the format package's `CODES` skips UIDX010.
 */
export const DUPLICATE_ID = WORKSPACE_CODES.DUPLICATE_PAGE_ID

export interface CheckOptions {
  cwd?: string
  /** Text is human/editor friendly; json is for tooling. */
  format?: 'text' | 'json'
}

export interface FileReport {
  file: string
  diagnostics: Diagnostic[]
}

export interface CheckResult {
  files: FileReport[]
  errors: number
  warnings: number
  /** Every globally-named symbol the checked pages declare (G4). */
  symbols: SymbolTable
  /** Process exit code: 1 when any diagnostic is an error. */
  exitCode: number
}

/**
 * Parses and validates every matching `.uidx` file (spec §8).
 *
 * Pure with respect to the process: it reads files and returns a report, but
 * never prints or exits. `render` and the CLI wrapper own that, which keeps this
 * testable without capturing stdout.
 */
export async function check(patterns: string[], options: CheckOptions = {}): Promise<CheckResult> {
  const cwd = options.cwd ?? process.cwd()
  // With no explicit target the document is the unit (ADR 0004 §1, story G3);
  // an explicit glob still wins, so CI can gate a subset.
  const files = patterns.length ? await expand(patterns, cwd) : await documentOrCwd(cwd)

  if (files.length === 0) {
    throw new NoMatchesError(patterns.length ? patterns : [MANIFEST_NAME])
  }

  const reports: FileReport[] = []
  const parsed: PageSource[] = []

  for (const file of files) {
    const source = await readFile(resolvePath(cwd, file), 'utf8')
    const { doc, diagnostics } = parse(source)
    const all = [...diagnostics]

    if (doc) {
      all.push(...lintUnknownProps(doc))
      parsed.push({ file, doc })
    }

    reports.push({ file, diagnostics: all })
  }

  // An image reference is a claim about the filesystem, and CI is where a
  // broken one should surface — not the viewer, and not a designer's eye three
  // weeks later (ADR 0006 §4). Only checkable here for the same reason
  // uniqueness is: the parser sees one page and knows nothing about the disk.
  for (const found of await checkAssets(parsed, cwd)) {
    const { file, ...rest } = found
    reports.find((report) => report.file === file)?.diagnostics.push(rest)
  }

  // Uniqueness is a document-wide property, so it can only be checked here —
  // the parser sees one page at a time and has no way to know about the others
  // (ADR 0004 §2, story G4).
  const { table, diagnostics: workspace } = buildSymbolTable(parsed)
  const byFile = new Map(reports.map((report) => [report.file, report]))
  for (const diagnostic of workspace) {
    const { file, ...rest } = diagnostic
    byFile.get(file)?.diagnostics.push(rest)
  }

  let errors = 0
  let warnings = 0
  for (const report of reports) {
    for (const d of report.diagnostics) {
      if (d.severity === 'error') errors++
      else warnings++
    }
  }

  return { files: reports, errors, warnings, symbols: table, exitCode: errors > 0 ? 1 : 0 }
}

/**
 * §3.3: a property outside the table is a lint *warning*, not an error — it is
 * still passed through to the scene graph, so the format is allowed to lead the
 * tool. Warnings do not fail the build.
 *
 * This lives in the CLI rather than the parser because `@uidx/format` has no
 * dependency on `@uidx/schema`, and keeping it that way is what lets agents and
 * CI use the parser without pulling in a WASM renderer.
 */
function lintUnknownProps(doc: UidxDocument): Diagnostic[] {
  const out: Diagnostic[] = []
  const walk = (node: UidxNode): void => {
    // The token tree declares variables rather than scene nodes, so the scene
    // vocabulary has nothing to say about its attributes (G5). A `<Variant>` is
    // the same carve-out one tree over (ADR 0005 §2): its attributes are the
    // coordinates that *name* it, and an axis assignment is no more an unknown
    // scene property than `value` on a `<Variable>` is. The parser checks them
    // against the component's declaration, which is a stricter question than
    // this lint could ask.
    if (TOKEN_ELEMENTS.has(node.element) || node.element === 'Variant') {
      node.children.forEach(walk)
      return
    }
    for (const [name, attr] of Object.entries(node.attrs)) {
      if (isKnownProp(name)) continue
      // Metadata is known to the format but is not a scene property, so it is
      // absent from KNOWN_PROPS by design (ADR 0003 §3).
      if (METADATA_ATTRS.has(name)) continue
      const { line, column } = positionAt(doc.source, attr.loc.start)
      out.push({
        code: CODES.UNKNOWN_PROP,
        message: `unknown property "${name}" on <${node.element}>; passed through unmapped`,
        severity: 'warning',
        loc: attr.loc,
        line,
        column,
      })
    }
    node.children.forEach(walk)
  }
  walk(doc.tree)
  return out
}

export class NoMatchesError extends Error {
  constructor(readonly patterns: string[]) {
    super(`no .uidx files matched ${patterns.map((p) => JSON.stringify(p)).join(', ')}`)
    this.name = 'NoMatchesError'
  }
}

/**
 * Every image reference that cannot be drawn, as diagnostics.
 *
 * Three outcomes, because they need three different fixes: the path is
 * malformed, the file is missing, or the file is there but the manifest never
 * declared its folder. Silent when there is no manifest — `check` deliberately
 * works on a loose file, and there is nothing to resolve a `src` against then.
 */
async function checkAssets(
  pages: PageSource[],
  cwd: string,
): Promise<(Diagnostic & { file: string })[]> {
  const refs = pages.flatMap((page) =>
    assetRefs(page.doc).map((ref) => ({ ...ref, file: page.file, doc: page.doc })),
  )
  if (refs.length === 0) return []

  /*
   * The manifest is found from each *page*, not from `cwd`.
   *
   * A `src` is relative to the manifest above the file that names it (ADR 0006
   * §2), and `uidx check <dir>` runs from wherever the terminal happens to be —
   * so resolving against `cwd` reports every image in another document as
   * missing. Found live, on a scratch document checked from this repo's root.
   * Cached per directory because a run is usually one document.
   */
  const manifests = new Map<string, Awaited<ReturnType<typeof findManifest>>>()
  const manifestFor = async (file: string) => {
    const dir = dirname(resolvePath(cwd, file))
    if (!manifests.has(dir)) manifests.set(dir, await findManifest(dir))
    return manifests.get(dir) ?? null
  }
  const declaredBy = new Map<string, ReadonlySet<string>>()

  const out: (Diagnostic & { file: string })[] = []
  for (const ref of refs) {
    const manifest = await manifestFor(ref.file)
    if (!manifest) continue
    if (!declaredBy.has(manifest.dir)) {
      declaredBy.set(manifest.dir, await documentAssets(manifest))
    }
    const problem = await assetProblem(manifest, declaredBy.get(manifest.dir)!, ref.src)
    if (!problem) continue
    // Pointed at the attribute carrying the reference, so the message lands on
    // the line an author would go and edit rather than on the node's first one.
    const attr = resolveNode(ref.doc.tree, ref.address)?.attrs[ref.prop]
    out.push({
      file: ref.file,
      ...diagnostic(
        ref.doc.source,
        CODES[problem.code],
        `${ref.address || '<page>'}: ${problem.message}`,
        attr?.loc ?? { start: 0, end: 0 },
      ),
    })
  }
  return out
}

/**
 * The document's members when there is a manifest, everything under `cwd` when
 * there is not. Falling back rather than failing keeps `uidx check` usable on a
 * loose file — it is a linter, and refusing to lint until a manifest exists
 * would be the wrong trade. `open` makes the opposite call, because *resolving*
 * a global name genuinely cannot be faked.
 */
async function documentOrCwd(cwd: string): Promise<string[]> {
  const found = await findManifest(cwd)
  if (!found) return expand(['.'], cwd)
  const members = await documentMembers(found)
  // Members are relative to the workspace root, which may sit above `cwd`.
  return members.map((file) => relative(cwd, resolvePath(found.dir, file)) || file)
}

/**
 * Accepts globs, directories and plain paths. A bare directory is expanded to
 * every `.uidx` beneath it so `uidx check .` does the obvious thing.
 */
async function expand(patterns: string[], cwd: string): Promise<string[]> {
  const globs = await Promise.all(
    patterns.map(async (pattern) => {
      if (pattern.includes('*')) return pattern
      const directory = await stat(resolvePath(cwd, pattern)).then(
        (info) => info.isDirectory(),
        () => false,
      )
      if (!directory && pattern.endsWith('.uidx')) return pattern
      return `${pattern.replace(/\/$/, '')}/**/*.uidx`
    }),
  )
  const matches = await glob(globs, { cwd, absolute: false, ignore: ['**/node_modules/**'] })
  return [...new Set(matches)].sort()
}

export function renderText(result: CheckResult, cwd = process.cwd()): string {
  const lines: string[] = []
  for (const report of result.files) {
    for (const d of report.diagnostics) {
      lines.push(formatDiagnostic(d, displayPath(report.file, cwd)))
    }
  }

  const fileCount = `${result.files.length} file${result.files.length === 1 ? '' : 's'}`
  if (result.errors === 0 && result.warnings === 0) {
    lines.push(`✔ ${fileCount} OK`)
  } else {
    const parts: string[] = []
    if (result.errors) parts.push(`${result.errors} error${result.errors === 1 ? '' : 's'}`)
    if (result.warnings) parts.push(`${result.warnings} warning${result.warnings === 1 ? '' : 's'}`)
    lines.push(`${result.errors ? '✖' : '⚠'} ${parts.join(', ')} in ${fileCount}`)
  }
  return lines.join('\n')
}

/**
 * Editors resolve `file:line:col` against the cwd, so relative wins — but a
 * climbing `../../../..` path is worse than an absolute one for a file outside
 * the working directory.
 */
function displayPath(file: string, cwd: string): string {
  const rel = relative(cwd, resolvePath(cwd, file))
  if (!rel) return file
  return rel.startsWith('..') ? resolvePath(cwd, file) : rel
}

export function renderJson(result: CheckResult): string {
  return JSON.stringify(
    {
      errors: result.errors,
      warnings: result.warnings,
      files: result.files.map((f) => ({
        file: f.file,
        diagnostics: f.diagnostics.map((d) => ({
          code: d.code,
          severity: d.severity,
          message: d.message,
          line: d.line,
          column: d.column,
          start: d.loc.start,
          end: d.loc.end,
        })),
      })),
    },
    null,
    2,
  )
}
