# ADR 0008 — A `<Component>` is a frame, not a wrapper around one

Status: **accepted**, 2026-08-28. Amends
[ADR 0003](0003-page-root-and-two-level-addressing.md) §1's one-child rule.

## Context

The grammar has always made a component hold exactly one scene child:

```mdx
<Component name="Card" status="draft">
  <Frame name="container" layoutMode="VERTICAL" padding={16}>
    <Text name="title" characters="Title" />
  </Frame>
</Component>
```

Two things are wrong with that, and the second is why this is worth an ADR
rather than a preference.

**It does not match the engine.** In Figma a `ComponentNode` *is* a frame: it
has `layoutMode`, padding, fills, corner radius, clipping. `NODE_TYPE` already
lowers `<Component>` to `COMPONENT`, and `componentSizing` already hands it
`layoutMode: 'VERTICAL'` with both axes hugging when it declares no geometry —
so the scene graph has treated a component as a frame all along. The file is
the only place carrying a wrapper the engine never asked for. ADR 0002 says the
authored surface tracks Figma; here it does not.

**It costs a segment in every address.** `Card#container/title` names one node
in a two-node tree. That segment appears in every override key, every fill
address, every diagnostic and every patch this repo will ever write, and it
names a frame nobody chose — "Make component" invented it, because the grammar
demanded a child.

The wrapper is also what makes creating a component feel wrong: an author draws
a frame, arranges it, presses **Make component**, and gets *two* frames, one of
which they never made. That is the report this ADR came from.

## Decision

### 1. A `<Component>` holds any number of children, and carries its own layout

```mdx
<Component name="Card" status="draft" layoutMode="VERTICAL" padding={16}>
  <Text name="title" characters="Title" />
  <Slot name="body" />
</Component>
```

The `<Frame>` is gone and `Card#title` is the address. Everything a frame can
declare, a component can declare, because it is one.

**This is a relaxation, not a break.** "Exactly one child" becomes "any number
of children", and one is a number — so every file written under the old rule
still parses, still renders and still addresses the same way. Unwrapping is a
migration an author chooses (§4), never one the parser forces.

### 2. `<Variant>` keeps its one-child rule, and the reason it always had

ADR 0005 §1 gave a variant exactly one child because a variant *is* one state's
tree and the set arranges those trees side by side. Nothing here touches that:
`arrangeVariants` measures one box per variant, and a variant holding three
loose children has no box to measure.

So the two rules stop being the same rule. A component is a frame; a variant is
a slot in a generated layout that happens to look like one.

### 3. Making a component is a `retag`, not a wrap

With §1, "Make component" stops inventing a frame. The selected frame
*becomes* the `<Component>`: one `retag` (F14), and the canvas does not move,
because nothing about the node changes except the word naming it and the
metadata a component must declare.

**Not everything can be retagged, and the rule is not "is it a `<Frame>`".** F10
exists so that a drawn mark becomes a component (ADR 0006 §7), and a `<Vector>`
carrying `vectorPaths` is not a frame and never will be. So the question a
conversion asks is the one ADR 0007 already asks for slots: *would everything
this node says still mean something under the new tag?* `appliesTo` in
`prop-ui.ts` answers it per element, and `attrsSurviveAs` is that question with
the target tag as an argument. A frame converts; a bare rectangle converts; a
vector is **wrapped**, exactly as it was before.

That is one gesture with two outcomes rather than two gestures: the author
presses one button and gets a component either way, and the shape they get is
decided by what they selected rather than by which control they found.

That metadata is the wrinkle, and it decides the shape of the op. A
`<Component>` without `status` is UIDX110; a `<Frame>` carrying `status` is
UIDX111. `applyPatches` re-parses between ops and requires every *intermediate*
document to be valid — so there is no order in which "retag" and "add status"
are two patches. They are one edit or they are impossible.

`retag` therefore grows an optional `attrs` payload, applied in the same
envelope as the tag change:

```ts
{ op: 'retag', address: 'card', element: 'Component', attrs: { status: 'draft' } }
```

Not a new op, and not a general "set several things at once": it is the
narrow statement that *changing what an element is may require changing what it
declares, and the two are one edit*. The same shape answers the reverse
conversion, where a component becoming a frame must shed `status` in the same
breath.

