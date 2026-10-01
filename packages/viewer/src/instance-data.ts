import { aliasTarget, slots, type ModelSpec, type UidxDocument, type UidxNode } from '@uidx/format'
import { modelOfType, repeatModel, repeatOf, sampleAt, type ModelIndex } from '@uidx/schema'
import { enclosingComponent } from './component-prop-edits'
import { enclosingRepeats, itemLabel } from './contract-edits'
import { fillContext } from './slot-content'

/**
 * The Data group of the instance inspector: what each contract prop of the
 * instance's component is given here (ADR 0013, ADR 0017 §2).
 *
 * Inside a repeat — or filling a repeated slot — a prop is bound to the item
 * or one of its fields the way a token is bound: by picking it. Nothing is
 * passed until the designer picks. Outside any repeat there is no item to
 * bind, and the canvas previews the model's items one at a time.
 */
export type DataSource =
  | { kind: 'bind'; bound: string | null; options: BindOption[] }
  | { kind: 'samples'; count: number }
  | { kind: 'sample'; index: number; count: number; label: string }
  | { kind: 'none' }

export interface DataRow {
  prop: string
  type: string
  /** The model the type names, for the link to its declaration. */
  model: string | null
  source: DataSource
}

/** How many distinct rows a model's samples give: the longest sample list. */
export function sampleCount(model: ModelSpec): number {
  return Math.max(
    1,
    ...model.fields.map((field) => (Array.isArray(field.sample) ? field.sample.length : 1)),
  )
}

/** One row of samples in a few words: its name-like field, else its first text. */
export function sampleLabel(model: ModelSpec, index: number): string {
  const named =
    model.fields.find((field) => /^(name|title|label|heading)$/i.test(field.name)) ??
    model.fields.find((field) => typeof sampleAt(field, index) === 'string' && !field.key)
  const value = named ? sampleAt(named, index) : undefined
  return typeof value === 'string' && value ? value : `Row ${index + 1}`
}

/** An item in scope at an instance: a repeat it sits in, by the name bindings use. */
export interface ItemScope {
  as: string
  model: ModelSpec | null
}

/** One thing a prop can be bound to: the item, or a field of it, with its type. */
export interface BindOption {
  alias: string
  type: string
  /** How it reads in the panel: "This Person", "This Person › name". */
  label: string
}

/**
 * The items an instance can bind to, outermost first: the repeats around it
 * in its component, its own repeat, or — filling a repeated slot on a page —
 * the slot's item, which the list hands each copy.
 */
export function itemScopes(
  doc: UidxDocument | null,
  instance: UidxNode,
  components: ReadonlyMap<string, UidxNode> | undefined,
  models: ModelIndex | undefined,
): ItemScope[] {
  if (!doc) return []
  const component = enclosingComponent(doc, instance.address)
  if (component) {
    const scopes = enclosingRepeats(component, instance, models)
    const own = repeatOf(instance)
    if (own) scopes.push({ as: own.as, model: repeatModel(own, component.spec, scopes, models) })
    return scopes.map((scope) => ({ as: scope.as, model: scope.model ?? null }))
  }
  const filling = fillContext(doc.tree, instance.address, components, models)
  if (!filling?.repeat) return []
  const definition = components?.get(filling.component)
  const slot = definition ? slots(definition).declared.get(filling.slot) : undefined
  const repeat = slot ? repeatOf(slot) : null
  if (!repeat) return []
  return [
    {
      as: repeat.as,
      model: filling.repeat.model ? (models?.get(filling.repeat.model) ?? null) : null,
    },
  ]
}

/** What a prop of `type` can be bound to, the nearest item first: the item itself, then its fields. */
export function bindOptions(scopes: readonly ItemScope[], type: string): BindOption[] {
  const wanted = type.replace(/\s+/g, '')
  const out: BindOption[] = []
  for (const scope of [...scopes].reverse()) {
    if (scope.model?.name === wanted)
      out.push({ alias: scope.as, type: wanted, label: itemLabel(scope.as, [], scopes) })
    for (const field of scope.model?.fields ?? [])
      if (field.type.replace(/\s+/g, '') === wanted)
        out.push({
          alias: `${scope.as}.${field.name}`,
          type: field.type,
          label: itemLabel(scope.as, [field.name], scopes),
        })
  }
  return out
}

