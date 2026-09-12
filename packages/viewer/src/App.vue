<script setup lang="ts">
import { rootFontSizeOf, type UidxNode } from '@uidx/format'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  provide,
  ref,
  shallowRef,
  triggerRef,
  watch,
} from 'vue'
import {
  buildDependentsIndex,
  buildTokenIndex,
  defaultTuple,
  deleteCollection,
  deleteToken,
  renameToken,
  TokenResolver,
  tupleAt,
  type Dependent,
} from '@uidx/schema'
import {
  applyPatchesIncremental,
  diffToPatches,
  inversePatches,
  predictDocument,
} from '@uidx/format'
import { applyDelta } from './apply-delta'
import type { Diagnostic, JsonValue, UidxDocument, UidxPatch, VariableType } from '@uidx/format'

import CanvasPane from './CanvasPane.vue'
import type { DrawingTool } from './graphics-tools'
import type { VectorEditInfo } from './vertex-edit'
import { componentIndex } from './layer-rows'
import NameComponentDialog from './NameComponentDialog.vue'
import PickComponentDialog from './PickComponentDialog.vue'
import ErrorBoundary from './ErrorBoundary.vue'
import LayersPane from './LayersPane.vue'
import PagesList from './PagesList.vue'
import { downloadFile, mimeTypeFor, type ExportBounds, type ExportRequest } from './export-image'
import type { PinFrame } from './pin-writes'
import { departedPages, pageEntries } from './page-list'
import PropertiesPane from './PropertiesPane.vue'
import EditToolbar from './EditToolbar.vue'
import WorkspaceNav from './WorkspaceNav.vue'
import FontsPane from './FontsPane.vue'
import { fontGeneration, fontsInFileKey, openFontsKey } from './font-library'
import WorkspaceStatus from './WorkspaceStatus.vue'
import { canRemove, componentFrom, remapAddress } from './layer-moves'
import { componentRenamePlan, offerableComponents } from './component-rename'
import { newSlotFor, slotTargetFor } from './slot-edits'
import { isDeleteKey, isTypingTarget, toolFor } from './tool-keys'
import { createInFlight } from './in-flight'
import { createUndoStack, type StackEntry } from './undo-stack'
import { createPatchChannel, type PatchNotice } from './patch-channel'
import { rebasePatches } from './patch-rebase'
import { HOME, pageInUrl, upgradedView, urlWithView, viewToOpen, type View } from './page-url'
import TokensPane, { type TokenEditIntent } from './TokensPane.vue'
import TokenDetailPane from './TokenDetailPane.vue'
import RemoveCollectionDialog from './RemoveCollectionDialog.vue'
import { tokensViewModel } from './tokens-view-model'
import { tokenAliasCandidates } from './token-alias-candidates'
import { addCollectionPatch, addTokenPatch, editCellPatch } from './token-edits'
import HomePane from './HomePane.vue'
import { homeModel, type PageCard } from './home-model'
import { createThumbnailer } from './thumbnails'
import { createUidxSocket, type ConnectionState } from './socket'
import { selectionReport } from './selection-report'
import ChatPanel from './ChatPanel.vue'
import { agentUrl } from './agent-client'
import { createAgentToggle } from './agent-toggle'

/**
 * The viewer is driven entirely by the UIDX channel — it never reads the file
 * itself. That is what lets it work in a production build and for a file
 * anywhere on disk, rather than only for one that happens to sit inside the dev
 * server's root.
 */
/**
 * Every page of the document, not just the one on screen (G6).
 *
 * A value may reference a token declared in another page, so resolving what to
 * draw needs the whole document — which is exactly why the server sends all of
 * it and ADR 0004 made document load mandatory.
 */
const pages = shallowRef(new Map<string, UidxDocument>())
/** The page being rendered. Null until `document:opened`, or when serving one file. */
const entry = ref<string | null>(null)
/**
 * The document's pages in the order the server announced them.
 *
 * Kept apart from `pages`, whose keys are only what has *arrived*: the rail
 * should list the document, not the delivery order of a websocket.
 */
const announced = shallowRef<readonly string[]>([])
/** The manifest's document id. Null when serving a single file, which has none. */
const documentId = ref<string | null>(null)

const doc = shallowRef<UidxDocument | null>(null)
const diagnostics = shallowRef<Diagnostic[]>([])
const connection = ref<ConnectionState>('connecting')
const revision = ref<number | null>(null)
/**
 * The revision of every page, not only the open one (story F9).
 *
 * A patch envelope is page-addressed (C1) and carries the revision it was
 * written against, so a single `revision` ref could only ever edit the page the
 * canvas renders. That was enough while every edit was one — until renaming a
 * variant's coordinate, which has to move the declaration on the component's
 * page *and* the `props` of every instance on every consuming page. One
 * envelope per page, each against that page's own revision.
 *
 * `revision` stays as the open page's, because that is what the status bar
 * shows and what the rebase check compares.
 */
const revisions = shallowRef(new Map<string, number>())
/**
 * The diagnostics of every page, for the same reason `revisions` holds them all
 * (story F9): `diagnostics` above is the *open* page's, and opening another one
 * has to be able to answer with that page's errors rather than the last page's.
 * Without this, switching to a page whose last save was rejected showed it
 * clean until it was saved again.
 */
const pageDiagnostics = shallowRef(new Map<string, Diagnostic[]>())
const selection = shallowRef<string[]>([])

/**
 * The agent panel's own toggle: whether it is open, and whether the (optional)
 * service is there to open onto. The service may start after the viewer, so
 * the toggle keeps probing on its own backoff schedule (agent-toggle.ts) —
 * the shell's only job is to start that schedule and stop it on teardown.
 */
const agentHost = agentUrl(import.meta.env as Record<string, string | undefined>)
const agent = createAgentToggle({ url: agentHost })
agent.start()
onBeforeUnmount(() => agent.stop())

/**
 * What every token page declares, before any mode is chosen (G8).
 *
 * A fresh resolver per index change *is* the invalidation: G6 already rebuilds
 * wholesale on a token change, so discarding the resolver discards its cache
 * and there is no incremental bookkeeping to get wrong.
 */
const tokenIndex = computed(() => buildTokenIndex([...pages.value.values()]))
const tokenResolver = computed(() => new TokenResolver(tokenIndex.value))
const sceneTokens = computed(() => ({
  resolver: tokenResolver.value,
  index: tokenIndex.value,
}))

/**
 * Token address -> literal value at every collection's default mode.
 *
 * Still flat, because the panel surfaces that read it have no node in hand.
 * The canvas takes `sceneTokens` instead, since only a mode tuple can say what
 * a particular node resolves to.
 */
const tokens = computed(() => new Map(tokenResolver.value.resolve(defaultTuple(tokenIndex.value))))
provide(
  fontsInFileKey,
  computed(() => {
    const names = new Set<string>()
    const walk = (node: UidxNode): void => {
      if (node.element === 'Text') {
        let family = node.attrs.fontFamily?.value ?? 'Inter'
        if (typeof family === 'string' && family.startsWith('{') && family.endsWith('}'))
          family = tokens.value.get(family.slice(1, -1)) ?? family
        if (typeof family === 'string' && !family.startsWith('{')) names.add(family)
      }
      node.children.forEach(walk)
    }
    for (const page of pages.value.values()) walk(page.tree)
    return [...names].sort()
  }),
)

/**
 * The same map, resolved in the *selected* node's mode (G8).
 *
 * The canvas learns a node's tuple by carrying it down the descent; the
 * inspector is handed an address and has to reconstruct it. Without this the
 * picker previews light values while the node it is editing paints dark, and
 * detaching would write the wrong literal — the one place a stale preview
 * becomes a wrong file.
 */
const panelTokens = computed(() => {
  const tree = doc.value?.tree
  const address = selection.value[0]
  if (!tree || address === undefined) return tokens.value
  return new Map(tokenResolver.value.resolve(tupleAt(tree, address, tokenIndex.value)))
})

/**
 * Component name -> its definition, across every page (F3).
 *
 * The same shape as `tokens` and for the same reason: ADR 0004 §2 makes both
 * names global to the *document*, and the panes are each handed one page. An
 * `<Instance>` on this page may well name a component defined on another, and
 * this is what lets the canvas and the rail agree about what it holds.
 */
