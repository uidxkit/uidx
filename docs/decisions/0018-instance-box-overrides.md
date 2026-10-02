# ADR 0018 — An instance is a black box with a styleable outer box

Status: **accepted**, 2026-10-01 (decided by the user). Part of ADR 0012.
**Amends [ADR 0012](0012-design-system-model.md)**. In §1, a concrete
component is now `render(identity, props, theme, target, box)`: the use's
outer box is a fifth input, applied beneath state. In §4, per-use overrides
now exist, limited to the outer box. Per-product theming stays deferred.
Refined 2026-10-02, before release: in §2 the box goes on through a frame
that only wraps another, and §6 says how slot content is styled in code and
where code still differs from the canvas.

## Context

A placed component could change two things: its props (F6, F7) and where it
sits. A red Delete button, a card with more padding or a pill with white text
meant one of three things. You detached the instance, or added a visual prop
and its style rows to the component, or hand-wrote `overrides` keyed by paths
inside it.

Attributes written on an `<Instance>` already parsed and rendered, but only
by accident: the instance's attributes were laid over its definition. That
went wrong in five ways:

- For a component with a styles table, or a bare `<Component>` around one
  frame, the box you see is a generated frame one level down (ADR 0016 §4's
  `root`). `fills` on the instance painted an invisible wrapper behind it.
- A lone `strokeWeight` composed with no stroke.
- `layoutMode` on an instance re-laid out the component's insides.
- No state row could win over an instance's value, so a hover style was lost
  as soon as the use set a fill.
- Code dropped all of it, which breaks ADR 0017 §4.

Text colour is the most common request, and it lives on a child layer. A
consumer may not name that layer (ADR 0003, rationale 2), and ADR 0016's
`root/` segment makes such keys break anyway.

CSS has settled this already. A consumer styles an element's box: its
background, border, radius, padding, opacity and shadow. It sets `color`,
which inherits. The component's internal layout and parts are not the
consumer's business, and the component's own `:hover` rule still applies.

## Decision

### 1. The outer box, and what stays inside

Every attribute on an `<Instance>` has exactly one role:

| Role | Attributes | Where it lands |
|---|---|---|
| Structural | `component`, `props`, `overrides`, `modes`, `name` | read by the expansion |
| Placement | `x` `y` `right` `bottom` `centerX` `centerY` `rotation` `constraints` `layoutPositioning` `layoutGrow` `layoutAlign` `width` `height` `minWidth` `maxWidth` `minHeight` `maxHeight` `visible` `locked` `blendMode` `isMask` `maskType` | the instance's own node |
| Box | `fills`; `strokes` `strokeWeight` `strokeAlign` `dashPattern` and the four side weights; `cornerRadius`, the four corner radii and `cornerSmoothing`; `opacity`; `effects`; `paddingTop` `paddingRight` `paddingBottom` `paddingLeft` | the box node (§2) |
| Cascade | `textFills` | every text drawn inside (§4) |
| Locked | everything else: `layoutMode` `layoutWrap` `itemSpacing` `counterAxisSpacing`, the alignments, `counterAxisAlignContent` `itemReverseZIndex` `clipsContent` `strokesIncludedInLayout`, stroke caps, joins and miter, every text and vector property | nowhere |

Size follows the resize decision. An instance that states `width` or `height`
is Fixed on that axis, and the frame a wrapper-shaped component wraps takes
that size. Sizing modes are honoured when written by hand, and the editor
never writes them.

The table is a plain list in `@uidx/schema` (`instance-box.ts`), exported
through a light subpath the way `known-props` is. The renderer, panel, lint,
codegen, detach and agent all read that one copy.

### 2. Where the box lands

The box node is chosen by the component's structure. The rule is the same one
that decides which node receives a stated size, so size and look always land
on the same node:

- **One wrapped frame.** A component that only wraps one frame has that frame
  as its box. This covers a styles table's derived `root`, an authored
  variant's frame, and a bare `<Component>` around a laid-out frame.
