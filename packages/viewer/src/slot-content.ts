import {
  aliasTarget,
  slotFills,
  slots,
  type UidxDocument,
  type UidxNode,
  type UidxNodeSpec,
  type UidxPatch,
} from '@uidx/format'
import { modelOfType, type ModelIndex } from '@uidx/schema'

/**
 * What an instance's slots hold, and what each could hold instead — the model
 * behind the Slots group of the instance inspector and its content picker.
 *
 * The picker is the injection gesture of ADR 0017 §2 (a list's repeated slot
 * filled with another item component, React's render prop), so the useful
 * order is not alphabetical: a component that *receives* the row's item comes
 * first, because it is the one that will show a different person on each row.
 */

/** What a slot shows on this instance. */
export type SlotContent =
  | { kind: 'default'; label: string; component: string | null }
  | { kind: 'component'; label: string; component: string; address: string }
  | { kind: 'text'; label: string; address: string }
  | { kind: 'empty'; label: string }
  | { kind: 'layers'; label: string; address: string }

/** One component the picker offers. */
export interface SlotChoice {
  name: string
  /** The prop that receives the row's item, when the slot repeats a model. */
  receives: string | null
  /** The component page's own first paragraph, unless it is still a placeholder. */
  note: string
}

export interface SlotRepeat {
  /** The definition's list prop the slot repeats over — `items`. */
  list: string
  /** The model of one item — `Person` — or null when the prop is not a model list. */
  model: string | null
  /** How many sample rows the canvas draws. */
  count: number
}

export interface SlotCard {
  name: string
  /** The fill `<Slot>` this instance authors, when it authors one. */
  fill: UidxNode | null
  content: SlotContent
  /** What the definition puts there when the instance says nothing. */
  fallback: SlotContent & { kind: 'default' }
  repeat: SlotRepeat | null
  /** Components that receive the item, or that the slot's `accepts` names. */
  suggested: SlotChoice[]
  others: SlotChoice[]
  /** Said under the card: a choice that will draw the same thing on every row. */
  warning: string | null
}

const PLACEHOLDER = 'Describe '

/** The first paragraph of a page that declares `name`, unless it is still the template's. */
export function componentNote(
  pages: ReadonlyMap<string, UidxDocument> | undefined,
  name: string,
): string {
  for (const doc of pages?.values() ?? []) {
    if (!doc.tree.children.some((child) => child.element === 'Component' && child.name === name))
      continue
    const first =
      (doc.intent?.raw ?? '')
        .trim()
        .split(/\n\s*\n/)[0]
        ?.trim() ?? ''
    return first.startsWith(PLACEHOLDER) ? '' : first.replace(/\s+/g, ' ')
  }
  return ''
}

/** How a list of layers reads in one line. */
function describe(children: readonly UidxNode[]): SlotContent {
  if (children.length === 0) return { kind: 'empty', label: 'Empty' }
  const [only] = children
  if (children.length === 1 && only?.element === 'Instance') {
    const component = only.attrs.component?.value
    if (typeof component === 'string')
      return { kind: 'component', label: component, component, address: only.address }
  }
  if (children.length === 1 && only?.element === 'Text')
    return { kind: 'text', label: 'Text', address: only.address }
  return { kind: 'layers', label: `${children.length} layers`, address: children[0]!.address }
}

/** A repeat's list prop and its model, read off the definition's contract. */
function repeatOf(
  definition: UidxNode,
  slot: UidxNode,
  models: ModelIndex | undefined,
): SlotRepeat | null {
  const raw = slot.attrs.repeat?.value
  const list = typeof raw === 'string' ? (aliasTarget(raw) ?? null) : null
  if (!list) return null
  const prop = definition.spec?.contract?.props.find((candidate) => candidate.name === list)
  const found = prop ? modelOfType(prop.type, definition.spec, models) : undefined
  const model = found?.list ? found.model : null
  const count = Math.max(
    1,
    ...(model?.fields ?? []).map((field) =>
      Array.isArray(field.sample) ? field.sample.length : 1,
    ),
  )
  return { list, model: model?.name ?? null, count }
}