const components = computed(() => componentIndex(pages.value.values()))

/**
 * The document as a list of pages, for the rail (the page switcher).
 *
 * Assembled here rather than in `PagesList` for the same reason the two indexes
 * above are: `pages` is a `shallowRef` republished with `triggerRef`, so its Map
 * never changes identity and a child that took it as a prop would never see a
 * page arrive. Reading `pages.value` inside a computed subscribes to the ref
 * itself, which is the only thing `triggerRef` invalidates.
 */
const pageList = computed(() => pageEntries(announced.value, pages.value))

/**
 * The document as the dashboard reports it.
 *
 * Reads the same `pageList` the rail draws, so the two can never disagree about
 * what the document contains, and the same per-page revision and diagnostics
 * maps the canvas is driven by. Computed rather than assembled in `HomePane` for
 * the reason every index above is: `pages` is a `shallowRef` republished with
 * `triggerRef`, so a child taking the Map as a prop would never see a page
 * arrive.
 */
const home = computed(() =>
  homeModel({
    entries: pageList.value,
    docs: pages.value,
    revisions: revisions.value,
    diagnostics: pageDiagnostics.value,
    tokens: tokenIndex.value,
  }),
)

/**
 * The thumbnail renderer, which the dashboard drives and nothing else touches.
 *
 * Built once for the session and lazily inside — the surface is allocated by the
 * first tile that asks, so a session that opens straight to a page never pays
 * for one. Tiles are cached on page and revision, so a save re-renders exactly
 * the page that was saved.
 */
const thumbnailer = createThumbnailer()
onUnmounted(() => thumbnailer.dispose())

/**
 * Tile size in device pixels, fixed rather than measured.
 *
 * The grid's columns are fluid, so measuring would mean re-rendering every tile
 * on a window resize — 25 pages of raster for a change no one is looking at. A
 * render at 640x400 covers the widest column the grid produces on a 2x display,
 * and `object-fit: contain` handles the rest.
 */
const TILE = { width: 640, height: 400 }

/**
 * How many times the document's component definitions have been re-parsed.
 *
 * A page holding an `<Instance>` draws through a `<Component>` that usually
 * lives on another page, so saving the component changes what that page looks
 * like while its own revision does not move — the cache would keep serving the
 * old picture forever. `components` is rebuilt on any page arriving, so its
 * identity changing is the coarsest true answer to "could a definition have
 * moved", which is exactly what `CanvasPane.definitionsMoved` settles for.
 */
const definitions = ref(0)
watch(components, () => (definitions.value += 1))

/**
 * How many times artwork this document references has moved on disk.
 *
 * The same shape as `definitions`, for the third thing a page draws through
 * that does not live in it. A page's revision cannot see an image being
 * rewritten — the bytes are outside every `.uidx` file — so the server watches
 * the referenced artwork and says which `src` moved, and this counts those.
 */
const assetGeneration = ref(0)

/**
 * What each page's picture depends on beyond the page itself, as a stamp.
 *
 * A tile redraws when its own revision moves — but a page draws through
 * components and artwork that live in other files, and neither of those moves
 * this page's revision when it changes. Both counters are folded in per page,
 * and only where they can apply: a page with no instances is unmoved by a
 * component edit, and a page with no image paint by artwork appearing.
 *
 * A string rather than a sum, so that one counter going up and another going
 * down cannot cancel out into an unchanged stamp.
 */
const stamps = computed(() => {
  const out = new Map<string, string>()
  for (const card of home.value.cards) {
    const defs = card.instances > 0 ? definitions.value : 0
    const art = card.assets > 0 ? assetGeneration.value : 0
    out.set(card.file, `${defs}:${art}:${fontGeneration.value}`)
  }
  return out
})

function renderThumb(card: PageCard): Promise<string | null> {
  const doc = pages.value.get(card.file)
  if (!doc) return Promise.resolve(null)
  return thumbnailer.request({
    file: card.file,
    doc,
    tokens: sceneTokens.value,
    literals: tokens.value,
    components: components.value,
    revision: card.revision,
    // A page with no instances cannot be changed by a definition, so it is not
    // stamped and a component edit does not cost it a redraw.
    definitions: card.instances > 0 ? definitions.value : null,
    // Likewise: a page painting with no artwork cannot be changed by artwork.
    assets: card.assets > 0 ? assetGeneration.value : null,
    fonts: fontGeneration.value,
    ...TILE,
  })
}

/** The canvas, for applying an edit optimistically before the file answers. */
const canvasPane = ref<InstanceType<typeof CanvasPane> | null>(null)
const tokensPane = ref<InstanceType<typeof TokensPane> | null>(null)
const pendingCollections = new Map<string, { file: string; name: string }>()
/**
 * What the shell is telling the author, shown as a banner.
 *
 * Two owners, deliberately, because they are cleared by different things. The
 * patch channel owns `patchNotice` and wipes it the moment a patch lands —
 * success is silent, which is right for a drag that committed. The editor owns
 * `editorNotice` for things that are not patch outcomes at all: D8's importer
 * saying what an SVG could not carry. Sharing one ref meant the `insert-node`
 * echo cleared the import's own message a beat after it appeared, which is how
 * this was found.
 */
type Banner = { kind: PatchNotice['kind'] | 'notice'; message: string }
const patchNotice = ref<PatchNotice | null>(null)
const editorNotice = ref<string | null>(null)
/** A refusal outranks a remark: the author needs to know an edit did not land. */
const notice = computed<Banner | null>(
  () =>
    patchNotice.value ??
    (editorNotice.value ? { kind: 'notice', message: editorNotice.value } : null),
)
function dismissNotice(): void {
  patchNotice.value = null
  editorNotice.value = null
}

