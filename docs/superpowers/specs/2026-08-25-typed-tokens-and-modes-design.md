# Typed tokens, modes and scopes

2026-08-25. Approved in conversation the same day, section by section.
Backlog story: **G8**. Research behind it:
[figma-tokens-variables-review.md](../../research/figma-tokens-variables-review.md),
whose §14 records the seven product decisions this rests on.

## The problem

G5 shipped token files and alias binding and named its own gap out loud:
"Modes are deliberately deferred; note the gap rather than half-build it."
G6 made resolution live across a document. What is still missing is the reason
a design system reaches for variables at all — **one token, different values in
different contexts.** Without modes there is no light and dark, no density, no
brand; a token is just a named constant.

Two smaller gaps travel with it. A `<Variable>`'s type is **inferred** from its
value today, which cannot survive modes (a variable's type must be one fact
across every mode, not re-derived per value) and cannot be validated. And every
variable is offered for every field of its type, so a corner-radius scale and a
spacing scale are indistinguishable in the picker.

This story closes all three.

## What this rests on

Decisions taken 2026-08-25 and recorded in the research doc's §14, plus four
refinements settled while designing this:

| Decision | Source |
|---|---|
| Pure Figma-style model, chosen so `.fig` export needs no mapping layer | §14.1, and ADR 0002 |
| Explicit `type` using Figma's own enum names | §14.3 |
| Figma's 22 scopes **plus `SPACING`** | §14, revised in conversation |
| Modes written as `<Mode>` children, not a keyed object | settled while designing |
| Units deferred entirely — nothing in `packages/` parses one | revises §14.5 |
| Mode selection is authored only; no ephemeral preview | settled while designing |
| Motion types (`EASING`, `TIMING`) out of scope | §14.7 |

The units reversal is worth stating plainly, because it undoes an earlier
decision. `lineHeight` is `control: 'number'` in `prop-ui.ts`, and no module in
the workspace parses a unit string. A token holding `"1.5em"` would be
authorable, unrenderable and unexportable at once — Figma variables are
unitless too. Units are a property-layer capability; tokens can only express
them once `PROP_TABLE` can consume them. They return with their own story, and
percentage line heights return with them.

## Scope

| Area | Change |
|---|---|
| `@uidx/format` | `type` required on `<Variable>`; `modes` on `<Collection>`; new `<Mode>` element; `scopes` and `description` on `<Variable>`; `modes` attribute on scene elements and `<Page>` |
| `@uidx/schema` | `buildTokenIndex` replaces `resolveTokenValues`; `TokenResolver.resolve(tuple)` with a memoised per-tuple cache; `SCOPE_FOR_PROP` |
| `@uidx/viewer` | Mode tuple threaded through the render descent; scope-filtered picker; **Apply variable mode** control in Appearance |
| `@uidx/cli` | Eleven new diagnostics; `uidx migrate tokens` |

## Grammar — `@uidx/format`

### `<Variable type>` becomes required

`VARIABLE_TYPES` keeps its four members — `COLOR | FLOAT | STRING | BOOLEAN`.
Figma's newer `EASING` and `TIMING` are deliberately absent until motion lands.

```jsx
<Collection name="radius">
  <Variable name="sm" type="FLOAT" value={4} />
</Collection>
```

`variableTypeOf` is **not deleted**. It stops being the source of truth and
takes two new jobs: validating that a declared `type` matches the authored
value's shape, and powering the migration codemod. The inference logic was
always correct; it was only ever in the wrong position.

### `<Collection modes>` and the `<Mode>` element

Array order defines the default — leftmost wins, exactly as Figma's leftmost
column does. There is no separate `defaultMode` attribute: reordering the array
is how the default changes, which is the same gesture Figma gives you.

```jsx
<Collection name="semantic" modes={['light', 'dark']}>
  <Variable name="surface" type="COLOR" scopes={['FRAME_FILL']}
            description="Page and card background. Never for text.">
    <Mode name="light" value="{palette#white}" />
    <Mode name="dark" value="{palette#gray-900}" />
  </Variable>
</Collection>
```

**One rule makes the whole thing checkable.** A collection either declares
`modes` — and every variable in it uses `<Mode>` children — or it does not, and
every variable uses `value`. Mixing the two forms in one collection is a parse
error. A single-mode collection is therefore byte-identical to what G5 already
writes, which is what keeps the migration to one mechanical attribute.

An absent `scopes` attribute means `['ALL_SCOPES']` — a variable with no
stated scope is offered everywhere its type fits, which is Figma's default too.
An absent `description` is the empty string.

`ELEMENTS` and `TOKEN_ELEMENTS` gain `Mode`; `CONTAINER_ELEMENTS` gains
`Variable`; a new `VARIABLE_CHILD_ELEMENTS` holds `Mode` alone.

