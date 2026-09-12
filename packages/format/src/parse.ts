import { mapLengthLeaves, parseLength, isUnitLength, UNITLESS_NUMBER_PROPS } from './lengths.js'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { mdxExpressionFromMarkdown } from 'mdast-util-mdx-expression'
import { mdxJsxFromMarkdown } from 'mdast-util-mdx-jsx'
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter'
import { frontmatter } from 'micromark-extension-frontmatter'
import { mdxExpression } from 'micromark-extension-mdx-expression'
import { mdxJsx } from 'micromark-extension-mdx-jsx'
import { mdxMd } from 'micromark-extension-mdx-md'
import { parse as parseYaml } from 'yaml'

import { CODES, diagnostic, UidxError } from './diagnostics.js'
import { parseExpression, ValueError } from './values.js'
import { fitsVariableType, isAlias, variableTypeOf } from './alias.js'
import { componentProps, instanceProps } from './component-props.js'
import {
  componentVariants,
  defaultCombination,
  variantCoordinates,
  variantName,
} from './variants.js'
import {
  CONTAINER_ELEMENTS,
  ELEMENTS,
  ENTITY_SEP,
  legalChildElementsOf,
  METADATA_ATTRS,
  PATH_SEP,
  ROOT_ELEMENTS,
  TOKEN_ELEMENTS,
  VARIABLE_SCOPES,
  VARIABLE_TYPES,
  type Diagnostic,
  type ParseResult,
  type Range,
  type UidxAttr,
  type UidxDocument,
  type UidxElement,
  type UidxNode,
  type VariableType,
} from './types.js'

const CONTRACT_HEADING = 'Visual Contract'

/** Spec §3.2. */
export const STATUSES = ['draft', 'stable', 'deprecated'] as const
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** The layout modes under which a parent places its children itself. */
export const FLOW_MODES = new Set(['HORIZONTAL', 'VERTICAL', 'GRID'])

/* eslint-disable @typescript-eslint/no-explicit-any */
type MdastNode = any

/**
 * Finds the end of an element's open tag, i.e. the offset just past the `>` that
 * closes `<Frame ...>` or `<Vector ... />`.
 *
 * Scans rather than regexes because `>` occurs freely inside attribute strings
 * and expression values.
 */
export function findOpenTagEnd(source: string, start: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = start + 1; i < source.length; i++) {
    const c = source[i]!
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return i + 1
  }
  return -1
}

/** Leading whitespace of the line that `offset` sits on. */
function indentAt(source: string, offset: number): string {
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1
  const slice = source.slice(lineStart, offset)
  return /^[ \t]*$/.test(slice) ? slice : ''
}

export function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function rangeOf(node: MdastNode): Range {
  return { start: node.position.start.offset, end: node.position.end.offset }
}

/** What may appear directly inside `parent`, per the grammar of its tree. */
/**
 * Delegates to the one table (`legalChildElementsOf`), which the viewer's
 * `canInsert` reads too — the rule has exactly one home.
 *
 * The comments the switch used to carry live with the table now, except this
 * one: whether a *particular* `<Component>` may hold a `<Variant>` depends on
 * whether it declares `variants`, which no table of element names can say.
 * `checkVariantShape` says it, with the sentence that names the fix — and
 * `checkSlotPosition` does the same for the three positions a `<Slot>` is
 * refused in.
 */
const legalChildrenOf = legalChildElementsOf

/**
 * ADR 0004 §3 — `#` bounds the entity, `/` walks inside it.
 *
 * The first separator a node gets is `#`, because its parent is the page and it
 * is therefore an entity; everything deeper joins with `/`. A token address is
 * the same law one tree over: `radius#md` is the `md` variable of the `radius`
 * collection.
 */
export function addressOf(parentAddress: string, name: string): string {
  if (parentAddress === '') return name
  return parentAddress.includes(ENTITY_SEP)
    ? `${parentAddress}${PATH_SEP}${name}`
    : `${parentAddress}${ENTITY_SEP}${name}`
}

export class Lowerer {
  readonly diagnostics: Diagnostic[] = []
  constructor(private readonly source: string) {}

  error(code: string, message: string, loc: Range): void {
    this.diagnostics.push(diagnostic(this.source, code, message, loc))
  }

  warn(code: string, message: string, loc: Range): void {
    this.diagnostics.push(diagnostic(this.source, code, message, loc, 'warning'))
  }

  /**
   * Derives the value span from the attribute span. `mdxJsxAttributeValueExpression`
   * carries no position of its own, so the `=` is located by hand and the value
   * runs from there to the end of the attribute.
   */
  private valueRange(attrLoc: Range, nameLength: number): Range | null {
    let i = attrLoc.start + nameLength
    while (i < attrLoc.end && /\s/.test(this.source[i]!)) i++
    if (this.source[i] !== '=') return null
    i++
    while (i < attrLoc.end && /\s/.test(this.source[i]!)) i++
    return { start: i, end: attrLoc.end }
  }

  attributes(el: MdastNode): Record<string, UidxAttr> {
    const attrs: Record<string, UidxAttr> = {}
    for (const raw of el.attributes ?? []) {
      const loc = rangeOf(raw)

      if (raw.type === 'mdxJsxExpressionAttribute') {
        this.error(CODES.SPREAD_ATTR, 'spread attributes are not part of the UIDX grammar', loc)
        continue
      }

      const name: string = raw.name
      if (attrs[name]) {
        this.error(CODES.DUPLICATE_ATTR, `duplicate attribute "${name}"`, loc)
        continue
      }

      if (raw.value === null || raw.value === undefined) {
        this.error(
          CODES.SHORTHAND_ATTR,
          `attribute "${name}" needs an explicit value; shorthand is not allowed`,
          loc,
        )
        continue
      }

      const valueLoc = this.valueRange(loc, name.length)
      if (!valueLoc) {
        this.error(CODES.BAD_VALUE, `could not locate the value of "${name}"`, loc)
        continue
      }
      const text = this.source.slice(valueLoc.start, valueLoc.end)

      if (typeof raw.value === 'string') {
        attrs[name] = { name, raw: text, value: raw.value, loc, valueLoc }
        continue
      }

      // mdxJsxAttributeValueExpression — strip the braces, parse the literal.
      const inner = text.startsWith('{') && text.endsWith('}') ? text.slice(1, -1) : raw.value.value
      try {
        attrs[name] = { name, raw: text, value: parseExpression(inner), loc, valueLoc }
      } catch (err) {
        const message = err instanceof ValueError ? err.message : String(err)
        this.error(CODES.BAD_VALUE, `attribute "${name}": ${message}`, valueLoc)
      }
    }
    return attrs
  }