- **A composition.** A component that holds exactly one `<Instance>`, such as
  CheckboxField, passes the box, `textFills` and the stated size to that
  instance as if it had stated them itself. Where the definition also wrote
  a value on that instance, the consumer's value wins. React already does the
  same with `className` and `style`.
- **Self-laid-out.** Otherwise (ADR 0008, a component that lays itself out),
  the box is the instance's own node.

From there the box goes on through any frame that only wraps another: one
that lays out a single frame or instance and hugs it on both axes, with no
padding, no paint, no opacity and no clip of its own, so nothing of it shows.
The Shoelace example draws each look on a part inside a frame of the
component's own, as the library's shadow tree does, so a Button's box is its
`base` part; on the outer frame a fill would paint behind it. Values a state
row sets do not count, so a state cannot move the box, and a definition
change that makes such a frame paint or pad moves the box back to it. A
styles table's `root` says what its component does, so the root of a
component that states no layout or size hugs what it holds (ADR 0008), as the
component would.

When the box is a wrapped frame or a composed instance, the instance's own
node keeps only placement. Padding therefore pads the frame that lays out. On
the wrapper it would have acted as a margin.

### 3. Precedence: the use sits beneath state

For each property, from lowest to highest:

1. The component's base tree.
2. Rows keyed only by visual enums, or by `state="default"`. These are the
   component's resting look for that combination.
3. The instance's box attributes and `textFills`.
4. Rows keyed by any other `state` value. That means a visual boolean
   (`checked`), an interaction state (`hover`, `focus`, `active`) or a
   declared `<State>`, all of which are values of ADR 0016 §1's one state
   axis.
5. The hand-written `overrides` map.

ADR 0016 §2's specificity among rows is unchanged. Whichever row wins a
property decides which side of the instance that property falls on:

- An instance of Button1 that makes it red is red at rest and takes the hover
  row's blue on hover.
- A red `variant="destructive"` Button is red at rest, because the
  `variant` row is its resting look. On hover it is `surface#danger`, from
  the `state="hover" variant="destructive"` row.
- Authored `<Variant>` trees carry no rows, so the override applies over
  every variant.

Placement is outside this order. A stated size is laid over the rows, as the
resize decision says.

Mechanism: no instance re-derives its component. When `deriveVariants` writes
an attribute from a row whose keys name a non-default state, it stamps the
attribute with that state (`stateRow: 'hover'`), the way it already marks
derived nodes. A later row that wins the property replaces the attribute and
its stamp. The instance's layer skips every stamped attribute.

### 4. Text colour cascades

`textFills` replaces the fills of every Text the instance's component draws,
at any depth. That includes the texts of instances nested inside it. Where
several instances state it, the nearest one wins, as with CSS inheritance.
Four exceptions:

- A text whose fills a state row sets keeps the row's value, by §3.
- Slot-fill content that states fills of its own keeps them, because explicit
  beats inherited. Fill content that states none inherits.
- The `overrides` map still wins.
- Vectors keep their colour. The vocabulary has no styled runs. When runs
  arrive, a run whose fills come from the component is recoloured, and a run
  that states its own keeps it.

Why the name `textFills`:

- Its value is exactly a `fills` value. That is either a paint list, or a
  whole-attribute alias such as `"{text#onAccent}"`, which becomes one SOLID
  paint. It takes `TEXT_FILL` tokens.
- In Figma a text's colour *is* its fills (ADR 0002), so the name says whose
  fills these are.
- `color` is already the key inside every paint, and `textColor` would add a
  scalar colour type the format does not have.

The panel calls it Text color and writes one solid paint or one token. Code
uses the first visible solid paint, as it already does for a text.

### 5. In the file

```mdx
<Instance name="delete" component="Button1" props={{ label: 'Delete' }}
  x={328} y={360} width={199}
  fills="{surface#danger}" strokes="{border#danger}" strokeWeight={2} cornerRadius={4}
  paddingLeft="{space#lg}" paddingRight="{space#lg}" textFills="{text#onAccent}" />
```

