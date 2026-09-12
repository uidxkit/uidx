export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/** Spec §3.3 element whitelist. Unknown elements are a parse error, by design. */
export const ELEMENTS = [
  'Page',
  'Component',
  'Frame',
  'Text',
  'Rectangle',
  'Ellipse',
  'Vector',
  // Story F3. An `<Instance>` is a *use* of a `<Component>`, named by the bare
  // global name ADR 0004 §2 gives it. Its children are the component's,
  // generated on the way to the scene rather than authored — with one
  // exception, added by ADR 0007 §2: a `<Slot>` fill, which is authored in the
  // consuming page and is the only element it may hold.
  'Instance',
  // Story F8. A `<Variant>` is one of a component's states (ADR 0005), legal
  // only directly under a `<Component>` that declares `variants`. It carries no
  // `name`: its name — and so its address segment — is derived from the
  // coordinates it assigns, which is the whole point of declaring the axes.
  'Variant',
  // Story F5 / ADR 0007 §1. A `<Slot>` is a declared hole: inside a component
  // it takes part in the layout and its children are the default content;
  // directly inside an `<Instance>` the same element *fills* the hole named,
  // carrying `name` and nothing else. Position decides which job it does,
  // which is what makes "a slot's layout belongs to the definition" a grammar
  // rule rather than a convention.
  'Slot',
  // Token files (story G5). A `.uidx` with `<Tokens>` at the root is a set of
  // Figma variable collections rather than a scene — same extension, same
  // parser, same frontmatter, same `uidx check`.
  'Tokens',
  'Collection',
  'Variable',
  // Story G8. A `<Mode>` is one column of a collection's table — the value a
  // variable takes in that context. It is not addressable: a binding names
  // `{semantic#surface}` and the render context picks the mode, so lowering it
  // with an address would collide with a variable named `surface/light`.
  'Mode',
] as const
export type UidxElement = (typeof ELEMENTS)[number]

/** Elements that become scene nodes. The token tree does not. */
export type SceneElement = Exclude<UidxElement, 'Tokens' | 'Collection' | 'Variable' | 'Mode'>

/** Elements that may contain children. */
export const CONTAINER_ELEMENTS: ReadonlySet<string> = new Set([
  'Page',
  'Component',
  'Variant',
  'Frame',
  // A slot holds its default content in the definition, or the consumer's
  // content in a fill (ADR 0007 §2).
  'Slot',
  // ADR 0007 §2. An `<Instance>`'s children are still the component's,
  // generated rather than authored — with exactly one exception, which is why
  // this is a container at all: a `<Slot>` fill. `INSTANCE_CHILD_ELEMENTS` is
  // what keeps the exception to that one element.
  'Instance',
  'Tokens',
  'Collection',
  // A moded variable holds one `<Mode>` per column (G8).
  'Variable',
])

/** Roots a Visual Contract may have. `Component` is the ADR 0003 §4 sugar. */
export const ROOT_ELEMENTS: ReadonlySet<string> = new Set(['Page', 'Tokens', 'Component'])

/**
 * The token tree. These are variable declarations, not scene nodes, so the
 * §3.3 property whitelist does not apply to them — `value` is no more an
 * unknown scene property than `status` is.
 */
export const TOKEN_ELEMENTS: ReadonlySet<string> = new Set([
  'Tokens',
  'Collection',
  'Variable',
  'Mode',
])

export const TOKENS_CHILD_ELEMENTS: ReadonlySet<string> = new Set(['Collection'])
export const COLLECTION_CHILD_ELEMENTS: ReadonlySet<string> = new Set(['Variable'])
export const VARIABLE_CHILD_ELEMENTS: ReadonlySet<string> = new Set(['Mode'])

/**
 * What a component may declare a property as (story F6).
 *
 * Three of the SDK's four. `VARIANT` is deliberately absent and stays absent:
 * [ADR 0005](../../../docs/decisions/0005-variants.md) gives a component's
 * states their own grammar — a `variants` attribute declaring axes — so a
 * variant is never a property here, and this list never grows a fourth entry.
 */
export const PROPERTY_TYPES = ['TEXT', 'BOOLEAN', 'INSTANCE_SWAP'] as const
export type PropertyType = (typeof PROPERTY_TYPES)[number]

