import MagicString from 'magic-string'

import { autoName, emitTree, INDENT_UNIT } from './emit.js'
import { isWithin, parse, parseOrThrow, resolve, resolveParent } from './parse.js'
import { serializeValue } from './values.js'
import {
  COLLECTION_CHILD_ELEMENTS,
  COMPONENT_CHILD_ELEMENTS,
  CONTAINER_ELEMENTS,
  ELEMENTS,
  type JsonValue,
  NODE_CHILD_ELEMENTS,
  PAGE_CHILD_ELEMENTS,
  type Range,
  TOKENS_CHILD_ELEMENTS,
  type UidxDocument,
  type UidxNode,
  type UidxNodeSpec,
  type UidxPatch,
} from './types.js'

/**
 * The `<Page>` implied by a bare `<Component>` root has no source span, so there
 * is nowhere to write a sibling into (ADR 0003 §4). Refusing here is better than
 * producing a file whose entities sit outside any page.
 */
function refuseSyntheticPage(node: UidxNode, what: string): void {
  if (!node.synthetic) return
  throw new PatchError(
    `this file's <Page> is implied by its bare <Component> root, so ${what} has nowhere to go — ` +
      'run `uidx fmt` to materialise the wrapper first',
  )
}

export class PatchError extends Error {}

export interface PatchResult {
  source: string
  /** Span in the *original* source that the patch touched. */
  changedRange: Range
  /**
   * The parsed result, when the patch was validated. The validating parse is
   * the one parse this function inherently owes; handing it back means the
   * caller — a `FileSession`, the agent harness — does not parse a second time.
   * On a 63k-line page that second parse was a full second per edit.
   */
  document?: UidxDocument
}

/**
 * Applies one patch by span replacement over recorded offsets. The tree is never
 * reprinted (spec §9.1).
 *
 * One patch per call, on purpose: structural ops invalidate every offset after
 * their edit point, so the server re-parses between ops (spec §6.3).
 */
export interface PatchOptions {
  /**
   * Re-parse the result and reject the patch if it is not a valid document
   * (spec §9.5). On by default: the engine writes the user's file, so producing
   * something unparseable is worse than the cost of a second parse — which the
   * <10ms budget makes cheap, and a patch is per gesture, not per frame.
   */
  validate?: boolean
  /**
   * An already-parsed document for `source`, to be used instead of parsing it
   * again.
   *
   * Of the two parses this function performs, only the second is inherent: it
   * validates a document that did not exist until this call. The first is pure
   * duplicated work for the caller this is built for — a `FileSession` holds the
   * parsed document for exactly the source it is about to patch, so passing it
   * halves the write path.
   *
   * Rejected rather than trusted when it does not describe `source`, because
   * every offset the patch writes against comes from this document; a stale one
   * would edit the right spans of the wrong text.
   */
  document?: UidxDocument
}

export function applyPatch(
  source: string,
  patch: UidxPatch,
  options: PatchOptions = {},
): PatchResult {
  if (options.document && options.document.source !== source) {
    throw new PatchError(
      'the document passed to applyPatch was parsed from different source than the ' +
        'text being patched; its offsets do not describe this file',
    )
  }
  const doc = options.document ?? parseOrThrow(source)
  const s = new MagicString(source)
  const eol = detectEol(source)

  const changed = ((): Range => {
    try {
      return applyOne(doc, s, patch, eol)
    } catch (err) {
      // A `PatchError` already says what went wrong in the author's words. Any
      // *other* throw is a bug in here, and the raw message a TypeError carries
      // ("Cannot read properties of undefined") names neither the op nor the
      // node — so a report of one is unactionable, which is exactly the report
      // this wrapper exists to prevent ever arriving again.
      if (err instanceof PatchError) throw err
      throw new PatchError(
        `the "${patch.op}" op on ${JSON.stringify(addressOfPatch(patch))} failed unexpectedly: ` +
          `${err instanceof Error ? err.message : String(err)}. This is a bug in the patcher — ` +
          'the file has not been written to',
        { cause: err },
      )
    }
  })()

  const next = s.toString()
  if (options.validate === false) return { source: next, changedRange: changed }
  return { source: next, changedRange: changed, document: assertStillValid(next, patch) }
}

