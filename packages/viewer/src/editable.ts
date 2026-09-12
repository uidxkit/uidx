import {
  aliasTarget,
  isAlias,
  METADATA_ATTRS,
  type JsonValue,
  type SceneElement,
  type UidxNode,
} from '@uidx/format'
import {
  defaultFor,
  isDerivedPosition,
  isIdentityProp,
  mappingFor,
  PIN_PROPS,
  pinFrom,
  propUiFor,
  PROP_UI,
  PROP_UI_OPT_OUT,
  SECTION_LABEL,
  fieldOrderFor,
  sectionOrderFor,
  type PropGroup,
} from '@uidx/schema'

/**
 * What the properties panel is allowed to offer for a node, and how it is
 * grouped (story C5, structured by C6).
 *
 * Two gates, and they answer different questions:
 *
 * 1. **Is the prop in the prop table?** If the mapping layer does not know it,
 *    no edit to it can reach the scene graph, so offering a control would let
 *    the author make a change that silently fails to persist. `@uidx/schema`
 *    is the authority; this file never keeps its own list.
 * 2. **Can this value's shape be edited yet?** A number, a flag, a string or
 *    an enum has an obvious control, sourced from `@uidx/schema`'s `prop-ui`
 *    table. `fills`, `effects` and a few others do not (`control: 'opaque'`)
 *    — a paint stack needs a real colour editor, and a half-built one that
 *    writes a malformed paint is worse than a read-only row.
 *
 * A prop that fails either gate is still *shown*, because the contract pane
 * is also how you read a node. It is shown as read-only with the reason
 * attached, so "cannot edit this" never looks like "this does not exist".
 */

export type ControlKind =
  | 'number'
  | 'boolean'
  | 'enum'
  | 'text'
  | 'paint'
  | 'effects'
  | 'constraints'
  | 'dashes'
  | 'text-resize'
  | 'readonly'

export interface EditableProp {
  name: string
  /**
   * What the row is called on screen, which is not always what it is called in
   * the file — Figma says "Content" where §3.3 says `characters`. Falls back to
   * the authored name, which stays the patch key either way.
   */
  label: string
  /** Null when the prop table does not know this prop — it cannot be sectioned. */
  group: PropGroup | null
  control: ControlKind
  /** Legal values, present only when `control === 'enum'`. */
  options: readonly string[] | null
  /** The literal value, or the alias text when this is a token binding. */
  value: JsonValue
  /** Source text exactly as authored, for the read-only rows. */
  raw: string
  /** The token address when the value is a binding, else null. */
  boundTo: string | null
  /** Why this row cannot be edited. Null when it can. */
  readonlyReason: string | null
  /** False for a field synthesized so an empty section can offer its `+` (C8). */
  authored: boolean
}

export interface PairedField {
  field: EditableProp
  /** The sibling rendered on the same row (x's `y`, width's `height`). */
  pairedWith: EditableProp | null
}

export interface PropSection {
  group: PropGroup
  label: string
  fields: PairedField[]
}

/**
 * Why a prop the panel knows about still has no control.
 *
 * The reason is shown to the author, so it has to stay true as the editor
 * grows: `vectorPaths` said "one-way — nothing on the canvas can originate it"
 * right up until D11's pen did exactly that, and a panel that explains a
 * limitation the product no longer has is worse than one that says nothing.
 */
const UNEDITABLE_SHAPES: Record<string, string> = {
  vectorPaths:
    'drawn with the pen (P) and corrected by double-clicking the shape — not ' +
    'typed, because a path is not a text field',
  arcData: 'ellipse sweep needs its own control; edit it in the file for now',
}

/** Whether the mapping layer knows this prop at all. */
/**
 * Whether an edit to this prop can be written at all.
 *
 * The prop table is the usual answer, and the right one for an attribute
 * nobody blessed. The pin offsets are the exception it cannot express: they
 * are absent from the table *on purpose* (ADR 0011 §2) — a prop with no scene
 * field cannot be echoed back into the file by a reflow — so their absence is
 * a decision rather than the ignorance this predicate otherwise reports.
 *
 * They are editable, through `PropertiesPane`'s structural route rather than
 * the scene one, for the same reason they are absent here.
 */
