# Spec — the viewer becomes a Figma-shaped editor

**Status: awaiting approval.** Nothing here is built.

Three panes today are Intent | Canvas | Contract. Three panes after this are
**Layers | Canvas | Inspector**: a real layer tree on the left that navigates,
renames, hides and reorders; a grouped property inspector on the right; and a
visual system close enough to Figma's dark UI that somebody who uses Figma is
immediately at home.

## Why this exists

The viewer works and looks like a debug view of itself. The left rail renders
the intent Markdown, the right rail stacks a flat property list on top of an
indented outline dump, and the whole thing is styled in monospace with no
density, rhythm or grouping. Every piece of information is present and none of
it is designed.

Three separate gaps, and they were on three different tracks:

1. **No layer tree.** The tree data is on screen — `PropertiesPane.vue` already
   flattens `doc.tree` under a comment reading *"so the outline still reads like
   a layers panel"* — but it is a static indented dump on the right, not a
   navigator on the left. The backlog's only tree story is **D3**, which is
   about *dragging* and assumes a tree already exists to drag in.
2. **The inspector has no structure.** Story C5 shipped a flat list of
   `label: control` rows built from whatever attributes the file happens to
   declare. **C6** fixes that and is fully specced in
   [properties-panel.md](../../properties-panel.md) and planned in
   [the C6 plan](../plans/2026-08-17-properties-panel-c6.md) — written, never
   built.
3. **Nothing owns the graphic design.** The properties-panel spec decomposes
   "like Figma" into grouping, unset properties, paired fields, enums and
   applicability — a table with no row for how any of it looks. No story in the
   backlog has ever covered appearance.

This spec puts all three on one track, because they are one job: a Figma-shaped
editor is a tree, an inspector and a visual language, and building them
separately means styling the same surfaces twice.

## Decisions taken

### Intent leaves the viewer

The left rail becomes layers. The intent Markdown is **removed from the viewer**
rather than tabbed, stacked or hidden behind a toggle.

This is a deliberate product decision and it costs something. The README's first
claim is that a `.uidx` file carries "two synchronised layers in one plain-text
document", and after this the viewer renders only the layer Figma also renders.
The intent region stays in the file, `uidx` still never writes to it (§3.1), and
it is read in an editor.

The alternatives were considered and declined: tabs in the left rail, a
collapsed section beneath the tree, a tab on the right rail, and a top-bar
toggle. The reason for declining them is that every one of them keeps a second
thing competing for the rail that Figma gives entirely to layers.

