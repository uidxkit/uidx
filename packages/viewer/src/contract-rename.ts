import {
  declarationOf,
  toAlias,
  type UidxDocument,
  type UidxNode,
  type UidxPatch,
} from '@uidx/format'

import { bindingSites } from './component-prop-edits'
import { examplesOf, examplesPatch } from './docs-edits'

/** A prop name: a bare word that `{name}` can read (never a `#`, which is a token's). */
export const PROP_NAME = /^[a-z][A-Za-z0-9]*$/

/**
 * Renames a contract prop (ADR 0013 §2) and carries everything that reads it:
 * the `{prop}` bindings inside the component, the styles table's rows keyed
 * by it (a visual prop is an axis), the examples that set it, and the
 * `props` of every instance of the component on any page. One plan, one
 * batch per file — renaming by hand would leave each of those broken.
 */
export function renameContractProp(
  pages: ReadonlyMap<string, UidxDocument>,
  file: string,
  from: string,
  to: string,
): { byFile: Map<string, UidxPatch[]> } | { refused: string } {
  const doc = pages.get(file)
  const component = doc?.tree.children.find((node) => node.element === 'Component')
  const declaration = doc ? declarationOf(doc, 'prop', from) : undefined
  if (!doc || !component || !declaration) return { refused: `there is no prop ${from} to rename` }
  const name = to.trim()
  if (!PROP_NAME.test(name))
    return { refused: 'a prop name is one word in camelCase, starting with a lower-case letter' }
  if (doc.spec?.contract?.props.some((prop) => prop.name === name))
    return { refused: `there is already a prop called ${name}` }

  const byFile = new Map<string, UidxPatch[]>()
  const batch = (target: string): UidxPatch[] => {
    const list = byFile.get(target) ?? []
    byFile.set(target, list)
    return list
  }

  const own = batch(file)
  own.push({ op: 'contract', kind: 'prop', name: from, declaration, rename: name })
  for (const site of bindingSites(component, from))
    own.push({ op: 'set', address: site.address, prop: site.prop, value: toAlias(name) })
  for (const row of doc.spec?.styles ?? []) {
    if (!(from in row.keys)) continue
    const keys = Object.fromEntries(
      Object.entries(row.keys).map(([axis, value]) => [axis === from ? name : axis, value]),
    )
    own.push(
      { op: 'style', keys: { ...row.keys }, target: '', prop: '' },
      { op: 'style', keys, target: '', prop: '', value: structuredClone(row.values) },
    )
  }
  const examples = examplesOf(doc)
  if (examples.some((example) => example.sets.some((set) => set.at === from)))
    own.push(
      examplesPatch(
        examples.map((example) => ({
          ...example,
          sets: example.sets.map((set) => (set.at === from ? { ...set, at: name } : set)),
        })),
      ),
    )

  for (const [page, pageDoc] of pages) {
    const walk = (node: UidxNode): void => {
      const props = node.attrs.props?.value
      if (
        node.element === 'Instance' &&
        node.attrs.component?.value === component.name &&
        props &&
        typeof props === 'object' &&
        !Array.isArray(props) &&
        from in props
      ) {
        const renamed = Object.fromEntries(
          Object.entries(props).map(([key, value]) => [key === from ? name : key, value]),
        )
        batch(page).push({ op: 'set', address: node.address, prop: 'props', value: renamed })
      }
      node.children.forEach(walk)
    }
    walk(pageDoc.tree)
  }
  return { byFile }
}
