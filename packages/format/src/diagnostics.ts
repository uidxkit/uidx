import type { Diagnostic, Range, Severity } from './types.js'

/**
 * Diagnostic codes. Stable identifiers — editors and CI parse these, so entries
 * are appended, never renumbered.
 */
export const CODES = {
  // document structure
  NO_CONTRACT: 'UIDX001',
  DUPLICATE_CONTRACT: 'UIDX002',
  CONTRACT_NOT_SINGLE_ROOT: 'UIDX003',
  /** Was ROOT_NOT_COMPONENT; the root is `<Page>` since ADR 0003. Code unchanged. */
  BAD_ROOT: 'UIDX004',
  BAD_FRONTMATTER: 'UIDX005',
  MISSING_FRONTMATTER_KEY: 'UIDX006',
  UNEXPECTED_CONTRACT_CONTENT: 'UIDX007',
  BAD_STATUS: 'UIDX008',
  BAD_ID: 'UIDX009',
  // UIDX010 is `DUPLICATE_ID`, owned by `uidx check` because it is repo-scoped.
  FRONTMATTER_KEY_MOVED: 'UIDX011',
  // tree shape
  UNKNOWN_ELEMENT: 'UIDX100',
  MISSING_NAME: 'UIDX101',
  DUPLICATE_SIBLING_NAME: 'UIDX102',
  CHILDREN_NOT_ALLOWED: 'UIDX103',
  COMPONENT_ARITY: 'UIDX104',
  /** Was NAME_ON_COMPONENT; the named-by-frontmatter root is `<Page>` now. */
  NAME_ON_ROOT: 'UIDX105',
  ELEMENT_NOT_ALLOWED_HERE: 'UIDX106',
  INVALID_NAME: 'UIDX107',
  /**
   * Retired by [ADR 0009](../../../docs/decisions/0009-status-is-optional.md)
   * §1: `status` is optional, so nothing raises this any more. The entry stays
   * because this table is append-only — editors and CI parse these codes, and a
   * number that once meant something must never come to mean another thing.
   */
  MISSING_STATUS: 'UIDX108',
  METADATA_ATTR_MISPLACED: 'UIDX109',
  MISSING_VARIABLE_VALUE: 'UIDX110',
  BAD_VARIABLE_VALUE: 'UIDX111',
  // instances (story F3)
  MISSING_COMPONENT: 'UIDX112',
  BAD_OVERRIDES: 'UIDX113',
  COMPONENT_ATTR_MISPLACED: 'UIDX114',
  // component properties (story F6)
  BAD_COMPONENT_PROPS: 'UIDX115',
  PROP_BINDING_MISMATCH: 'UIDX116',
  // variants (story F8, ADR 0005)
  /** The `variants` declaration itself: not a map of axes to string domains. */
  BAD_VARIANTS: 'UIDX117',
  /** One `<Variant>`'s coordinates: an axis unassigned, out of domain, or unknown. */
  BAD_VARIANT: 'UIDX118',
  /** Two `<Variant>`s claiming the same combination. */
  DUPLICATE_VARIANT: 'UIDX119',
  /** No `<Variant>` for every axis's first value, so an unset instance has nothing to draw. */
  MISSING_DEFAULT_VARIANT: 'UIDX120',
  /** The two shapes mixed: `variants` over plain children, or a `<Variant>` without them. */
  VARIANT_SHAPE: 'UIDX121',
  // typed tokens, modes and scopes (story G8)
  /** A `<Variable>` with no `type`. Figma picks a type at creation; so do we. */
  MISSING_VARIABLE_TYPE: 'UIDX122',
  /** A declared `type` that is not one of the four, or that the value contradicts. */
  VARIABLE_TYPE_MISMATCH: 'UIDX123',
  /** `modes` on a `<Collection>` that is not an array of unique non-empty strings. */
  BAD_COLLECTION_MODES: 'UIDX124',
  /** The either/or rule: `<Mode>` children without `modes`, or `value` with them. */
  MODE_SHAPE: 'UIDX125',
  /** A `<Mode name>` the collection never declared. */
  UNKNOWN_MODE: 'UIDX126',
  /** A variable that does not cover every mode its collection declares. */
  MISSING_MODE: 'UIDX127',
  /** A `scopes` entry that is not one of `VARIABLE_SCOPES`. */
  BAD_SCOPE: 'UIDX128',
  /** A node's `modes` that is not a `{ collection: mode }` map of strings. */
  BAD_NODE_MODES: 'UIDX129',
  // slots (story F5, ADR 0007)
  /** Two `<Slot>`s with one name in a component. The name is the whole contract. */
  DUPLICATE_SLOT: 'UIDX130',
  /** A fill-side `<Slot>` carrying scene properties; layout lives in the definition. */
  SLOT_FILL_SHAPE: 'UIDX131',
  /** Two fills for one slot on one `<Instance>`. */
  DUPLICATE_SLOT_FILL: 'UIDX132',
  /** A `<Slot>` on a page, as a component's direct child, or inside a fill. */
  SLOT_NOT_ALLOWED_HERE: 'UIDX133',
  // pins (ADR 0011, story H1)
  /**
   * The file answers a question its own pin already answers — `x` under a MAX
   * pin, `width` under a STRETCH one. Two answers that disagree the moment the
   * parent is resized, so the file may only carry the authored half.
   */
  PIN_GEOMETRY_CONFLICT: 'UIDX134',
  /** A pin with no parent box to measure from, or a parent that flows the child. */
  PIN_NOT_ALLOWED_HERE: 'UIDX135',
  /** `SCALE` is a ratio and needs fractional geometry, which is story H5. */
  PIN_SCALE_UNSUPPORTED: 'UIDX136',
  // attribute grammar
  BAD_VALUE: 'UIDX200',
  SHORTHAND_ATTR: 'UIDX201',
  SPREAD_ATTR: 'UIDX202',
  DUPLICATE_ATTR: 'UIDX203',
  NON_FINITE_NUMBER: 'UIDX204',
  BAD_LENGTH: 'UIDX205',
  // lint
  UNKNOWN_PROP: 'UIDX300',
  // assets (ADR 0006)
  BAD_ASSET_PATH: 'UIDX301',
  MISSING_ASSET: 'UIDX302',
  UNDECLARED_ASSET: 'UIDX303',
} as const

