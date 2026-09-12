import {
  aliasTarget,
  isAlias,
  type JsonValue,
  type UidxDocument,
  type UidxNode,
} from '@uidx/format'

/**
 * Who depends on a symbol — the reverse of the token index, and the ground
 * truth under every blast-radius label and refactor (spec §8).
 *
 * A symbol is a token (`collection#variable`) or a component (its global
 * name). A dependent is wherever a reference to it lives: another variable's
 * value, one mode of a moded variable, a scene attribute (aliases hide inside
 * structured values like `fills`, so the walk recurses), an `<Instance>`'s
 * `component`, or an instance-swap prop value that names a component.
 */
export interface Dependent {
  file: string
  /**
   * Address of the node carrying the reference — except kind 'mode', where a
   * `<Mode>` has no address of its own (see the parser's Mode note) and this
   * is its *variable's* address, with `mode` naming the child.
   */
  address: string
  /** The attribute holding the reference. */
  prop: string
  kind: 'variable' | 'mode' | 'scene' | 'instance' | 'instance-swap'
  /** Only for kind 'mode'. */
  mode?: string
}

export interface DependentsIndex {
  ofToken: ReadonlyMap<string, readonly Dependent[]>
  ofComponent: ReadonlyMap<string, readonly Dependent[]>
}

export function buildDependentsIndex(pages: ReadonlyMap<string, UidxDocument>): DependentsIndex {
  const ofToken = new Map<string, Dependent[]>()
  const ofComponent = new Map<string, Dependent[]>()
  const push = (map: Map<string, Dependent[]>, key: string, dep: Dependent) => {
    const list = map.get(key)
    if (list) list.push(dep)
    else map.set(key, [dep])
  }

  // Component names first: an instance-swap prop is only a reference when the
  // string it holds names a component this document actually declares.
  const componentNames = new Set<string>()
  for (const doc of pages.values()) {
    visit(doc.tree, (node) => {
      if (node.element === 'Component') componentNames.add(node.name)
    })
  }

  for (const [file, doc] of pages) {
    visit(doc.tree, (node) => {
      if (node.element === 'Mode') return // handled from the variable below

      for (const [prop, attr] of Object.entries(node.attrs)) {
        if (node.element === 'Instance' && prop === 'component') {
          if (typeof attr.value === 'string' && componentNames.has(attr.value)) {
            push(ofComponent, attr.value, {
              file,
              address: node.address,
              prop,
              kind: 'instance',
            })
          }
          continue
        }
        visitStrings(attr.value, (text) => {
          const target = aliasTargetOf(text)
          if (target !== null) {
            push(ofToken, target, {
              file,
              address: node.address,
              prop,
              kind: node.element === 'Variable' ? 'variable' : 'scene',
            })
            return
          }
          if (prop === 'props' && node.element === 'Instance' && componentNames.has(text)) {
            push(ofComponent, text, {
              file,
              address: node.address,
              prop,
              kind: 'instance-swap',
            })
          }
        })
      }

      if (node.element === 'Variable') {
        for (const mode of node.children) {
          if (mode.element !== 'Mode') continue
          const value = mode.attrs.value?.value
          const target = value === undefined ? null : aliasTargetOf(value)
          if (target !== null) {
            push(ofToken, target, {
              file,
              address: node.address,
              prop: 'value',
              kind: 'mode',
              mode: mode.name,
            })
          }
        }
      }
    })
  }

  return { ofToken, ofComponent }
}

function visit(node: UidxNode, fn: (node: UidxNode) => void): void {
  fn(node)
  for (const child of node.children) visit(child, fn)
}

/** Every string inside a JsonValue, however deeply structured. */
function visitStrings(value: JsonValue, fn: (text: string) => void): void {
  if (typeof value === 'string') fn(value)
  else if (Array.isArray(value)) for (const item of value) visitStrings(item, fn)
  else if (value !== null && typeof value === 'object')
    for (const item of Object.values(value)) visitStrings(item, fn)
}

function aliasTargetOf(value: JsonValue): string | null {
  return isAlias(value) ? aliasTarget(value) : null
}