/** Which node a patch names, for a message. Insert names its parent. */
function addressOfPatch(patch: UidxPatch): string {
  return patch.op === 'insert-node' ? patch.parent : patch.address
}

function applyOne(doc: UidxDocument, s: MagicString, patch: UidxPatch, eol: '\r\n' | '\n'): Range {
  {
    switch (patch.op) {
      case 'set':
        return setProp(doc, s, patch.address, patch.prop, patch.value)
      case 'add':
        return addProp(doc, s, patch.address, patch.prop, patch.value, eol)
      case 'remove':
        return removeProp(doc, s, patch.address, patch.prop)
      case 'set-mode':
        return setMode(doc, s, patch.address, patch.mode, patch.value)
      case 'insert-node':
        return insertNode(doc, s, patch.parent, patch.index, patch.node, eol)
      case 'remove-node':
        return removeNode(doc, s, patch.address)
      case 'move-node':
        return moveNode(doc, s, patch.address, patch.newParent, patch.index, eol)
      case 'retag':
        return retagNode(doc, s, patch.address, patch.element, patch.attrs, eol)
      default:
        // Unreachable through the type: the union above is exhaustive, so this
        // only fires for an op that arrived from somewhere newer than this
        // build. That is not hypothetical — `retag` did exactly this, sent by a
        // viewer served from source to a server holding an older `@uidx/format`.
        //
        // Without the branch the switch simply falls out of the bottom and
        // returns `undefined`, which sails past the wrapper in `applyPatch`
        // (nothing threw) and dies in `applyPatches` reading `.start` off it —
        // "Cannot read properties of undefined", the sentence naming neither op
        // nor node that the wrapper exists to prevent. So the fall-through has
        // to be the *loud* case, not the quiet one.
        throw new PatchError(
          `unknown op ${JSON.stringify((patch as UidxPatch).op)} — this build of the patcher ` +
            'does not implement it, which usually means the sender is newer than it is. ' +
            'The file has not been written to',
        )
    }
  }
}

/**
 * Guards the invariants of spec §9.5: the file still parses and sibling names
 * are still unique.
 *
 * Without this a rename onto an existing sibling name, or any future patch bug,
 * silently writes a document the tool can no longer read.
 */
function assertStillValid(source: string, patch: UidxPatch): UidxDocument {
  const { doc, diagnostics } = parse(source)
  if (doc) return doc
  const detail = diagnostics
    .filter((d) => d.severity === 'error')
    .map((d) => `${d.line}:${d.column} ${d.code}: ${d.message}`)
    .join('; ')
  throw new PatchError(
    `patch "${patch.op}" would produce an invalid document and was rejected — ${detail}`,
  )
}

const ATTRIBUTE_OPS = new Set<UidxPatch['op']>(['set', 'add', 'remove', 'set-mode'])

/**
 * Whether a batch can be applied as independent splices over one document.
 *
 * Attribute ops write inside one node's open tag (or one variable's mode
 * child), so two of them on different addresses never overlap and every
 * offset stays valid — `MagicString` maps edits by original offset. Two ops on
 * the same node can collide (an `add` and a `remove` on adjacent attributes),
 * and a structural op moves everything after it, so both take the re-parsing
 * path (spec §6.3).
 */
function isIndependentAttributeBatch(patches: readonly UidxPatch[]): boolean {
  if (patches.length < 2) return false
  const seen = new Set<string>()
  for (const patch of patches) {
    if (!ATTRIBUTE_OPS.has(patch.op)) return false
    const address = (patch as { address: string }).address
    if (seen.has(address)) return false
    seen.add(address)
  }
  return true
}

/**
 * One pass of splices and one parse. The 413-op reflow burst measured on the
 * atlas page cost the server one full parse per op — minutes of it; this is
 * the same result in about a second.
 */
