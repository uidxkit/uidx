import { FLOW_MODES, fnv1a, Lowerer, parse, parseFragmentRoot, resolve } from './parse.js'
import { applyPatch, applyPatches, PatchError } from './patch.js'
import { componentVariants } from './variants.js'
import { isAlias } from './alias.js'
import { mapLengthLeaves, parseLength, isUnitLength, UNITLESS_NUMBER_PROPS } from './lengths.js'
import type { Range, UidxAttr, UidxDocument, UidxElement, UidxNode, UidxPatch } from './types.js'

export interface IncrementalResult {
  doc: UidxDocument
  /** Addresses re-lowered — the enclosing element after the parent-bump rule. */
  changed: string[]
  /** True when a full parse ran instead. */
  fellBack: boolean
}

/**
 * Elements whose shape checks span their children: a change to a child is
 * re-lowered from here so those checks run (spec §1, step 2).
 */
const SHAPED = new Set<UidxElement>([
  'Component',
  'Variant',
  'Instance',
  'Slot',
  'Variable',
  'Collection',
])

/**
 * Attributes the lowering reads for more than their value — a name is an
 * address, `variants` are axes, pins and sizes are checked against each other.
 * A change to one of these re-lowers the element; any other attribute is a
 * value the tree can take directly (spec §1, the attribute fast path).
 */
const READ_BY_CHECKS = new Set([
  'rootFontSize',
  'name',
  'value',
  'type',
  'modes',
  'variants',
  'status',
  'scopes',
  'props',
  'overrides',
  'layoutPositioning',
  'layoutMode',
  'constraints',
  'component',
  'width',
  'height',
  'x',
  'y',
  'left',
  'right',
  'top',
  'bottom',
  'centerX',
  'centerY',
])

/**
 * Elements whose *own* attributes are not values at all: a `<Variant>`'s
 * attributes are its coordinates, so any of them renames it. Every other
 * element's plain attributes may be taken straight into the tree — an
 * `<Instance>`'s `visible` is its own look, not part of what it expands to,
 * and that is the edit the states grid makes.
 */
const SHAPED_ELEMENTS = new Set<UidxElement>(['Variant'])

const WRAP_OPEN = '<Page>\n'
const WRAP_CLOSE = '\n</Page>\n'

/**
 * Applies patches and re-parses only the element they touched (spec: viewer
 * at scale §1). The result is what `parse(applyPatches(...).source)` would
 * return — tested to be, offsets included — at a cost proportional to the
 * element rather than the file: about 1 s for the 63k-line atlas page became
 * tens of milliseconds.
 *
 * Falls back to the full parse whenever the fast path cannot vouch for the
 * result: a change at the root or outside the tree, a fragment that does not
 * lower cleanly, a sibling-name collision. Throws `PatchError` when even the
 * full parse refuses, exactly as `applyPatch`'s validation does.
 */
export function applyPatchesIncremental(
  doc: UidxDocument,
  patches: readonly UidxPatch[],
): IncrementalResult {
  // Plain attribute values first, one op at a time: the tree takes the new
  // value and every offset after it moves, no parsing at all. What is left —
  // structural ops, names, anything a check reads — goes through the
  // re-lowering below in one batch.
  let current = doc
  const rest: UidxPatch[] = []
  const changed: string[] = []
  for (const patch of patches) {
    if (rest.length === 0 && isPlainAttribute(current, patch)) {
      const next = takeAttribute(current, patch)
      if (next) {
        current = next
        if (!changed.includes(patch.address)) changed.push(patch.address)
        continue
      }
    }
    rest.push(patch)
  }
  if (rest.length === 0) {
    if (current === doc) return { doc, changed: [], fellBack: false }
    const out: UidxDocument = { ...current, sourceHash: fnv1a(current.source) }
    delete (out as { predicted?: true }).predicted
    return { doc: out, changed, fellBack: false }
  }
  if (current !== doc) current = { ...current, sourceHash: fnv1a(current.source) }
  const relowered = relowerBatch(current, rest)
  return { ...relowered, changed: [...changed, ...relowered.changed] }
}

type PlainAttributePatch = Extract<UidxPatch, { op: 'set' | 'add' | 'remove' }>