  element(
    el: MdastNode,
    parentAddress: string | null,
    parentElement: UidxElement | null,
    rootName: string,
    /**
     * The axes in scope for a `<Variant>` child (ADR 0005 §3), or null when the
     * parent declares none.
     *
     * Passed down rather than read back off the parent node, because a variant
     * is *named* by its coordinates: the name has to exist before the address
     * does, and the address before the children are lowered. Null is what makes
     * `<Variant>` under a plain component an error rather than a crash.
     */
    axes: ReadonlyMap<string, readonly string[]> | null = null,
    /**
     * The modes in scope for a `<Variable>` child (story G8), or null when the
     * parent collection declares none.
     *
     * Handed down exactly as `axes` is, and for a version of the same reason:
     * the either/or rule is a fact about the *collection* that only the
     * variable can be checked against, and reading it back off the parent node
     * would mean trusting a shape this pass has not validated yet.
     */
    modes: readonly string[] | null = null,
    /**
     * Whether this node sits inside a `<Slot>` fill (ADR 0007 §2).
     *
     * Passed down rather than derived, because "inside a fill" is a *position*
     * and not a parent element: the fill's own children are ordinary scene
     * nodes whose parent is a `<Slot>`, indistinguishable from a slot's default
     * content without knowing which side of the instance boundary they are on.
     */
    inFill = false,
    /**
     * Whether this node sits anywhere inside a `<Component>` (ADR 0007 §1).
     *
     * Threaded for the reason `inFill` is: it is a fact about *position* that
     * no parent element can carry. A `<Slot>` two frames deep on a page has a
     * `<Frame>` for a parent, exactly like a slot two frames deep inside a
     * component — and one of them is a hole nobody can fill.
     */
    inComponent = false,
    /**
     * Whether the *parent* lays this node out (ADR 0011 §6).
     *
     * Threaded like `inFill` and `inComponent`, and for the same reason: it is
     * a fact about the parent that no attribute of the child can carry. A pin
     * inside a flowing parent is a sentence with no subject — the parent is
     * already answering the question the pin asks.
     */
    parentFlows = false,
  ): UidxNode | null {
    const loc = rangeOf(el)
    const elementName: string = el.name ?? ''

    if (!(ELEMENTS as readonly string[]).includes(elementName)) {
      this.error(
        CODES.UNKNOWN_ELEMENT,
        `unknown element <${elementName || '?'}>; allowed: ${ELEMENTS.join(', ')}`,
        loc,
      )
      return null
    }
    const element = elementName as UidxElement
    const isRoot = parentAddress === null

    // ADR 0007 §1 and §2 refuse three positions, each for its own reason. The
    // child tables can say "not here" but not "because a hole outside a
    // component has nobody to fill it", and the sentence is the whole value —
    // so this runs ahead of the generic check and owns its own code.
    if (
      element === 'Slot' &&
      !this.checkSlotPosition(parentElement, isRoot, inFill, inComponent, loc)
    ) {
      return null
    }

    // Two-level grammar (ADR 0003 §1). `<Page>` is root-only, and a definition
    // cannot nest inside a node — which is what keeps "definition" meaningful.
    // Token files (G5) are the same idea one shape over: Tokens → Collection →
    // Variable, with no way to mix the two trees.
    if (!isRoot) {
      const legal = legalChildrenOf(parentElement)
      if (!legal.has(element)) {
        this.error(
          CODES.ELEMENT_NOT_ALLOWED_HERE,
          `<${element}> is not allowed inside <${parentElement}>; allowed here: ${[...legal].join(', ')}`,
          loc,
        )
        return null
      }
    }

    const attrs = this.attributes(el)

    let name: string
    if (isRoot) {
      if (attrs.name) {
        this.error(
          CODES.NAME_ON_ROOT,
          `the root <${element}> takes its name from the frontmatter \`id\`; remove this attribute`,
          attrs.name.loc,
        )
      }
      name = rootName
    } else if (element === 'Variant') {
      // ADR 0005 §3: a variant has no name of its own. Deriving it here rather
      // than reading one means the microformat this ADR exists to delete —
      // `State=Hover` as identity-in-a-string — survives only as a spelling
      // generated from checked attributes, where it cannot drift.
      if (!axes) {
        this.error(
          CODES.VARIANT_SHAPE,
          "<Variant> is one of a component's states, so the <Component> above it must declare " +
            "its axes, e.g. variants={{ state: ['default', 'hover'] }}",
          loc,
        )
        return null
      }
      const { coordinates, problems } = variantCoordinates({ attrs } as UidxNode, axes)
      for (const problem of problems) {
        this.error(CODES.BAD_VARIANT, problem.detail, attrs[problem.axis]?.loc ?? loc)
      }
      // Named from what was understood even when something was not: an error
      // means `parse` yields no document, so the only job left is to collect
      // every other diagnostic in the file rather than stop at the first.
      name = variantName(coordinates)
    } else {
      const nameAttr = attrs.name
      if (!nameAttr || typeof nameAttr.value !== 'string') {
        this.error(CODES.MISSING_NAME, `<${element}> requires a string "name" attribute`, loc)
        return null
      }
      name = nameAttr.value
      if (!this.checkName(name, parentElement === 'Page', nameAttr.loc)) return null
    }

    if (!TOKEN_ELEMENTS.has(element) && element !== 'Variant') {
      for (const [prop, attr] of Object.entries(attrs)) {
        mapLengthLeaves(prop, attr.value, (value) => {
          if (value !== null && !isAlias(value) && !parseLength(value)) {
            this.error(
              CODES.BAD_LENGTH,
              `${prop} expects a finite number, px or rem length`,
              attr.loc,
            )
          }
          return value
        })
        if (UNITLESS_NUMBER_PROPS.has(prop) && isUnitLength(attr.value)) {
          this.error(CODES.BAD_LENGTH, `${prop} does not accept length units`, attr.loc)
        }
      }
    }
    if (
      attrs.rootFontSize &&
      (!['Page', 'Tokens'].includes(element) ||
        typeof attrs.rootFontSize.value !== 'number' ||
        attrs.rootFontSize.value <= 0)
    )
      this.error(
        CODES.BAD_LENGTH,
        'rootFontSize must be a positive pixel number on Page or Tokens',
        attrs.rootFontSize.loc,
      )
    this.checkMetadata(element, attrs)
    if (element === 'Variable') this.checkVariable(attrs, loc)
    if (element === 'Variable') this.checkScopes(attrs)
    // Scene elements only: a `<Collection>`'s `modes` is the array declaring
    // them, not a node selecting one, and `checkCollection` owns that shape.
    if (!TOKEN_ELEMENTS.has(element)) this.checkNodeModes(attrs)
    this.checkInstance(element, attrs, loc)
    this.checkComponentProps(element, attrs)
    this.checkPins(attrs, parentElement, parentFlows, loc)
    if (element === 'Slot' && parentElement === 'Instance') this.checkSlotFill(attrs)

    // ADR 0003 §2: the root Page's address is the empty string.
    //
    // A `<Mode>` is a value carrier rather than an entity, so it gets the same
    // empty address: `addressOf` would join with `/` here — producing
    // `semantic#surface/light` — which is exactly the address a variable named
    // `surface/light` already owns. A silent collision is the worst kind.
    const address = isRoot || element === 'Mode' ? '' : addressOf(parentAddress, name)

    const openTagEnd = findOpenTagEnd(this.source, loc.start)
    const openTagLoc: Range = {
      start: loc.start,
      end: openTagEnd === -1 ? loc.end : openTagEnd,
    }

    const node: UidxNode = {
      element,
      name,
      address,
      attrs,
      children: [],
      loc,
      openTagLoc,
      selfClosing: openTagLoc.end === loc.end,
      indent: indentAt(this.source, loc.start),
    }

    const childElements = this.childElements(el, element)
    const canHaveChildren = CONTAINER_ELEMENTS.has(element)

    if (!canHaveChildren && childElements.length) {
      this.error(CODES.CHILDREN_NOT_ALLOWED, `<${element}> cannot have children`, loc)
      return node
    }

    /**
     * The axes this node's `<Variant>` children are named by (ADR 0005).
     *
     * Declared once, read once, and handed down — so a variant's coordinates
     * are checked against the same list the derivation orders them by, and the
     * two can never disagree.
     */
    const declaredAxes = element === 'Component' ? this.checkVariants(node) : null

    /** The modes this node's `<Variable>` children are checked against (G8). */
    const declaredModes = element === 'Collection' ? this.checkCollection(attrs) : null

    const seen = new Map<string, UidxNode>()
    for (const child of childElements) {
      const lowered = this.element(
        child,
        address,
        element,
        rootName,
        declaredAxes,
        declaredModes,
        // Everything under a fill is inside it; the fill itself is not.
        inFill || (element === 'Slot' && parentElement === 'Instance'),
        inComponent || element === 'Component',
        FLOW_MODES.has(attrs.layoutMode?.value as string),
      )
      if (!lowered) continue
      const previous = seen.get(lowered.name)
      if (previous) {
        const at = diagnostic(this.source, '', '', previous.loc)
        // A duplicate combination arrives here as a duplicate derived name,
        // which is correct mechanically and wrong to say out loud: nobody wrote
        // that name, so it gets the sentence about the thing they did write.
        // Two fills for one slot arrive here as a duplicate sibling name, which
        // is right mechanically and wrong to say out loud: the author wrote one
        // slot name twice, and the fix is to merge them rather than rename one.
        const isFill = lowered.element === 'Slot' && element === 'Instance'
        this.error(
          lowered.element === 'Variant'
            ? CODES.DUPLICATE_VARIANT
            : isFill
              ? CODES.DUPLICATE_SLOT_FILL
              : CODES.DUPLICATE_SIBLING_NAME,
          lowered.element === 'Variant'
            ? `another <Variant> already covers ${lowered.name || 'this combination'} ` +
                `(at ${at.line}:${at.column})`
            : isFill
              ? `this instance already fills the slot "${lowered.name}" ` +
                `(at ${at.line}:${at.column}); one slot takes one fill, so put the ` +
                `content in that one`
              : `duplicate sibling name "${lowered.name}" (first at ${at.line}:${at.column})`,
          lowered.loc,
        )
        continue
      }
      seen.set(lowered.name, lowered)
      node.children.push(lowered)
    }

    if (element === 'Component') this.checkVariantShape(node, declaredAxes, loc)
    if (element === 'Component') this.checkSlotNames(node, declaredAxes !== null)
    if (element === 'Variable') this.checkVariableModes(node, modes, loc)

    // ADR 0005 §1 generalises the one-child rule rather than breaking it: a
    // `<Component>` holds exactly one scene child, or — when it declares
    // `variants` — one or more `<Variant>` children that each hold exactly one.
    if (element === 'Variant' && node.children.length !== 1) {
      this.error(
        CODES.COMPONENT_ARITY,
        `<Variant> must have exactly one child, found ${node.children.length}`,
        loc,
      )
    }
    // ADR 0008 §1: a `<Component>` *is* a frame, so it holds what a frame holds
    // — any number of children, and none. The one-child rule it used to share
    // with `<Variant>` was never the same rule: a variant is one state's tree
    // and `arrangeVariants` measures one box per variant, which is why §2
    // leaves that half alone.
    //
    // A relaxation rather than a break: one is a number, so every file written
    // under the old rule still parses and still addresses the same way.

    return node
  }