function applyAttributeBatch(
  source: string,
  patches: readonly UidxPatch[],
  options: PatchOptions,
): PatchResult {
  const doc = options.document ?? parseOrThrow(source)
  const s = new MagicString(source)
  const eol = detectEol(source)
  let lo = Number.POSITIVE_INFINITY
  let hi = -1
  for (const patch of patches) {
    let range: Range
    try {
      range = applyOne(doc, s, patch, eol)
    } catch (err) {
      if (err instanceof PatchError) throw err
      throw new PatchError(
        `the "${patch.op}" op on ${JSON.stringify(addressOfPatch(patch))} failed unexpectedly: ` +
          `${err instanceof Error ? err.message : String(err)}. This is a bug in the patcher — ` +
          'the file has not been written to',
        { cause: err },
      )
    }
    lo = Math.min(lo, range.start)
    hi = Math.max(hi, range.end)
  }
  const next = s.toString()
  const changedRange = hi === -1 ? { start: 0, end: 0 } : { start: lo, end: hi }
  if (options.validate === false) return { source: next, changedRange }
  return { source: next, changedRange, document: assertStillValid(next, patches[0]!) }
}

/**
 * Applies a batch. Attribute-only batches on distinct nodes go as one splice
 * pass with one parse; anything else re-parses between ops (spec §6.3).
 */
export function applyPatches(
  source: string,
  patches: readonly UidxPatch[],
  options: PatchOptions = {},
): PatchResult {
  if (options.document && options.document.source !== source) {
    throw new PatchError(
      'the document passed to applyPatches was parsed from different source than the ' +
        'text being patched; its offsets do not describe this file',
    )
  }
  if (isIndependentAttributeBatch(patches)) return applyAttributeBatch(source, patches, options)

  let current = source
  // Always the parse of `current`: the caller's document for the first op, and
  // the validating parse's for every later one — so the re-parse between ops
  // that spec §6.3 requires is the validation itself, not a second pass.
  let document = options.document
  let lo = Number.POSITIVE_INFINITY
  let hi = -1
  for (const patch of patches) {
    const result = applyPatch(current, patch, { ...options, document })
    current = result.source
    document = result.document
    lo = Math.min(lo, result.changedRange.start)
    hi = Math.max(hi, result.changedRange.end)
  }
  const out: PatchResult = {
    source: current,
    changedRange: hi === -1 ? { start: 0, end: 0 } : { start: lo, end: hi },
  }
  if (document && document.source === current) out.document = document
  return out
}

function mustResolve(doc: UidxDocument, address: string, what = 'node'): UidxNode {
  const node = resolve(doc.tree, address)
  if (!node) throw new PatchError(`no ${what} at address ${JSON.stringify(address)}`)
  return node
}

// ---------------------------------------------------------------- properties

function setProp(
  doc: UidxDocument,
  s: MagicString,
  address: string,
  prop: string,
  value: UidxNodeSpec['attrs'][string],
): Range {
  const node = mustResolve(doc, address)
  const attr = node.attrs[prop]
  if (!attr) {
    throw new PatchError(
      `${address || '<root>'} has no attribute "${prop}"; use the "add" op to create it`,
    )
  }
  s.overwrite(attr.valueLoc.start, attr.valueLoc.end, serializeValue(value))
  return attr.valueLoc
}

function addProp(
  doc: UidxDocument,
  s: MagicString,
  address: string,
  prop: string,
  value: UidxNodeSpec['attrs'][string],
  eol: '\r\n' | '\n',
): Range {
  const node = mustResolve(doc, address)
  if (node.attrs[prop]) {
    throw new PatchError(
      `${address || '<root>'} already has attribute "${prop}"; use the "set" op to change it`,
    )
  }

  const insertAt = openTagInsertionPoint(doc.source, node)
  const text = `${prop}=${serializeValue(value)}`

  // Match the surrounding layout: attributes already on their own lines get a
  // new line at the same indent; a single-line tag stays single-line.
  const attrs = Object.values(node.attrs)
  const last = attrs.length ? attrs.reduce((a, b) => (a.loc.end > b.loc.end ? a : b)) : null

  s.appendLeft(
    insertAt,
    last && isMultilineTag(doc.source, node)
      ? `${eol}${indentOfLine(doc.source, last.loc.start)}${text}`
      : ` ${text}`,
  )
  return { start: insertAt, end: insertAt }
}