/**
 * Where each line of a source begins, so a position is a search rather than a
 * scan.
 *
 * Held per source string, because the callers that matter ask thousands of
 * times about one document and once about the next. The server's `reindex`
 * runs `collectReferences` over every page on every patch and maps one offset
 * per alias to a line — 9,198 of them on this repo's `design-systems/simple`.
 * Scanning from index 0 each time made that quadratic in file size: measured
 * on 2026-09-02 it read 553 million characters and cost ~1s per pass, and
 * `reindex` pays for two, which was the whole of the second-plus lag between
 * picking Hug in the panel and the canvas showing it.
 *
 * Bounded rather than unbounded: a `Map` key is a strong reference, so an
 * uncapped one would hold every source string this process ever saw — and a
 * long-running `uidx open` sees a new one on every save. The cap is generous
 * enough for a whole document's pages to stay resident through one pass, which
 * is the access pattern that needs the cache at all; past that the oldest
 * entry goes, since the walk has moved on from it.
 */
/**
 * Where each line begins. Pure — hand it to `positionIn` when mapping many
 * offsets of one document, which is what the workspace's symbol pass does.
 */
export function lineStartsOf(source: string): number[] {
  const starts = [0]
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) starts.push(i + 1)
  }
  return starts
}

/**
 * A one-entry cache, checked by `===`.
 *
 * It used to be a `Map` keyed by the source. That looked like a cache and
 * behaved like a scan: a `Map` lookup on a multi-megabyte string key compares
 * the key, so every one of the thousands of lookups in a pass walked 3MB —
 * measured at 1.17s per page on `atlas.uidx`, half the server's time on every
 * edit. Reference equality is a pointer check, and one entry is all the
 * pattern needs: a pass asks thousands of times about one document, then
 * moves to the next.
 */
let lastSource: string | null = null
let lastStarts: number[] | null = null

function startsOf(source: string): number[] {
  if (lastSource === source && lastStarts) return lastStarts
  const starts = lineStartsOf(source)
  lastSource = source
  lastStarts = starts
  return starts
}

/** Maps a byte offset to 1-based line/column. */
/** Maps an offset to 1-based line/column against line starts already computed. */
export function positionIn(
  starts: readonly number[],
  offset: number,
): { line: number; column: number } {
  // The last line start at or before the offset. An offset past the end lands
  // on the final line, which is what the scan it replaces also did.
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid]! <= offset) lo = mid
    else hi = mid - 1
  }
  return { line: lo + 1, column: offset - starts[lo]! + 1 }
}

export function positionAt(source: string, offset: number): { line: number; column: number } {
  return positionIn(startsOf(source), Math.min(offset, source.length))
}

export function diagnostic(
  source: string,
  code: string,
  message: string,
  loc: Range,
  severity: Severity = 'error',
): Diagnostic {
  const { line, column } = positionAt(source, loc.start)
  return { code, message, severity, loc, line, column }
}

/** `primary-button.uidx:24:5 error UIDX102: duplicate sibling name "label"` (spec §8). */
export function formatDiagnostic(d: Diagnostic, file = '<input>'): string {
  return `${file}:${d.line}:${d.column} ${d.severity} ${d.code}: ${d.message}`
}

/** Thrown by the `*OrThrow` entry points. */
export class UidxError extends Error {
  readonly diagnostics: Diagnostic[]
  constructor(diagnostics: Diagnostic[], file?: string) {
    super(diagnostics.map((d) => formatDiagnostic(d, file)).join('\n'))
    this.name = 'UidxError'
    this.diagnostics = diagnostics
  }
}
