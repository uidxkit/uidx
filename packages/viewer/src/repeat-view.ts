import { aliasTarget, type JsonValue, type UidxDocument, type UidxNode } from '@uidx/format'
import { modelByRef, repeatModel, repeatOf, type ModelIndex, type RepeatScope } from '@uidx/schema'
import { enclosingComponent } from './component-prop-edits'
import {
  ancestorsWithin,
  enclosingRepeats,
  receivesFor,
  repeatFacet,
  type RepeatBinding,
} from './contract-edits'

/**
 * Repeat as a template (ADR 0017 §2), for the Repeat section of the Design
 * tab. Any layer inside a component — a frame, a text, an instance, a slot —
 * may repeat over a list; the layer and everything inside it is then the
 * template drawn once per item. Inside, layers bind to the item's fields
 * (`{item.name}`), a nested component receives the item, and a list field of
 * the item (`{item.tags}`) can be repeated again: a tree, or a grouped list.
 *
 * So the section says three things about a layer: whether it repeats and over
 * what; which repeats it already sits inside (it is part of their template);
 * and, for the innermost item, what the template can bind to and what in it
 * already does.
 */

/** A repeat enclosing the layer: the template it is part of. */
export interface EnclosingRepeat {
  /** The repeated layer, to select it. */
  name: string
  address: string
  list: string
  as: string
  model: string | null
}

/** One binding a layer in the template can use. */
export interface ItemField {
  /** `item.name`, as written inside `{…}`. */
  path: string
  type: string
  /** True for a list field: something to repeat over inside, not to show. */
  list: boolean
}

/** Something in the template that reads the item. */
export interface ItemUse {
  name: string
  address: string
  /** `name ← item.name`, or `PersonRow receives item`. */
  detail: string
}

export interface RepeatView {
  component: UidxNode
  /** This layer's own repeat, when it has one. */
  own: RepeatBinding | null
  /** Lists it may repeat over: enclosing items' list fields first, then the contract's. */
  lists: { list: string; type: string; nested: boolean }[]
  /** Repeats it sits inside, outermost first. */
  enclosing: EnclosingRepeat[]
  /** The innermost item in scope here — its own, else the nearest enclosing — and its fields. */
  scope: { as: string; model: string | null; fields: ItemField[] } | null
  /** Layers in this repeat's template that read its item; empty when it does not repeat. */
  uses: ItemUse[]
  /** A repeat on a container of one row: the row is likelier what was meant. */
  wrapsOne: { address: string; name: string } | null
}

/** The type a list option draws, for the picker: the prop's, or the model field's. */
function listType(component: UidxNode, list: string, scopes: readonly RepeatScope[]): string {
  const [head, ...rest] = list.split('.')
  if (rest.length === 0)
    return component.spec?.contract?.props.find((prop) => prop.name === head)?.type ?? ''
  const scope = [...scopes].reverse().find((candidate) => candidate.as === head)
  return scope?.model?.fields.find((field) => field.name === rest.join('.'))?.type ?? ''
}

/** Every `{as.…}` a layer's attributes read, as `[attribute, path]`. */
function readsOf(node: UidxNode, as: string): [string, string][] {
  const out: [string, string][] = []
  const visit = (attr: string, value: JsonValue): void => {
    if (typeof value === 'string') {
      const target = aliasTarget(value)
      if (target && (target === as || target.startsWith(`${as}.`))) out.push([attr, target])
    } else if (Array.isArray(value)) value.forEach((entry) => visit(attr, entry))
    else if (value && typeof value === 'object')
      for (const entry of Object.values(value)) visit(attr, entry as JsonValue)
  }
  for (const [name, attr] of Object.entries(node.attrs)) {
    if (name === 'repeat' || name === 'as') continue
    visit(name, attr.value)
  }
  return out
}

export function repeatView(
  doc: UidxDocument | null,
  node: UidxNode,
  components: ReadonlyMap<string, UidxNode> | undefined,
  models?: ModelIndex,
): RepeatView | null {
  if (!doc) return null
  const component = enclosingComponent(doc, node.address)
  if (!component || component === node) return null
  const facet = repeatFacet(component, node, models)
  const scopes = enclosingRepeats(component, node, models)

  const enclosing: EnclosingRepeat[] = []
  for (const ancestor of ancestorsWithin(component, node)) {
    const repeat = repeatOf(ancestor)
    if (!repeat) continue
    const model = repeatModel(repeat, component.spec, scopes.slice(0, enclosing.length), models)
    enclosing.push({
      name: ancestor.name,
      address: ancestor.address,
      list: repeat.list,
      as: repeat.as,
      model: model?.name ?? null,
    })
  }

  const ownAttrs = repeatOf(node)
  const ownModel = ownAttrs ? repeatModel(ownAttrs, component.spec, scopes, models) : undefined
  const inner = ownAttrs
    ? { as: ownAttrs.as, model: ownModel ?? null }
    : scopes.length
      ? scopes[scopes.length - 1]!
      : null
  const scope = inner
    ? {
        as: inner.as,
        model: inner.model?.name ?? null,
        fields: (inner.model?.fields ?? []).map((field) => {
          const list = field.type.trim().endsWith('[]')
          const nested = !list && modelByRef(component.spec, field.type, models)
          return {
            path: `${inner.as}.${field.name}`,
            type: field.type,
            list: list,
            ...(nested ? { type: nested.name } : {}),
          }
        }),
      }
    : null

  // What in the template reads the item: bound attributes, and nested
  // components that receive it — the template's dependence on the item,
  // which is what makes repeating it more than drawing copies.
  const uses: ItemUse[] = []
  if (ownAttrs) {
    const as = ownAttrs.as
    const walk = (current: UidxNode): void => {
      for (const [attr, path] of readsOf(current, as))
        uses.push({ name: current.name, address: current.address, detail: `${attr} ← ${path}` })
      if (current.element === 'Instance') {
        const named = current.attrs.component?.value
        const definition = typeof named === 'string' ? (components?.get(named) ?? null) : null
        const rows = receivesFor(current, definition, component, models)
        for (const row of rows)
          if (row.from === as || row.from?.startsWith(`${as}.`))
            uses.push({
              name: current.name,
              address: current.address,
              detail: `${named as string} receives ${row.from} as ${row.prop}`,
            })
        return
      }
      for (const child of current.children) {
        // A nested repeat over this item's list is part of the template too.
        const nested = repeatOf(child)
        if (nested && (nested.list === as || nested.list.startsWith(`${as}.`)))
          uses.push({
            name: child.name,
            address: child.address,
            detail: `repeats over ${nested.list}`,
          })
        walk(child)
      }
    }
    walk(node)
  }

  return {
    component,
    own: facet.repeat,
    lists: facet.lists.map((list) => ({
      list,
      type: listType(component, list, [...scopes]),
      nested: list.includes('.'),
    })),
    enclosing,
    scope,
    uses,
    wrapsOne: facet.wrapsOne,
  }
}