/**
 * One mode's value on a variable (see the op's own comment for why the child
 * is named rather than addressed). A valid moded variable carries every mode
 * as a child (UIDX127), so a missing child is a wrong mode name, not a cue to
 * insert one.
 */
function setMode(
  doc: UidxDocument,
  s: MagicString,
  address: string,
  mode: string,
  value: UidxNodeSpec['attrs'][string],
): Range {
  const variable = mustResolve(doc, address, 'variable')
  if (variable.element !== 'Variable') {
    throw new PatchError(
      `"set-mode" writes a <Variable>; ${JSON.stringify(address)} is a <${variable.element}>`,
    )
  }

  const child = variable.children.find((c) => c.element === 'Mode' && c.attrs.name?.value === mode)
  if (!child) {
    throw new PatchError(
      `${JSON.stringify(address)} has no mode ${JSON.stringify(mode)}; ` +
        `it holds: ${variable.children.map((c) => c.attrs.name?.value).join(', ') || 'none'}`,
    )
  }
  const attr = child.attrs.value
  if (!attr) {
    // Reachable only through an already-invalid file; still a clear refusal.
    throw new PatchError(`mode ${JSON.stringify(mode)} of ${JSON.stringify(address)} has no value`)
  }
  s.overwrite(attr.valueLoc.start, attr.valueLoc.end, serializeValue(value))
  return attr.valueLoc
}

function removeProp(doc: UidxDocument, s: MagicString, address: string, prop: string): Range {
  const node = mustResolve(doc, address)
  const attr = node.attrs[prop]
  if (!attr) throw new PatchError(`${address || '<root>'} has no attribute "${prop}"`)
  if (prop === 'name' && node.address !== '') {
    throw new PatchError('the "name" attribute is required; rename with a "set" op instead')
  }

  let start = attr.loc.start
  while (start > 0 && /\s/.test(doc.source[start - 1]!)) start--
  s.remove(start, attr.loc.end)
  return { start, end: attr.loc.end }
}

/** Offset just before an open tag's `>` or `/>`, past any trailing whitespace. */
function openTagInsertionPoint(source: string, node: UidxNode): number {
  let i = node.openTagLoc.end - 1 // on '>'
  if (node.selfClosing && source[i - 1] === '/') i--
  while (i > node.openTagLoc.start && /\s/.test(source[i - 1]!)) i--
  return i
}

// ---------------------------------------------------------------- structural

function insertNode(
  doc: UidxDocument,
  s: MagicString,
  parentAddress: string,
  index: number,
  spec: UidxNodeSpec,
  eol: '\r\n' | '\n',
): Range {
  const parent = mustResolve(doc, parentAddress, 'parent')
  if (!CONTAINER_ELEMENTS.has(parent.element)) {
    throw new PatchError(`<${parent.element}> cannot have children`)
  }
  refuseSyntheticPage(parent, 'a new top-level entity')

  const legal =
    parent.element === 'Page'
      ? PAGE_CHILD_ELEMENTS
      : parent.element === 'Component'
        ? COMPONENT_CHILD_ELEMENTS
        : // The tokens view creates rows and collections (spec §6); before it,
          // nothing ever inserted into the token containers and the fallthrough
          // quietly refused them.
          parent.element === 'Tokens'
          ? TOKENS_CHILD_ELEMENTS
          : parent.element === 'Collection'
            ? COLLECTION_CHILD_ELEMENTS
            : NODE_CHILD_ELEMENTS
  if (!legal.has(spec.element)) {
    throw new PatchError(`<${spec.element}> is not allowed inside <${parent.element}>`)
  }
  // ADR 0008 §1: a component holds what a frame holds, so a second plain child
  // is an ordinary insert now. `<Variant>` keeps the rule it only looked like
  // it shared — a variant is one state's tree, and `arrangeVariants` measures
  // one box per variant.
  if (parent.element === 'Variant' && parent.children.length >= 1) {
    throw new PatchError('<Variant> may have only one child')
  }

  const named = withName(spec, parent.children)
  const block = withEol(emitTree(named, parent.indent + INDENT_UNIT), eol)
  return insertChildBlock(doc, s, parent, parent.children, index, block, eol)
}