  /**
   * ADR 0003 §4 — a bare `<Component>` root is sugar for a page holding exactly
   * one component. The wrapper has no source span of its own, so it is marked
   * `synthetic` and the patcher refuses to write through it; `uidx fmt`
   * materialises it, since `emitDocument` prints the tree it is given.
   */
  syntheticPage(el: MdastNode, rootName: string): UidxNode | null {
    const component = this.element(el, '', 'Page', rootName)
    if (!component) return null
    const at = component.loc.start
    return {
      element: 'Page',
      name: rootName,
      address: '',
      attrs: {},
      children: [component],
      loc: component.loc,
      openTagLoc: { start: at, end: at },
      selfClosing: false,
      indent: component.indent,
      synthetic: true,
    }
  }

  /**
   * ADR 0003 §3 — `status` and `version` describe a component, so they live on
   * `<Component>` and nowhere else. `status` is required there for the same
   * reason spec §3.2 required it of a file: a design contract that does not
   * declare its maturity is a contract nobody can rely on.
   */
  private checkMetadata(element: UidxElement, attrs: Record<string, UidxAttr>): void {
    if (element !== 'Component') {
      for (const meta of METADATA_ATTRS) {
        const attr = attrs[meta]
        if (attr) {
          this.error(
            CODES.METADATA_ATTR_MISPLACED,
            `"${meta}" describes a component; <${element}> cannot carry it`,
            attr.loc,
          )
        }
      }
      return
    }

    /*
     * ADR 0009 §1 — optional, and unstated means undeclared rather than draft.
     *
     * It was required, and what that produced was `draft` on everything: the
     * gesture wrote it because the grammar demanded a value, no control existed
     * to change it (it is excluded from `editableProps` and absent from
     * `PROP_UI`), and none of the three values means "I have not thought about
     * this yet". A field every component must carry before it can exist is a tax
     * on drawing, and the maturity it collected was not information.
     *
     * Still checked when present: a value outside `STATUSES` is still UIDX112.
     * This narrows when the attribute is demanded, not what it means.
     */
    const status = attrs.status
    if (!status) return
    if (
      typeof status.value !== 'string' ||
      !(STATUSES as readonly string[]).includes(status.value)
    ) {
      this.error(
        CODES.BAD_STATUS,
        `status must be one of ${STATUSES.join(' | ')}, got ${JSON.stringify(status.value)}`,
        status.valueLoc,
      )
    }
  }

