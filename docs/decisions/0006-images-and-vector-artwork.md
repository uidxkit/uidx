# ADR 0006 — Artwork: rasters are referenced, vectors are inlined and authored, reuse is a component

Status: **accepted**, 2026-08-22.

§2's open question — a path in the file or the content hash the SDK speaks —
was put to the author and answered: **path**. §6 and §8 were ratified by
direction rather than by review ("author vector content here, do not only
import it"), and D11 shipped against §8. §9 was written after the author last
read this file and is the one section that has not been looked at; it is an
implementation route rather than a format decision, so it is marked accepted
with that noted rather than held back.

## Context

Artwork reaches a design in three shapes, and they are not one problem:

1. **A raster** — a photograph, a screenshot. Opaque bytes.
2. **Vector artwork, used once** — an illustration on one page.
3. **Vector artwork, used everywhere** — an icon, a logo, a symbol. The same
   geometry on twelve pages, wanting one source of truth.

The first needs a decision, and it is the one this ADR started as. The second
already shipped: D8's importer reads an SVG's `d` strings into `<Vector>` nodes.
The third is the one that is easy to leave implicit, and it is a different
question again — not "where do the bytes live" but "what makes two drawings the
same drawing". Answering only the first would leave the format with a good story
for photographs and no stated story for an icon set, which is the artwork a
design system actually has most of.

Underneath all three sits a fourth question, and it is the one that decides
whether the editor is a viewer with edit affordances or a drawing tool: **can
vector geometry be authored on the canvas and written back?** The prop table
says no. §8 measures it and says yes.

### The raster question

A `.uidx` file is text, and §9.1's "never reprint" makes every edit a span
replacement over recorded offsets. Bytes cannot live in it: a base64 blob would
be a single attribute value megabytes long, unreviewable in a diff and
re-serialised on every touch. So a raster in a UIDX document is necessarily a
*reference*, and the only real question is what it refers to.

That question is not cosmetic. It decides:

- what a reviewer sees in a pull request when a logo changes;
- whether two pages using one logo share a byte or a path;
- what `.fig` export (F2) has to pack, and what it can look up;
- what `uidx check` can verify, and therefore what CI can fail on.

### What the SDK holds (measured, 0.14.0)

- `SceneGraph` carries `images: Map<string, Uint8Array>` — a store keyed by
  hash, held on the graph rather than on any node.
- `computeImageHash(data: Uint8Array): string` from
  `@open-pencil/scene-graph` produces that key.
- A `Fill` carries `imageHash?: string`, `imageScaleMode?: ImageScaleMode`
  (`'FILL' | 'FIT' | 'CROP' | 'TILE'`) and `imageTransform?: GradientTransform`
  for crop. There is **no** `<Image>` node type: `NodeType` has none, and an
  image in this SDK is a paint like any other.
- Nothing in the SDK reads or writes image bytes from a path. Loading is the
  host's job, which means it is ours.
- **An image fill decodes through CanvasKit's raster decoder.**
  `applyImageFill` (`canvas/fills.js`) looks the hash up in `graph.images` and
  calls `ck.MakeImageFromEncoded(data)`, which handles PNG, JPEG, WebP and GIF.
  It returns null for an SVG, and the next line is `if (!decoded) return false`
  — the fill silently does not draw. **An SVG therefore cannot be an image fill
  in this renderer**, which settles a question that would otherwise be a matter
  of taste.
- Vector artwork has its own route and it is nodes, not paints:
  `createSVGNodes(graph, parentId, source)` builds a subtree. The SDK agrees
  with the format that vectors are geometry and rasters are paint.

### What this repo already has

- `uidx.json` declares `{ id, files }` and is read by
  `packages/server/src/document.ts`; ADR 0004 §1 made it the one place a
  document says what it is made of.
- C8 ships a paint stack that holds solids and gradients, normalised through
  `normalizeFills`. It has no `IMAGE` branch.
- `uidx check` already fails a build on an error diagnostic (A1).

## Decision

### 1. An image is a fill, not an element

Figma's model, and ADR 0002 says the authored surface tracks Figma rather than
the scene graph. There is no `<Image>` element; a photograph is a `<Rectangle>`
or a `<Frame>` whose `fills` contains an image paint:

```jsx
<Rectangle
  name="hero"
  width={640} height={360}
  fills={[{ type: 'IMAGE', src: 'assets/hero.jpg', scaleMode: 'FILL' }]}
/>
```

This also means images inherit the paint stack whole: order, opacity,
visibility, and stacking under or over a solid all work already, because an
image paint is a member of the same array.

### 2. The reference is a path relative to the manifest, not a hash

`src` is a POSIX-style path resolved against the directory holding `uidx.json`
— the same root `files` is resolved against. Not against the `.uidx` file, so
moving a page between folders does not rewrite every image in it.

**Why a path and not the hash the SDK already speaks.** The hash is what the
*scene graph* needs and it is trivial to compute on load; it is a poor thing to
put in a file a person reads. Three reasons decide it:

- **A diff has to be readable.** `src="assets/logo.svg"` →
  `src="assets/logo-2026.svg"` states what happened. `imageHash="a3f1…"` →
  `imageHash="9c02…"` states that something happened.
- **A hash needs a store, and a store needs a garbage collector.** Content
  addressing only pays for itself with a content-addressed store — one more
  moving part, one more thing to corrupt, and one more thing that has to be
  explained before a designer can add a logo.
- **Sharing already works.** Two pages naming `assets/logo.svg` share the file
  on disk; the loader dedupes by hash *in memory*, which is where dedupe
  matters. The file-level indirection buys nothing the filesystem is not
  already doing.

The hash does not disappear — it is computed at load time and is what reaches
`imageHash` in the scene graph. It is derived, so it is never authored.

### 3. `uidx.json` declares where assets may live

```json
{ "id": "uidx", "files": ["**/*.uidx"], "assets": ["assets/**"] }
```

`assets` is a glob list. A `src` outside it is a diagnostic, which is what keeps
a document self-contained: no `../../Desktop/logo.png`, and nothing reachable
that the document did not say was part of it. This is the same statement `files`
makes, for the same reason (ADR 0004 §1).

**The default, when `assets` is absent, is the conventional folders rather than
one of them:**

```
assets/**    images/**    icons/**
```

Because there is no single convention — a repo keeps artwork in `assets/`, or
splits it into `images/` and `icons/`, and both are ordinary. Defaulting to one
would make the other a configuration step for something nobody thinks of as
configuration. A document that wants a different layout, or wants to narrow
these, says so and the declaration replaces the default outright.

Declaring a folder that does not exist is not an error: the globs say what is
*allowed*, not what is *present*, and a document with no icons yet is not
malformed. What is an error is a reference to a file that is not there (§4).

Paths are constrained: relative, POSIX separators, no `..` segment, no leading
`/`, no scheme. A remote URL is refused rather than fetched — G7's no-network
rule is not negotiable for the renderer, and a design that only draws when the
CDN is up is not a design contract.

### 4. A reference with nothing behind it is an error, in `uidx check`

`UIDX3xx: asset "assets/hero.jpg" does not exist` fails the build. A missing
asset is a broken design, and CI is where a broken design should surface —
not the viewer, and not a designer's eye three weeks later. The viewer draws a
labelled placeholder for the same case, because the last good render is worth
more than an empty box (§11).

### 5. `scaleMode` is the authored spelling of `imageScaleMode`

`FILL | FIT | CROP | TILE`, its own enum domain in the prop table, mapping
straight through. `imageTransform` (the crop rectangle) is **deferred**: it is
a matrix nobody hand-writes, it needs a cropping gesture to be worth anything,
and `CROP` without it still means "cover, centred", which is a usable default.
A file carrying one from a `.fig` import round-trips untouched.

### 6. Vector artwork is inlined, not referenced

An SVG dropped on the canvas becomes `<Vector>` nodes carrying its `d` strings
(D8, shipped). It does **not** become `<Vector src="assets/logo.svg">`.

The asymmetry with §2 is the point, and it is principled rather than
convenient: **content that can be text is text; bytes that cannot be text are
referenced.** A raster is opaque — no amount of good will makes a JPEG readable
in a diff, so it is referenced and the reference is made as readable as
possible. Vector geometry is *already* the kind of thing this format is made of.
Pushing it behind a reference would mean a `.uidx` file that no longer states
what it draws, which is the one thing the format exists to do:

- A reviewer could not see that a logo changed shape, only that a filename did.
- `uidx check` could not validate the geometry, because it would not have it.
- F2's export would have to inline the paths anyway, so the indirection buys
  nothing downstream.
- `<Vector>` would mean two different things depending on which attribute was
  present, and every consumer would need both branches.

The measured SDK fact above says the same thing from the other side: an image
fill cannot decode an SVG, and vectors arrive as nodes. Nothing in the stack
wants a referenced vector.

### 7. Reuse is a component, not an asset

The third shape of artwork — one icon on twelve pages — is not an asset problem
and does not go through `assets` at all. It is what components are for, in Figma
and here:

```jsx
// icons.uidx — the definitions
<Page>
  <Component name="Icon/Check" status="stable">
    <Vector name="path" vectorPaths={[{ windingRule: 'NONZERO', data: 'M2 8 L6 12 L14 4' }]} />
  </Component>
</Page>

// anywhere else — the uses
<Instance component="Icon/Check" />
```

One copy of the geometry, twelve references to it, and the reference is a
*name* — which ADR 0004 already made global to the document, so no path and no
import. Editing the component changes every instance, which is exactly the
single-source-of-truth an asset reference was reaching for, obtained from the
mechanism the format already needs for everything else.

So the workflow an icon takes is: **drop the SVG → get `<Vector>` nodes → make
them a `<Component>` → place `<Instance>`s.** The first is D8, the last is F3,
and the middle step has no story — see below.

### 8. Authored vector geometry writes back, because it round-trips

`prop-table.ts` marks `vectorPaths` one-way, on the grounds that "reconstructing
a `d` string from a VectorNetwork is lossy" and that "v1 ships no vector editing
tools, so nothing can originate a geometry change on the canvas". The second
clause is a scope statement and is about to stop being true. The first is worth
measuring rather than inheriting.

**Measured (0.14.0):** `parseSVGPath(d)` → `vectorNetworkToSVGPaths(network)` →
`parseSVGPath` again → emit again reaches a **fixed point after one pass**, for
every input tried — lines, cubics, quadratics, smooth curves, arcs, multiple
subpaths, closed and open. The first pass normalises:

| in | out | exact? |
|---|---|---|
| `M0 0 L10 0 L10 10 Z` | `M0 0L10 0L10 10L0 0Z` | yes — the closing line made explicit |
| `M0 0 C 5 0, 10 5, 10 10` | unchanged | yes |
| `M0 0 Q 5 10, 10 0` | `M0 0C3.33 6.67 6.67 6.67 10 0` | yes — Q→C is an exact conversion |
| `M0 0 C… S 8 8, 10 10` | explicit `C` | yes — S is shorthand |
| `A 5 5 0 0 1 10 10` | two cubics | **no** — approximated |

So the loss is real but it is *entirely in the arc*, and it happens on the way
**in** (`parseSVGPath` calls `.unarc()`), not on the way out. Everything a
drawing tool produces — lines and cubic curves — survives exactly, and after
the first normalisation the text never moves again.

**Therefore `vectorPaths` becomes writable**, and the editor may author vector
geometry. Three constraints come with it:

- **The write is vouched, never inferred.** `fromScene` returning a value
  unconditionally would rewrite a path's spelling on any unrelated edit to the
  node — the normalisation above, arriving as format churn nobody asked for.
  Instead a vector gesture vouches for `vectorPaths` through the `authored`
  signal `fromSceneChange` already takes (C7 built it for exactly this shape of
  problem). Nothing else can originate a geometry write.
- **Editing an imported arc converts it, once, visibly.** The first edit to a
  path containing an `A` replaces it with cubics. That is what every vector
  editor does — Figma's vector network has no arc primitive either — but it is
  a real change to a file the author did not ask to reformat, so the editor
  says so before the first edit rather than after.
- **Precision is two decimals**, which `vectorNetworkToSVGPaths` rounds to. At
  icon scale that is invisible, and because the text is a fixed point it does
  not drift over repeated edits.

### 9. The bytes reach the viewer over the server's own origin

§2 says where an image lives; it did not say how it gets drawn, and the gap is
real: the bytes are on disk, the renderer is in a browser, and
`graph.images` wants a `Uint8Array` keyed by `computeImageHash`.

The server already runs Vite and already speaks to the viewer. It gains one
route — `/__uidx/asset/<document-relative path>` — which resolves against the
manifest directory, refuses anything outside the declared `assets` globs, and
streams the file. The viewer fetches it, hashes it, puts it in `graph.images`
and points the fill's `imageHash` at it.

- **This is not a hole in G7's no-network rule.** That rule is about the
  *renderer* not reaching the internet; this is the viewer asking its own
  server for a file the document declares, on the origin it was served from.
  The viewer already loads its wasm and its fonts that way.
- **The same-origin route is what makes the path check enforceable.** A
  reference is resolved once, on the server, against the globs — so a `..`
  that slipped past the client cannot read a file the document never declared.
  Validation that only ran in the browser would be a suggestion.
- **The alternative was pushing bytes down the socket** with `file:changed`.
  Rejected: it re-sends a logo on every keystroke-driven save, it makes the
  patch envelope a transport for megabytes, and it forfeits the browser cache
  that an HTTP route gets for nothing.

`uidx check` needs none of this — it has the filesystem, which is why §4's
diagnostic belongs there rather than in the viewer.

## What this changes elsewhere

- **D8's image half** is unblocked and becomes: manifest `assets`, the asset
  route (§9), the loader, the `IMAGE` paint in the prop table, the check
  diagnostic, and a paint control that shows the picture.
- **`prop-table.ts`'s `vectorPaths` entry** gains a `fromScene` and loses its
  one-way comment. Its reasoning is superseded by the measurement in §8, not
  ignored — the entry should say what changed and why.
- **D1's placeholder triangle goes.** The creation toolbar gives a new
  `<Vector>` a default triangle because a path-less vector renders nothing; once
  the pen tool exists, `P` draws instead of placing and the placeholder has no
  reason to exist.
- **A story is missing, and §7 is what surfaced it.** Nothing in the backlog
  turns a selection into a `<Component>` — Figma's "make component", the step
  between importing an icon and instancing it. F3 places instances and assumes
  the definition already exists, which today means hand-editing the file. Added
  as **F10**; it is a small structural patch and does not block F3.
- **F2 (`.fig` export)** must pack the referenced bytes into the archive and
  swap the path for the hash the format wants. That is a read of a file the
  manifest already declares, which is why declaring it matters.
- **C8's paint stack** gains a third kind. The read-only-with-a-reason path C5
  built is what an image paint looks like until its own control exists.
- **`uidx fmt`** is unaffected: `src` is an ordinary string attribute.

## Consequences

- **A document is a directory, not a file.** It already was — `uidx.json` plus
  many `.uidx` — and this makes it plainer. Sending someone a single `.uidx`
  with a logo in it does not work, and never could have.
- **Renaming an asset breaks every reference to it**, and nothing in the format
  will notice until `uidx check` runs. That is the same failure a renamed
  component has, and the same answer: CI catches it.
- **Two documents cannot share one asset directory** without both declaring it.
  Deliberate: a document that reaches outside its own root is not portable, and
  libraries (F4) are the story for cross-document sharing.
- **An externally maintained icon set does not re-sync.** If a designer ships
  `icons/*.svg` from Illustrator and changes one, nothing notices: the geometry
  was copied into a component when it was imported. The answer today is to
  re-import and let the diff show what moved — which at least *is* a readable
  diff, because §6 put the geometry in the file. A recorded provenance
  attribute (`<Component data-source="icons/check.svg">`) would let a command
  re-import in place, but §3.3's whitelist has no room for an attribute with no
  consumer, so it waits until something would actually use it. F4 (libraries) is
  the longer answer for artwork maintained outside the document.

- **Two more stories follow from §8**, and they are what makes vector artwork
  authorable rather than only importable: **D11** (the pen tool) and **D12**
  (editing an existing path's vertices).

## Rejected alternatives

- **Content hash in the file, bytes in a store.** What the SDK speaks
  natively, and what Figma does. Rejected for the diff: the point of a text
  design contract is that a reviewer can read the change, and a hash is
  precisely the thing that cannot be read. Deriving the hash on load costs one
  pass over bytes we already had to load.
- **Base64 in the attribute.** Rejected outright — it defeats "never reprint",
  makes diffs useless, and puts megabytes through the patch path.
- **An `<Image>` element.** Rejected by ADR 0002: the authored surface tracks
  Figma, and Figma has no image node. It would also need its own answer for
  every question the paint stack already answers.
- **Absolute paths, or paths relative to the `.uidx` file.** Absolute paths are
  not portable between machines. File-relative paths rewrite themselves when a
  page moves between folders, which turns a file move into a content diff.
- **Remote URLs.** Rejected by G7's no-network rule, and because a contract
  that renders differently depending on whether a host is up is not one.
- **`<Vector src="assets/logo.svg">` — a referenced vector.** The symmetric
  option, and the tempting one: one file to edit, small diffs, artwork
  maintained in a real illustration tool. Rejected because it makes a `.uidx`
  file stop stating what it draws. The format's whole claim is that the design
  contract is readable and diffable; a vector behind a filename is the one case
  where we would be choosing not to state something we perfectly well could.
  The re-sync problem it solves is real, and §7 plus the consequence above say
  what to do about it instead.
- **An SVG as an image fill.** Not a design choice — measured above, the
  renderer's `MakeImageFromEncoded` returns null for SVG and the fill silently
  does not draw. Rasterising it first would throw away the resolution
  independence that is the reason to have a vector at all.
- **Keeping `vectorPaths` one-way and editing the `d` string directly** —
  parsing the text, moving a vertex in it, re-emitting, never touching the
  network. It would preserve arcs through an edit, which is the one thing §8
  gives up. Rejected because it means a second geometry engine: hit-testing a
  vertex, dragging a handle and previewing all need the network the renderer
  already has, so the editor would maintain two representations and reconcile
  them. The arc is not worth that — it survives untouched until someone edits
  the path, which is the same bargain every vector tool offers.
- **A `<Symbol>` element distinct from `<Component>`.** Rejected: it is a
  component with a different name. Figma has one concept here and ADR 0002 says
  the authored surface tracks Figma. An icon is not a different kind of thing
  from a button.