/**
 * The one field each type may fill, which is what makes a binding checkable.
 *
 * The SDK's `ComponentPropertyReference.field` is `VISIBLE | TEXT |
 * INSTANCE_SWAP`, and the mapping to a UIDX property is one-to-one — so a
 * `TEXT` property bound to `visible` is a mistake nothing else would catch.
 */
export const PROPERTY_FIELD: Record<PropertyType, string> = {
  TEXT: 'characters',
  BOOLEAN: 'visible',
  INSTANCE_SWAP: 'component',
}

/** One entry of a `<Component>`'s `props` declaration. */
export interface PropertyDeclaration {
  type: PropertyType
  /** Required: F7's panel shows it dimmed for an instance that sets nothing. */
  default: JsonValue
}

/** Figma's variable types. Declared on the `<Variable>` since G8, as in Figma. */
export const VARIABLE_TYPES = ['COLOR', 'FLOAT', 'STRING', 'BOOLEAN'] as const
export type VariableType = (typeof VARIABLE_TYPES)[number]

/**
 * Figma's 22 `VariableScope` values, plus one (story G8).
 *
 * A scope narrows where a variable is *offered*, so a radius scale stops
 * appearing in the gap picker. It is a picker filter and nothing more: binding
 * outside it is a warning, never an error, because Figma's own API binds
 * regardless and a file that arrived by import would otherwise fail to open.
 *
 * `SPACING` is the one addition. Figma filters padding with `GAP`, which leaves
 * a padding scale and a gap scale indistinguishable in its picker; export maps
 * `SPACING` back down to `GAP`.
 */
export const VARIABLE_SCOPES = [
  'ALL_SCOPES',
  'TEXT_CONTENT',
  'CORNER_RADIUS',
  'WIDTH_HEIGHT',
  'GAP',
  'SPACING',
  'ALL_FILLS',
  'FRAME_FILL',
  'SHAPE_FILL',
  'TEXT_FILL',
  'STROKE_COLOR',
  'STROKE_FLOAT',
  'EFFECT_FLOAT',
  'EFFECT_COLOR',
  'OPACITY',
  'FONT_FAMILY',
  'FONT_STYLE',
  'FONT_WEIGHT',
  'FONT_SIZE',
  'LINE_HEIGHT',
  'LETTER_SPACING',
  'PARAGRAPH_SPACING',
  'PARAGRAPH_INDENT',
] as const
export type VariableScope = (typeof VARIABLE_SCOPES)[number]

/**
 * ADR 0003 §1 — the grammar is two-level, not one flat whitelist.
 *
 * A `<Component>` on a page is a definition (Figma's `ComponentNode`); a
 * `<Frame>` on a page is standalone scenery that is not part of the system.
 * Neither may nest inside a node, which is what keeps "definition" meaningful.
 */
export const PAGE_CHILD_ELEMENTS: ReadonlySet<string> = new Set([
  'Component',
  'Frame',
  'Text',
  'Rectangle',
  'Ellipse',
  'Vector',
  'Instance',
])
/**
 * The scene elements any container may hold. `<Slot>` and `<Variant>` are
 * deliberately absent: each is legal in some positions and not others, so they
 * are added per set below rather than carried by the base.
 */
const SCENE_CHILD_ELEMENTS = [
  'Frame',
  'Text',
  'Rectangle',
  'Ellipse',
  'Vector',
  'Instance',
] as const

export const NODE_CHILD_ELEMENTS: ReadonlySet<string> = new Set([
  ...SCENE_CHILD_ELEMENTS,
  // ADR 0007 §1 — a hole may sit inside a frame, inside a variant, and inside
  // another slot's default content. Not on a page, and not inside a fill;
  // `checkSlotPosition` refuses those with the reason, since a table of element
  // names can say *that* but not *why*.
  'Slot',
])

/**
 * What may sit directly inside an `<Instance>` (ADR 0007 §2).
 *
 * Exactly one element. An instance's children are generated from its
 * component; a `<Slot>` fill is the one thing the consuming page authors
 * there, which is what makes it the first writable content under an instance.
 */
export const INSTANCE_CHILD_ELEMENTS: ReadonlySet<string> = new Set(['Slot'])