  /**
   * A `<Variable>` declares its type and states its value (story G8).
   *
   * Inference is gone from this position: a variable's type is one fact across
   * every mode, so it cannot be re-derived per value, and a declared type is
   * the only thing a mismatch can be checked against. Figma does the same — the
   * type is chosen at creation, not guessed. An alias still declares a type it
   * does not prove, because its target may live in another document; the symbol
   * table settles that one.
   */
  private checkVariable(attrs: Record<string, UidxAttr>, loc: Range): void {
    const declared = attrs.type
    let type: VariableType | null = null
    if (!declared) {
      this.error(CODES.MISSING_VARIABLE_TYPE, '<Variable> requires a "type" attribute', loc)
    } else if (
      typeof declared.value !== 'string' ||
      !(VARIABLE_TYPES as readonly string[]).includes(declared.value)
    ) {
      this.error(
        CODES.VARIABLE_TYPE_MISMATCH,
        `a <Variable> type must be one of ${VARIABLE_TYPES.join(', ')}`,
        declared.valueLoc,
      )
    } else {
      type = declared.value as VariableType
    }

    const value = attrs.value
    // Whether a *missing* value is an error depends on the collection's modes,
    // which are only known once children are lowered — `checkVariableModes`.
    if (!value) return
    if (isAlias(value.value)) return
    if (variableTypeOf(value.value) === null) {
      this.error(
        CODES.BAD_VARIABLE_VALUE,
        'a <Variable> value must be a number, string, boolean, a colour ' +
          '{ r, g, b, a }, or an alias like "{other#token}"',
        value.valueLoc,
      )
      return
    }
    if (type !== null && !fitsVariableType(value.value, type)) {
      this.error(
        CODES.VARIABLE_TYPE_MISMATCH,
        `this value is ${variableTypeOf(value.value)}, not ${type}`,
        value.valueLoc,
      )
    }
  }

  /**
   * Where a variable is offered (story G8).
   *
   * Absent means `ALL_SCOPES` — a variable with nothing stated is offered
   * everywhere its type fits, which is Figma's default too, so the common case
   * writes nothing.
   */
  private checkScopes(attrs: Record<string, UidxAttr>): void {
    const scopes = attrs.scopes
    if (!scopes) return
    const value = scopes.value
    const ok =
      Array.isArray(value) &&
      value.every(
        (s) => typeof s === 'string' && (VARIABLE_SCOPES as readonly string[]).includes(s),
      )
    if (!ok) {
      this.error(
        CODES.BAD_SCOPE,
        `a <Variable> "scopes" must be an array of: ${VARIABLE_SCOPES.join(', ')}`,
        scopes.valueLoc,
      )
    }
  }

  /**
   * A node's explicit mode selection (story G8).
   *
   * Figma's `explicitVariableModes`: what this node itself sets, as against
   * what it resolves to. Keeping the two apart is what lets the panel say
   * "Auto" without walking the tree to find out.
   */
  private checkNodeModes(attrs: Record<string, UidxAttr>): void {
    const modes = attrs.modes
    if (!modes) return
    const value = modes.value
    const ok =
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.values(value).every((m) => typeof m === 'string' && m.length > 0)
    if (!ok) {
      this.error(
        CODES.BAD_NODE_MODES,
        'a "modes" attribute maps a collection name to a mode name, ' +
          "e.g. modes={{ semantic: 'dark' }}",
        modes.valueLoc,
      )
    }
  }

  /**
   * A collection's mode list (story G8).
   *
   * Array order is the default: leftmost wins, which is the same gesture Figma
   * gives you by dragging a column to the front. There is no separate
   * `defaultMode` attribute, because reordering already says it.
   */
  private checkCollection(attrs: Record<string, UidxAttr>): readonly string[] | null {
    const modes = attrs.modes
    if (!modes) return null
    const value = modes.value
    const ok =
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((m) => typeof m === 'string' && m.length > 0) &&
      new Set(value as string[]).size === value.length
    if (!ok) {
      this.error(
        CODES.BAD_COLLECTION_MODES,
        'a <Collection> "modes" must be a non-empty array of unique mode names',
        modes.valueLoc,
      )
      return null
    }
    return value as string[]
  }

  /**
   * The either/or rule (story G8).
   *
   * A collection either declares `modes`, and every variable in it states one
   * value per `<Mode>`, or it declares none and every variable states a bare
   * `value`. One rule, checked in one place — and it is what keeps a
   * single-mode collection byte-identical to what G5 already wrote.
   */
  private checkVariableModes(node: UidxNode, modes: readonly string[] | null, loc: Range): void {
    const declared = node.attrs.type?.value
    const type =
      typeof declared === 'string' && (VARIABLE_TYPES as readonly string[]).includes(declared)
        ? (declared as VariableType)
        : null
    const children = node.children.filter((child) => child.element === 'Mode')

    if (modes === null) {
      if (children.length > 0) {
        this.error(CODES.MODE_SHAPE, '<Mode> requires its <Collection> to declare "modes"', loc)
      } else if (node.attrs.value === undefined) {
        this.error(CODES.MISSING_VARIABLE_VALUE, '<Variable> requires a "value" attribute', loc)
      }
      return
    }

    if (node.attrs.value !== undefined) {
      this.error(
        CODES.MODE_SHAPE,
        'a variable in a moded collection states its values as <Mode> children, not "value"',
        node.attrs.value.valueLoc,
      )
    }

    const seen = new Set<string>()
    for (const child of children) {
      if (!modes.includes(child.name)) {
        this.error(
          CODES.UNKNOWN_MODE,
          `"${child.name}" is not a mode of this collection`,
          child.loc,
        )
        continue
      }
      seen.add(child.name)
      const value = child.attrs.value
      if (!value) {
        this.error(CODES.MISSING_VARIABLE_VALUE, '<Mode> requires a "value" attribute', child.loc)
        continue
      }
      if (isAlias(value.value)) continue
      if (variableTypeOf(value.value) === null) {
        this.error(
          CODES.BAD_VARIABLE_VALUE,
          'a <Mode> value must be a number, string, boolean, a colour ' +
            '{ r, g, b, a }, or an alias like "{other#token}"',
          value.valueLoc,
        )
        continue
      }
      if (type !== null && !fitsVariableType(value.value, type)) {
        this.error(
          CODES.VARIABLE_TYPE_MISMATCH,
          `this value is ${variableTypeOf(value.value)}, not ${type}`,
          value.valueLoc,
        )
      }
    }

    for (const mode of modes) {
      if (!seen.has(mode)) this.error(CODES.MISSING_MODE, `no value for mode "${mode}"`, loc)
    }
  }

