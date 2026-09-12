import { readFile, stat, writeFile } from 'node:fs/promises'
import { relative, resolve as resolvePath } from 'node:path'
import { glob } from 'tinyglobby'
import { parse as parseYaml } from 'yaml'
import { emitDocument, parse, type Diagnostic } from '@uidx/format'

export interface FmtOptions {
  cwd?: string
  /** Report only; never write. Exit code still reflects what would change. */
  check?: boolean
  /** Bring a pre-ADR-0003 file up to the current shape before formatting. */
  migrate?: boolean
}

export type FmtStatus = 'unchanged' | 'formatted' | 'migrated' | 'failed'

export interface FmtFileResult {
  file: string
  status: FmtStatus
  /** The canonical source. Absent when unchanged or failed. */
  next?: string
  /** Why the file could not be formatted. */
  diagnostics?: Diagnostic[]
}

export interface FmtResult {
  files: FmtFileResult[]
  changed: number
  failed: number
  exitCode: number
}

/**
 * Plans the canonical rewrite of every matching file (story A3).
 *
 * Pure with respect to the filesystem, like `check`: it reads and returns what
 * *would* be written, and `applyFmt` does the writing. That split is what lets
 * `--check` and the overwrite prompt share one code path instead of two.
 */
export async function fmt(patterns: string[], options: FmtOptions = {}): Promise<FmtResult> {
  const cwd = options.cwd ?? process.cwd()
  const files = await expand(patterns, cwd)
  if (files.length === 0) throw new NoMatchesError(patterns)

  const results: FmtFileResult[] = []
  for (const file of files) {
    const source = await readFile(resolvePath(cwd, file), 'utf8')
    results.push(planOne(file, source, options.migrate === true))
  }

  const changed = results.filter((r) => r.status === 'formatted' || r.status === 'migrated').length
  const failed = results.filter((r) => r.status === 'failed').length

  return {
    files: results,
    changed,
    failed,
    // `--check` is a gate, so "would change" is a failure there but not here.
    exitCode: failed > 0 || (options.check === true && changed > 0) ? 1 : 0,
  }
}

function planOne(file: string, source: string, migrate: boolean): FmtFileResult {
  const attempt = parse(source)

  if (!attempt.doc && migrate) {
    const candidate = migrateSource(source)
    const migrated = parse(candidate)
    if (migrated.doc) {
      return { file, status: 'migrated', next: emitDocument(migrated.doc) }
    }
    // Report against the *migrated* text: those are the problems a human still
    // has to fix, and pointing at the original would name lines that no longer
    // describe the failure.
    return { file, status: 'failed', diagnostics: errorsOf(migrated.diagnostics) }
  }

  if (!attempt.doc) {
    return { file, status: 'failed', diagnostics: errorsOf(attempt.diagnostics) }
  }

  const next = emitDocument(attempt.doc)
  return next === source ? { file, status: 'unchanged' } : { file, status: 'formatted', next }
}

function errorsOf(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return diagnostics.filter((d) => d.severity === 'error')
}

/** Writes every planned change. Returns the files actually touched. */
export async function applyFmt(result: FmtResult, cwd: string): Promise<string[]> {
  const written: string[] = []
  for (const file of result.files) {
    if (file.next === undefined) continue
    await writeFile(resolvePath(cwd, file.file), file.next, 'utf8')
    written.push(file.file)
  }
  return written
}

/**
 * Legacy shape → current shape, as a source transform rather than a parser mode.
 *
 * The parser has no memory of the old format on purpose: `<Component>` requires
 * a `name` (ADR 0003 §4) and `status` in the frontmatter is an error (§3), so a
 * pre-0003 file does not parse at all and migration cannot run through the AST.
 * It rewrites the text instead and proves the result by parsing it — a migration
 * that produced an unreadable file would be worse than one that refused.
 *
 * `<Page>` is not inserted here. A bare `<Component>` root already parses as
 * sugar for a single-component page, and `emitDocument` materialises the wrapper
 * when it prints, so formatting does that half by construction.
 */