### A `<Mode>` carries no address

This is the one grammar decision that is not cosmetic. `addressOf` joins with
`/` once an address already contains `#`, so lowering a mode the ordinary way
would produce `semantic#surface/light` — indistinguishable from a real variable
named `surface/light` in the same collection. A silent address collision is the
worst kind.

Modes are not referenceable: a binding names `{semantic#surface}` and the
context decides the mode. So `<Mode>` lowers as a value carrier with a null
address, the way `<Variant>` already gets its address from something other than
a `name` attribute. **This gets an explicit regression test.**

### Node-side: the `modes` attribute

```jsx
<Frame name="dark-panel" modes={{ semantic: 'dark' }}>
```

Legal on any scene element and on `<Page>`. It is not a `PROP_TABLE` property —
it is resolution context, in the same category as `component`, `overrides` and
`props` — so it joins `STRUCTURAL_PROPS`, which is what exempts it from the
§3.3 unknown-property lint without pretending it reaches the scene by being set
on something.

## Resolution — approach A′

Modes make a token's value depend on **where the node sits**, because the
effective mode per collection is inherited. The naive reading of that is an
upward walk per node, which is O(depth) per node and re-derives what every
ancestor already knew. A′ inverts it.

### Three pieces replace the flat map

1. **`buildTokenIndex(docs)`** — pure data, no resolution. Address →
   `{ type, scopes, description, valuesByMode }`, plus each collection's mode
   list and default. Built once per document load.
2. **`ModeTuple`** — which mode is in effect for each collection. The root tuple
   is every collection's default, overridden by `<Page modes={...}>`.
3. **`TokenResolver.resolve(tuple)`** — flattens alias chains under one tuple
   into `Map<address, literal>`. Memoised on a **stable string key**: the
   `collection:mode` pairs, sorted and joined.

That key is load-bearing. Keyed on object identity instead, the cache misses
every render and this design becomes the slow one it was chosen over. It is
called out here because it is the single most likely way to implement A′ wrong.

### The descent

The renderer already walks top-down, so the tuple rides along with it. A node
with no `modes` attribute forwards its parent's tuple unchanged; a node that
declares one forwards a merged copy. **O(1) per node**, with an allocation only
where a mode is actually set. No upward walk exists anywhere in the design.

This is Figma's own split made explicit: the attribute is
`explicitVariableModes`, the threaded tuple is `resolvedVariableModes`. Keeping
them separate is not academic — it is what lets the panel say "Auto" versus a
named mode without walking the tree to find out.

### Why this is per-tuple and not per-mode

An alias crosses collections. `semantic#surface` in `dark` resolves to
`{palette#gray-900}`, and were `palette` itself moded, that target would resolve
under whatever mode is in effect for `palette` **at the consuming node**. The
value therefore depends on the whole tuple, which is why a per-mode precompute
does not decompose the problem and why the cache is keyed the way it is.

### Invalidation

Drop the cache. G6 already rebuilds wholesale on a token change rather than
diffing — for the reason it recorded, that the page's own document has not moved
while the values it resolved against have. There is no incremental bookkeeping
to get wrong, which was the argument for A′ over precomputation.

## Panel — `@uidx/viewer`

Three additions to the UI3 pass that shipped 2026-08-24. Each follows Figma
unless the research names a specific reason not to.

**Scope-filtered picker.** `variableCandidates` filters by type alone today; it
gains the property's scope. Binding corner radius stops offering the spacing
scale. This needs `SCOPE_FOR_PROP` in `@uidx/schema`, mapping each bindable prop
to the scopes that gate it — seeded from
[figma-binding-matrix.json](../../research/figma-binding-matrix.json) rather
than retyped from memory.

A prop with no `SCOPE_FOR_PROP` entry falls back to type-matching alone, so a
newly-added property is under-filtered rather than unbindable.

**Apply variable mode.** In the **Appearance** section, one row per collection
that declares modes, using Figma's own label. Shows `Auto` when inherited and
the mode name when explicit.

**Token pill.** Unchanged, except its tooltip resolves in the node's own tuple.
`variableCandidates` likewise previews values under the selected node's tuple,
so a picker opened on a dark subtree shows dark values.

### Divergences from Figma, in full

Two, both traceable to a documented pain point. Any future addition to this
table is a decision, not a detail.

| Figma | Here | Why |
|---|---|---|
| Four bind gestures (`=`, `Shift`-click, right-click, a button) depending on field | One gesture on every bindable field | Review §4.5 — the inconsistency is a recurring complaint |
| No padding scope; padding filtered by `GAP` | `SPACING` added | Review §4; a padding scale and a gap scale are otherwise indistinguishable in the picker |