  /**
   * Names may not contain the address separators (ADR 0004 §3). `/` is legal in
   * a top-level name because that is how Figma groups a component set, and the
   * `#` boundary is what makes it unambiguous — but only at that one level.
   */
  /**
   * `<Instance>`'s own two properties (story F3).
   *
   * They are checked here rather than left to the §3.3 prop lint because
   * neither is a scene property at all: `component` is a reference into the
   * document's global namespace (ADR 0004 §2) and `overrides` is a map keyed by
   * addresses *inside* the referenced component. The lint asks "is this a
   * property the renderer knows"; these ask "does this instance say what it is
   * an instance of", which is a structural question and belongs with the
   * grammar.
   *
   * Whether the name resolves is deliberately *not* asked here. A page is
   * parsed alone and component names are global to the whole document, so the
   * parser cannot know — `buildSymbolTable` answers it, in the same band as an
   * unresolved token alias and with the same near-miss suggestions.
   */
  /**
   * The three positions ADR 0007 refuses a `<Slot>`, each with its own reason.
   *
   * Separate from the child tables because the tables can only say "not here".
   * A hole on a page has nobody to fill it; a component that is nothing but a
   * hole declares no contract; and a slot inside a fill would be a hole the
   * consuming page opens in its own content, which nothing downstream could
   * fill. Returns false when the node should not be lowered at all.
   */
  private checkSlotPosition(
    parentElement: UidxElement | null,
    isRoot: boolean,
    inFill: boolean,
    inComponent: boolean,
    loc: Range,
  ): boolean {
    const refuse = (why: string): boolean => {
      this.error(CODES.SLOT_NOT_ALLOWED_HERE, why, loc)
      return false
    }

    // A slot inside a fill would be a hole the consuming page opens in its own
    // content, which nothing downstream could fill. Asked first because a fill's
    // own children are otherwise ordinary.
    if (inFill) {
      return refuse(
        "<Slot> cannot sit inside a slot fill: the fill is this page's own content, and a " +
          'hole in it would be one no component declares. Declare the slot in the ' +
          '<Component> instead',
      )
    }

    // The fill side. An `<Instance>`'s one legal child (ADR 0007 §2), and the
    // one position where a slot legitimately sits outside a `<Component>` —
    // because the instance names the component that declares it.
    if (parentElement === 'Instance') return true

    /*
     * Everywhere else, a slot must be inside a component.
     *
     * Not merely "not a page's direct child", which is all this used to check.
     * ADR 0007 §1's reason — a hole outside a component has nobody to fill it —
     * is about being *outside a component*, and a slot two frames deep on a page
     * is exactly as unfillable as one sitting on the page itself. Only an
     * `<Instance>` fills a slot, and an instance names a `<Component>`.
     */
    if (!inComponent) {
      return refuse(
        '<Slot> declares a hole for a consumer to fill, so it belongs inside a <Component>; ' +
          'nothing can fill a slot that sits outside one' +
          (isRoot || parentElement === 'Page' ? '' : ', however deeply nested it is'),
      )
    }

    return true
  }

  /**
   * A fill carries `name`, and nothing else (ADR 0007 §2).
   *
   * The same carve-out `<Variant>` has for owning no geometry, said the other
   * way round: a variant never has geometry anywhere, a slot has it in exactly
   * one position. This is what makes "a slot's layout belongs to the
   * definition" enforceable rather than a convention.
   */
  /**
   * What a pin may say, and where it may say it (ADR 0011 §2 and §6).
   *
   * The rule the whole method turns on: a pin answers a question, so the file
   * may not answer it a second time. `right` under a MAX pin is the author's;
   * `x` under one is the resolver's, and a file carrying both holds two answers
   * that disagree the moment the parent is resized.
   *
   * The four offset names are repeated here rather than imported. `@uidx/schema`
   * owns `PIN_PROPS` and depends on this package, not the other way round —
   * the same repetition `checkInstance` makes for `component`/`overrides`, and
   * for the same reason: these are grammar questions, asked before any prop
   * table exists.
   */
  private checkPins(
    attrs: Record<string, UidxAttr>,
    parentElement: UidxElement | null,
    parentFlows: boolean,
    loc: Range,
  ): void {
    const constraints = attrs.constraints?.value
    const stated =
      typeof constraints === 'object' && constraints !== null && !Array.isArray(constraints)
        ? (constraints as Record<string, unknown>)
        : {}
    const axisOf = (key: 'horizontal' | 'vertical'): string =>
      typeof stated[key] === 'string' ? (stated[key] as string) : 'MIN'

    const horizontal = axisOf('horizontal')
    const vertical = axisOf('vertical')
    const has = (prop: string): boolean => attrs[prop] !== undefined

    // An offset with no constraint is still a pin — MIN plus a `right`, which
    // the axis table below refuses. Returning early on the constraint alone
    // would let that file through unremarked.
    const pinned =
      horizontal !== 'MIN' ||
      vertical !== 'MIN' ||
      has('right') ||
      has('bottom') ||
      has('centerX') ||
      has('centerY')
    if (!pinned) return

    if (horizontal === 'SCALE' || vertical === 'SCALE') {
      this.error(
        CODES.PIN_SCALE_UNSUPPORTED,
        'SCALE is a ratio rather than an offset, and UIDX has no fractional geometry to ' +
          'express it yet (ADR 0011 §3, story H5). Use STRETCH to hold both edges',
        loc,
      )
      return
    }

    // Nothing to pin to, or a parent that places this child itself. Asked
    // before the per-axis table, because "there is no box" makes every sentence
    // about the offsets misleading.
    if (parentElement === null || parentElement === 'Page') {
      this.error(
        CODES.PIN_NOT_ALLOWED_HERE,
        'a pin measures from a parent box, and a page is not one; put this node inside a ' +
          '<Frame> or <Component> to pin it',
        loc,
      )
      return
    }
    if (parentFlows && attrs.layoutPositioning?.value !== 'ABSOLUTE') {
      this.error(
        CODES.PIN_NOT_ALLOWED_HERE,
        "this node is placed by its parent's auto layout, so a pin has nothing to say; add " +
          'layoutPositioning="ABSOLUTE" to position it by hand',
        loc,
      )
      return
    }

    /** One axis's legality, from ADR 0011 §2's table. */
    const checkAxis = (
      constraint: string,
      near: 'x' | 'y',
      far: 'right' | 'bottom',
      centre: 'centerX' | 'centerY',
      size: 'width' | 'height',
    ): void => {
      const refuse = (prop: string): void => {
        this.error(
          CODES.PIN_GEOMETRY_CONFLICT,
          `"${prop}" is computed under a ${constraint} pin, so stating it would be a second ` +
            'answer to a question the pin already answers (ADR 0011 §2)',
          attrs[prop]?.loc ?? loc,
        )
      }

      if (constraint === 'MIN') {
        if (has(far)) refuse(far)
        if (has(centre)) refuse(centre)
      } else if (constraint === 'MAX') {
        if (has(near)) refuse(near)
        if (has(centre)) refuse(centre)
      } else if (constraint === 'STRETCH') {
        if (has(size)) refuse(size)
        if (has(centre)) refuse(centre)
      } else if (constraint === 'CENTER') {
        if (has(near)) refuse(near)
        if (has(far)) refuse(far)
      }
    }

    checkAxis(horizontal, 'x', 'right', 'centerX', 'width')
    checkAxis(vertical, 'y', 'bottom', 'centerY', 'height')
  }

  private checkSlotFill(attrs: Record<string, UidxAttr>): void {
    for (const [key, attr] of Object.entries(attrs)) {
      if (key === 'name') continue
      this.error(
        CODES.SLOT_FILL_SHAPE,
        `"${key}" belongs to the <Slot> in the component, not to the fill: a slot's layout ` +
          "is the definition's to decide and the content is yours. Remove it here, or set " +
          'it on the <Slot> where the component declares it',
        attr.loc,
      )
    }
  }

