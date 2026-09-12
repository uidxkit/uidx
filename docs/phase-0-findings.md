# Phase 0 — SDK spike findings

Verified against `@open-pencil/{core,vue,scene-graph}@0.14.0` on 2026-08-15.
Reproduce with `pnpm spike` (Node 22.15.0, see `.nvmrc`) and the probes in `spike/src/App.vue`.

## Verdict: GO

Criteria (b), (c) and (d) from spec §12 pass. Criterion (a) is unverified in the
headless harness for an environment reason documented below, not an SDK one.

| # | Criterion | Result |
|---|---|---|
| a | Renders | **Pass** in a foreground browser — see §5 for the harness caveat |
| b | Property edits emit node id + changed props | **Pass** |
| c | Component fragment in a minimal document wrapper | **Pass** |
| d | Structural mutations observable with parent + index | **Pass, with a derivation** |

The fallback contemplated in spec §13 ("diff workspace reactive state per animation
frame") is **not needed**. The event stream is granular enough as-is.

---

## 1. Spec correction: `useDocumentWorkspace()` is the wrong API

Spec §4.4, §7 and §12 all name `useDocumentWorkspace()` as the source of canvas
state. It is not. Its real signature is a document *library* composable:

```ts
useDocumentWorkspace<Item>(options: { source, refreshInterval?, refreshOnFocus?, ... }): {
  documents: Ref<readonly Item[]>; loading; error; previewUrls; refresh(); loadPreview(id); ...
}
```

That is a recent-files gallery with thumbnails — no scene graph, no mutations.

The actual editing surface is:

- `createEditor(options?: { graph?: SceneGraph, getViewportSize?, loadFont?, ... })` from `@open-pencil/core/editor`
- `provideEditor(editor)` / `useEditor()` from `@open-pencil/vue`
- `useCanvas(canvasRef, editor, options?)` for rendering
- `useEditorEvent(name, handler)`, or `graph.onNodeEvents(handlers)` for mutations
- `useNodeProps`, `useSelectionState`, `useLayout`, `useLayerTree`, `useLayerDrag` for panels

**`@open-pencil/core` is a required peer dependency** of `@open-pencil/vue` and is
not mentioned anywhere in the spec. §4.2's claim that `@uidx/schema` is "the only
package that imports `@open-pencil/scene-graph`" still holds, but the viewer needs
`core` too.

## 2. Mutation events (criteria b and d)

`SceneGraphEvents`, the whole surface:

```ts
'node:created':        (node: SceneNode) => void
'node:updated':        (id: string, changes: Partial<SceneNode>) => void
'node:previewUpdated': (id: string, changes: Partial<SceneNode>) => void
'node:deleted':        (id: string) => void
'node:reparented':     (nodeId: string, oldParentId: string | null, newParentId: string) => void
'node:reordered':      (nodeId: string, parentId: string, index: number) => void
```

Observed, editing `paddingLeft` on the auto-layout frame:

```
node:updated  container  { paddingLeft: 23 }
```

Exactly `(nodeId, changedProps)` — the signature `fromSceneChange` already assumes.

Structural probes:

```
createNode('RECTANGLE','container')  -> created    { id:'0:7', type:'RECTANGLE', parentId:'container' }
reorderChild(label,'container',0)    -> reordered  { nodeId, parentId:'container', index:0 }
reparentNode(icon,'primary-button')  -> reparented { nodeId, oldParentId, newParentId }
deleteNode('0:7')                    -> deleted    { id:'0:7' }
```

`created` and `reparented` carry the parent but **not the index**. The node is
already linked into the graph when the handler runs, so the index is recoverable
synchronously via `graph.getChildren(parentId).indexOf(id)`. Note that a
drag-to-reparent will likely emit `reparented` *then* `reordered`; `move-node`
must coalesce that pair into one patch.

## 3. Gesture batching is already in the SDK

The most valuable finding. Ten preview frames followed by a commit:

```
duringGesture: { previewUpdated: 10 }        // zero 'updated'
onCommit:      [{ updated, id:'container', keys:['paddingLeft'] }]
```

`runPreviewUpdates()` / `updateNodePreview()` emit **only** `previewUpdated`;
`updateNode()` emits `updated`. Spec §6.3's client-side gesture state machine
reduces to: **ignore `previewUpdated`, patch on `updated`.** Phase 3's exit
criterion (5-second drag ⇒ one file write, one-line diff) falls out for free.

## 4. Auto-layout reflow contaminates the change stream

**This is the one finding that adds work.** A single `paddingLeft` edit on the
container produced *three* `node:updated` events:

```
node:updated  container               { paddingLeft: 23 }
node:updated  container/leading-icon  { x:-8.5, y:42,  width:16,  height:16 }
node:updated  container/label         { x:15.5, y:0,   width:100, height:100 }
```

The last two are Yoga reflow output, not authored intent. A naive
`fromSceneChange` would write computed `x`/`y`/`width`/`height` onto every sibling
on every padding tweak — fatal to G3's one-line diff.

`@uidx/schema` therefore needs a **derived-property filter**: for a node whose
parent has `layoutMode !== 'NONE'`, `x`/`y` are never authored, and
`width`/`height` are only authored when the corresponding axis sizing is FIXED.
Spec §4.2's `fromSceneChange(nodeId, changedProps)` also needs to become
burst-aware — one user action is a *set* of node changes, not one.

## 4b. What actually painted — two gaps in the v1 format

Confirmed visually in Chrome: the `container` FRAME paints with the exact fill
(`r:0.1 g:0.4 b:0.9`) and a visibly rounded `cornerRadius: 8`, auto-layout
hug-sizing itself around its children. Skia rendering, fill mapping, corner
geometry and layout all work.

Neither child is visible, for two separate reasons:

**Text has no glyphs.** The TEXT node paints nothing and collapses to a default
100x100 box — exactly the `{ width: 100, height: 100 }` seen in the reflow burst
in §4.

The obvious fix is wrong. `EditorOptions.loadFont` looks like the hook but **is
never called**, verified by instrumenting it and watching a successful render.
`useCanvas` loads fonts through the renderer instead:

```js
loadFonts: () => surface.getRenderer()?.loadFonts(surface.renderNow)
```

so glyph supply goes through `SkiaRenderer.loadFonts` and core's own font
machinery (`@open-pencil/core/text/web-fonts`), not through the editor option.
For G7 the viewer needs a custom provider/`WebFontFetch` pointed at the Inter
TTFs that `@open-pencil/core` already ships in `assets/` — bundled fonts exist,
the wiring is the open question.

**`<Vector>` has no way to express geometry in the v1 grammar.** §3.3 whitelists
`Vector`, but the §3.3 property vocabulary lists nothing that carries path data —
no `vectorNetwork`, no `fillGeometry`, no SVG `d`. A `<Vector>` written today
therefore parses, maps to a VECTOR node, and paints nothing at all. Two options:
add a geometry-bearing prop to the grammar (`vectorNetwork` is a nested structure
that the JSON5 value grammar can already express), or drop `Vector` from the v1
whitelist until there is a way to author it. Leaving it whitelisted-but-invisible
is the worst of the three.

## 4c. Generated content is outside the address space

Creating a single instance emits **four** `node:created` events — the INSTANCE
plus a full clone of the main component's subtree:

```
created  0:3  INSTANCE  button-1      parent: row
created  0:4  FRAME     container     parent: 0:3   <- generated
created  0:5  VECTOR    leading-icon  parent: 0:4   <- generated
created  0:6  TEXT      label         parent: 0:4   <- generated
```

Generalising this together with the layout reflow of §4, there is **one rule**,
not two special cases:

> The UIDX address space covers **authored source spans only**. Anything the
> scene graph derives — reflowed geometry, instance children — must never
> produce a patch.

Note the id asymmetry: nodes parsed from the file have `address === scene id`, so
the bimap is free (§6). Generated nodes get SDK ids (`0:4`), so they are exactly
the population the bimap deliberately holds *no* entry for. "Not in the bimap"
is therefore a sound test for "not patchable".

`Instance` is not in the v1 whitelist (§3.3) and cross-file instances are a
non-goal (§2), so none of this can arise yet. Repetition in v1 is duplicated
subtrees with unique sibling names — `row/button-1/label`, `row/button-2/label`
— which addressing handles cleanly at the cost of real duplication.

## 4d. Why the rendered button looked wrong — three separate causes

The first render showed a blue square with only one visibly rounded corner.
Chasing that turned up three independent defects, worth recording because each
would have been attributed to the wrong layer.

**1. It was cropped, not square.** The component sits at the scene origin and the
viewport starts at pan 0,0 / zoom 1, so the component's top-left fell outside the
canvas and only its bottom-right corner was visible. `editor.zoomToFit()` after
the graph is installed fixes it. The viewer needs this on load *and* after every
`replaceGraph`.

**2. The layout engine never ran.** `createNodeWithId` writes layout properties
but does not lay anything out, so every frame kept its default 100x100 size
regardless of its children. The pass is explicit:

```ts
import { computeAllLayouts } from '@open-pencil/core/layout'
computeAllLayouts(graph, rootId)
```

`toSceneGraph` now calls it, so consumers cannot forget. Note this pulls
`@open-pencil/core` into `@uidx/schema` alongside `scene-graph`.

**3. The format could not express "hug contents".** Even with layout running the
frame stayed 100x100, because `layoutMode` alone does not make a frame hug — axis
sizing is a separate property that defaults to FIXED. The §3.3 property
vocabulary has no entry for it, so the single most common auto-layout setting for
a button was **unwritable**.

Added `primaryAxisSizingMode` / `counterAxisSizingMode` (Figma's `AUTO`/`FIXED`,
mapped to SceneNode's `HUG`/`FIXED`). Figma's newer axis-absolute
`layoutSizingHorizontal`/`Vertical` were rejected because their meaning depends
on `layoutMode`, which would make the conversion order-sensitive. **Spec §3.3
needs these two names added to the property vocabulary.**

With all three fixed the component measures 156 x 124:
`16 (icon) + 8 (gap) + 100 (label) + 16 + 16 (padding) = 156`.

## 4e. Making the label and the icon actually appear

Both children rendered as nothing, for two more reasons — and in both cases the
missing piece was a property the format could not express.

**The label needed `textAutoResize` and a registered font.** `SceneNode.textAutoResize`
defaults to `'NONE'`, so a TEXT node keeps a fixed 100x100 box no matter what its
glyphs are — that, not the font, was why the label measured 100x100. Auto-width
text is `'WIDTH_AND_HEIGHT'`, which §3.3 had no entry for.

Supplying glyphs took three attempts, and the two failed ones are worth
recording because both *looked* like they worked.

1. **`EditorOptions.loadFont` is never called.** Verified by instrumenting it and
   watching a successful render.
2. **Registering into the renderer's `TypefaceFontProvider` works, then stops.**
   `loadFonts()` does `fontProvider?.delete()` and builds a fresh provider,
   repopulating it from `fontManager`. It runs on every `createSurface` — that
   is, on resize and on remount — so any direct registration is silently
   discarded. The failure mode is deceptive: text keeps *measuring* correctly
   (the measurer is a separate path), so layout stays right and only the glyphs
   disappear. A correctly-sized button with an invisible label.
3. **`fontManager` is the authority.** Seeding it covers every provider it ever
   attaches:

```ts
import { fontManager } from '@open-pencil/core'

fontManager.markLoaded('Inter', 'Regular', bytes)   // DEFAULT_FONT_FAMILY is 'Inter'
fontManager.setHostFontLoader(async (family, style) => localBytesFor(style))
```

This must run **before** mount: `useCanvas` calls `loadFonts()` on mount, which
asks `fontManager` for Inter Regular, and seeding after that is too late for the
first paint.

Doing it this way also fixes something the provider-level hack never did — the
SDK's own chrome (component labels, ruler text) draws from the same manager, so
those were unrendered too and nobody had noticed.

The Inter faces ship inside `@open-pencil/core/assets`, so G7 needs no network
and no third-party font licensing.

**`<Vector>` needed `vectorPaths`.** It reserved its 16px of layout space and
painted nothing, because §3.3 whitelists the element but lists no property
carrying path data. The Figma-faithful spelling is `vectorPaths` — an array of
`{ windingRule, data }` where `data` is an SVG `d` string — which stays inside
the JSON5 value grammar and converts via `parseSVGPath` from
`@open-pencil/scene-graph/parse-path`:

```jsx
<Vector name="leading-icon" width={16} height={16}
  vectorPaths={[{ windingRule: 'NONZERO', data: 'M3 8 L7 12 L13 4 L11 2 L7 8 L5 6 Z' }]}
  fills={[{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }]} />
```

Mapped one-way for v1: reconstructing a `d` string from a `VectorNetwork` is
lossy, and v1 ships no vector editing tools (§7), so nothing on the canvas can
originate a geometry change. `fromScene` returning undefined keeps the write-back
path away from it entirely.

With these the component measures **124 x 44** — `16 + 8 + 68 + 32` wide,
`20 + 24` tall — and renders as an actual button: white check icon, white bold
label, blue rounded rect. Every byte of it comes from `examples/primary-button.uidx`.

### Four properties the spec is missing

Rendering the canonical example correctly required four props §3.3 does not list:
`primaryAxisSizingMode`, `counterAxisSizingMode`, `textAutoResize`, `vectorPaths`.
That the *spec's own example* could not render without them is the strongest
evidence that the v1 vocabulary was drafted from memory rather than against the
scene graph.

## 5. Rendering (criterion a) — the harness caveat

`useCanvasKitLoader.init()` does:

```js
setCanvasKit(await getCanvasKit());
await new Promise(resolve => requestAnimationFrame(resolve));   // <- blocks here
createSurface(canvas);
```

In the embedded browser first used for this spike, `document.visibilityState ===
'hidden'` and `requestAnimationFrame` never fires, so `init()` parks forever and
no renderer is created. Everything before that point succeeds: the wasm serves as
`application/wasm` with a valid magic word, and WebGL2 is available
(`WebKit WebGL`).

Confirmed to be a harness artifact only: in a foreground Chrome window the same
build renders correctly (§4b). Any future headless/CI screenshot test of the
viewer will hit this same wall and needs a browser run with a visible or
explicitly-foregrounded page.

### Offline (G7): CanvasKit wasm must be vendored

`canvaskit.wasm` (7.1 MB) is fetched at runtime from `/canvaskit.wasm`. Vite's SPA
fallback served `index.html` for it until the file was copied into `public/`,
producing `expected magic word 00 61 73 6d, found 3c 21 64 6f`. `@uidx/viewer`
must ship the wasm as a static asset. `getCanvasKit({ locateFile })` allows
relocating it.

Text rendering additionally needs `EditorOptions.loadFont` — a network-free font
strategy is required for a genuinely air-gapped build.

## 6. Name-path addressing maps directly onto scene node ids

`createNodeWithId(address, type, parentId, overrides)` accepts UIDX name-paths
verbatim. The fixture's scene ids are literally `primary-button`, `container`,
`container/leading-icon`, `container/label`.

So the scene-id ⇄ address bimap of §4.2 is the **identity function** for
everything parsed from the file. Only canvas-created nodes (which get SDK ids
like `0:7`) need a real mapping entry, and only until the next round-trip.

Open spec question this surfaces: §3.4 says `Component`'s name is the frontmatter
`id`, but §3.4's examples root addresses at its child (`container/label`). Pick
one before the parser is written.

## 7. `SceneNode` is flat and near-Figma — the PROP_TABLE is small

`SceneNode` is a flat struct, so §10's open question about "text style location
(node-level vs. nested style object)" resolves to **node-level**. Identity
mappings cover `name`, `width`, `height`, `rotation`, `opacity`, `visible`,
`cornerRadius`, `fills`, `strokes`, `effects`, `itemSpacing`, `padding*`,
`layoutMode`, `fontSize`.

Real deltas for `PROP_TABLE`:

| UIDX (Figma vocabulary) | SceneNode | Note |
|---|---|---|
| `primaryAxisAlignItems` | `primaryAxisAlign` | rename |
| `counterAxisAlignItems` | `counterAxisAlign` | rename |
| `characters` | `text` | rename |
| `fontWeight="BOLD"` | `fontWeight: 700` | string ⇄ number; use `styleToWeight`/`weightToStyle` |
| `strokeWeight` | `borderTop/Right/Bottom/LeftWeight` | 1 ⇄ 4; `fromScene` must decide when to collapse |
| `constraints: {horizontal, vertical}` | `horizontalConstraint` / `verticalConstraint` | 1 ⇄ 2 |
| `fills: [{type, color:{r,g,b,a}}]` | `Fill` also requires `opacity`, `visible` | shape delta |

All six whitelisted UIDX elements map 1:1 onto `NodeType`: `COMPONENT`, `FRAME`,
`TEXT`, `RECTANGLE`, `ELLIPSE`, `VECTOR`.

## 8. OpenPencil has its own JSX dialect — deliberately not ours

`@open-pencil/core/design-jsx` exposes a JSX runtime whose intrinsics are
**lowercase** (`frame`, `text`, `component`, plus `line`, `star`, `polygon`,
`group`, `section`, `instance`) over a Tailwind-ish shorthand prop set
(`bg`, `p`, `gap`, `rounded`, `w`, `flex="row"`). `@open-pencil/core/io/formats/jsx`
exports `sceneNodeToJSX(nodeId, graph, 'openpencil' | 'tailwind')`.

This is **not** a drop-in for `@uidx/format`: it is lossy authoring shorthand with
an `[key: string]: unknown` escape hatch, function components, and no source
positions. UIDX's explicit, statically-evaluable, position-tracked dialect stays.

The casing difference is load-bearing and the spec's choice is correct: in MDX a
lowercase tag is an HTML element and a capitalized one is a component, so
`<Frame>` is *required*. Worth stating explicitly in §3.3 so it is not "fixed"
later for consistency with OpenPencil.

`sceneNodeToJSX` remains useful for a future `.fig` → `.uidx` importer.

## 9. Build note for `@uidx/viewer`

`@open-pencil/yoga-layout` initialises its WASM with a top-level await, which
esbuild rejects under Vite's default dep-optimizer target. Required in the
viewer's `vite.config.ts`:

```ts
esbuild:      { target: 'esnext' },
optimizeDeps: { esbuildOptions: { target: 'esnext' } },
build:        { target: 'esnext' },
```

Also note `@open-pencil/scene-graph` declares a `"bun"` export condition pointing
at `./src/index.ts`, but `files` only publishes `dist` — running the server or CLI
under the Bun *runtime* would resolve to a nonexistent file. Use Node (or pnpm +
Node) for `@uidx/server` and `@uidx/cli`.