/**
 * ADR 0005 §1 — a `<Component>` holds scene children or its variants.
 *
 * `<Variant>` is legal nowhere else, and a component that declares no
 * `variants` may not hold one; the grammar cannot say that second half, so the
 * parser does. Which shape a given component has is its own business — that is
 * what makes gaining a first variant a diff rather than a promotion.
 *
 * `<Slot>` was absent here until ADR 0008. ADR 0007 §1 refused a slot as a
 * component's direct child because the sole child *was* the whole content, so
 * a slot there left "a component that is nothing but a hole". ADR 0008 §1 made
 * the component the frame — it carries its own fills, size and strokes — and
 * with that the premise went: a slot inside one is a painted, sized frame with
 * a hole in it, which is a contract. `checkSlotPosition` still refuses the
 * positions whose reasons survived, and this table still cannot say why.
 */
export const COMPONENT_CHILD_ELEMENTS: ReadonlySet<string> = new Set([
  ...SCENE_CHILD_ELEMENTS,
  'Variant',
  'Slot',
])

/**
 * What may sit directly inside `element`, by the element alone.
 *
 * One home for the child rules, because there were two: the parser walked this
 * switch on the way down and `canInsert` in the viewer kept a second, smaller
 * copy — which quietly went wrong the moment `<Instance>` became a container,
 * since the copy would have offered an instance every scene element.
 *
 * Position-dependent rules are deliberately *not* here: whether a `<Slot>` may
 * sit somewhere also depends on whether that somewhere is inside a fill, which
 * no table keyed by a parent element can say. Callers that need the whole
 * answer ask this first and the positional rule second.
 */
export function legalChildElementsOf(element: string | null): ReadonlySet<string> {
  switch (element) {
    case 'Page':
      return PAGE_CHILD_ELEMENTS
    case 'Tokens':
      return TOKENS_CHILD_ELEMENTS
    case 'Collection':
      return COLLECTION_CHILD_ELEMENTS
    case 'Variable':
      return VARIABLE_CHILD_ELEMENTS
    case 'Component':
      return COMPONENT_CHILD_ELEMENTS
    case 'Instance':
      return INSTANCE_CHILD_ELEMENTS
    default:
      return NODE_CHILD_ELEMENTS
  }
}

/**
 * ADR 0004 §3 — `#` bounds the entity from the path inside it, so `/` stays free
 * to be a name character the way Figma groups components (`Button/Primary`).
 *
 *   ""                              the page
 *   "Button/Primary"                an entity on it
 *   "Button/Primary#container"      a node inside that entity
 *
 * The component-relative address an override key needs is the substring after
 * the first `#`, with no segment arithmetic to get wrong.
 */
export const ENTITY_SEP = '#'
export const PATH_SEP = '/'

/**
 * Attributes that carry authoring metadata rather than geometry (ADR 0003 §3).
 *
 * They live on `<Component>` because they describe a component, and the
 * frontmatter describes the page. Deliberately kept out of `KNOWN_PROPS`, whose
 * invariant is that it is exactly the scene vocabulary — these never reach the
 * scene graph, so both the §3.3 lint and the prop mapping skip them.
 *
 * `variants` (ADR 0005) is here rather than in `KNOWN_PROPS` for exactly that
 * reason: it decides what gets *built* — one `COMPONENT_SET` of states instead
 * of one `COMPONENT` — rather than being set on anything. It is the only one of
 * the three that is not a string, which is why the panel's metadata chips skip
 * it and F8's own section shows it.
 */
export const METADATA_ATTRS: ReadonlySet<string> = new Set(['status', 'version', 'variants'])

export interface Range {
  start: number
  end: number
}

export interface UidxAttr {
  name: string
  /**
   * Exact source text of the value *including its delimiters* — `"container"`,
   * `{16}`, `{[{ type: 'SOLID' }]}`.
   *
   * Delimiters are included so that `set` is a single uniform span replacement
   * even when the value's type changes (number -> string switches `{}` for `""`).
   */
  raw: string
  value: JsonValue
  /** Full `name={value}` span. */
  loc: Range
  /** Delimited value span. `source.slice(valueLoc.start, valueLoc.end) === raw`. */
  valueLoc: Range
}

