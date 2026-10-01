import {
  aliasTarget,
  isAlias,
  METADATA_ATTRS,
  STATE_AXIS,
  toNodeSpec,
  type JsonValue,
  type UidxDocument,
  type UidxNode,
  type UidxNodeSpec,
  type UidxPatch,
} from '@uidx/format'
import { deriveVariants, derivesVariants } from '@uidx/schema'

import { parentOf } from './layer-moves'

/** Attributes that make an instance an instance, and go when it becomes plain layers. */
const INSTANCE_ONLY = new Set(['component', 'props', 'overrides'])
/** Attributes that only mean something on a component's own tree. */
const COMPONENT_ONLY = new Set(['implements', 'variants', 'props', 'part', ...METADATA_ATTRS])

/**
 * Detach an instance (Figma's "Detach instance"): the layers it draws, written
 * into the page as an ordinary frame the component no longer controls. The
 * variant its props select is the one copied, its `{prop}` bindings are
 * replaced by the values it showed, its overrides are applied and its slots
 * are filled with what the instance put in them.
 */
export function detachInstance(
  pages: ReadonlyMap<string, UidxDocument>,
  doc: UidxDocument,
  address: string,
): { patches: UidxPatch[]; address: string } | null {
  const instance = findNode(doc.tree, address)
  if (!instance || instance.element !== 'Instance' || instance.synthetic) return null
  const name = instance.attrs.component?.value
  const definition = componentNamed(pages, typeof name === 'string' ? name : '')
  const parent = parentOf(doc, address)
  if (!definition || !parent) return null

  const values = propValues(definition, instance)
  const root = drawnRoot(definition, values)
  const overrides = overrideMap(instance)
  const fills = new Map(
    instance.children
      .filter((child) => child.element === 'Slot')
      .map((child) => [child.name, child.children] as const),
  )

  const rewrite = (node: UidxNode, path: string): UidxNodeSpec => {
    const own: Record<string, JsonValue> = {}
    for (const [key, attr] of Object.entries(node.attrs)) {
      if (COMPONENT_ONLY.has(key) || key === 'repeat' || key === 'as') continue
      own[key] = substitute(attr.value, values)
    }
    Object.assign(own, overrides.get(path) ?? {})
    if (node.element === 'Slot') {
      const filled = fills.get(node.name)
      return {
        element: 'Frame',
        attrs: own,
        children: (filled ?? node.children).map((child) =>
          filled ? toNodeSpec(child) : rewrite(child, join(path, child.name)),
        ),
      }
    }
    const children = node.children.map((child) => rewrite(child, join(path, child.name)))
    return {
      element: node.element === 'Component' || node.element === 'Variant' ? 'Frame' : node.element,
      attrs: own,
      ...(children.length ? { children } : {}),
    }
  }

  const spec = rewrite(root, '')
  // The instance's own placement and sizing win over the definition's.
  for (const [key, attr] of Object.entries(instance.attrs))
    if (!INSTANCE_ONLY.has(key)) spec.attrs[key] = attr.value
  spec.attrs.name = instance.name
  return {
    patches: [
      { op: 'remove-node', address },
      {
        op: 'insert-node',
        parent: parent.address,
        index: parent.children.indexOf(instance),
        node: { ...spec, element: 'Frame' },
      },
    ],
    address,
  }
}

function join(path: string, name: string): string {
  return path ? `${path}/${name}` : name
}

function findNode(root: UidxNode, address: string): UidxNode | null {
  if (root.address === address) return root
  for (const child of root.children) {
    const found = findNode(child, address)
    if (found) return found
  }
  return null
}

function componentNamed(pages: ReadonlyMap<string, UidxDocument>, name: string): UidxNode | null {
  for (const doc of pages.values()) {
    if (doc.tree.element === 'Tokens') continue
    const found = doc.tree.children.find(
      (child) => child.element === 'Component' && child.name === name,
    )
    if (found) return found
  }
  return null
}

/** What each prop shows on this instance: its value, else the default, else the sample. */
function propValues(definition: UidxNode, instance: UidxNode): Map<string, JsonValue> {
  const out = new Map<string, JsonValue>()
  for (const prop of definition.spec?.contract?.props ?? []) {
    const shown = prop.default ?? prop.sample
    if (shown !== undefined) out.set(prop.name, shown)
  }
  const legacy = definition.attrs.props?.value
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy))
    for (const [key, entry] of Object.entries(legacy))
      if (entry && typeof entry === 'object' && !Array.isArray(entry) && 'default' in entry)
        out.set(key, entry.default as JsonValue)
  const assigned = instance.attrs.props?.value
  if (assigned && typeof assigned === 'object' && !Array.isArray(assigned))
    for (const [key, value] of Object.entries(assigned)) out.set(key, value)
  return out
}

/** The tree the instance draws: the derived variant its values select, or the component. */
function drawnRoot(definition: UidxNode, values: ReadonlyMap<string, JsonValue>): UidxNode {
  if (!derivesVariants(definition)) return definition
  const set = deriveVariants(definition)
  const visualOn = (definition.spec?.contract?.props ?? []).find(
    (prop) => prop.visual && prop.type === 'boolean' && values.get(prop.name) === true,
  )
  const wanted = (axis: string): string | undefined => {
    if (axis === STATE_AXIS) return visualOn?.name ?? 'default'
    const value = values.get(axis)
    return typeof value === 'string' ? value : undefined
  }
  const variant =
    set.children.find((candidate) =>
      Object.entries(candidate.attrs).every(([axis, attr]) => {
        const want = wanted(axis)
        return want === undefined || attr.value === want
      }),
    ) ?? set.children[0]
  return variant?.children[0] ?? definition
}

function overrideMap(node: UidxNode): Map<string, Record<string, JsonValue>> {
  const declared = node.attrs.overrides?.value
  const out = new Map<string, Record<string, JsonValue>>()
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) return out
  for (const [key, value] of Object.entries(declared))
    if (value && typeof value === 'object' && !Array.isArray(value))
      out.set(key, value as Record<string, JsonValue>)
  return out
}

/** A `{prop}` binding replaced by the value the instance showed; tokens stay bound. */
function substitute(value: JsonValue, values: ReadonlyMap<string, JsonValue>): JsonValue {
  if (typeof value === 'string') {
    const target = isAlias(value) ? aliasTarget(value) : null
    if (target) return !target.includes('#') && values.has(target) ? values.get(target)! : value
    return value.replace(/\{([A-Za-z][\w.]*)\}/g, (whole: string, name: string) => {
      const found = values.get(name)
      return found === undefined || typeof found === 'object' ? whole : String(found)
    })
  }
  if (Array.isArray(value)) return value.map((item) => substitute(item, values))
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substitute(item, values)]),
    )
  return value
}