  /**
   * Slot names are unique within a component, across its whole subtree.
   *
   * Not merely among siblings, which UIDX102 already covers: the name is the
   * entire contract (ADR 0007 §2), so `container/body` and `footer/body` would
   * be two different holes a consumer could only call `body`. A component with
   * variants is checked per `<Variant>`, because each variant is a full tree
   * and the same slot is expected to appear in every one of them.
   *
   * An `<Instance>` inside the component is not descended into: its `<Slot>`
   * children are fills of *its* component, not declarations of this one.
   */
  private checkSlotNames(component: UidxNode, hasVariants: boolean): void {
    const roots = hasVariants
      ? component.children.filter((child) => child.element === 'Variant')
      : [component]
    for (const root of roots) {
      const seen = new Map<string, UidxNode>()
      const walk = (node: UidxNode): void => {
        for (const child of node.children) {
          if (child.element === 'Instance') continue
          if (child.element === 'Slot') {
            const previous = seen.get(child.name)
            if (previous) {
              const at = diagnostic(this.source, '', '', previous.loc)
              this.error(
                CODES.DUPLICATE_SLOT,
                `<Component> "${component.name}" already declares a slot named ` +
                  `"${child.name}" (at ${at.line}:${at.column}); a consumer fills by name, ` +
                  'so two holes cannot share one',
                child.loc,
              )
            } else {
              seen.set(child.name, child)
            }
          }
          walk(child)
        }
      }
      walk(root)
    }
  }

  private checkInstance(element: UidxElement, attrs: Record<string, UidxAttr>, loc: Range): void {
    if (element !== 'Instance') {
      // Either of these on another element is almost always an `<Instance>`
      // typed as the wrong tag. Said rather than ignored: both are in
      // `KNOWN_PROPS` so the §3.3 lint would let them through silently, and a
      // property that is spelled correctly and does nothing is the worst of the
      // three outcomes.
      for (const own of ['component', 'overrides']) {
        const stray = attrs[own]
        if (!stray) continue
        this.error(
          CODES.COMPONENT_ATTR_MISPLACED,
          `"${own}" belongs to <Instance>, which is what names a component to use; ` +
            `<${element}> cannot carry it`,
          stray.loc,
        )
      }
      return
    }

    const component = attrs.component
    if (!component || typeof component.value !== 'string' || component.value === '') {
      this.error(
        CODES.MISSING_COMPONENT,
        '<Instance> requires a "component" attribute naming the component it instantiates',
        component?.loc ?? loc,
      )
    }

    const overrides = attrs.overrides
    if (!overrides) return
    const value = overrides.value
    const isMap =
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.values(value).every((v) => typeof v === 'object' && v !== null && !Array.isArray(v))
    if (!isMap) {
      this.error(
        CODES.BAD_OVERRIDES,
        '"overrides" maps an address inside the component to the properties to change, ' +
          "e.g. { 'container/label': { characters: 'Save' } }",
        overrides.valueLoc,
      )
      return
    }
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (key !== '' && !key.includes(ENTITY_SEP)) continue
      this.error(
        CODES.BAD_OVERRIDES,
        `"${key}" is not a path inside the component — an override key is relative to the ` +
          `component's own root, so it never contains "${ENTITY_SEP}" and is never empty`,
        overrides.valueLoc,
      )
    }
  }

  /**
   * A `<Component>`'s `props` declaration (story F6).
   *
   * Shape only. Whether a `{label}` binding inside the component finds one of
   * these is a question about the whole subtree rather than about this tag, and
   * it is asked where every other "does this reference resolve" question is —
   * `buildSymbolTable`, beside the same question about a token alias.
   *
   * `props` on anything but a `<Component>` is refused for `component`'s
   * reason: it is in `KNOWN_PROPS`, so without this it would be spelled
   * correctly and do nothing. The one exception coming is `<Instance>`, where
   * `props` will carry *values* rather than declarations — that is F7, and it
   * will relax this rule rather than route around it.
   */
  private checkComponentProps(element: UidxElement, attrs: Record<string, UidxAttr>): void {
    const declaration = attrs.props
    if (!declaration) return
    if (element !== 'Component' && element !== 'Instance') {
      this.error(
        CODES.COMPONENT_ATTR_MISPLACED,
        `"props" declares what a <Component> lets its consumers change, or assigns them on an ` +
          `<Instance>; <${element}> cannot carry it`,
        declaration.loc,
      )
      return
    }
    // The same attribute name on both sides of the contract, deliberately: one
    // declares and one assigns, and reading `props` on either is reading the
    // same list of names. Their *shapes* differ, so they are checked apart.
    const problems =
      element === 'Component'
        ? componentProps({ attrs } as UidxNode).problems
        : instanceProps({ attrs } as UidxNode).problems
    for (const problem of problems) {
      this.error(CODES.BAD_COMPONENT_PROPS, problem.detail, declaration.valueLoc)
    }
  }

  /**
   * A `<Component>`'s `variants` declaration (story F8, ADR 0005 §2).
   *
   * Returns the axes for the children to be named by, or null when there are
   * none to name them by — either because nothing was declared or because what
   * was declared could not be read. Null is not "no variants": it is "do not
   * try", and `checkVariantShape` tells the two apart from the attribute
   * itself, so a malformed declaration does not also report every `<Variant>`
   * under it as misplaced.
   *
   * Axis names share one namespace with F6's property names, because F7 assigns
   * both through one `props` object — so a collision is reported here rather
   * than left to mean whichever the resolver happens to reach first.
   */
  private checkVariants(node: UidxNode): ReadonlyMap<string, readonly string[]> | null {
    const declaration = node.attrs.variants
    if (!declaration) return null

    const { axes, problems } = componentVariants(node)
    for (const problem of problems) {
      this.error(CODES.BAD_VARIANTS, problem.detail, declaration.valueLoc)
    }

    const declaredProps = componentProps(node).declared
    for (const axis of axes.keys()) {
      if (!declaredProps.has(axis)) continue
      this.error(
        CODES.BAD_VARIANTS,
        `"${axis}" is declared both as a variant axis and as a component property; ` +
          'an instance assigns both through one "props" object, so the names must differ',
        declaration.valueLoc,
      )
    }

    return axes.size ? axes : null
  }

  /**
   * The two shapes, kept apart (ADR 0005 §1).
   *
   * A component either has one look or has states, and mixing them has no
   * meaning: a `<Variant>` beside a plain child would leave the plain child
   * belonging to no combination. The `<Variant>`-without-`variants` half is
   * caught where the variant is lowered, because that is where the sentence has
   * somewhere useful to point.
   */
  private checkVariantShape(
    node: UidxNode,
    axes: ReadonlyMap<string, readonly string[]> | null,
    loc: Range,
  ): void {
    // Null is either "declares none", which is the ordinary shape, or "declared
    // something unreadable", which `checkVariants` has already reported — and a
    // second complaint about every child under it would bury that one.
    if (!axes) return

    const stray = node.children.find((child) => child.element !== 'Variant')
    if (stray) {
      this.error(
        CODES.VARIANT_SHAPE,
        `this <Component> declares variants, so every child must be a <Variant>; ` +
          `<${stray.element}> "${stray.name}" belongs inside one`,
        stray.loc,
      )
      return
    }
    if (node.children.length === 0) {
      this.error(
        CODES.VARIANT_SHAPE,
        'this <Component> declares variants but holds none; add a <Variant> for each ' +
          'combination you have designed',
        loc,
      )
      return
    }

    // ADR 0005 §2: combinations may be sparse, but the default may not be
    // missing — an instance that says nothing has to render something, and
    // "every axis's first value" is a choice the author can see and reorder.
    const fallback = variantName(defaultCombination(axes))
    if (!node.children.some((child) => child.name === fallback)) {
      this.error(
        CODES.MISSING_DEFAULT_VARIANT,
        `every component with variants needs its default combination, which is each axis's ` +
          `first value — add <Variant ${[...axes]
            .map(([axis, domain]) => `${axis}="${domain[0]}"`)
            .join(' ')}>, or reorder the axes so a combination you have is the default`,
        loc,
      )
    }
  }

  private checkName(name: string, isEntity: boolean, loc: Range): boolean {
    if (name.includes(ENTITY_SEP)) {
      this.error(
        CODES.INVALID_NAME,
        `a name may not contain "${ENTITY_SEP}" — it separates an entity from the path inside it`,
        loc,
      )
      return false
    }
    if (!isEntity && name.includes(PATH_SEP)) {
      this.error(
        CODES.INVALID_NAME,
        `a name may not contain "${PATH_SEP}" inside an entity; "${PATH_SEP}" grouping is only for top-level names`,
        loc,
      )
      return false
    }
    return true
  }

  /** Element children, rejecting stray prose. Comments are allowed and ignored. */
  private childElements(el: MdastNode, element: UidxElement): MdastNode[] {
    const out: MdastNode[] = []
    for (const child of el.children ?? []) {
      if (child.type === 'mdxJsxFlowElement' || child.type === 'mdxJsxTextElement') {
        out.push(child)
      } else if (child.type === 'mdxFlowExpression' || child.type === 'mdxTextExpression') {
        if (!isComment(child.value)) {
          this.error(
            CODES.UNEXPECTED_CONTRACT_CONTENT,
            'only MDX comments are allowed between elements',
            rangeOf(child),
          )
        }
      } else if (child.type === 'text' || child.type === 'paragraph') {
        const text = textContent(child)
        if (text.trim() !== '') {
          this.error(
            CODES.CHILDREN_NOT_ALLOWED,
            `<${element}> cannot contain text content; use the "characters" attribute`,
            rangeOf(child),
          )
        }
      }
    }
    return out
  }
}