- Each value takes the same form the property takes on a Frame: a literal, or
  a token alias on the whole attribute or on a paint's `color`. Aliases resolve
  in the consuming page's scope, including the instance's own `modes`, just as
  `overrides` do.
- A component-property or item binding (`{label}`, `{item.tone}`) is not
  allowed in these attributes, because colour reaches a component through
  visual props and rows (F6). The renderer drops such a value with a warning,
  so the component's own value shows.
- A shorthand replaces its longhands, as in CSS. An instance's `cornerRadius`
  drops the component's corner radii, and its `strokeWeight` drops the side
  weights.
- `fills={[]}` is an explicit "none". Removing the attribute is a reset.
- Locked attributes still parse, since §3.3 lets the format lead the tool, but
  every target ignores them and `uidx check` warns (UIDX154). `textFills` on
  any element other than `<Instance>` is UIDX114, the same as `component`.
- `overrides` is unchanged. It is hand-written, keyed by path and applied
  last. The editor never writes it, and never writes a locked attribute or a
  sizing mode on an instance.

### 6. Every target renders the same use

- **Scene targets.** The canvas, `uidx share`, `uidx render`, `export fig` and
  thumbnails all share one implementation in the scene build. The incremental
  path computes a generated node with the same layers a rebuild uses, so an
  edit and a reload agree.
- **Detach** bakes the result into the copy. The box goes onto the box node,
  state-won properties keep their row values, `textFills` becomes the fills
  of each text it reaches, and locked attributes are dropped.

**HTML/CSS and React.** Every generated component reads its outer box through
custom-property hooks:

| Hook | From | Feeds |
|---|---|---|
| `--uidx-fill` | `fills` | `background-color` |
| `--uidx-stroke`, `--uidx-stroke-style` | `strokes`, `dashPattern` | `border-color`, `border-style` |
| `--uidx-stroke-weight`, `--uidx-stroke-{top,right,bottom,left}-weight` | `strokeWeight`, the side weights | `border-*-width` |
| `--uidx-radius`, `--uidx-radius-{top-left,top-right,bottom-right,bottom-left}` | `cornerRadius`, the corner radii | `border-*-radius` |
| `--uidx-padding-{top,right,bottom,left}` | padding | `padding-*` |
| `--uidx-opacity` | `opacity` | `opacity` |
| `--uidx-shadow` | `effects` | `box-shadow` |
| `--uidx-text-color` | `textFills` | `color` of every text |

How the stylesheets use them:

- The base rules and the enum-only rules read `var(--uidx-…, <component
  value>)`. State-row rules stay literal, so they win on specificity. This is
  the same split as §3.
- A side hook falls back to its shorthand hook, which reproduces the
  shorthand rule in §5.
- Every component root resets its box hooks to `initial`, so they never leak
  into a nested component. `--uidx-text-color` is never reset; its
  inheritance is the cascade.
- A nested instance sets its hooks, and its stated size, in `style`.
- In React, an element that wraps the instance that is its box keeps the
  consumer's `style`, since where it sits is its own, and hands the instance
  the `--uidx-*` hooks and a stated size to fill. A composition passes
  `style` on whole.
- Over a shadow-DOM library, a box node that is the host or a `::part()`
  reads only the hooks for what the design states there, since the library
  styles the rest itself and a fallback would override it.
- What a component puts in the slot of an instance it holds is its own
  content, styled by its own stylesheet: a text that states fills keeps them
  as a literal colour, and one that states none reads `--uidx-text-color`,
  as §4 says.
- `strokeAlign` and `cornerSmoothing` have no CSS form. They stay
  canvas-only, as they already are for components.

Where code still differs from the canvas:

- A CSS border takes layout space, where the canvas's inside stroke does not.
- A text that states no fills draws black on the canvas, and inherits the
  page's colour in CSS until a use sets one.
- Over a shadow-DOM library, a use's box does nothing in code where the box
  node states none of it, as on the Shoelace example's Checkbox, Switch and
  Input, though the canvas paints it.
