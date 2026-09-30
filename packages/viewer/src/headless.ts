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

/** `null` until loaded, and when the document declares no library. */
export const headlessLibrary = shallowRef<HeadlessLibrary | null>(null)
/** Why the library could not be read, or `''`. Shown in the tab, never thrown. */
export const headlessError = shallowRef('')
/** Libraries the project's dependencies ship, while the document names none. */
export const headlessCandidates = shallowRef<HeadlessCandidate[]>([])

function unavailable(response: Response): void {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('The headless library service is unavailable.')
  }
}

interface HeadlessPayload {
  path: string | null
  library?: unknown
  bindings?: HeadlessLibrary['bindings']
  candidates?: HeadlessCandidate[]
  error?: string
}

function adopt(data: HeadlessPayload): void {
  headlessLibrary.value =
    data.path === null ? null : parseHeadless(data.path, data.library, data.bindings ?? {})
  headlessCandidates.value = data.candidates ?? []
}

/**
 * Names the library the document uses: written into `uidx.json` by the
 * server, so the choice is committed with the project and every tool reads
 * the same file. `path` is one of the candidates, or any path relative to
 * `uidx.json`.
 */
export async function chooseHeadless(path: string): Promise<void> {
  headlessError.value = ''
  try {
    const response = await fetch('/__uidx/headless', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
      signal: AbortSignal.timeout(15_000),
    })
    unavailable(response)
    const data = (await response.json()) as HeadlessPayload
    if (!response.ok) throw new Error(data.error ?? 'Could not choose the headless library.')
    adopt(data)
  } catch (error) {
    headlessError.value = error instanceof Error ? error.message : String(error)
  }
}

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
    unavailable(response)
    const data = (await response.json()) as HeadlessPayload
    if (!response.ok) throw new Error(data.error ?? 'Could not read the headless library.')
    adopt(data)
  } catch (error) {
    headlessLibrary.value = null
    headlessCandidates.value = []
    headlessError.value = error instanceof Error ? error.message : String(error)
  }
}