/** The contract prop of `component` typed by `model`, which a repeat hands its item to. */
export function receivingProp(component: UidxNode | undefined, model: string): string | null {
  const prop = component?.spec?.contract?.props.find((candidate) => candidate.type.trim() === model)
  return prop?.name ?? null
}

export function slotCards(
  instance: UidxNode,
  definition: UidxNode | undefined,
  components: ReadonlyMap<string, UidxNode> | undefined,
  models?: ModelIndex,
  pages?: ReadonlyMap<string, UidxDocument>,
): SlotCard[] {
  if (!definition) return []
  const fills = slotFills(instance).fills
  const accepts = new Map(
    (definition.spec?.contract?.slots ?? []).map((slot) => [slot.name, slot.accepts]),
  )
  return [...slots(definition).declared].map(([name, slot]) => {
    const fill = fills.get(name) ?? null
    const repeat = repeatOf(definition, slot, models)
    const described = describe(slot.children)
    const fallback = {
      kind: 'default' as const,
      label: described.kind === 'component' ? described.component : described.label,
      component: described.kind === 'component' ? described.component : null,
    }
    const content: SlotContent = fill ? describe(fill.children) : fallback
    const allowed = acceptedSet(accepts.get(name))
    const suggested: SlotChoice[] = []
    const others: SlotChoice[] = []
    for (const candidate of [...(components?.keys() ?? [])].sort()) {
      if (candidate === definition.name) continue
      if (allowed && !fitsAccepts(components?.get(candidate), allowed)) continue
      const receives = repeat?.model
        ? receivingProp(components?.get(candidate), repeat.model)
        : null
      const choice = { name: candidate, receives, note: componentNote(pages, candidate) }
      if (receives || allowed) suggested.push(choice)
      else others.push(choice)
    }
    const warning = null
    return { name, fill, content, fallback, repeat, suggested, others, warning }
  })
}

/** `accepts="hwc-radio"` as a set; `a|b` names several. Null when the slot takes anything. */
export function acceptedSet(accepts: string | undefined): Set<string> | null {
  return accepts
    ? new Set(accepts.split(/[|,]/).map((part) => part.trim().replace(/\[\]$/, '')))
    : null
}

/**
 * Whether a component may fill a slot that `accepts` (ADR 0017 §1): it
 * implements the headless element the slot names — what the audit checks —
 * or, for a slot that names components outright, it is one of them.
 */
export function fitsAccepts(
  component: UidxNode | undefined,
  allowed: ReadonlySet<string>,
): boolean {
  if (!component) return false
  const implemented = component.attrs.implements?.value
  return (
    allowed.has(component.name) || (typeof implemented === 'string' && allowed.has(implemented))
  )
}

/** What the picker hands back: a component, plain text, explicitly nothing, or the default. */
export type SlotPick =
  { kind: 'component'; name: string } | { kind: 'text' } | { kind: 'empty' } | { kind: 'default' }

function contentFor(pick: SlotPick): UidxNodeSpec | null {
  if (pick.kind === 'component')
    return {
      element: 'Instance',
      attrs: {
        name: pick.name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase(),
        component: pick.name,
      },
    }
  if (pick.kind === 'text') return { element: 'Text', attrs: { name: 'text', characters: 'Text' } }
  return null
}

/**
 * The edit a pick makes, as one undoable batch. Replacing what a fill holds
 * keeps the fill itself — a swap is one gesture, not "reset, then choose" —
 * and choosing the default removes the fill, so the instance follows the
 * definition again when it changes (ADR 0007 §2).
 */
export function pickPatches(instance: UidxNode, card: SlotCard, pick: SlotPick): UidxPatch[] {
  const fill = card.fill
  if (pick.kind === 'default') return fill ? [{ op: 'remove-node', address: fill.address }] : []
  const node = contentFor(pick)
  if (!fill)
    return [
      {
        op: 'insert-node',
        parent: instance.address,
        index: instance.children.length,
        node: { element: 'Slot', attrs: { name: card.name }, children: node ? [node] : [] },
      },
    ]
  // Emptied as a fresh `<Slot name="…" />` rather than by deleting what it
  // held, which would leave the fill as an open tag around blank lines.
  if (!node)
    return [
      { op: 'remove-node', address: fill.address },
      {
        op: 'insert-node',
        parent: instance.address,
        index: instance.children.indexOf(fill),
        node: { element: 'Slot', attrs: { name: card.name }, children: [] },
      },
    ]
  return [
    ...fill.children.map((child): UidxPatch => ({ op: 'remove-node', address: child.address })),
    { op: 'insert-node', parent: fill.address, index: 0, node },
  ]
}

