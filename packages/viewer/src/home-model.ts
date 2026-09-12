import { assetRefs, type Diagnostic, type UidxDocument, type UidxNode } from '@uidx/format'
import type { TokenIndex } from '@uidx/schema'

import type { PageEntry } from './page-list'

/**
 * What the dashboard says about the document, as data.
 *
 * Every number here is counted from documents the shell already holds — the
 * server sends every page on connect (ADR 0004 §1), and `App` keeps them
 * alongside each page's revision and diagnostics. Nothing in this module
 * fetches, parses or renders, which is what makes the dashboard a *view* of
 * state the app maintains anyway rather than a second source of truth that can
 * disagree with the canvas.
 *
 * The rule the design draft states — "NEVER show a stat that is not derivable
 * from the file" (`design/option-4/home.uidx`) — is enforced by construction
 * here: a counter that cannot be written as a walk over `doc.tree` or a read of
 * the token index has nowhere to live.
 */

/** What a page is, once its document has arrived. */
export type PageKind =
  /** A scene the canvas can draw, and so a tile that can carry a thumbnail. */
  | 'scene'
  /** `<Tokens>` — variable collections, which `toSceneGraph` refuses to draw. */
  | 'tokens'
  /** Announced by the server, not yet received, or received and unparseable. */
  | 'pending'

export interface PageCard {
  file: string
  label: string
  kind: PageKind
  /** Entities the file declares, the root `<Page>` excluded. */
  nodes: number
  /** `<Component>` declarations on this page. */
  components: number
  /** `<Instance>` placements on this page. */
  instances: number
  /** `<Variant>` declarations — states of the components declared here. */
  variants: number
  /**
   * Image references this page paints with.
   *
   * Counted because artwork is the third thing a page draws through that lives
   * outside it — after tokens and components — and a page that references none
   * must not be redrawn when somebody else's artwork moves.
   */
  assets: number
  /** Errors from this page's last parse. Warnings are not counted. */
  errors: number
  /** The page's own revision, or null before its first message. */
  revision: number | null
}

export interface CollectionCard {
  name: string
  modes: readonly string[]
  variables: number
}

export interface DocumentStats {
  /** Every page in the document, drawable or not. */
  pages: number
  /** Those the canvas can draw. */
  scenes: number
  components: number
  /** `<Variant>` declarations, which are states of the components above. */
  variants: number
  instances: number
  /** Variables across every `<Tokens>` page. */
  tokens: number
  collections: CollectionCard[]
  /** Pages whose last parse failed. Not the number of errors. */
  brokenPages: number
}

export interface HomeModel {
  cards: PageCard[]
  stats: DocumentStats
}

/**
 * The elements a page is summarised by.
 *
 * Named rather than counted generically: a stat that quietly changed meaning
 * when the format grew an element would be worse than one that has to be added
 * to deliberately.
 */
type Counted = 'Component' | 'Instance' | 'Variant'

/**
 * One walk, counting everything.
 *
 * Separate walks per element read better and cost a page traversal each; a
 * document of thirty pages re-walked four times on every keystroke that changes
 * a revision is the kind of thing that is invisible until it is not.
 */
function tally(node: UidxNode): Record<Counted, number> & { nodes: number } {
  const out = { Component: 0, Instance: 0, Variant: 0, nodes: 0 }
  const walk = (current: UidxNode, isRoot: boolean): void => {
    // The root `<Page>` is the sheet, not something on it. Counting it would
    // make an empty page report one node.
    if (!isRoot) {
      out.nodes += 1
      if (current.element === 'Component') out.Component += 1
      else if (current.element === 'Instance') out.Instance += 1
      else if (current.element === 'Variant') out.Variant += 1
    }
    for (const child of current.children) walk(child, false)
  }
  walk(node, true)
  return out
}

function errorsIn(diagnostics: readonly Diagnostic[] | undefined): number {
  return diagnostics?.filter((d) => d.severity === 'error').length ?? 0
}

/**
 * A page's tile, from the row the rail already builds plus its document.
 *
 * `PageEntry` is reused rather than re-derived because the two surfaces must
 * agree about what the document contains and what a page is called: a rail
 * listing seven pages beside a dashboard showing six is a bug report, and the
 * only way to be sure that cannot happen is for both to read one list.
 */
function cardFor(
  entry: PageEntry,
  doc: UidxDocument | undefined,
  revision: number | null,
  diagnostics: readonly Diagnostic[] | undefined,
): PageCard {
  const errors = errorsIn(diagnostics)
  if (!doc) {
    return {
      file: entry.file,
      label: entry.label,
      kind: 'pending',
      nodes: 0,
      components: 0,
      instances: 0,
      variants: 0,
      assets: 0,
      errors,
      revision,
    }
  }

  const counts = tally(doc.tree)
  return {
    file: entry.file,
    label: entry.label,
    kind: entry.renderable ? 'scene' : 'tokens',
    nodes: counts.nodes,
    components: counts.Component,
    instances: counts.Instance,
    variants: counts.Variant,
    assets: assetRefs(doc).filter((ref) => ref.src !== '').length,
    errors,
    revision,
  }
}

export interface HomeInput {
  /** The document's pages, in server order — the same list the rail draws. */
  entries: readonly PageEntry[]
  docs: ReadonlyMap<string, UidxDocument>
  revisions: ReadonlyMap<string, number>
  diagnostics: ReadonlyMap<string, Diagnostic[]>
  /** Built from every page, so the token counts are the document's (ADR 0004 §2). */
  tokens: TokenIndex
}

/**
 * The dashboard, derived.
 *
 * Component and variant totals are counted per page and summed rather than read
 * from `componentIndex`, which is keyed by name: two pages declaring the same
 * component name collapse to one entry there, because that is what the canvas
 * needs to resolve an instance. A dashboard reporting "7 components" when the
 * files declare eight would be hiding exactly the duplicate the author needs to
 * see, so this counts declarations.
 */
export function homeModel(input: HomeInput): HomeModel {
  const cards = input.entries.map((entry) =>
    cardFor(
      entry,
      input.docs.get(entry.file),
      input.revisions.get(entry.file) ?? null,
      input.diagnostics.get(entry.file),
    ),
  )

  // Summed from the cards rather than walked again: the tally above is the only
  // traversal of the document this module makes.
  const sum = (of: (card: PageCard) => number): number =>
    cards.reduce((total, card) => total + of(card), 0)

  const perCollection = new Map<string, number>()
  for (const entry of input.tokens.entries.values()) {
    perCollection.set(entry.collection, (perCollection.get(entry.collection) ?? 0) + 1)
  }
  const collections: CollectionCard[] = [...input.tokens.collections.values()].map(
    (collection) => ({
      name: collection.name,
      modes: collection.modes,
      variables: perCollection.get(collection.name) ?? 0,
    }),
  )

  return {
    cards,
    stats: {
      pages: cards.length,
      scenes: cards.filter((card) => card.kind === 'scene').length,
      components: sum((card) => card.components),
      variants: sum((card) => card.variants),
      instances: sum((card) => card.instances),
      tokens: input.tokens.entries.size,
      collections,
      brokenPages: cards.filter((card) => card.errors > 0).length,
    },
  }
}
