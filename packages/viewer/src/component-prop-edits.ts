import {
  aliasTarget,
  bindingFits,
  componentProps,
  matchesType,
  PROPERTY_FIELD,
  resolve,
  toAlias,
  type JsonValue,
  type PropertyDeclaration,
  type PropertyType,
  type UidxDocument,
  type UidxNode,
  type UidxPatch,
} from '@uidx/format'

/**
 * Declaring, renaming and removing a component's properties (story F6).
 *
 * Judgement only, no panel — the split `layer-moves.ts` keeps, and for the same
 * reason: a control has to grey itself out while the pointer is still moving,
 * which a refusal arriving after the write cannot do.
 *
 * Every edit here is a *structural* one. `props` is in `STRUCTURAL_PROPS`, so
 * `scenePropFor` stops it and it never reaches a scene node — which means these
 * cannot travel the panel's ordinary `commit` route through the graph. They are
 * patches, emitted straight at the document the way the layers rail's are.
 */

/** The whole declaration map as a plain value, ready to be written back. */
type Declared = Map<string, PropertyDeclaration>

const asValue = (declared: Declared): JsonValue =>
  Object.fromEntries(
    [...declared].map(([name, d]) => [name, { type: d.type, default: d.default } as JsonValue]),
  )

/**
 * One write of the whole map.
 *
 * `props` is a single attribute, so every change to any property rewrites all
 * of them — `add` when the component has none yet, `set` when it has, and
 * `remove` when the last one goes rather than leaving `props={{}}` behind for a
 * reader to wonder about.
 */
function writeProps(component: UidxNode, declared: Declared): UidxPatch {
  const address = component.address
  if (declared.size === 0) return { op: 'remove', address, prop: 'props' }
  if (component.attrs.props === undefined) {
    return { op: 'add', address, prop: 'props', value: asValue(declared) }
  }
  return { op: 'set', address, prop: 'props', value: asValue(declared) }
}

/** The `<Component>` at this address, or null for anything else. */
function componentAt(doc: UidxDocument, address: string): UidxNode | null {
  const node = resolve(doc.tree, address)
  return node && node.element === 'Component' ? node : null
}

/** Whether this name is the component's to take. Scoped, so only siblings collide. */
export function isPropertyNameFree(declared: Declared, name: string): boolean {
  const wanted = name.trim()
  if (wanted === '') return false
  // `#` would make `{name}` read as a token address (ADR 0004 §3).
  if (wanted.includes('#')) return false
  return !declared.has(wanted)
}

/** What a new property of this type starts out as. */
export function defaultFor(type: PropertyType): JsonValue {
  return type === 'BOOLEAN' ? true : type === 'TEXT' ? 'Text' : ''
}

/**
 * Declare one.
 *
 * Nothing binds to it yet, so this is one patch and no remap. An
 * `INSTANCE_SWAP` starts with an empty default, which is not a valid
 * declaration — so the caller must supply a component name, and the panel
 * refuses to add one until it has.
 */
export function declareProperty(
  doc: UidxDocument,
  address: string,
  name: string,
  type: PropertyType,
  fallback: JsonValue = defaultFor(type),
): UidxPatch[] | null {
  const component = componentAt(doc, address)
  if (!component) return null
  const { declared } = componentProps(component)
  const wanted = name.trim()
  if (!isPropertyNameFree(declared, wanted)) return null
  if (!matchesType(type, fallback)) return null

  return [writeProps(component, new Map([...declared, [wanted, { type, default: fallback }]]))]
}

/** Change what an unset instance falls back to. One write, no remap. */
export function setPropertyDefault(
  doc: UidxDocument,
  address: string,
  name: string,
  fallback: JsonValue,
): UidxPatch[] | null {
  const component = componentAt(doc, address)
  if (!component) return null
  const { declared } = componentProps(component)
  const current = declared.get(name)
  if (!current || !matchesType(current.type, fallback)) return null
  if (current.default === fallback) return null

  const next = new Map(declared)
  next.set(name, { ...current, default: fallback })
  return [writeProps(component, next)]
}

/**
 * Every place inside this component that reads `{name}`.
 *
 * Exported because the panel says how many there are before a rename or a
 * removal — a count is the difference between "this is safe" and "this touches
 * four layers", and the author should know which they are about to do.
 */
