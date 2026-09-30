import { access, readFile, stat } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { glob } from 'tinyglobby'
import { assetPathProblem, DEFAULT_ASSET_GLOBS, parse, type ParseResult } from '@uidx/format'

export const MANIFEST_NAME = 'uidx.json'

/**
 * The `uidx.json` manifest (ADR 0004 §1).
 *
 * Membership and an id, and nothing else. Deliberately no `systems` field: a
 * design system is a directory and a name prefix, not a boundary, so nothing
 * here needs to know which pages form one.
 */
export interface Manifest {
  id: string
  files: string[]
  /**
   * Where artwork may live (ADR 0006 §3). Defaulted rather than required — a
   * document that never referenced an image should not have to say so.
   */
  assets: string[]
  /**
   * The headless library (ADR 0013 §3). Optional: a document with no code
   * render has none. Written as a path to its `custom-elements.json` or as an
   * object that also says how the library spells things; normalised to the
   * object here. When present the viewer offers its elements and parts as
   * choices in the Contract tab, and `uidx codegen` reads it by default.
   */
  headless?: HeadlessConfig
  /**
   * Where `uidx codegen` and the viewer's Generate button write the code
   * targets, relative to `uidx.json` (ADR 0017 §3), and which targets.
   * Optional: a document with no code render has none.
   */
  codegen?: CodegenConfig
}

export interface CodegenConfig {
  out: string
  targets?: string[]
}

/**
 * How a design binds to one library without the design changing (ADR 0013
 * §3). `manifest` is the `custom-elements.json`, relative to `uidx.json`.
 * `profile` says how the library exposes props, parts and its own states;
 * `bindings` translates the identity's names to the library's, per
 * component. Both are optional and default to the conventions the example
 * library follows; their shapes are validated where they are read.
 */
export interface HeadlessConfig {
  manifest: string
  profile?: Record<string, string>
  bindings?: Record<string, unknown>
}

export interface FoundManifest {
  /** Absolute path to `uidx.json`. */
  path: string
  /** The workspace root — every `files` glob resolves against this. */
  dir: string
  manifest: Manifest
}

export interface LoadedDocument extends FoundManifest {
  /** Member pages, workspace-relative and sorted, with their parse results. */
  pages: { file: string; result: ParseResult }[]
  /** Milliseconds reading every member off disk. */
  readMs: number
  /** Milliseconds parsing them, excluding I/O — comparable to the §5 budget. */
  parseMs: number
}

export class ManifestError extends Error {
  constructor(readonly lines: string[]) {
    super(lines.join('\n'))
    this.name = 'ManifestError'
  }
}

/**
 * Walks up from `from` to the nearest `uidx.json`.
 *
 * A global name cannot be resolved from a single file (ADR 0004 §2), so this is
 * how any command finds the rest of the document. Returns null rather than
 * throwing: callers word the "not in a document" message for themselves, and
 * `check` and `open` want to say different things about it.
 */