function isPlainAttribute(doc: UidxDocument, patch: UidxPatch): patch is PlainAttributePatch {
  if (patch.op !== 'set' && patch.op !== 'add' && patch.op !== 'remove') return false
  if (READ_BY_CHECKS.has(patch.prop)) return false
  if (patch.address === '') return false
  const node = resolve(doc.tree, patch.address)
  if (!node || node.synthetic) return false
  // Keep valid distance edits on the cheap path, but let the lowerer report
  // unsupported units exactly as a full parse would.
  if (patch.op !== 'remove') {
    let invalid = UNITLESS_NUMBER_PROPS.has(patch.prop) && isUnitLength(patch.value)
    mapLengthLeaves(patch.prop, patch.value, (value) => {
      if (value !== null && !isAlias(value) && !parseLength(value)) invalid = true
      return value
    })
    if (invalid) return false
  }
  return !SHAPED_ELEMENTS.has(node.element)
}

/**
 * One attribute op taken straight into the tree: the patcher splices the
 * text (offsets exact by construction) and the node's attribute record is
 * rewritten from the splice, then every range after the edit moves by the
 * delta. Returns null when the splice did not do what this expects, in which
 * case the caller re-lowers instead.
 */
function takeAttribute(doc: UidxDocument, patch: PlainAttributePatch): UidxDocument | null {
  let spliced: { source: string; changedRange: Range }
  try {
    spliced = applyPatch(doc.source, patch, { document: doc, validate: false })
  } catch {
    return null
  }
  const source = spliced.source
  const delta = source.length - doc.source.length
  if (delta === 0 && source === doc.source) return doc
  const node = resolve(doc.tree, patch.address)!

  let from: number
  let attrs: Record<string, UidxAttr>
  if (patch.op === 'set') {
    const old = node.attrs[patch.prop]
    if (!old) return null
    const raw = source.slice(old.valueLoc.start, old.valueLoc.end + delta)
    from = old.valueLoc.end
    attrs = withAttr(node.attrs, patch.prop, {
      name: patch.prop,
      raw,
      value: patch.value,
      loc: { start: old.loc.start, end: old.loc.end + delta },
      valueLoc: { start: old.valueLoc.start, end: old.valueLoc.end + delta },
    })
  } else if (patch.op === 'remove') {
    const old = node.attrs[patch.prop]
    if (!old) return null
    from = old.loc.end
    attrs = withAttr(node.attrs, patch.prop, null)
  } else {
    if (node.attrs[patch.prop]) return null
    from = spliced.changedRange.start
    const inserted = source.slice(from, from + delta)
    const start = from + (inserted.length - inserted.trimStart().length)
    const end = from + delta
    const eq = source.indexOf('=', start)
    if (eq === -1 || eq >= end || source.slice(start, eq) !== patch.prop) return null
    attrs = withAttr(node.attrs, patch.prop, {
      name: patch.prop,
      raw: source.slice(eq + 1, end),
      value: patch.value,
      loc: { start, end },
      valueLoc: { start: eq + 1, end },
    })
  }

  // Shift attributes of the edited node that sit after the edit, then the tree.
  for (const [k, a] of Object.entries(attrs)) {
    if (k === patch.prop) continue
    if (a.loc.start >= from) attrs[k] = shiftAttr(a, delta)
  }
  const tree = moveAfter(doc.tree, from, delta, node.address, attrs)
  return { ...doc, tree, source }
}

/** A range after `from` moves; one spanning it grows at the end. */
function moveRange(r: Range, from: number, delta: number): Range {
  if (r.start >= from) return { start: r.start + delta, end: r.end + delta }
  if (r.end >= from) return { start: r.start, end: r.end + delta }
  return r
}

/**
 * The tree with every offset at or after `from` moved by `delta` and the
 * node at `target` given `attrs`. Nodes that end before `from` are shared.
 */
function moveAfter(
  node: UidxNode,
  from: number,
  delta: number,
  target: string,
  attrs: Record<string, UidxAttr>,
): UidxNode {
  const isTarget = node.address === target
  if (!isTarget && node.loc.end < from) return node
  const moved: UidxNode = {
    ...node,
    loc: moveRange(node.loc, from, delta),
    openTagLoc: moveRange(node.openTagLoc, from, delta),
    attrs: isTarget ? attrs : node.loc.start >= from ? shiftAttrs(node.attrs, delta) : node.attrs,
    children: node.children.map((c) => moveAfter(c, from, delta, target, attrs)),
  }
  return moved
}