- A composition has no element of its own to scope a rule to, so text it puts
  in a slot of the instance it renders as takes the colour around it.
- A component that codegen maps onto an existing React library takes no
  hooks, and codegen warns.

The rest:

- **Contract JSON** lists the role table and the hooks. Each component also
  gets a `box` entry saying where the box lands, with the part that node
  binds, if any. A generator that does not read this ADR can then implement
  the same API.
- **`uidx check`** warns on a locked attribute (UIDX154), on an instance or
  written onto one by a `<Style>` row. It also warns, under UIDX155, on a box
  value that does nothing: padding where the box does not lay out,
  `textFills` where nothing draws text, or a binding.

### 7. In the editor

For a selected instance, the Design tab shows the outer box and nothing
inside it:

- Position, size, padding, appearance, fill, a new Text color section,
  stroke and effects.
- Direction, gap, alignment, wrap and clipping appear as one read-only line
  with a link to the component.

Every row shows the component's effective value, dimmed, until the use
changes it. Engine defaults never show. A stated row is marked as an
override and has a reset (↺). A section can be reset as a whole, and the
instance offers Reset all overrides, which removes the box, `textFills`
and the stated size (never position, props, slot fills or modes) in one
undo step. When the instance's own props select a state that sets a
property, that row says so.

Edits are structural patches on the `<Instance>`, never scene writes. The
node that draws the value is generated and has no address, and the
instance's own node is the wrapper. Previews run through the same functions
the build uses.

## Consequences

- An instance can be restyled in the file, in the panel and by an agent
  without touching the component. A reusable look still belongs in the
  component, as a visual prop with rows (ADR 0016).
- Box attributes on instances of wrapper-shaped components move from the
  invisible wrapper to the visible frame, through any frame that only wraps
  it, and locked attributes stop drawing. No file in this repo uses either,
  so only hand-written files change. The change is intended.
- Restyling no longer needs override keys, so it does not hit the `root/`
  segment a styles table adds to them. That breakage of ADR 0005 §3 is
  recorded here and left unfixed for `overrides` itself.
- Every generated stylesheet gains the hooks and their resets. The rendered
  output is unchanged, because each fallback is the old value. The hooks
  become the generated components' public styling API.
- A row cannot hide an override at rest. That is the point of §3's split. A
  component that must not be restyled in some state puts the look on that
  state.
- `diffDocuments` emits no generic scene update for an `<Instance>`.
  `update-instance-root` recomputes both the root and the box frame. A
  `textFills` change, or any box change on a composition, rebuilds.

## Alternatives considered

- **Per-layer overrides from the editor (F3b).** These would make an
  instance's generated layers selectable and write `overrides`. The consuming
  page would then depend on the component's internal paths (ADR 0003,
  rationale 2), the keys break when a styles table adds `root/`, and code
  cannot follow them. `overrides` stays the hand-written escape hatch.
- **Expose as a property.** The instance would write a visual enum and its
  rows into the definition. That is right for a look the system should own,
  and it remains the recommended route. It is wrong for a one-off, because
  every one-off would become a contract change on a shared component.
- **The outer frame without text colour.** This is the box alone. It cannot
  give the most-asked-for change, a label's colour, without per-layer keys.
  CSS pairs the box model with inherited `color` for exactly this reason.
- **Every active row beats the override.** This includes enum rows. An
  override would then be invisible at rest on any component whose default
  enum value has a row, for example Button's `variant` rows.
- **Re-deriving the component per instance with an extra base layer.** This
  defeats the per-definition derivation cache, multiplies trees, and makes
  detach and reconcile derive too. The stamp gives the same order for one
  attribute's worth of memory.
- **Emitting `overrides={{ root: … }}` from the editor.** Overrides apply
  above the rows, which is the wrong precedence, and the key depends on the
  synthetic `root` segment.
- **Per-component registered properties (`@property --button1-fill`).**
  These avoid resets, but they cost recent browsers and give every component
  a different API. One `--uidx-*` set with root resets works everywhere.