export function isMapped(name: string): boolean {
  return isIdentityProp(name) || mappingFor(name) !== undefined || PIN_PROPS.includes(name)
}

/**
 * The rows the panel shows for one node, in authored order.
 *
 * `name` and the metadata attributes are excluded: `name` is the node's
 * address component (Epic D, not a property edit); `status` and `version`
 * describe the component and already have their own chip.
 */
/** Controls whose unset state is an empty list with a `+`, not a default value. */
const LIST_CONTROLS: ReadonlySet<string> = new Set(['paint', 'effects', 'dashes', 'constraints'])

/**
 * Position is the parent's business (D4, worded by `authorship.ts`): a child
 * of an auto-layout frame is placed by it, and `layoutPositioning: ABSOLUTE`
 * is the escape back to positioning by hand. Asked through the schema's own
 * predicate — over a two-node shim, since the panel holds documents, not scene
 * graphs — because a second copy of this judgement is exactly what its header
 * warns would drift.
 */
function derivedPositionReason(node: UidxNode, parent: UidxNode | null): string | null {
  if (!parent) return null
  const lookup = {
    getNode: (id: string) =>
      id === 'parent' ? { layoutMode: parent.attrs.layoutMode?.value as string } : undefined,
  }
  const derived = isDerivedPosition(lookup, {
    parentId: 'parent',
    layoutPositioning: node.attrs.layoutPositioning?.value as string | undefined,
  })
  return derived ? 'placed by the parent’s auto layout — set position to Absolute to move it' : null
}

/**
 * Whether this node's position is an *offset from a parent's edges* — the CSS
 * inset model the Position section speaks since the H3 revision.
 *
 * True for a child of any box that does not place it itself. False for a
 * page-level entity (no box to measure from — x/y are canvas coordinates
 * there) and for a flowed auto-layout child that has not taken ABSOLUTE
 * (position is the parent's; Figma hides constraints there too).
 */
function inOffsetContext(node: UidxNode, parent: UidxNode | null): boolean {
  if (!parent || parent.element === 'Page') return false
  if (!parentLaysOutChildren(parent)) return true
  return node.attrs.layoutPositioning?.value === 'ABSOLUTE'
}

/**
 * Where a position row stands on *this* node (ADR 0011 §2, §6).
 *
 * The Position section keeps a fixed shape so the eye finds an edge in the
 * same place whatever the pin: one line per axis — near edge beside far edge
 * (L|R, T|B) — with Center X/Y taking an axis's line over only when that axis
 * centres. An edge the pin does not hold still renders, dashed and disabled,
 * because a slot that vanishes moves every row under it (review, 2026-08-30).
 *
 * Only the unset rows need asking. An authored attribute always renders — and
 * a file whose geometry its own constraint forbids never reaches the viewer
 * anyway: UIDX134 is an error, and `parse` returns no document then.
 */
type PinRow = 'held' | 'loose' | 'absent'

function pinRowStanding(node: UidxNode, parent: UidxNode | null, name: string): PinRow {
  const offsets = inOffsetContext(node, parent)
  const pin = pinFrom(node.attrs)
  const horizontal = name === 'x' || name === 'right' || name === 'centerX'
  const axis = pin ? (horizontal ? pin.horizontal : pin.vertical) : 'MIN'

  if (name === 'centerX' || name === 'centerY') {
    return offsets && axis === 'CENTER' ? 'held' : 'absent'
  }
  if (name === 'x' || name === 'y') {
    // Page-level and flowed nodes keep their near rows: there is no far edge
    // to balance against, so the fixed grid does not apply there.
    if (!offsets) return 'held'
    if (axis === 'CENTER') return 'absent'
    return axis === 'MIN' || axis === 'STRETCH' ? 'held' : 'loose'
  }
  // right / bottom
  if (!offsets) return 'absent'
  if (axis === 'CENTER') return 'absent'
  return axis === 'MAX' || axis === 'STRETCH' ? 'held' : 'loose'
}