export function bindingSites(
  component: UidxNode,
  name: string,
): { address: string; prop: string }[] {
  const out: { address: string; prop: string }[] = []
  const walk = (node: UidxNode): void => {
    for (const [prop, attr] of Object.entries(node.attrs)) {
      if (aliasTarget(attr.value) === name) out.push({ address: node.address, prop })
    }
    node.children.forEach(walk)
  }
  // The component's own attributes cannot read its properties — a declaration
  // reading itself is not a thing — so the walk starts at its children.
  component.children.forEach(walk)
  return out
}

/**
 * Rename one, carrying every reference with it.
 *
 * This is the "rename is a remap, not a rename" the story asks for, and it is
 * `remapAddress` restated: the write that matters is one attribute, and the
 * fallout is every place that named the old thing. All of it in one envelope,
 * because a document holding a renamed property and a binding to its old name
 * is one `uidx check` reports.
 *
 * F7's instance values will join this list. Until they exist there is nothing
 * else to carry.
 */
export function renameProperty(
  doc: UidxDocument,
  address: string,
  from: string,
  to: string,
): UidxPatch[] | null {
  if (to.trim() === from) return null
  return editProperty(doc, address, from, to)
}

/**
 * Rename and re-default in one envelope — what the edit dialog submits.
 *
 * Both at once rather than a rename followed by a default: each writes the
 * whole `props` attribute, so two envelopes would compute the second against
 * the map the first replaced, and the second would be rebased away or land
 * wrong. `renameProperty` is this with the default left alone.
 */
export function editProperty(
  doc: UidxDocument,
  address: string,
  from: string,
  to: string,
  fallback?: JsonValue,
): UidxPatch[] | null {
  const component = componentAt(doc, address)
  if (!component) return null
  const { declared } = componentProps(component)
  const current = declared.get(from)
  const wanted = to.trim()
  if (!current) return null
  if (wanted !== from && !isPropertyNameFree(declared, wanted)) return null

  const value = fallback ?? current.default
  if (!matchesType(current.type, value)) return null

  // Rebuilt in order rather than deleted and appended, so a rename does not
  // reshuffle the panel — the list is the order the definition states, and F7
  // shows an instance's properties in it.
  const next = new Map<string, PropertyDeclaration>()
  for (const [key, declaration] of declared) {
    next.set(
      key === from ? wanted : key,
      key === from ? { ...declaration, default: value } : declaration,
    )
  }

  // A name that did not move has no binding to carry: every `{from}` already
  // reads the right thing.
  const moves = wanted === from ? [] : bindingSites(component, from)
  return [
    writeProps(component, next),
    ...moves.map((site): UidxPatch => ({
      op: 'set',
      address: site.address,
      prop: site.prop,
      value: toAlias(wanted),
    })),
  ]
}

/**
 * Remove one, and bake its default in wherever it was read.
 *
 * Not simply dropped: a binding whose property has gone is a dangling reference
 * `uidx check` reports and the renderer draws nothing for, so removing a
 * property would silently break the component that declared it. Writing the
 * last default at each site leaves the component looking exactly as it did and
 * the file saying literally what it now means — which is what "remove" ought to
 * mean for the person pressing it.
 */
export function removeProperty(
  doc: UidxDocument,
  address: string,
  name: string,
): UidxPatch[] | null {
  const component = componentAt(doc, address)
  if (!component) return null
  const { declared } = componentProps(component)
  const going = declared.get(name)
  if (!going) return null

  const next = new Map(declared)
  next.delete(name)

  return [
    writeProps(component, next),
    ...bindingSites(component, name).map((site): UidxPatch => ({
      op: 'set',
      address: site.address,
      prop: site.prop,
      value: going.default,
    })),
  ]
}

/** The attribute each type fills, for the panel's "binds to" hint. */
export { PROPERTY_FIELD }

/**
 * The `<Component>` a layer sits inside, or null when nothing does.
 *
 * `componentAt` above answers a different question — "is *this* a component" —
 * which is what a declaration edit needs. A binding edit starts from the layer
 * doing the reading, so it has to climb.
 *
 * The climb is a prefix, not a walk: an address is `entity#path` (ADR 0003 §2)
 * and the entity is the top-level thing, so the enclosing component is whatever
 * stands before the first `#`. An address with no `#` names an entity itself,
 * and an entity is inside nothing — which also settles the self-reference F6
 * ruled out, since a component cannot read the properties it declares.
 */