const socket = createUidxSocket({
  onState: (state) => {
    connection.value = state
    // A reconnect may be to a restarted server that has heard nothing; the
    // report is cheap and the server keeps only the latest, so re-say it.
    if (state === 'open') reportSelection()
  },
  onMessage: (message) => {
    channel.accept(message)
    switch (message.type) {
      /**
       * The document's shape — sent on connect, and again whenever its
       * membership moves. A page created or deleted on disk (by a hand, or by
       * the agent harness, which edits a design by writing `.uidx` files)
       * re-announces the whole list, so this is also where a page *leaves*.
       */
      case 'document:opened': {
        announced.value = message.pages
        // The manifest's own name for the document. The title bar has always
        // shown the open page's frontmatter id, which is the right answer for a
        // page and no answer at all for the dashboard.
        documentId.value = message.id
        forgetDeparted(message.pages)
        // The URL outranks the server's entry page: a reload, a bookmark and a
        // Back all arrive here, and every one of them means "the page I was on"
        // rather than "the page the command line named". `replaceState` rather
        // than `pushState` — adopting the address we were opened at is not a
        // navigation, and it also corrects a URL that named a page this
        // document does not have.
        const open = viewToOpen(location.href, message.pages, message.entry)
        // `entry` is set even when the dashboard is what opens: it is the page
        // the canvas has ready behind it, so clicking a tile is a switch of view
        // rather than a first load, and Back out of a page has somewhere to go.
        const next = open.kind === 'home' ? message.entry : open.file
        // A re-announcement can move the open page out from under the canvas,
        // which the first one never could. The selection goes with it for the
        // same reason `adoptPage` drops it: an address means nothing on a page
        // that is no longer on screen.
        if (entry.value !== null && next !== entry.value) selection.value = []
        entry.value = next
        view.value = open
        // On connect this is a no-op — nothing has arrived, and the page's own
        // `file:changed` calls it again. It earns its place on a re-announce,
        // where the page the canvas is drawing may have just been deleted and
        // no further message is coming to correct these three refs.
        showPage(next)
        history.replaceState(stateFor(open), '', urlWithView(location.href, open))
        break
      }
      /**
       * Artwork moved on disk (ADR 0006 §9).
       *
       * Both surfaces hold their own bytes for this `src` and both are now
       * wrong, so both are told. The canvas rebuilds the page it is showing;
       * the dashboard retires the tiles of pages that paint with artwork by
       * moving the stamp, which is the same mechanism a component edit uses.
       */
      case 'asset:changed': {
        thumbnailer.invalidateAsset(message.src)
        canvasPane.value?.invalidateAsset(message.src)
        assetGeneration.value += 1
        break
      }
      case 'file:changed': {
        const previous = pages.value.get(message.file)
        const priorRevision = revisions.value.get(message.file)
        const own =
          message.patchId !== undefined &&
          (inFlight.has(message.patchId) ||
            historyPatchIds.has(message.patchId) ||
            pendingInverse.has(message.patchId))
        // Our own edit landing on the document we already predicted, and the
        // hash agrees: adopting that exact object leaves `shown` unchanged, so
        // the canvas, the rail and the inspector do no second pass. It only
        // matches when the prediction was a full re-lowering (a structural
        // batch); an attribute edit predicts the tree alone and takes the
        // delta below, which is the same work done after the paint.
        const confirmsPrediction =
          message.patchId !== undefined &&
          inFlight.has(message.patchId) &&
          inFlight.size === 1 &&
          shown.value?.sourceHash === message.sourceHash
        // Otherwise a delta applies to the revision this client holds
        // (viewer-at-scale spec §2); anything it cannot vouch for is asked
        // for whole.
        const incoming = confirmsPrediction
          ? (shown.value ?? null)
          : applyDelta(previous, priorRevision, message)
        if (!incoming) {
          if (message.patchId) inFlight.settle(message.patchId)
          socket.send({ type: 'page:request', file: message.file })
          break
        }
        if (message.patchId) {
          // Our own write landing: the prediction is now the document.
          inFlight.settle(message.patchId)
          historyPatchIds.delete(message.patchId)
          const pending = pendingInverse.get(message.patchId)
          if (pending) {
            pendingInverse.delete(message.patchId)
            undoStack.pushAuthor(
              pending.file,
              pending.forward,
              diffToPatches(incoming, pending.before),
              labelFor(pending.forward),
            )
          }
        }
        // Somebody else's revision joins the history (spec §5). Its patches
        // are the delta itself when one came; otherwise a diff.
        if (!own && previous && priorRevision !== undefined && message.revision !== priorRevision) {
          const forward = message.patches ?? diffToPatches(previous, incoming)
          let inverse: UidxPatch[]
          try {
            inverse = message.patches
              ? inversePatches(previous, message.patches)
              : diffToPatches(incoming, previous)
          } catch {
            inverse = diffToPatches(incoming, previous)
          }
          undoStack.pushExternal(message.file, forward, inverse, incoming.sourceHash)
        }
        pages.value.set(message.file, incoming)
        triggerRef(pages)
        revisions.value.set(message.file, message.revision)
        triggerRef(revisions)
        // A document that parses has no diagnostics, and this is the message
        // that says a page parsed — so it is also what clears the last error.
        pageDiagnostics.value.set(message.file, [])
        triggerRef(pageDiagnostics)
        // A page that merely declares a token the open page binds to still has
        // to reach here — but only the open page is what the canvas renders.
        if (entry.value === null || message.file === entry.value) showPage(message.file)
        const created = message.patchId ? pendingCollections.get(message.patchId) : undefined
        if (created && message.patchId) {
          pendingCollections.delete(message.patchId)
          if (view.value.kind === 'tokens' && view.value.file === created.file)
            void tokensPane.value?.revealCollection(created.name)
        }
        break
      }
      case 'file:error':
        // Recorded for every page: a page whose last save was rejected still
        // has a revision, and an envelope aimed at it needs the right one.
        revisions.value.set(message.file, message.revision)
        triggerRef(revisions)
        pageDiagnostics.value.set(message.file, message.diagnostics)
        triggerRef(pageDiagnostics)
        if (entry.value !== null && message.file !== entry.value) break
        // The last good document stays; the canvas overlays the errors.
        diagnostics.value = message.diagnostics
        revision.value = message.revision
        break
      default:
        break
    }
  },
})

/**
 * Tells the server what is selected, so an agent outside the browser can read
 * what "this" means (`uidx selection`, the MCP tool). Both refs, because a
 * page switch clears the selection without a click, and that clearing is a
 * report too.
 */
function reportSelection(): void {
  const report = selectionReport(entry.value, selection.value)
  if (report) socket.send(report)
}
watch([entry, selection], reportSelection)

/**
 * Points the three single-page refs at one page of the document.
 *
 * `doc`, `diagnostics` and `revision` are all "the open page's", and every one
 * of them used to be written only by the message that happened to concern it.
 * That was enough while the open page could never change. Reading them out of
 * the per-page maps instead is what lets a page be *opened* rather than only
 * arrive.
 */
/**
 * Drops everything the shell holds for a page the document no longer has.
 *
 * All three maps, not just the documents: a revision and a diagnostic list are
 * both "this page's", and a stale revision left behind is what a patch envelope
 * would be addressed with if anything ever aimed at that page again.
 */
function forgetDeparted(current: readonly string[]): void {
  const departed = departedPages(current, pages.value.keys())
  if (departed.length === 0) return
  for (const file of departed) {
    pages.value.delete(file)
    revisions.value.delete(file)
    pageDiagnostics.value.delete(file)
  }
  triggerRef(pages)
  triggerRef(revisions)
  triggerRef(pageDiagnostics)
}

function showPage(file: string): void {
  doc.value = pages.value.get(file) ?? null
  diagnostics.value = pageDiagnostics.value.get(file) ?? []
  revision.value = revisions.value.get(file) ?? null
}

/**
 * Draws one page of the document. False when it was already the open one.
 *
 * The selection goes with it: it is held as addresses, and an address means
 * nothing on a page that never declared it — keeping it would leave the
 * Inspector describing a node that is no longer on screen.
 */
function adoptPage(file: string): boolean {
  if (file === entry.value) return false
  entry.value = file
  selection.value = []
  showPage(file)
  return true
}

/**
 * Whether the dashboard or a page is on screen.
 *
 * A third state was tempting — "home, with a page still loaded behind it" — and
 * is exactly what `entry` already is. Keeping the two apart means the canvas
 * never unmounts a page just because the author looked at the document, so
 * coming back to it is free.
 */
const view = ref<View>(HOME)

/** A project always has an overview, including before its second page exists. */
const canGoHome = computed(() => documentId.value !== null)

/** The history entry for a view. Home carries no page, the way its URL does not. */
function stateFor(next: View): { page: string | null } {
  return { page: next.kind === 'home' ? null : next.file }
}

/** Puts a view on screen without touching history. */
function showView(next: View): void {
  const before = view.value
  view.value = next
  if (next.kind === 'home') {
    // Nothing on the dashboard is a node, so a selection carried onto it would
    // keep the Inspector describing something that is no longer on screen — the
    // same reason `adoptPage` clears it.
    selection.value = []
    return
  }
  adoptPage(next.file)
  // Crossing between a page's two faces changes what an address means — a
  // frame's path in one, a token's in the other — so neither survives the
  // toggle. Same file, same kind (a popstate re-arrival) keeps it.
  if (before.kind !== next.kind) selection.value = []
}

/**
 * Navigating — the one route that is the author moving, rather than the URL or
 * Back saying where they already are.
 *
 * Separate from `showView` only because of the history entry: arriving somewhere
 * because the address bar already said so must not push another entry on top of
 * the one that sent us there.
 */
function openView(next: View): void {
  const now = view.value
  const same =
    now.kind === next.kind &&
    (now.kind === 'home' || (now as { file: string }).file === (next as { file: string }).file)
  if (same) return
  showView(next)
  history.pushState(stateFor(next), '', urlWithView(location.href, next))
}

function openPage(file: string): void {
  openView({ kind: 'page', file })
}

function openHome(): void {
  openView(HOME)
}

/**
 * Back and forward through the views visited.
 *
 * Read out of the URL rather than out of `event.state`, so that a hand-edited
 * address bar and a history entry are the same thing to this handler. `viewToOpen`
 * settles both questions it can be asked: a URL naming a page this document does
 * not have falls back rather than opening an empty canvas, and a URL naming no
 * page is the workspace dashboard.
 */
