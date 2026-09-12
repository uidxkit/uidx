# ADR 0003 — `<Page>` is the root, and addresses gain a component segment

Status: **accepted**, 2026-08-15. Supersedes [ADR 0001](0001-node-addressing.md).
**Amended by [ADR 0004](0004-global-document-namespace.md)**, same day, in two
places: the entity boundary in §2 is `#` rather than the first `/` segment
(`primary-button#container/label`), and the "multi-file stops being a
prerequisite" consequence is reversed — a document is always multi-file. The
structure below is otherwise intact.

## Context

ADR 0001 rests on a premise stated in spec §2 and repeated in its own rationale 3:
**one `.uidx` file is one component.** Every consequence of that ADR — the
reserved `""` root, the excluded prefix, the frontmatter `id` doubling as the
root's name — follows from it.

That premise no longer holds. The goal is to show and edit **several entities on
one page**: a set of components side by side, the way a Figma page holds several
frames. Two ways to get there were considered (see Rejected alternatives); the
one adopted here is that the file grows a root that can hold more than one thing.

Two existing facts make this cheaper than it looks:

1. **The page already exists, invisibly.** `toSceneGraph` calls
   `graph.getPages()[0] ?? graph.addPage('Page 1')` and hangs the component under
   it. The scene graph has a page; the file simply does not admit it. The current
   format is not page-free — it is page-implicit.
2. **`PageNode` is Figma Plugin API vocabulary.** Under [ADR 0002](0002-fidelity-to-figma-and-css.md)
   an explicit `<Page>` is *more* faithful than the implicit one, not a
   concession to the engine.

It also removes the need for a separate page-manifest file type. Membership and
arrangement are expressed in the format that already exists.

## Decision

### 1. `<Page>` is the root element of the Visual Contract

The grammar becomes two-level:

```
Page               →  Component | Frame | Text | Rectangle | Ellipse | Vector
Component | Frame  →  Frame | Text | Rectangle | Ellipse | Vector
```

A `<Component>` on a page is a **definition** — Figma's `ComponentNode`. A
`<Frame>` on a page is a standalone frame that is not part of the system. When
`<Instance>` lands it is a **placement**, and it is legal at both levels. This
mirrors Figma exactly, and it gives the element whitelist meaning beyond being a
list of shapes.

`<Page>` may hold any number of children, including zero. The v1 rule that
`<Component>` has exactly one child is unchanged.

### 2. Addresses are page-absolute; override keys are component-relative

Two address spaces, with one conversion between them.

**Page-absolute** — rooted at `<Page>`, which keeps the reserved address `""`:

```
Page       ->  ""
Component  ->  "primary-button"
Frame      ->  "primary-button#container"
Text       ->  "primary-button#container/label"
```

> Amended by ADR 0004 §3: the boundary between the entity and the path inside it
> is `#`, so that `/` stays free to be a name character as Figma uses it. The
> component-relative address is then literally the substring after `#`.

This is *the* address in every context that names a node in this file: `UidxPatch`
ops, selection, scene node ids, diagnostics, the layers pane, the properties
panel.

**Component-relative** — rooted at the enclosing `<Component>`, used in exactly
one place: `<Instance>` override keys.

```jsx
<Instance name="button-1" component="primary-button"
  overrides={{ 'container/label': { characters: 'Save' } }} />
```

Conversion is dropping or prepending the first segment. A component-relative
address is meaningless without knowing which component it is relative to, so it
never appears anywhere but an `overrides` key.

### 3. Metadata splits by what it describes, with no overlap

Frontmatter describes the **page**. Component-level facts move onto the element:

```mdx
---
id: buttons
tags: [forms, actions]
---

<Page>
  <Component name="primary-button" status="stable" version="1.2.0">
    ...
  </Component>
  <Component name="ghost-button" status="draft">
    ...
  </Component>
</Page>
```

No key is valid in both places. `status` and `version` are per-component facts
and belong on the component even in a file that holds only one.

### 4. `<Page>` may be omitted, but the component must then be named

A Visual Contract whose root is `<Component>` parses as if wrapped in a `<Page>`
taking its `id` from the frontmatter. The wrapped component **must** carry an
explicit `name`, which inverts today's rule that the root `Component` takes its
name from the frontmatter `id` and must not carry a `name` attribute.

Addresses are page-absolute either way. There is one address law, not one per
file shape.

## Rationale

### Re-examining ADR 0001's four arguments

