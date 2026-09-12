# ADR 0009 — `status` is optional, and unstated means undeclared

Status: **accepted**, 2026-08-28. Amends
[ADR 0003](0003-page-root-and-two-level-addressing.md) §3.

## Context

ADR 0003 §3 made `status` **required** on every `<Component>`, with a one-line
justification: *"a design contract that does not declare its maturity is a
contract nobody can rely on."*

That reasoning is sound about a *published* design system and wrong about the
tool. Three things it did not account for, all of them visible the first time
somebody made a component:

**Nobody can change it.** `status` is excluded from `editableProps`
(`editable.ts`, "already have their own chip"), and the chip is read-only. It is
not in `PROP_UI`, so no control exists for it and none could — the panel is
generated from that table. A required field with no editor is a field the author
can only satisfy by leaving the tool and hand-editing the file.

**Nothing asked them.** "Make component" wrote `status: 'draft'` because the
grammar demanded *a* value, so the label an author sees on their work is one
they never chose, describing a judgement they were never invited to make.

**It could not be nothing.** `STATUSES` is `draft | stable | deprecated`, and
none of those means "I have not thought about this yet", which is the true state
of almost every component at the moment it is drawn.

So the required field did not produce reliable maturity information. It produced
`draft` everywhere, which carries none.

## Decision

### 1. `status` is optional

A `<Component>` may declare it. UIDX110 `MISSING_STATUS` stops firing, and the
code is retired rather than renumbered — the diagnostics table is append-only.

**When present it is still checked.** A value outside `STATUSES` is still
UIDX112, and `status` on anything but a `<Component>` is still UIDX111. This ADR
narrows *when* the attribute is demanded, not what it means.

### 2. Unstated means undeclared, not `draft`

There is no implied default, and nothing writes one. A component with no
`status` has not made a claim about its maturity, which is a different and more
honest thing than claiming to be a draft.

The chip follows: `PropertiesPane` renders metadata that is *there*, so a
component that declares nothing shows nothing.

### 3. Nothing writes it on the author's behalf

"Make component" stops attaching `status: 'draft'`. The retag that ADR 0008 §3
introduced carries only the name.

An author who wants the label writes it, and — until there is a control for it —
writes it in the file. That is a gap this ADR names rather than closes: **if
`status` is worth keeping, it is worth a control**, and a row in `PROP_UI` with
its three values is the shape it would take. It is not built here because the
change that makes the field bearable is making it optional, and building an
editor for a field nobody asked for is the wrong order.

### 4. Existing files are untouched

Every `status="draft"` already written stays valid and keeps rendering. This is
a relaxation, exactly as ADR 0008 §1 was: what was required becomes permitted,
so no file that satisfied the old rule fails the new one.

## Rationale

**Why not keep it required and add an editor?** Because the requirement is what
is wrong, not the missing control. A field every component must carry before it
can exist is a tax on drawing, and the value it collects is `draft` — a word
that means "the tool made me pick something".

**Why keep the attribute at all?** A design system that has decided what is
stable and what is deprecated should be able to say so, and `uidx check` should
be able to read it. What ADR 0003 got right is that maturity is worth
expressing; what it got wrong is that it must always be expressed.

**Why not default it to `draft` in the model instead?** Because that is the same
claim made silently. `defaultFor` exists so the inspector can show what the
engine would resolve — a maturity judgement is not something an engine resolves,
and dimming `draft` under every component would state the same unearned thing in
a lighter colour.

## What this changes elsewhere

- **`uidx check`** stops failing a file whose components declare no `status`.
  UIDX110's entry stays in the table, marked retired, because editors and CI
  parse these codes and the table has always been append-only.
- **F10 (Make component)** writes one attribute instead of two.
- **The `status` chip** appears only where an author put the attribute there.
- **`examples/`** keeps its `status` declarations. They are still valid, they
  still demonstrate the feature, and removing them would be a change to files
  whose purpose is to show what the format can express.