/**
 * Places an already-indented block as a child of `parent` at `index`, taking
 * care of the two shapes a childless parent can have.
 *
 * `siblings` is the destination's child list *excluding* any node currently
 * being moved, so `index` always counts against the post-removal list.
 */
function insertChildBlock(
  doc: UidxDocument,
  s: MagicString,
  parent: UidxNode,
  siblings: readonly UidxNode[],
  index: number,
  block: string,
  eol: '\r\n' | '\n',
): Range {
  if (parent.selfClosing) {
    // `<Frame ... />` has to become `<Frame ...>` … `</Frame>` first (spec §4.1).
    let cut = parent.openTagLoc.end - 2 // the '/' of '/>'
    while (cut > parent.openTagLoc.start && /\s/.test(doc.source[cut - 1]!)) cut--
    /*
     * Where the `>` lands is not cosmetic. `emitTree` puts it on its own line
     * at the parent's indent whenever the attributes are one per line, so
     * splicing it onto the last attribute's line writes a shape `uidx fmt`
     * would immediately rewrite — format churn from an edit, which §9.5
     * forbids. A single-line tag keeps its `>` where it is, for the same
     * reason: that is what canonical style says for one attribute.
     *
     * D1 is what made this reachable from the UI — draw a frame, then draw
     * inside it — but the rail's drag-to-reparent has always been able to hit
     * it too.
     */
    s.overwrite(
      cut,
      parent.openTagLoc.end,
      isMultilineTag(doc.source, parent) ? `${eol}${parent.indent}>` : '>',
    )
    s.appendLeft(parent.openTagLoc.end, `${eol}${block}${eol}${parent.indent}</${parent.element}>`)
    return { start: cut, end: parent.openTagLoc.end }
  }

  if (siblings.length === 0) {
    const at = parent.openTagLoc.end
    s.appendLeft(at, `${eol}${block}${eol}${parent.indent}`)
    return { start: at, end: at }
  }

  const clamped = Math.max(0, Math.min(index, siblings.length))
  const at = clamped === 0 ? parent.openTagLoc.end : siblings[clamped - 1]!.loc.end
  s.appendLeft(at, `${eol}${block}`)
  return { start: at, end: at }
}

function removeNode(doc: UidxDocument, s: MagicString, address: string): Range {
  const node = mustResolve(doc, address)
  if (node.address === '') throw new PatchError('cannot remove the root <Page>')
  const parent = resolveParent(doc.tree, address)
  // ADR 0008 §1 took the arity rule off `<Component>`: it holds what a frame
  // holds, including nothing, so its last child leaving is an ordinary edit.
  // `<Variant>` keeps the rule, because a variant is one state's tree.
  if (parent?.element === 'Variant') {
    throw new PatchError('cannot remove the sole child of <Variant>')
  }
  if (parent) refuseSyntheticPage(parent, 'removing its only entity')
  const span = nodeSpanWithLeadingWhitespace(doc.source, node)
  s.remove(span.start, span.end)
  return span
}

/**
 * Rewrites a node's tag name in place (story F14).
 *
 * Two replacements, both over spans the parser recorded: the name in the open
 * tag, and — when the node is not self-closing — the name in the close tag. The
 * closing name is *found* rather than computed, because the gap between the
 * last child and `</` is whitespace nobody should have to predict.
 *
 * Nothing inside moves. That is the whole reason this op exists: the alternative
 * is a remove and an insert, which reprints every child, every comment and every
 * attribute the author arranged by hand.
 */