function isComment(value: string): boolean {
  const t = value.trim()
  return t.startsWith('/*') && t.endsWith('*/')
}

function textContent(node: MdastNode): string {
  if (typeof node.value === 'string') return node.value
  return (node.children ?? []).map(textContent).join('')
}

/**
 * MDX without a JavaScript parser, and without ESM.
 *
 * `micromark-extension-mdxjs` hands acorn every expression it meets and stores
 * the estree on the node. UIDX reads none of it: an attribute value is re-parsed
 * from its source text under the restricted §3.3 grammar (`values.ts`), because
 * the set of things acorn accepts is far wider than the set the patch engine can
 * write back. So the estree is a full JS parse per attribute, thrown away — and
 * it was 4.2ms of the 6.9ms spent in `fromMarkdown` on the §5 fixture.
 *
 * Without `acorn`, both extensions fall back to brace- and quote-aware scanning,
 * which is all that is needed to find where an expression ends.
 *
 * Dropping `mdxjsEsm` is a correctness gain rather than a cost: ADR 0004 has no
 * imports, so an `import` line in the contract region should be rejected as
 * stray content, which is exactly what it becomes now.
 *
 * Built once. The extensions are stateless, and rebuilding them per parse would
 * put allocation on the hot path of a function the write path calls twice.
 */
const MICROMARK_EXTENSIONS = [frontmatter(['yaml']), mdxJsx(), mdxExpression(), mdxMd()]
const MDAST_EXTENSIONS = [
  frontmatterFromMarkdown(['yaml']),
  mdxJsxFromMarkdown(),
  mdxExpressionFromMarkdown(),
]

/** Parses a `.uidx` source string. Never throws; failures land in `diagnostics`. */
/**
 * The mdast tree of a fragment, or null if it does not parse. The incremental
 * re-parse wraps one element in a synthetic `<Page>` and lowers only that
 * child, with the context the real tree gives it (spec: viewer at scale §1).
 */
export function parseFragmentRoot(text: string): MdastNode | null {
  try {
    return fromMarkdown(text, {
      extensions: MICROMARK_EXTENSIONS,
      mdastExtensions: MDAST_EXTENSIONS,
    })
  } catch {
    return null
  }
}