function relowerBatch(doc: UidxDocument, patches: readonly UidxPatch[]): IncrementalResult {
  const spliced = applyPatches(doc.source, patches, { document: doc, validate: false })
  if (spliced.source === doc.source) return { doc, changed: [], fellBack: false }

  const reshape = patches.some(
    (p) =>
      p.op === 'insert-node' ||
      p.op === 'remove-node' ||
      p.op === 'move-node' ||
      p.op === 'retag' ||
      ((p.op === 'set' || p.op === 'add' || p.op === 'remove') && p.prop === 'name'),
  )
  const fast = relower(doc, spliced.source, spliced.changedRange, reshape)
  if (fast) return { doc: fast.doc, changed: [fast.address], fellBack: false }

  const { doc: full, diagnostics } = parse(spliced.source)
  if (!full) {
    const detail = diagnostics
      .filter((d) => d.severity === 'error')
      .map((d) => `${d.line}:${d.column} ${d.code}: ${d.message}`)
      .join('; ')
    throw new PatchError(`the patch would produce an invalid document and was rejected — ${detail}`)
  }
  return { doc: full, changed: [], fellBack: true }
}

interface Located {
  /** Root first, the parent of `node` last. */
  ancestors: UidxNode[]
  node: UidxNode
  index: number
}

/**
 * The deepest node whose span holds the range, then the parent-bump rule.
 *
 * An empty range is an insertion point, and a point on a sibling's boundary
 * belongs to the parent, not the sibling — so containment is strict for
 * points. `reshape` says whether the parent's shape checks could be affected
 * (a name, an element, a child count), which is when the bump applies; an
 * attribute on a grandchild cannot change a variant's arity.
 */
function locate(doc: UidxDocument, range: Range, reshape: boolean): Located | null {
  const path: UidxNode[] = []
  let at = doc.tree
  if (range.start < at.loc.start || range.end > at.loc.end) return null
  const holds = (c: UidxNode): boolean =>
    range.start === range.end
      ? c.loc.start < range.start && range.end < c.loc.end
      : c.loc.start <= range.start && range.end <= c.loc.end
  for (;;) {
    const child = at.children.find(holds)
    if (!child) break
    path.push(at)
    at = child
  }
  // Root, or a synthetic page's only child standing in for it: full parse.
  if (path.length === 0) return null
  // One level: the parent's checks read its children's names and count. The
  // grandparent's read the parent's own attributes, which this change did not
  // touch — a variant's coordinates are its attributes, not its child's name.
  if (reshape && path.length > 1 && SHAPED.has(path[path.length - 1]!.element)) {
    at = path.pop()!
  }
  const parent = path[path.length - 1]!
  if (parent.synthetic) return null
  return { ancestors: path, node: at, index: parent.children.indexOf(at) }
}

function lineStartOf(source: string, offset: number): number {
  let i = offset
  while (i > 0 && source[i - 1] !== '\n') i--
  return i
}

const shiftRange = (r: Range, by: number): Range => ({ start: r.start + by, end: r.end + by })

function shiftAttr(a: UidxAttr, by: number): UidxAttr {
  return {
    name: a.name,
    raw: a.raw,
    value: a.value,
    loc: shiftRange(a.loc, by),
    valueLoc: shiftRange(a.valueLoc, by),
  }
}

/**
 * A copy of an attribute record with every offset moved.
 *
 * Built by assignment rather than `Object.fromEntries`, which returns a
 * dictionary-mode object in V8. Thousands of nodes are copied per edit, and
 * once their attribute records are dictionaries every later read of them is
 * slow: the workspace's symbol pass over one page went from 20ms to 1.2s.
 */
function shiftAttrs(attrs: Record<string, UidxAttr>, by: number): Record<string, UidxAttr> {
  const out: Record<string, UidxAttr> = {}
  for (const key in attrs) out[key] = shiftAttr(attrs[key]!, by)
  return out
}

/** The same record with one attribute replaced or added, keeping a fast shape. */
function withAttr(
  attrs: Record<string, UidxAttr>,
  name: string,
  attr: UidxAttr | null,
): Record<string, UidxAttr> {
  const out: Record<string, UidxAttr> = {}
  for (const key in attrs) {
    if (key === name) {
      if (attr) out[key] = attr
      continue
    }
    out[key] = attrs[key]!
  }
  if (attr && !(name in attrs)) out[name] = attr
  return out
}

/** A copy of the subtree with every offset moved by `by`. */
function shifted(node: UidxNode, by: number): UidxNode {
  if (by === 0) return node
  return {
    ...node,
    loc: shiftRange(node.loc, by),
    openTagLoc: shiftRange(node.openTagLoc, by),
    attrs: shiftAttrs(node.attrs, by),
    children: node.children.map((c) => shifted(c, by)),
  }
}

/**
 * The context the real tree gives a node lowered under `parent` — the same
 * arguments `Lowerer.element` receives for it during a full parse.
 */
