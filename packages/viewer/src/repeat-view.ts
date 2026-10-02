import type { UidxDocument, UidxNode } from '@uidx/format'
import { repeatModel, repeatOf, type ModelIndex, type RepeatScope } from '@uidx/schema'
import { enclosingComponent } from './component-prop-edits'
import {
  ancestorsWithin,
  enclosingRepeats,
  repeatFacet,
  type RepeatBinding,
} from './contract-edits'

/**
 * What the Repeat section reads about a layer (ADR 0017 §2): whether it
 * repeats and over which model, the lists of each model it could take its
 * items from, and the repeat it already sits inside — nothing more. Binding
 * the item's fields is the bind button's job, not this view's.
 */

/** A repeat enclosing the layer: the template it is part of. */
export interface EnclosingRepeat {
  name: string
  address: string
  list: string
  as: string
  model: string | null
}

export interface RepeatView {
  component: UidxNode
  /** This layer's own repeat, when it has one. */
  own: RepeatBinding | null
  /** Lists it could repeat over, with their types: enclosing items' list fields first, then the component's. */
  lists: { list: string; type: string }[]
  /** Repeats it sits inside, outermost first. */
  enclosing: EnclosingRepeat[]
}

/** The type a list draws: the component prop's, or the enclosing item's field's. */
function listType(component: UidxNode, list: string, scopes: readonly RepeatScope[]): string {
  const [head, ...rest] = list.split('.')
  if (rest.length === 0)
    return component.spec?.contract?.props.find((prop) => prop.name === head)?.type ?? ''
  const scope = [...scopes].reverse().find((candidate) => candidate.as === head)
  return scope?.model?.fields.find((field) => field.name === rest.join('.'))?.type ?? ''
}

export function repeatView(
  doc: UidxDocument | null,
  node: UidxNode,
  _components: ReadonlyMap<string, UidxNode> | undefined,
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
  return {
    component,
    own: facet.repeat,
    lists: facet.lists.map((list) => ({ list, type: listType(component, list, scopes) })),
    enclosing,
  }
}