ADR 0001 rejected exactly the addressing adopted here. Three of its four
arguments do not survive the change of premise; the fourth does, and shapes the
decision.

1. **"Renaming the component must not rewrite every address."** The concern was
   specifically that the prefix came from the frontmatter `id` — so a rename
   reached in from a region §3.1 guarantees the tool never writes. Under §4 above
   the component's name is an ordinary `name` attribute on an ordinary node.
   Renaming it is a rename like any other: addresses beneath it shift, uniformly,
   through the same code path as renaming a frame. **This is why the sugar in §4
   requires an explicit `name`** — without it, the frontmatter would once again
   prefix every address in the file and the argument would land.

2. **"Overrides must be portable across files."** ✅ **Still decisive, and still
   honoured.** An override key written in a consuming file must not embed the
   producing file's naming, or renaming a component breaks every consumer. This
   is the entire reason for the two-level space in §2 rather than one
   page-absolute address used everywhere.

3. **"The prefix carries no information — one `.uidx` is one component."** This
   is the premise being overturned. On a multi-component page the segment is
   what distinguishes `primary-button/container` from `ghost-button/container`.

4. **"Structural patches need to name the root."** Unchanged — `""` still names
   the root, which is now the page. `{ op: 'insert-node', parent: '' }` adds a
   top-level entity, which is precisely what a board needs.

### Why the scene-id exception gets simpler

ADR 0001 needed a special case: the root's scene id cannot be `""`, so it used
the frontmatter `id`. That exception now attaches to `<Page>`, which maps to the
scene graph's own page node — a node the bimap never had to address before.
Every `<Component>` gets its plain page-absolute address as its scene id, with no
exception at all. The special case moves from a node users select and patch to
one they do not.

## Consequences

**Format.** `ELEMENTS` and `CONTAINER_ELEMENTS` gain `Page`; the flat whitelist
check becomes a per-level one; the root check accepts `Page` or the `<Component>`
sugar; the "root takes its name from frontmatter" rule inverts into "the root
component requires a `name`".

**Addresses in existing files change.** `container/label` becomes
`primary-button/container/label`. This is a breaking change to every stored
address, and it is mechanical: `uidx fmt` (story A3) should carry a migration
that adds the `name` attribute and rewrites addresses. Pre-1.0, with one example
file in the repo, this is the cheap moment to take it.

**Page children carry authored `x` / `y`.** `fromSceneChange` currently drops
`x`/`y` as layout-derived, which is correct for a child of an auto-layout frame
and wrong for a child of a page — where the position is a decision someone made
and must reach the file. Story D4 owns this rule and should carry the exception
rather than have it bolted on afterwards.

**Layout runs per top-level child.** `computeAllLayouts(graph, rootId)` is called
once with the component's id. A page with several children needs it per child, or
scoped to the page.

**Selection becomes Figma's model, for Figma's reason.** A page with several
top-level children makes a shallow click meaningful: click selects an entity,
double-click enters it, Cmd-click deep-selects. The objection that a single-child
page makes shallow selection useless disappears.

**Multi-file stops being a prerequisite.** ~~One file can now carry a board, so
adding a `fileId` to the protocol is no longer required before Phase 3.~~
**Reversed by ADR 0004:** names resolve against a whole document, so the server
loads every page in it and the patch envelope carries the page it targets. The
`<file-id>#<address>` form is retired; `:` is reserved for cross-document
library references instead.

**One shared file is a real cost.** Every component on a page is edited in one
document: bigger diffs, more conflicts, agents rewriting a file other components
live in. The format permits both shapes — a small system on one page, a large one
split across page files that instance shared components — so this is a choice
teams make rather than one the format forces. That is the right place for it, but
it is a genuine loss against one-component-per-file and should not be papered
over.

## Rejected alternatives

**A separate page-manifest file type** (`.uidx-page`) listing member components
and their positions. Membership and arrangement are node containment and node
geometry — things the format already expresses. A second file type would mean a
second parser, a second validator and a second diff shape, to describe what
`<Page>` describes for free.

**Several bare `<Component>` roots in one file.** Reaches the same goal without a
node to hang page-level metadata, page-level position semantics, or the scene
graph's existing page on. It also leaves the Visual Contract region with no
single root, which §3.1's region rules depend on.

**Page-absolute override keys.** Would collapse §2 to one address space and
delete the conversion. Rejected on ADR 0001's rationale 2, which is as strong now
as it was then: it would drag the producing file's component name into every
consuming file, so renaming a component would break its consumers.
