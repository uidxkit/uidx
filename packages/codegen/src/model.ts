import {
  aliasTarget,
  type ContractSpec,
  type DocumentSpec,
  type JsonValue,
  type PropSpec,
  type SlotSpec,
  type UidxDocument,
  type UidxNode,
} from '@uidx/format'
import {
  axesOf,
  modelByRef,
  modelIndex,
  modelOfType,
  specBindings,
  type ModelIndex,
} from '@uidx/schema/design-system'

/**
 * What every code target reads: a component's identity, contract and tree,
 * with the questions the emitters ask answered once — which node is which
 * part, which text is a prop, which slot repeats, which tag a part becomes.
 */

/** The slice of a `custom-elements.json` this package reads. */
export interface Manifest {
  modules: {
    path?: string
    declarations?: {
      name?: string
      tagName?: string | null
      attributes?: { name: string; type?: { text?: string } }[]
      events?: { name: string }[]
      slots?: { name: string }[]
      /** Shadow parts, styled from outside through `::part()`. */
      cssParts?: { name: string }[]
    }[]
  }[]
}

export type ManifestDeclaration = NonNullable<Manifest['modules'][number]['declarations']>[number]

/** Every custom element the manifest declares, by tag. */
export function manifestTags(manifest: Manifest | undefined): Map<string, ManifestDeclaration> {
  const out = new Map<string, ManifestDeclaration>()
  for (const module of manifest?.modules ?? []) {
    for (const declaration of module.declarations ?? []) {
      if (declaration.tagName) out.set(declaration.tagName, declaration)
    }
  }
  return out
}

/** `ContactItem` → `contact-item`; `Button/Primary` → `button-primary`. */
export function kebab(name: string): string {
  return name
    .replace(/[/\s]+/g, '-')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
}

/** `contact-item` or `Button/Primary` → `ContactItem`, `ButtonPrimary`. */
export function pascal(name: string): string {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('')
}

/**
 * The element a part is: `<root>-<part>` by convention, or the manifest's
 * tag that ends with the part name and shares the longest prefix with the
 * root — `hwc-breadcrumbs` owns `hwc-breadcrumb-item`.
 */
export type PartKind = 'element' | 'shadow'

/**
 * Which kind of part the library offers under this name (ADR 0017 §3).
 *
 * An element wins when one exists, since it can hold the design's content; a
 * `cssParts` entry on the root makes it a shadow part. Without a manifest, or
 * for a name the manifest lacks, `element` is assumed and conformance says so.
 */
export function partKind(rootTag: string, part: string, manifest?: Manifest): PartKind {
  if (!manifest) return 'element'
  const tags = manifestTags(manifest)
  const tagSet = new Set(tags.keys())
  if (tagSet.has(partTag(rootTag, part, tagSet))) return 'element'
  return (tags.get(rootTag)?.cssParts ?? []).some((entry) => entry.name === part)
    ? 'shadow'
    : 'element'
}

export function partTag(rootTag: string, part: string, tags?: ReadonlySet<string>): string {
  const conventional = `${rootTag}-${part}`
  if (!tags || tags.has(conventional)) return conventional
  let best: string | undefined
  let bestShared = -1
  for (const tag of tags) {
    if (!tag.endsWith(`-${part}`)) continue
    let shared = 0
    while (shared < tag.length && shared < rootTag.length && tag[shared] === rootTag[shared])
      shared++
    if (shared > bestShared) {
      bestShared = shared
      best = tag
    }
  }
  return best ?? conventional
}

export interface PartInfo {
  name: string
  node: UidxNode
  tag: string
  /**
   * How the library exposes the part: an element of its own (`<root>-<part>`),
   * or a shadow part styled through `::part()` and drawn by the library.
   */
  kind: PartKind
}

export interface SlotInfo {
  name: string
  node: UidxNode
  spec: SlotSpec | undefined
}

export interface RepeatInfo {
  node: UidxNode
  slot: SlotSpec | undefined
  /** The instance the repeat multiplies, and the component it names. */
  instance: UidxNode | undefined
  itemComponent: string | undefined
}