export function migrateSource(source: string): string {
  const front = frontmatterBlock(source)
  if (!front) return source

  let data: Record<string, unknown> = {}
  try {
    data = (parseYaml(front.text) ?? {}) as Record<string, unknown>
  } catch {
    return source // not our problem to fix; the parse error will say so
  }

  const id = typeof data.id === 'string' ? data.id : null
  const moved: [string, unknown][] = []
  for (const key of ['status', 'version'] as const) {
    if (data[key] !== undefined) moved.push([key, data[key]])
  }

  const rootAt = rootComponentOffset(source)
  if (rootAt === -1) return source

  const openTagEnd = source.indexOf('>', rootAt)
  const openTag = openTagEnd === -1 ? '' : source.slice(rootAt, openTagEnd)
  const additions: string[] = []

  if (id && !/\bname\s*=/.test(openTag)) additions.push(`name="${id}"`)
  for (const [key, value] of moved) {
    // An attribute already on the element wins: it is the newer of the two, and
    // ADR 0003 §3 forbids the frontmatter copy either way.
    if (new RegExp(`\\b${key}\\s*=`).test(openTag)) continue
    additions.push(`${key}="${String(value)}"`)
  }

  let out = source
  if (additions.length) {
    const insertAt = rootAt + '<Component'.length
    out = `${out.slice(0, insertAt)} ${additions.join(' ')}${out.slice(insertAt)}`
  }
  return moved.length
    ? stripFrontmatterKeys(
        out,
        moved.map(([key]) => key),
      )
    : out
}

/** The `---` fenced block at the top of the file, if there is one. */
function frontmatterBlock(source: string): { text: string; start: number; end: number } | null {
  if (!source.startsWith('---')) return null
  const firstNewline = source.indexOf('\n')
  if (firstNewline === -1) return null
  const close = source.indexOf('\n---', firstNewline)
  if (close === -1) return null
  return { text: source.slice(firstNewline + 1, close), start: firstNewline + 1, end: close }
}

/**
 * Drops whole top-level keys from the frontmatter text.
 *
 * Line-based rather than a YAML round-trip so an unrelated key keeps its
 * authored formatting — `emitDocument` re-serialises anyway, but a migration
 * that fails partway should not have reflowed the file first.
 */
function stripFrontmatterKeys(source: string, keys: readonly string[]): string {
  const front = frontmatterBlock(source)
  if (!front) return source

  const kept: string[] = []
  let dropping = false
  for (const line of front.text.split('\n')) {
    const top = /^([A-Za-z0-9_-]+)\s*:/.exec(line)
    if (top) dropping = keys.includes(top[1]!)
    else if (!/^\s/.test(line)) dropping = false // not a continuation
    if (!dropping) kept.push(line)
  }
  return source.slice(0, front.start) + kept.join('\n') + source.slice(front.end)
}

/** Offset of the root `<Component`, i.e. the first one in the contract region. */
function rootComponentOffset(source: string): number {
  const heading = source.indexOf('## Visual Contract')
  return source.indexOf('<Component', heading === -1 ? 0 : heading)
}

export class NoMatchesError extends Error {
  constructor(readonly patterns: string[]) {
    super(`no .uidx files matched ${patterns.map((p) => JSON.stringify(p)).join(', ')}`)
    this.name = 'NoMatchesError'
  }
}

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

export function renderFmt(result: FmtResult, cwd: string, checkOnly: boolean): string {
  const lines: string[] = []
  for (const file of result.files) {
    const path = displayPath(file.file, cwd)
    if (file.status === 'unchanged') continue
    if (file.status === 'failed') {
      lines.push(`✖ ${path} — cannot format`)
      for (const d of file.diagnostics ?? []) {
        lines.push(`  ${d.line}:${d.column} ${d.code}: ${d.message}`)
      }
      continue
    }
    lines.push(`${checkOnly ? '·' : '✔'} ${path}${file.status === 'migrated' ? ' (migrated)' : ''}`)
  }

  const total = `${result.files.length} file${result.files.length === 1 ? '' : 's'}`
  if (result.failed) lines.push(`✖ ${result.failed} of ${total} could not be formatted`)
  else if (result.changed === 0) lines.push(`✔ ${total} already canonical`)
  else if (checkOnly) lines.push(`· ${result.changed} of ${total} would change`)
  else lines.push(`✔ ${result.changed} of ${total} rewritten`)
  return lines.join('\n')
}

function displayPath(file: string, cwd: string): string {
  const rel = relative(cwd, resolvePath(cwd, file))
  return rel.startsWith('..') ? file : rel
}