### 4. Unwrapping is a migration, offered and never forced

`uidx fmt --migrate` already exists to carry an address change across files
that predate it (A3, written for ADR 0003). It gains this case: a
`<Component>` whose sole child is a `<Frame>` with no name anyone depends on
collapses into the component, the child's attributes moving up.

It is **not** run automatically and not part of `uidx fmt`'s ordinary pass,
because unwrapping shortens addresses — and an address is a contract that
`overrides` keys and other pages hold. An author who has instances overriding
`container/title` needs to decide when that becomes `title`, not discover it.

**A component whose child carries a name the file references is left alone**,
and says why. Correctness before tidiness: the migration that silently breaks
an override is worse than the wrapper it removed.

## Rationale

**Why not leave it and simply stop wrapping in the editor?** Because the
grammar would still refuse the result. "Make component" wraps *because*
`<Component>` must have a child; the gesture is downstream of the rule.

**Why does a component get scene properties rather than a `root` convention?**
It already has them. `componentSizing` gives it auto-layout and hugging today,
`FRAME_OR_COMPONENT` in `prop-ui.ts` already offers it every auto-layout
control, and `NODE_TYPE` already lowers it to a node that lays children out.
The only thing missing was permission to hold more than one.

**Why keep `status` required?** It is ADR 0003 §3's decision and this ADR does
not reopen it — a contract that does not declare its maturity is one nobody can
rely on. What changes is that declaring it stops costing a second element: the
`attrs` payload in §3 makes the metadata part of the conversion rather than a
reason the conversion cannot happen.

## What this changes elsewhere

- **`uidx check`** stops reporting UIDX104 for a component with several
  children. The code stays, because `<Variant>` still uses it.
- **`canInsert` and `moveFor`** stop refusing a second child of a component.
  Both read the arity rule from one place, as they now read the child-element
  table from one place.

  > Corrected by [ADR 0010](0010-a-slot-may-be-a-components-direct-child.md) §2:
  > this described work that was not done. Only the parser changed here; the
  > arity rule stayed spelled out in the patcher and the viewer, so a component
  > with two children parsed but could not be built, dropped into or deleted
  > out of. ADR 0010 §2 moves it to `<Variant>` in every layer.
- **F10 (Make component)** becomes §3's retag. Its old insert-plus-remove was
  the only gesture in the editor that reprinted a subtree, which "never
  reprint" had tolerated only because there was no other way to do it.
- **F2 (`.fig` export)** gets simpler, not harder: a `COMPONENT` in the SDK
  carries the layout the file now states directly, so the exporter stops
  needing to fold a wrapper's properties into its parent.
- **ADR 0007 §1** is unaffected in intent but shifts in wording: a `<Slot>` may
  not be a `<Component>`'s *direct* child because a component that is nothing
  but a hole declares no contract. With §1 that rule guards less — a component
  may now hold a slot *among other children*, which is a card with a hole in
  it, exactly as intended.

  > Superseded by [ADR 0010](0010-a-slot-may-be-a-components-direct-child.md)
  > §1, which withdraws the restriction rather than narrowing it. "Among other
  > children" was never the hard case; the sole child is the one an author
  > reaches first, and this ADR's own §1 is what made it harmless.

## Rejected alternatives

**Make `<Component>` hold children but keep it a non-frame**, with layout on a
convention like a `root` child. Rejected: it is the wrapper again, with a
naming rule instead of an element, and the engine still disagrees.

**Force the migration, so every file unwraps at once.** Rejected: addresses are
contracts. A repo-wide rewrite of every `overrides` key on the tool's schedule
rather than the author's is precisely the diff nobody can review.

**Retag always, and refuse what cannot be retagged.** Rejected while building
§3, and worth recording because it was this ADR's first draft: it would have
broken F10's original purpose, since a `<Vector>` cannot be a frame and turning
a drawn mark into a component is the whole reason F10 exists. Wrapping survives
as the fallback — but chosen by a stated rule (`attrsSurviveAs`) rather than by
a special case, which is what the earlier objection was really about.

**Wrap only when the node is nested and has to move to the page anyway.**
Rejected: that *is* an arbitrary special case, and it would leave two shapes of
component in the wild with no rule an author could predict.