function onPopState(): void {
  const wanted = pageInUrl(location.href)
  if (wanted !== null && !pageList.value.some((page) => page.file === wanted)) return
  const files = pageList.value.map((page) => page.file)
  showView(viewToOpen(location.href, files, entry.value ?? files[0] ?? ''))
}

/**
 * Whether the open page is a scene at all.
 *
 * A `<Tokens>` page declares variable collections, and `toSceneGraph` throws on
 * one rather than invent a scene for it. Answered here, once, so that none of
 * the three panes has to learn what a token document is — they are simply
 * handed nothing, and the canvas column shows what the page is instead.
 */
const renderable = computed(() => doc.value === null || doc.value.tree.element !== 'Tokens')
/** The open page, when it is one the panes can be handed. */
/**
 * What the panes render: the confirmed document with this client's in-flight
 * attribute patches predicted onto it (spec §4). Equal to `doc` when nothing
 * is in flight. Patches are always written against `doc`, never this — a
 * predicted document's spans are stale.
 */
const inFlight = createInFlight()
const shown = computed<UidxDocument | null>(() => {
  const base = doc.value
  void inFlight.version
  if (!base || inFlight.size === 0) return base
  // The click pays for the tree and nothing else. `predictDocument` rewrites
  // the nodes an edit touches and shares every other one — no splice, no hash,
  // no walk of 3MB to move offsets, which measured 62ms on this page. The
  // document with correct offsets arrives with the confirmation a moment
  // later, off the path the author is waiting on; until then nothing reads
  // this one's spans, because patches are always written against `doc`.
  const patches = inFlight.patches()
  const predicted = predictDocument(base, patches)
  if (predicted !== base) return predicted
  try {
    return applyPatchesIncremental(base, patches).doc
  } catch {
    return base
  }
})
const sceneDoc = computed(() => (renderable.value ? shown.value : null))

/**
 * A `<Tokens>` page's page view IS its tokens view (spec §1): the moment the
 * page's document is known — which may be a beat after navigation on a fresh
 * connect — the view upgrades in place. `replaceState`, not push: the author
 * did not go anywhere, the page just showed its real face.
 */
watch(
  [view, pages],
  () => {
    const now = view.value
    if (now.kind !== 'page') return
    const up = upgradedView(now, pages.value.get(now.file)?.tree.element ?? null)
    if (up !== now) {
      showView(up)
      history.replaceState(stateFor(up), '', urlWithView(location.href, up))
    }
  },
  { immediate: true },
)

/** Workspace faces. Elements is disabled for a token-only page. */
function toggleFace(kind: 'page' | 'tokens' | 'fonts'): void {
  const now = view.value
  if (now.kind === 'home' || now.kind === kind) return
  if (kind === 'page' && !renderable.value) return
  openView({ kind, file: now.file })
}
provide(openFontsKey, () => toggleFace('fonts'))

// ---------------------------------------------------------------- tokens view

const dependents = computed(() => buildDependentsIndex(pages.value))

const tokenGroups = computed(() => {
  const now = view.value
  if (now.kind !== 'tokens') return []
  return tokensViewModel({
    view: now,
    pages: pages.value,
    index: tokenIndex.value,
    resolver: tokenResolver.value,
    deps: dependents.value,
  })
})

/** Creation of whole collections belongs to the page that declares tokens. */
const onTokensPage = computed(
  () => view.value.kind === 'tokens' && pages.value.get(view.value.file)?.tree.element === 'Tokens',
)

function tokenAliasOptions(type: VariableType, selfAddress: string, mode: string) {
  return tokenAliasCandidates(tokenIndex.value, tokenResolver.value, type, selfAddress, mode)
}

function onTokenEdit(intent: TokenEditIntent): void {
  const outcome = editCellPatch({
    index: tokenIndex.value,
    row: { address: intent.row.address, type: intent.row.type, file: intent.row.file },
    mode: intent.mode,
    value: intent.value,
  })
  if ('refused' in outcome) {
    patchNotice.value = { kind: 'rejected', message: outcome.refused }
    return
  }
  commitAcrossPages(new Map([[outcome.file, outcome.patches]]))
}

/** first free name in a sequence: new-token, new-token-2, … */
function freshName(base: string, taken: (name: string) => boolean): string {
  if (!taken(base)) return base
  for (let n = 2; ; n++) if (!taken(`${base}-${n}`)) return `${base}-${n}`
}

const TOKEN_SEED: Record<VariableType, JsonValue> = {
  COLOR: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
  FLOAT: 0,
  STRING: '',
  BOOLEAN: false,
}

/**
 * A new token arrives named and typed like its neighbours — the collection's
 * first row picks the type, `new-token-N` picks the name — and is edited into
 * shape from there. (The design studies put the row straight into edit state;
 * that refinement rides on the rename flow rather than a dialog here.)
 */
function onAddToken(collection: string): void {
  const group = tokenGroups.value.find((g) => g.name === collection)
  if (!group) return
  const declaring = pages.value.get(group.file)
  const node = declaring?.tree.children.find((c) => c.name === collection)
  if (!declaring || !node) return
  const type = group.rows[0]?.type ?? 'FLOAT'
  const name = freshName('new-token', (candidate) =>
    tokenIndex.value.entries.has(`${collection}#${candidate}`),
  )
  const built = addTokenPatch({
    collection,
    file: group.file,
    name,
    type,
    value: TOKEN_SEED[type],
    at: node.children.length,
    modes: group.modes,
  })
  commitAcrossPages(new Map([[built.file, built.patches]]))
  selection.value = [`${collection}#${name}`]
}

/** The token row the detail pane describes, when the selection is one of ours. */
const selectedTokenRow = computed(() => {
  if (view.value.kind !== 'tokens' || selection.value.length !== 1) return null
  const address = selection.value[0]!
  for (const group of tokenGroups.value) {
    const row = group.rows.find((candidate) => candidate.address === address)
    if (row) return row
  }
  return null
})

const selectedTokenDeps = computed(() =>
  selectedTokenRow.value
    ? (dependents.value.ofToken.get(selectedTokenRow.value.address) ?? [])
    : [],
)

/**
 * The delete plan, previewed while the token is merely selected — it is what
 * puts the honest count and the flatten warnings on the button before
 * anything is cut. A broken chain refuses the preview, and that refusal is
 * the disabled button's caption.
 */
const deletePreview = computed(() => {
  const row = selectedTokenRow.value
  if (!row) return null
  try {
    return {
      plan: deleteToken(pages.value, tokenIndex.value, dependents.value, row.address),
      blocked: null as string | null,
    }
  } catch (error) {
    return { plan: null, blocked: error instanceof Error ? error.message : String(error) }
  }
})

function onTokenRename(newName: string): void {
  const row = selectedTokenRow.value
  if (!row) return
  const plan = renameToken(pages.value, dependents.value, row.address, newName)
  commitAcrossPages(plan.byFile)
  selection.value = [`${row.address.slice(0, row.address.indexOf('#'))}#${newName}`]
}

function onTokenDelete(): void {
  const row = selectedTokenRow.value
  const plan = deletePreview.value?.plan
  if (!row || !plan) return
  // The declaring file goes last (spec §11): an interruption then leaves
  // extra literals in other files, never a reference to a variable already
  // gone. `commitAcrossPages` orders for the open page, which is a different
  // concern, so the ordering is spelled out here.
  for (const [file, patches] of plan.byFile) {
    if (file === plan.declaringFile) continue
    commitAcrossPages(new Map([[file, patches]]))
  }
  commitAcrossPages(new Map([[plan.declaringFile, plan.byFile.get(plan.declaringFile) ?? []]]))
  selection.value = []
}

const removingCollection = ref<string | null>(null)
watch(view, () => {
  removingCollection.value = null
})
const collectionDeletePreview = computed(() => {
  const name = removingCollection.value
  if (!name) return null
  const tokens = [...tokenIndex.value.entries.values()]
    .filter((token) => token.collection === name)
    .map((token) => token.address)
  try {
    const plan = deleteCollection(pages.value, tokenIndex.value, dependents.value, name)
    return { tokens: plan.tokens, plan, blocked: null }
  } catch (error) {
    return { tokens, plan: null, blocked: error instanceof Error ? error.message : String(error) }
  }
})

