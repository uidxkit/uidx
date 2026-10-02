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

## Instances: the outer box (ADR 0018)

An `<Instance>` is a black box with a styleable outer box. Every attribute
written on one has exactly one role, and
[`packages/schema/src/instance-box.ts`](../packages/schema/src/instance-box.ts)
is the one copy of the table: the renderer, the panel, `uidx check`, codegen,
detach and the agent all read it.

| Role | Attributes | Where it lands |
|---|---|---|
| Structural | `component` `props` `overrides` `modes` `name`, the bindings any node carries (`repeat` `as` `part`), and `implements` and `rootFontSize`, which belong on a component and a page and do nothing on an instance | read by the expansion |
| Placement | `x` `y` `right` `bottom` `centerX` `centerY` `rotation` `constraints` `layoutPositioning` `layoutGrow` `layoutAlign` `width` `height` `minWidth` `maxWidth` `minHeight` `maxHeight` `primaryAxisSizingMode` `counterAxisSizingMode` `visible` `locked` `blendMode` `isMask` `maskType` | the instance's own node |
| Box | `fills` `strokes` `strokeWeight` `strokeAlign` `dashPattern` `strokeTopWeight` `strokeRightWeight` `strokeBottomWeight` `strokeLeftWeight` `cornerRadius` `topLeftRadius` `topRightRadius` `bottomRightRadius` `bottomLeftRadius` `cornerSmoothing` `opacity` `effects` `paddingTop` `paddingRight` `paddingBottom` `paddingLeft` | the box node |
| Cascade | `textFills` | every text the component draws |
| Locked | everything else: the layout (direction, gap, alignment, wrap, clipping), stroke caps, joins and miter, every text and vector property | nowhere: every target ignores it, and `uidx check` warns (UIDX154) |

```mdx
<Instance name="cancel" component="Button" props={{ label: 'Cancel plan', variant: 'secondary' }}
  fills="{surface#control}" strokes="{border#focus}" strokeWeight={2}
  cornerRadius="{radius#full}" paddingLeft="{space#lg}" paddingRight="{space#lg}"
  textFills="{text#danger}" />
```

**The box node** is where a use's box lands, chosen by the component's
structure (`boxTargetOf`). A stated `width` or `height` lands on the same node,
so size and look always go together:

- the one frame a wrapper-shaped component wraps: a styles table's derived
  `root`, an authored variant's frame, or the laid-out frame of a bare
  `<Component>`;
- the one instance a composition holds, as CheckboxField holds Field, which
  takes the box, `textFills` and the size as if it had stated them, over
  whatever the definition wrote on it;
- otherwise the instance's own node, for a component that lays itself out;

and from there, through any frame that only wraps another: one that lays out
a single frame or instance and hugs it, with no padding, paint, opacity or
clip of its own. The Shoelace example's Button draws its look on its `base`
part, inside a frame of its own like that, so `base` is its box. What a state
row sets on such a frame does not count, so a state never moves the box.

On a wrapper, a fill would paint an invisible box behind the visible one, and
padding would act as a margin.

**Precedence**, lowest first: the component's base tree; its rows keyed only by
visual enums or by `state="default"`, which are its resting look; the
instance's box and `textFills`; rows keyed by any other state (a visual
boolean, `hover`, `focus`, `active` or a declared `<State>`); the hand-written
`overrides` map. So a Button made orange is orange at rest and takes its hover
row's fill on hover, and the `variant` row of a `variant="destructive"` Button
is its resting look, so a use's fill replaces it.

**Values** take a Frame's forms: a literal, or a token alias on the whole
attribute or on a paint's `color`, resolved in the consuming page's scope,
including the instance's own `modes`. A component-property or item binding
(`{label}`, `{item.tone}`) is dropped with a warning (UIDX155), and the
component's own value shows. A shorthand replaces its longhands, as in CSS: an
instance's `cornerRadius` drops the component's corner radii, and its
`strokeWeight` drops the side weights. An instance's `strokes` keeps the
component's weight, and a weight alone strokes with the component's paints.
`fills={[]}` is an explicit none, and removing the attribute is the reset.
Sizing modes are honoured when written by hand, but the editor never writes
them: a stated `width` or `height` is already Fixed on that axis. `uidx check`
also warns (UIDX155) on padding where the box does not lay out, and on
`textFills` where the component draws no text.

### `textFills`

| `.uidx` | `SceneNode` | Note |
|---|---|---|
| `textFills` | the `fills` of each `TEXT` it reaches | `<Instance>` only; anywhere else it is UIDX114. Takes a `fills` value: a `Paint[]`, or a whole-attribute colour token, which becomes one `SOLID` paint. Takes `TEXT_FILL` tokens |