export async function findManifest(from: string): Promise<FoundManifest | null> {
  let dir = resolve(from)
  // `from` may be a file; start at its directory in that case.
  if (!(await isDirectory(dir))) dir = dirname(dir)

  for (;;) {
    const path = resolve(dir, MANIFEST_NAME)
    if (await exists(path)) {
      return { path, dir, manifest: await readManifest(path) }
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** Reads and validates a manifest. Every problem is reported, not just the first. */
export async function readManifest(path: string): Promise<Manifest> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    throw new ManifestError([`cannot read ${path}: ${(err as Error).message}`])
  }

  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch (err) {
    throw new ManifestError([`${path} is not valid JSON: ${(err as Error).message}`])
  }

  const problems: string[] = []
  const record = (data ?? {}) as Record<string, unknown>

  const id = record.id
  if (typeof id !== 'string' || id === '') {
    problems.push(`${path}: "id" must be a non-empty string — it names the document`)
  }

  const files = record.files
  if (!Array.isArray(files) || files.length === 0) {
    problems.push(`${path}: "files" must be a non-empty array of globs`)
  } else if (files.some((entry) => typeof entry !== 'string')) {
    problems.push(`${path}: every entry of "files" must be a string`)
  }

  const assets = record.assets
  if (assets !== undefined) {
    if (!Array.isArray(assets) || assets.some((entry) => typeof entry !== 'string')) {
      problems.push(`${path}: "assets" must be an array of globs`)
    }
  }

  let headless: HeadlessConfig | undefined
  const declared = record.headless
  if (typeof declared === 'string' && declared !== '') headless = { manifest: declared }
  else if (declared !== undefined) {
    const config =
      typeof declared === 'object' && declared !== null && !Array.isArray(declared)
        ? (declared as Record<string, unknown>)
        : undefined
    const manifest = config?.manifest
    if (typeof manifest !== 'string' || manifest === '') {
      problems.push(
        `${path}: "headless" must be a path to a custom-elements.json, or { "manifest": path, "profile"?, "bindings"? }`,
      )
    } else {
      headless = { manifest }
      const profile = config!.profile
      if (profile !== undefined) {
        if (
          typeof profile !== 'object' ||
          profile === null ||
          Array.isArray(profile) ||
          Object.values(profile).some((value) => typeof value !== 'string')
        )
          problems.push(`${path}: "headless.profile" must be an object of strings`)
        else headless.profile = profile as Record<string, string>
      }
      const bindings = config!.bindings
      if (bindings !== undefined) {
        if (typeof bindings !== 'object' || bindings === null || Array.isArray(bindings))
          problems.push(`${path}: "headless.bindings" must be an object keyed by component name`)
        else headless.bindings = bindings as Record<string, unknown>
      }
    }
  }

  let codegen: CodegenConfig | undefined
  const generation = record.codegen
  if (generation !== undefined) {
    const config =
      typeof generation === 'object' && generation !== null && !Array.isArray(generation)
        ? (generation as Record<string, unknown>)
        : undefined
    const out = config?.out
    if (typeof out !== 'string' || out === '') {
      problems.push(
        `${path}: "codegen" must be { "out": path, "targets"?: ["html", "react", "contract"] }`,
      )
    } else {
      codegen = { out }
      const targets = config!.targets
      if (targets !== undefined) {
        if (
          !Array.isArray(targets) ||
          targets.some((target) => !['html', 'react', 'contract'].includes(target as string))
        )
          problems.push(`${path}: "codegen.targets" may hold html, react and contract`)
        else codegen.targets = targets as string[]
      }
    }
  }

  if (problems.length) throw new ManifestError(problems)
  return {
    id: id as string,
    files: files as string[],
    // Absent means the conventional folders, all of them. An empty array is a
    // different statement — "this document has no assets" — and is honoured.
    assets: assets === undefined ? [...DEFAULT_ASSET_GLOBS] : (assets as string[]),
    ...(headless === undefined ? {} : { headless }),
    ...(codegen === undefined ? {} : { codegen }),
  }
}

/**
 * The asset files this document declares, workspace-relative and sorted.
 *
 * Enumerated rather than pattern-matched, and that is what makes the check
 * answerable: this package has a globber and a filesystem but no path matcher,
 * and enumerating answers *declared* and *present* in one pass — a `src` in
 * this set is both, one outside it is one or the other, and `assetProblem`
 * tells them apart.
 */
export async function documentAssets(found: FoundManifest): Promise<Set<string>> {
  if (found.manifest.assets.length === 0) return new Set()
  const matches = await glob(found.manifest.assets, {
    cwd: found.dir,
    absolute: false,
    ignore: ['**/node_modules/**'],
  })
  return new Set(matches)
}

/**
 * Why this reference cannot be drawn, in the author's terms — or null.
 *
 * Three answers rather than one, because they need three different fixes:
 * the path is malformed, the file is missing, or the file is there but the
 * manifest never said that folder was part of the document.
 */
export async function assetProblem(
  found: FoundManifest,
  declared: ReadonlySet<string>,
  src: string,
): Promise<{
  code: 'BAD_ASSET_PATH' | 'MISSING_ASSET' | 'UNDECLARED_ASSET'
  message: string
} | null> {
  const malformed = assetPathProblem(src)
  if (malformed) return { code: 'BAD_ASSET_PATH', message: malformed }
  if (declared.has(src)) return null

  if (await exists(resolve(found.dir, src))) {
    return {
      code: 'UNDECLARED_ASSET',
      message:
        `"${src}" exists but is not covered by "assets" in ${MANIFEST_NAME} — ` +
        `add its folder, or move it under ${found.manifest.assets.join(', ') || 'one that is declared'}`,
    }
  }
  return { code: 'MISSING_ASSET', message: `"${src}" does not exist` }
}

/** Member pages of a document, workspace-relative and sorted. */
export async function documentMembers(found: FoundManifest): Promise<string[]> {
  const matches = await glob(found.manifest.files, {
    cwd: found.dir,
    absolute: false,
    ignore: ['**/node_modules/**'],
  })
  return [...new Set(matches)].sort()
}

/**
 * Reads and parses every member of the document.
 *
 * The whole document is loaded because a bare component name resolves against
 * all of it — that is the cost ADR 0004 accepted when it removed file
 * qualifiers, and `parseMs` is here so the cost is measurable rather than
 * assumed.
 */
export async function loadDocument(found: FoundManifest): Promise<LoadedDocument> {
  const files = await documentMembers(found)

  // Read and parse are timed apart on purpose. Folded together they produced a
  // per-page figure that looked like a parser regression when most of it was
  // I/O, and the §5 budget is a statement about parsing.
  const readStarted = performance.now()
  const sources = await Promise.all(files.map((file) => readFile(resolve(found.dir, file), 'utf8')))
  const readMs = performance.now() - readStarted

  const parseStarted = performance.now()
  const pages = files.map((file, i) => ({ file, result: parse(sources[i]!) }))
  const parseMs = performance.now() - parseStarted

  return { ...found, pages, readMs, parseMs }
}

/** Whether `file` is one of the document's members. */
export function isMember(found: FoundManifest, members: readonly string[], file: string): boolean {
  const rel = relative(found.dir, resolve(file))
  if (rel.startsWith('..') || rel.startsWith(sep)) return false
  return members.includes(rel.split(sep).join('/'))
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}