function onRemoveCollection(name: string): void {
  if (!onTokensPage.value || !tokenGroups.value.some((group) => group.name === name)) return
  removingCollection.value = name
}

function confirmCollectionRemoval(): void {
  const plan = collectionDeletePreview.value?.plan
  if (!plan) return
  // Preserve outside references before removing their declarations, matching
  // individual token removal. The preview re-evaluates if the document changes.
  for (const [file, patches] of plan.byFile) {
    if (file !== plan.declaringFile) commitAcrossPages(new Map([[file, patches]]))
  }
  commitAcrossPages(new Map([[plan.declaringFile, plan.byFile.get(plan.declaringFile) ?? []]]))
  selection.value = selection.value.filter((address) => !plan.tokens.includes(address))
  removingCollection.value = null
  // The removed header cannot receive focus when its dialog closes.
  void nextTick(() => tokensPane.value?.focusCollectionTools())
}

function onTokenDeprecate(value: boolean): void {
  const row = selectedTokenRow.value
  if (!row) return
  const declaring = pages.value.get(row.file)
  const node = declaring ? findTokenNode(declaring, row.address) : null
  if (!node) return
  const patch: UidxPatch = value
    ? node.attrs.deprecated
      ? { op: 'set', address: row.address, prop: 'deprecated', value: true }
      : { op: 'add', address: row.address, prop: 'deprecated', value: true }
    : { op: 'remove', address: row.address, prop: 'deprecated' }
  commitAcrossPages(new Map([[row.file, [patch]]]))
}

function findTokenNode(pageDoc: UidxDocument, address: string) {
  for (const collection of pageDoc.tree.children) {
    for (const variable of collection.children) {
      if (variable.address === address) return variable
    }
  }
  return null
}

/** A dependent row is a door: land on its page, its face, its node. */
function onTokenJump(dependent: Dependent): void {
  const isToken = dependent.kind === 'variable' || dependent.kind === 'mode'
  openView({ kind: isToken ? 'tokens' : 'page', file: dependent.file })
  selection.value = [dependent.address]
}

/** The dashboard's collection rows land on the tokens view of the declaring page. */
function openTokens(collection: string): void {
  for (const [file, pageDoc] of pages.value) {
    if (pageDoc.tree.element !== 'Tokens') continue
    if (pageDoc.tree.children.some((child) => child.name === collection)) {
      openView({ kind: 'tokens', file })
      return
    }
  }
}

function onAddCollection(): void {
  const now = view.value
  if (now.kind !== 'tokens') return
  const declaring = pages.value.get(now.file)
  if (!declaring || declaring.tree.element !== 'Tokens') return
  const name = freshName('collection', (candidate) => tokenIndex.value.collections.has(candidate))
  const built = addCollectionPatch({ file: now.file, name, at: declaring.tree.children.length })
  const patchId = dispatch(built.file, built.patches, true)
  if (patchId) pendingCollections.set(patchId, { file: built.file, name })
}

const channel = createPatchChannel({
  send: (message) => socket.send(message),
  /**
   * Optimistic state is thrown away by re-rendering the document the server
   * last confirmed. The canvas has been showing an edit that did not land, and
   * `doc` is still the authoritative version, so re-applying it is the rollback.
   */
  onRollback: (entry) => {
    pendingCollections.delete(entry.patchId)
    // The predicted attributes leave with the batch; the re-render below is
    // for what `shown` does not hold — a canvas gesture's own result.
    inFlight.settle(entry.patchId)
    const authoritative = doc.value
    doc.value = null
    doc.value = authoritative
  },
  onNotice: (next) => (patchNotice.value = next),
  /**
   * E4. The file is the source of truth, so it changing underneath an edit is
   * routine, not an error. The stale answer always arrives after the
   * `file:changed` that outdated it (the server serialises both onto this
   * socket), so `doc` already holds the revision the server wants patches
   * against — and if the edit's target survived, the edit re-applies there and
   * the author never hears about the race.
   */
  rebase: (inFlight, serverRevision) => {
    const next = doc.value
    if (!next || !inFlight.baseDoc) return null
    if (revision.value !== serverRevision) return null
    if (entry.value !== null && inFlight.file !== entry.value) return null
    return rebasePatches(inFlight.patches, inFlight.baseDoc, next)
  },
})

/**
 * The page an edit targets.
 *
 * The entry page, because that is what the canvas renders and therefore the only
 * thing selectable. Once `<Instance>` lands (F3) a gesture can mean an edit to
 * the page that *defines* a component instead, which is what the envelope's
 * `file` field exists for.
 */
/**
 * A component rename held at the door with its radius shown (spec §14).
 * Cancelling leaves the file exactly as it was — the rail's optimistic
 * remap of its collapsed set is cosmetic and self-heals on the next rename.
 */
const pendingRename = shallowRef<{
  from: string
  to: string
  plan: import('@uidx/schema').RefactorPlan
} | null>(null)

function commitPatches(patches: UidxPatch[]): void {
  const page = entry.value
  if (page === null || revision.value === null) return
  // A lone set-name on an instantiated component is not one page's edit: the
  // engine rewrites every instance, and the author sees the radius first.
  const plan = componentRenamePlan(pages.value, dependents.value, patches)
  if (plan) {
    const patch = patches[0] as { address: string; value: string }
    pendingRename.value = { from: patch.address, to: patch.value, plan }
    return
  }
  dispatch(page, patches, true)
}

/**
 * One shared history for every writer (spec §5): the author's batches, an
 * outside editor's revisions, an LLM turn's. Undo is a new write of the
 * inverse through the same channel, never a private rewind.
 */
const undoStack = createUndoStack()
/** Patch ids dispatched *by* undo or redo: their confirmations must not push entries. */
const historyPatchIds = new Set<string>()
/** Author batches whose inverse waits for the confirmed document (structural ops). */
const pendingInverse = new Map<
  string,
  { file: string; forward: UidxPatch[]; before: UidxDocument }
>()

function labelFor(patches: readonly UidxPatch[]): string {
  const first = patches[0]
  if (!first) return 'Edit'
  if (first.op === 'set' || first.op === 'add' || first.op === 'remove') {
    return `${first.prop} on ${first.address || 'page'}`
  }
  return first.op
}

/**
 * Sends one page's patches and records them — unless they are history
 * replaying itself, which records nothing.
 *
 * The document the patches were written against rides along, so a stale
 * answer can ask whether their targets survived the change (E4). The inverse
 * is taken against what the author is looking at — `shown` for the open page
 * — so two quick edits to one property each record the value that was on
 * screen, not the confirmed value both started from.
 */
function dispatch(file: string, patches: readonly UidxPatch[], record: boolean): string | null {
  const at = revisions.value.get(file)
  const base = pages.value.get(file)
  if (at === undefined || !base) return null
  const baseline = file === entry.value ? (shown.value ?? base) : base
  let inverse: UidxPatch[] | null = null
  if (record) {
    try {
      inverse = inversePatches(baseline, patches)
    } catch {
      inverse = null // a batch we cannot invert up front; the confirmation will
    }
  }
  const patchId = channel.dispatch(file, at, patches, base)
  if (!patchId) return null
  if (file === entry.value) inFlight.push(patchId, patches)
  if (!record) historyPatchIds.add(patchId)
  else if (inverse) undoStack.pushAuthor(file, [...patches], inverse, labelFor(patches))
  else pendingInverse.set(patchId, { file, forward: [...patches], before: base })
  return patchId
}

function applyHistory(item: StackEntry, direction: 'undo' | 'redo'): void {
  const open = entry.value
  const files = [...item.files.keys()].sort((a, b) => Number(a === open) - Number(b === open))
  for (const file of files) {
    const patches =
      direction === 'undo' ? item.files.get(file)!.inverse : item.files.get(file)!.forward
    if (patches.length) dispatch(file, patches, false)
  }
}

function undo(): void {
  const top = undoStack.undo()
  if (top) applyHistory(top, 'undo')
}

