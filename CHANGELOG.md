# Changelog

User-visible changes are recorded here. Versions follow semantic versioning;
pre-1.0 releases may change the design format or public APIs. Release notes must
describe migrations when an existing document or integration is affected.

## Unreleased

- **Fixed: token refactors missed the styles table.** A token used only in
  `<Style>` rows showed 0 uses, a rename left those rows dangling, a delete
  did not inline them, and `uidx check` stayed green while codegen emitted an
  undefined CSS variable. Dependents, rename/delete plans, usage counts and
  UIDX401 now read `<Styles>`.
- **Agents write the design-system model.** `uidx apply`, MCP `uidx_apply` and
  `eval` gain `set_style`, `declare`, `set_model` and `set_field` (eval:
  `style`, `declare`, `undeclare`, `model`, `field`). The shipped skills teach
  identities (contract, `<Styles>`, models, repeat, behaviour), with a new
  `uidx-design-system` skill; UIDX153 warns when `<Variant>` trees share one
  anatomy and differ only in values.
- **Agents building product use the design system.** MCP `uidx_components`,
  `uidx_component`, `uidx_tokens` and `uidx components`, `uidx component
  <Name>`, `uidx tokens list`: contracts, import and usage lines, resolved
  tokens with CSS variables. `uidx init` writes a uidx block into AGENTS.md
  (and CLAUDE.md when present).
- **`uidx lint`** checks application code against the design system: colour
  literals a token names, raw elements a component stands for. Exits 1 on
  findings.
- **`uidx diff --base <ref>`** reports design-system changes with breaking ones
  marked; **`uidx init --ci`** writes a pull-request workflow that checks,
  lints, posts the diff and uploads a review site.
- **`uidx share`** writes a static, read-only site: page pictures, component
  docs, tokens.
- **Tokens as DTCG 2025.10:** `uidx tokens import|export`, resolver documents
  for modes.
- **`uidx adopt <custom-elements.json>`** drafts an identity per element a
  headless library ships; **`uidx init --design-system`** writes a starter
  system (tiered tokens, a Button); the overview of a document with no
  component shows how to start.
- **`uidx export fig`** writes one Figma file per page (first slice of F2).
- A list's **`empty` state**: styled like `hover`, drawn on the canvas with no
  rows, `[data-empty]` in CSS, set by the React wrapper.
- A **Docs face** per component: intent, contract, behaviour, examples drawn by
  the renderer, where it is used, and the component as the generated code
  renders it (`/__uidx/preview`).
- The canvas **labels variant sets** (column and row values); the inspector
  says **what a state sets** and offers Reset to the base; a state's root no
  longer offers x and y.
- Codegen: a **`stories`** target (Storybook CSF from samples, visual values and
  examples), a **`cem`** target (Custom Elements Manifest 2.1.0 with an
  `x-uidx` extension), and **`codegen.react`** to map identities onto an
  existing React library through typed adapters.
- Fixed in codegen: frames that hug their width emit `inline-flex` (a Button
  no longer stretches); components with no `implements` render a `<div>` with
  their class and data attributes and a matching ref type; `models.ts` is a
  module when no model is declared; a state row targeting a `<Slot>` selects
  `[data-slot]`.
- `pnpm test:journeys` walks the first hour in a real browser (overview,
  canvas, contract, state reset, docs, code preview, models, an agent edit)
  in the canvas canary job.

### Earlier in this release

- The design-system model (ADRs 0012–0017). A `.uidx` file may now carry a
  `## Contract` (props, events, slots, form, accessibility; `<State>` only for
  states the element produces itself, since a visual boolean prop is a state
  and `hover`/`focus`/`active` are the browser's; `<Part>` descriptions are
  optional, the tree's `part=` bindings being the declaration),
  `## Behavior` guidelines, `## Models` and `## Examples` after its visual
  contract, and a `<Styles>` table beside the root. Models are shared across
  pages and named by a prop's type (`Contact`, `Contact[]`). Any layer of a
  component repeats over a list with `repeat="{items}"` — or `{person.tags}`
  inside an outer repeat, which makes a tree — naming its item with `as`; the
  model's samples decide how many rows the canvas draws; a repeat on a
  `<Slot>` is the one consumers fill. Declarations only: nothing
  in the file computes. The viewer draws a styles table as the variant set it
  derives, resolves `{item.field}` bindings to a model's samples and `{prop}`
  to the prop's `sample` or default, expands a repeat into sample rows (a
  model declared on another page included), and resolves an instance's
  `props={{ label: '{label}' }}` in the consuming component's scope. A `<Slot>` that states no size hugs its placeholder. `uidx check` audits the regions against each
  other and the tree; `uidx contract` prints them as JSON.