/** The alias a use binds a prop to, `item.name` for `{item.name}`, or null. */
export function boundAlias(instance: UidxNode, prop: string): string | null {
  const props = instance.attrs.props?.value
  const value =
    props && typeof props === 'object' && !Array.isArray(props)
      ? (props as Record<string, unknown>)[prop]
      : undefined
  return typeof value === 'string' ? aliasTarget(value) : null
}

export function dataRows(
  doc: UidxDocument | null,
  instance: UidxNode,
  definition: UidxNode | undefined,
  components: ReadonlyMap<string, UidxNode> | undefined,
  models: ModelIndex | undefined,
  previewIndex: number,
): DataRow[] {
  const props = definition?.spec?.contract?.props ?? []
  if (!definition || !props.length) return []
  const scopes = itemScopes(doc, instance, components, models)
  return props.map((prop) => {
    const found = modelOfType(prop.type, definition.spec, models)
    const model = found?.model.name ?? null
    const base = { prop: prop.name, type: prop.type, model }
    if (scopes.length)
      return {
        ...base,
        source: {
          kind: 'bind' as const,
          bound: boundAlias(instance, prop.name),
          options: bindOptions(scopes, prop.type),
        },
      }
    if (found?.list)
      return { ...base, source: { kind: 'samples', count: sampleCount(found.model) } }
    if (found) {
      const count = sampleCount(found.model)
      const index = previewIndex % count
      return {
        ...base,
        source: { kind: 'sample', index, count, label: sampleLabel(found.model, index) },
      }
    }
    return { ...base, source: { kind: 'none' } }
  })
}

/** A component's own model props, which its page previews with one sample row. */
export function previewModel(
  component: UidxNode | undefined,
  models: ModelIndex | undefined,
): { prop: string; model: ModelSpec } | null {
  for (const prop of component?.spec?.contract?.props ?? []) {
    const found = modelOfType(prop.type, component?.spec, models)
    if (found && !found.list) return { prop: prop.name, model: found.model }
  }
  return null
}

/** A bound alias as the panel shows it: "This Person › name". */
export function aliasLabel(alias: string, scopes: readonly ItemScope[]): string {
  const [head, ...rest] = alias.split('.')
  return itemLabel(head!, rest, scopes)
}

/**
 * The rows in scope for children of `container`: the repeats around it in
 * its component and its own, or — a fill of a repeated slot on a page — the
 * slot's row. What a component placed there could be bound to.
 */
export function scopesInside(
  doc: UidxDocument,
  container: UidxNode,
  components: ReadonlyMap<string, UidxNode> | undefined,
  models: ModelIndex | undefined,
): ItemScope[] {
  const component =
    container.element === 'Component' ? container : enclosingComponent(doc, container.address)
  if (component) {
    const scopes = container === component ? [] : enclosingRepeats(component, container, models)
    const own = repeatOf(container)
    if (own) scopes.push({ as: own.as, model: repeatModel(own, component.spec, scopes, models) })
    return scopes.map((scope) => ({ as: scope.as, model: scope.model ?? null }))
  }
  // A fill: `<Instance><Slot name="item">…` on a page, the slot repeated in its definition.
  const host = parentIn(doc.tree, container.address)
  if (container.element !== 'Slot' || host?.element !== 'Instance') return []
  const named = host.attrs.component?.value
  const definition = typeof named === 'string' ? components?.get(named) : undefined
  const slot = definition ? slots(definition).declared.get(container.name) : undefined
  const repeat = slot ? repeatOf(slot) : null
  if (!definition || !repeat) return []
  const model = repeatModel(repeat, definition.spec, [], models)
  return [{ as: repeat.as, model: model ?? null }]
}

function parentIn(root: UidxNode, address: string): UidxNode | null {
  for (const child of root.children) {
    if (child.address === address) return root
    const found = parentIn(child, address)
    if (found) return found
  }
  return null
}

/**
 * The binding a component gets when it is placed where a row is in scope
 * and it takes that row's model: `{ person: '{item}' }`. Written at the
 * moment of placing, in the file, as a pill the designer sees and can
 * remove — never inferred later. Null when nothing fits.
 */
export function rowBindingFor(
  definition: UidxNode | undefined,
  scopes: readonly ItemScope[],
): Record<string, string> | null {
  const row = scopes.at(-1)
  if (!definition || !row?.model) return null
  const prop = definition.spec?.contract?.props.find(
    (candidate) => candidate.type.replace(/\s+/g, '') === row.model!.name,
  )
  return prop ? { [prop.name]: `{${row.as}}` } : null
}