function redo(): void {
  const next = undoStack.redo()
  if (next) applyHistory(next, 'redo')
}

function confirmComponentRename(): void {
  const pending = pendingRename.value
  if (!pending) return
  pendingRename.value = null
  commitAcrossPages(pending.plan.byFile)
}

/**
 * One edit that lands in several files (story F9).
 *
 * Deliberately several envelopes rather than one: C1's envelope is
 * page-addressed and carries the revision it was written against, and two pages
 * do not share a revision. So this is not atomic across files, and cannot be —
 * a rename whose second envelope goes stale leaves the document briefly
 * disagreeing with itself, which `uidx check` reports precisely (UIDX405-407)
 * rather than leaving anyone to guess.
 *
 * The open page goes last, so its `file:changed` is the one the canvas settles
 * on after the others have landed.
 */
/**
 * An edit the panel refused before sending anything (F9).
 *
 * Shown through the same banner a server rejection uses, and typed as one:
 * "the edit cannot be made at all; say why" is exactly what this is, and giving
 * a refusal its own channel would mean two ways of telling the author the same
 * kind of thing.
 */
function onRefused(reason: string): void {
  patchNotice.value = { kind: 'rejected', message: reason }
}

function commitAcrossPages(byFile: ReadonlyMap<string, readonly UidxPatch[]>): void {
  const open = entry.value
  const files = [...byFile.keys()].sort((a, b) => Number(a === open) - Number(b === open))
  for (const file of files) {
    const patches = byFile.get(file)
    if (!patches?.length) continue
    dispatch(file, patches, true)
  }
}

function onPreview(address: string, prop: string, value: JsonValue): void {
  canvasPane.value?.applyProp(address, prop, value, 'preview')
}

/**
 * A committed edit goes to the canvas, not to the socket.
 *
 * The scene mutation emits `node:updated`, which CanvasPane turns into patches
 * through `fromSceneChange` and emits back here. Routing it that way rather than
 * building a patch here means panel edits and canvas gestures share one filter —
 * so D4's rule about computed geometry is enforced in one place rather than two.
 */
function onCommit(address: string, prop: string, value: JsonValue): void {
  canvasPane.value?.applyProp(address, prop, value, 'commit')
}

/** The panel's cursor on the canvas: hovering a control lights what it governs. */
function onHover(address: string, prop: string | null): void {
  canvasPane.value?.applyHover(address, prop)
}

/**
 * How big the selected node's export would be, measured by the canvas.
 *
 * `flush: 'post'` because the measurement is of the *scene graph*, and the
 * graph is rebuilt by CanvasPane's own watcher on the document it is handed.
 * A pre-flush read here would measure the page before last, so a resize would
 * show its old pixel count until the next selection.
 */
const exportBounds = shallowRef<ExportBounds | null>(null)

/**
 * Where the selected node actually sits, and inside what (H2, ADR 0011).
 *
 * Measured beside `exportBounds` and for the same reasons — including
 * `flush: 'post'`, which is not optional here: a pre-flush read measures the
 * page before last, so a pinned child's X would show the position it had at
 * the parent's previous width.
 */
const pinFrame = shallowRef<PinFrame | null>(null)

/*
 * `graphRevision` and not just the document: the canvas rebuilds
 * asynchronously (it awaits assets) from a watcher that is not, so a
 * post-flush read here can happen well before the graph has moved. Measured
 * in H2's live pass, where a pinned child's X sat one edit behind the file
 * and stayed there. The revision is the canvas saying "there is something new
 * to measure", which is the only thing that can be relied on.
 */
watch(
  [selection, sceneDoc, () => canvasPane.value?.graphRevision],
  () => {
    const address = selection.value.length === 1 ? selection.value[0] : undefined
    exportBounds.value = address ? (canvasPane.value?.exportBounds(address) ?? null) : null
  },
  { flush: 'post', immediate: true },
)

/*
 * The pin frame also follows `previewRevision` — per gesture frame — so the
 * panel's rows track a drag live. Split from `exportBounds` because that one
 * walks the selection's descendants, which nobody needs at pointer-move rate;
 * this is one `getNode`.
 */
watch(
  [
    selection,
    sceneDoc,
    () => canvasPane.value?.graphRevision,
    () => canvasPane.value?.previewRevision,
  ],
  () => {
    const address = selection.value.length === 1 ? selection.value[0] : undefined
    pinFrame.value = address ? (canvasPane.value?.pinFrame(address) ?? null) : null
  },
  { flush: 'post', immediate: true },
)

/**
 * The export the panel asked for, rendered and handed to the browser.
 *
 * The file name arrives with the request rather than being derived again here:
 * the button already said it out loud, and a second derivation is a second
 * chance to say something else.
 */
async function onExport(request: ExportRequest): Promise<void> {
  const data = await canvasPane.value?.exportNode(request.address, request.format, request.scale)
  if (!data) {
    editorNotice.value = `${request.fileName} could not be rendered.`
    return
  }
  downloadFile(data, request.fileName, mimeTypeFor(request.format))
}

/**
 * A rename or a reparent moves every address beneath the node it acted on, and
 * the selection is held as addresses. Without this the rail and the canvas keep
 * pointing at a node that stopped existing the moment the file came back.
 */
function onMoved(oldAddress: string, newAddress: string): void {
  selection.value = selection.value.map((a) => remapAddress(oldAddress, newAddress, a))
}

/* ------------------------------------------------- creation and deletion */

/**
 * The armed creation tool (D1).
 *
 * The shell holds it rather than the toolbar, because the canvas is what
 * actually draws with it and the keyboard can change it without the pointer
 * ever reaching the toolbar. One owner, two ways in.
 */
const tool = ref<DrawingTool | null>(null)

/**
 * A tool is put away as soon as it has been used, which is Figma's behaviour
 * and the one that stops a stray click after a deliberate one from littering
 * the file with shapes nobody asked for.
 */
function onCanvasPatches(patches: UidxPatch[]): void {
  if (patches.some((p) => p.op === 'insert-node')) {
    tool.value = null
    // An armed component is put away by the same rule and for the same reason
    // (F11): one deliberate click places one instance, and the stray one after
    // it places nothing.
    placing.value = null
  }
  commitPatches(patches)
}

/**
 * The component the next canvas click would place, or null (story F11).
 *
 * A sibling of `tool` rather than a value inside it: §3.3's creation whitelist
 * is the five elements a person draws, and an `<Instance>` is chosen from a
 * list instead. The two are mutually exclusive — arming either disarms the
 * other — because the canvas has one press to give.
 */
const placing = ref<string | null>(null)
/** Open while the author is choosing which component to place. */
const picking = ref(false)

function armTool(next: DrawingTool | null): void {
  tool.value = next
  if (next !== null) placing.value = null
}

function placeInstance(name: string): void {
  picking.value = false
  placing.value = name
  tool.value = null
}

/** Whether the selection is one node the file will let go of (D2). */
/**
 * The address whose points are open for editing on the canvas (D12), or null.
 *
 * It is here because Delete is here. The canvas owns the mode and the shell
 * owns the key, and while the mode is open the key means "remove this point"
 * rather than "remove this node" — so the shell stands down for the node, and
 * the controller's own handler takes the key. The toolbar's Delete button
 * greys out with it, which is the same rule said where a pointer can see it.
 */
const vertexEditing = ref<string | null>(null)
const vectorInfo = ref<VectorEditInfo | null>(null)
function editVector(address: string): void {
  armTool(null)
  placing.value = null
  canvasPane.value?.editVector(address)
}

const deletable = computed<string | null>(() => {
  const doc_ = sceneDoc.value
  if (!doc_ || vertexEditing.value !== null || selection.value.length !== 1) return null
  const address = selection.value[0]!
  return canRemove(doc_, address) ? address : null
})

/**
 * Delete the selection.
 *
 * The guard is `canRemove`, the same judgement the patcher enforces — so the
 * button is disabled rather than throwing, which is what D2 asks for. The
 * selection is cleared here rather than waiting for the echo: the address it
 * names stops existing the moment this lands, and a selection pointing at
 * nothing is what leaves the inspector showing a node that has gone.
 */