/** The sentence a loose edge's disabled row carries. */
const LOOSE_EDGE_REASON = 'this edge is loose — click it in Constraints to pin or stretch to it'

/**
 * The near edges wear CSS's names, everywhere.
 *
 * The first cut kept X/Y for page-level entities and flowed children, and the
 * review asked the right question: why two languages? CSS's answer covers both
 * edges cases already — `left`/`top` name a distance from the containing
 * block, which is exactly what `x`/`y` are against a page too, and a static
 * flow item *shows* left/top as inert, which is our read-only row. So the
 * label is unconditional and the section speaks one language.
 */
function positionLabel(name: string): string | null {
  if (name === 'x') return 'Left'
  if (name === 'y') return 'Top'
  return null
}

export function editableProps(node: UidxNode, parent: UidxNode | null = null): EditableProp[] {
  const positionReason = derivedPositionReason(node, parent)
  const reasonFor = (name: string): string | null => {
    if (name === 'x' || name === 'y') return positionReason
    // An authored pair on a node no pin is legal for still renders — it is in
    // the file — but inert: every write from it is one the server refuses
    // (UIDX135), and an active widget was exactly that affordance.
    if (name === 'constraints' && !inOffsetContext(node, parent)) {
      return positionReason ?? 'a pin measures from a parent box, and this node has none'
    }
    return null
  }

  const fields: EditableProp[] = Object.entries(node.attrs)
    .filter(([name]) => name !== 'name' && !METADATA_ATTRS.has(name))
    .map(([name, attr]) => {
      const bound = isAlias(attr.value) ? aliasTarget(attr.value) : null

      if (!isMapped(name)) {
        const control: ControlKind = 'readonly'
        return {
          name,
          label: name,
          group: null,
          control,
          options: null,
          value: attr.value,
          raw: attr.raw,
          boundTo: bound,
          readonlyReason: 'not in the prop table, so no edit to it can be written',
          authored: true,
        }
      }

      // Every mapped prop has a PROP_UI entry or an explicit opt-out
      // (drift-tested in @uidx/schema). `name` is the only opt-out, and it
      // was already filtered above, so `ui` is defined for everything left.
      const ui = propUiFor(name)
      const shapeReason =
        ui?.control === 'opaque'
          ? (UNEDITABLE_SHAPES[name] ?? 'this value shape has no control yet')
          : null

      // A bound value is edited through its binding, not its literal: the
      // number on screen belongs to the token, and typing over it is a
      // detach. `NumberFieldRoot` models exactly this.
      const control: ControlKind = shapeReason
        ? 'readonly'
        : bound
          ? 'number'
          : ((ui?.control as ControlKind) ?? 'readonly')

      return {
        name,
        label: positionLabel(name) ?? ui?.label ?? name,
        group: ui?.group ?? null,
        control,
        options: ui?.control === 'enum' ? (ui.options ?? []) : null,
        value: attr.value,
        raw: attr.raw,
        boundTo: bound,
        readonlyReason: shapeReason ?? reasonFor(name),
        authored: true,
      }
    })

  // The page root is a document, not a shape: it owns none of this.
  if (node.address === '') return fields

  /*
   * Every property that applies to this element, shown unset (story C7).
   *
   * The tension the spec names is real — showing everything invites writing
   * attributes nobody chose, and a frame carrying twenty explicit properties
   * is worse than one carrying four. The resolution is that showing is not
   * writing: an unset row is dimmed, carries the value the engine resolves
   * to, and reaches the file only when the author changes it, as an `add`.
   *
   * Authored rows keep their place at the front, so the decisions the file
   * actually records still read together at a glance.
   */
  const authoredNames = new Set(fields.map((f) => f.name))
  const element = node.element as SceneElement
  for (const [name, ui] of Object.entries(PROP_UI)) {
    if (authoredNames.has(name)) continue
    if (name === 'name' || METADATA_ATTRS.has(name)) continue
    if (ui.appliesTo && !ui.appliesTo.includes(element)) continue
    let looseEdge = false
    if (PIN_PROPS.includes(name) || name === 'x' || name === 'y') {
      const standing = pinRowStanding(node, parent, name)
      if (standing === 'absent') continue
      looseEdge = standing === 'loose'
    }
    // A pin is illegal where there is no box to measure from (UIDX135), so the
    // widget does not offer one there. An authored pair still renders — it is
    // in the file, and hiding it would hide the thing the checker names.
    if (name === 'constraints' && !inOffsetContext(node, parent)) continue

    const shapeReason =
      ui.control === 'opaque'
        ? (UNEDITABLE_SHAPES[name] ?? 'this value shape has no control yet')
        : null
    fields.push({
      name,
      label: positionLabel(name) ?? ui.label ?? name,
      group: ui.group,
      control: shapeReason ? 'readonly' : (ui.control as ControlKind),
      options: ui.control === 'enum' ? (ui.options ?? []) : null,
      // Null where unset means "no constraint" rather than a number — an
      // unset `maxWidth` is no limit, not zero. The list-shaped controls C8
      // built keep null too: their empty state is the `+` affordance, and a
      // default-shaped list would offer a paint the file does not have.
      // A loose edge shows a dash, not a number: the pin does not hold it, so
      // any value would be an offer the resolver ignores.
      value:
        looseEdge || LIST_CONTROLS.has(ui.control) ? null : (defaultFor(element, name) ?? null),
      raw: '',
      boundTo: null,
      readonlyReason: looseEdge ? LOOSE_EDGE_REASON : (shapeReason ?? reasonFor(name)),
      authored: false,
    })
  }
  return fields
}

