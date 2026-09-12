# ADR 0004 — One global namespace per document; a file is a page

Status: **accepted**, 2026-08-15. Amends [ADR 0003](0003-page-root-and-two-level-addressing.md)
§2 and its multi-file consequence. See [What this changes elsewhere](#what-this-changes-elsewhere).

## Context

ADR 0003 made a file a page and left cross-file reuse to a `<file-id>#<address>`
qualifier inherited from ADR 0001. Two forces make that halfway position wrong.

**`.fig` export is a first-class goal, not a Phase 5 nicety.** A Figma document
has exactly one component namespace and exactly one set of variable collections.
Instances reference a component; they do not reference the page it sits on.
Export from a file-qualified model must either strip the qualifier — losing
round-trip identity — or invent page-scoped naming Figma has no concept of. The
reverse direction is worse: importing a `.fig` yields components with no file
qualifier to assign, so the importer would have to fabricate one from page names.

**A file qualifier breaks on a move.** Under ADR 0003, moving a component from
`buttons.uidx` to `forms.uidx` invalidates every reference to it. This is the
failure ADR 0001's rationale 2 rejected for renames, reappearing one level up.
In Figma, dragging a component to another page breaks nothing.

Both point the same way, and ADR 0002 settles it: the authored surface tracks
Figma, and what tracking Figma means here is a single global namespace.

## Decision

### 1. The document is the unit of resolution

A **document** is a manifest at the workspace root plus the `.uidx` files it
claims. It is the analogue of one Figma file.

```json
{
  "id": "workspace",
  "files": ["marketing/**/*.uidx", "app/**/*.uidx", "tokens/**/*.uidx"]
}
```

`uidx.json` declares membership and nothing else — no content, no new parser, no
new diff shape. A `.uidx` file is a **page** within the document.

`uidx open <page>` resolves the document by walking up to the nearest `uidx.json`
and loads all of it. A global name cannot be resolved from a single file, so
document load is mandatory, not an optimisation.

**One document per workspace, spanning every design system in it.** A design
system is not a boundary here — it is a directory and a name prefix, with no
mechanism behind it. Nothing in the tool needs to know which pages form a
system: `.fig` export maps document to file and page to page, diagnostics report
against locations, and instances resolve by name. So `uidx.json` gets no
`systems` field; the naming already carries it.

The consequence is that two systems in one workspace share one namespace, and a
`Button/Primary` defined in each is a duplicate-name error rather than two
coexisting components. `/` grouping is what absorbs that —
`Marketing/Button/Primary` and `App/Button/Primary` — which is the same
convention §3 exists to keep usable, applied one level up.

What this defers is an independent versioning boundary: everything in the
workspace moves together, and "the app depends on the design system at 2.1"
cannot be expressed. That is the library mechanism in §4, and a monorepo where
everything moves together is both the common case and the simpler one.

### 2. Components and variables are global to the document

References are bare names. There is no file qualifier and no import statement.

```jsx
<Instance name="submit" component="Button/Primary"
  overrides={{ 'container/label': { characters: 'Save' } }} />
```

```jsx
<Frame cornerRadius="{radius#md}" />
```

> Sketched as `{radius.md}` when this section was drafted, before §3 below
> settled `#` as the entity boundary; the two were never reconciled. Corrected
> when G5 built it: a token address is `collection#variable`, the same law as a
> node address, rather than a third separator borrowed from other token tools.

**Only components and variables are global.** A `<Frame>` sitting on a page is
page-local scenery, not a system entity, and nothing outside its page can
reference it — so it carries no global-uniqueness burden. Patches always target a
known page, which is what makes page-local addressing sufficient.

### 3. `#` separates the entity from the path inside it

```
Button/Primary#container/label
```

ADR 0003 made the component the first `/` segment of a page-absolute address.
That cannot survive global naming, because Figma groups components with `/` —
`Button/Primary` is one name, not two segments — and `Button/Primary/container`
would be ambiguous.

So `/` is a name character *and* the path separator inside an entity, and `#`
marks the boundary between them. Splitting on `#` is unambiguous under both
readings.

This makes ADR 0003's two address spaces syntactic rather than conventional.
The component-relative address an override key needs is literally the substring
after `#` — no segment-dropping rule, no way to apply it to the wrong depth.

### 4. `<file-id>#<address>` is retired; `:` is reserved for libraries

The qualified form has no intra-document job left. Cross-*document* reuse is
Figma's library mechanism, and the slot is reserved now so the grammar does not
have to change when it lands:

```
design-system:Button/Primary#container/label
```

Libraries are not being built yet. Reserving `:` is free today and a breaking
change later.

## What this changes elsewhere

| ADR | Effect |
|---|---|
| [0001](0001-node-addressing.md) | Already superseded by 0003. Its closing note that multi-file addressing would be `<file-id>#<address>` is now wrong in both halves: intra-document references carry no qualifier, and `#` means something else. Its rationale 2 — override keys stay component-relative — survives a second challenge and is why §3 above keeps the two spaces distinct. |
| [0002](0002-fidelity-to-figma-and-css.md) | **Unchanged.** It is the criterion this decision was made under, not a casualty of it. Global naming, `/` in component names, and variable collections are all *more* faithful, not less. |
| [0003](0003-page-root-and-two-level-addressing.md) | **Amended.** §2's spelling changes: the entity boundary is `#`, not the first `/` segment, so `primary-button/container/label` becomes `primary-button#container/label`. Its "multi-file stops being a prerequisite" consequence is reversed — a document is always multi-file, and the server must load one. Its structure survives: `<Page>` root, two-level grammar, two address spaces, metadata split, and the `<Component>` sugar with its mandatory `name`. |

## Consequences

**Global uniqueness applies to component names and token paths.** This is a real
burden that grows with the system, and it is the burden Figma itself has. It is
also why §3 matters: `/` grouping is the convention that makes it survivable, so
the separator conflict had to be resolved rather than legislated away.

**`uidx check` becomes a symbol table.** The `id → file` map at `check.ts:45`
generalises: every component name and variable path, with duplicates reported
against both locations, unresolved references named, and reference cycles
detected by DFS. Cycle detection must exist before the first instance lands.

**Document load makes the parse budget a startup cost.** The measured 13.6ms per
512 lines — already over §5's 10ms — is now paid for every page in the document
before the first paint, not once for the file being opened. A known problem
becomes a latency problem, and the constant factor in `applyPatch`'s double parse
is worth removing before the multiplier arrives.

**Diagnostics lose a hint.** "Component `Button/Primary` not found" cannot say
which file it should have been in. Near-match suggestions from the symbol table
(story E3) partly compensate and become more valuable.

**`FileSession` becomes a document workspace.** Per-file revisions, per-file echo
ledgers, and a reverse dependency map so that editing a component re-renders
every page that instances it.

**`.fig` export becomes close to mechanical.** Document → `.fig`, page file →
page, component → component node, token file → variable collection. There is no
reconciliation layer because the model is already Figma's — which is the point.

## Rejected alternatives

**File-qualified references** (`buttons#primary-button`, resolved through the
existing id map). Cheaper, and it keeps diagnostics precise — but it breaks on a
component move, and it has no honest `.fig` representation in either direction.

**MDX `import` statements with relative paths.** The file is MDX, so the syntax
is available. It drags module semantics into a format that is never executed, and
paths break on a move even harder than ids do.

**Forbidding `/` in component names,** which would remove the separator conflict
without introducing `#`. Rejected under ADR 0002: `/` grouping is how Figma users
organise a component set, and it is the convention that makes a flat global
namespace workable at scale.
