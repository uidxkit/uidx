# v1 property vocabulary — audit of `SceneNode`

Supersedes the property list in spec §3.3, which was drafted from memory and was
missing four properties the spec's own canonical example needed in order to
render (see [phase-0-findings §4d/§4e](phase-0-findings.md)).

Audited against `@open-pencil/scene-graph@0.14.0`. Every field of `SceneNode` is
triaged into exactly one of:

- **Mapped** — writable from `.uidx`, in `PROP_TABLE` or `IDENTITY_PROPS`
- **Excluded** — never authored; tool-owned, derived, or Figma-internal
- **Deferred** — legitimate to author eventually, but out of v1 scope

Unknown properties remain a lint warning with best-effort passthrough (§3.3), so
a deferred property still reaches the scene graph — it just is not blessed and
is not offered by the properties panel.

---

## Mapped

Distances accept numeric pixels, explicit `px`, and `rem` values. See
[Length units](length-units.md) for the controls, root font size, tokens, and
preservation rules. Unit conversion happens before the mappings below.

### Identity and geometry
| `.uidx` | `SceneNode` | Note |
|---|---|---|
| `name` | `name` | root `<Component>` takes it from frontmatter `id` ([ADR 0001](decisions/0001-node-addressing.md)) |
| `width` / `height` | same | derived under auto layout — see the write-back filter below |
| `minWidth` / `maxWidth` / `minHeight` / `maxHeight` | same | |
| `x` / `y` | same | derived under auto layout |
| `rotation` | same | |

### Appearance
| `.uidx` | `SceneNode` | Note |
|---|---|---|
| `opacity`, `visible`, `locked`, `blendMode`, `clipsContent` | same | |
| `fills`, `strokes`, `effects` | same | `Fill` needs `opacity`/`visible`, filled in by `normalizeFills` |
| `cornerRadius` | same | |
| `topLeftRadius`, `topRightRadius`, `bottomRightRadius`, `bottomLeftRadius` | same | `independentCorners` is inferred, never authored |
| `cornerSmoothing` | same | squircle factor |
| `isMask`, `maskType` | same | |

### Strokes
| `.uidx` | `SceneNode` | Note |
|---|---|---|
Strokes are authored in the **Figma `Paint` shape** with geometry as node-level
properties, and the schema layer composes the engine's `Stroke` record from both
([ADR 0002](decisions/0002-fidelity-to-figma-and-css.md)):

```jsx
strokes={[{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }]}
strokeWeight={2}
strokeAlign="INSIDE"
```

| `.uidx` | `SceneNode` | Note |
|---|---|---|
| `strokes` | `strokes` | authored as Figma `Paint[]`; `type` is dropped, `Stroke` has no such field |
| `strokeAlign` | `Stroke.align` | node-level in the file, per-stroke in the engine. Defaults to `INSIDE`, matching Figma's getter and the CSS border model |
| `strokeWeight` | `Stroke.weight` + `border*Weight` | the stroke's own weight *and* the four per-side weights that drive layout |
| `strokeTopWeight` / `strokeRightWeight` / `strokeBottomWeight` / `strokeLeftWeight` | `border*Weight` | rename, for independent per-side weights; overlaps `strokeWeight` last-writer-wins |
| `strokeCap`, `strokeJoin`, `dashPattern` | `Stroke.*` and node-level | folded into each stroke |
| `strokeStartCap`, `strokeEndCap` | `VectorNetwork.vertices[].strokeCap` | Independent open-path caps; composed after `vectorPaths`, inherit `strokeCap` when omitted. Only explicit endpoint edits write these attributes back. |
| `strokeMiterLimit`, `strokesIncludedInLayout` | same | |

**Limitation:** `Stroke` carries a flat `color` and no `type`, so gradient and
image strokes cannot be represented. Solid strokes only.

### Auto layout
| `.uidx` | `SceneNode` | Note |
|---|---|---|
| `layoutMode` | same | `GRID` deferred |
| `primaryAxisSizingMode` / `counterAxisSizingMode` | `primaryAxisSizing` / `counterAxisSizing` | Figma `AUTO`/`FIXED` ⇄ `HUG`/`FIXED`. **Without these nothing can hug** |
| `primaryAxisAlignItems` / `counterAxisAlignItems` | `primaryAxisAlign` / `counterAxisAlign` | rename |
| `itemSpacing`, `counterAxisSpacing`, `layoutWrap` | same | |
| `counterAxisAlignContent`, `itemReverseZIndex` | same | |
| `padding{Left,Right,Top,Bottom}` | same | |
| `layoutPositioning`, `layoutGrow` | same | how a child sits in its parent's layout |
| `layoutAlign` | `layoutAlignSelf` | rename |
| `constraints` | `horizontalConstraint` + `verticalConstraint` | one object to two fields |