function contextFor(ancestors: readonly UidxNode[]): {
  axes: ReadonlyMap<string, readonly string[]> | null
  modes: readonly string[] | null
  inFill: boolean
  inComponent: boolean
  parentFlows: boolean
} {
  const parent = ancestors[ancestors.length - 1]!
  let inFill = false
  let inComponent = false
  for (let i = 0; i < ancestors.length; i++) {
    const a = ancestors[i]!
    if (a.element === 'Component') inComponent = true
    if (a.element === 'Slot' && ancestors[i - 1]?.element === 'Instance') inFill = true
  }
  let axes: ReadonlyMap<string, readonly string[]> | null = null
  if (parent.element === 'Component' && parent.attrs.variants) {
    const declared = componentVariants(parent).axes
    axes = declared.size ? declared : null
  }
  let modes: readonly string[] | null = null
  if (parent.element === 'Collection') {
    const declared = parent.attrs.modes?.value
    if (Array.isArray(declared) && declared.every((m) => typeof m === 'string')) {
      modes = declared as string[]
    }
  }
  return {
    axes,
    modes,
    inFill,
    inComponent,
    parentFlows: FLOW_MODES.has(parent.attrs.layoutMode?.value as string),
  }
}

function relower(
  doc: UidxDocument,
  nextSource: string,
  changed: Range,
  reshape: boolean,
): { doc: UidxDocument; address: string } | null {
  const found = locate(doc, changed, reshape)
  if (!found) return null
  const { ancestors, node: old, index } = found
  const parent = ancestors[ancestors.length - 1]!
  const delta = nextSource.length - doc.source.length

  // The element's new text, from the start of its line so `indent` reads the
  // same whitespace the full parse reads, wrapped as a page's only child.
  const lineStart = lineStartOf(doc.source, old.loc.start)
  const newEnd = old.loc.end + delta
  if (newEnd < lineStart || newEnd > nextSource.length) return null
  const wrapped = `${WRAP_OPEN}${nextSource.slice(lineStart, newEnd)}${WRAP_CLOSE}`
  const root = parseFragmentRoot(wrapped)
  const page = root?.children?.find((c: { type: string }) => c.type === 'mdxJsxFlowElement')
  const el = page?.children?.find((c: { type: string }) => c.type === 'mdxJsxFlowElement')
  if (!el) return null

  const ctx = contextFor(ancestors)
  const lowerer = new Lowerer(wrapped)
  const fresh = lowerer.element(
    el,
    parent.address,
    parent.element,
    doc.tree.name,
    ctx.axes,
    ctx.modes,
    ctx.inFill,
    ctx.inComponent,
    ctx.parentFlows,
  )
  if (!fresh || lowerer.diagnostics.some((d) => d.severity === 'error')) return null
  // The fragment must be exactly the element — a splice that broke its close
  // tag would lower as a different span.
  const by = lineStart - WRAP_OPEN.length
  if (fresh.loc.end + by !== newEnd) return null
  const replacement = shifted(fresh, by)

  if (parent.children.some((c, i) => i !== index && c.name === replacement.name)) return null

  // Rebuild the spine: ancestors extend by the delta, later siblings move.
  const oldEnd = old.loc.end
  const rebuild = (depth: number): UidxNode => {
    const here = ancestors[depth]!
    const isParent = depth === ancestors.length - 1
    const children = here.children.map((c, i) => {
      if (isParent && i === index) return replacement
      if (!isParent && c === ancestors[depth + 1]) return rebuild(depth + 1)
      return c.loc.start >= oldEnd ? shifted(c, delta) : c
    })
    return {
      ...here,
      loc: { start: here.loc.start, end: here.loc.end + delta },
      openTagLoc:
        here.openTagLoc.start >= oldEnd ? shiftRange(here.openTagLoc, delta) : here.openTagLoc,
      attrs: here.loc.start >= oldEnd ? shiftAttrs(here.attrs, delta) : here.attrs,
      children,
    }
  }
  const tree = rebuild(0)
  const next: UidxDocument = {
    ...doc,
    tree,
    source: nextSource,
    sourceHash: fnv1a(nextSource),
  }
  delete (next as { predicted?: true }).predicted
  // Deliberately not `assertOffsetInvariant` here: it walks every attribute of
  // the page, which on atlas is ~50ms *per edit* on the client's hot path.
  // The tests assert it after every case instead — the invariant is a fact
  // about this code, not about the document it was handed.
  return { doc: next, address: replacement.address }
}