/**
 * Every name the document has already spoken for (ADR 0004 §2).
 *
 * Components and token variables share one namespace, so a new component may
 * not take a name either of them holds. Built here because only the shell has
 * every page — the same reason `tokens` and `components` live here.
 */
const takenNames = computed(() => {
  const out = new Set<string>(components.value.keys())
  for (const address of tokens.value.keys()) out.add(address)
  return out
})

/** The node a "make component" would act on, or null (F10). */
const componentSource = computed<string | null>(() => {
  const doc_ = sceneDoc.value
  if (!doc_ || vertexEditing.value !== null || selection.value.length !== 1) return null
  const address = selection.value[0]!
  // Asked with a name that is certainly free, so this answers "is this node
  // eligible" rather than "is the name the author has not typed yet any good".
  return componentFrom(doc_, address, '\u0000probe', new Set()) ? address : null
})

/** Open while the author is naming the component (F10). Holds the address. */
const naming = ref<string | null>(null)

function startMakeComponent(): void {
  naming.value = componentSource.value
}

/**
 * The gesture, once it has a name.
 *
 * Two patches in one envelope, so the pair applies under one revision check —
 * a component that appeared without its content having moved would be a
 * document `uidx check` rejects. `moved` is the same signal a rename or a
 * reparent sends: the node answers to a new address now, and the shell holds
 * the selection as addresses.
 */
function makeComponent(name: string): void {
  const doc_ = sceneDoc.value
  const address = naming.value
  naming.value = null
  if (!doc_ || address === null) return
  const made = componentFrom(doc_, address, name, takenNames.value)
  if (!made) return
  commitPatches(made.patches)
  onMoved(address, made.address)
}

/**
 * Where a new slot would land, or null (story F5).
 *
 * Computed rather than asked on press, because the toolbar disables the
 * button: a hole is legal in far fewer places than a rectangle is, and a
 * control that looks available and then does nothing teaches the wrong rule.
 */
const slotTarget = computed(() =>
  sceneDoc.value ? slotTargetFor(sceneDoc.value, selection.value) : null,
)

/**
 * Insert a `<Slot>`, and select it (ADR 0007 §6).
 *
 * Selecting it is not polish. There is no empty-slot indicator on the canvas —
 * the ADR rejected one — so a slot with no default content draws nothing, and
 * this is the gesture that makes one. The rail shows the row either way, but
 * the author should not have to go looking for what they just made.
 */
function addSlot(): void {
  const doc_ = sceneDoc.value
  if (!doc_) return
  const made = newSlotFor(doc_, selection.value)
  if (!made) return
  commitPatches(made.patches)
  selection.value = [made.address]
}

function removeSelection(): void {
  const address = deletable.value
  if (address === null) return
  commitPatches([{ op: 'remove-node', address }])
  selection.value = []
}

/**
 * Global shortcuts for the toolbar (D1) and delete (D2).
 *
 * On the window rather than the canvas, because they act on the selection and
 * the selection can just as easily have been made in the layers rail. Both
 * helpers refuse a keystroke aimed at a field, so Backspace in a hex input
 * still edits the hex.
 */
function onKeyDown(event: KeyboardEvent): void {
  if (!doc.value || event.defaultPrevented) return
  // ⌘Z / ⇧⌘Z (spec §5). The canvas SDK's command registry binds the same keys
  // but the viewer never mounts it — only `provideEditor`, `useCanvas` and the
  // field components come from `@open-pencil/vue` — so this is the one handler.
  if ((event.metaKey || event.ctrlKey) && !event.altKey && event.code === 'KeyZ') {
    if (isTypingTarget(event)) return
    event.preventDefault()
    if (event.shiftKey) redo()
    else undo()
    return
  }
  if (!sceneDoc.value) return
  // Figma's own binding. Checked before `toolFor`, which refuses anything with
  // a modifier on it. It guards itself: `componentSource` is null when the
  // selection cannot become a component, and opening the dialog on null is a
  // no-op, so the key never does something the button would have refused.
  if ((event.metaKey || event.ctrlKey) && event.altKey && event.code === 'KeyK') {
    if (isTypingTarget(event)) return
    event.preventDefault()
    startMakeComponent()
    return
  }
  if (event.defaultPrevented) return
  if (connection.value !== 'open') return
  const next = toolFor(event)
  if (next !== undefined) {
    event.preventDefault()
    armTool(next)
    // Escape and V mean "back to selecting", which has to put an armed
    // component away as well as an armed tool — `toolFor` answers null for
    // both, and only this knows there are two things to disarm.
    if (next === null) placing.value = null
    return
  }
  if (isDeleteKey(event) && deletable.value !== null) {
    event.preventDefault()
    removeSelection()
  }
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))

onMounted(() => window.addEventListener('popstate', onPopState))
onUnmounted(() => window.removeEventListener('popstate', onPopState))

onUnmounted(() => socket.close())
</script>