/** Whether `parent` lays its children out — gates the Layout child section. */
function parentLaysOutChildren(parent: UidxNode | null): boolean {
  const mode = parent?.attrs.layoutMode?.value
  return mode === 'HORIZONTAL' || mode === 'VERTICAL'
}

/**
 * Groups a node's editable fields into the sections story C6 defines, in
 * `SECTION_ORDER`. A section with nothing applicable to `node.element` — or,
 * for Layout child, no laid-out parent — is omitted entirely. Fields the prop
 * table does not know (`group: null`) are excluded; the panel renders those
 * separately, unsectioned, as it always has.
 */
/**
 * The two props whose applicability is the *parent's* question, not the
 * element's — `appliesTo` cannot express that, so `sectionsFor` gates them.
 */
const CHILD_PARTICIPATION: ReadonlySet<string> = new Set(['layoutGrow', 'layoutAlign'])

/**
 * Who a near edge pairs with when its far edge is not on offer.
 *
 * Position's rows are one axis each — Left beside Right, Top beside Bottom —
 * and that holds wherever the node has edges to be pinned against. Directly
 * under `<Page>`, or on any axis the pin centres, it does not: `pinRowStanding`
 * calls the far edges `absent`, because an offset nothing resolves is not a
 * row worth dashing out. The near edges were then left partnerless and each
 * opened its own half-width row, which is how Position came to be the one
 * section in the panel that stacks two inputs where every other pairs them
 * (reported 2026-09-02).
 *
 * So they pair with each other instead, and the section keeps its promise:
 * two inputs on one line, a horizontal beside a vertical. Symmetric because
 * the loop visits authored rows first and may reach either half first; the
 * anchor is still chosen by `fieldOrderFor`, so the row reads Left | Top
 * whichever way it was entered.
 */
const FALLBACK_PAIR: Record<string, string | undefined> = {
  x: 'y',
  y: 'x',
  centerX: 'centerY',
  centerY: 'centerX',
}

/** Sorts one section's rows into `fieldOrderFor`'s order, unlisted ones last. */
function inFieldOrder(group: PropGroup, rows: PairedField[]): PairedField[] {
  const order = fieldOrderFor(group)
  const rank = (row: PairedField) => {
    const at = order.indexOf(row.field.name)
    return at === -1 ? order.length : at
  }
  return [...rows].sort((a, b) => rank(a) - rank(b))
}