function retagNode(
  doc: UidxDocument,
  s: MagicString,
  address: string,
  element: string,
  attrs: Record<string, JsonValue | null> | undefined,
  eol: '\r\n' | '\n',
): Range {
  const node = mustResolve(doc, address)
  if (node.address === '') throw new PatchError('cannot retag the root <Page>')
  refuseSyntheticPage(node, 'retagging it')
  if (!(ELEMENTS as readonly string[]).includes(element)) {
    throw new PatchError(`"${element}" is not a UIDX element; allowed: ${ELEMENTS.join(', ')}`)
  }
  if (node.element === element) throw new PatchError(`<${element}> is already what this node is`)

  // `<` then the name, at the very start of the open tag.
  const openStart = node.loc.start + 1
  const openEnd = openStart + node.element.length
  if (doc.source.slice(openStart, openEnd) !== node.element) {
    throw new PatchError(`the open tag at ${address} does not start with <${node.element}`)
  }
  s.overwrite(openStart, openEnd, element)

  if (!node.selfClosing) {
    // The last `</` inside the node's span opens the closing tag. Searched from
    // the end so a child's closing tag is never mistaken for this one.
    const closeAt = doc.source.lastIndexOf('</', node.loc.end)
    const nameStart = closeAt + 2
    const nameEnd = nameStart + node.element.length
    if (closeAt < node.loc.start || doc.source.slice(nameStart, nameEnd) !== node.element) {
      throw new PatchError(`could not find the closing </${node.element}> for ${address}`)
    }
    s.overwrite(nameStart, nameEnd, element)
  }

  /*
   * The attributes the new tag requires (ADR 0008 §3), in the same edit.
   *
   * Safe to run against offsets taken from the pre-retag document because the
   * tag rewrite touches only the element name — inside `<`…`>` but outside any
   * attribute's span — so nothing here overlaps what was just overwritten.
   */
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value === null) {
      if (node.attrs[name]) removeProp(doc, s, address, name)
      continue
    }
    if (node.attrs[name]) setProp(doc, s, address, name, value)
    else addProp(doc, s, address, name, value, eol)
  }

  return { start: node.loc.start, end: node.loc.end }
}

function moveNode(
  doc: UidxDocument,
  s: MagicString,
  address: string,
  newParentAddress: string,
  index: number,
  eol: '\r\n' | '\n',
): Range {
  const node = mustResolve(doc, address)
  if (node.address === '') throw new PatchError('cannot move the root <Page>')
  const newParent = mustResolve(doc, newParentAddress, 'parent')

  if (!CONTAINER_ELEMENTS.has(newParent.element)) {
    throw new PatchError(`<${newParent.element}> cannot have children`)
  }
  refuseSyntheticPage(newParent, 'the moved node')
  if (newParent.address === node.address || isDescendant(node, newParent.address)) {
    throw new PatchError('cannot move a node into itself or its own descendant')
  }
  const oldParent = resolveParent(doc.tree, address)
  if (oldParent?.element === 'Variant') {
    throw new PatchError('cannot move the sole child of <Variant>')
  }
  if (oldParent) refuseSyntheticPage(oldParent, 'moving its only entity')

  const legal = newParent.element === 'Page' ? PAGE_CHILD_ELEMENTS : NODE_CHILD_ELEMENTS
  if (!legal.has(node.element)) {
    throw new PatchError(`<${node.element}> is not allowed inside <${newParent.element}>`)
  }
  const siblings = newParent.children.filter((c) => c !== node)
  if (newParent.element === 'Variant' && siblings.length >= 1) {
    throw new PatchError('<Variant> may have only one child')
  }
  if (newParent !== oldParent) {
    const clash = siblings.find((c) => c.name === node.name)
    if (clash) {
      throw new PatchError(
        `moving "${node.name}" into ${newParentAddress || '<root>'} would duplicate a sibling name`,
      )
    }
  }

  // Moving a node to the position it already occupies is a no-op, not an edit.
  const clamped = Math.max(0, Math.min(index, siblings.length))
  if (oldParent === newParent && newParent.children.indexOf(node) === clamped) {
    return { start: node.loc.start, end: node.loc.start }
  }

  // The moved subtree's raw text is preserved byte-for-byte apart from indent,
  // so a reorder reads as a pure block move in the diff (spec §9.5c).
  const raw = doc.source.slice(node.loc.start, node.loc.end)
  const newIndent = newParent.indent + INDENT_UNIT
  const block = newIndent + withEol(reindent(raw, node.indent, newIndent), eol)

  const removal = nodeSpanWithLeadingWhitespace(doc.source, node)
  s.remove(removal.start, removal.end)
  const inserted = insertChildBlock(doc, s, newParent, siblings, clamped, block, eol)

  return {
    start: Math.min(removal.start, inserted.start),
    end: Math.max(removal.end, inserted.end),
  }
}