It replaces the fills of every Text the component draws, at any depth,
including the texts of instances nested inside it. Where several instances
state one, the nearest wins, as CSS `color` inherits. Four things keep their
own colour: a text whose fills a state row sets, slot-fill content that states
fills of its own (content that states none inherits), anything the `overrides`
map sets, and vectors. The name says whose fills these are: in Figma a text's
colour *is* its fills (ADR 0002).

### In generated code

The components `uidx codegen` writes read their outer box through one set of
custom properties, so a use is restyled in code as it is in the file, with the
exceptions that close this section:

| Hook | Reads | Feeds |
|---|---|---|
| `--uidx-fill` | `fills` | `background-color` |
| `--uidx-stroke` | `strokes` | `border-color` |
| `--uidx-stroke-style` | `dashPattern` | `border-style`; set with any stroke a use states: `dashed`, `solid`, or `none` for an empty `strokes` |
| `--uidx-stroke-weight` | `strokeWeight` | every `border-*-width` |
| `--uidx-stroke-{top,right,bottom,left}-weight` | `strokeTopWeight` `strokeRightWeight` `strokeBottomWeight` `strokeLeftWeight` | that side's width, ahead of `--uidx-stroke-weight` |
| `--uidx-radius` | `cornerRadius` | every `border-*-radius` |
| `--uidx-radius-{top-left,top-right,bottom-right,bottom-left}` | `topLeftRadius` `topRightRadius` `bottomRightRadius` `bottomLeftRadius` | that corner, ahead of `--uidx-radius` |
| `--uidx-padding-{top,right,bottom,left}` | `paddingTop` `paddingRight` `paddingBottom` `paddingLeft` | `padding-*` |
| `--uidx-opacity` | `opacity` | `opacity` |
| `--uidx-shadow` | `effects` | `box-shadow` |
| `--uidx-text-color` | `textFills` | the `color` of every text inside |

- The base rules and the rules for visual enums read
  `var(--uidx-…, <the component's value>)`. Rules for any other state stay
  literal, so a hover rule still wins: the precedence above, in CSS.
- Every component root resets its box hooks to `initial`, so a hook set on one
  component stops at the next. `--uidx-text-color` is never reset; its
  inheritance is the cascade.
- A nested instance sets its hooks and its stated size in `style`, and so does
  a consumer of the generated React:
  `style={{ '--uidx-fill': 'var(--surface-danger)' } as CSSProperties}`.
- A generated React component whose element wraps the one instance that is
  its box keeps the consumer's whole `style` on that element — a `margin`, a
  `flex` share or a `gridArea` places the element, as on any React root — and
  hands the instance its part: the `--uidx-*` hooks, and `width`/`height` as
  `100%` where the consumer states a size, so the instance fills it as it does
  on the canvas. A composition renders as its instance and passes `style` on
  whole.
- What a component puts in the slot of an instance it holds is styled by its
  own stylesheet: a text that states fills keeps them as a literal colour,
  and one that states none reads `--uidx-text-color`, so it takes the
  nearest use's colour as it does on the canvas.
- A component over a shadow-DOM element, one whose manifest declares CSS parts
  as Shoelace's do, reads only the hooks for what its box node states, so the
  library's own styling stands for the rest. The Shoelace example's Button
  reads its fill, stroke, radius and padding hooks on `::part(base)`.
- `strokeAlign` and `cornerSmoothing` have no CSS form and stay canvas-only.
- `uidx contract` lists the placement, box and cascade attributes and the
  hooks under `instanceBox`, and says for each component where a use's box
  lands (`box`, with the `part` that node binds, if any) and whether it lays
  out (`laysOut`).

Where code still differs from the canvas:

- A CSS border takes layout space where the canvas's inside stroke does not.
- A text that states no fills draws black on the canvas, and inherits the
  page's colour in CSS until a use sets one.
- Over a shadow-DOM element, a use's box does nothing in code where the box
  node states none of it: the Shoelace example's Checkbox, Switch and Input
  draw their look inside their `base`, or their host, and state no box there,
  so a use's fill shows on the canvas and not in code.
- A composition renders as the instance it holds and has no element of its
  own to scope a rule to, so text it puts in a slot of that instance takes
  the colour around it.
- A component that `codegen.react` maps onto an existing library takes no
  hooks, which codegen warns about.

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
| Components | `componentId`, `overrides`, `componentProperty*`, `variantPropSpecs` | `<Instance>` shipped without them: it states its component, props and overrides as attributes ([Instances](#instances-the-outer-box-adr-0018)), and the build derives the variant fields |
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

[`instance-box.ts`](../packages/schema/src/instance-box.ts) is the executable
form of [Instances](#instances-the-outer-box-adr-0018).
`packages/cli/test/docs-examples.test.ts` holds that section's role and hook
tables to it (every row but Locked, which is everything else), runs
`uidx check` on every `<Instance>` the docs show, holds the Shoelace Button's
box to its `base` part on the canvas and in code, and fails once the
shadow-DOM limit those docs name is gone, so the sentences naming it go too.