export interface UidxNode {
  element: UidxElement
  /** The `name` attribute. For the root `Page` this is the frontmatter `id`. */
  name: string
  /** Address per ADR 0003 §2 and ADR 0004 §3. The root `Page` is the empty string. */
  address: string
  attrs: Record<string, UidxAttr>
  children: UidxNode[]
  /** Whole element, open tag through closing tag. */
  loc: Range
  /** `<Frame ...>` or `<Vector ... />` — the open tag alone. */
  openTagLoc: Range
  selfClosing: boolean
  /** Leading whitespace on the line this element starts on. */
  indent: string
  /**
   * True for the `<Page>` implied by a bare `<Component>` root (ADR 0003 §4).
   * The node has no source span of its own, so nothing may be inserted into it
   * or removed from it until `uidx fmt` materialises the wrapper.
   */
  synthetic?: boolean
}

export interface UidxDocument {
  frontmatter: Record<string, unknown>
  intent: { raw: string; loc: Range }
  tree: UidxNode
  source: string
  /**
   * Cheap change-detection digest, not a cryptographic one. The server's echo
   * ledger (spec §6.3) computes its own sha256 over file bytes.
   */
  sourceHash: string
  /**
   * Set on a document produced by `predictDocument`: its attribute values are
   * what the author will see once in-flight patches land, but its spans are
   * stale. Nothing may patch *against* a predicted document (spec §4).
   */
  predicted?: true
}

export type UidxPatch =
  // property ops
  | { op: 'set'; address: string; prop: string; value: JsonValue }
  | { op: 'add'; address: string; prop: string; value: JsonValue }
  | { op: 'remove'; address: string; prop: string }
  /**
   * Sets one mode's value on a `<Variable>` (story: tokens view).
   *
   * Addressed to the variable, not the `<Mode>` child, because a mode has no
   * address of its own: a variable may be named with a slash, so
   * `semantic#surface/light` the mode would collide with a variable that owns
   * that very string (see the parser's Mode note). No insert form: a valid
   * moded variable already carries a `<Mode>` child per collection mode
   * (UIDX127), so a missing child means the mode does not exist and the op
   * refuses.
   */
  | { op: 'set-mode'; address: string; mode: string; value: JsonValue }
  // structural ops
  | { op: 'insert-node'; parent: string; index: number; node: UidxNodeSpec }
  | { op: 'remove-node'; address: string }
  | { op: 'move-node'; address: string; newParent: string; index: number }
  /**
   * Changes what an element *is*, leaving everything inside it alone (F14).
   *
   * The six ops above can change a node's attributes or move a whole subtree,
   * and neither can turn a `<Frame>` into a `<Slot>`. Faking it as
   * remove-plus-insert reprints everything within — the one thing this format
   * promises never to do — so the tag gets an op of its own: two span
   * replacements over offsets the parser already recorded, and the children,
   * their comments and their formatting are not touched.
   *
   * The address does not change, because a retag is not a rename. Whether the
   * result is *legal* is not asked here: `applyPatch` re-parses and rejects a
   * document that does not validate, so a retag into a position the grammar
   * refuses fails as a rejected patch rather than as a broken file.
   */
  | {
      op: 'retag'
      address: string
      element: string
      /**
       * Attributes the new tag requires, applied in the same edit (ADR 0008 §3).
       *
       * Not a general "set several things at once". A `<Component>` without
       * `status` is UIDX110 and a `<Frame>` carrying it is UIDX111, and
       * `applyPatches` re-parses between ops — so there is no order in which
       * the tag and the metadata it demands are two patches. They are one edit
       * or they are impossible. An entry whose value is `null` removes the
       * attribute, which is what the reverse conversion needs.
       */
      attrs?: Record<string, JsonValue | null>
    }

export interface UidxNodeSpec {
  element: UidxElement
  attrs: Record<string, JsonValue>
  children?: UidxNodeSpec[]
}

export type Severity = 'error' | 'warning'

export interface Diagnostic {
  code: string
  message: string
  severity: Severity
  loc: Range
  /** 1-based. */
  line: number
  /** 1-based. */
  column: number
}

export interface ParseResult {
  doc: UidxDocument | null
  diagnostics: Diagnostic[]
}
