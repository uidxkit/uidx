import type { UidxDocument, UidxNode } from '@uidx/format'

/**
 * What the Contract, Connect and Code tabs are about, from one selection.
 *
 * The three tabs used to answer this separately and disagreed: an instance
 * of PersonRow inside List was PersonRow to Code and List to Connect. One
 * resolver means one answer — an instance is about the component it uses,
 * any other layer inside a component is about that component — and the tabs
 * only differ in what they do with it.
 */
export interface Subject {
  /**
   * - `none`: nothing selected; `multi`: several layers.
   * - `component`: a `<Component>` itself.
   * - `instance`: an `<Instance>`, about the component it uses.
   * - `inside`: a layer inside a top-level component, about that component.
   * - `outside`: a layer in no component.
   */
  kind: 'none' | 'multi' | 'component' | 'inside' | 'instance' | 'outside'
  /** The component's name, or null for none, multi and outside. */
  name: string | null
  /** That component as declared in this document, when it is; what Connect edits. */
  local: UidxNode | null
  /** That component wherever it is declared: `local`, or another page's (from `components`). */
  definition: UidxNode | null
  /** 'of List' when the subject is not the selected layer itself; null when it is, or there is none. */
  relation: string | null
}

const empty = (kind: 'none' | 'multi' | 'outside'): Subject => ({
  kind,
  name: null,
  local: null,
  definition: null,
  relation: null,
})

/** The top-level `<Component>` of `doc` called `name`, if it declares one. */
function topComponent(doc: UidxDocument | null, name: string): UidxNode | null {
  return (
    doc?.tree.children.find((child) => child.element === 'Component' && child.name === name) ?? null
  )
}

/**
 * Resolves the selection to the tabs' subject. Rules, in order: several
 * layers; nothing; a component; an instance naming a component; a layer
 * inside a top-level component; anything else.
 */
export function resolveSubject(
  doc: UidxDocument | null,
  active: UidxNode | null,
  selected: number,
  /** Component name -> definition across every page, for an instance of another page's. */
  components?: ReadonlyMap<string, UidxNode>,
): Subject {
  if (selected > 1) return empty('multi')
  if (!active) return empty('none')
  if (active.element === 'Component')
    return {
      kind: 'component',
      name: active.name,
      local: active,
      definition: active,
      relation: null,
    }
  const used = active.attrs.component?.value
  if (active.element === 'Instance' && typeof used === 'string' && used !== '') {
    const local = topComponent(doc, used)
    return {
      kind: 'instance',
      name: used,
      local,
      definition: local ?? components?.get(used) ?? null,
      relation: `of ${used}`,
    }
  }
  const entity = active.address.split('#')[0]!
  const top = doc?.tree.children.find((child) => child.address === entity)
  if (top?.element === 'Component')
    return {
      kind: 'inside',
      name: top.name,
      local: top,
      definition: top,
      relation: `of ${top.name}`,
    }
  return empty('outside')
}