export function sectionsFor(
  node: UidxNode,
  fields: readonly EditableProp[],
  parent: UidxNode | null,
): PropSection[] {
  // ADR 0007 §2: a fill carries `name` and nothing else, so the panel offers
  // nothing else. This is the grammar rule the parser enforces as UIDX131, and
  // it is a fact about *position* rather than element — the same `<Slot>` owns
  // its whole layout one page over. `appliesTo` is keyed by element and cannot
  // say it, which is why it is said here, beside the other parent-dependent
  // gates. Without this the panel would offer a control whose write the parser
  // rejects.
  if (node.element === 'Slot' && parent?.element === 'Instance') return []

  const byName = new Map(fields.map((f) => [f.name, f]))
  const consumed = new Set<string>()
  const byGroup = new Map<PropGroup, PairedField[]>()

  for (const current of fields) {
    if (current.group === null) continue
    if (PROP_UI_OPT_OUT.has(current.name)) continue
    if (consumed.has(current.name)) continue

    const ui = propUiFor(current.name)
    if (!ui) continue
    if (ui.appliesTo && !(ui.appliesTo as readonly string[]).includes(node.element)) continue
    // The separate "Layout child" section is gone (parity spec §2), but the
    // gate it carried belongs to these two props: how a node participates in
    // a flow is only a question where its parent has one.
    if (CHILD_PARTICIPATION.has(current.name) && !parentLaysOutChildren(parent)) continue
    // The absolute-position toggle sits in Position but exists only where
    // there is a flow to escape — same parent question as the section gate.
    if (current.name === 'layoutPositioning' && !parentLaysOutChildren(parent)) continue

    const available = (name: string | undefined): string | null =>
      name !== undefined && !consumed.has(name) && byName.has(name) ? name : null
    const partnerName = available(ui.pairs) ?? available(FALLBACK_PAIR[current.name])

    let anchor = current
    let pairedWith: EditableProp | null = null
    if (partnerName) {
      const partner = byName.get(partnerName)!
      // The anchor is fixed by the section's field order, not by which half
      // happens to be authored: iteration visits authored rows first, so a
      // node stating only `right` would otherwise anchor the pair on the far
      // edge — and the row's identity (its data-prop, its position) would
      // jump between selections. L|R and T|B sit still (review, 2026-08-30).
      const order = fieldOrderFor(current.group)
      const first = order.indexOf(current.name)
      const second = order.indexOf(partnerName)
      if (second !== -1 && (first === -1 || second < first)) {
        anchor = partner
        pairedWith = current
      } else {
        pairedWith = partner
      }
      consumed.add(partnerName)
    }

    consumed.add(current.name)
    const list = byGroup.get(anchor.group ?? current.group) ?? []
    list.push({ field: anchor, pairedWith })
    byGroup.set(anchor.group ?? current.group, list)
  }

  return sectionOrderFor(node.element as SceneElement)
    .filter((group) => byGroup.has(group))
    .map((group) => ({
      group,
      label: SECTION_LABEL[group],
      // Ordered by the spec rather than by however the file happened to list
      // its attributes: Visible leads Appearance, Content leads Text.
      fields: inFieldOrder(group, byGroup.get(group)!),
    }))
}

/** `node`'s parent in the tree, or null for the root or an unknown address. */
export function parentOf(root: UidxNode, address: string): UidxNode | null {
  const find = (candidate: UidxNode): UidxNode | null => {
    for (const child of candidate.children) {
      if (child.address === address) return candidate
      const hit = find(child)
      if (hit) return hit
    }
    return null
  }
  return address === '' ? null : find(root)
}

/**
 * The node the panel is editing.
 *
 * Selection is a list because the canvas can hold several nodes, but v1 edits
 * one at a time: a multi-select control has to model a mixed value, and
 * `NumberFieldRoot` supports that but nothing else here does yet. Showing the
 * single selected node — and nothing when several are selected — is the
 * honest version of that limit.
 */
export function selectedNode(root: UidxNode | null, selection: readonly string[]): UidxNode | null {
  if (!root || selection.length !== 1) return null
  const address = selection[0]!
  const find = (node: UidxNode): UidxNode | null => {
    if (node.address === address) return node
    for (const child of node.children) {
      const hit = find(child)
      if (hit) return hit
    }
    return null
  }
  return find(root)
}
