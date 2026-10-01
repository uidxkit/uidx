import MagicString from 'magic-string'

import { autoName, emitTree, INDENT_UNIT } from './emit.js'
import { isWithin, parse, parseOrThrow, resolve, resolveParent } from './parse.js'
import { serializeValue } from './values.js'
import { writeContractElement, writeIntent, writeRegion } from './region-patch.js'
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
  type ContractDeclaration,
  type ContractKind,
  type FieldSpec,
  type ModelSpec,
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

/** Which node a patch names, for a message. Insert names its parent; a style op its row. */
function addressOfPatch(patch: UidxPatch): string {
  if (patch.op === 'style')
    return `<Style ${Object.entries(patch.keys)
      .map(([axis, value]) => `${axis}="${value}"`)
      .join(' ')}>`
  if (patch.op === 'contract') return `<${CONTRACT_LISTS[patch.kind][1]} name="${patch.name}">`
  if (patch.op === 'model') return `<Model name="${patch.name}">`
  if (patch.op === 'field') return `<Field name="${patch.name}"> of ${patch.model}`
  if (patch.op === 'region') return `## ${patch.name}`
  if (patch.op === 'intent') return 'the intent'
  if (patch.op === 'contract-element') return `<${patch.element}>`
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
      case 'style':
        return styleCell(doc, s, patch, eol)
      case 'contract':
        return contractDeclaration(doc, s, patch, eol)
      case 'model':
        return modelDeclaration(doc, s, patch, eol)
      case 'field':
        return fieldDeclaration(doc, s, patch, eol)
      case 'region':
        return writeRegion(doc, s, patch, eol)
      case 'intent':
        return writeIntent(doc, s, patch, eol)
      case 'contract-element':
        return writeContractElement(doc, s, patch, eol)
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

/* ------------------------------------------------- the contract region */

/** Per kind: the list element and the item element (ADR 0013 §2). */
export const CONTRACT_LISTS: Record<ContractKind, [list: string, item: string]> = {
  prop: ['Props', 'Prop'],
  event: ['Events', 'Event'],
  slot: ['Slots', 'Slot'],
  state: ['States', 'State'],
  part: ['Parts', 'Part'],
}

/** The bare boolean attributes of the contract (ADR 0013 §2). */
const CONTRACT_FLAGS: ReadonlySet<string> = new Set(['controllable', 'visual'])

/** Attribute order in canonical form, per item; flags print bare when true. */
const CONTRACT_ATTR_ORDER: Record<ContractKind, readonly string[]> = {
  prop: ['type', 'default', 'sample', 'controllable', 'visual'],
  event: ['detail'],
  slot: ['accepts'],
  state: [],
  part: [],
}

/** The declared items of one kind, as the spec holds them, with their spans. */
function contractItems(doc: UidxDocument, kind: ContractKind): { name: string; loc: Range }[] {
  const contract = doc.spec?.contract
  if (!contract) return []
  switch (kind) {
    case 'prop':
      return contract.props
    case 'event':
      return contract.events
    case 'slot':
      return contract.slots
    case 'state':
      return contract.states
    case 'part':
      return contract.parts
  }
}

/** `<Prop name="x" type="string" visual>Words.</Prop>`, canonical. */
export function printContractItem(
  kind: ContractKind,
  name: string,
  declaration: ContractDeclaration,
): string {
  const item = CONTRACT_LISTS[kind][1]
  const attrs = [`name=${serializeValue(name)}`]
  const known = CONTRACT_ATTR_ORDER[kind]
  const order = [...known, ...Object.keys(declaration.attrs).filter((k) => !known.includes(k))]
  for (const key of order) {
    const value = declaration.attrs[key]
    if (value === undefined || value === null) continue
    // A flag is written bare when set and left out when not; any other
    // boolean is a value (`default={false}`) and prints as one.
    if (CONTRACT_FLAGS.has(key)) {
      if (value === true) attrs.push(key)
      continue
    }
    attrs.push(`${key}=${serializeValue(value)}`)
  }
  return `<${item} ${attrs.join(' ')}>${declaration.description}</${item}>`
}

/**
 * One element of the contract, written or removed (ADR 0013 §2).
 *
 * An existing element is overwritten in place, so its neighbours keep their
 * formatting. A new one goes at the end of its list; a list that does not
 * exist is created at the end of the region, and a region that does not
 * exist is created after the visual contract and its styles, before any
 * other region. A removal that empties a list removes the list.
 */
function contractDeclaration(
  doc: UidxDocument,
  s: MagicString,
  patch: Extract<UidxPatch, { op: 'contract' }>,
  eol: '\r\n' | '\n',
): Range {
  if (patch.name === '') throw new PatchError('a contract op names the element it declares')
  const [list] = CONTRACT_LISTS[patch.kind]
  const items = contractItems(doc, patch.kind)
  const existing = items.find((item) => item.name === patch.name)
  const source = doc.source

  if (!patch.declaration) {
    if (!existing)
      throw new PatchError(`${addressOfPatch(patch)} is not declared; nothing to remove`)
    if (items.length === 1) {
      // The last item takes its list with it, and the blank line before it.
      const open = source.lastIndexOf(`<${list}`, existing.loc.start)
      const close = source.indexOf(`</${list}>`, existing.loc.end)
      if (open === -1 || close === -1)
        throw new PatchError(`cannot find <${list}> around ${patch.name}`)
      let from = open
      // The last declaration of the whole region takes the heading with it
      // too: a `## Contract` over nothing is a region the file does not need.
      const contract = doc.spec?.contract
      const emptied =
        contract !== undefined &&
        (['prop', 'event', 'slot', 'state', 'part'] as ContractKind[])
          .filter((kind) => kind !== patch.kind)
          .every((kind) => contractItems(doc, kind).length === 0) &&
        contract.form === undefined &&
        contract.accessibility === undefined &&
        contract.composes.length === 0
      if (emptied) {
        const heading = source.lastIndexOf('## Contract', open)
        if (heading !== -1) from = heading
      }
      while (from > 0 && /\s/.test(source[from - 1]!)) from--
      s.remove(from, close + `</${list}>`.length)
      return { start: from, end: from }
    }
    const span = nodeSpanWithLeadingWhitespace(source, { loc: existing.loc } as UidxNode)
    s.remove(span.start, span.end)
    return { start: span.start, end: span.start }
  }

  const text = printContractItem(patch.kind, patch.name, patch.declaration)
  if (existing) {
    s.overwrite(existing.loc.start, existing.loc.end, text)
    return { start: existing.loc.start, end: existing.loc.start + text.length }
  }
  if (items.length) {
    // After the last item, at its indentation.
    const last = items[items.length - 1]!
    const indent = indentOfLine(source, last.loc.start)
    const insertion = `${eol}${indent}${text}`
    s.appendRight(last.loc.end, insertion)
    return { start: last.loc.end, end: last.loc.end + insertion.length }
  }

  const block = `<${list}>${eol}${INDENT_UNIT}${text}${eol}</${list}>`
  const contract = doc.spec?.contract
  if (contract) {
    // The region's end: the next region's heading, or the end of the file.
    const regionEnd = Math.min(
      ...[doc.spec?.behavior, doc.spec?.models, doc.spec?.examples]
        .flatMap((region) => (region ?? []).map((entry) => entry.loc.start))
        .filter((start) => start > contract.loc.end),
      source.length,
    )
    let at = regionEnd
    while (at > contract.loc.end && /\s/.test(source[at - 1]!)) at--
    const insertion = `${eol}${eol}${block}`
    s.appendRight(at, insertion)
    return { start: at, end: at + insertion.length }
  }
  // No `## Contract` yet: before the other regions, or at the end of the file.
  const at = doc.trailing ? doc.trailing.loc.start : source.length
  let from = at
  while (from > 0 && /\s/.test(source[from - 1]!)) from--
  const insertion = `${eol}${eol}## Contract${eol}${eol}${block}${doc.trailing ? `${eol}${eol}` : eol}`
  s.overwrite(from, at, insertion)
  return { start: from, end: from + insertion.length }
}

/* ------------------------------------------------- the models region */

/** The bare boolean attributes of a field (ADR 0015 §1). */
const FIELD_FLAGS: ReadonlySet<string> = new Set(['key', 'optional'])
const FIELD_ATTR_ORDER: readonly string[] = ['type', 'key', 'optional', 'sample']

/** `<Field name="x" type="string" key sample={[…]}>Words.</Field>`, canonical. */
export function printField(name: string, declaration: ContractDeclaration): string {
  const attrs = [`name=${serializeValue(name)}`]
  const order = [
    ...FIELD_ATTR_ORDER,
    ...Object.keys(declaration.attrs).filter((k) => !FIELD_ATTR_ORDER.includes(k)),
  ]
  for (const key of order) {
    const value = declaration.attrs[key]
    if (value === undefined) continue
    if (FIELD_FLAGS.has(key)) {
      if (value === true) attrs.push(key)
      continue
    }
    if (value === null && key !== 'sample') continue
    attrs.push(`${key}=${serializeValue(value)}`)
  }
  const open = `<Field ${attrs.join(' ')}`
  return declaration.description ? `${open}>${declaration.description}</Field>` : `${open} />`
}

/** One model in canonical form: its words, then its fields, one per line. */
export function printModel(
  model: {
    name: string
    description: string
    fields: readonly { name: string; declaration: ContractDeclaration }[]
  },
  eol: '\r\n' | '\n' = '\n',
): string {
  const lines = [`<Model name=${serializeValue(model.name)}>`]
  const words = model.description.trim()
  if (words) lines.push(`${INDENT_UNIT}${words}`)
  for (const field of model.fields)
    lines.push(`${INDENT_UNIT}${printField(field.name, field.declaration)}`)
  lines.push('</Model>')
  return lines.join(eol)
}

/** A field as the `field` op would write it back. */
export function fieldDeclarationOf(field: FieldSpec): ContractDeclaration {
  const attrs: Record<string, JsonValue> = { type: field.type }
  if (field.key) attrs.key = true
  if (field.optional) attrs.optional = true
  if (field.sample !== undefined) attrs.sample = field.sample
  return { attrs, description: field.description }
}

/**
 * Writes a model — new, changed or removed — reprinting it whole (ADR 0015
 * §1), the way `styleCell` reprints the table: a model is a few lines and a
 * hand-wrapped one is normalised the first time the inspector writes to it.
 * A new model goes after the last; the region is created before `## Examples`
 * or at the end of the file; a removal that empties the region removes it.
 */
function writeModel(
  doc: UidxDocument,
  s: MagicString,
  name: string,
  next: {
    description: string
    fields: { name: string; declaration: ContractDeclaration }[]
  } | null,
  eol: '\r\n' | '\n',
): Range {
  const source = doc.source
  const models = doc.spec?.models ?? []
  const existing = models.find((model) => model.name === name)
  if (next === null) {
    if (!existing) throw new PatchError(`<Model name="${name}"> is not declared; nothing to remove`)
    if (models.length === 1) {
      const heading = source.lastIndexOf('## Models', existing.loc.start)
      let from = heading === -1 ? existing.loc.start : heading
      while (from > 0 && /\s/.test(source[from - 1]!)) from--
      s.remove(from, existing.loc.end)
      return { start: from, end: from }
    }
    // Models are blocks a blank line apart: the blank line goes with it.
    let from = existing.loc.start
    while (from > 0 && /\s/.test(source[from - 1]!)) from--
    s.remove(from, existing.loc.end)
    return { start: from, end: from }
  }
  const text = printModel({ name, ...next }, eol)
  if (existing) {
    s.overwrite(existing.loc.start, existing.loc.end, text)
    return { start: existing.loc.start, end: existing.loc.start + text.length }
  }
  if (models.length) {
    const last = models[models.length - 1]!
    const insertion = `${eol}${eol}${text}`
    s.appendRight(last.loc.end, insertion)
    return { start: last.loc.end, end: last.loc.end + insertion.length }
  }
  // No `## Models` yet: before `## Examples` when there is one, else last.
  const examples = doc.spec?.examples ?? []
  const examplesHeading = examples.length
    ? source.lastIndexOf('## Examples', examples[0]!.loc.start)
    : -1
  if (examplesHeading !== -1) {
    const insertion = `## Models${eol}${eol}${text}${eol}${eol}`
    s.appendLeft(examplesHeading, insertion)
    return { start: examplesHeading, end: examplesHeading + insertion.length }
  }
  let from = source.length
  while (from > 0 && /\s/.test(source[from - 1]!)) from--
  const insertion = `${eol}${eol}## Models${eol}${eol}${text}${eol}`
  s.overwrite(from, source.length, insertion)
  return { start: from, end: from + insertion.length }
}

const fieldsOf = (model: ModelSpec): { name: string; declaration: ContractDeclaration }[] =>
  model.fields.map((field) => ({ name: field.name, declaration: fieldDeclarationOf(field) }))

function modelDeclaration(
  doc: UidxDocument,
  s: MagicString,
  patch: Extract<UidxPatch, { op: 'model' }>,
  eol: '\r\n' | '\n',
): Range {
  if (patch.name === '') throw new PatchError('a model op names the model it declares')
  const existing = doc.spec?.models?.find((model) => model.name === patch.name)
  if (!patch.declaration) return writeModel(doc, s, patch.name, null, eol)
  return writeModel(
    doc,
    s,
    patch.name,
    { description: patch.declaration.description, fields: existing ? fieldsOf(existing) : [] },
    eol,
  )
}

function fieldDeclaration(
  doc: UidxDocument,
  s: MagicString,
  patch: Extract<UidxPatch, { op: 'field' }>,
  eol: '\r\n' | '\n',
): Range {
  if (patch.name === '') throw new PatchError('a field op names the field it declares')
  const model = doc.spec?.models?.find((entry) => entry.name === patch.model)
  if (!model) throw new PatchError(`<Model name="${patch.model}"> is not declared`)
  const fields = fieldsOf(model)
  const at = fields.findIndex((field) => field.name === patch.name)
  if (!patch.declaration) {
    if (at === -1)
      throw new PatchError(`${addressOfPatch(patch)} is not declared; nothing to remove`)
    fields.splice(at, 1)
  } else if (at === -1) fields.push({ name: patch.name, declaration: patch.declaration })
  else fields[at] = { name: patch.name, declaration: patch.declaration }
  return writeModel(doc, s, model.name, { description: model.description, fields }, eol)
}

/* ------------------------------------------------- the styles table */

/** The `<Styles>` block's span in the source, found by its rows, or null. */
function stylesSpan(doc: UidxDocument): Range | null {
  const rows = doc.spec?.styles ?? []
  if (rows.length === 0) return null
  const open = doc.source.lastIndexOf('<Styles', rows[0]!.loc.start)
  const close = doc.source.indexOf('</Styles>', rows[rows.length - 1]!.loc.end)
  if (open === -1 || close === -1) return null
  return { start: open, end: close + '</Styles>'.length }
}

const sameKeys = (a: Record<string, string>, b: Record<string, string>): boolean =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(([axis, value]) => b[axis] === value)

/** The table printed in canonical style: one `<Style>` per row, keys first, then `target:prop` cells. */
function printStyles(
  rows: readonly {
    keys: Record<string, string>
    values: Record<string, Record<string, JsonValue>>
  }[],
  eol: '\r\n' | '\n',
): string {
  const lines = ['<Styles>']
  for (const row of rows) {
    const keys = Object.entries(row.keys).map(([axis, value]) => `${axis}=${serializeValue(value)}`)
    const cells = Object.entries(row.values).flatMap(([target, props]) =>
      Object.entries(props).map(([prop, value]) => `${target}:${prop}=${serializeValue(value)}`),
    )
    lines.push(`${INDENT_UNIT}<Style ${[...keys, ...cells].join(' ')} />`)
  }
  lines.push('</Styles>')
  return lines.join(eol)
}

/**
 * One cell of the styles table, set or cleared (ADR 0016 §2).
 *
 * The whole block is reprinted rather than one row spliced: rows are one
 * line each in canonical style, and a table an author hand-wrapped is
 * normalised the first time the canvas writes to it — the same rule
 * `insert-node` follows for a created node. A table that ends empty is
 * removed with the blank lines before it; a table that did not exist is
 * placed after the visual contract, where ADR 0016 puts it.
 */
function styleCell(
  doc: UidxDocument,
  s: MagicString,
  patch: Extract<UidxPatch, { op: 'style' }>,
  eol: '\r\n' | '\n',
): Range {
  const whole = patch.target === '' && patch.prop === ''
  if (
    Object.keys(patch.keys).length === 0 ||
    (!whole && (patch.target === '' || patch.prop === ''))
  ) {
    throw new PatchError('a style op names a row by its keys, a target and a prop')
  }
  const rows = (doc.spec?.styles ?? []).map((row) => ({
    keys: { ...row.keys },
    values: Object.fromEntries(
      Object.entries(row.values).map(([target, props]) => [target, { ...props }]),
    ),
  }))
  let row = rows.find((entry) => sameKeys(entry.keys, patch.keys))
  if (whole) {
    // The whole row (an empty target and prop): written with these cells, an
    // empty object making a state exist before it has a look, or removed.
    if (patch.value === undefined) {
      if (!row) throw new PatchError(`${addressOfPatch(patch)} is not in the styles table`)
      rows.splice(rows.indexOf(row), 1)
    } else {
      const cells = patch.value
      if (cells === null || typeof cells !== 'object' || Array.isArray(cells))
        throw new PatchError('a whole style row is written as { target: { prop: value } }')
      const values = Object.fromEntries(
        Object.entries(cells).map(([target, props]) => [
          target,
          { ...(props as Record<string, JsonValue>) },
        ]),
      )
      if (row) row.values = values
      else rows.push({ keys: { ...patch.keys }, values })
    }
  } else if (patch.value === undefined) {
    const props = row?.values[patch.target]
    if (!row || !props || !(patch.prop in props)) {
      throw new PatchError(`${addressOfPatch(patch)} has no ${patch.target}:${patch.prop} to clear`)
    }
    delete props[patch.prop]
    if (Object.keys(props).length === 0) delete row.values[patch.target]
    if (Object.keys(row.values).length === 0) rows.splice(rows.indexOf(row), 1)
  } else {
    if (!row) {
      row = { keys: { ...patch.keys }, values: {} }
      rows.push(row)
    }
    ;(row.values[patch.target] ??= {})[patch.prop] = patch.value
  }

  const span = stylesSpan(doc)
  if (span) {
    if (rows.length === 0) {
      let from = span.start
      while (from > 0 && /\s/.test(doc.source[from - 1]!)) from--
      s.remove(from, span.end)
      return { start: from, end: from }
    }
    const text = printStyles(rows, eol)
    s.overwrite(span.start, span.end, text)
    return { start: span.start, end: span.start + text.length }
  }
  // No table yet: after the visual contract. A bare `<Component>` root has
  // no `<Page>` span, so its last entity marks the end instead.
  const tree = doc.tree
  const end = tree.synthetic ? (tree.children.at(-1)?.loc.end ?? tree.loc.end) : tree.loc.end
  const text = `${eol}${eol}${printStyles(rows, eol)}`
  s.appendRight(end, text)
  return { start: end, end: end + text.length }
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