/** Where a node sits when it fills another instance's slot — the injected-content context. */
export interface FillContext {
  /** The instance whose slot this fills. */
  owner: UidxNode
  /** Its component. */
  component: string
  slot: string
  repeat: SlotRepeat | null
}

export function fillContext(
  root: UidxNode,
  address: string,
  components: ReadonlyMap<string, UidxNode> | undefined,
  models?: ModelIndex,
): FillContext | null {
  const chain = pathTo(root, address)
  if (!chain || chain.length < 3) return null
  const fill = chain[chain.length - 2]!
  const owner = chain[chain.length - 3]!
  if (fill.element !== 'Slot' || owner.element !== 'Instance') return null
  const component = owner.attrs.component?.value
  if (typeof component !== 'string') return null
  const definition = components?.get(component)
  const slot = definition ? slots(definition).declared.get(fill.name) : undefined
  return {
    owner,
    component,
    slot: fill.name,
    repeat: definition && slot ? repeatOf(definition, slot, models) : null,
  }
}

function pathTo(node: UidxNode, address: string): UidxNode[] | null {
  if (node.address === address) return [node]
  for (const child of node.children) {
    const found = pathTo(child, address)
    if (found) return [node, ...found]
  }
  return null
}

/* ------------------------------------------- a slot in its own component */

/**
 * The slot as its component's author sees it: what it draws by default and
 * what could go there — the same card a use shows, with the definition's own
 * content as the content, so the one picker serves both.
 */
export function definitionSlotCard(
  definition: UidxNode,
  slot: UidxNode,
  components: ReadonlyMap<string, UidxNode> | undefined,
  models?: ModelIndex,
  pages?: ReadonlyMap<string, UidxDocument>,
): SlotCard {
  const host: UidxNode = { ...slot, element: 'Instance', children: [] }
  const card = slotCards(host, definition, components, models, pages).find(
    (candidate) => candidate.name === slot.name,
  )
  const content = describe(slot.children)
  const base: SlotCard = card ?? {
    name: slot.name,
    fill: null,
    content,
    fallback: { kind: 'default', label: content.label, component: null },
    repeat: repeatOf(definition, slot, models),
    suggested: [],
    others: [],
    warning: null,
  }
  return { ...base, content }
}

/** The definition's own default content replaced by a pick: one undoable edit on the slot. */
export function defaultContentPatches(slot: UidxNode, pick: SlotPick): UidxPatch[] {
  if (pick.kind === 'default') return []
  const node = contentFor(pick)
  return [
    ...slot.children.map((child): UidxPatch => ({ op: 'remove-node', address: child.address })),
    ...(node ? [{ op: 'insert-node' as const, parent: slot.address, index: 0, node }] : []),
  ]
}

/** Every headless element a slot could require, with the components that implement each. */
export function acceptOptions(
  components: ReadonlyMap<string, UidxNode> | undefined,
  libraryRoots: readonly string[],
  current: string | undefined,
): { tag: string; fits: string[] }[] {
  const byTag = new Map<string, string[]>()
  for (const tag of libraryRoots) byTag.set(tag, [])
  for (const component of components?.values() ?? []) {
    const implemented = component.attrs.implements?.value
    if (typeof implemented !== 'string') continue
    byTag.set(implemented, [...(byTag.get(implemented) ?? []), component.name])
  }
  if (current && !byTag.has(current)) byTag.set(current, [])
  return [...byTag]
    .map(([tag, fits]) => ({ tag, fits: fits.sort() }))
    .sort((a, b) => b.fits.length - a.fits.length || a.tag.localeCompare(b.tag))
}