export interface ComponentModel {
  /** The `<Component>` name as written. */
  name: string
  /** A TypeScript identifier for the component. */
  identifier: string
  /** A file stem for its outputs. */
  stem: string
  /** The headless root it implements, or undefined for a purely visual component. */
  tag: string | undefined
  node: UidxNode
  spec: DocumentSpec | undefined
  contract: ContractSpec | undefined
  parts: PartInfo[]
  slots: SlotInfo[]
  repeats: RepeatInfo[]
  axes: Map<string, string[]>
  /** The node bound to a part, by part name. */
  partOf: Map<UidxNode, string>
  /** Sample values at index 0: what `{item.name}` and `{label}` resolve to. */
  samples: Map<string, JsonValue>
  /** The document the component comes from, for token and asset context. */
  doc: UidxDocument
  /**
   * A composition: no headless root of its own and exactly one child, an
   * instance of another component. It renders as that instance, with its
   * props passed through — a pattern, not a new element (ADR 0012 §3).
   */
  composes: UidxNode | undefined
  /** The models a prop's type may name, across the document (ADR 0015 §1). */
  models: ModelIndex
}

/** The prop a bare `{name}` alias names, if the contract declares it. */
export function boundProp(model: ComponentModel, value: JsonValue): PropSpec | undefined {
  if (typeof value !== 'string') return undefined
  const target = aliasTarget(value)
  if (target === null || target.includes('#') || target.includes('.')) return undefined
  return model.contract?.props.find((prop) => prop.name === target)
}

/** `{item.name}` → `['item', 'name']` when `item` is a model prop; else null. */
export function boundPath(model: ComponentModel, value: JsonValue): string[] | null {
  if (typeof value !== 'string') return null
  const target = aliasTarget(value)
  if (target === null || target.includes('#') || !target.includes('.')) return null
  const path = target.split('.')
  const prop = model.contract?.props.find(
    (entry) =>
      entry.name === path[0] && modelOfType(entry.type, model.spec, model.models)?.list === false,
  )
  return prop ? path : null
}

/** The declared model a name refers to, on this page or any other. */
export function modelOf(model: ComponentModel, ref: string | undefined) {
  return modelByRef(model.spec, ref, model.models)
}

export function componentModel(
  component: UidxNode,
  doc: UidxDocument,
  manifest?: Manifest,
  /** Every model the document set declares; this page's alone when absent. */
  models?: ModelIndex,
): ComponentModel {
  const tags = manifest ? new Set(manifestTags(manifest).keys()) : undefined
  const spec = component.spec ?? doc.spec
  const contract = spec?.contract
  const tag =
    typeof component.attrs.implements?.value === 'string'
      ? component.attrs.implements.value
      : undefined
  const parts: PartInfo[] = []
  const slots: SlotInfo[] = []
  const repeats: RepeatInfo[] = []
  const partOf = new Map<UidxNode, string>()
  const walk = (node: UidxNode): void => {
    const part = node.attrs.part?.value
    if (typeof part === 'string') {
      parts.push({
        name: part,
        node,
        tag: tag ? partTag(tag, part, tags) : `x-${part}`,
        kind: tag ? partKind(tag, part, manifest) : 'element',
      })
      partOf.set(node, part)
    }
    if (node.element === 'Slot') {
      slots.push({
        name: node.name,
        node,
        spec: contract?.slots.find((slot) => slot.name === node.name),
      })
    }
    // An instance's children are the fills it puts in *another* component's
    // slots (ADR 0007 §2), not this component's parts or slots.
    if (node.element === 'Instance') return
    if (node.element === 'Repeat') {
      const slotName = node.attrs.slot?.value
      const instance = node.children[0]
      const itemComponent = instance?.attrs.component?.value
      repeats.push({
        node,
        slot: contract?.slots.find((slot) => slot.name === slotName),
        instance: instance?.element === 'Instance' ? instance : undefined,
        itemComponent: typeof itemComponent === 'string' ? itemComponent : undefined,
      })
      return
    }
    for (const child of node.children) walk(child)
  }
  for (const child of component.children) walk(child)
  return {
    name: component.name,
    identifier: pascal(component.name),
    stem: kebab(component.name),
    tag,
    node: component,
    spec,
    contract,
    models: models ?? modelIndex([doc]),
    parts,
    slots,
    repeats,
    axes: axesOf(spec),
    partOf,
    samples: specBindings(spec, 0),
    doc,
    composes:
      tag === undefined &&
      component.children.length === 1 &&
      component.children[0]!.element === 'Instance'
        ? component.children[0]
        : undefined,
  }
}

/** The models used by a component, with the ones they reference, by name. */
export function modelsOf(model: ComponentModel) {
  return model.spec?.models ?? []
}