export function parse(source: string): ParseResult {
  let tree: MdastNode
  try {
    tree = fromMarkdown(source, {
      extensions: MICROMARK_EXTENSIONS,
      mdastExtensions: MDAST_EXTENSIONS,
    })
  } catch (err) {
    const e = err as { place?: { offset?: number }; message?: string }
    const offset = e.place?.offset ?? 0
    return {
      doc: null,
      diagnostics: [
        diagnostic(source, CODES.CONTRACT_NOT_SINGLE_ROOT, e.message ?? 'MDX parse error', {
          start: offset,
          end: offset,
        }),
      ],
    }
  }

  const diagnostics: Diagnostic[] = []
  const children: MdastNode[] = tree.children ?? []

  // ---- frontmatter ------------------------------------------------------
  const yamlNode = children.find((c) => c.type === 'yaml')
  let frontmatterData: Record<string, unknown> = {}
  if (yamlNode) {
    try {
      frontmatterData = (parseYaml(yamlNode.value) ?? {}) as Record<string, unknown>
    } catch (err) {
      diagnostics.push(
        diagnostic(
          source,
          CODES.BAD_FRONTMATTER,
          `invalid YAML: ${(err as Error).message}`,
          rangeOf(yamlNode),
        ),
      )
    }
  }
  const frontmatterLoc = yamlNode ? rangeOf(yamlNode) : { start: 0, end: 0 }
  // The frontmatter describes the *page* now, so `id` is all it must carry.
  if (typeof frontmatterData.id !== 'string') {
    diagnostics.push(
      diagnostic(
        source,
        CODES.MISSING_FRONTMATTER_KEY,
        'frontmatter is missing required key "id"',
        frontmatterLoc,
      ),
    )
  }

  // ADR 0003 §3: no key is valid in both places. Silently ignoring a leftover
  // `status:` would leave two plausible sources of truth in the same file.
  for (const moved of METADATA_ATTRS) {
    if (frontmatterData[moved] === undefined) continue
    diagnostics.push(
      diagnostic(
        source,
        CODES.FRONTMATTER_KEY_MOVED,
        `"${moved}" describes a component, not the page — move it onto the <Component> element`,
        frontmatterLoc,
      ),
    )
  }

  const id = frontmatterData.id
  if (typeof id === 'string' && !KEBAB_CASE.test(id)) {
    diagnostics.push(
      diagnostic(
        source,
        CODES.BAD_ID,
        `id must be kebab-case (lowercase letters, digits and single hyphens), got ${JSON.stringify(id)}`,
        frontmatterLoc,
      ),
    )
  }
  const rootName = typeof frontmatterData.id === 'string' ? frontmatterData.id : ''

  // ---- region split -----------------------------------------------------
  const headings = children.filter(
    (c) => c.type === 'heading' && c.depth === 2 && textContent(c) === CONTRACT_HEADING,
  )
  if (headings.length === 0) {
    diagnostics.push(
      diagnostic(source, CODES.NO_CONTRACT, `missing "## ${CONTRACT_HEADING}" heading`, {
        start: source.length,
        end: source.length,
      }),
    )
    return { doc: null, diagnostics }
  }
  if (headings.length > 1) {
    diagnostics.push(
      diagnostic(
        source,
        CODES.DUPLICATE_CONTRACT,
        `exactly one "## ${CONTRACT_HEADING}" heading is allowed, found ${headings.length}`,
        rangeOf(headings[1]),
      ),
    )
    return { doc: null, diagnostics }
  }

  const heading = headings[0]
  const headingLoc = rangeOf(heading)
  const intentStart = yamlNode ? rangeOf(yamlNode).end : 0
  const intent = {
    raw: source.slice(intentStart, headingLoc.start),
    loc: { start: intentStart, end: headingLoc.start },
  }

  // ---- contract region --------------------------------------------------
  const lowerer = new Lowerer(source)
  const contractNodes = children.filter((c) => c.position.start.offset >= headingLoc.end)
  const roots = contractNodes.filter((c) => c.type === 'mdxJsxFlowElement')

  for (const node of contractNodes) {
    if (node.type === 'mdxJsxFlowElement') continue
    if (
      (node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression') &&
      isComment(node.value)
    )
      continue
    diagnostics.push(
      diagnostic(
        source,
        CODES.UNEXPECTED_CONTRACT_CONTENT,
        'the Visual Contract region may only contain the root element and MDX comments',
        rangeOf(node),
      ),
    )
  }

  if (roots.length !== 1) {
    diagnostics.push(
      diagnostic(
        source,
        CODES.CONTRACT_NOT_SINGLE_ROOT,
        `the Visual Contract region must contain exactly one root element, found ${roots.length}`,
        roots.length ? rangeOf(roots[1] ?? roots[0]) : headingLoc,
      ),
    )
    return { doc: null, diagnostics: [...diagnostics, ...lowerer.diagnostics] }
  }

  const rootEl = roots[0]
  if (!ROOT_ELEMENTS.has(rootEl.name)) {
    diagnostics.push(
      diagnostic(
        source,
        CODES.BAD_ROOT,
        `the root element must be <Page> or <Tokens>, or a bare <Component> for a ` +
          `single-component page, found <${rootEl.name}>`,
        rangeOf(rootEl),
      ),
    )
    return { doc: null, diagnostics: [...diagnostics, ...lowerer.diagnostics] }
  }

  const treeRoot =
    rootEl.name === 'Component'
      ? lowerer.syntheticPage(rootEl, rootName)
      : lowerer.element(rootEl, null, null, rootName)
  const all = [...diagnostics, ...lowerer.diagnostics].sort((a, b) => a.loc.start - b.loc.start)

  if (!treeRoot || all.some((d) => d.severity === 'error')) {
    return { doc: null, diagnostics: all }
  }

  const doc: UidxDocument = {
    frontmatter: frontmatterData,
    intent,
    tree: treeRoot,
    source,
    sourceHash: fnv1a(source),
  }

  assertOffsetInvariant(doc)
  return { doc, diagnostics: all }
}

/**
 * The invariant that makes patching safe (spec §5): every attribute's recorded
 * span must slice back to its recorded raw text. Asserted on every parse in dev.
 */
export function assertOffsetInvariant(doc: UidxDocument): void {
  if (process.env.NODE_ENV === 'production') return
  const walk = (node: UidxNode): void => {
    for (const attr of Object.values(node.attrs)) {
      const slice = doc.source.slice(attr.valueLoc.start, attr.valueLoc.end)
      if (slice !== attr.raw) {
        throw new Error(
          `offset invariant violated at ${node.address || '<root>'}.${attr.name}: ` +
            `source.slice(${attr.valueLoc.start}, ${attr.valueLoc.end}) === ${JSON.stringify(slice)} ` +
            `but raw === ${JSON.stringify(attr.raw)}`,
        )
      }
    }
    node.children.forEach(walk)
  }
  walk(doc.tree)
}

export function parseOrThrow(source: string, file?: string): UidxDocument {
  const { doc, diagnostics } = parse(source)
  if (!doc) throw new UidxError(diagnostics, file)
  return doc
}

/**
 * Resolves an address against a tree. `''` is the root `<Page>` (ADR 0003 §2).
 *
 * The entity name runs to the *first* `#`, and may itself contain `/`; the path
 * after it splits on `/`. Reading the separators in that order is what makes
 * `Button/Primary#container/label` unambiguous.
 */
export function resolve(root: UidxNode, address: string): UidxNode | null {
  if (address === '') return root
  const cut = address.indexOf(ENTITY_SEP)
  const entityName = cut === -1 ? address : address.slice(0, cut)

  const entity = root.children.find((c) => c.name === entityName)
  if (!entity) return null
  if (cut === -1) return entity

  let node: UidxNode = entity
  for (const segment of address.slice(cut + 1).split(PATH_SEP)) {
    // A `<Mode>` is skipped rather than matched (G8): it carries a name but no
    // address, so `semantic#surface/light` must miss instead of finding the
    // light column of `surface` — that address belongs to a variable actually
    // named `surface/light`, and letting both answer to it is the collision
    // the empty address exists to prevent.
    const next = node.children.find((c) => c.name === segment && c.element !== 'Mode')
    if (!next) return null
    node = next
  }
  return node
}

/** Parent of `address`, or null for the root. An entity's parent is the page. */
export function resolveParent(root: UidxNode, address: string): UidxNode | null {
  if (address === '') return null
  const cut = address.indexOf(ENTITY_SEP)
  if (cut === -1) return root

  // Only a `/` to the right of the entity boundary is a path separator; one to
  // the left belongs to a grouped component name.
  const lastPath = address.lastIndexOf(PATH_SEP)
  return resolve(root, lastPath > cut ? address.slice(0, lastPath) : address.slice(0, cut))
}

/**
 * Whether `address` names `ancestor` itself or something inside it.
 *
 * Prefix matching has to know which separator comes next, or an entity named
 * `Button` swallows the unrelated entity `Button/Primary` — `/` is a name
 * character at the top level (ADR 0004 §3). Shared so the patcher and the
 * reconciler cannot disagree about what containment means.
 */
export function isWithin(ancestor: string, address: string): boolean {
  if (ancestor === '') return true
  if (address === ancestor) return true
  const next = ancestor.includes(ENTITY_SEP) ? PATH_SEP : ENTITY_SEP
  return address.startsWith(`${ancestor}${next}`)
}

/**
 * Depth in the tree: the page is 0, an entity on it is 1, a node inside that
 * entity 2, and so on. Not a `/` count — an entity name may contain `/`.
 */
export function addressDepth(address: string): number {
  if (address === '') return 0
  const cut = address.indexOf(ENTITY_SEP)
  return cut === -1 ? 1 : 1 + address.slice(cut + 1).split(PATH_SEP).length
}

/**
 * The component-relative form an `<Instance>` override key takes: everything
 * inside the entity, with the entity itself dropped (ADR 0004 §3). `null` for
 * an address that names an entity rather than something inside one.
 */
export function relativeAddress(address: string): string | null {
  const cut = address.indexOf(ENTITY_SEP)
  return cut === -1 ? null : address.slice(cut + 1)
}