// -------------------------------------------------------------------- helpers

function withName(spec: UidxNodeSpec, siblings: readonly UidxNode[]): UidxNodeSpec {
  // A `<Variant>` has no name of its own — its coordinates spell one (ADR 0005
  // §3) — so inventing one here would write an attribute UIDX118 rejects.
  if (spec.element === 'Variant') return spec
  const name = spec.attrs.name
  if (typeof name === 'string' && name !== '') {
    if (siblings.some((c) => c.name === name)) {
      throw new PatchError(`sibling name "${name}" is already taken`)
    }
    return spec
  }
  return { ...spec, attrs: { name: autoName(spec.element, siblings), ...spec.attrs } }
}

/** `[loc.start, loc.end]` extended backwards over the line's indentation and newline. */
function nodeSpanWithLeadingWhitespace(source: string, node: UidxNode): Range {
  let start = node.loc.start
  while (start > 0 && (source[start - 1] === ' ' || source[start - 1] === '\t')) start--
  if (start > 0 && source[start - 1] === '\n') {
    start--
    // Consume the paired CR too, or removing a node from a CRLF file leaves a
    // lone carriage return behind and quietly corrupts the line endings.
    if (start > 0 && source[start - 1] === '\r') start--
  }
  return { start, end: node.loc.end }
}

/**
 * The document's dominant line ending. Text this engine inserts has to match the
 * file it is going into; emitting `\n` into a CRLF document leaves it with mixed
 * endings, which shows up as a whole-file diff in some editors.
 */
function detectEol(source: string): '\r\n' | '\n' {
  return source.includes('\r\n') ? '\r\n' : '\n'
}

/** Rewrites the newlines of generated text to match the target document. */
function withEol(text: string, eol: '\r\n' | '\n'): string {
  return eol === '\n' ? text : text.replace(/\r?\n/g, eol)
}

function isDescendant(node: UidxNode, address: string): boolean {
  return isWithin(node.address, address)
}

/** Whether this node's attributes are written one per line, as `emitTree` does for two or more. */
function isMultilineTag(source: string, node: UidxNode): boolean {
  const attrs = Object.values(node.attrs)
  if (attrs.length === 0) return false
  const last = attrs.reduce((a, b) => (a.loc.end > b.loc.end ? a : b))
  return lineOf(source, last.loc.start) !== lineOf(source, node.loc.start)
}

function lineOf(source: string, offset: number): number {
  let line = 0
  for (let i = 0; i < offset; i++) if (source.charCodeAt(i) === 10) line++
  return line
}

function indentOfLine(source: string, offset: number): string {
  const start = source.lastIndexOf('\n', offset - 1) + 1
  const match = /^[ \t]*/.exec(source.slice(start))
  return match ? match[0] : ''
}

/**
 * Shifts a block's indentation while preserving relative depth. The first line
 * carries no indent (it begins at `loc.start`, past the original indentation).
 */
function reindent(raw: string, oldIndent: string, newIndent: string): string {
  if (oldIndent === newIndent) return raw
  return raw
    .split('\n')
    .map((line, i) => {
      if (i === 0) return line
      if (line.trim() === '') return line
      return line.startsWith(oldIndent) ? newIndent + line.slice(oldIndent.length) : line
    })
    .join('\n')
}