### Text
| `.uidx` | `SceneNode` | Note |
|---|---|---|
| `characters` | `text` | rename |
| `fontSize`, `fontFamily`, `italic` | same | |
| `fontWeight` | `fontWeight` | `"BOLD"` ⇄ `700` |
| `textAutoResize` | same | defaults to `NONE`; **auto-width text needs `WIDTH_AND_HEIGHT`** |
| `textAlignHorizontal`, `textAlignVertical` | same | |
| `textDirection` | same | `AUTO` (default), `LTR`, or `RTL` |
| `textCase`, `textDecoration`, `textTruncation`, `maxLines` | same | |
| `letterSpacing`, `lineHeight` | same | |

### Vector
| `.uidx` | `SceneNode` | Note |
|---|---|---|
| `vectorPaths` | `vectorNetwork` | `[{ windingRule, data }]` with an SVG `d`, via `parseSVGPath`. **One-way** |
| `arcData` | same | ellipse start/end sweep |

---

## Excluded — never authored

**Tree and identity.** `id`, `type`, `parentId`, `childIds` — the JSX structure
*is* this information; duplicating it into attributes would create two sources of
truth that can disagree.

**Layout output.** `fillGeometry`, `strokeGeometry`, `independentCorners`,
`independentStrokeWeights`, `figmaDerivedLayout`. Computed from authored input.
`x`/`y`/`width`/`height` are mapped but filtered on write-back when the node sits
in an auto-layout parent — the file must never accumulate reflow results
(measured in [findings §4](phase-0-findings.md)).

**Render caches.** `textPicture`, `figmaDerivedTextGlyphs`.

**Editor and library state.** `expanded`, `autoRename`, `internalOnly`,
`publishId`, `overrideKey`, `sharedSymbolVersion`, `publishedVersion`,
`isPublishable`, `isSymbolPublishable`, `symbolDescription`, `symbolLinks`,
`componentKey`, `sourceLibraryKey`, `pluginData`, `pluginRelaunchData`. Figma
workspace concerns, not design intent.

**`.fig` provenance.** `source` — round-trip fidelity for imported files, owned
by the importer.

**Shapes outside the whitelist.** `pointCount`, `starInnerRadius` (STAR/POLYGON),
`booleanOperation` (BOOLEAN_OPERATION). Excluded only as long as §3.3's element
whitelist excludes them; adding an element should revisit this row.

---

## Deferred

| Area | Fields | Why |
|---|---|---|
| Shared styles | `fillStyleId`, `strokeStyleId`, `textStyleId`, `effectStyleId`, `gridStyleId`, `sharedStyleType` | belongs with the Phase 5 token work; needs a story for referencing a style by name |
| Variables | `boundVariables`, `variableModes` | same — token binding is Phase 5 |
| Components | `componentId`, `overrides`, `componentProperty*`, `variantPropSpecs` | needs `<Instance>`, which is Phase 5 |
| Grid layout | `gridTemplateColumns`, `gridTemplateRows`, `gridColumnGap`, `gridRowGap`, `gridPosition` | `layoutMode: 'GRID'` is out of v1 |
| Rich text runs | `styleRuns`, `fontVariations`, `fontFeatures`, `textDecorationStyle`, `textDecorationThickness`, `textDecorationFills`, `textDecorationSkipInk`, `textUnderlineOffset`, `leadingTrim` | `characters` is a plain string in v1; per-run styling needs a different representation and would change the `<Text>` shape |
| i18n | `textLanguage` | no story yet |
| Frame guides | `layoutGrids` | useful for pages, marginal for components |
| Export | `exportSettings` | belongs with `.fig` export |
| Transform | `flipX`, `flipY` | Figma expresses these through the transform matrix; needs a decision on which spelling wins |
| Vector editing | `handleMirroring` | `vectorPaths` is one-way in v1, so nothing can author it |

---

## Gaps in the other direction

Properties Figma exposes that `SceneNode@0.14.0` has no field for, so `.uidx`
cannot express them regardless of vocabulary:

- **`paragraphSpacing` / `paragraphIndent`** — no fields. Worth raising upstream.
- **Gradient and image strokes** — `Stroke` has a flat `color` and no `type`.

Two earlier entries here were resolved rather than escalated:

- **`strokeAlign` was not actually missing.** It lives on each `Stroke`
  (`Stroke.align`), not on the node, which an initial read of `SceneNode` missed.
  It is now mapped as a node-level property per ADR 0002.
- **`FILL` sizing is closed, not deferred.** A child that fills its parent is
  expressed with `layoutGrow`, which is both Figma's way and the direct analogue
  of CSS `flex-grow`. Adding the axis-absolute
  `layoutSizingHorizontal`/`layoutSizingVertical` spelling would expose `FILL`
  directly but drift from Figma's own `primaryAxisSizingMode` pair, so it stays
  out.

---

## Maintenance

`IDENTITY_PROPS` and `PROP_TABLE` in
[`packages/schema/src/prop-table.ts`](../packages/schema/src/prop-table.ts) are
the executable form of this document. A test asserts every `PROP_TABLE` entry has
round-trip coverage, so adding a mapping without a test fails the suite. When
upgrading `@open-pencil/*`, re-run this audit against the new `SceneNode` before
anything else.
