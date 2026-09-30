/**
 * A headless library's `custom-elements.json`, read into the shape the
 * Contract tab, `uidx adopt` and the code target share (ADR 0013 §3): which
 * tags exist, which are roots an author may implement, and which parts,
 * slots, attributes and events each root has. Pure.
 */
/**
 * A part as the library exposes it: an element of its own (`<root>-<part>`,
 * which can hold the design's content) or a shadow part (`cssParts`, styled
 * through `::part()` and drawn by the library).
 */
export interface HeadlessPart {
  name: string
  kind: 'element' | 'shadow'
}

/** What the manifest says about one attribute, event or slot: enough to scaffold a contract from. */
export interface HeadlessMember {
  name: string
  /** The manifest's type text, e.g. `boolean` or `"a" | "b"`; attributes only. */
  type?: string
  description?: string
}

export interface HeadlessElement {
  tag: string
  /** The parts this root offers, from `<tag>-<part>` elements and `cssParts`. */
  parts: HeadlessPart[]
  /** Slot names; `''` is the default slot. */
  slots: string[]
  attributes: string[]
  events: string[]
  /** The same attributes, events and slots with what the manifest says about them. */
  members: { attributes: HeadlessMember[]; events: HeadlessMember[]; slots: HeadlessMember[] }
  description?: string
}

export interface HeadlessLibrary {
  /** Where `uidx.json` said the library is, for the panel to name. */
  path: string
  /** Every declared element, by tag, parts included. */
  elements: Map<string, HeadlessElement>
  /** The tags an author may implement: elements that are not a part of another. */
  roots: HeadlessElement[]
  /** `uidx.json`'s `headless.bindings`: the library's names per component, when configured. */
  bindings: Record<string, { tag?: string; parts?: Record<string, string> }>
}

/** A library a dependency ships, offered when the document names none. */
export interface HeadlessCandidate {
  package: string
  path: string
}

/** The slice of a `custom-elements.json` this module reads. */
interface Manifest {
  modules?: {
    declarations?: {
      tagName?: string | null
      description?: string
      attributes?: { name?: string; type?: { text?: string }; description?: string }[]
      events?: { name?: string; description?: string }[]
      slots?: { name?: string; description?: string }[]
      cssParts?: { name?: string }[]
    }[]
  }[]
}

const names = (entries: { name?: string }[] | undefined): string[] =>
  (entries ?? []).map((entry) => entry.name ?? '').filter((name, i, all) => all.indexOf(name) === i)

const members = (
  entries: { name?: string; type?: { text?: string }; description?: string }[] | undefined,
): HeadlessMember[] =>
  (entries ?? [])
    .filter((entry, i, all) => all.findIndex((other) => other.name === entry.name) === i)
    .map((entry) => ({
      name: entry.name ?? '',
      ...(entry.type?.text ? { type: entry.type.text } : {}),
      ...(entry.description ? { description: entry.description.split('\n')[0]!.trim() } : {}),
    }))

/**
 * The library's shape, from the manifest as written.
 *
 * Parts follow the convention the code target relies on (ADR 0017 §3): a
 * part is an element named `<root>-<part>`, so `hwc-checkbox-checked-indicator`
 * is the `checked-indicator` part of `hwc-checkbox`. A manifest that also lists
 * `cssParts` on the root contributes those the same way. The longest matching
 * root wins, so `hwc-text-input-leading-icon` belongs to `hwc-text-input`, not
 * to a shorter `hwc-text` if one existed.
 */
export function parseHeadless(
  path: string,
  manifest: unknown,
  bindings: HeadlessLibrary['bindings'] = {},
): HeadlessLibrary {
  const declared = new Map<string, HeadlessElement>()
  for (const module of (manifest as Manifest)?.modules ?? []) {
    for (const declaration of module.declarations ?? []) {
      const tag = declaration.tagName
      if (typeof tag !== 'string' || tag === '' || declared.has(tag)) continue
      declared.set(tag, {
        tag,
        parts: names(declaration.cssParts).map((name) => ({ name, kind: 'shadow' as const })),
        slots: names(declaration.slots),
        attributes: names(declaration.attributes),
        events: names(declaration.events),
        members: {
          attributes: members(declaration.attributes),
          events: members(declaration.events),
          slots: members(declaration.slots),
        },
        ...(declaration.description ? { description: declaration.description } : {}),
      })
    }
  }

  const tags = [...declared.keys()].sort((a, b) => b.length - a.length)
  // A part is a leaf: nothing hangs off it, and it takes no attributes and
  // fires no events of its own. That is what tells `hwc-text-input` (a root
  // with `hwc-text-input-leading-icon` below it) from `hwc-text-input-leading-icon`
  // when `hwc-text` is also a root — the prefix alone cannot.
  const isLeaf = (element: HeadlessElement): boolean =>
    element.attributes.length === 0 &&
    element.events.length === 0 &&
    !tags.some((other) => other.startsWith(`${element.tag}-`))
  const partOf = new Map<string, string>()
  for (const [tag, element] of declared) {
    if (!isLeaf(element)) continue
    const root = tags.find((other) => other !== tag && tag.startsWith(`${other}-`))
    if (root !== undefined) partOf.set(tag, root)
  }
  for (const [tag, root] of partOf) {
    const owner = declared.get(root)!
    const part = tag.slice(root.length + 1)
    const known = owner.parts.find((entry) => entry.name === part)
    // An element wins over a cssPart of the same name: it can hold content.
    if (known) known.kind = 'element'
    else owner.parts.push({ name: part, kind: 'element' })
  }

  const roots = [...declared.values()]
    .filter((element) => !partOf.has(element.tag))
    .sort((a, b) => a.tag.localeCompare(b.tag))
  return { path, elements: declared, roots, bindings }
}

/**
 * The contract's type for a manifest attribute type: `boolean` stays,
 * a union of quoted strings becomes an enum in the contract's spelling, and
 * anything else — `string`, `number`, or nothing — is text.
 */
export function contractType(manifestType: string | undefined): string {
  if (!manifestType) return 'string'
  const text = manifestType.trim()
  if (text === 'boolean') return 'boolean'
  if (text === 'number') return 'number'
  const parts = text.split('|').map((part) => part.trim())
  if (parts.length > 1 && parts.every((part) => /^(['"]).*\1$/.test(part)))
    return parts.map((part) => `'${part.slice(1, -1)}'`).join(' | ')
  return 'string'
}
