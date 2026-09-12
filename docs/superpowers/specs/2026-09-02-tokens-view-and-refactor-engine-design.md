# Tokens view and the document refactor engine

**Goal:** A `<Tokens>` page opens as a real view instead of a placeholder; any
page can toggle between its elements and its tokens; tokens can be edited,
created, renamed, deleted and deprecated with their blast radius shown first —
and the rename/delete machinery is symbol-general, so component rename rides
the same engine.

**Approved:** 2026-09-02, in chat, after research and four rounds of scope
refinement with the user.

## Current state

- A `<Tokens>` page hits `renderable = false` in `App.vue` and shows one
  sentence ("This page declares variables, not a scene"). The user calls this
  the blank page, correctly.
- The data layer is already done: `buildTokenIndex` (`@uidx/schema`) holds
  every token as data (type, scopes, description, values by mode);
  `TokenResolver` resolves alias chains per mode tuple. The Home dashboard
  counts tokens and collections but the card leads nowhere.
- Renaming a component today is a bare `set name` patch; every
  `<Instance component="…">` in other files goes stale and is only *diagnosed*
  (the symbols band's "resolves to nothing"), never repaired.

## Research grounding

- The W3C DTCG format (first stable version 2025.10) defines ten primitive
  token types and six composites (typography, shadow, border, gradient,
  transition, strokeStyle).
- Figma still has exactly four variable types — COLOR, FLOAT, STRING,
  BOOLEAN — and covers typography by *scoping* primitives onto text
  properties. uidx mirrors this (ADR 0002 fidelity), and its
  `VariableType × VariableScope` already encodes the industry categories
  (color, spacing, radius, typography, opacity, …).
- Design-system practice tiers tokens primitive → semantic → component; the
  four in-repo design studies (`design/option-*/token-manager.uidx`,
  `token-detail.uidx`) settled the presentation: a table, because managing
  tokens is editing rows; impact-before-edit on every destructive action.

DTCG composite tokens are out of scope: Figma cannot express them and ADR 0002
keeps the format Figma-faithful. If they ever land it is a format decision,
not a view decision.

## Design

### 1. View and toggle

`View` gains `{ kind: 'tokens'; file: string }`, URL-addressable
(`?page=x.uidx&view=tokens`), so reload, Back and bookmarks work. A segmented
control in the top bar — **Elements | Tokens** — toggles the open page. A
`<Tokens>` page opens directly in the tokens view; its Elements side is
disabled (there is nothing to draw). The Home dashboard's Tokens card links to
the tokens view of the document's token page.

### 2. Page scoping

- **Tokens page**: the collections it declares. Full table, editable,
  creation enabled.
- **Scene page**: the tokens the page *binds*, found by walking its
  attributes for alias values — grouped by collection, each group naming its
  declaring file. Editable (writes go to the declaring file); creation is
  add-to-existing-collection only.

Tokens are document-global (ADR 0004): the document is the file set
`uidx.json` names, and every cross-file mechanism below operates on that whole
set, never just open pages.

### 3. The table

Rows grouped by collection, then by inferred category (color / spacing /
radius / typography / … from type + scopes). One value column per mode of the
collection; single-mode collections get one "Value" column. Cells are
type-aware: COLOR swatch + hex, FLOAT number, STRING/BOOLEAN literals.
A `deprecated` token renders struck with a badge.

### 4. Aliases: the reference and the arithmetic

An alias cell shows `→ palette#blue-500` *and* the calculated end value
(swatch or number) beside it, resolved by `TokenResolver` per mode column. A
broken alias renders as a finding with the reason — never a blank.

### 5. Inline editing

Click a value cell to edit in place: color picker (the panel's existing one),
number/string input, boolean toggle — or type `{` to start an alias, with
autocomplete from the TokenIndex filtered to type-compatible targets. An
illegal alias (type mismatch) is refused in the editor. Edits ride the
existing patch channel with the envelope naming the *declaring* file, exactly
as instance-edits already write another page. Alias edits emit patches (the
panel's own hard-won rule). Same stale/rejected/undo story as every edit.

Per-mode values live on `<Mode>` children; editing a moded cell is a `set` on
the Mode child when it exists and an `insert-node` of one when it does not.

### 6. Creating

`+ New token` on a collection inserts a `<Variable>` in edit state (name,
type, value). `+ New collection` on a tokens page. From a scene page, only
add-to-existing-collection (the write goes to its declaring file); new
collections are created on the tokens page so file provenance stays
unsurprising.

### 7. Selection

Rows are selectable; the selected token's address reports through the
selection channel — so `uidx selection` answering `semantic#brand` lets an
agent be told "rename this" about a token.

### 8. The dependents index (symbol-general)

A symbol is a token or a component. A dependent is:

- a variable whose value (or a Mode child's value) aliases the token,
- a scene attribute bound to the token,
- an `<Instance>` whose `component` names the component.

Built once per document load by one walk over every page, next to
`buildTokenIndex` in `@uidx/schema`. Powers blast radius and both refactor
flows.

### 9. Blast radius, before the cut

Selecting a token shows its dependents in the properties pane (file + address,
jump links). Rename and delete carry the count in their label — "Rename
(updates 12 references in 3 files)" — and the confirm dialog lists the
dependents. Deleting a moded token flags every scene dependent whose mode
variance will be flattened. No destructive action fires blind.

### 10. Rename rewrites every dependency

Renaming a symbol rewrites the declaration and every reference across all
files of the document:

- token: the `<Variable>`'s `name`, plus every `{old#address}` alias string in
  variables, Mode children and scene attributes;
- component: the `<Component>`'s `name`, plus every instance's `component`
  attribute.

Mechanically: the engine produces one patch batch per affected file; the
declaring file's rename and its same-file references are one atomic batch;
other files' batches follow immediately. **Stated seam:** cross-file batches
are not one transaction — a rejected envelope (staled by a concurrent edit)
can leave stragglers, but a straggler is a *visible* broken-reference finding,
never silent corruption. After dispatch the view re-checks and reports
anything left.

### 11. Delete inlines values first — the design never breaks

Before a token is removed, every first-level dependent is rewritten from the
alias to the literal it currently resolves to:

- a dependent *variable* gets the resolved value per each of its own modes —
  written as `<Mode>` children when the values differ, one plain value when
  they do not;
- a dependent *scene attribute* gets the literal it currently renders with
  (its effective mode tuple) — flagged in the confirm dialog when this
  flattens a moded token.

Only after every dependent is rewritten is the `<Variable>` removed
(`remove-node`), ordered so an interruption leaves harmless extra literals,
never dangling aliases.

Component delete follows the same principle as **detach** — materialising the
component's tree into each instance site with its variant selection, prop
overrides and slot fills applied, then removing the definition. It is designed
here, staged as its own phase after tokens ship (it is the renderer's
expansion as a source rewrite, and earns its own tests).

### 12. Deprecate

A `deprecated` boolean attribute on `<Variable>` and `<Component>` (format
addition: parse, emit, canonical fmt). A deprecated symbol stays resolvable —
nothing breaks — but is struck/badged in the table and pickers stop offering
it (alias autocomplete; instance component picker). The soft path when blast
radius says delete is too expensive today.

### 13. One engine, two clients

`renameSymbol` and `deleteToken` (later `detachComponent`) are pure functions
in `@uidx/schema`: documents in, `Map<file, UidxPatch[]>` out. The tokens view
and the component flows call the same functions; the viewer only dispatches
envelopes. Fixed once, fixed for both.

### 14. Component flows in this feature

- **Rename** — shipped in this feature (nearly free once the engine exists),
  wired into the existing layers-rename flow with the same blast-radius
  confirm.
- **Delete-as-detach** — designed above, staged as the follow-up phase.
- **Deprecate** — included.

## Out of scope

- Tier rules (own-tier-or-lower aliasing) and violation rows.
- DTCG composite token types.
- Component delete-as-detach implementation (staged next).
- Editing collection modes (add/remove/rename a mode).

## Testing

Pure model first, TDD throughout: dependents index, refactor engine
(rename/delete patch production, mode-aware inlining), view model (scoping,
categories, display values) — all as unit tests over documents built from
source strings. Component tests for the pane follow the existing viewer test
style. One live pass at the end: edit, create, rename-across-files, delete
with inlining, verified in the running viewer.