- `@uidx/codegen` and `uidx codegen`: HTML/CSS and React rendered from the
  identities over headless custom elements, with props, events and slots from
  the contract — a plain slot as a `ReactNode` prop, a repeating slot as its
  list prop plus a render prop named after it, a repeat elsewhere as a `map`
  in place — and each contract checked against the headless library's
  `custom-elements.json`.
- `examples/design-system`: Checkbox, Field, CheckboxField, Button and a
  contact list rendered end to end over `@hwc/components`, with the generated
  output committed and checked for drift.
- A state is designed on the canvas: the derived variants a styles table draws
  are selectable, and a change to one writes the matching cell of its style
  row (the new `style` patch op), while a change to the default combination
  edits the base tree. The inspector names the state it is editing. A base
  layer chosen in the rail is drawn by the default state, so that is what the
  canvas highlights, and the default state chosen on the canvas is the base
  layer in the inspector. The toolbar gains a Repeat tool that repeats the
  selected layer over the first list its component's contract can place; the
  first row of a repeat is the layer itself, the rows after it its echoes.
- A **Models** face beside Tokens and Fonts: every model of the document
  with the page that declares it and the components that receive it, edited
  in place (description; fields with type, key, optional, sample and words),
  a new model declared on a chosen page — a `models` page being the shared
  one — and models a contract names but nobody declares offered for
  declaring. The new `model` and `field` patch ops write one `<Model>` back
  canonically and invert. A sample changed there redraws every repeat of it,
  and a repeat's row in the Contract tab links to its model.
- An instance inside a repeat shows what it receives: the Contract tab lists
  its definition's contract props with the item each one receives, inferred
  by type from the enclosing repeats the way the code target passes it, and
  lets the use say otherwise (`props={{ node: '{child}' }}`). A text binds to
  an item's field or a component prop from a picker beside its content, and
  a `{…}` typed there is written as a binding rather than resolved away. A
  slot the tree has and the contract lacks is listed with a Declare button;
  a repeat on a container holding one row offers to move onto the row. Make
  component warns when the page already has one, since the two would share
  its contract. A new slot hugs what fills it; placing an instance with a
  slot selected fills that slot, and the picker leaves out the component
  the instance would sit inside. Removing the last declaration removes the
  empty `## Contract` heading; `uidx codegen` takes directories as `check`
  does.
- Reviewed against Builder.io, Plasmic, Framer, Webflow, Figma and Penpot,
  for a designer's first hour: a text is typed where it is drawn (the Text
  tool opens it for typing, a double-click reopens it; Escape or ⌘Enter
  keeps the words); a right-click menu offers the toolbar's actions with
  their shortcuts; the status strip says "Saving…" and "All changes saved";
  an empty page says how to start; the "Inside …" breadcrumb names the
  container by its current name; the Contract tab leads with properties
  and slots and folds the code binding and code library under "for
  developers"; the overview counts pages "with content" and "problems"
  instead of "drawable" and "parse"; the file-error overlay leads with what
  happened in plain words; the Models face explains itself without jargon.
- For designers who never open the file: a page that cannot be drawn keeps
  its last frame and says why in a banner instead of going blank; a number
  field commits on Enter as well as on leaving it; declaring a prop offers
  its type, and a boolean comes with `default={false}`; a checkbox, a
  number or the visibility pill binds to an item's field or a prop from a
  picker beside it, as a text does, and any `{…}` committed from the inspector is
  written as the binding it is.
- From a second walkthrough, a tree with a disclosure chevron: a visual prop
  draws its state set at once, rows or no rows, so the first style row is
  written by selecting the state on the canvas rather than by hand; rotation
  is a look a state may set (a chevron turns when a row opens), rendered as a
  transform by the CSS target; a use's bound value chooses the state on the
  canvas, so rows repeat open or closed as their samples say; a text bound to
  a boolean or a number is spelled out rather than crashing the layout; the
  canvas receives the shared model index it was meant to (a list's model on
  another page now draws its samples on the canvas, not only in thumbnails);
  a pen-drawn vector stays stroked in the code targets; the Repeat tool names
  a nested repeat's item after its list (`child` for `{item.children}`) and
  offers the enclosing item's lists first; a sized component's layout reads
  Free, so choosing Column writes it; an instance's bound prop is no longer
  called mistyped.
- Fixed: a component edited structurally kept its contract (the incremental
  patch path dropped the spec until a full parse), and `uidx check` no longer
  reports `repeat="{items}"` or `{item.field}` as unknown component
  properties.
