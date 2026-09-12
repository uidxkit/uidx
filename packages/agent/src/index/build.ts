import { aliasTarget, type JsonValue, type UidxDocument, type UidxNode } from '@uidx/format'

import type {
  ComponentEntry,
  DocumentIndex,
  InstanceEntry,
  PageEntry,
  VariableEntry,
} from './types.js'

const HEADING = /^##\s+(.+)$/gm

function walk(node: UidxNode, visit: (node: UidxNode) => void): void {
  visit(node)
  for (const child of node.children) walk(child, visit)
}

function propsOf(node: UidxNode): ComponentEntry['props'] {
  const declared = node.attrs.props?.value
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) return []
  return Object.entries(declared).map(([name, declaration]) => {
    if (typeof declaration !== 'object' || declaration === null || Array.isArray(declaration)) {
      return { name, type: 'TEXT', default: undefined }
    }
    const shape = declaration as { type?: JsonValue; default?: JsonValue }
    return {
      name,
      type: typeof shape.type === 'string' ? shape.type : 'TEXT',
      default: shape.default,
    }
  })
}

/**
 * The index is names and shapes only — never bodies. It is what lets a small
 * model see the whole document at once and still have room to think.
 */
export function buildIndex(
  manifestId: string,
  docs: ReadonlyMap<string, UidxDocument>,
): DocumentIndex {
  const pages = new Map<string, PageEntry>()
  const components = new Map<string, ComponentEntry>()
  const variables = new Map<string, VariableEntry>()
  const instances: InstanceEntry[] = []
  const aliasUses: { address: string; file: string; prop: string; target: string }[] = []

  for (const [file, doc] of docs) {
    let nodeCount = 0
    walk(doc.tree, () => {
      nodeCount += 1
    })

    pages.set(file, {
      file,
      id: typeof doc.frontmatter.id === 'string' ? doc.frontmatter.id : file,
      kind: doc.tree.element === 'Tokens' ? 'tokens' : 'page',
      headings: [...doc.intent.raw.matchAll(HEADING)].map((m) => m[1]!.trim()),
      topLevel: doc.tree.children.map((child) => ({
        name: child.name,
        element: child.element,
        address: child.address,
      })),
      nodeCount,
    })

    walk(doc.tree, (node) => {
      for (const [prop, attr] of Object.entries(node.attrs)) {
        const target = aliasTarget(attr.value)
        if (target) aliasUses.push({ address: node.address, file, prop, target })
      }

      if (node.element === 'Component') {
        const slots: string[] = []
        const variants: string[] = []
        walk(node, (inner) => {
          if (inner === node) return
          if (inner.element === 'Slot') slots.push(inner.name)
          if (inner.element === 'Variant') variants.push(inner.name)
        })
        components.set(node.name, {
          name: node.name,
          file,
          address: node.address,
          status: typeof node.attrs.status?.value === 'string' ? node.attrs.status.value : null,
          props: propsOf(node),
          slots,
          variants,
        })
      }

      if (node.element === 'Instance') {
        const component = node.attrs.component?.value
        if (typeof component === 'string') {
          instances.push({ address: node.address, file, component })
        }
      }

      if (node.element === 'Variable') {
        variables.set(node.address, {
          address: node.address,
          file,
          collection: node.address.split('#')[0] ?? '',
          name: node.name,
          type: typeof node.attrs.type?.value === 'string' ? node.attrs.type.value : 'STRING',
        })
      }
    })
  }

  return {
    manifestId,
    pages,
    components,
    instances,
    variables,
    usesOfComponent: (name) => instances.filter((i) => i.component === name),
    usesOfVariable: (address) =>
      aliasUses
        .filter((use) => use.target === address)
        .map(({ address: at, file, prop }) => ({ address: at, file, prop })),
  }
}