**Consequences to record rather than discover:** story B3 ("intent, canvas and
properties side by side") is superseded, `IntentPane.vue` is deleted along with
the viewer's Markdown rendering path, and the README's description of the viewer
needs updating in the same change.

### The tree is read from the document, not the scene graph

Two designs were weighed.

**Scene-graph-native** would build the tree from the live `SceneGraph` with
`buildLayerTreeModel`, render it with `LayerTreeRoot` / `LayerTreeItem`, drag it
with `useLayerDrag(editor)`, and translate the resulting structural events into
patches with a new `fromSceneStructure()` in `@uidx/schema` — mirroring how
`fromSceneChange` handles property changes today. Maximum reuse: hitboxes,
make-child, keyboard navigation, virtualisation and inline rename all arrive
free.

**Document-native** renders from `doc.tree` and emits patches directly. It is
what this spec chooses.

The deciding argument is the hazard the backlog already wrote down for D3:

> **Watch:** a drag-reparent likely emits `node:reparented` *then*
> `node:reordered`. Those two must coalesce into one `move-node`, or a reorder
> writes twice.

Under document-native that hazard does not get solved, it stops existing. The
tree knows the address, the new parent and the index at drop time, so one
gesture produces one `move-node` by construction — no event to catch, coalesce
or de-duplicate.

Three supporting reasons:

- **Addresses are already name paths.** A row's address falls out of its
  nesting, and that same string is the patch target *and* the scene-graph node
  id. A row, a canvas node and a source span are one identity with no lookup in
  between — the identity mapping the design notes claim.
- **D4 comes free.** "The address space covers authored source spans only" is
  restated rather than enforced a second time: generated content is not in
  `doc.tree`, so it cannot be dragged, because it is not there.
- **It is already how the outline works.** This moves and extends a working
  path rather than introducing a second source of truth beside it.

**The cost, stated plainly:** when instances land (F3), an `<Instance>`'s
generated children will not appear as rows, because they are not in the
document. Figma shows them, greyed and locked. Adding them later means reading
those rows from the graph and marking them non-draggable — a deliberate
addition, not something inherited. Showing authored structure by default is the
right default for a tool whose file is the source of truth.

### Scope: full Figma, minus creation

The tree navigates, toggles visibility, renames, and drags to reorder and
reparent. That pulls **D3** forward out of Phase 3b and adds **rename**, which
[properties-panel.md](../../properties-panel.md) had parked in Epic D on the
grounds that it "moves every address beneath it, so it is a structural op".

Not in scope: the creation toolbar (D1), delete (D2), multi-select, and C7's
unset properties. No tool is drawn that does nothing.

### What is already built, and what is not

Verified against the source rather than assumed, because it changes the size of
this job substantially:

| Capability | State |
|---|---|
| `set` / `add` / `remove` property ops | **built** — `patch.ts` |
| `insert-node` / `remove-node` / `move-node` | **built** — `patch.ts`, all three dispatched and implemented |
| Rename | **built** — a `set` op on `name` (`patch.ts:216` names it explicitly) |
| Sibling-name uniqueness on write | **built** — `assertStillValid` re-parses and rejects |
| Patch transport | **built and op-agnostic** — the server applies whatever ops the envelope carries |
| `fromSceneChange` for structural events | **not built** — property changes only |
| SDK layer-tree primitives | **available** — `LayerTreeRoot`, `LayerTreeItem`, `buildLayerTreeModel`, `useLayerDrag`, `useLayerTree`, `useInlineRename`, `visibleLayerRows` |
| SDK inspector primitives | **available** — `PropertySectionRoot/Header/Content`, `PropertyGridRoot`, `SegmentedControlRoot/Item`, `NumberFieldRoot` |

The structural write path exists end to end. What is missing is the UI and the
decision about how a gesture becomes a patch — which is the previous section.

The SDK primitives are **headless**: they carry behaviour and state and no
appearance whatsoever. Every pixel of the Figma look is CSS written here.

## Architecture

### Shell

`App.vue` holds a three-column grid with fixed 240px rails and the canvas
taking the remainder. Fixed rather than fluid, because Figma's rails do not
stretch and a constant width is half of why its rows read as dense.

`createEditor` / `provideEditor` move from `CanvasPane.vue` up into `App.vue`.
The layers rail is a sibling of the canvas and cannot inject an editor provided
inside it. The canvas consumes it exactly as it does now.

The top bar keeps every piece of state it carries today — file name, revision,
selected address, connection status, the `open` link — restyled.

### `layer-rows.ts` — the pure layer

A new module, `packages/viewer/src/layer-rows.ts`, is the whole of the tree's
judgement, testable without Vue or a canvas:

```ts
export interface LayerRow {
  /** 'Button/Primary#container/label' — the patch target and the scene id. */
  address: string
  name: string
  element: UidxElement
  depth: number
  hasChildren: boolean
  /** From the `visible` attribute, defaulting true when unset. */
  visible: boolean
}

export function layerRows(doc: UidxDocument, expanded: ReadonlySet<string>): LayerRow[]
export function remapAddresses(oldPrefix: string, newPrefix: string, addresses: Iterable<string>): string[]
/** 'above' | 'below' | 'into' — the three drops a layer tree offers. */
export type DropInstruction = 'above' | 'below' | 'into'

export function moveFor(
  doc: UidxDocument,
  dragged: string,
  target: string,
  instruction: DropInstruction,
): UidxPatch | null
```

`layerRows` subsumes the flattening `PropertiesPane.vue` does today; the
properties pane stops owning an outline. `moveFor` returns `null` for a refused
drop, which is where the three guards live.

### Row anatomy

`[chevron][type icon][name]……[eye]`, indented per depth, the eye appearing on
hover or whenever the node is hidden.

Type icons are inline SVG bundled in the app — not an icon font and not a CDN,
because G7 forbids network calls at runtime for the same reason the canvas
vendors CanvasKit's wasm.

### State and selection

Expand/collapse is keyed by address and held in the pane, so a save does not
collapse the tree.

Selection stays owned by `App.vue`, as it is now. Clicking a row selects the
canvas node; selecting on the canvas expands the row's ancestors and scrolls it
into view. Single-select only — the C6 spec keeps multi-select out until there
is a mixed-value model, and nothing here changes that.

### Writes from the tree

| Gesture | Patch |
|---|---|
| Eye, on a node declaring `visible` | `set visible` |
| Eye, on a node that does not | `add visible false` |
| Rename | `set name` |
| Drag to reorder or reparent | `move-node` |

**Rename is the sharpest edge in this design.** Addresses are name paths, so
renaming `container` moves every descendant address with it — and both the
selection and the expanded-set are keyed by address. Both need prefix-remapping
the moment the rename commits. That is `remapAddresses`, one pure function with
its own tests, and it is the single most likely source of a subtle bug in this
work.

A colliding sibling name is refused by the patcher already. The UI refuses it
inline before the write, so the author sees it on the row rather than as a
rejection banner arriving after the fact.

**Drag guards**, all three returning `null` from `moveFor`: `<Page>` cannot
move; a node cannot be dropped into its own descendant; the sole child of a
`<Component>` cannot be dragged out. The patcher enforces the last one; the UI
disables it so the patch never has to throw.

### Inspector

C6 as its plan already specifies — `prop-ui.ts` in `@uidx/schema` with both
drift tests, `editable.ts` reading control kinds from the table instead of
guessing them from the runtime type of the authored value, `PropertyField.vue`,
and `PropertiesPane.vue` laying out sections, paired rows and enum controls.

Two amendments:

1. The outline moves out to the layers rail; `PropertiesPane.vue` becomes only
   the inspector.
2. Its markup takes the visual system below rather than the plan's minimal
   styling.

Section order is the spec's: Position, Auto layout, Layout child, Appearance,
Fill, Stroke, Typography, Effects — each rendered only when the selected
element has an applicable property.

### Visual system

One token layer, `packages/viewer/src/theme.css`: palette, type scale, row
heights, indent step, radii, spacing, selection accent. Every component consumes
tokens and **no component contains a raw hex value.** That is what makes "close
to Figma" reviewable — one small file to diff against the reference instead of
colours scattered across six components.

UI type reuses the Inter faces already vendored for canvas text from
`@open-pencil/core/assets`, so the chrome adds no font fetch and the viewer
stays offline-clean.

The `:root` block currently in `App.vue` is replaced, not extended, and the
monospace status-bar styling goes with it.

Exact values are set during implementation and calibrated against the reference
screenshot. They are deliberately not asserted here from memory; the token file
is the artifact to review.

## How this gets verified

The render path cannot be driven headlessly (spike S1), so the split is C5's,
which worked: judgement in pure modules tested properly, `.vue` files thin, the
rest driven by hand in the running app.

- **Unit, no Vue** — `layerRows` flattening, depth, address derivation, the
  `visible` default, and a collapsed node hiding its descendants;
  `remapAddresses`; `moveFor` including all three refusals; `prop-ui.ts` drift
  and enum-domain tests.
- **Component, `@vue/test-utils`, no canvas** — rows render at depth with the
  right icon; the chevron toggles; the eye emits the expected patch for both the
  declared and undeclared cases; rename emits, and a colliding name is refused
  inline without emitting; sections render per element type; an enum offers
  exactly its legal options with no way to type a fifth.
- **Live, in the running app** — selection sync in both directions, drag-drop,
  and that one drag produces exactly one write and one changed region.

## Risks

| Risk | Handling |
|---|---|
| Rename moves every descendant address | Contained in `remapAddresses`, tested directly. The highest-value test in this spec |
| `useLayerDrag` may mutate the editor's graph on drop | A spike opens implementation. Its signature takes an `Editor` and an `onMakeChildDrop`, which suggests it applies the move itself. If it cannot be decoupled, the hitboxes are hand-rolled and nothing else in this design changes |
| Dropping intent leaves the docs describing a viewer that no longer exists | README and backlog updated in the same change, not after |
| Close visual copy is easy to drift on | Every value in one token file; no raw hex in components |

## Effect on the plan

| Story | Effect |
|---|---|
| **B3** three-pane shell | Superseded — the panes change and the intent pane is deleted |
| **C6** structured inspector | Implemented here, per its existing plan |
| **C7** unset properties | Unchanged, still next after this |
| **D3** layers pane with drag | Pulled forward out of Phase 3b |
| Rename from the panel | Was parked in Epic D; implemented here for the tree |
| **D1** creation toolbar, **D2** delete | Unchanged, still not started |
| **F3** instances | Gains a note: generated children need adding to the tree as read-only rows when instances land |

The backlog needs all seven rows written down, or it stops describing the repo.