- The Contract tab edits the contract: each prop, event, slot, state and
  part opens into a small form (description, type, default, sample, flags;
  a slot's `accepts`), a row adds one, and "Fill from library"
  declares what the implemented element exposes and the contract lacks. The
  new `contract` patch op writes one declaration in canonical form.
- `uidx.json` gains an optional `codegen` (`out`, `targets`): `uidx codegen`
  needs no `--out`, and the Contract tab's Generate button renders the code
  targets from the server into that folder, reporting what it wrote.
- The inspector gains a **Contract** tab beside Design. A component chooses
  the headless element it implements from the library; its parts are bound to
  layers from the component's list or from the layer's own row, and any layer
  picks the list it repeats over and its item's name. The tab shows the
  file's contract beside the bindings and counts the parts still to bind.
  `uidx.json` gains an optional `"headless"` path to the library's
  `custom-elements.json`, served to the viewer and used by `uidx codegen` when
  `--manifest` is absent. Parts a library exposes as shadow parts (`cssParts`)
  are offered beside element parts and marked; the code target styles them
  through `::part()`. `headless` may also be an object with a `profile` (how
  the library reflects props, its own states and parts) and `bindings` (its
  names per component), so one design renders over libraries that spell
  things differently; when nothing is named, the Contract tab offers the
  libraries the project's dependencies ship and writes the choice.

## 0.1.6 — 2026-09-25

- The first `uidx dev` sets up the workspace itself when the install script did
  not run: recent npm versions block a package's install scripts until they are
  approved, which left a fresh install with no `.uidx/`, no `uidx` scripts and
  no skills. The setup is the same one the install script performs, and the
  command says what it added.

## 0.1.5 — 2026-09-20

- The prebuilt viewer is served by `@uidx/server`'s own static server instead
  of `vite preview`. Vite, and the platform-specific native binaries Vite 8
  runs on (rolldown, lightningcss), are no longer runtime dependencies of
  `@uidxkit/uidx`; an install whose optional native packages did not match the
  machine — a lockfile made on another OS, optional dependencies switched off,
  an unsupported libc — failed with `ERR_MODULE_NOT_FOUND` on the first `uidx`
  command. Installs are also about 30 MB smaller. `--viewer-dev` still boots a
  Vite dev server from a source checkout.
- Windows: `uidx read`, `uidx render` and the agent tools find the document
  again. Manifest discovery answered forward-slash paths that never matched
  the backslash root, so every command reported no `uidx.json` under a project
  that had one.
- Windows: rendering no longer aborts with `ENOENT … D:\D:\…canvaskit.wasm`.
  The bundled drawing SDK turned the CanvasKit file URL into a path through
  `URL.pathname`, which is not a filesystem path on Windows.

## 0.1.4 — 2026-09-15

- Canvas: a press selects the element under it immediately, the way Figma
  does, instead of waiting for the release; a click that wobbles a few pixels
  stays a click rather than nudging what it selected (#15).
- Canvas: the rotation grip drawn on a stem above the selection now responds —
  it shows the rotate cursor and dragging it turns the element, with the angle
  shown beside the pointer. Previously it was painted but not a target; only
  the invisible zones outside the corners rotated, and those still do (#16).
- Properties: scrubbing or typing corner radius and padding now previews live
  in the field and on the canvas, like every other numeric field, with one
  write to the file on release (#17, #18).
- Canvas: moving, nudging or rotating an element on the canvas is now written
  to the `.uidx` file. Previously only panel edits were persisted, and a canvas
  gesture silently reverted on reload (#19).

## 0.1.3 — 2026-09-13

- Update `typescript-eslint`, `ai-sdk-ollama`, `@ai-sdk/anthropic` and `zod`
  dependencies.

## 0.1.2 — 2026-09-13

- Document third-party license notices for the libraries statically linked into
  CanvasKit (FreeType, HarfBuzz, libjpeg-turbo, libpng, zlib, ICU, Wuffs) and note
  that Google Fonts imports retain their own licenses.
- Update `vite`, `vitest`, `ai`, `@ai-sdk/openai-compatible` and development-tool
  dependencies; bump GitHub Actions to their latest pinned versions.

## 0.1.1 — 2026-09-12

- Refresh the GitHub and npm READMEs and workflow image for `@uidxkit/uidx`.
- Show project-local npm installation and remove local-checkout installation
  instructions from the READMEs.

## 0.1.0 — 2026-09-12

- Project-local `@uidxkit/uidx` devDependency with automatic workspace, npm-script,
  skill and MCP setup; explicit setup remains available.
- One release tarball containing the server, viewer and patched drawing SDK.
- Bidirectional `.uidx` editing, reusable components, variables, fonts and
  project-bound CLI/MCP tools.
- MIT licensing, third-party notices, contributor and security policies,
  release validation and local-server request protections.
- Node 22.19 minimum, Node 24 LTS development runtime, patched dependencies
  and a verified image-size security backport included in consumer installations.