`SPACING` has no Figma equivalent, so `.fig` export maps it down to `GAP` and
the round trip back cannot recover it. `Variable extends PluginDataMixin` in the
Figma typings, so plugin data may offer a lossless path — **unverified**, and to
be checked when export is built rather than assumed now.

## Write discipline

Every binding change is a patch, never a scene-graph commit. The reason is
recorded in `variable-binding.ts` and unchanged here: writing `"{radius#md}"`
through the commit route hands D4 a string where it reflows numbers.

| Action | Patch |
|---|---|
| Bind | today's `bindVariable`, unchanged |
| Detach | `set` the prop to the **resolved literal** |
| Set a mode | `set` the node's `modes` attribute |
| Clear a mode | `remove` the entry; remove the attribute when it empties |

Detach writing the literal rather than clearing the property is the important
one. A detach that blanks the value loses the design, and Figma's own
equivalent — dragging an auto-layout handle, which silently drops the binding —
is the behaviour the review flagged as fatal for bidirectional sync.

## Diagnostics — `uidx check`

The grammar rules are the error list:

1. `<Variable>` with no `type`
2. declared `type` contradicting the authored value's shape
3. a collection's either/or rule violated — `<Mode>` children without
   `modes`, or `value` on a variable in a moded collection
4. a `<Mode name>` not in its collection's `modes`
5. a variable not covering every mode its collection declares
6. duplicate mode names in one collection
7. alias target does not exist
8. alias target's type differs from the aliasing variable's
9. alias cycle
10. unknown scope name
11. a node `modes` naming an unknown collection, or an unknown mode

Existence and type are mode-independent — a variable has one type across all its
modes — so 7 and 8 are checkable per mode without enumerating tuples. Only
*values* are tuple-dependent.

**One deliberate softness.** Binding a variable to a property outside its
`scopes` is a **warning, not an error**. Figma's scopes only filter the picker;
its API binds regardless. A hard error would make the file stricter than the
tool it mirrors, and would break files that arrive by import.

A variable that omits one of its collection's modes is diagnostic 5 at check
time and resolves to its collection's **default mode** value at render, so an
incomplete file still draws.

An unresolved alias keeps G6's behaviour at render — engine default plus a
warning — and is reported properly here. An unknown mode name falls back to the
collection default rather than failing the render.

## Migration

`uidx migrate tokens` writes `type=` into existing `<Variable>` elements using
`variableTypeOf` against the authored value. In-repo this touches three example
files; `core-tokens.uidx` gains seven attributes. `uidx check` errors on a
variable with no `type`, so the migration is not optional and not silent.

Nothing else in the format changes for a file that declares no modes.

## Out of scope

- **Hide from publishing.** It only means something with libraries, which ADR
  0004 §4 reserves without building. There is nothing to publish to.
- **Units, and percentage line heights with them.** A property-layer story.
- **`EASING` / `TIMING` variables.** Figma shipped them 2026-08-05, still open
  beta, and the review found help centre and typings disagreeing on whether
  timing is milliseconds or seconds. Not a thing to guess at.
- **Styles** (`<PaintStyle>`, `<TextStyle>`, …). Decided in §14.4, specced
  separately — this story is the model those will bind against.
- **The token management panel.** Creating, renaming and bulk-editing variables
  in the editor. Tokens stay authored in token documents, as the UI3 pass
  already decided for the popup.
- **`.fig` export of collections and modes.** The reason the model is
  Figma-shaped, but its own story.

## How this gets verified

TDD, per the repo's convention.

- **format** — round-trip of `<Mode>` children; the either/or rule in both
  directions; **a mode produces no address**, guarding the
  `semantic#surface/light` collision specifically
- **schema** — index build; per-mode alias existence and type matching; cycles
- **resolution** — tuple inheritance down a nested tree; a node overriding one
  collection while inheriting another; an alias crossing collections resolving
  to different literals under two tuples
- **viewer** — scope filtering excludes an out-of-scope variable; the mode
  control emits the right patch; detach writes the resolved literal
- **cli** — each of the eleven diagnostics; the scope violation warns rather
  than errors; `uidx migrate tokens` over the examples
- **performance** — a 1,000-node page over a 3-mode collection, asserting the
  **cache-miss count**: resolution runs once per distinct tuple, not per node.
  Wall-clock in CI is flaky, and a miss counter tests the property that actually
  matters. A loose time ceiling sits beside it as a smoke check.

Live verification follows the house method: run the viewer, bind a token, switch
a mode on a nested frame, confirm the subtree repaints and the parent does not.
Check for a Vite reload 500 before trusting any probe.
