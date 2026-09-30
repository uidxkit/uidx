import { shallowRef } from 'vue'

/**
 * The headless library, as the Contract tab reads it (ADR 0013 §3).
 *
 * A `custom-elements.json` is the library's own description of itself, and
 * the tab wants three things from it: which tags exist, which of them are
 * *roots* an author may implement, and which parts and slots each root has.
 * The rest — attributes, events — is shown for orientation and never written.
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

export interface HeadlessElement {
  tag: string
  /** The parts this root offers, from `<tag>-<part>` elements and `cssParts`. */
  parts: HeadlessPart[]
  /** Slot names; `''` is the default slot. */
  slots: string[]
  attributes: string[]
  events: string[]
  description?: string
}

export interface HeadlessLibrary {
  /** Where `uidx.json` said the library is, for the panel to name. */
  path: string
  /** Every declared element, by tag, parts included. */
  elements: Map<string, HeadlessElement>
  /** The tags an author may implement: elements that are not a part of another. */
  roots: HeadlessElement[]
}

/** The slice of a `custom-elements.json` this module reads. */
interface Manifest {
  modules?: {
    declarations?: {
      tagName?: string | null
      description?: string
      attributes?: { name?: string }[]
      events?: { name?: string }[]
      slots?: { name?: string }[]
      cssParts?: { name?: string }[]
    }[]
  }[]
}

const names = (entries: { name?: string }[] | undefined): string[] =>
  (entries ?? []).map((entry) => entry.name ?? '').filter((name, i, all) => all.indexOf(name) === i)

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
export function parseHeadless(path: string, manifest: unknown): HeadlessLibrary {
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
  return { path, elements: declared, roots }
}

/** `null` until loaded, and when the document declares no library. */
export const headlessLibrary = shallowRef<HeadlessLibrary | null>(null)
/** Why the library could not be read, or `''`. Shown in the tab, never thrown. */
export const headlessError = shallowRef('')

/**
 * Fetches the document's library from the server (`/__uidx/headless`).
 *
 * Called on every `document:opened`, which is also every reconnect, so a
 * library re-synced while the viewer was open shows up on the next reload of
 * the page without a restart.
 */
export async function refreshHeadless(): Promise<void> {
  headlessError.value = ''
  try {
    const response = await fetch('/__uidx/headless', { signal: AbortSignal.timeout(15_000) })
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('The headless library service is unavailable.')
    }
    const data = (await response.json()) as {
      path: string | null
      library?: unknown
      error?: string
    }
    if (!response.ok) throw new Error(data.error ?? 'Could not read the headless library.')
    headlessLibrary.value = data.path === null ? null : parseHeadless(data.path, data.library)
  } catch (error) {
    headlessLibrary.value = null
    headlessError.value = error instanceof Error ? error.message : String(error)
  }
}