<template>
  <div class="shell">
    <div v-if="view.kind === 'home'" class="home-bar">
      <WorkspaceNav
        :title="String(documentId ?? doc?.frontmatter.id ?? 'uidx')"
        :page="String(doc?.frontmatter.id ?? entry ?? '')"
        :view="view.kind"
        :can-go-home="canGoHome"
        :renderable="renderable"
        @home="openHome"
        @face="toggleFace"
      />
      <WorkspaceStatus :connection="connection" :revision="null" />
    </div>

    <!--
      Mounted only while it is open, so the name it suggests is read from the
      selection at the moment the author asked rather than kept in step with it.
    -->
    <PickComponentDialog
      v-if="picking"
      :components="offerableComponents(components)"
      @pick="placeInstance"
      @close="picking = false"
    />

    <!-- Spec §14: the rename waits here until its radius has been seen. -->
    <div v-if="pendingRename" class="rename-confirm" role="dialog" aria-modal="true">
      <div class="rename-card">
        <p>
          Rename <strong>{{ pendingRename.from }}</strong> to
          <strong>{{ pendingRename.to }}</strong> — updates
          {{ pendingRename.plan.dependents.length }} instance{{
            pendingRename.plan.dependents.length === 1 ? '' : 's'
          }}
          in {{ new Set(pendingRename.plan.dependents.map((d) => d.file)).size }} file{{
            new Set(pendingRename.plan.dependents.map((d) => d.file)).size === 1 ? '' : 's'
          }}:
        </p>
        <ul>
          <li
            v-for="dependent in pendingRename.plan.dependents"
            :key="dependent.file + dependent.address"
          >
            {{ dependent.address }} — {{ dependent.file }}
          </li>
        </ul>
        <div class="rename-actions">
          <button type="button" class="go" @click="confirmComponentRename">Rename</button>
          <button type="button" @click="pendingRename = null">Cancel</button>
        </div>
      </div>
    </div>

    <NameComponentDialog
      v-if="naming !== null"
      :suggested="naming.split(/[#/]/).at(-1) ?? 'Component'"
      :taken="takenNames"
      @confirm="makeComponent"
      @close="naming = null"
    />

    <RemoveCollectionDialog
      v-if="removingCollection !== null && collectionDeletePreview"
      :name="removingCollection"
      :tokens="collectionDeletePreview.tokens"
      :plan="collectionDeletePreview.plan"
      :blocked="collectionDeletePreview.blocked"
      @confirm="confirmCollectionRemoval"
      @close="removingCollection = null"
    />

    <div v-if="connection === 'reconnecting'" class="banner">
      Lost the connection to the uidx server — retrying. The canvas is showing the last state
      received.
    </div>

    <!--
      A patch that did not land. Dismissable rather than timed: a stale rejection
      means an edit the author made is not in their file, which is worth them
      actually reading.
    -->
    <div v-if="notice" class="banner" :data-kind="notice.kind" role="alert">
      {{ notice.message }}
      <button type="button" class="dismiss" @click="dismissNotice">dismiss</button>
    </div>

    <!--
      A sibling of the dialogs and banners above rather than of the panes below:
      `position: fixed` already takes it out of the canvas's flow, and sitting
      here means switching between the dashboard and a page never unmounts it.
    -->
    <ChatPanel
      v-if="agent.open.value"
      :document-id="documentId"
      :page="view.kind === 'page' ? view.file : null"
      :selection="selection"
      :url="agentHost"
      @close="agent.toggle()"
      @turn-finished="({ turnId, written }) => undoStack.attributeTurn(turnId, written)"
    />

    <div
      class="panes"
      :class="{
        solo: view.kind === 'home',
        'without-inspector': view.kind === 'fonts' || (view.kind === 'tokens' && !selectedTokenRow),
      }"
    >
      <aside v-if="view.kind !== 'home'" class="rail" aria-label="Document navigation">
        <WorkspaceNav
          :title="String(documentId ?? doc?.frontmatter.id ?? 'uidx')"
          :page="String(doc?.frontmatter.id ?? entry ?? '')"
          :view="view.kind"
          :can-go-home="canGoHome"
          :renderable="renderable"
          @home="openHome"
          @face="toggleFace"
        />
        <ErrorBoundary pane="Pages">
          <PagesList :entries="pageList" :open="entry" @open="openPage" @home="openHome" />
        </ErrorBoundary>
        <ErrorBoundary v-if="view.kind === 'page'" pane="Layers">
          <LayersPane
            :doc="sceneDoc"
            :selection="selection"
            :components="components"
            :vector-editing="vertexEditing"
            :writable="connection === 'open'"
            @edit-vector="editVector"
            @select="selection = [$event]"
            @patches="commitPatches"
            @moved="onMoved"
          />
        </ErrorBoundary>
        <WorkspaceStatus :connection="connection" :revision="revision" />
      </aside>

      <!--
        The dashboard takes the whole width rather than sitting in the canvas
        column. The three panes answer questions about one page — what is on it,
        what a node's properties are — and none of them has an answer while the
        document itself is what is on screen. The rail in particular would list
        the pages a second time, beside the grid that is already the list.
      -->
      <ErrorBoundary v-if="view.kind === 'home'" pane="Home">
        <HomePane
          :model="home"
          :render="renderThumb"
          :stamps="stamps"
          :current="entry"
          :title="documentId"
          :connected="connection === 'open' && documentId !== null"
          @open="openPage"
          @tokens="openTokens"
        />
      </ErrorBoundary>

      <!--
        The tokens face (spec §§1–7): the rail keeps the pages list — you can
        still walk the document — but the layers tree stays home, because a
        token table's rows are not a scene's nodes. The old "declares
        variables, not a scene" placeholder died here: a token page now opens
        as this view.
      -->
      <ErrorBoundary v-else-if="view.kind === 'fonts'" pane="Fonts"><FontsPane /></ErrorBoundary>
      <template v-else-if="view.kind === 'tokens'">
        <ErrorBoundary pane="Tokens">
          <TokensPane
            ref="tokensPane"
            :key="view.file"
            :root-font-size="rootFontSizeOf(doc)"
            :groups="tokenGroups"
            :selection="selection"
            :can-create-collections="onTokensPage"
            :alias-options-for="tokenAliasOptions"
            @select="selection = [$event]"
            @edit="onTokenEdit"
            @add-token="onAddToken"
            @add-collection="onAddCollection"
            @remove-collection="onRemoveCollection"
          />
        </ErrorBoundary>
        <ErrorBoundary v-if="selectedTokenRow" pane="Token">
          <TokenDetailPane
            :row="selectedTokenRow"
            :root-font-size="rootFontSizeOf(doc)"
            :dependents="selectedTokenDeps"
            :delete-warnings="deletePreview?.plan?.flattened ?? []"
            :delete-blocked="deletePreview?.blocked ?? null"
            @close="selection = []"
            @jump="onTokenJump"
            @rename="onTokenRename"
            @delete="onTokenDelete"
            @deprecate="onTokenDeprecate"
          />
        </ErrorBoundary>
      </template>

      <template v-else>
        <ErrorBoundary pane="Canvas">
          <CanvasPane
            ref="canvasPane"
            :doc="sceneDoc"
            :page="entry"
            :diagnostics="diagnostics"
            :tokens="tokens"
            :scene-tokens="sceneTokens"
            :selection="selection"
            :tool="tool"
            :placing="placing"
            :writable="connection === 'open'"
            :components="components"
            @selection="selection = $event"
            @patches="onCanvasPatches"
            @moved="onMoved"
            @notice="editorNotice = $event || null"
            @vertex-edit="vertexEditing = $event"
            @vector-info="vectorInfo = $event"
            @drawing-done="armTool(null)"
          >
            <template #tools>
              <EditToolbar
                :tool="tool"
                :can-delete="deletable !== null"
                :can-make-component="componentSource !== null"
                :placing="placing"
                :can-place-instance="components.size > 0"
                :can-add-slot="slotTarget !== null"
                :writable="connection === 'open' && sceneDoc !== null"
                @tool="armTool"
                @remove="removeSelection"
                @make-component="startMakeComponent"
                @place-instance="picking = true"
                @add-slot="addSlot"
              />
            </template>
          </CanvasPane>
        </ErrorBoundary>
        <ErrorBoundary pane="Inspector">
          <PropertiesPane
            :doc="sceneDoc"
            :selection="selection"
            :tokens="panelTokens"
            :token-index="tokenIndex"
            :components="components"
            :pages="pages"
            :file="entry ?? undefined"
            :writable="connection === 'open'"
            :export-bounds="exportBounds"
            :pin-frame="pinFrame"
            :vector-info="vectorInfo"
            :can-make-component="componentSource !== null"
            @edit-vector="editVector"
            @finish-vector="canvasPane?.finishDrawing()"
            @vector-action="canvasPane?.vectorAction($event)"
            @make-component="startMakeComponent"
            @export="onExport"
            @preview="onPreview"
            @commit="onCommit"
            @remap="commitAcrossPages"
            @refused="onRefused"
            @patches="commitPatches"
            @hover="onHover"
          />
        </ErrorBoundary>
      </template>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
}
.home-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
}
.home-bar :deep(.workspace-status) {
  border: 0;
  padding-right: 20px;
}
.banner {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  background: color-mix(in srgb, var(--warn) 12%, transparent);
  color: var(--warn);
  font-size: 12px;
  border-bottom: 1px solid var(--warn);
}
.banner[data-kind='rejected'] {
  background: color-mix(in srgb, var(--danger) 18%, transparent);
  color: var(--danger);
  border-bottom-color: var(--danger);
}
.dismiss {
  margin-left: auto;
  background: none;
  border: 1px solid currentcolor;
  border-radius: var(--radius);
  color: inherit;
  font-family: inherit;
  font-size: var(--ui-size-sm);
  padding: 1px var(--gap);
  cursor: pointer;
}
.panes {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: var(--rail-w) minmax(0, 1fr) var(--inspector-w);
}
/*
 * The dashboard is the only pane on screen, and it wants the whole width — the
 * three-column track would otherwise put it in the left rail's 240px.
 */
.panes.solo {
  grid-template-columns: minmax(0, 1fr);
}
.panes.without-inspector {
  grid-template-columns: var(--rail-w) minmax(0, 1fr);
}
/* The rail owns navigation and session status, leaving the canvas full height. */
.rail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background: var(--panel);
  border-right: 1px solid var(--line);
}
.rail > :deep(.workspace-status) {
  margin-top: auto;
}
.rail :deep(.layers),
.rail :deep(.pages) {
  border-right: 0;
}
.rail > :deep(.layers) {
  flex: 1;
  min-height: 0;
}
.rename-confirm {
  align-items: center;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  inset: 0;
  justify-content: center;
  position: fixed;
  z-index: 30;
}
.rename-card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  max-height: 60vh;
  max-width: 420px;
  overflow: auto;
  padding: var(--pad);
}
.rename-card ul {
  color: var(--text-faint);
  list-style: none;
  margin: 0 0 var(--pad);
  padding: 0;
}
.rename-actions {
  display: flex;
  gap: var(--gap-sm);
}
.rename-actions button {
  background: none;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: inherit;
  cursor: pointer;
  padding: 3px 12px;
}
.rename-actions .go {
  border-color: var(--accent, #4c6cff);
}
</style>