export function enclosingComponent(doc: UidxDocument, address: string): UidxNode | null {
  const cut = address.indexOf('#')
  if (cut === -1) return null
  const node = resolve(doc.tree, address.slice(0, cut))
  return node && node.element === 'Component' ? node : null
}

/** `PROPERTY_FIELD` read backwards: the type that may fill this field, if any. */
const FIELD_PROPERTY: Record<string, PropertyType> = Object.fromEntries(
  Object.entries(PROPERTY_FIELD).map(([type, field]) => [field, type as PropertyType]),
)

/**
 * Which property type this field takes, or null when no type fills it.
 *
 * This is the whole "predefined list of bindable fields" — derived from
 * `PROPERTY_FIELD` rather than restated, so the panel cannot drift from the
 * mapping `uidx check` enforces.
 */
export function propertyTypeForField(prop: string): PropertyType | null {
  return FIELD_PROPERTY[prop] ?? null
}

/** What a field may be linked to: the in-scope declarations of its one type. */
export function bindCandidates(
  doc: UidxDocument,
  address: string,
  prop: string,
): { name: string; declaration: PropertyDeclaration }[] | null {
  const type = propertyTypeForField(prop)
  if (!type) return null
  const component = enclosingComponent(doc, address)
  if (!component) return null
  return [...componentProps(component).declared]
    .filter(([, declaration]) => declaration.type === type)
    .map(([name, declaration]) => ({ name, declaration }))
}

/** Link a field to a declared property. The literal it held is discarded. */
export function bindProperty(
  doc: UidxDocument,
  address: string,
  prop: string,
  name: string,
): UidxPatch[] | null {
  const component = enclosingComponent(doc, address)
  const node = resolve(doc.tree, address)
  if (!component || !node) return null
  const declaration = componentProps(component).declared.get(name)
  if (!declaration || !bindingFits(declaration.type, prop)) return null
  const op = node.attrs[prop] === undefined ? 'add' : 'set'
  return [{ op, address, prop, value: toAlias(name) }]
}

/**
 * Unlink a field, leaving the property's declared default behind.
 *
 * The default rather than nothing, and rather than the *resolved* value: the
 * panel's resolver is number-typed for token scrubbing, so it answers `null`
 * for every TEXT binding — which is why the shipped detach button sat disabled
 * on `characters="{label}"`. Writing the default is also what makes unlinking
 * a no-op on the canvas, the way Figma's is.
 */
export function unbindProperty(
  doc: UidxDocument,
  address: string,
  prop: string,
): UidxPatch[] | null {
  const component = enclosingComponent(doc, address)
  const node = resolve(doc.tree, address)
  if (!component || !node) return null
  const attr = node.attrs[prop]
  const bound = attr ? aliasTarget(attr.value) : null
  if (!bound) return null
  const declaration = componentProps(component).declared.get(bound)
  if (!declaration) return null
  return [{ op: 'set', address, prop, value: declaration.default }]
}

/**
 * Declare a property and link this field to it, in one envelope.
 *
 * One envelope because neither half is a document `uidx check` accepts on its
 * own: a declaration nothing reads is dead weight, and a `{name}` nothing
 * declares is UIDX401. The same rule `renameProperty` follows.
 */
export function declareAndBindProperty(
  doc: UidxDocument,
  address: string,
  prop: string,
  name: string,
  fallback?: JsonValue,
): UidxPatch[] | null {
  const type = propertyTypeForField(prop)
  if (!type) return null
  const component = enclosingComponent(doc, address)
  const node = resolve(doc.tree, address)
  if (!component || !node) return null
  const { declared } = componentProps(component)
  const wanted = name.trim()
  if (!isPropertyNameFree(declared, wanted)) return null
  const value = fallback ?? defaultFor(type)
  if (!matchesType(type, value)) return null

  return [
    writeProps(component, new Map([...declared, [wanted, { type, default: value }]])),
    { op: node.attrs[prop] === undefined ? 'add' : 'set', address, prop, value: toAlias(wanted) },
  ]
}
