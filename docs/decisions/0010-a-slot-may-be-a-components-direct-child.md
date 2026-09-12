# ADR 0010 — A `<Slot>` may be a `<Component>`'s direct child

Status: **accepted**, 2026-08-29. Amends
[ADR 0007](0007-slots.md) §1's first restriction, and lands the consequence
[ADR 0008](0008-component-is-a-frame.md) declared but did not carry out.

## Context

ADR 0007 §1 named two restrictions on where a `<Slot>` may sit, and said both
were taken from Figma "because the reason survives translation". This is the
first of them, in full:

> **A `<Slot>` may not be a `<Component>`'s direct child.** Figma forbids
> binding a slot property to a component's top layer. A component that is
> nothing but a hole declares no contract — it is `<Frame>` with extra
> ceremony. The one-child rule already says a component holds one scene child;
> this says that child is not a slot.

Read that last sentence again. The rule is not standing on its own: it is
standing on the one-child rule, and **ADR 0008 §1 deleted the one-child rule**.
While a component was a wrapper *around* a frame, its sole child was the entire
content, so a slot there really did leave a component that was nothing but a
hole. A component is the frame now. It carries its own `fills`, `width`,
`height`, `cornerRadius`, `strokes` and auto-layout, and a slot inside one
leaves all of that behind — a painted, sized, stroked box with a hole in it,
which is a card with a hole in it, which is the thing slots exist to express.

ADR 0008 saw half of this. Its "what this changes elsewhere" says §1 is
"unaffected in intent but shifts in wording", and that a component "may now hold
a slot *among other children*". But among-other-children was never the hard
case. The sole-child case is the one an author reaches first — draw a frame,
make it a component, declare the hole — and it stayed refused, with a diagnostic
whose stated reason had by then stopped being true.

The Figma parity argument does not survive the move either; it re-points. What
Figma refuses is binding a slot to the component's **top layer**. Before ADR
0008 the top layer was the wrapper child. After it, the top layer *is* the
`<Component>`, and refusing to make that a slot is a different rule which the
editor already enforces through `NEVER_A_SLOT` and the parser through "a slot
may not be a page child".

This arrived as a bug report — "I can't convert a frame inside a component into
a slot" — and it took reading ADR 0007 §1 beside ADR 0008 §1 to see that it was
not one.

### The other half: a rule that was written down and never moved

ADR 0008's same section says:

> **`canInsert` and `moveFor`** stop refusing a second child of a component.
> Both read the arity rule from one place, as they now read the child-element
> table from one place.

Neither happened. The arity rule was still spelled as a rule about
`<Component>` in **eight** places when this ADR was written — `canInsert`,
`canRemove` and twice in `moveFor` in the viewer, and `insertNode`,
`removeNode` and twice in `moveNode` in the patcher — while the parser had
already stopped enforcing it. The parser was the only one that had been
changed.

Two apiece in `moveFor` and `moveNode`, because a move is a remove and an
insert: one guard for what may leave a component, another for what may enter
one. That is the shape of the miscount this ADR nearly repeated — the rule reads
like one thing and is written as two.

That skew is what made the whole area feel arbitrary: a component with two
children parsed, `uidx check` passed it, and the editor would not let you make
one, drop into one, or delete out of one.

## Decision

### 1. A `<Slot>` may be a `<Component>`'s direct child

`COMPONENT_CHILD_ELEMENTS` gains `Slot`, and `checkSlotPosition` drops its
`parentElement === 'Component'` refusal. The positions a slot is still refused
in are the ones whose reasons did not depend on the one-child rule:

- **not on a `<Page>`**, and not anywhere outside a `<Component>` however deeply
  nested — a hole outside a component has nobody to fill it;
- **not inside a fill** — the fill is the consuming page's own content, and a
  hole in it is one no component declares;
- **not the `<Component>` itself** — that is the top layer, which is the rule
  Figma actually has.

Slot names stay unique within a component. ADR 0007 §1's second restriction is
untouched: the name is the entire contract, so two of them cannot collide.

### 2. The arity rule lives on `<Variant>`, in every layer

There is one rule, it belongs to `<Variant>`, and it says a variant holds
exactly one child. Every place that spelled it as a rule about `<Component>` now
spells it as a rule about `<Variant>`:

| Layer   | Guard                                                 |
| ------- | ----------------------------------------------------- |
| parser  | `UIDX104` on `<Variant>` (already true)               |
| patcher | `insertNode`, `removeNode`, `moveNode` (twice)        |
| viewer  | `canInsert`, `canRemove`, `moveFor` (twice)           |

A `<Component>` holding no children at all is a valid document, so removing its
last child is an ordinary edit. A component that *declares* `variants` and holds
none is still refused — but by the parser, on the re-parse `applyPatch` already
does, rather than by an arity guard in the patcher that had to guess at the
same rule.

## Rationale

**The premise died, so the rule dies with it.** A rule whose stated reason has
become false is worse than no rule: it refuses a legitimate gesture and explains
itself with a sentence the author can check and find wrong. "A component that is
nothing but a hole declares no contract" was a good reason in a world where a
component had no contract of its own to declare.

**One rule, one owner.** The arity rule was correct in the parser and stale in
eight other places, and every one of those existed to tell the author "no"
*before* the parser could. A guard that mirrors a rule has to move when the rule
moves; eight copies is eight chances to miss one, and this ADR is the bill for a
miss. The first draft of this ADR said "six", having counted `moveFor` and
`moveNode` once each — which is the same error one level up, and is left
recorded here rather than quietly corrected.

**It is a relaxation, so no file changes meaning.** Every document legal before
is legal now; the set of legal documents only grew. Nothing needs migrating, and
`uidx fmt` has nothing to rewrite.

## What this changes elsewhere

- **`uidx check`** stops reporting UIDX133 for a slot that is a component's
  direct child. The code stays; the other three positions still use it.
- **Convert to slot (F14)** starts offering itself for a component's direct
  child, which is the gesture this ADR came from.
- **New slot (F5)** will insert into a selected `<Component>`, where before the
  button was disabled.
- **Deleting and dragging** stop refusing a component's child. A component can
  be emptied and refilled like the frame it is.
- **ADR 0008 §"what this changes elsewhere"** overstated the present tense: it
  described `canInsert` and `moveFor` as already reading the arity rule from one
  place. §2 above is that work, done.
- **ADR 0007 §1**'s first restriction is withdrawn. Its second — unique slot
  names within a component — stands unchanged.

## Rejected alternatives

**Keep the restriction and make the author wrap the slot in a frame.** This is
the status quo, and it reintroduces exactly the wrapper ADR 0008 deleted: a
frame nobody drew, existing because a rule demanded a child, costing a segment
in every address inside it. The same mistake one level down.

**Refuse only when the slot would be the component's *only* child.** This keeps
the original sentence literally true — the component would then be nothing but a
hole — but it makes legality depend on sibling count, so adding a second child
would retroactively legalise the first. A rule an author cannot predict from the
node in front of them is worse than either answer.

**Leave the arity stragglers and fix only the slot rule.** Rejected because they
are the same defect: a rule that moved in one layer and not the others. Fixing
the symptom the report named would have left a component with two children still
undeletable and undroppable-into.
