import { derivedTarget } from '@uidx/schema'
import {
  addressOf,
  resolve,
  toNodeSpec,
  type JsonValue,
  type UidxDocument,
  type UidxNode,
  type UidxPatch,
} from '@uidx/format'

/**
 * The context menu's layer verbs that need judgement, built pure: what a
 * duplicate is called and where it goes, and where an instance's main
 * component lives.
 */

function parentOf(root: UidxNode, address: string): UidxNode | null {
  for (const child of root.children) {
    if (child.address === address) return root
    const found = parentOf(child, address)
    if (found) return found
  }
  return null
}

/**
 * A copy of the layer, placed just after it under a fresh name. A component
 * is a name the whole document shares (ADR 0004 §2), so its copy is checked
 * against `taken`; any other layer only against its siblings. A layer placed
 * by coordinates is nudged so the copy is visible rather than stacked.
 */
export function duplicateLayer(
  doc: UidxDocument,
  address: string,
  taken: ReadonlySet<string>,
  /** Where the original is drawn, for a page-level layer the canvas places itself. */
  drawn?: { minX: number; minY: number; maxX: number; maxY: number } | null,
): { patches: UidxPatch[]; address: string } | null {
  if (address === '') return null
  const parent = parentOf(doc.tree, address)
  const node = parent?.children.find((child) => child.address === address)
  if (!parent || !node) return null
  const component = node.element === 'Component'
  // An identity file's contract is its one component's (ADR 0012): a second
  // component beside it would have no props, styles or behaviour.
  if (component && doc.spec?.contract) return null
  const siblings = new Set(parent.children.map((child) => child.name))
  const free = (name: string) => !siblings.has(name) && !(component && taken.has(name))
  const stem = component ? `${node.name}Copy` : `${node.name}-copy`
  let name = stem
  for (let n = 2; !free(name); n++) name = component ? `${stem}${n}` : `${stem}-${n}`
  const spec = toNodeSpec(node)
  const attrs: Record<string, JsonValue> = { ...spec.attrs, name }
  const auto =
    typeof parent.attrs.layoutMode?.value === 'string' && parent.attrs.layoutMode.value !== 'NONE'
  if (!auto) {
    if (typeof attrs.x === 'number') attrs.x += 16
    if (typeof attrs.y === 'number') attrs.y += 16
    // A page-level layer with no position of its own would be drawn on top
    // of the original; the copy goes beside it instead.
    if (attrs.x === undefined && attrs.y === undefined && parent === doc.tree && drawn) {
      attrs.x = Math.round(drawn.maxX + 40)
      attrs.y = Math.round(drawn.minY)
    }
  }
  return {
    patches: [
      {
        op: 'insert-node',
        parent: parent.address,
        index: parent.children.indexOf(node) + 1,
        node: { ...spec, attrs },
      },
    ],
    address: addressOf(parent.address, name),
  }
}

/** The page and address of the component an instance uses, or null. */
export function mainComponentOf(
  pages: ReadonlyMap<string, UidxDocument>,
  instance: UidxNode | null,
): { file: string; address: string } | null {
  const name = instance?.element === 'Instance' ? instance.attrs.component?.value : undefined
  if (typeof name !== 'string') return null
  for (const [file, doc] of pages) {
    if (doc.tree.element === 'Tokens') continue
    const found = doc.tree.children.find(
      (child) => child.element === 'Component' && child.name === name,
    )
    if (found) return { file, address: found.address }
  }
  return null
}

/**
 * Figma's Shift+Enter: the layer that holds this one, or null at the top. A
 * layer of a state's variant (ADR 0016 §4) is not in the file, so its parent
 * is read off its address — `Switch#state=focus/root/thumb` sits in
 * `…/root`, which is the variant's root, held by the variant, held by the
 * component.
 */
export function parentSelection(doc: UidxDocument, address: string): string | null {
  if (address === '') return null
  if (!derivedTarget(doc, address)) {
    const parent = parentOf(doc.tree, address)
    return parent && parent.address !== '' ? parent.address : null
  }
  const cut = address.indexOf('#')
  const slash = address.lastIndexOf('/')
  if (slash > cut) return address.slice(0, slash)
  return address.slice(0, cut)
}

/**
 * Figma's Enter: the layers this one holds, or null when it holds none. On a
 * state's variant the children are the base layer's, addressed under it.
 */
export function childSelection(doc: UidxDocument, address: string): string[] | null {
  const derived = derivedTarget(doc, address)
  if (!derived) {
    const node = resolve(doc.tree, address)
    return node?.children.length ? node.children.map((child) => child.address) : null
  }
  if (!derived.base.children.length) return null
  const at = address.includes('/') ? address : `${address}/root`
  return derived.base.children.map((child) => `${at}/${child.name}`)
}
