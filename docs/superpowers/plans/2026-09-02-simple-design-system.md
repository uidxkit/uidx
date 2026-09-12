# Simple Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author *Simple*, a uidx design system in the Ericsson Design System register: a three-tier, two-mode token page, 22 component documentation pages, and one dashboard page composed from instances, all passing `uidx audit`.

**Architecture:** Pages are generated, not typed. A small Node library under `design-systems/simple/build/` turns one *descriptor* per component (axes, props, a variant-tree builder, section copy) into edit-op batches that `uidx apply` runs through the same gates and audits the harness uses. The tokens page is hand-authored once; every generated node binds its tokens by alias. Each page is built in three applied batches (component + cover/overview, anatomy/properties/states, the remaining seven sections), audited between batches, then given its prose with `uidx intent`.

**Tech Stack:** uidx CLI (`packages/cli/dist/uidx.js`, rebuilt this session), Node 22.15.0 (`PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH` — default node 18 fails with ERR_REQUIRE_ESM), `node:test` for the generator, git on `main` (no worktree, per project convention).

**Spec:** `docs/superpowers/specs/2026-09-02-simple-design-system-design.md`

## Global Constraints

- Root is `design-systems/simple/`; manifest `{ "id": "simple", "files": ["*.uidx"] }`. Component names are plain (`Button`, `Tile`), no group prefix.
- Every fill, stroke, size, gap, radius and font size on every page binds a token alias `"{collection#name}"`. Raw numbers appear only inside `characters`, in vector path data, and in absolute `x`/`y`.
- Never put a token alias inside `characters`. Document a value by typing it: `"3 (radius#control)"`.
- `<Component>` is a page child at `x={1700}`, never inside a frame. Its first insert carries every variant.
- Twelve sections in this order under one `doc` frame: `cover, overview, anatomy, properties, states, measurements, in-context, guidance, accessibility, content, related, changelog`.
- States grid cells are `<Instance>`s; an undesigned combination is `<Text characters="not designed" width={90} />`, never blank.
- Modes: `color` collection declares `modes={['dark', 'light']}`; dark is the default (leftmost). A light specimen is a frame with `modes={{ color: 'light' }}`.
- Characters must be drawable by bundled Inter (Regular, Medium, SemiBold, Bold): use `Ø` not `⌀`, `×` not `✕`, `→` and `•` are fine. There is no Light face: figures use `fontWeight={400}`.
- The renderer has no dash support: EDS's dotted dividers are drawn as solid `hairline` rectangles and the spec's `## Design` says so.
- Every CLI call is `node packages/cli/dist/uidx.js <cmd> design-systems/simple …` from the repo root with Node 22 on PATH. Every page's task ends with `uidx audit design-systems/simple --page <page>` exiting 0, a rendered PNG viewed with the Read tool, and one commit on `main` ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: Root, manifest and the tokens page

**Files:**
- Create: `design-systems/simple/uidx.json`
- Create: `design-systems/simple/tokens.uidx`
- Create: `design-systems/simple/README.md`

**Interfaces:**
- Produces: collections `space`, `radius`, `type`, `size`, `palette`, `color` (moded), `button`, `switch`, `input`, `table`, `map`. Every later task binds these by the exact names below.

- [ ] **Step 1: Create the manifest and README**

```bash
mkdir -p design-systems/simple && cat > design-systems/simple/uidx.json <<'EOF'
{
  "id": "simple",
  "files": ["*.uidx"]
}
EOF
cat > design-systems/simple/README.md <<'EOF'
# Simple

A uidx design system in the register of the Ericsson Design System: dark,
dense, data-first, with a light mode. Spec:
`docs/superpowers/specs/2026-09-02-simple-design-system-design.md`.

    export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
    node packages/cli/dist/uidx.js audit design-systems/simple
    node packages/cli/dist/uidx.js open design-systems/simple/dashboard.uidx --root design-systems/simple

Pages are generated from `build/components/*.mjs` by `node build/run.mjs <id>`;
`tokens.uidx` is hand-authored.
EOF
```

- [ ] **Step 2: Write the tokens page**

Write `design-systems/simple/tokens.uidx` with exactly this content (hex → 0–1 floats, three decimals):

```mdx
---
id: tokens
tags: [foundation]
---

## Core Intent

Three surfaces, one step apart, and the step is the only separator. `layer-0`
is the system bar, `layer-1` the page, `layer-2` the card; nothing casts a
shadow and nothing is outlined unless it is a control. Colour is meaning:
`brand` is the one blue and it means "act here"; `danger`, `alert`, `warn` and
`ok` are the four statuses; every other mark is `mark` white. A screen with a
second blue, or a green used for decoration, has left the system.

Spacing is five steps of a base 8 with a 4 half-step; radius is 3 on controls
and 4 on cards, so corners read as near-square. Type is one family in four
sizes for text (12, 14, 16, 20) and two for figures (32, 48).

## Design

- Layers stack `layer-0` < `layer-1` < `layer-2` < `layer-raised`; a region is
  separated by stepping the layer or by a 1px `hairline`, never by shadow.
- Dotted dividers in the reference are drawn solid: the renderer has no dash.
- `text-muted` is text at 60% alpha, declared per mode as a literal because the
  palette carries no alpha steps.
- Component collections reference `color`; `color` references `palette`;
  `palette` references nothing. A token never reaches a higher tier.
- Dark is the leftmost mode and therefore the default everywhere.

## Anti-Patterns

- NEVER type a hex or an rgb into a page. If a colour has no name here, it
  is not in the system.
- NEVER use `brand` for a heading, a divider or an icon at rest. Blue means
  "act here" and only that.
- NEVER add a fourth status hue. Extreme is `danger`, high is `warn`, low is
  `mark-muted` — severity is three steps and a neutral.
- NEVER give a card a stroke. A card is a `layer-2` fill on a `layer-1` page.

## Visual Contract

<Tokens>
  <Collection name="space" tier="primitive">
    <Variable name="hair" type="FLOAT" value={1} />
    <Variable name="xs" type="FLOAT" value={4} />
    <Variable name="sm" type="FLOAT" value={8} />
    <Variable name="md" type="FLOAT" value={16} />
    <Variable name="lg" type="FLOAT" value={24} />
    <Variable name="xl" type="FLOAT" value={32} />
    <Variable name="xxl" type="FLOAT" value={48} />
  </Collection>

  <Collection name="radius" tier="primitive">
    <Variable name="control" type="FLOAT" value={3} />
    <Variable name="card" type="FLOAT" value={4} />
    <Variable name="pill" type="FLOAT" value={999} />
  </Collection>

  <Collection name="type" tier="primitive">
    <Variable name="micro" type="FLOAT" value={11} />
    <Variable name="caption" type="FLOAT" value={12} />
    <Variable name="body" type="FLOAT" value={14} />
    <Variable name="title" type="FLOAT" value={16} />
    <Variable name="heading" type="FLOAT" value={20} />
    <Variable name="display" type="FLOAT" value={32} />
    <Variable name="hero" type="FLOAT" value={48} />
  </Collection>

  <Collection name="size" tier="primitive">
    <Variable name="bar" type="FLOAT" value={48} />
    <Variable name="nav" type="FLOAT" value={248} />
    <Variable name="control" type="FLOAT" value={32} />
    <Variable name="input" type="FLOAT" value={28} />
    <Variable name="pill" type="FLOAT" value={20} />
    <Variable name="icon" type="FLOAT" value={16} />
    <Variable name="dot" type="FLOAT" value={8} />
    <Variable name="hub" type="FLOAT" value={24} />
    <Variable name="gauge" type="FLOAT" value={200} />
    <Variable name="radial" type="FLOAT" value={140} />
    <Variable name="row" type="FLOAT" value={31} />
  </Collection>

  <Collection name="palette" tier="primitive">
    <Variable name="black-12" type="COLOR" value={{ r: 0.047, g: 0.047, b: 0.047, a: 1 }} />
    <Variable name="black-24" type="COLOR" value={{ r: 0.094, g: 0.094, b: 0.094, a: 1 }} />
    <Variable name="black-36" type="COLOR" value={{ r: 0.141, g: 0.141, b: 0.141, a: 1 }} />
    <Variable name="black-45" type="COLOR" value={{ r: 0.176, g: 0.176, b: 0.176, a: 1 }} />
    <Variable name="black-51" type="COLOR" value={{ r: 0.2, g: 0.2, b: 0.2, a: 1 }} />
    <Variable name="gray-64" type="COLOR" value={{ r: 0.251, g: 0.251, b: 0.251, a: 1 }} />
    <Variable name="gray-78" type="COLOR" value={{ r: 0.306, g: 0.306, b: 0.306, a: 1 }} />
    <Variable name="gray-118" type="COLOR" value={{ r: 0.463, g: 0.463, b: 0.463, a: 1 }} />
    <Variable name="gray-176" type="COLOR" value={{ r: 0.69, g: 0.69, b: 0.69, a: 1 }} />
    <Variable name="gray-200" type="COLOR" value={{ r: 0.784, g: 0.784, b: 0.784, a: 1 }} />
    <Variable name="gray-224" type="COLOR" value={{ r: 0.878, g: 0.878, b: 0.878, a: 1 }} />
    <Variable name="gray-235" type="COLOR" value={{ r: 0.922, g: 0.922, b: 0.922, a: 1 }} />
    <Variable name="gray-242" type="COLOR" value={{ r: 0.949, g: 0.949, b: 0.949, a: 1 }} />
    <Variable name="white" type="COLOR" value={{ r: 0.98, g: 0.98, b: 0.98, a: 1 }} />
    <Variable name="blue" type="COLOR" value={{ r: 0, g: 0.51, b: 0.941, a: 1 }} />
    <Variable name="blue-light" type="COLOR" value={{ r: 0.2, g: 0.639, b: 1, a: 1 }} />
    <Variable name="blue-hover" type="COLOR" value={{ r: 0.149, g: 0.588, b: 0.949, a: 1 }} />
    <Variable name="purple-dark" type="COLOR" value={{ r: 0.557, g: 0.271, b: 0.69, a: 1 }} />
    <Variable name="purple-light" type="COLOR" value={{ r: 0.647, g: 0.431, b: 0.745, a: 1 }} />
    <Variable name="green-dark" type="COLOR" value={{ r: 0.157, g: 0.537, b: 0.392, a: 1 }} />
    <Variable name="green-light" type="COLOR" value={{ r: 0.204, g: 0.69, b: 0.498, a: 1 }} />
    <Variable name="yellow-dark" type="COLOR" value={{ r: 0.863, g: 0.686, b: 0, a: 1 }} />
    <Variable name="yellow-light" type="COLOR" value={{ r: 0.949, g: 0.776, b: 0.094, a: 1 }} />
    <Variable name="orange-dark" type="COLOR" value={{ r: 0.902, g: 0.431, b: 0.098, a: 1 }} />
    <Variable name="orange-light" type="COLOR" value={{ r: 0.969, g: 0.522, b: 0.129, a: 1 }} />
    <Variable name="red-dark" type="COLOR" value={{ r: 0.863, g: 0.176, b: 0.216, a: 1 }} />
    <Variable name="red-light" type="COLOR" value={{ r: 0.961, g: 0.137, b: 0.137, a: 1 }} />
  </Collection>

  <Collection name="color" tier="semantic" modes={['dark', 'light']}>
    <Variable name="layer-0" type="COLOR"><Mode name="dark" value="{palette#black-12}" /><Mode name="light" value="{palette#black-12}" /></Variable>
    <Variable name="layer-1" type="COLOR"><Mode name="dark" value="{palette#black-24}" /><Mode name="light" value="{palette#gray-224}" /></Variable>
    <Variable name="layer-2" type="COLOR"><Mode name="dark" value="{palette#black-36}" /><Mode name="light" value="{palette#gray-242}" /></Variable>
    <Variable name="layer-raised" type="COLOR"><Mode name="dark" value="{palette#black-51}" /><Mode name="light" value="{palette#white}" /></Variable>
    <Variable name="text" type="COLOR"><Mode name="dark" value="{palette#gray-242}" /><Mode name="light" value="{palette#black-36}" /></Variable>
    <Variable name="text-muted" type="COLOR"><Mode name="dark" value={{ r: 0.949, g: 0.949, b: 0.949, a: 0.6 }} /><Mode name="light" value={{ r: 0.141, g: 0.141, b: 0.141, a: 0.6 }} /></Variable>
    <Variable name="text-inverse" type="COLOR"><Mode name="dark" value="{palette#black-24}" /><Mode name="light" value="{palette#gray-224}" /></Variable>
    <Variable name="brand" type="COLOR"><Mode name="dark" value="{palette#blue}" /><Mode name="light" value="{palette#blue}" /></Variable>
    <Variable name="brand-hover" type="COLOR"><Mode name="dark" value="{palette#blue-hover}" /><Mode name="light" value="{palette#blue-hover}" /></Variable>
    <Variable name="link" type="COLOR"><Mode name="dark" value="{palette#blue-light}" /><Mode name="light" value="{palette#blue}" /></Variable>
    <Variable name="ok" type="COLOR"><Mode name="dark" value="{palette#green-dark}" /><Mode name="light" value="{palette#green-light}" /></Variable>
    <Variable name="warn" type="COLOR"><Mode name="dark" value="{palette#yellow-dark}" /><Mode name="light" value="{palette#yellow-light}" /></Variable>
    <Variable name="alert" type="COLOR"><Mode name="dark" value="{palette#orange-dark}" /><Mode name="light" value="{palette#orange-light}" /></Variable>
    <Variable name="danger" type="COLOR"><Mode name="dark" value="{palette#red-dark}" /><Mode name="light" value="{palette#red-light}" /></Variable>
    <Variable name="accent" type="COLOR"><Mode name="dark" value="{palette#purple-dark}" /><Mode name="light" value="{palette#purple-light}" /></Variable>
    <Variable name="hairline" type="COLOR"><Mode name="dark" value="{palette#gray-78}" /><Mode name="light" value="{palette#gray-200}" /></Variable>
    <Variable name="hairline-strong" type="COLOR"><Mode name="dark" value="{palette#gray-118}" /><Mode name="light" value="{palette#gray-176}" /></Variable>
    <Variable name="border" type="COLOR"><Mode name="dark" value="{palette#gray-78}" /><Mode name="light" value="{palette#gray-200}" /></Variable>
    <Variable name="border-hover" type="COLOR"><Mode name="dark" value="{palette#gray-118}" /><Mode name="light" value="{palette#gray-176}" /></Variable>
    <Variable name="focus" type="COLOR"><Mode name="dark" value="{palette#blue}" /><Mode name="light" value="{palette#blue}" /></Variable>
    <Variable name="disabled-surface" type="COLOR"><Mode name="dark" value="{palette#black-45}" /><Mode name="light" value="{palette#gray-235}" /></Variable>
    <Variable name="mark" type="COLOR"><Mode name="dark" value="{palette#gray-242}" /><Mode name="light" value="{palette#black-36}" /></Variable>
    <Variable name="mark-track" type="COLOR"><Mode name="dark" value="{palette#gray-64}" /><Mode name="light" value="{palette#gray-200}" /></Variable>
    <Variable name="mark-muted" type="COLOR"><Mode name="dark" value="{palette#gray-118}" /><Mode name="light" value="{palette#gray-118}" /></Variable>
    <Variable name="white" type="COLOR"><Mode name="dark" value="{palette#white}" /><Mode name="light" value="{palette#white}" /></Variable>
  </Collection>

  <Collection name="button" tier="component">
    <Variable name="default-border" type="COLOR" value="{color#text}" />
    <Variable name="default-hover-fill" type="COLOR" value="{color#text}" />
    <Variable name="default-hover-text" type="COLOR" value="{color#text-inverse}" />
    <Variable name="default-active-fill" type="COLOR" value="{color#mark-track}" />
    <Variable name="primary-fill" type="COLOR" value="{color#brand}" />
    <Variable name="primary-hover" type="COLOR" value="{color#brand-hover}" />
    <Variable name="warning-fill" type="COLOR" value="{color#danger}" />
    <Variable name="label" type="COLOR" value="{color#white}" />
    <Variable name="focus" type="COLOR" value="{color#focus}" />
  </Collection>

  <Collection name="switch" tier="component">
    <Variable name="track" type="COLOR" value="{color#layer-raised}" />
    <Variable name="track-on" type="COLOR" value="{color#brand}" />
    <Variable name="knob" type="COLOR" value="{color#white}" />
    <Variable name="border" type="COLOR" value="{color#border}" />
    <Variable name="border-hover" type="COLOR" value="{color#border-hover}" />
    <Variable name="disabled-track" type="COLOR" value="{color#disabled-surface}" />
    <Variable name="disabled-knob" type="COLOR" value="{color#mark-muted}" />
  </Collection>

  <Collection name="input" tier="component">
    <Variable name="fill" type="COLOR" value="{color#layer-0}" />
    <Variable name="border" type="COLOR" value="{color#border}" />
    <Variable name="border-hover" type="COLOR" value="{color#border-hover}" />
    <Variable name="border-focus" type="COLOR" value="{color#brand}" />
    <Variable name="border-error" type="COLOR" value="{color#danger}" />
    <Variable name="placeholder" type="COLOR" value="{color#text-muted}" />
    <Variable name="disabled-fill" type="COLOR" value="{color#disabled-surface}" />
  </Collection>

  <Collection name="table" tier="component">
    <Variable name="divider" type="COLOR" value="{color#hairline}" />
    <Variable name="hover" type="COLOR" value="{color#layer-raised}" />
    <Variable name="selected" type="COLOR" value={{ r: 0, g: 0.51, b: 0.941, a: 0.4 }} />
    <Variable name="header" type="COLOR" value="{color#text}" />
  </Collection>

  <Collection name="map" tier="component">
    <Variable name="surface" type="COLOR" value="{color#layer-2}" />
    <Variable name="road" type="COLOR" value="{color#hairline}" />
    <Variable name="road-major" type="COLOR" value="{color#layer-0}" />
    <Variable name="node" type="COLOR" value="{color#white}" />
    <Variable name="incident" type="COLOR" value="{color#danger}" />
    <Variable name="connector" type="COLOR" value="{color#mark-muted}" />
  </Collection>
</Tokens>
```

- [ ] **Step 3: Check and audit**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node packages/cli/dist/uidx.js check 'design-systems/simple/*.uidx'
node packages/cli/dist/uidx.js audit design-systems/simple
```
Expected: check reports 0 errors; audit exits 0 (a tokens page has no scene, so no geometry faults).

- [ ] **Step 4: Probe the renderer for arcs and weights**

Create a throwaway page to learn three facts the generator depends on: whether a `Vector` with an SVG `A` arc draws, whether `fontWeight={400}` at 48px draws, and whether a node-level `modes={{ color: 'light' }}` changes the fill.

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
cat > design-systems/simple/probe.uidx <<'EOF'
---
id: probe
---

## Core Intent

Throwaway render probe.

## Visual Contract

<Page>
  <Frame name="dark" x={0} y={0} width={320} height={260} fills={[{ type: 'SOLID', color: '{color#layer-2}' }]}>
    <Vector name="arc" x={20} y={20} width={200} height={200}
      vectorPaths={[{ windingRule: 'NONZERO', data: 'M100 6 A94 94 0 0 1 194 100' }]}
      strokes={[{ type: 'SOLID', color: '{color#mark}' }]} strokeWeight={6} strokeCap="BUTT" />
    <Vector name="ring" x={20} y={20} width={200} height={200}
      vectorPaths={[{ windingRule: 'NONZERO', data: 'M100 6 A94 94 0 1 1 99.9 6' }]}
      strokes={[{ type: 'SOLID', color: '{color#mark-track}' }]} strokeWeight={1} />
    <Text name="figure" x={80} y={90} characters="20" fontSize="{type#hero}" fontWeight={400}
      textAutoResize="WIDTH_AND_HEIGHT" fills={[{ type: 'SOLID', color: '{color#text}' }]} />
  </Frame>
  <Frame name="light" x={340} y={0} width={320} height={260} modes={{ color: 'light' }}
    fills={[{ type: 'SOLID', color: '{color#layer-2}' }]}>
    <Text name="figure" x={80} y={90} characters="20" fontSize="{type#hero}" fontWeight={400}
      textAutoResize="WIDTH_AND_HEIGHT" fills={[{ type: 'SOLID', color: '{color#text}' }]} />
  </Frame>
</Page>
EOF
node packages/cli/dist/uidx.js render design-systems/simple probe.uidx -o /private/tmp/claude-501/-Users-guybehar-projects-uidx/3970a1c7-cf7b-4ee7-9d34-b581cfe5fc4d/scratchpad/probe.png
```
Then Read the PNG. Expected: a dark square with a quarter arc and a full thin ring, the figure "20" in white; a light square with the figure in near-black. If the arc does not draw, replace `A` commands in every later task with polylines of 24 `L` segments per quarter (the runner's `arcPath()` helper in Task 2 already emits polylines when `ARC_MODE=poly`). Record the outcome in `design-systems/simple/README.md` under a "Renderer facts" heading. Delete `probe.uidx` before committing.

- [ ] **Step 5: Commit**

```bash
rm design-systems/simple/probe.uidx
git add design-systems/simple
git commit -m "Simple: root, manifest and the three-tier two-mode tokens page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The page generator

**Files:**
- Create: `design-systems/simple/build/lib/n.mjs` — node builders and token handles
- Create: `design-systems/simple/build/lib/icons.mjs` — the eleven glyphs the references use
- Create: `design-systems/simple/build/lib/doc-page.mjs` — descriptor → architecture + three op batches
- Create: `design-systems/simple/build/run.mjs` — drives the CLI for one descriptor
- Create: `design-systems/simple/build/test/n.test.mjs`, `design-systems/simple/build/test/doc-page.test.mjs`
- Modify: `.gitignore` — add `design-systems/simple/.build/`

**Interfaces:**
- Produces `n.mjs`: `T(collection, name)`, `C`, `S`, `TY`, `R`, `Z` token handles; `solid(color)`, `NONE`; `node`, `frame`, `col`, `row`, `text`, `caption`, `figure`, `rect`, `ellipse`, `vector`, `instance`, `slot`, `hairline`, `arcPath(cx, cy, r, startDeg, endDeg)`, `ringPath(cx, cy, r)`.
- Produces `icons.mjs`: `icon.kebab() expand() filter() gear() user() hamburger() chevron() sortChevrons() arrow() check() cross() logo() refresh() plus() minus()`, each returning a 16×16 (or smaller) node.
- Produces `doc-page.mjs`: `docPage(d) → { architecture, batches: [ops, ops, ops], intent }` for a descriptor `d` with the shape documented in the file header below.
- Produces `run.mjs`: `node design-systems/simple/build/run.mjs <id> [--from 1|2|3] [--no-intent]`.

- [ ] **Step 1: Write `n.mjs`**

```js
// design-systems/simple/build/lib/n.mjs
// Node builders for the Simple pages. Every colour and number that has a token
// name goes through these handles, so a page cannot type a value the tokens
// page does not declare.
export const T = (collection, name) => `{${collection}#${name}}`

const handles = (collection, names) =>
  Object.fromEntries(names.map((n) => [n, T(collection, n)]))

export const C = handles('color', [
  'layer-0', 'layer-1', 'layer-2', 'layer-raised', 'text', 'text-muted', 'text-inverse',
  'brand', 'brand-hover', 'link', 'ok', 'warn', 'alert', 'danger', 'accent', 'hairline',
  'hairline-strong', 'border', 'border-hover', 'focus', 'disabled-surface', 'mark',
  'mark-track', 'mark-muted', 'white',
])
export const S = handles('space', ['hair', 'xs', 'sm', 'md', 'lg', 'xl', 'xxl'])
export const TY = handles('type', ['micro', 'caption', 'body', 'title', 'heading', 'display', 'hero'])
export const R = handles('radius', ['control', 'card', 'pill'])
export const Z = handles('size', ['bar', 'nav', 'control', 'input', 'pill', 'icon', 'dot', 'hub', 'gauge', 'radial', 'row'])
export const BTN = handles('button', ['default-border', 'default-hover-fill', 'default-hover-text', 'default-active-fill', 'primary-fill', 'primary-hover', 'warning-fill', 'label', 'focus'])
export const SW = handles('switch', ['track', 'track-on', 'knob', 'border', 'border-hover', 'disabled-track', 'disabled-knob'])
export const IN = handles('input', ['fill', 'border', 'border-hover', 'border-focus', 'border-error', 'placeholder', 'disabled-fill'])
export const TB = handles('table', ['divider', 'hover', 'selected', 'header'])
export const MP = handles('map', ['surface', 'road', 'road-major', 'node', 'incident', 'connector'])

export const solid = (color) => [{ type: 'SOLID', color }]
export const NONE = []

export function node(element, attrs = {}, children) {
  const out = { element, ...attrs }
  if (children && children.length > 0) out.children = children
  return out
}
export const frame = (name, attrs = {}, children) => node('Frame', { name, ...attrs }, children)
export const col = (name, attrs = {}, children) =>
  frame(name, { layoutMode: 'VERTICAL', primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'AUTO', fills: NONE, ...attrs }, children)
export const row = (name, attrs = {}, children) =>
  frame(name, { layoutMode: 'HORIZONTAL', primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'AUTO', counterAxisAlignItems: 'CENTER', fills: NONE, ...attrs }, children)
/** A fixed-size frame with no auto-layout: children carry x/y. */
export const canvas = (name, width, height, attrs = {}, children) =>
  frame(name, { width, height, fills: NONE, ...attrs }, children)

export const text = (name, characters, attrs = {}) =>
  node('Text', { name, characters, fontSize: TY.body, textAutoResize: 'WIDTH_AND_HEIGHT', fills: solid(C.text), ...attrs })
export const caption = (name, characters, attrs = {}) =>
  text(name, characters, { fontSize: TY.caption, fills: solid(C['text-muted']), ...attrs })
export const figure = (name, characters, attrs = {}) =>
  text(name, characters, { fontSize: TY.display, fontWeight: 400, ...attrs })
/** Wrapped paragraph: width fixed, height follows. */
export const para = (name, characters, width, attrs = {}) =>
  text(name, characters, { width, textAutoResize: 'HEIGHT', ...attrs })

export const rect = (name, attrs = {}) => node('Rectangle', { name, ...attrs })
export const ellipse = (name, attrs = {}) => node('Ellipse', { name, ...attrs })
export const vector = (name, d, attrs = {}) =>
  node('Vector', { name, vectorPaths: [{ windingRule: 'NONZERO', data: d }], ...attrs })
export const stroked = (name, d, width, height, color, weight = 1.5, attrs = {}) =>
  vector(name, d, { width, height, strokes: solid(color), strokeWeight: weight, strokeCap: 'ROUND', strokeJoin: 'ROUND', ...attrs })
export const instance = (name, component, props = {}, children) =>
  node('Instance', { name, component, props }, children)
export const slot = (name, attrs = {}, children) => node('Slot', { name, ...attrs }, children)
export const hairline = (name, width, color = C.hairline) =>
  rect(name, { width, height: 1, fills: solid(color) })
export const dot = (name, size, color) =>
  ellipse(name, { width: size, height: size, fills: solid(color) })

// Arcs. Angles in degrees, 0 = 12 o'clock, clockwise. With ARC_MODE=poly the
// path is a polyline (for a renderer that cannot draw SVG "A" commands).
const pt = (cx, cy, r, deg) => {
  const a = ((deg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}
const f = (n) => Math.round(n * 100) / 100
export function arcPath(cx, cy, r, startDeg, endDeg) {
  const [x0, y0] = pt(cx, cy, r, startDeg)
  if (process.env.ARC_MODE === 'poly') {
    const steps = Math.max(2, Math.ceil(Math.abs(endDeg - startDeg) / 4))
    let d = `M${f(x0)} ${f(y0)}`
    for (let i = 1; i <= steps; i++) {
      const [x, y] = pt(cx, cy, r, startDeg + ((endDeg - startDeg) * i) / steps)
      d += ` L${f(x)} ${f(y)}`
    }
    return d
  }
  const [x1, y1] = pt(cx, cy, r, endDeg)
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0
  return `M${f(x0)} ${f(y0)} A${r} ${r} 0 ${large} 1 ${f(x1)} ${f(y1)}`
}
export const ringPath = (cx, cy, r) => `${arcPath(cx, cy, r, 0, 180)} ${arcPath(cx, cy, r, 180, 359.99).replace(/^M[^ ]+ [^ ]+ /, '')}`
/** n radial ticks between two angles, each `len` long ending at radius r, as one path. */
export function tickPath(cx, cy, r, len, startDeg, endDeg, n) {
  let d = ''
  for (let i = 0; i < n; i++) {
    const deg = startDeg + ((endDeg - startDeg) * i) / (n - 1)
    const [x0, y0] = pt(cx, cy, r - len, deg)
    const [x1, y1] = pt(cx, cy, r, deg)
    d += `M${f(x0)} ${f(y0)} L${f(x1)} ${f(y1)} `
  }
  return d.trim()
}
```

- [ ] **Step 2: Write `icons.mjs`**

```js
// design-systems/simple/build/lib/icons.mjs
import { C, col, ellipse, frame, rect, solid, stroked, NONE } from './n.mjs'

const box = (name, children) => frame(name, { width: 16, height: 16, fills: NONE }, children)

export const icon = {
  kebab: (name = 'kebab', color = C.text) =>
    col(name, { width: 16, height: 16, primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED', primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER', itemSpacing: 2 },
      [0, 1, 2].map((i) => ellipse(`d${i}`, { width: 3, height: 3, fills: solid(color) }))),
  expand: (name = 'expand', color = C.text) =>
    stroked(name, 'M1 5 V1 H5 M11 1 H15 V5 M15 11 V15 H11 M5 15 H1 V11', 16, 16, color),
  filter: (name = 'filter', color = C.text) =>
    box(name, [
      stroked('lines', 'M1 3 H15 M1 8 H15 M1 13 H15', 16, 16, color, 1.5, { x: 0, y: 0 }),
      ellipse('k0', { x: 4, y: 1.5, width: 3, height: 3, fills: solid(color) }),
      ellipse('k1', { x: 9, y: 6.5, width: 3, height: 3, fills: solid(color) }),
      ellipse('k2', { x: 5, y: 11.5, width: 3, height: 3, fills: solid(color) }),
    ]),
  gear: (name = 'gear', color = C.text) =>
    box(name, [
      ellipse('ring', { x: 4, y: 4, width: 8, height: 8, strokes: solid(color), strokeWeight: 1.5 }),
      stroked('teeth', 'M8 0 V3 M8 13 V16 M0 8 H3 M13 8 H16 M2.3 2.3 L4.5 4.5 M11.5 11.5 L13.7 13.7 M13.7 2.3 L11.5 4.5 M4.5 11.5 L2.3 13.7', 16, 16, color, 1.5, { x: 0, y: 0 }),
    ]),
  user: (name = 'user', color = C.text) =>
    box(name, [
      ellipse('ring', { x: 0, y: 0, width: 16, height: 16, strokes: solid(color), strokeWeight: 1.5 }),
      ellipse('head', { x: 5, y: 3, width: 6, height: 6, strokes: solid(color), strokeWeight: 1.5 }),
      stroked('body', 'M3 13.5 A5 4 0 0 1 13 13.5', 16, 16, color, 1.5, { x: 0, y: 0 }),
    ]),
  hamburger: (name = 'menu', color = C.brand) =>
    col(name, { itemSpacing: 3 }, [0, 1, 2].map((i) => rect(`bar${i}`, { width: 16, height: 2, fills: solid(color) }))),
  chevron: (name = 'chevron', color = C.text) => stroked(name, 'M1 1 L5 5 L9 1', 10, 6, color),
  sortChevrons: (name = 'sort', color = C['text-muted']) => stroked(name, 'M2 4 L5 1 L8 4 M2 8 L5 11 L8 8', 10, 12, color, 1.2),
  arrow: (name = 'arrow', color = C['text-muted']) => stroked(name, 'M0 5 H10 M6 1 L10 5 L6 9', 11, 10, color),
  arrowLeft: (name = 'arrow-left', color = C.text) => stroked(name, 'M10 5 H0 M4 1 L0 5 L4 9', 11, 10, color),
  check: (name = 'check', color = C.text) => stroked(name, 'M1 5 L4 8 L9 2', 10, 10, color, 1.5),
  cross: (name = 'cross', color = C.danger) => stroked(name, 'M1 1 L9 9 M9 1 L1 9', 10, 10, color, 1.5),
  refresh: (name = 'refresh', color = C.text) => stroked(name, 'M13 8 A5 5 0 1 1 11.5 4.5 M11.5 1 V4.5 H8', 16, 16, color),
  plus: (name = 'plus', color = C.text) => stroked(name, 'M5 0 V10 M0 5 H10', 10, 10, color),
  minus: (name = 'minus', color = C.text) => stroked(name, 'M0 5 H10', 10, 10, color),
  logo: (name = 'logo', color = C.text) => stroked(name, 'M2 4.5 L14 1.5 M2 9.5 L14 6.5 M2 14.5 L14 11.5', 16, 16, color, 3),
}
```

- [ ] **Step 3: Write `doc-page.mjs`**

```js
// design-systems/simple/build/lib/doc-page.mjs
//
// A descriptor `d` is:
// {
//   id: 'button',                     // page file is `${id}.uidx`
//   title: 'Button', eyebrow: 'Controls / Action',
//   definition: 'one sentence',       // cover
//   overview: ['when to use…', …],    // bullets
//   component: {                      // the main <Component>
//     name: 'Button', status: 'draft',
//     props: { label: { type: 'TEXT', default: 'Load' } },
//     axes: { kind: ['default','primary','warning'], interaction: [...] },   // {} for none
//     designed: (coords) => true,     // which combinations exist
//     variant: (coords) => node,      // the single child Frame of a <Variant>
//   },
//   extraComponents: [{ name, props, axes, designed, variant }],   // inserted first
//   states: { rows: 'kind', cols: 'interaction', sample: { label: 'Load' },
//             samples: [{ label, props }] },   // samples used when axes is {}
//   anatomy: ['1 container — …', …], anatomyProps: {},
//   properties: [['label', 'TEXT', 'Load', 'the visible text']],
//   measurements: [['height md', '28 (size#input)']],
//   inContext: () => node,            // built twice: dark, then in a light frame
//   guidance: { do: [...], dont: [...] },
//   accessibility: [['contrast, label on brand', '4.6:1 — passes AA']],
//   content: [['case', 'Sentence case, no full stop']],
//   related: [['Pill', 'a Pill is read, a Button is pressed']],
//   changelog: [['0.1', 'first draft']],
//   appearance: ['…'], constraints: ['…'],   // architecture
//   intent: { core: '…', structure: '…', antiPatterns: ['…'], design: ['…'] },
// }
import { C, S, TY, caption, col, figure, hairline, instance, para, row, solid, text, frame, NONE } from './n.mjs'

export const SECTIONS = ['cover', 'overview', 'anatomy', 'properties', 'states', 'measurements', 'in-context', 'guidance', 'accessibility', 'content', 'related', 'changelog']
const PAGE_W = 1440
const INNER = 1296 // PAGE_W minus 72 padding each side

const heading = (title, blurb) =>
  col('heading', { itemSpacing: S.sm }, [
    text('title', title, { fontSize: TY.heading, fontWeight: 500 }),
    hairline('rule', INNER),
    para('blurb', blurb, 940, { fills: solid(C['text-muted']) }),
  ])

export const section = (name, title, blurb, children, attrs = {}) =>
  col(name, {
    counterAxisSizingMode: 'FIXED', width: PAGE_W, itemSpacing: S.lg,
    paddingTop: S.xxl, paddingRight: 72, paddingBottom: S.xxl, paddingLeft: 72,
    fills: solid(C['layer-1']), ...attrs,
  }, [heading(title, blurb), ...children])

/** A table with fixed column widths; every cell is a text. */
export function table(name, columns, rows) {
  const total = columns.reduce((n, c) => n + c.width, 0)
  const cell = (r, i, value, head) =>
    frame(`c${i}`, { width: columns[i].width, layoutMode: 'HORIZONTAL', primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'AUTO', paddingTop: S.sm, paddingBottom: S.sm, paddingRight: S.md, fills: NONE },
      [typeof value === 'string'
        ? para(`t${i}`, value, columns[i].width - 16, head ? { fontSize: TY.caption, fontWeight: 500, fills: solid(C['text-muted']) } : { fontSize: TY.caption })
        : value])
  return col(name, { counterAxisSizingMode: 'FIXED', width: total, itemSpacing: 0 }, [
    row('head', { primaryAxisSizingMode: 'FIXED', width: total, counterAxisAlignItems: 'MIN' }, columns.map((c, i) => cell('h', i, c.label, true))),
    hairline('head-rule', total, C['hairline-strong']),
    ...rows.flatMap((r, ri) => [
      row(`r${ri}`, { primaryAxisSizingMode: 'FIXED', width: total, counterAxisAlignItems: 'MIN' }, r.map((v, i) => cell(ri, i, v))),
      hairline(`rule${ri}`, total),
    ]),
  ])
}

const bullets = (name, items, width = 940) =>
  col(name, { itemSpacing: S.sm }, items.map((s, i) => para(`b${i}`, `•  ${s}`, width)))

// ---- component -------------------------------------------------------------
function* combos(axes) {
  const names = Object.keys(axes)
  if (names.length === 0) { yield {}; return }
  const rec = function* (i, acc) {
    if (i === names.length) { yield { ...acc }; return }
    for (const v of axes[names[i]]) yield* rec(i + 1, { ...acc, [names[i]]: v })
  }
  yield* rec(0, {})
}

export function componentNode(c, x) {
  const axes = c.axes ?? {}
  const hasAxes = Object.keys(axes).length > 0
  const base = { element: 'Component', name: c.name, status: c.status ?? 'draft', x, y: 0, props: c.props ?? {} }
  if (!hasAxes) return { ...base, children: [c.variant({})] }
  const designed = c.designed ?? (() => true)
  const children = [...combos(axes)].filter(designed).map((coords) => ({ element: 'Variant', ...coords, children: [c.variant(coords)] }))
  if (children.length === 0) throw new Error(`${c.name}: no designed variants`)
  return { ...base, variants: axes, children }
}

const defaults = (axes) => Object.fromEntries(Object.entries(axes).map(([k, v]) => [k, v[0]]))

// ---- states grid -----------------------------------------------------------
function statesGrid(d) {
  const c = d.component
  const axes = c.axes ?? {}
  const designed = c.designed ?? (() => true)
  const sample = d.states?.sample ?? {}
  const out = []
  if (Object.keys(axes).length === 0) {
    const samples = d.states?.samples ?? [{ label: 'default', props: {} }]
    out.push(row('samples', { itemSpacing: S.xl, counterAxisAlignItems: 'MIN' }, samples.map((s, i) =>
      col(`s${i}`, { itemSpacing: S.sm }, [caption(`l${i}`, s.label), instance(`i${i}`, c.name, { ...sample, ...s.props })]))))
    return out
  }
  const rowsAxis = d.states.rows, colsAxis = d.states.cols
  const fixed = defaults(axes)
  const cols = colsAxis ? axes[colsAxis] : ['—']
  const cellW = Math.floor((INNER - 200) / cols.length)
  const cell = (name, coords) =>
    frame(name, { width: cellW, layoutMode: 'HORIZONTAL', primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'AUTO', paddingTop: S.md, paddingBottom: S.md, paddingLeft: S.md, counterAxisAlignItems: 'CENTER', fills: NONE },
      [designed(coords) ? instance('sample', c.name, { ...coords, ...sample }) : text('nd', 'not designed', { width: 90, fontSize: TY.caption, fills: solid(C['mark-muted']), textAutoResize: 'HEIGHT' })])
  const label = (name, s) => frame(name, { width: 200, layoutMode: 'HORIZONTAL', primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'AUTO', paddingLeft: S.md, paddingTop: S.md, paddingBottom: S.md, fills: NONE }, [caption('t', s, { fontWeight: 500 })])
  const matrix = (name, rowValues, rowAxisName) =>
    col(name, { counterAxisSizingMode: 'FIXED', width: INNER, itemSpacing: 0, fills: solid(C['layer-2']), cornerRadius: '{radius#card}' }, [
      row('head', { primaryAxisSizingMode: 'FIXED', width: INNER }, [label('axis', colsAxis ?? ''), ...cols.map((v, i) => frame(`h${i}`, { width: cellW, layoutMode: 'HORIZONTAL', primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'AUTO', paddingLeft: S.md, paddingTop: S.md, paddingBottom: S.md, fills: NONE }, [caption('t', v, { fontWeight: 500 })]))]),
      hairline('rule', INNER),
      ...rowValues.flatMap((rv, ri) => [
        row(`r${ri}`, { primaryAxisSizingMode: 'FIXED', width: INNER }, [label('l', rv), ...cols.map((cv, ci) => cell(`c${ci}`, { ...fixed, [rowAxisName]: rv, ...(colsAxis ? { [colsAxis]: cv } : {}) }))]),
        ...(ri < rowValues.length - 1 ? [hairline(`rule${ri}`, INNER)] : []),
      ]),
    ])
  out.push(text('sub-main', `${rowsAxis} by ${colsAxis ?? 'default'}`, { fontSize: TY.title, fontWeight: 500 }))
  out.push(matrix('matrix', axes[rowsAxis], rowsAxis))
  for (const [axis, values] of Object.entries(axes)) {
    if (axis === rowsAxis || axis === colsAxis) continue
    out.push(text(`sub-${axis}`, `by ${axis}`, { fontSize: TY.title, fontWeight: 500 }))
    out.push(row(`row-${axis}`, { itemSpacing: S.xl, counterAxisAlignItems: 'MIN' }, values.map((v, i) =>
      col(`v${i}`, { itemSpacing: S.sm }, [caption('l', v), designed({ ...fixed, [axis]: v }) ? instance('sample', c.name, { ...fixed, [axis]: v, ...sample }) : text('nd', 'not designed', { width: 90, fontSize: TY.caption, fills: solid(C['mark-muted']), textAutoResize: 'HEIGHT' })]))))
  }
  return out
}

// ---- sections --------------------------------------------------------------
function buildSections(d) {
  const c = d.component
  const fixed = defaults(c.axes ?? {})
  const cover = section('cover', '', '', [], { fills: solid(C['layer-0']) })
  cover.children = [
    caption('eyebrow', d.eyebrow, { fontWeight: 500, textCase: 'UPPER', letterSpacing: 1 }),
    text('title', d.title, { fontSize: 56, fontWeight: 500 }),
    para('definition', d.definition, 900, { fontSize: TY.title, fills: solid(C['text-muted']) }),
    caption('source', `Source: the ${c.name} component parked at x 1700 beside this page.`),
  ]
  const overview = section('overview', 'Overview', 'What the component is and when to reach for it.', [bullets('when', d.overview)])
  const anatomy = section('anatomy', 'Anatomy', 'What it is made of, outside in.', [
    row('spec', { itemSpacing: S.xxl, counterAxisAlignItems: 'MIN' }, [
      frame('specimen', { layoutMode: 'HORIZONTAL', primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'AUTO', paddingTop: S.xl, paddingRight: S.xl, paddingBottom: S.xl, paddingLeft: S.xl, fills: solid(C['layer-2']), cornerRadius: '{radius#card}' }, [instance('big', c.name, { ...fixed, ...(d.anatomyProps ?? d.states?.sample ?? {}) })]),
      bullets('parts', d.anatomy, 620),
    ]),
  ])
  const properties = section('properties', 'Properties', 'Axes multiply the grid; a prop does not. Everything that is a presence or a string is a prop.', [
    table('axes', [{ label: 'Axis', width: 200 }, { label: 'Values', width: 700 }, { label: 'Default', width: 396 }],
      Object.entries(c.axes ?? {}).map(([k, v]) => [k, v.join(' | '), v[0]])),
    table('props', [{ label: 'Prop', width: 200 }, { label: 'Type', width: 140 }, { label: 'Default', width: 300 }, { label: 'Meaning', width: 656 }], d.properties),
  ])
  const states = section('states', 'States', 'Every cell is an instance of the component, so a cell cannot show a look the component does not have. A combination nobody designed says so.', statesGrid(d))
  const measurements = section('measurements', 'Sizes and measurements', 'Every number here is the number in the component tree, bound by token name.', [
    table('numbers', [{ label: 'Measure', width: 500 }, { label: 'Value (token)', width: 796 }], d.measurements),
  ])
  const inContext = section('in-context', 'In context', 'Real placements, dark by default and light beneath it: the same tree with the colour collection switched to its light mode.', [
    frame('dark', { layoutMode: 'VERTICAL', primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'AUTO', paddingTop: S.lg, paddingRight: S.lg, paddingBottom: S.lg, paddingLeft: S.lg, fills: solid(C['layer-1']) }, [d.inContext()]),
    frame('light', { layoutMode: 'VERTICAL', primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'AUTO', paddingTop: S.lg, paddingRight: S.lg, paddingBottom: S.lg, paddingLeft: S.lg, fills: solid(C['layer-1']), modes: { color: 'light' } }, [d.inContext()]),
  ])
  const guidance = section('guidance', 'Do and don’t', 'The mistakes this component invites.', [
    row('cols', { itemSpacing: S.xxl, counterAxisAlignItems: 'MIN' }, [
      col('do', { itemSpacing: S.sm }, [text('h', 'Do', { fontWeight: 500, fills: solid(C.ok) }), bullets('list', d.guidance.do, 600)]),
      col('dont', { itemSpacing: S.sm }, [text('h', 'Don’t', { fontWeight: 500, fills: solid(C.danger) }), bullets('list', d.guidance.dont, 600)]),
    ]),
  ])
  const accessibility = section('accessibility', 'Accessibility', 'Contrast arithmetic against this page’s own tokens. A failure is stated with its number, not hidden.', [
    table('checks', [{ label: 'Check', width: 500 }, { label: 'Result', width: 796 }], d.accessibility),
  ])
  const content = section('content', 'Content', 'Wording rules.', [table('rules', [{ label: 'Rule', width: 400 }, { label: 'Example', width: 896 }], d.content)])
  const related = section('related', 'Related', 'Neighbours, and why they are not this.', [table('neighbours', [{ label: 'Component', width: 300 }, { label: 'Why', width: 996 }], d.related)])
  const changelog = section('changelog', 'Changelog', 'History.', [table('log', [{ label: 'Version', width: 200 }, { label: 'Change', width: 1096 }], d.changelog)])
  return { cover, overview, anatomy, properties, states, measurements, 'in-context': inContext, guidance, accessibility, content, related, changelog }
}

// ---- output ----------------------------------------------------------------
export function docPage(d) {
  const sections = buildSections(d)
  const extras = (d.extraComponents ?? []).map((c, i) => ({ kind: 'insert_node', parent: '', node: componentNode(c, 1700 + (i + 1) * 900) }))
  const main = { kind: 'insert_node', parent: '', node: componentNode(d.component, 1700) }
  const doc = col('doc', { counterAxisSizingMode: 'FIXED', width: PAGE_W, itemSpacing: 0, x: 0, y: 0, fills: solid(C['layer-1']) }, [sections.cover, sections.overview])
  const batches = [
    [...extras, main, { kind: 'insert_node', parent: '', node: doc }],
    ['anatomy', 'properties', 'states'].map((s) => ({ kind: 'insert_node', parent: 'doc', node: sections[s] })),
    ['measurements', 'in-context', 'guidance', 'accessibility', 'content', 'related', 'changelog'].map((s) => ({ kind: 'insert_node', parent: 'doc', node: sections[s] })),
  ]
  const architecture = {
    summary: `${d.title}: ${d.definition}`,
    components: [d.component, ...(d.extraComponents ?? [])].map((c) => ({
      name: c.name,
      props: Object.entries(c.props ?? {}).map(([name, p]) => ({ name, type: p.type })),
      axes: Object.entries(c.axes ?? {}).map(([name, values]) => ({ name, values })),
    })),
    tokens: [
      { collection: 'space', tier: 'primitive', usedFor: 'every gap and padding', status: 'exists' },
      { collection: 'type', tier: 'primitive', usedFor: 'every font size', status: 'exists' },
      { collection: 'radius', tier: 'primitive', usedFor: 'every corner', status: 'exists' },
      { collection: 'size', tier: 'primitive', usedFor: 'control heights and icon sizes', status: 'exists' },
      { collection: 'color', tier: 'semantic', usedFor: 'every fill and stroke', status: 'exists' },
      ...(d.tokenCollections ?? []).map((collection) => ({ collection, tier: 'component', usedFor: `${d.title} colours`, status: 'exists' })),
    ],
    sections: SECTIONS.map((name) => ({ name, holds: SECTION_HOLDS[name] })),
    constraints: d.constraints ?? [],
    appearance: d.appearance ?? [],
  }
  const intent = [
    '## Core Intent', '', d.intent.core, '',
    '## Page Structure', '', d.intent.structure, '',
    '## Anti-Patterns', '', ...d.intent.antiPatterns.map((s) => `- NEVER ${s}`), '',
    '## Design', '', ...d.intent.design.map((s) => `- ${s}`), '',
  ].join('\n')
  return { architecture, batches, intent }
}

const SECTION_HOLDS = {
  cover: 'eyebrow, title, definition, source caption', overview: 'when to use bullets', anatomy: 'a large instance beside numbered parts',
  properties: 'axes table and props table', states: 'matrix of instances, one per designed variant, not-designed cells for the rest',
  measurements: 'measure and token table', 'in-context': 'a dark placement and the same placement in light mode', guidance: 'do and dont columns',
  accessibility: 'contrast checks with numbers', content: 'wording rules', related: 'neighbours', changelog: 'history',
}

/** Every `characters` on the page, for the alias test. */
export function allCharacters(nodes) {
  const out = []
  const walk = (n) => { if (n.characters !== undefined) out.push(n.characters); (n.children ?? []).forEach(walk) }
  nodes.forEach(walk)
  return out
}
```

- [ ] **Step 4: Write the tests**

```js
// design-systems/simple/build/test/n.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { T, C, arcPath, tickPath, text, row } from '../lib/n.mjs'

test('T builds an alias', () => assert.equal(T('color', 'text'), '{color#text}'))
test('C carries every semantic colour by name', () => assert.equal(C['text-muted'], '{color#text-muted}'))
test('arcPath goes clockwise from 12 o’clock', () => {
  assert.equal(arcPath(100, 100, 50, 0, 90), 'M100 50 A50 50 0 0 1 150 100')
})
test('tickPath emits n segments', () => {
  assert.equal(tickPath(100, 100, 92, 8, -135, 135, 5).split('M').length - 1, 5)
})
test('text binds body size and text colour by default', () => {
  const t = text('a', 'hi')
  assert.equal(t.fontSize, '{type#body}')
  assert.equal(t.fills[0].color, '{color#text}')
})
test('row drops empty children', () => assert.equal(row('r', {}, []).children, undefined))
```

```js
// design-systems/simple/build/test/doc-page.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { docPage, SECTIONS, allCharacters } from '../lib/doc-page.mjs'
import { row, text } from '../lib/n.mjs'

const d = {
  id: 'x', title: 'X', eyebrow: 'Test', definition: 'A test component.', overview: ['when testing'],
  component: {
    name: 'X', props: { label: { type: 'TEXT', default: 'x' } },
    axes: { state: ['off', 'on'], interaction: ['default', 'hover'] },
    designed: (c) => !(c.state === 'on' && c.interaction === 'hover'),
    variant: (c) => row('r', {}, [text('l', '{label}')]),
  },
  states: { rows: 'state', cols: 'interaction', sample: { label: 'x' } },
  anatomy: ['1 r'], properties: [['label', 'TEXT', 'x', 'text']], measurements: [['h', '1']],
  inContext: () => text('ctx', 'ctx'), guidance: { do: ['a'], dont: ['b'] }, accessibility: [['c', 'ok']],
  content: [['r', 'e']], related: [['Y', 'z']], changelog: [['0.1', 'first']],
  intent: { core: 'c', structure: 's', antiPatterns: ['p'], design: ['d'] },
}
const page = docPage(d)
const all = page.batches.flat().map((op) => op.node)

test('first batch carries the component with every designed variant', () => {
  const comp = page.batches[0][0].node
  assert.equal(comp.element, 'Component')
  assert.equal(comp.x, 1700)
  assert.equal(comp.children.length, 3)
  assert.ok(comp.children.every((v) => v.element === 'Variant' && v.children.length === 1))
})
test('twelve sections in order across the batches', () => {
  const doc = page.batches[0][1].node
  const names = [...doc.children.map((s) => s.name), ...page.batches[1].map((o) => o.node.name), ...page.batches[2].map((o) => o.node.name)]
  assert.deepEqual(names, SECTIONS)
})
test('states grid: instances for designed cells, a not-designed text for the rest', () => {
  const states = page.batches[1][2].node
  const json = JSON.stringify(states)
  assert.equal((json.match(/"element":"Instance"/g) ?? []).length, 3)
  assert.equal((json.match(/not designed/g) ?? []).length, 1)
})
test('no token alias ever lands in characters', () => {
  for (const s of allCharacters(all)) assert.ok(!/\{[a-z-]+#/.test(s), s)
})
test('architecture names every section and axis', () => {
  assert.equal(page.architecture.sections.length, 12)
  assert.deepEqual(page.architecture.components[0].axes[0], { name: 'state', values: ['off', 'on'] })
})
test('the light in-context frame overrides the colour mode', () => {
  const ctx = page.batches[2][1].node
  assert.deepEqual(ctx.children[1].modes, { color: 'light' })
})
```

- [ ] **Step 5: Run the tests**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node --test design-systems/simple/build/test/
```
Expected: 12 passing, 0 failing.

- [ ] **Step 6: Write `run.mjs`**

```js
#!/usr/bin/env node
// design-systems/simple/build/run.mjs — build one page from its descriptor.
//   node design-systems/simple/build/run.mjs button [--from 2] [--no-intent]
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { docPage } from './lib/doc-page.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '..')                       // design-systems/simple
const REPO = resolve(ROOT, '..', '..')
const CLI = resolve(REPO, 'packages/cli/dist/uidx.js')
const [id, ...flags] = process.argv.slice(2)
if (!id) { console.error('usage: run.mjs <component-id> [--from N] [--no-intent]'); process.exit(2) }
const from = Number(flags[flags.indexOf('--from') + 1] || 1)
const noIntent = flags.includes('--no-intent')

const { default: d } = await import(`./components/${id}.mjs`)
const page = `${d.id}.uidx`
const out = resolve(ROOT, '.build', d.id)
mkdirSync(out, { recursive: true })

const uidx = (...args) => {
  console.log(`$ uidx ${args.join(' ')}`)
  const r = execFileSync(process.execPath, [CLI, ...args], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  process.stdout.write(r)
  return r
}
const built = docPage(d)
writeFileSync(resolve(out, 'architecture.json'), JSON.stringify(built.architecture, null, 2))
built.batches.forEach((b, i) => writeFileSync(resolve(out, `batch-${i + 1}.json`), JSON.stringify(b, null, 2)))
writeFileSync(resolve(out, 'intent.md'), built.intent)

uidx('architect', ROOT, d.id, '--set', resolve(out, 'architecture.json'))
if (!existsSync(resolve(ROOT, page))) uidx('create', ROOT, page, '--id', d.id)
for (let i = from; i <= 3; i++) {
  const r = uidx('apply', ROOT, page, '--ops', resolve(out, `batch-${i}.json`))
  if (/refused|not applied|error/i.test(r)) { console.error(`batch ${i} refused — fix the descriptor and rerun with --from ${i}`); process.exit(1) }
}
if (!noIntent) uidx('intent', ROOT, page, '--file', resolve(out, 'intent.md'))
uidx('audit', ROOT, '--page', page)
uidx('render', ROOT, page, '-o', resolve(out, `${d.id}.png`), '--scale', '0.5')
console.log(`rendered ${resolve(out, `${d.id}.png`)}`)
```

- [ ] **Step 7: Ignore the build output and commit**

```bash
printf '\n# Simple design-system build artefacts (ops, architecture, renders)\ndesign-systems/simple/.build/\n' >> .gitignore
git add .gitignore design-systems/simple/build
git commit -m "Simple: the page generator — descriptors to gated op batches

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: AppHeader page

**Files:**
- Create: `design-systems/simple/build/components/app-header.mjs`
- Create (generated): `design-systems/simple/app-header.uidx`

**Interfaces:**
- Consumes: `docPage`, `n.mjs`, `icons.mjs` from Task 2; tokens from Task 1.
- Produces: component `AppHeader` with props `productName` (TEXT), `userName` (TEXT), no axes. The dashboard (Task 23) instances it as `instance('system-bar', 'AppHeader', { productName: 'Simple', userName: 'Username' })`.

- [ ] **Step 1: Write the descriptor**

```js
// design-systems/simple/build/components/app-header.mjs
import { C, S, TY, Z, row, text, solid, frame } from '../lib/n.mjs'
import { icon } from '../lib/icons.mjs'

const bar = () =>
  row('bar', {
    primaryAxisSizingMode: 'FIXED', width: 1440, height: Z.bar, counterAxisSizingMode: 'FIXED',
    primaryAxisAlignItems: 'SPACE_BETWEEN', paddingLeft: S.md, paddingRight: S.md, fills: solid(C['layer-0']),
  }, [
    row('brand', { itemSpacing: S.sm }, [icon.logo(), text('product', '{productName}', { fontSize: TY.body })]),
    row('user', { itemSpacing: S.sm }, [icon.user(), text('name', '{userName}', { fontSize: TY.body })]),
  ])

export default {
  id: 'app-header', title: 'AppHeader', eyebrow: 'Chrome / System bar',
  definition: 'The 48px system bar at the very top of every screen: the product on the left, the signed-in person on the right, nothing else.',
  overview: [
    'Use once per screen, always at the top, always full width.',
    'It belongs to the system, not the app: the app’s own title and actions live in the AppSubHeader beneath it.',
    'It is the darkest surface on the page (layer-0), which is what makes the app bar under it read as a step up.',
  ],
  component: {
    name: 'AppHeader',
    props: { productName: { type: 'TEXT', default: 'Simple' }, userName: { type: 'TEXT', default: 'Username' } },
    axes: {}, variant: bar,
  },
  states: { samples: [
    { label: 'default', props: {} },
    { label: 'long product name', props: { productName: 'Simple Network Operations Center' } },
  ] },
  anatomy: ['1 bar — 48 tall, layer-0, 16 side padding, space-between', '2 brand — logo mark 16 and the product name, 8 apart', '3 user — user glyph 16 and the name, 8 apart'],
  properties: [['productName', 'TEXT', 'Simple', 'the product, left'], ['userName', 'TEXT', 'Username', 'the signed-in person, right']],
  measurements: [['height', '48 (size#bar)'], ['side padding', '16 (space#md)'], ['icon', '16 (size#icon)'], ['text', '14 (type#body) regular'], ['fill', 'color#layer-0']],
  inContext: () => frame('screen', { layoutMode: 'VERTICAL', primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'AUTO', fills: solid(C['layer-1']) }, [
    { element: 'Instance', name: 'sys', component: 'AppHeader', props: { productName: 'Simple', userName: 'Username' } },
    frame('app-bar-stand-in', { width: 1440, height: Z.bar, fills: solid(C['layer-1']) }),
  ]),
  guidance: { do: ['Keep it to two things: who made this, who is using it.', 'Let the product name be the brand; the app title goes below.'], dont: ['Put navigation, search or actions in it.', 'Colour it anything but layer-0.'] },
  accessibility: [['text on layer-0', 'gray-242 on black-12: 17.4:1 — passes AAA'], ['icon strokes', '1.5px at 17.4:1 — passes 1.4.11']],
  content: [['product name', 'Proper noun, no suffix: “Simple”, not “Simple dashboard”'], ['user name', 'The name as entered, never an email address']],
  related: [['AppSubHeader', 'the app’s own bar, one layer up, with the title and the actions'], ['CardHeader', 'the same left-title right-actions shape at card scale']],
  changelog: [['0.1', 'first draft from the EDS dashboard reference']],
  appearance: ['A single 48px band, the darkest on screen, with text at both ends and empty in the middle.', 'Logo mark is three slanted bars, 16px, in text colour, 8px before the product name.'],
  constraints: ['Height is exactly size#bar; nothing inside may exceed 16px tall except text.'],
  intent: {
    core: 'One bar that says whose product this is and who is looking at it. It has no axes because it has no states: it never hovers, never collapses, never changes with the app beneath it.',
    structure: 'Cover, overview, anatomy, properties, states (two samples, since there is no matrix), measurements, in context (dark and light), guidance, accessibility, content, related, changelog.',
    antiPatterns: ['put an action in the system bar — actions belong to the app bar', 'shrink it below 48; the two bars stack to 96 and every screen relies on that'],
    design: ['layer-0 band, 48 tall, full width, space-between', 'brand left: logo 16 + product 14px regular, 8 apart', 'user right: user glyph 16 + name 14px, 8 apart'],
  },
}
```

- [ ] **Step 2: Build the page**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/simple/build/run.mjs app-header
```
Expected: `architecture set.`, `created app-header.uidx`, three `applied` lines each followed by audit lines naming no faults, `wrote the intent`, audit exit 0, a PNG path. If a batch is refused, the refusal names the prop or address; fix the descriptor and rerun with `--from N`.

- [ ] **Step 3: Look at the render**

Read `design-systems/simple/.build/app-header/app-header.png`. Expected: a dark page column; cover in the darkest band; the bar in the anatomy specimen with logo and name left, user right; the light in-context frame with a pale page and dark text; the component parked to the right. Fix what disagrees with the appearance lines and rerun.

- [ ] **Step 4: Commit**

```bash
git add design-systems/simple/app-header.uidx design-systems/simple/build/components/app-header.mjs
git commit -m "Simple: AppHeader

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: AppSubHeader page

**Files:**
- Create: `design-systems/simple/build/components/app-sub-header.mjs`
- Create (generated): `design-systems/simple/app-sub-header.uidx`

**Interfaces:**
- Consumes: Task 2 library.
- Produces: `AppSubHeader` with prop `title` (TEXT) and slot `actions`; instanced by the dashboard as `instance('app-bar', 'AppSubHeader', { title: 'System dashboard' }, [slot('actions', {}, [...])])`.

- [ ] **Step 1: Write the descriptor**

```js
// design-systems/simple/build/components/app-sub-header.mjs
import { C, S, TY, Z, row, text, solid, slot, frame } from '../lib/n.mjs'
import { icon } from '../lib/icons.mjs'

const bar = () =>
  row('bar', {
    primaryAxisSizingMode: 'FIXED', width: 1440, height: Z.bar, counterAxisSizingMode: 'FIXED',
    primaryAxisAlignItems: 'SPACE_BETWEEN', paddingLeft: S.md, paddingRight: S.md, fills: solid(C['layer-1']),
  }, [
    row('lead', { itemSpacing: S.lg }, [icon.hamburger(), text('title', '{title}', { fontSize: TY.heading })]),
    slot('actions', { layoutMode: 'HORIZONTAL', primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'AUTO', counterAxisAlignItems: 'CENTER', itemSpacing: S.md }, [icon.gear()]),
  ])

const actions = () => [
  icon.refresh(), text('label', 'Data preset', { fontSize: TY.body }),
  frame('input', { width: 100, height: Z.input, layoutMode: 'HORIZONTAL', primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED', counterAxisAlignItems: 'CENTER', paddingLeft: S.sm, strokes: solid(C.border), strokeWeight: 1, cornerRadius: '{radius#control}', fills: solid(C['layer-0']) }, [text('ph', 'Choose preset', { fontSize: TY.caption, fills: solid(C['text-muted']) })]),
  frame('load', { height: Z.input, layoutMode: 'HORIZONTAL', primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'FIXED', counterAxisAlignItems: 'CENTER', paddingLeft: S.md, paddingRight: S.md, fills: solid(C.brand), cornerRadius: '{radius#control}' }, [text('l', 'Load', { fontSize: TY.caption, fontWeight: 500, fills: solid(C.white) })]),
  icon.gear(),
]

export default {
  id: 'app-sub-header', title: 'AppSubHeader', eyebrow: 'Chrome / App bar',
  definition: 'The app’s own 48px bar under the system bar: a menu toggle and the screen title on the left, the screen’s global actions on the right.',
  overview: ['One per screen, directly under the AppHeader.', 'The title names the screen (“System dashboard”), not the product.', 'Actions that apply to the whole screen — a preset, a filter, settings — go in the slot; actions that apply to one card go in that card’s header.'],
  component: { name: 'AppSubHeader', props: { title: { type: 'TEXT', default: 'System dashboard' } }, axes: {}, variant: bar },
  states: { samples: [{ label: 'default actions', props: {} }, { label: 'other title', props: { title: 'Fleet dashboard' } }] },
  anatomy: ['1 bar — 48 tall, layer-1, 16 side padding', '2 lead — blue hamburger 16×11 and the 20px title, 24 apart', '3 actions slot — a horizontal row, 16 gap; default content is a gear'],
  properties: [['title', 'TEXT', 'System dashboard', 'the screen name'], ['actions (slot)', 'slot', 'gear icon', 'the screen’s global controls']],
  measurements: [['height', '48 (size#bar)'], ['title', '20 (type#heading) regular'], ['lead gap', '24 (space#lg)'], ['actions gap', '16 (space#md)'], ['hamburger', 'three 16×2 bars, 3 apart, color#brand'], ['fill', 'color#layer-1']],
  inContext: () => frame('screen', { layoutMode: 'VERTICAL', primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'AUTO', fills: solid(C['layer-1']) }, [
    { element: 'Instance', name: 'sys', component: 'AppHeader', props: { productName: 'Simple', userName: 'Username' } },
    { element: 'Instance', name: 'app', component: 'AppSubHeader', props: { title: 'System dashboard' }, children: [slot('actions', {}, actions())] },
  ]),
  guidance: { do: ['Use the hamburger colour (brand) only there: it is the one blue at rest on the bar.', 'Fill the slot with screen-wide actions only.'], dont: ['Repeat the product name here.', 'Put a search field in the bar; search belongs to the content it searches.'] },
  accessibility: [['title on layer-1', 'gray-242 on black-24: 15.5:1 — passes'], ['hamburger on layer-1', 'blue #0082F0 on black-24: 4.6:1 — passes 1.4.11'], ['input border on layer-1', 'gray-78 on black-24: 1.8:1 — FAILS 3:1; the input relies on its darker fill, stated on the Input page too']],
  content: [['title', 'Sentence case, the screen’s noun: “System dashboard”'], ['action labels', 'One verb: “Load”']],
  related: [['AppHeader', 'the system bar above it'], ['Button', 'the primary action in the slot'], ['Input', 'the preset field in the slot']],
  changelog: [['0.1', 'first draft']],
  appearance: ['A layer-1 band under the darker system bar; blue hamburger far left, 20px title beside it, actions cluster far right.', 'Actions read as a sentence: icon, label, field, blue button, gear.'],
  constraints: ['The hamburger is the only brand-coloured element at rest on the chrome.'],
  intent: {
    core: 'The bar that names the screen and holds what acts on the whole of it. Title is a prop; actions are a slot because every screen’s set is different and none of them are states of the bar.',
    structure: 'Same twelve sections; the in-context frame stacks it under an AppHeader instance with a filled actions slot.',
    antiPatterns: ['give the bar a second blue — the hamburger owns it', 'let the title wrap; it is one line at 20px'],
    design: ['layer-1 band, 48 tall', 'hamburger: three brand bars 16×2, 3 apart', 'title 20px regular, 24 from the hamburger', 'actions slot right, 16 gaps, gear by default'],
  },
}
```

- [ ] **Step 2: Build, look, commit**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/simple/build/run.mjs app-sub-header
```
Read `design-systems/simple/.build/app-sub-header/app-sub-header.png`; expect the two bars stacked in the in-context frame with the blue hamburger and a blue Load button. Then:
```bash
git add design-systems/simple/app-sub-header.uidx design-systems/simple/build/components/app-sub-header.mjs
git commit -m "Simple: AppSubHeader

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: CardSurface page

**Files:**
- Create: `design-systems/simple/build/components/card-surface.mjs`
- Create (generated): `design-systems/simple/card-surface.uidx`

**Interfaces:**
- Produces: `CardSurface` with axis `layer` `['2', '1']` and slot `content`; Tile (Task 7) and the dashboard nest content in it as `instance('card', 'CardSurface', { layer: '2' }, [slot('content', {}, [...])])`.

- [ ] **Step 1: Write the descriptor**

```js
// design-systems/simple/build/components/card-surface.mjs
import { C, S, TY, R, col, caption, solid, slot, frame, text } from '../lib/n.mjs'

const surface = ({ layer }) =>
  col('surface', {
    counterAxisSizingMode: 'FIXED', width: 320, itemSpacing: S.md,
    paddingTop: S.md, paddingRight: S.md, paddingBottom: S.md, paddingLeft: S.md,
    cornerRadius: R.card, fills: solid(layer === '1' ? C['layer-1'] : C['layer-2']),
  }, [slot('content', { layoutMode: 'VERTICAL', primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'AUTO', itemSpacing: S.sm }, [caption('placeholder', 'content')])])

export default {
  id: 'card-surface', title: 'CardSurface', eyebrow: 'Chrome / Surface',
  definition: 'The rectangle everything on a dashboard sits in: one layer up from the page, 4px corners, 16px padding, no border, no shadow.',
  overview: ['Every tile, list and chart panel is a CardSurface with content in it.', 'Layer 2 is the card on a layer-1 page. Layer 1 exists for a surface that sits inside another card and must recede.', 'A surface separates by its fill alone: no stroke, no shadow, no divider around it.'],
  component: { name: 'CardSurface', props: {}, axes: { layer: ['2', '1'] }, variant: surface },
  states: { rows: 'layer', cols: null, sample: {} },
  anatomy: ['1 surface — 320 wide here (the consumer sets width), layer fill, radius 4, padding 16', '2 content slot — vertical, 8 gap, filled by the consumer'],
  properties: [['content (slot)', 'slot', 'a muted caption', 'whatever the card holds']],
  measurements: [['radius', '4 (radius#card)'], ['padding', '16 (space#md)'], ['gap', '16 (space#md)'], ['fill, layer 2', 'color#layer-2'], ['fill, layer 1', 'color#layer-1'], ['stroke', 'none'], ['shadow', 'none']],
  inContext: () => frame('page', { layoutMode: 'HORIZONTAL', primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'AUTO', itemSpacing: S.sm, paddingTop: S.sm, paddingRight: S.sm, paddingBottom: S.sm, paddingLeft: S.sm, fills: solid(C['layer-1']) }, [
    { element: 'Instance', name: 'a', component: 'CardSurface', props: { layer: '2' }, children: [slot('content', {}, [text('t', 'Total Compliance Score', { fontSize: TY.title, fontWeight: 500 }), caption('c', 'a layer-2 card on the page')])] },
    { element: 'Instance', name: 'b', component: 'CardSurface', props: { layer: '2' }, children: [slot('content', {}, [text('t', 'Latest Alerts', { fontSize: TY.title, fontWeight: 500 }), { element: 'Instance', name: 'inner', component: 'CardSurface', props: { layer: '1' }, children: [slot('content', {}, [caption('c', 'a layer-1 surface inside it')])] }])] },
  ]),
  guidance: { do: ['Let the 8px page gutter between cards do the separating.', 'Nest a layer-1 surface when content inside a card needs its own well.'], dont: ['Add a stroke, a shadow or a lighter top edge.', 'Use a radius other than 4.'] },
  accessibility: [['layer-2 against layer-1', 'black-36 on black-24: 1.3:1 — a card is not a boundary that must meet 3:1; content inside carries the contrast'], ['text on layer-2', 'gray-242 on black-36: 14.1:1 — passes']],
  content: [['—', 'A surface has no words of its own']],
  related: [['CardHeader', 'the first row inside most surfaces'], ['Tile', 'surface + header + body, the common case']],
  changelog: [['0.1', 'first draft']],
  appearance: ['A flat rounded rectangle one shade lighter than the page; edges are found by the fill step, never by a line.'],
  constraints: ['No stroke and no effect on any variant.'],
  intent: {
    core: 'The surface is the unit of the layer ladder. Its one axis is which rung it sits on, because that changes what it is against its parent; padding and radius are not states and never vary.',
    structure: 'Twelve sections; states shows the two rungs one under the other.',
    antiPatterns: ['outline a surface', 'stack a layer-2 surface inside a layer-2 surface — step down to layer-1 instead'],
    design: ['fill layer-2 on the page, layer-1 when nested', 'radius 4, padding 16, gap 16', 'no stroke, no shadow'],
  },
}
```

- [ ] **Step 2: Build, look, commit**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/simple/build/run.mjs card-surface
```
Read `design-systems/simple/.build/card-surface/card-surface.png`; expect two cards side by side in the in-context frame, the second with a darker well inside. Then:
```bash
git add design-systems/simple/card-surface.uidx design-systems/simple/build/components/card-surface.mjs
git commit -m "Simple: CardSurface

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: CardHeader page

**Files:**
- Create: `design-systems/simple/build/components/card-header.mjs`
- Create (generated): `design-systems/simple/card-header.uidx`

**Interfaces:**
- Produces: `CardHeader` with axis `action` `['kebab', 'expand', 'filter', 'none']`, props `title` (TEXT), `subtitle` (TEXT), `showSubtitle` (BOOLEAN). Tile and the dashboard use `instance('head', 'CardHeader', { action: 'kebab', title: 'Latest Alerts', showSubtitle: false })`.

- [ ] **Step 1: Write the descriptor**

```js
// design-systems/simple/build/components/card-header.mjs
import { C, S, TY, row, text, caption, solid, frame } from '../lib/n.mjs'
import { icon } from '../lib/icons.mjs'

const actionIcon = (a) => a === 'kebab' ? icon.kebab() : a === 'expand' ? icon.expand() : a === 'filter' ? icon.filter() : frame('none', { width: 16, height: 16, fills: [] })

const header = ({ action }) =>
  row('header', { primaryAxisSizingMode: 'FIXED', width: 288, primaryAxisAlignItems: 'SPACE_BETWEEN' }, [
    row('titles', { itemSpacing: S.sm, counterAxisAlignItems: 'BASELINE' }, [
      text('title', '{title}', { fontSize: TY.title, fontWeight: 500 }),
      caption('subtitle', '{subtitle}', { visible: '{showSubtitle}' }),
    ]),
    actionIcon(action),
  ])

export default {
  id: 'card-header', title: 'CardHeader', eyebrow: 'Chrome / Card',
  definition: 'The first row of a card: a 16px medium title, an optional muted qualifier beside it, and one 16px action glyph at the far right.',
  overview: ['Every card that has a name starts with one.', 'The qualifier is for scope words the title should not carry — “This year”, “This month”, “last 7 days”.', 'One action only. A card that needs three actions puts them behind the kebab.'],
  component: {
    name: 'CardHeader',
    props: { title: { type: 'TEXT', default: 'Telematic devices' }, subtitle: { type: 'TEXT', default: 'This year' }, showSubtitle: { type: 'BOOLEAN', default: true } },
    axes: { action: ['kebab', 'expand', 'filter', 'none'] }, variant: header,
  },
  states: { rows: 'action', cols: null, sample: {} },
  anatomy: ['1 header — 288 wide here (the card sets it), space-between', '2 titles — title 16px medium and the 12px muted subtitle on a shared baseline, 8 apart', '3 action — one 16px glyph: kebab, expand, filter, or an empty 16px keeper'],
  properties: [['title', 'TEXT', 'Telematic devices', 'the card’s name'], ['subtitle', 'TEXT', 'This year', 'a scope qualifier'], ['showSubtitle', 'BOOLEAN', 'true', 'whether the qualifier shows']],
  measurements: [['title', '16 (type#title) medium'], ['subtitle', '12 (type#caption) muted'], ['title–subtitle gap', '8 (space#sm)'], ['action glyph', '16 (size#icon)'], ['height', '20, from the title line']],
  inContext: () => frame('card', { layoutMode: 'VERTICAL', primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'FIXED', width: 320, itemSpacing: S.md, paddingTop: S.md, paddingRight: S.md, paddingBottom: S.md, paddingLeft: S.md, cornerRadius: '{radius#card}', fills: solid(C['layer-2']) }, [
    { element: 'Instance', name: 'h', component: 'CardHeader', props: { action: 'filter', title: 'Telematic devices', subtitle: 'This month', showSubtitle: true } },
    caption('body', 'Devices this month out of this year (%)'),
  ]),
  guidance: { do: ['Keep the title to three words; the qualifier takes the rest.', 'Use the expand glyph only on cards that can go full-screen.'], dont: ['Colour the title.', 'Put two glyphs on the right; use the kebab.'] },
  accessibility: [['title on layer-2', 'gray-242 on black-36: 14.1:1 — passes'], ['subtitle (60%) on layer-2', 'about 8:1 — passes'], ['kebab dots 3px', 'passes contrast; the 16px hit area is below the 24px minimum of 2.5.8 and should grow in the implementation']],
  content: [['title', 'Sentence case: “Compliance status”'], ['subtitle', 'A time or scope word: “This year”, “last 7 days”']],
  related: [['CardSurface', 'what it sits on'], ['Tile', 'surface + this header + a body slot'], ['AppSubHeader', 'the same shape at screen scale']],
  changelog: [['0.1', 'first draft']],
  appearance: ['Title left, small grey qualifier hanging off its baseline, a lone glyph hard right; the row is as tall as the title.'],
  constraints: ['Title and subtitle share a baseline; the subtitle never wraps under the title.'],
  intent: {
    core: 'A card’s name row. The action is an axis because the glyph changes what the row can do; the qualifier is a prop because showing it or not changes nothing about the row’s behaviour.',
    structure: 'Twelve sections; states lists the four actions down the page.',
    antiPatterns: ['stack the subtitle under the title', 'use a 14px title — 16 medium is what separates a card name from body text'],
    design: ['16px medium title, 12px muted subtitle at 8, on one baseline', 'one 16px glyph at the right edge', 'space-between over the card’s inner width'],
  },
}
```

- [ ] **Step 2: Build, look, commit**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/simple/build/run.mjs card-header
```
Read `design-systems/simple/.build/card-header/card-header.png`; expect four header rows with kebab, expand, filter and an empty right side. Then:
```bash
git add design-systems/simple/card-header.uidx design-systems/simple/build/components/card-header.mjs
git commit -m "Simple: CardHeader

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Tile page

**Files:**
- Create: `design-systems/simple/build/components/tile.mjs`
- Create (generated): `design-systems/simple/tile.uidx`

**Interfaces:**
- Produces: `Tile` with axis `action` (as CardHeader), props `title`, `subtitle`, `showSubtitle`, slot `body`. Used by the dashboard as `instance('tile-gauge', 'Tile', { action: 'kebab', title: 'Total Compliance Score', showSubtitle: false }, [slot('body', {}, [...])])`.

- [ ] **Step 1: Write the descriptor**

```js
// design-systems/simple/build/components/tile.mjs
import { C, S, TY, R, col, row, text, caption, solid, slot, frame } from '../lib/n.mjs'
import { icon } from '../lib/icons.mjs'

const actionIcon = (a) => a === 'kebab' ? icon.kebab() : a === 'expand' ? icon.expand() : a === 'filter' ? icon.filter() : frame('none', { width: 16, height: 16, fills: [] })

const tile = ({ action }) =>
  col('tile', { counterAxisSizingMode: 'FIXED', width: 320, itemSpacing: S.md, paddingTop: S.md, paddingRight: S.md, paddingBottom: S.md, paddingLeft: S.md, cornerRadius: R.card, fills: solid(C['layer-2']) }, [
    row('header', { primaryAxisSizingMode: 'FIXED', width: 288, primaryAxisAlignItems: 'SPACE_BETWEEN' }, [
      row('titles', { itemSpacing: S.sm, counterAxisAlignItems: 'BASELINE' }, [text('title', '{title}', { fontSize: TY.title, fontWeight: 500 }), caption('subtitle', '{subtitle}', { visible: '{showSubtitle}' })]),
      actionIcon(action),
    ]),
    slot('body', { layoutMode: 'VERTICAL', primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'AUTO', itemSpacing: S.sm }, [caption('placeholder', 'body')]),
  ])

export default {
  id: 'tile', title: 'Tile', eyebrow: 'Chrome / Card',
  definition: 'A CardSurface with a CardHeader as its first row and a body slot beneath: the shape of nearly every card on a dashboard.',
  overview: ['Reach for a Tile whenever a card has a name. Use a bare CardSurface only for a map or a full-bleed chart.', 'The body is a slot: a gauge, a table, a list, a chart — the tile does not care.', 'The header’s action axis passes straight through.'],
  component: {
    name: 'Tile',
    props: { title: { type: 'TEXT', default: 'Total Compliance Score' }, subtitle: { type: 'TEXT', default: 'This year' }, showSubtitle: { type: 'BOOLEAN', default: false } },
    axes: { action: ['kebab', 'expand', 'filter', 'none'] }, variant: tile,
  },
  states: { rows: 'action', cols: null, sample: {} },
  anatomy: ['1 tile — layer-2, radius 4, padding 16, vertical gap 16', '2 header — as CardHeader, spanning the inner width', '3 body slot — vertical, 8 gap, default a muted “body”'],
  properties: [['title', 'TEXT', 'Total Compliance Score', 'the card’s name'], ['subtitle', 'TEXT', 'This year', 'scope qualifier'], ['showSubtitle', 'BOOLEAN', 'false', 'whether it shows'], ['body (slot)', 'slot', 'muted caption', 'the card’s content']],
  measurements: [['padding', '16 (space#md)'], ['header–body gap', '16 (space#md)'], ['radius', '4 (radius#card)'], ['width', 'set by the consumer; 320 here'], ['fill', 'color#layer-2']],
  inContext: () => row('grid', { itemSpacing: S.sm, counterAxisAlignItems: 'MIN' }, [
    { element: 'Instance', name: 'a', component: 'Tile', props: { action: 'kebab', title: 'Latest Alerts', showSubtitle: false }, children: [slot('body', {}, [caption('t1', '2016-12-02 14:25'), text('x1', 'Excessive access attempts to non-existing…'), caption('t2', '2016-12-02 14:20'), text('x2', 'Initializing full-time diagnostic data…')])] },
    { element: 'Instance', name: 'b', component: 'Tile', props: { action: 'filter', title: 'Telematic devices', subtitle: 'This year', showSubtitle: true }, children: [slot('body', {}, [caption('u', 'Devices (x 1 000)'), text('f', '13 719', { fontSize: TY.display })])] },
  ]),
  guidance: { do: ['Let the body decide the tile’s height; never fix it.', 'Use the subtitle for the time window of the data.'], dont: ['Nest a Tile inside a Tile — nest a layer-1 CardSurface.', 'Leave the default “body” caption in a shipped screen.'] },
  accessibility: [['title on layer-2', '14.1:1 — passes'], ['tile edge', 'no boundary; content carries contrast (see CardSurface)']],
  content: [['title', 'Sentence case, three words or fewer'], ['empty body', 'Never empty: say “No data for this window”']],
  related: [['CardSurface', 'the surface without a header'], ['CardHeader', 'the header on its own'], ['Label', 'the commonest body']],
  changelog: [['0.1', 'first draft']],
  appearance: ['A layer-2 panel with its name top-left, a glyph top-right, and content below a 16px gap; corners barely rounded.'],
  constraints: ['Header spans the inner width so the glyph sits at the padding edge.'],
  intent: {
    core: 'The tile is the composition every dashboard is built from. It re-declares the header rather than instancing CardHeader because a Component may not contain an Instance of another component with its own slot expectations; the shape is identical and the tokens are the same.',
    structure: 'Twelve sections; in-context shows two tiles in a row with different bodies.',
    antiPatterns: ['fix a tile’s height', 'colour the header'],
    design: ['CardSurface layer-2 + CardHeader row + body slot', 'padding 16, gap 16, radius 4'],
  },
}
```

- [ ] **Step 2: Build, look, commit**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/simple/build/run.mjs tile
```
Read `design-systems/simple/.build/tile/tile.png`; expect two filled tiles in the in-context frame. Then:
```bash
git add design-systems/simple/tile.uidx design-systems/simple/build/components/tile.mjs
git commit -m "Simple: Tile

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Button page

**Files:**
- Create: `design-systems/simple/build/components/button.mjs`
- Create (generated): `design-systems/simple/button.uidx`

**Interfaces:**
- Produces: `Button` with axes `kind ['default','primary','warning']`, `interaction ['default','hover','active','focus','disabled']`, `size ['md','big']`; props `label` (TEXT), `showIcon` (BOOLEAN). Dashboard uses `{ kind: 'primary', interaction: 'default', size: 'md', label: 'Load' }`.

- [ ] **Step 1: Write the descriptor**

```js
// design-systems/simple/build/components/button.mjs
import { C, S, TY, R, BTN, row, text, solid, frame, NONE } from '../lib/n.mjs'
import { icon } from '../lib/icons.mjs'

const look = (kind, interaction) => {
  const base = {
    default: { fill: NONE, stroke: BTN['default-border'], label: C.text },
    primary: { fill: solid(BTN['primary-fill']), stroke: BTN['primary-fill'], label: BTN.label },
    warning: { fill: solid(BTN['warning-fill']), stroke: BTN['warning-fill'], label: BTN.label },
  }[kind]
  if (interaction === 'hover') {
    if (kind === 'default') return { fill: solid(BTN['default-hover-fill']), stroke: BTN['default-border'], label: BTN['default-hover-text'] }
    if (kind === 'primary') return { ...base, fill: solid(BTN['primary-hover']), stroke: BTN['primary-hover'] }
    return { ...base, fill: solid(C.alert), stroke: C.alert }
  }
  if (interaction === 'active') {
    if (kind === 'default') return { fill: solid(BTN['default-active-fill']), stroke: BTN['default-active-fill'], label: BTN['default-hover-text'] }
    return base
  }
  return base
}

const button = ({ kind, interaction, size }) => {
  const l = look(kind, interaction)
  const big = size === 'big'
  const core = row('button', {
    primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'FIXED', height: big ? 36 : '{size#input}',
    primaryAxisAlignItems: 'CENTER', itemSpacing: S.sm,
    paddingLeft: big ? S.md : S.md, paddingRight: big ? S.md : S.md,
    cornerRadius: R.control, fills: l.fill, strokes: solid(l.stroke), strokeWeight: 1, strokeAlign: 'INSIDE',
    opacity: interaction === 'disabled' ? 0.4 : 1,
  }, [
    icon.refresh('icon', l.label),
    text('label', '{label}', { fontSize: big ? TY.body : TY.caption, fontWeight: 500, fills: solid(l.label) }),
  ])
  core.children[0].visible = '{showIcon}'
  if (interaction !== 'focus') return core
  return frame('focus', { layoutMode: 'HORIZONTAL', primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'AUTO', paddingTop: 1, paddingRight: 1, paddingBottom: 1, paddingLeft: 1, cornerRadius: 5, strokes: solid(BTN.focus), strokeWeight: 2, strokeAlign: 'OUTSIDE', fills: NONE }, [core])
}

export default {
  id: 'button', title: 'Button', eyebrow: 'Controls / Action',
  definition: 'A pressable label: transparent with a light border by default, filled blue when it is the one thing to do, filled red when it destroys.',
  overview: ['Default for anything reversible; primary for the single main action on a screen; warning for delete, reset, revoke.', 'Two sizes: md (28 tall, 12px label) everywhere in chrome and cards; big (36 tall, 14px) in forms and dialogs.', 'An icon is a prop: it precedes the label and never replaces it.'],
  tokenCollections: ['button'],
  component: {
    name: 'Button',
    props: { label: { type: 'TEXT', default: 'Load' }, showIcon: { type: 'BOOLEAN', default: false } },
    axes: { kind: ['default', 'primary', 'warning'], interaction: ['default', 'hover', 'active', 'focus', 'disabled'], size: ['md', 'big'] },
    designed: (c) => !(c.size === 'big' && (c.interaction === 'active' || c.interaction === 'focus')),
    variant: button,
  },
  states: { rows: 'kind', cols: 'interaction', sample: { label: 'Load' } },
  anatomyProps: { label: 'Load', showIcon: true },
  anatomy: ['1 button — auto width, min 60 by content, 28 tall, radius 3, 1px inside stroke', '2 icon — 16px, hidden unless showIcon', '3 label — 12px medium, 16px side padding', '4 focus — a 2px blue ring 1px outside the button, present only in the focus variant'],
  properties: [['label', 'TEXT', 'Load', 'the verb'], ['showIcon', 'BOOLEAN', 'false', 'a leading 16px glyph']],
  measurements: [['height md', '28 (size#input)'], ['height big', '36'], ['label md / big', '12 (type#caption) / 14 (type#body) medium'], ['side padding', '16 (space#md)'], ['radius', '3 (radius#control)'], ['stroke', '1 inside'], ['focus ring', '2 outside, 1 offset, button#focus'], ['disabled', 'opacity 0.4']],
  inContext: () => row('bar-actions', { itemSpacing: S.md, paddingTop: S.sm, paddingRight: S.md, paddingBottom: S.sm, paddingLeft: S.md, fills: solid(C['layer-1']) }, [
    text('l', 'Data preset', { fontSize: TY.body }),
    frame('input', { width: 100, height: '{size#input}', strokes: solid(C.border), strokeWeight: 1, cornerRadius: R.control, fills: solid(C['layer-0']) }),
    { element: 'Instance', name: 'load', component: 'Button', props: { kind: 'primary', interaction: 'default', size: 'md', label: 'Load' } },
    { element: 'Instance', name: 'cancel', component: 'Button', props: { kind: 'default', interaction: 'default', size: 'md', label: 'Cancel' } },
    { element: 'Instance', name: 'reset', component: 'Button', props: { kind: 'warning', interaction: 'default', size: 'md', label: 'Reset' } },
  ]),
  guidance: { do: ['One primary per screen.', 'Put the reversible action to the left of the primary.'], dont: ['Use warning for anything the user can undo.', 'Grow the button to show focus; the ring is outside.'] },
  accessibility: [['default label on layer-1', '15.5:1 — passes'], ['white on primary blue', '4.6:1 — passes AA'], ['white on warning red', 'white on #DC2D37: 4.9:1 — passes AA'], ['disabled at 40%', 'about 3.6:1 — fails AA text; disabled is exempt under 1.4.3 but the label must still be legible in the implementation'], ['focus ring', 'blue on layer-1: 4.6:1 — passes 1.4.11']],
  content: [['label', 'One verb, sentence case: “Load”, “Reset”'], ['never', '“OK”, “Submit”, “Click here”']],
  related: [['Pill', 'read, not pressed'], ['Input', 'the field a Load button acts on']],
  changelog: [['0.1', 'first draft'], ['0.1', 'big × active and big × focus left undesigned; the big size appears only in dialogs where hover suffices']],
  appearance: ['Small, quiet, near-square rectangles; default is an outline in text colour, primary a solid blue block with white text, warning the same in red.', 'Hover inverts the default (fills with text colour, label goes dark); active darkens further; disabled fades to 40%; focus adds a 2px blue ring outside.'],
  constraints: ['The focus indicator is a separate outer frame so the button never changes size.', 'Label weight is medium; buttons never use bold.'],
  intent: {
    core: 'What did the designer decide (kind), what is the pointer doing (interaction), how big is the room (size). Three axes because they are three different questions; the icon and the words are props because they change nothing about what the button is doing.',
    structure: 'Twelve sections; the states matrix is kind by interaction at md, with a size row beneath.',
    antiPatterns: ['design a fourth kind — a “secondary” is a default', 'make the focus ring part of the border', 'bold the label'],
    design: ['height 28 md / 36 big, radius 3, padding 16, 1px inside stroke', 'default: transparent + text-colour border; hover inverts', 'primary brand fill, hover brand-hover; warning danger fill, hover alert', 'disabled opacity 0.4; focus 2px blue ring outside at 1px'],
  },
}
```

- [ ] **Step 2: Build, look, commit**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/simple/build/run.mjs button
```
Read `design-systems/simple/.build/button/button.png`. Expect a 3×5 matrix of buttons, the hover column with inverted default and lighter blue, the focus column with a ring, disabled faded; a size row with two “not designed” texts absent (big only shows default/hover/disabled in the size row since it uses the default interaction). Then:
```bash
git add design-systems/simple/button.uidx design-systems/simple/build/components/button.mjs
git commit -m "Simple: Button

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Switch page

**Files:**
- Create: `design-systems/simple/build/components/switch.mjs`
- Create (generated): `design-systems/simple/switch.uidx`

**Interfaces:**
- Produces: `Switch` with axes `state ['off','on']`, `interaction ['default','hover','disabled']`, prop `label` (TEXT). Dashboard: `{ state: 'on', interaction: 'default', label: 'Show incident' }`.

- [ ] **Step 1: Write the descriptor**

```js
// design-systems/simple/build/components/switch.mjs
import { C, S, TY, R, SW, row, text, solid, frame, ellipse } from '../lib/n.mjs'

const sw = ({ state, interaction }) => {
  const on = state === 'on', dis = interaction === 'disabled', hov = interaction === 'hover'
  const track = frame('track', {
    layoutMode: 'HORIZONTAL', primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED', width: 32, height: 16,
    primaryAxisAlignItems: on ? 'MAX' : 'MIN', counterAxisAlignItems: 'CENTER',
    paddingLeft: 2, paddingRight: 2, cornerRadius: R.pill,
    fills: solid(dis ? SW['disabled-track'] : on ? SW['track-on'] : hov ? C['mark-muted'] : SW.track),
    strokes: solid(dis ? SW.border : on ? SW['track-on'] : hov ? SW['border-hover'] : SW.border), strokeWeight: 1, strokeAlign: 'INSIDE',
  }, [ellipse('knob', { width: 12, height: 12, fills: solid(dis ? SW['disabled-knob'] : SW.knob) })])
  return row('switch', { itemSpacing: S.sm, opacity: dis ? 0.6 : 1 }, [track, text('label', '{label}', { fontSize: TY.body })])
}

export default {
  id: 'switch', title: 'Switch', eyebrow: 'Controls / Toggle',
  definition: 'A 32×16 pill track with a 12px knob that slides right and turns the track blue; the label sits after it.',
  overview: ['For a setting that takes effect immediately — “Show incident” on a map.', 'Not for a choice that needs a Save button; that is a checkbox.', 'The label is the target as much as the track.'],
  tokenCollections: ['switch'],
  component: {
    name: 'Switch', props: { label: { type: 'TEXT', default: 'Show incident' } },
    axes: { state: ['off', 'on'], interaction: ['default', 'hover', 'disabled'] }, variant: sw,
  },
  states: { rows: 'state', cols: 'interaction', sample: { label: 'Show incident' } },
  anatomy: ['1 switch — row, 8 gap', '2 track — 32×16 pill, 1px inside border, 2px inner padding', '3 knob — 12px circle, left when off, right when on', '4 label — 14px'],
  properties: [['label', 'TEXT', 'Show incident', 'what the switch controls']],
  measurements: [['track', '32 × 16, radius pill'], ['knob', '12, inset 2'], ['gap to label', '8 (space#sm)'], ['off', 'switch#track fill, switch#border'], ['on', 'switch#track-on fill and border'], ['hover off', 'mark-muted fill, border-hover'], ['disabled', 'disabled-track, disabled-knob, row opacity 0.6']],
  inContext: () => row('map-bar', { itemSpacing: S.md, paddingTop: S.sm, paddingRight: S.md, paddingBottom: S.sm, paddingLeft: S.md, fills: solid(C['layer-2']) }, [
    frame('sel1', { width: 120, height: '{size#input}', strokes: solid(C.border), strokeWeight: 1, cornerRadius: R.control, fills: [] }),
    frame('sel2', { width: 120, height: '{size#input}', strokes: solid(C.border), strokeWeight: 1, cornerRadius: R.control, fills: [] }),
    { element: 'Instance', name: 'sw', component: 'Switch', props: { state: 'on', interaction: 'default', label: 'Show incident' } },
  ]),
  guidance: { do: ['Write the label as the thing that is on: “Show incident”.', 'Keep the knob white in both states; the track carries the state.'], dont: ['Use on/off words in the label.', 'Animate a colour on the knob.'] },
  accessibility: [['on track (blue) on layer-2', '4.3:1 — passes 1.4.11'], ['off track border gray-78 on layer-2', '2.4:1 — FAILS 3:1; the off state relies on the knob’s 12px white disc (12.6:1) to be perceived'], ['label', '14.1:1 — passes']],
  content: [['label', 'The condition when on: “Show incident”, “Live updates”']],
  related: [['Button', 'for an action rather than a setting'], ['Pill', 'selected pills are a multi-choice switch']],
  changelog: [['0.1', 'first draft; off-border contrast failure stated']],
  appearance: ['A tiny dark pill with a white dot at its left; on, the pill goes brand blue and the dot jumps right.', 'Disabled greys the dot and dims the row.'],
  constraints: ['The knob is 12 inside a 16 track — 2px of track shows above and below it.'],
  intent: {
    core: 'What the user said (off/on) and what the pointer is doing (default/hover/disabled) are different questions, so two axes. Focus is not designed here: EDS draws focus as the same 2px ring the Button uses and the implementation adds it outside.',
    structure: 'Twelve sections; the matrix is state by interaction.',
    antiPatterns: ['show state with the knob colour', 'put the label before the track'],
    design: ['track 32×16 pill, knob 12 at inset 2', 'off: layer-raised fill + border; on: brand fill', 'hover off: mark-muted fill; disabled: disabled-surface + grey knob at 0.6'],
  },
}
```

- [ ] **Step 2: Build, look, commit**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/simple/build/run.mjs switch
```
Read `design-systems/simple/.build/switch/switch.png`; expect a 2×3 matrix with blue tracks in the on row. Then:
```bash
git add design-systems/simple/switch.uidx design-systems/simple/build/components/switch.mjs
git commit -m "Simple: Switch

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Input page

**Files:**
- Create: `design-systems/simple/build/components/input.mjs`
- Create (generated): `design-systems/simple/input.uidx`

**Interfaces:**
- Produces: `Input` with axes `kind ['text','select']`, `interaction ['default','hover','focus','error','disabled']`; props `label` (TEXT), `showLabel` (BOOLEAN), `value` (TEXT). Dashboard: `{ kind: 'select', interaction: 'default', label: 'Time frame', showLabel: true, value: 'Today' }`.

- [ ] **Step 1: Write the descriptor**

```js
// design-systems/simple/build/components/input.mjs
import { C, S, TY, R, Z, IN, row, text, solid, frame } from '../lib/n.mjs'
import { icon } from '../lib/icons.mjs'

const input = ({ kind, interaction }) => {
  const border = { default: IN.border, hover: IN['border-hover'], focus: IN['border-focus'], error: IN['border-error'], disabled: IN.border }[interaction]
  const field = row('field', {
    primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED', width: 140, height: Z.input,
    primaryAxisAlignItems: 'SPACE_BETWEEN', paddingLeft: S.sm, paddingRight: S.sm, cornerRadius: R.control,
    fills: solid(interaction === 'disabled' ? IN['disabled-fill'] : IN.fill),
    strokes: solid(border), strokeWeight: interaction === 'focus' ? 2 : 1, strokeAlign: 'INSIDE',
  }, [
    text('value', '{value}', { fontSize: TY.caption, fills: solid(interaction === 'disabled' ? C['text-muted'] : C.text) }),
    ...(kind === 'select' ? [icon.chevron('chevron', C.text)] : []),
  ])
  return row('input', { itemSpacing: S.sm, opacity: interaction === 'disabled' ? 0.6 : 1 }, [
    text('label', '{label}', { fontSize: TY.caption, fills: solid(C['text-muted']), visible: '{showLabel}' }),
    field,
  ])
}

export default {
  id: 'input', title: 'Input', eyebrow: 'Controls / Field',
  definition: 'A 28px field on the darkest layer with a 1px border: text you type, or a value you pick from a list with a chevron.',
  overview: ['Inline label to the left (“Time frame  Today”) — dashboards have no room for stacked labels.', 'A select is the same field with a chevron; it is an axis because the chevron changes what the field does.', 'Focus thickens the border to 2px blue; error paints it red.'],
  tokenCollections: ['input'],
  component: {
    name: 'Input',
    props: { label: { type: 'TEXT', default: 'Time frame' }, showLabel: { type: 'BOOLEAN', default: true }, value: { type: 'TEXT', default: 'Today' } },
    axes: { kind: ['text', 'select'], interaction: ['default', 'hover', 'focus', 'error', 'disabled'] }, variant: input,
  },
  states: { rows: 'kind', cols: 'interaction', sample: { label: 'Time frame', showLabel: true, value: 'Today' } },
  anatomy: ['1 input — row, 8 gap', '2 label — 12px muted, hidden by showLabel', '3 field — 140 × 28, layer-0 fill, 1px inside border, radius 3, 8 side padding', '4 value — 12px text', '5 chevron — 10×6, select only'],
  properties: [['label', 'TEXT', 'Time frame', 'inline label'], ['showLabel', 'BOOLEAN', 'true', 'whether it shows'], ['value', 'TEXT', 'Today', 'the typed or chosen value']],
  measurements: [['height', '28 (size#input)'], ['width', '140 here; consumer sets'], ['padding', '8 (space#sm)'], ['radius', '3 (radius#control)'], ['border default / hover', 'input#border / input#border-hover, 1px'], ['border focus', 'input#border-focus, 2px'], ['border error', 'input#border-error, 1px'], ['fill', 'input#fill (layer-0); disabled input#disabled-fill']],
  inContext: () => row('tile-row', { itemSpacing: S.md, paddingTop: S.sm, paddingRight: S.md, paddingBottom: S.sm, paddingLeft: S.md, fills: solid(C['layer-2']) }, [
    { element: 'Instance', name: 'tf', component: 'Input', props: { kind: 'select', interaction: 'default', label: 'Time frame', showLabel: true, value: 'Today' } },
    { element: 'Instance', name: 'goto', component: 'Input', props: { kind: 'text', interaction: 'default', label: 'Go to', showLabel: true, value: '2' } },
  ]),
  guidance: { do: ['Use the inline label; it is the whole reason the field is 28 tall.', 'Show the current value, not a placeholder, whenever there is one.'], dont: ['Stack the label above the field inside a card.', 'Use error red for a hint; red means the value is refused.'] },
  accessibility: [['border gray-78 on layer-2', '2.4:1 — FAILS 3:1 (1.4.11); the field’s layer-0 fill against layer-2 adds 1.6:1 — the boundary is the fill step plus the border, and it is still short. Fix before stable: border-hover (gray-118, 4.2:1) at rest.'], ['value on layer-0', '17.4:1 — passes'], ['focus 2px blue', '4.6:1 — passes']],
  content: [['label', 'A noun, no colon: “Time frame”'], ['value', 'As entered; selects show the chosen option']],
  related: [['Button', 'what submits it'], ['Pagination', 'holds a 40px Go-to input']],
  changelog: [['0.1', 'first draft; rest border contrast failure stated']],
  appearance: ['A short dark slot slightly darker than the card, hairline-bordered, value in 12px; a small chevron at the right for selects.', 'Focus: the border goes blue and 2px. Error: red 1px.'],
  constraints: ['Height is always 28; the label never changes it.'],
  intent: {
    core: 'A field is text or a pick (kind), and it is resting, hovered, focused, refused or off (interaction). Value and label are props. The inline label is the EDS dashboard idiom and it is why the component owns the label at all.',
    structure: 'Twelve sections; the matrix is kind by interaction.',
    antiPatterns: ['draw the placeholder in text colour', 'thicken the border on hover — hover lightens, focus thickens'],
    design: ['field 140×28, layer-0 fill, 1px border, radius 3, padding 8', 'label 12px muted, 8 before the field', 'focus: 2px brand; error: 1px danger; disabled: disabled-surface fill, 0.6'],
  },
}
```

- [ ] **Step 2: Build, look, commit**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/simple/build/run.mjs input
```
Read `design-systems/simple/.build/input/input.png`; expect a 2×5 matrix, chevrons on the second row, a blue thick border in the focus column and red in error. Then:
```bash
git add design-systems/simple/input.uidx design-systems/simple/build/components/input.mjs
git commit -m "Simple: Input

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Pill page

**Files:**
- Create: `design-systems/simple/build/components/pill.mjs`
- Create (generated): `design-systems/simple/pill.uidx`

**Interfaces:**
- Produces: `Pill` with axes `tone ['neutral','blue','green','yellow','red']`, `selected ['off','on']`, prop `label` (TEXT).

- [ ] **Step 1: Write the descriptor**

```js
// design-systems/simple/build/components/pill.mjs
import { C, S, TY, R, Z, row, text, solid, NONE } from '../lib/n.mjs'

const pill = ({ tone, selected }) => {
  const fill = { neutral: C['layer-raised'], blue: C.brand, green: C.ok, yellow: C.warn, red: C.danger }[tone]
  const label = tone === 'yellow' ? C['text-inverse'] : tone === 'neutral' ? C.text : C.white
  return row('pill', {
    primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'FIXED', height: Z.pill, primaryAxisAlignItems: 'CENTER',
    paddingLeft: S.sm, paddingRight: S.sm, cornerRadius: R.pill, fills: solid(fill),
    strokes: selected === 'on' ? solid(C.text) : NONE, strokeWeight: 1, strokeAlign: 'INSIDE',
  }, [text('label', '{label}', { fontSize: TY.caption, fontWeight: 500, fills: solid(label) })])
}

export default {
  id: 'pill', title: 'Pill', eyebrow: 'Controls / Tag',
  definition: 'A 20px rounded tag: neutral for a category, toned for a status, outlined when it is the active filter.',
  overview: ['Read, not pressed: a pill labels a row or a card.', 'Selected pills are filters; the outline says “this one is on”.', 'Tone is meaning: blue is brand, green ok, yellow warn, red danger — never decoration.'],
  component: {
    name: 'Pill', props: { label: { type: 'TEXT', default: 'Extreme' } },
    axes: { tone: ['neutral', 'blue', 'green', 'yellow', 'red'], selected: ['off', 'on'] }, variant: pill,
  },
  states: { rows: 'tone', cols: 'selected', sample: { label: 'Extreme' } },
  anatomy: ['1 pill — 20 tall, radius pill, 8 side padding', '2 label — 12px medium; dark on yellow, white on other tones, text on neutral', '3 selection stroke — 1px inside in text colour, on only'],
  properties: [['label', 'TEXT', 'Extreme', 'the tag']],
  measurements: [['height', '20 (size#pill)'], ['padding', '8 (space#sm)'], ['radius', 'pill (radius#pill)'], ['label', '12 (type#caption) medium'], ['neutral fill', 'color#layer-raised'], ['tones', 'brand / ok / warn / danger'], ['selected stroke', '1px color#text inside']],
  inContext: () => row('legend', { itemSpacing: S.sm, paddingTop: S.sm, paddingRight: S.md, paddingBottom: S.sm, paddingLeft: S.md, fills: solid(C['layer-2']) }, [
    { element: 'Instance', name: 'a', component: 'Pill', props: { tone: 'neutral', selected: 'on', label: 'All' } },
    { element: 'Instance', name: 'b', component: 'Pill', props: { tone: 'red', selected: 'off', label: 'Extreme' } },
    { element: 'Instance', name: 'c', component: 'Pill', props: { tone: 'yellow', selected: 'off', label: 'High' } },
    { element: 'Instance', name: 'd', component: 'Pill', props: { tone: 'neutral', selected: 'off', label: 'Low' } },
  ]),
  guidance: { do: ['Use neutral unless the word is a status.', 'Put the dark label on yellow; white fails.'], dont: ['Make a pill the only way to trigger an action.', 'Use blue for “selected” — selection is the outline.'] },
  accessibility: [['white on red-dark', '4.9:1 — passes'], ['white on green-dark', '4.6:1 — passes'], ['white on blue', '4.6:1 — passes'], ['white on yellow-dark', '1.9:1 — FAILS; this page uses text-inverse (black-24) on yellow: 9.6:1'], ['text on neutral (layer-raised)', '11.5:1 — passes']],
  content: [['label', 'One or two words, sentence case: “Extreme”, “On time”']],
  related: [['Button', 'pressed, not read'], ['TableRow', 'where criticality pills would go if the row did not use dots']],
  changelog: [['0.1', 'first draft']],
  appearance: ['Tiny capsule, text just clearing the ends; filled solid in one status colour or in a raised grey; a thin light outline when chosen.'],
  constraints: ['Yellow carries a dark label; every other tone a white one.'],
  intent: {
    core: 'Tone and selection are independent: any tone can be the active filter. Label is a prop.',
    structure: 'Twelve sections; the matrix is tone by selected.',
    antiPatterns: ['add a hover — pills are read', 'use a second neutral'],
    design: ['20 tall, pill radius, 8 padding, 12px medium label', 'neutral layer-raised; tones brand/ok/warn/danger', 'selected: 1px text-colour inside stroke'],
  },
}
```

- [ ] **Step 2: Build, look, commit**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/simple/build/run.mjs pill
```
Read `design-systems/simple/.build/pill/pill.png`; expect a 5×2 matrix, dark text on the yellow row. Then:
```bash
git add design-systems/simple/pill.uidx design-systems/simple/build/components/pill.mjs
git commit -m "Simple: Pill

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Pagination page

**Files:**
- Create: `design-systems/simple/build/components/pagination.mjs`
- Create (generated): `design-systems/simple/pagination.uidx`

**Interfaces:**
- Consumes: `Input` from Task 10 (instanced inside the in-context frame only; the component draws its own field so it stays self-contained).
- Produces: `Pagination`, no axes, props `current` (TEXT), `goTo` (TEXT), `entries` (TEXT).

- [ ] **Step 1: Write the descriptor**

```js
// design-systems/simple/build/components/pagination.mjs
import { C, S, TY, R, Z, row, col, text, caption, solid, frame, rect } from '../lib/n.mjs'
import { icon } from '../lib/icons.mjs'

const page = (n, current) => col(`p${n}`, { itemSpacing: 2, counterAxisAlignItems: 'CENTER' }, [
  text('n', String(n), { fontSize: TY.caption, fontWeight: current ? 500 : 400 }),
  rect('under', { width: 10, height: 2, fills: solid(current ? C.text : { r: 0, g: 0, b: 0, a: 0 }) }),
])

const pagination = () =>
  row('pagination', { primaryAxisSizingMode: 'FIXED', width: 500, primaryAxisAlignItems: 'SPACE_BETWEEN' }, [
    row('pages', { itemSpacing: S.md }, [
      icon.arrowLeft('prev', C['text-muted']),
      ...[1, 2, 3, 4, 5].map((n) => page(n, n === 1)),
      icon.arrow('next', C.text),
      caption('goto-label', 'Go to', { fills: solid(C.text) }),
      frame('goto', { width: 40, height: Z.input, layoutMode: 'HORIZONTAL', primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED', counterAxisAlignItems: 'CENTER', paddingLeft: S.sm, strokes: solid(C.border), strokeWeight: 1, cornerRadius: R.control, fills: solid(C['layer-0']) }, [text('v', '{goTo}', { fontSize: TY.caption })]),
    ]),
    row('entries', { itemSpacing: S.sm, height: Z.input, counterAxisSizingMode: 'FIXED', paddingLeft: S.sm, paddingRight: S.sm, strokes: solid(C.border), strokeWeight: 1, cornerRadius: R.control }, [text('e', '{entries}', { fontSize: TY.caption }), icon.chevron('chev', C.text)]),
  ])

export default {
  id: 'pagination', title: 'Pagination', eyebrow: 'Controls / Table',
  definition: 'The row under a table: arrows, five page numbers with the current one underlined, a Go-to field, and an entries-per-page select at the far right.',
  overview: ['Only under a TableRow stack; never under a list.', 'Page numbers are text with a 2px underline for the current page — no boxes.', 'The current page is a prop so the same row can be instanced at any page; the numbers themselves are fixed at 1–5 in this draft.'],
  component: {
    name: 'Pagination', props: { current: { type: 'TEXT', default: '1' }, goTo: { type: 'TEXT', default: '2' }, entries: { type: 'TEXT', default: '4 entries' } },
    axes: {}, variant: pagination,
  },
  states: { samples: [{ label: 'default', props: {} }, { label: 'other entries', props: { entries: '10 entries', goTo: '4' } }] },
  anatomy: ['1 pagination — 500 wide here, space-between', '2 pages — arrow, five numbers 16 apart, arrow, “Go to”, a 40px field', '3 number — 12px; current is medium with a 2px underline', '4 entries — a 28px bordered select'],
  properties: [['current', 'TEXT', '1', 'the page shown (draft: page 1 is drawn underlined)'], ['goTo', 'TEXT', '2', 'the field’s value'], ['entries', 'TEXT', '4 entries', 'the page-size label']],
  measurements: [['gap', '16 (space#md)'], ['numbers', '12 (type#caption)'], ['underline', '10 × 2, color#text'], ['go-to field', '40 × 28 (size#input)'], ['entries select', '28 tall, 1px border']],
  inContext: () => col('table-foot', { itemSpacing: S.md, paddingTop: S.md, paddingRight: S.md, paddingBottom: S.md, paddingLeft: S.md, fills: solid(C['layer-2']) }, [
    row('last-row', { primaryAxisSizingMode: 'FIXED', width: 500, primaryAxisAlignItems: 'SPACE_BETWEEN' }, [text('a', 'Low   VDC 09', { fontSize: TY.caption }), caption('b', '34%')]),
    { element: 'Instance', name: 'pg', component: 'Pagination', props: { current: '1', goTo: '2', entries: '4 entries' } },
  ]),
  guidance: { do: ['Keep the row to one line at 500 or wider.', 'Underline the current page; never fill it.'], dont: ['Show more than five numbers; use Go to.', 'Drop the entries select — page size is the user’s.'] },
  accessibility: [['numbers on layer-2', '14.1:1 — passes'], ['inactive arrow at 60%', 'about 8:1 — passes'], ['hit areas', '12px numbers are below the 24px target minimum of 2.5.8; the implementation must pad them']],
  content: [['go to', 'Exactly “Go to”'], ['entries', '“4 entries”, the number first']],
  related: [['TableRow', 'what it pages'], ['Input', 'the Go-to field is one']],
  changelog: [['0.1', 'first draft; numbers fixed at 1–5']],
  appearance: ['A quiet single line of small numerals under a table; the current one has a short bar under it; a tiny dark field and, far right, a bordered “4 entries ⌄”.'],
  constraints: ['The underline is a separate rectangle so the number never shifts when it becomes current.'],
  intent: {
    core: 'No axes: a pagination row does not have states of its own — its numbers do, and they are drawn from a prop. Everything the user can change (page, go-to value, page size) is a prop.',
    structure: 'Twelve sections; states shows two prop samples.',
    antiPatterns: ['box the page numbers', 'centre the row — it hangs left with the select right'],
    design: ['arrows, numbers 12px at 16 gaps, underline 10×2 under the current', 'go-to 40×28 field; entries 28 select bordered', 'space-between across the table width'],
  },
}
```

- [ ] **Step 2: Build, look, commit**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/simple/build/run.mjs pagination
```
Read `design-systems/simple/.build/pagination/pagination.png`; expect the row with 1 underlined. Then:
```bash
git add design-systems/simple/pagination.uidx design-systems/simple/build/components/pagination.mjs
git commit -m "Simple: Pagination

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Label page

**Files:**
- Create: `design-systems/simple/build/components/label.mjs`
- Create (generated): `design-systems/simple/label.uidx`

**Interfaces:**
- Produces: `Label` with axes `layout ['stacked','inline']`, `arrow ['on','off']`; props `caption`, `value`, `suffix` (TEXT), `showSuffix` (BOOLEAN). Dashboard: `{ layout: 'stacked', arrow: 'on', caption: 'API request', value: '1 687', suffix: 'requests', showSuffix: true }`.

- [ ] **Step 1: Write the descriptor**

```js
// design-systems/simple/build/components/label.mjs
import { C, S, TY, row, col, text, caption, figure, solid } from '../lib/n.mjs'
import { icon } from '../lib/icons.mjs'

const label = ({ layout, arrow }) => {
  const head = row('caption-row', { itemSpacing: S.xs }, [caption('caption', '{caption}'), ...(arrow === 'on' ? [icon.arrow('arrow')] : [])])
  const value = figure('value', '{value}')
  const suffix = caption('suffix', '{suffix}', { visible: '{showSuffix}' })
  return layout === 'stacked'
    ? col('label', { itemSpacing: S.xs }, [head, value, suffix])
    : col('label', { itemSpacing: S.xs }, [head, row('figure-row', { itemSpacing: S.sm, counterAxisAlignItems: 'BASELINE' }, [value, suffix])])
}

export default {
  id: 'label', title: 'Label', eyebrow: 'Data / Figure',
  definition: 'A KPI: a small muted caption with an arrow, a big light figure, and an optional muted qualifier under or beside it.',
  overview: ['The commonest thing inside a tile: “API request → 1 687 requests”.', 'Stacked when the qualifier is a unit or a noun; inline when it is a fraction (“43 000 of 81 fines”).', 'The arrow means the caption is a link to the detail; drop it when there is none.'],
  component: {
    name: 'Label',
    props: { caption: { type: 'TEXT', default: 'API request' }, value: { type: 'TEXT', default: '1 687' }, suffix: { type: 'TEXT', default: 'requests' }, showSuffix: { type: 'BOOLEAN', default: true } },
    axes: { layout: ['stacked', 'inline'], arrow: ['on', 'off'] }, variant: label,
  },
  states: { rows: 'layout', cols: 'arrow', sample: {} },
  anatomy: ['1 label — column, 4 gap', '2 caption row — 12px muted caption, 4, an 11×10 arrow', '3 value — 32px regular in text colour', '4 suffix — 12px muted, under the value (stacked) or on its baseline (inline)'],
  properties: [['caption', 'TEXT', 'API request', 'what the number is'], ['value', 'TEXT', '1 687', 'the number, thin-space grouped'], ['suffix', 'TEXT', 'requests', 'unit or fraction'], ['showSuffix', 'BOOLEAN', 'true', 'whether it shows']],
  measurements: [['caption', '12 (type#caption) muted'], ['value', '32 (type#display) regular'], ['suffix', '12 (type#caption) muted'], ['gaps', '4 (space#xs); inline value–suffix 8 (space#sm)'], ['arrow', '11 × 10, muted']],
  inContext: () => col('summary', { itemSpacing: S.lg, paddingTop: S.md, paddingRight: S.md, paddingBottom: S.md, paddingLeft: S.md, fills: solid(C['layer-2']) }, [
    row('r1', { itemSpacing: S.xxl, counterAxisAlignItems: 'MIN' }, [
      { element: 'Instance', name: 'api', component: 'Label', props: { layout: 'stacked', arrow: 'on', caption: 'API request', value: '1 687', suffix: 'requests', showSuffix: true } },
      { element: 'Instance', name: 'rev', component: 'Label', props: { layout: 'inline', arrow: 'on', caption: 'Revenue (in AED)', value: '43 000', suffix: 'of 81 fines', showSuffix: true } },
    ]),
    row('r2', { itemSpacing: S.xxl, counterAxisAlignItems: 'MIN' }, [
      { element: 'Instance', name: 'alarm', component: 'Label', props: { layout: 'stacked', arrow: 'on', caption: 'Alarm', value: '591', suffix: '', showSuffix: false } },
      { element: 'Instance', name: 'fraud', component: 'Label', props: { layout: 'stacked', arrow: 'on', caption: 'Fraud warning', value: '4', suffix: '', showSuffix: false } },
    ]),
  ]),
  guidance: { do: ['Group thousands with a thin space: 13 719.', 'Keep the figure regular weight; size does the emphasis.'], dont: ['Colour a figure. Status lives in dots and bars, not numbers.', 'Bold the caption.'] },
  accessibility: [['figure on layer-2', '14.1:1 — passes'], ['caption at 60%', 'about 8:1 — passes'], ['arrow', 'decorative; the caption is the link text']],
  content: [['caption', 'A noun phrase, sentence case: “Monthly average”'], ['value', 'Digits with thin-space grouping; no unit inside'], ['suffix', 'The unit or “of N …”']],
  related: [['Tile', 'where labels live'], ['Gauge', 'the same figure in a ring'], ['BarStat', 'a label with a bar instead of a figure']],
  changelog: [['0.1', 'first draft']],
  appearance: ['Small grey words with a tiny arrow, then a large thin number in white, then small grey words again — three lines, left-aligned, no rules.'],
  constraints: ['The figure never changes colour or weight; only size distinguishes it.'],
  intent: {
    core: 'Layout and arrow are axes because they change the tree; the words are props. There is no state: a label is never hovered or disabled.',
    structure: 'Twelve sections; the matrix is layout by arrow.',
    antiPatterns: ['put a unit inside the value', 'use display size for a caption'],
    design: ['caption 12 muted + arrow; value 32 regular; suffix 12 muted', 'stacked: three lines at 4; inline: value and suffix on one baseline at 8'],
  },
}
```

- [ ] **Step 2: Build, look, commit**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/simple/build/run.mjs label
```
Read `design-systems/simple/.build/label/label.png`; expect the four KPIs in the in-context frame reading like the fleet summary. Then:
```bash
git add design-systems/simple/label.uidx design-systems/simple/build/components/label.mjs
git commit -m "Simple: Label

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Gauge page

**Files:**
- Create: `design-systems/simple/build/components/gauge.mjs`
- Create (generated): `design-systems/simple/gauge.uidx`

**Interfaces:**
- Consumes: `arcPath`, `tickPath` from `n.mjs`.
- Produces: `Gauge` with axis `tone ['neutral','alert']`; props `value`, `unit`, `min`, `max` (TEXT). Dashboard: `{ tone: 'alert', value: '85', unit: '%', min: '0', max: '1TB' }`.

- [ ] **Step 1: Write the descriptor**

```js
// design-systems/simple/build/components/gauge.mjs
import { C, S, TY, Z, col, row, text, caption, figure, solid, vector, canvas } from '../lib/n.mjs'
import { arcPath, tickPath } from '../lib/n.mjs'

const SWEEP_START = -135, SWEEP_END = 135, FILLED_TO = 60 // the exemplar reads 85% of a 270° sweep ≈ 60° past top... drawn as the reference: filled from -135 to +60

const gauge = ({ tone }) =>
  col('gauge', { itemSpacing: S.sm, counterAxisAlignItems: 'CENTER' }, [
    canvas('dial', 200, 200, {}, [
      vector('ticks', tickPath(100, 100, 96, 8, SWEEP_START, SWEEP_END, 60), { x: 0, y: 0, width: 200, height: 200, strokes: solid(C['mark-muted']), strokeWeight: 2, strokeCap: 'BUTT' }),
      vector('sweep', arcPath(100, 100, 82, SWEEP_START, FILLED_TO), { x: 0, y: 0, width: 200, height: 200, strokes: solid(tone === 'alert' ? C.danger : C.mark), strokeWeight: 3, strokeCap: 'BUTT' }),
      vector('rest', arcPath(100, 100, 82, FILLED_TO, SWEEP_END), { x: 0, y: 0, width: 200, height: 200, strokes: solid(C['mark-track']), strokeWeight: 3, strokeCap: 'BUTT' }),
      col('centre', { x: 50, y: 62, width: 100, counterAxisSizingMode: 'FIXED', counterAxisAlignItems: 'CENTER', itemSpacing: S.xs }, [
        figure('value', '{value}', { fontSize: TY.hero }),
        caption('unit', '{unit}'),
      ]),
      caption('min', '{min}', { x: 52, y: 176 }),
      caption('max', '{max}', { x: 128, y: 176 }),
    ]),
  ])

export default {
  id: 'gauge', title: 'Gauge', eyebrow: 'Data / Dial',
  definition: 'A 200px dial: a 270° ring of grey ticks, a 3px inner arc filled to the value in white or red, the figure in the middle, min and max under the opening.',
  overview: ['One headline number against a range — compliance score, active vehicles.', 'Alert tone paints the filled arc red when the value is a problem; otherwise the arc is white.', 'Never two gauges in one tile; use Labels for the secondary figures.'],
  component: {
    name: 'Gauge',
    props: { value: { type: 'TEXT', default: '85' }, unit: { type: 'TEXT', default: '%' }, min: { type: 'TEXT', default: '0' }, max: { type: 'TEXT', default: '1TB' } },
    axes: { tone: ['neutral', 'alert'] }, variant: gauge,
  },
  states: { rows: 'tone', cols: null, sample: {} },
  anatomy: ['1 dial — 200 square canvas', '2 ticks — 60 radial 2×8 marks at radius 96, from −135° to +135°', '3 sweep — 3px arc at radius 82 from −135° to the value', '4 rest — the remainder of the arc in mark-track', '5 centre — 48px figure over a 12px unit', '6 min / max — 12px muted, under the opening'],
  properties: [['value', 'TEXT', '85', 'the figure'], ['unit', 'TEXT', '%', 'under the figure'], ['min', 'TEXT', '0', 'left of the opening'], ['max', 'TEXT', '1TB', 'right of the opening']],
  measurements: [['dial', '200 (size#gauge)'], ['ticks', '60 × (2 × 8) at r 96, color#mark-muted'], ['arc', '3px at r 82; filled color#mark or color#danger; rest color#mark-track'], ['sweep', '270°, gap at the bottom'], ['figure', '48 (type#hero) regular'], ['unit / min / max', '12 (type#caption) muted']],
  inContext: () => col('tile', { counterAxisSizingMode: 'FIXED', width: 320, itemSpacing: S.md, paddingTop: S.md, paddingRight: S.md, paddingBottom: S.md, paddingLeft: S.md, fills: solid(C['layer-2']), cornerRadius: '{radius#card}' }, [
    text('t', 'Total Compliance Score', { fontSize: TY.title, fontWeight: 500 }),
    row('centre', { primaryAxisSizingMode: 'FIXED', width: 288, primaryAxisAlignItems: 'CENTER' }, [{ element: 'Instance', name: 'g', component: 'Gauge', props: { tone: 'alert', value: '85', unit: '%', min: '0', max: '1TB' } }]),
    row('foot', { primaryAxisSizingMode: 'FIXED', width: 288, primaryAxisAlignItems: 'SPACE_BETWEEN' }, [
      row('a', { itemSpacing: S.sm, counterAxisAlignItems: 'BASELINE' }, [figure('n', '120'), caption('c', 'Assets Tracked')]),
      row('b', { itemSpacing: S.sm, counterAxisAlignItems: 'BASELINE' }, [figure('n', '134'), caption('c', 'Policies Enforced')]),
    ]),
  ]),
  guidance: { do: ['Centre the dial in its tile.', 'Use alert only when the reading itself is the alarm.'], dont: ['Add a needle.', 'Colour the ticks.'] },
  accessibility: [['white arc on layer-2', '14.1:1 — passes'], ['red arc on layer-2', '3.9:1 — passes 1.4.11'], ['ticks gray-118 on layer-2', '4.2:1 — passes'], ['the value is text', 'the figure carries the reading; the arc is redundant, as it should be']],
  content: [['unit', 'A symbol or short word: “%”, “active vehicles”'], ['min / max', 'Bare values: “0”, “245”, “1TB”']],
  related: [['RadialProgress', 'a percentage on a plain ring'], ['Label', 'the figure without the dial']],
  changelog: [['0.1', 'first draft; the filled sweep is fixed at the exemplar value — a value-driven sweep needs a geometry prop the format does not have']],
  appearance: ['A ring of fine grey dashes open at the bottom like a speedometer; inside it a thinner arc, red then grey, tracing how far the value has come; the number sits large and light in the middle with its unit below, and 0 and the maximum sit small at either foot of the opening.'],
  constraints: ['Ticks are outside the arc by 14px; the arc never touches them.', 'The opening is at the bottom, 90° wide.'],
  intent: {
    core: 'A gauge has one axis — whether its reading is an alarm — because that is the only thing that changes how it is drawn. Value, unit and range are text props. The sweep angle cannot follow the value in this format, so the drawing is the exemplar’s and the changelog says so.',
    structure: 'Twelve sections; states shows neutral over alert.',
    antiPatterns: ['draw a needle or a filled wedge', 'put the unit inside the figure'],
    design: ['200 canvas; 60 ticks 2×8 at r 96 over 270°; 3px arc at r 82', 'filled arc mark or danger, remainder mark-track', 'figure 48 + unit 12 centred; min/max 12 under the opening'],
  },
}
```

- [ ] **Step 2: Build, look, commit**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/simple/build/run.mjs gauge
```
Read `design-systems/simple/.build/gauge/gauge.png`; expect the tick ring with a red arc in the alert row and a white one in neutral. If the arc drew as a chord (the Task 1 probe said arcs fail), rerun with `ARC_MODE=poly`. Then:
```bash
git add design-systems/simple/gauge.uidx design-systems/simple/build/components/gauge.mjs
git commit -m "Simple: Gauge

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: RadialProgress page

**Files:**
- Create: `design-systems/simple/build/components/radial-progress.mjs`
- Create (generated): `design-systems/simple/radial-progress.uidx`

**Interfaces:**
- Produces: `RadialProgress` with axis `size ['md','lg']`, prop `value` (TEXT). Dashboard: `{ size: 'md', value: '20' }`.

- [ ] **Step 1: Write the descriptor**

```js
// design-systems/simple/build/components/radial-progress.mjs
import { C, S, TY, col, caption, figure, solid, vector, canvas, arcPath, ringPath, text, row } from '../lib/n.mjs'

const radial = ({ size }) => {
  const d = size === 'lg' ? 200 : 140, r = d / 2 - 4, c = d / 2
  return canvas('radial', d, d, {}, [
    vector('ring', ringPath(c, c, r), { x: 0, y: 0, width: d, height: d, strokes: solid(C['mark-track']), strokeWeight: 1 }),
    vector('arc', arcPath(c, c, r, 0, 72), { x: 0, y: 0, width: d, height: d, strokes: solid(C.mark), strokeWeight: 6, strokeCap: 'BUTT' }),
    col('centre', { x: c - 50, y: c - 34, width: 100, counterAxisSizingMode: 'FIXED', counterAxisAlignItems: 'CENTER', itemSpacing: S.xs }, [
      figure('value', '{value}', { fontSize: TY.hero }),
      caption('pct', '%'),
    ]),
  ])
}

export default {
  id: 'radial-progress', title: 'RadialProgress', eyebrow: 'Data / Ring',
  definition: 'A thin full ring with a 6px arc from twelve o’clock showing a share, the percentage large in the middle.',
  overview: ['A part of a whole: “devices this month out of this year”.', 'Two sizes; md fits a one-column tile, lg a hero tile.', 'The arc is always white; a share is not an alarm.'],
  component: { name: 'RadialProgress', props: { value: { type: 'TEXT', default: '20' } }, axes: { size: ['md', 'lg'] }, variant: radial },
  states: { rows: 'size', cols: null, sample: {} },
  anatomy: ['1 canvas — 140 or 200 square', '2 ring — 1px full circle at radius d/2 − 4 in mark-track', '3 arc — 6px from 0° clockwise to the share (72° here = 20%)', '4 centre — 48px figure over a 12px “%”'],
  properties: [['value', 'TEXT', '20', 'the percentage figure']],
  measurements: [['md / lg', '140 (size#radial) / 200 (size#gauge)'], ['ring', '1px color#mark-track'], ['arc', '6px color#mark, butt caps'], ['figure', '48 (type#hero)'], ['%', '12 (type#caption) muted']],
  inContext: () => col('tile', { counterAxisSizingMode: 'FIXED', width: 320, itemSpacing: S.md, paddingTop: S.md, paddingRight: S.md, paddingBottom: S.md, paddingLeft: S.md, fills: solid(C['layer-2']), cornerRadius: '{radius#card}' }, [
    row('h', { itemSpacing: S.sm, counterAxisAlignItems: 'BASELINE' }, [text('t', 'Telematic devices', { fontSize: TY.title, fontWeight: 500 }), caption('s', 'This month')]),
    caption('sub', 'Devices this month out of this year (%)'),
    row('c', { primaryAxisSizingMode: 'FIXED', width: 288, primaryAxisAlignItems: 'CENTER' }, [{ element: 'Instance', name: 'r', component: 'RadialProgress', props: { size: 'md', value: '20' } }]),
    col('foot', { itemSpacing: S.xs }, [caption('l', 'Today  →'), row('f', { itemSpacing: S.sm, counterAxisAlignItems: 'BASELINE' }, [figure('n', '2 748'), caption('of', 'of 13 740')])]),
  ]),
  guidance: { do: ['Start the arc at twelve o’clock.', 'Pair it with a Label giving the absolute numbers.'], dont: ['Colour the arc by value.', 'Round the arc’s ends; the reference is square.'] },
  accessibility: [['arc on layer-2', '14.1:1 — passes'], ['ring gray-64 on layer-2', '1.9:1 — decorative; the figure carries the value']],
  content: [['value', 'Whole percent, no sign; the “%” is drawn']],
  related: [['Gauge', 'a value against a range with ticks'], ['BarStat', 'the same share as a bar']],
  changelog: [['0.1', 'first draft; arc fixed at 20% (see Gauge)']],
  appearance: ['A hairline circle with a short thick white stroke riding its top-right quarter, a large light number dead centre and a tiny % beneath.'],
  constraints: ['Arc stroke is 6 on a 1 ring; the ring passes under the arc’s middle.'],
  intent: {
    core: 'Size is the only axis; there is no tone because a share is neutral. Value is a text prop; the arc angle is fixed at the exemplar’s.',
    structure: 'Twelve sections.',
    antiPatterns: ['add ticks — that is a Gauge', 'put the % in the figure'],
    design: ['ring 1px mark-track; arc 6px mark from 0° clockwise', 'figure 48 + “%” 12 centred'],
  },
}
```

- [ ] **Step 2: Build, look, commit**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/simple/build/run.mjs radial-progress
```
Read `design-systems/simple/.build/radial-progress/radial-progress.png`. Then:
```bash
git add design-systems/simple/radial-progress.uidx design-systems/simple/build/components/radial-progress.mjs
git commit -m "Simple: RadialProgress

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: Sparkline page

**Files:**
- Create: `design-systems/simple/build/components/sparkline.mjs`
- Create (generated): `design-systems/simple/sparkline.uidx`

**Interfaces:**
- Produces: `Sparkline`, no axes, props `unit` (TEXT). Dashboard: `{ unit: 'Devices (x 1 000)' }`.

- [ ] **Step 1: Write the descriptor**

```js
// design-systems/simple/build/components/sparkline.mjs
import { C, S, TY, col, row, caption, figure, solid, vector, canvas, hairline, text } from '../lib/n.mjs'

const W = 288, H = 140, PLOT_X = 24, PLOT_W = W - PLOT_X
const line = 'M0 60 L28 36 L52 56 L72 88 L112 52 L152 38 L192 62 L232 46 L264 44'

const spark = () =>
  col('sparkline', { itemSpacing: S.sm }, [
    caption('unit', '{unit}'),
    canvas('plot', W, H, {}, [
      ...[0, 1, 2, 3].map((i) => hairline(`grid${i}`, PLOT_W, C.hairline)).map((h, i) => ({ ...h, x: PLOT_X, y: 8 + i * 36 })),
      ...['6', '4', '2', '0'].map((t, i) => caption(`y${i}`, t, { x: 0, y: i * 36 })),
      vector('line', line, { x: PLOT_X, y: 8, width: PLOT_W, height: 100, strokes: solid(C.mark), strokeWeight: 1, strokeJoin: 'ROUND' }),
      ...[['Jan', 0], ['Apr', 88], ['Aug', 176], ['Dec', 244]].map(([t, x], i) => caption(`x${i}`, t, { x: PLOT_X + x, y: 124 })),
    ]),
  ])

export default {
  id: 'sparkline', title: 'Sparkline', eyebrow: 'Data / Line',
  definition: 'A 1px white line over four hairline gridlines with muted axis labels: a year of one measure in a tile.',
  overview: ['A trend, not a chart to read values from: labels are sparse on purpose.', 'The line is always white and 1px; status colour belongs to markers, which this draft does not draw.', 'The path is fixed at the exemplar; a data-driven line needs geometry the format does not carry.'],
  component: { name: 'Sparkline', props: { unit: { type: 'TEXT', default: 'Devices (x 1 000)' } }, axes: {}, variant: spark },
  states: { samples: [{ label: 'default', props: {} }, { label: 'other unit', props: { unit: 'Requests (x 100)' } }] },
  anatomy: ['1 unit — 12px muted', '2 plot — 288 × 140 canvas', '3 gridlines — four hairlines 36 apart', '4 y labels — 6 / 4 / 2 / 0 at the left', '5 line — 1px polyline', '6 x labels — Jan / Apr / Aug / Dec'],
  properties: [['unit', 'TEXT', 'Devices (x 1 000)', 'the y-axis unit line']],
  measurements: [['plot', '288 × 140'], ['gridlines', '4, 36 apart, color#hairline'], ['line', '1px color#mark'], ['labels', '12 (type#caption) muted']],
  inContext: () => col('tile', { counterAxisSizingMode: 'FIXED', width: 320, itemSpacing: S.md, paddingTop: S.md, paddingRight: S.md, paddingBottom: S.md, paddingLeft: S.md, fills: solid(C['layer-2']), cornerRadius: '{radius#card}' }, [
    row('h', { itemSpacing: S.sm, counterAxisAlignItems: 'BASELINE' }, [text('t', 'Telematic devices', { fontSize: TY.title, fontWeight: 500 }), caption('s', 'This year')]),
    { element: 'Instance', name: 'sp', component: 'Sparkline', props: { unit: 'Devices (x 1 000)' } },
    col('foot', { itemSpacing: S.xs }, [caption('l', 'Total  →'), figure('n', '13 719')]),
  ]),
  guidance: { do: ['Put the unit above the plot, the total below it.', 'Keep four gridlines whatever the range.'], dont: ['Fill under the line.', 'Add a legend for one series.'] },
  accessibility: [['line on layer-2', '14.1:1 — passes'], ['gridlines gray-78', '2.4:1 — decorative'], ['labels at 60%', 'about 8:1 — passes']],
  content: [['unit', 'Noun and scale: “Devices (x 1 000)”'], ['x labels', 'Three-letter months']],
  related: [['Label', 'the total under it'], ['Timeline', 'time on the x axis with bars instead of a line']],
  changelog: [['0.1', 'first draft; fixed path']],
  appearance: ['Four faint horizontal rules with tiny grey numbers at the left, a single thin white line wandering across them, four month names underneath.'],
  constraints: ['Line weight is 1; gridlines are 1; nothing in the plot is heavier.'],
  intent: {
    core: 'No axes: a sparkline has no states. Its unit is a prop; its line is geometry.',
    structure: 'Twelve sections; states shows two unit samples.',
    antiPatterns: ['thicken the line', 'colour the line by trend'],
    design: ['288×140 plot, 4 hairlines 36 apart, 1px mark line', '12px muted labels: 6/4/2/0 left, Jan/Apr/Aug/Dec below'],
  },
}
```

- [ ] **Step 2: Build, look, commit**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/simple/build/run.mjs sparkline
```
Read `design-systems/simple/.build/sparkline/sparkline.png`. Then:
```bash
git add design-systems/simple/sparkline.uidx design-systems/simple/build/components/sparkline.mjs
git commit -m "Simple: Sparkline

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 17: BarStat page

**Files:**
- Create: `design-systems/simple/build/components/bar-stat.mjs`
- Create (generated): `design-systems/simple/bar-stat.uidx`

**Interfaces:**
- Produces: `BarStat` with axis `fill ['full','two-thirds','half']` (the drawn bar widths), props `label`, `value` (TEXT). Dashboard: `{ fill: 'full', label: 'Port Scanning Activity', value: '642' }`.

- [ ] **Step 1: Write the descriptor**

```js
// design-systems/simple/build/components/bar-stat.mjs
import { C, S, TY, col, row, text, caption, solid, rect, hairline } from '../lib/n.mjs'

const W = 288
const bar = ({ fill }) => {
  const w = { full: W, 'two-thirds': Math.round(W * 0.66), half: Math.round(W * 0.5) }[fill]
  return col('bar-stat', { counterAxisSizingMode: 'FIXED', width: W, itemSpacing: S.xs }, [
    row('line', { primaryAxisSizingMode: 'FIXED', width: W, primaryAxisAlignItems: 'SPACE_BETWEEN' }, [text('label', '{label}', { fontSize: TY.caption }), caption('value', '{value}')]),
    col('track', { counterAxisSizingMode: 'FIXED', width: W, itemSpacing: 0 }, [rect('fill', { width: w, height: 2, fills: solid(C.mark) }), hairline('rest', W)]),
  ])
}

export default {
  id: 'bar-stat', title: 'BarStat', eyebrow: 'Data / Bar',
  definition: 'A ranked row: a 12px label left, its count right, and a 2px white bar underneath showing its share of the top item.',
  overview: ['For a “top N” list — Top threats.', 'The first row’s bar is full; the rest are proportional. Three widths are designed; a data-driven width needs geometry the format does not carry.', 'The bar is white; rank is not status.'],
  component: { name: 'BarStat', props: { label: { type: 'TEXT', default: 'Port Scanning Activity' }, value: { type: 'TEXT', default: '642' } }, axes: { fill: ['full', 'two-thirds', 'half'] }, variant: bar },
  states: { rows: 'fill', cols: null, sample: {} },
  anatomy: ['1 row — 288 wide, space-between', '2 label — 12px text; value 12px muted', '3 track — a 2px mark bar of the share’s width over a 1px hairline the full width'],
  properties: [['label', 'TEXT', 'Port Scanning Activity', 'the item'], ['value', 'TEXT', '642', 'its count']],
  measurements: [['width', '288 here'], ['bar', '2px color#mark; full / 66% / 50%'], ['rule', '1px color#hairline'], ['label / value', '12 (type#caption)'], ['gap', '4 (space#xs)']],
  inContext: () => col('tile', { counterAxisSizingMode: 'FIXED', width: 320, itemSpacing: S.md, paddingTop: S.md, paddingRight: S.md, paddingBottom: S.md, paddingLeft: S.md, fills: solid(C['layer-2']), cornerRadius: '{radius#card}' }, [
    text('t', 'Top threats', { fontSize: TY.title, fontWeight: 500 }),
    { element: 'Instance', name: 'a', component: 'BarStat', props: { fill: 'full', label: 'Port Scanning Activity', value: '642' } },
    { element: 'Instance', name: 'b', component: 'BarStat', props: { fill: 'two-thirds', label: 'Unauthorized Access', value: '421' } },
    { element: 'Instance', name: 'c', component: 'BarStat', props: { fill: 'half', label: 'Reconaissance Attempts', value: '370' } },
  ]),
  guidance: { do: ['Sort descending; the full bar is always first.', 'Keep counts right-aligned and muted.'], dont: ['Colour bars by rank.', 'Show more than five rows.'] },
  accessibility: [['bar on layer-2', '14.1:1 — passes'], ['label', '14.1:1 — passes'], ['value at 60%', 'about 8:1 — passes']],
  content: [['label', 'Title case as the source names it'], ['value', 'A bare count']],
  related: [['Label', 'a figure without a bar'], ['TableRow', 'the same bar as a progress cell']],
  changelog: [['0.1', 'first draft; three fixed widths']],
  appearance: ['A small text line with a number at its far right, underlined by a thin bright bar that stops part-way along a faint full-width rule.'],
  constraints: ['Bar is 2px and sits directly on the 1px rule with no gap.'],
  intent: {
    core: 'The bar’s width is the only thing that changes, so it is the one axis, quantised to three designed steps. Words are props.',
    structure: 'Twelve sections; states lists the three fills.',
    antiPatterns: ['use a status colour for rank', 'grow the bar height'],
    design: ['288 wide row; 12px label and muted value; 2px mark bar over 1px hairline'],
  },
}
```

- [ ] **Step 2: Build, look, commit**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/simple/build/run.mjs bar-stat
```
Read `design-systems/simple/.build/bar-stat/bar-stat.png`. Then:
```bash
git add design-systems/simple/bar-stat.uidx design-systems/simple/build/components/bar-stat.mjs
git commit -m "Simple: BarStat

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 18: TableRow page

**Files:**
- Create: `design-systems/simple/build/components/table-row.mjs`
- Create (generated): `design-systems/simple/table-row.uidx`

**Interfaces:**
- Produces: `TableRow` with axes `role ['body','header']`, `state ['default','hover','selected']`, `criticality ['none','extreme','high','low']`, `progress ['none','high','mid','low']`; props `cell1`, `cell2`, `cell3`, `percent` (TEXT). Dashboard body row: `{ role: 'body', state: 'default', criticality: 'extreme', progress: 'high', cell1: 'Extreme', cell2: 'VDC 05', cell3: '', percent: '67%' }`; header: `{ role: 'header', state: 'default', criticality: 'none', progress: 'none', cell1: 'Criticality', cell2: 'Asset name', cell3: 'Compliance score', percent: '' }`.

- [ ] **Step 1: Write the descriptor**

```js
// design-systems/simple/build/components/table-row.mjs
import { C, S, TY, Z, TB, col, row, text, caption, solid, rect, hairline, dot, frame, NONE } from '../lib/n.mjs'
import { icon } from '../lib/icons.mjs'

const W = 500, COLS = [160, 160, 180]
const cell = (name, width, children, extra = {}) =>
  row(name, { primaryAxisSizingMode: 'FIXED', width, itemSpacing: S.sm, paddingLeft: S.md, ...extra }, children)

const tableRow = ({ role, state, criticality, progress }) => {
  const header = role === 'header'
  const fill = state === 'hover' ? solid(TB.hover) : state === 'selected' ? solid(TB.selected) : NONE
  const dotColor = { extreme: C.danger, high: C.warn, low: C['mark-muted'], none: null }[criticality]
  const barW = { high: 120, mid: 90, low: 45, none: 0 }[progress]
  const t = (n, chars) => header ? text(n, chars, { fontSize: TY.caption, fontWeight: 500, fills: solid(TB.header) }) : text(n, chars, { fontSize: TY.caption })
  const cells = [
    cell('c1', COLS[0], [
      ...(header ? [] : [dotColor ? dot('dot', Z.dot, dotColor) : frame('no-dot', { width: Z.dot, height: Z.dot, fills: NONE })]),
      t('t1', '{cell1}'), ...(header ? [icon.sortChevrons('s1')] : []),
    ]),
    cell('c2', COLS[1], [t('t2', '{cell2}'), ...(header ? [icon.sortChevrons('s2')] : [])]),
    header
      ? cell('c3', COLS[2], [t('t3', '{cell3}'), icon.sortChevrons('s3')], { primaryAxisAlignItems: 'MAX', paddingRight: S.md })
      : cell('c3', COLS[2], [
          ...(barW > 0 ? [col('track', { width: 120, counterAxisSizingMode: 'FIXED', itemSpacing: 0 }, [rect('fill', { width: barW, height: 2, fills: solid(C.mark) }), hairline('rest', 120, C['mark-track'])])] : []),
          caption('pct', '{percent}'),
        ], { primaryAxisAlignItems: 'MAX', paddingRight: S.md }),
  ]
  return col('row', { counterAxisSizingMode: 'FIXED', width: W, itemSpacing: 0 }, [
    row('cells', { primaryAxisSizingMode: 'FIXED', width: W, height: Z.row, counterAxisSizingMode: 'FIXED', fills: fill }, cells),
    hairline('divider', W, header ? C['hairline-strong'] : TB.divider),
  ])
}

export default {
  id: 'table-row', title: 'TableRow', eyebrow: 'Data / Table',
  definition: 'One 31px row of a three-column table: a criticality dot and word, a name, and a thin progress bar with its percent; or, as a header, medium labels with sort chevrons.',
  overview: ['Stack a header row and body rows in a column; put a Pagination under them.', 'Criticality is a dot before the first cell: red extreme, yellow high, grey low.', 'The progress cell is a 120px track with a 2px white bar and a muted percent.'],
  tokenCollections: ['table'],
  component: {
    name: 'TableRow',
    props: { cell1: { type: 'TEXT', default: 'Extreme' }, cell2: { type: 'TEXT', default: 'VDC 05' }, cell3: { type: 'TEXT', default: '' }, percent: { type: 'TEXT', default: '67%' } },
    axes: { role: ['body', 'header'], state: ['default', 'hover', 'selected'], criticality: ['none', 'extreme', 'high', 'low'], progress: ['none', 'high', 'mid', 'low'] },
    designed: (c) => c.role === 'body' || (c.state === 'default' && c.criticality === 'none' && c.progress === 'none'),
    variant: tableRow,
  },
  states: { rows: 'criticality', cols: 'state', sample: {} },
  anatomyProps: { cell1: 'Extreme', cell2: 'VDC 05', percent: '67%' },
  anatomy: ['1 row — 500 wide, 31 tall, hairline under', '2 cell 1 — 8px dot, 8, 12px text', '3 cell 2 — 12px text', '4 cell 3 — right-aligned: 120px track (2px mark bar over mark-track) and a muted percent', '5 header — 12px medium labels each with a 10×12 sort chevron pair; strong hairline under'],
  properties: [['cell1', 'TEXT', 'Extreme', 'criticality word or header label'], ['cell2', 'TEXT', 'VDC 05', 'asset name'], ['cell3', 'TEXT', '', 'header label of the third column'], ['percent', 'TEXT', '67%', 'the score']],
  measurements: [['height', '31 (size#row)'], ['columns', '160 / 160 / 180'], ['dot', '8 (size#dot): danger / warn / mark-muted'], ['bar', '120 track, 2px mark fill at 120 / 90 / 45'], ['divider', '1px table#divider; header table strong hairline'], ['hover', 'table#hover fill'], ['selected', 'table#selected fill (brand at 40%)']],
  inContext: () => col('table', { itemSpacing: 0, paddingTop: S.sm, paddingRight: S.md, paddingBottom: S.sm, paddingLeft: S.md, fills: solid(C['layer-2']) }, [
    { element: 'Instance', name: 'h', component: 'TableRow', props: { role: 'header', state: 'default', criticality: 'none', progress: 'none', cell1: 'Criticality', cell2: 'Asset name', cell3: 'Compliance score', percent: '' } },
    { element: 'Instance', name: 'r1', component: 'TableRow', props: { role: 'body', state: 'default', criticality: 'extreme', progress: 'high', cell1: 'Extreme', cell2: 'VDC 05', cell3: '', percent: '67%' } },
    { element: 'Instance', name: 'r2', component: 'TableRow', props: { role: 'body', state: 'hover', criticality: 'high', progress: 'high', cell1: 'High', cell2: 'VDC 13', cell3: '', percent: '86%' } },
    { element: 'Instance', name: 'r3', component: 'TableRow', props: { role: 'body', state: 'selected', criticality: 'high', progress: 'mid', cell1: 'High', cell2: 'VDC 11', cell3: '', percent: '71%' } },
    { element: 'Instance', name: 'r4', component: 'TableRow', props: { role: 'body', state: 'default', criticality: 'low', progress: 'low', cell1: 'Low', cell2: 'VDC 09', cell3: '', percent: '34%' } },
  ]),
  guidance: { do: ['Sort by the column whose chevrons are shown; all three are sortable here.', 'Right-align numbers and bars.'], dont: ['Zebra-stripe; the hairline is the row separator.', 'Colour the percent.'] },
  accessibility: [['text on layer-2', '14.1:1 — passes'], ['red dot on layer-2', '3.9:1 — passes 1.4.11'], ['yellow dot', '8.4:1 — passes'], ['grey dot gray-118', '4.2:1 — passes'], ['divider gray-78', '2.4:1 — decorative'], ['selected fill (blue at 40%) under white text', 'about 9:1 — passes']],
  content: [['criticality', 'One word: Extreme, High, Low'], ['asset', 'As named by the source: “VDC 05”'], ['percent', 'Whole number with %']],
  related: [['Pagination', 'under the last row'], ['StatusListRow', 'a two-cell row with an icon instead of a bar'], ['Pill', 'an alternative criticality mark']],
  changelog: [['0.1', 'first draft; header designed at default state only']],
  appearance: ['Thin rows separated by faint rules; a coloured dot leads the first word; a short bright bar and a small grey percent finish each row at the right; the header is slightly bolder with tiny up-down chevrons.'],
  constraints: ['The dot is vertically centred on the text and never touches it.', 'Header is designed only at default/none/none; every other header combination is not designed.'],
  intent: {
    core: 'Role (header or body), what the pointer is doing (state), what the row says about severity (criticality) and how far its bar goes (progress) are four independent questions. The texts are props. The header is designed once — it has no hover, no dot, no bar — and the states grid says so for the rest.',
    structure: 'Twelve sections; the matrix is criticality by state for body rows, with role and progress rows beneath.',
    antiPatterns: ['add a border around the table', 'use pills for criticality inside a dense table — dots keep the row 31 tall'],
    design: ['31 tall, 500 wide, columns 160/160/180, hairline under', 'dot 8 danger/warn/mark-muted before cell 1', 'progress: 120 track mark-track, 2px mark fill, muted percent right', 'hover layer-raised; selected brand at 40%; header medium with sort chevrons and strong rule'],
  },
}
```

- [ ] **Step 2: Build, look, commit**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/simple/build/run.mjs table-row
```
Read `design-systems/simple/.build/table-row/table-row.png`; expect the in-context table with a header, a red-dot row, a hovered row, a blue-tinted selected row. Then:
```bash
git add design-systems/simple/table-row.uidx design-systems/simple/build/components/table-row.mjs
git commit -m "Simple: TableRow

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 19: StatusListRow page

**Files:**
- Create: `design-systems/simple/build/components/status-list-row.mjs`
- Create (generated): `design-systems/simple/status-list-row.uidx`

**Interfaces:**
- Produces: `StatusListRow` with axis `status ['passed','failed','progress']`; props `label`, `detail` (TEXT). Dashboard: `{ status: 'passed', label: 'Data preset E', detail: 'Passed' }`.

- [ ] **Step 1: Write the descriptor**

```js
// design-systems/simple/build/components/status-list-row.mjs
import { C, S, TY, Z, col, row, text, caption, solid, hairline, ellipse, vector, canvas, arcPath, frame } from '../lib/n.mjs'
import { icon } from '../lib/icons.mjs'

const W = 240
const glyph = (status) => {
  if (status === 'progress') return canvas('g', 16, 16, {}, [
    vector('ring', arcPath(8, 8, 7, 0, 359.99), { x: 0, y: 0, width: 16, height: 16, strokes: solid(C['mark-track']), strokeWeight: 1 }),
    vector('half', arcPath(8, 8, 7, 0, 180), { x: 0, y: 0, width: 16, height: 16, strokes: solid(C.danger), strokeWeight: 1.5 }),
  ])
  const ring = ellipse('ring', { x: 0, y: 0, width: 16, height: 16, strokes: solid(status === 'failed' ? C.danger : C.text), strokeWeight: 1.5 })
  const mark = status === 'failed' ? icon.cross('x', C.danger) : icon.check('ok', C.text)
  return canvas('g', 16, 16, {}, [ring, { ...mark, x: 3, y: 3 }])
}

const statusRow = ({ status }) =>
  col('row', { counterAxisSizingMode: 'FIXED', width: W, itemSpacing: 0 }, [
    row('cells', { primaryAxisSizingMode: 'FIXED', width: W, height: Z.row, counterAxisSizingMode: 'FIXED', primaryAxisAlignItems: 'SPACE_BETWEEN', paddingLeft: S.sm, paddingRight: S.sm }, [
      text('label', '{label}', { fontSize: TY.caption }),
      row('status', { itemSpacing: S.sm, primaryAxisSizingMode: 'FIXED', width: 80 }, [glyph(status), caption('detail', '{detail}')]),
    ]),
    hairline('divider', W),
  ])

export default {
  id: 'status-list-row', title: 'StatusListRow', eyebrow: 'Data / List',
  definition: 'A 31px list row: a name on the left and, in a fixed 80px column on the right, a 16px status glyph with a word — check for passed, red cross for failed, a half-red ring with a percent while in progress.',
  overview: ['A checklist of things that pass or fail: presets, policies, checks.', 'The status column is fixed so the glyphs line up down the list.', 'Progress is a state of the row, not a component: the ring is a fixed half.'],
  component: { name: 'StatusListRow', props: { label: { type: 'TEXT', default: 'Data preset A' }, detail: { type: 'TEXT', default: 'Passed' } }, axes: { status: ['passed', 'failed', 'progress'] }, variant: statusRow },
  states: { rows: 'status', cols: null, sample: {} },
  anatomy: ['1 row — 240 wide, 31 tall, hairline under, 8 side padding', '2 label — 12px', '3 status column — 80 wide: 16px glyph, 8, 12px muted word'],
  properties: [['label', 'TEXT', 'Data preset A', 'the item'], ['detail', 'TEXT', 'Passed', 'the status word or percent']],
  measurements: [['height', '31 (size#row)'], ['status column', '80'], ['glyph', '16 (size#icon): ring 1.5px, mark 10'], ['passed', 'text-colour ring and check'], ['failed', 'danger ring and cross'], ['progress', 'mark-track ring, danger half at 1.5px']],
  inContext: () => col('tile', { counterAxisSizingMode: 'FIXED', width: 272, itemSpacing: S.sm, paddingTop: S.md, paddingRight: S.md, paddingBottom: S.md, paddingLeft: S.md, fills: solid(C['layer-2']), cornerRadius: '{radius#card}' }, [
    text('t', 'Compliance by preset', { fontSize: TY.title, fontWeight: 500 }),
    col('list', { itemSpacing: 0 }, [
      { element: 'Instance', name: 'a', component: 'StatusListRow', props: { status: 'progress', label: 'Data preset A', detail: '50%' } },
      { element: 'Instance', name: 'e', component: 'StatusListRow', props: { status: 'passed', label: 'Data preset E', detail: 'Passed' } },
      { element: 'Instance', name: 'b', component: 'StatusListRow', props: { status: 'passed', label: 'Data preset B', detail: 'Passed' } },
      { element: 'Instance', name: 'c', component: 'StatusListRow', props: { status: 'failed', label: 'Data preset C', detail: 'Failed' } },
    ]),
  ]),
  guidance: { do: ['Keep the status word to one word or a percent.', 'Order by need: in progress, then failed, then passed.'], dont: ['Colour the label.', 'Use green for passed; passed is neutral, failed is the exception.'] },
  accessibility: [['label', '14.1:1 — passes'], ['red ring on layer-2', '3.9:1 — passes 1.4.11'], ['status is also a word', 'the glyph never stands alone']],
  content: [['detail', '“Passed”, “Failed”, or “50%”']],
  related: [['TableRow', 'when there are more than two columns'], ['ActivityItem', 'a list ordered by time instead of status']],
  changelog: [['0.1', 'first draft']],
  appearance: ['Short rows, name left, a small ring with a tick or a red cross right beside a word; rules between rows; the glyph column is a straight vertical line down the card.'],
  constraints: ['The status column is fixed width so glyphs align; the label never pushes it.'],
  intent: {
    core: 'One axis, status, because it changes the glyph. The label and the word are props.',
    structure: 'Twelve sections; states shows the three statuses.',
    antiPatterns: ['tint the row by status', 'let the detail wrap'],
    design: ['31 tall, hairline under; label 12px; 80px status column right', 'glyph 16: text ring + check; danger ring + cross; mark-track ring + danger half'],
  },
}
```

- [ ] **Step 2: Build, look, commit**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/simple/build/run.mjs status-list-row
```
Read `design-systems/simple/.build/status-list-row/status-list-row.png`. Then:
```bash
git add design-systems/simple/status-list-row.uidx design-systems/simple/build/components/status-list-row.mjs
git commit -m "Simple: StatusListRow

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 20: ActivityItem page

**Files:**
- Create: `design-systems/simple/build/components/activity-item.mjs`
- Create (generated): `design-systems/simple/activity-item.uidx`

**Interfaces:**
- Produces: `ActivityItem` with axis `position ['middle','first','last']`; props `time`, `text` (TEXT). Dashboard: `{ position: 'first', time: '2016-12-02 14:25', text: 'Excessive access attempts to non-existing…' }`.

- [ ] **Step 1: Write the descriptor**

```js
// design-systems/simple/build/components/activity-item.mjs
import { C, S, TY, Z, col, row, text, caption, solid, rect, dot, canvas, frame, NONE } from '../lib/n.mjs'

const H = 31
const item = ({ position }) =>
  row('item', { primaryAxisSizingMode: 'FIXED', width: 240, height: H, counterAxisSizingMode: 'FIXED', counterAxisAlignItems: 'MIN', itemSpacing: S.sm }, [
    canvas('rail', 8, H, {}, [
      rect('line-above', { x: 3.5, y: 0, width: 1, height: 6, fills: position === 'first' ? NONE : solid(C.hairline) }),
      dot('dot', 6, C['mark-muted']).x === undefined ? { ...dot('dot', 6, C['mark-muted']), x: 1, y: 6 } : null,
      rect('line-below', { x: 3.5, y: 12, width: 1, height: H - 12, fills: position === 'last' ? NONE : solid(C.hairline) }),
    ].filter(Boolean)),
    col('body', { itemSpacing: 2 }, [caption('time', '{time}', { fontSize: TY.micro }), text('text', '{text}', { fontSize: TY.caption })]),
  ])

export default {
  id: 'activity-item', title: 'ActivityItem', eyebrow: 'Data / Feed',
  definition: 'One entry of a time-ordered feed: a 6px dot on a hairline rail at the left, an 11px timestamp over a 12px line of text.',
  overview: ['Latest alerts, recent changes — newest first.', 'Position trims the rail at the top of the first item and the bottom of the last so the line has ends.', 'Text is one line; it truncates with an ellipsis in the implementation.'],
  component: { name: 'ActivityItem', props: { time: { type: 'TEXT', default: '2016-12-02 14:25' }, text: { type: 'TEXT', default: 'Excessive access attempts to non-existing…' } }, axes: { position: ['middle', 'first', 'last'] }, variant: item },
  states: { rows: 'position', cols: null, sample: {} },
  anatomy: ['1 item — 240 wide, 31 tall, 8 gap', '2 rail — 8 wide: 1px hairline above and below a 6px mark-muted dot at y 6', '3 body — 11px muted time, 2, 12px text'],
  properties: [['time', 'TEXT', '2016-12-02 14:25', 'ISO-like date and time'], ['text', 'TEXT', 'Excessive access…', 'the event, one line']],
  measurements: [['height', '31 (size#row)'], ['dot', '6, color#mark-muted'], ['rail', '1px color#hairline'], ['time', '11 (type#micro) muted'], ['text', '12 (type#caption)']],
  inContext: () => col('tile', { counterAxisSizingMode: 'FIXED', width: 272, itemSpacing: S.sm, paddingTop: S.md, paddingRight: S.md, paddingBottom: S.md, paddingLeft: S.md, fills: solid(C['layer-2']), cornerRadius: '{radius#card}' }, [
    text('t', 'Latest Alerts', { fontSize: TY.title, fontWeight: 500 }),
    col('feed', { itemSpacing: 0 }, [
      { element: 'Instance', name: 'a', component: 'ActivityItem', props: { position: 'first', time: '2016-12-02 14:25', text: 'Excessive access attempts to non-existing…' } },
      { element: 'Instance', name: 'b', component: 'ActivityItem', props: { position: 'middle', time: '2016-12-02 14:20', text: 'Initializing full-time diagnostic data…' } },
      { element: 'Instance', name: 'c', component: 'ActivityItem', props: { position: 'middle', time: '2016-12-02 14:01', text: 'Code (SQL, HTML) seen as part of…' } },
      { element: 'Instance', name: 'd', component: 'ActivityItem', props: { position: 'last', time: '2016-12-02 13:56', text: 'System scan' } },
    ]),
  ]),
  guidance: { do: ['Newest at the top.', 'Keep the timestamp full; the feed is evidence.'], dont: ['Colour dots by severity — that is a table’s job.', 'Wrap the text; truncate.'] },
  accessibility: [['text', '14.1:1 — passes'], ['time at 60%, 11px', 'about 8:1 — passes, but 11px is the smallest type in the system and must not shrink'], ['dot gray-118', '4.2:1 — passes']],
  content: [['time', 'YYYY-MM-DD HH:MM'], ['text', 'Sentence fragment, present tense, no full stop']],
  related: [['StatusListRow', 'a list by status instead of time'], ['Timeline', 'time along the x axis']],
  changelog: [['0.1', 'first draft']],
  appearance: ['A thin vertical line with small grey beads, each bead owning a tiny timestamp and a line of text beside it; the line starts at the first bead and ends at the last.'],
  constraints: ['Dot is centred on the timestamp line, not the row.'],
  intent: {
    core: 'Position is the one axis because the rail differs at the ends. Time and text are props.',
    structure: 'Twelve sections; states shows middle, first, last.',
    antiPatterns: ['draw the rail as one long line behind the list — each item owns its segment so the feed reflows', 'use a status colour on a dot'],
    design: ['31 tall; rail 8 wide with 1px hairline and 6px mark-muted dot at y 6', 'time 11 muted over text 12 at 2'],
  },
}
```

Note: the `rail` children list must be three plain nodes; write it as `[lineAbove, { ...dot('dot', 6, C['mark-muted']), x: 1, y: 6 }, lineBelow]` — the conditional above is shown only to make the dot placement explicit. Use this final form:

```js
const item = ({ position }) =>
  row('item', { primaryAxisSizingMode: 'FIXED', width: 240, height: H, counterAxisSizingMode: 'FIXED', counterAxisAlignItems: 'MIN', itemSpacing: S.sm }, [
    canvas('rail', 8, H, {}, [
      rect('line-above', { x: 3.5, y: 0, width: 1, height: 6, fills: position === 'first' ? NONE : solid(C.hairline) }),
      { ...dot('dot', 6, C['mark-muted']), x: 1, y: 6 },
      rect('line-below', { x: 3.5, y: 12, width: 1, height: H - 12, fills: position === 'last' ? NONE : solid(C.hairline) }),
    ]),
    col('body', { itemSpacing: 2 }, [caption('time', '{time}', { fontSize: TY.micro }), text('text', '{text}', { fontSize: TY.caption })]),
  ])
```

- [ ] **Step 2: Build, look, commit**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/simple/build/run.mjs activity-item
```
Read `design-systems/simple/.build/activity-item/activity-item.png`; expect a continuous rail down the four in-context items. Then:
```bash
git add design-systems/simple/activity-item.uidx design-systems/simple/build/components/activity-item.mjs
git commit -m "Simple: ActivityItem

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 21: Timeline page (TimelineBar, TimelineRow, Timeline)

**Files:**
- Create: `design-systems/simple/build/components/timeline.mjs`
- Create (generated): `design-systems/simple/timeline.uidx`

**Interfaces:**
- Produces three components on one page. `TimelineBar`: axis `status ['on-time','critical','major','minor']`, axis `length ['short','medium','long']`. `TimelineRow`: axis `pattern ['a','b','c']` (three designed bar layouts), prop `label` (TEXT). `Timeline` (the page’s main component): no axes, prop `title` (TEXT); holds a legend, six rows and the hour axis. Dashboard: `instance('schedule', 'Timeline', { title: 'Fleet schedule' })`.

- [ ] **Step 1: Write the descriptor**

```js
// design-systems/simple/build/components/timeline.mjs
import { C, S, TY, R, col, row, text, caption, solid, rect, hairline, dot, canvas, frame } from '../lib/n.mjs'

const TRACK_W = 1000, LABEL_W = 160, HOURS = 24
const statusColor = { 'on-time': C.mark, critical: C.danger, major: C.alert, minor: C.warn }
const lengths = { short: 60, medium: 110, long: 180 }

const timelineBar = ({ status, length }) => rect('bar', { width: lengths[length], height: 3, fills: solid(statusColor[status]) })

const patterns = {
  a: [['critical', 'long', 0], ['critical', 'medium', 560], ['on-time', 'short', 930]],
  b: [['on-time', 'long', 660], ['on-time', 'short', 1000 - 80]],
  c: [['on-time', 'medium', 80], ['minor', 'medium', 400], ['on-time', 'long', 640]],
}
const timelineRow = ({ pattern }) =>
  row('row', { primaryAxisSizingMode: 'FIXED', width: LABEL_W + TRACK_W, height: 22, counterAxisSizingMode: 'FIXED', itemSpacing: 0 }, [
    row('label-cell', { primaryAxisSizingMode: 'FIXED', width: LABEL_W, itemSpacing: S.sm }, [caption('label', '{label}', { fills: solid(C.text) }), hairline('tick', 8)]),
    canvas('track', TRACK_W, 22, {}, patterns[pattern].map(([status, length, x], i) => ({
      element: 'Instance', name: `bar${i}`, component: 'TimelineBar', props: { status, length }, x: Math.min(x, TRACK_W - lengths[length]), y: 10,
    }))),
  ])

const legend = () => row('legend', { itemSpacing: S.md }, Object.entries(statusColor).map(([k, c]) =>
  row(`l-${k}`, { itemSpacing: S.xs }, [dot('d', 6, c), caption('t', k === 'on-time' ? 'On time' : k[0].toUpperCase() + k.slice(1))])))

const axis = () => canvas('axis', LABEL_W + TRACK_W, 20, {}, [
  ...Array.from({ length: HOURS + 1 }, (_, i) => caption(`h${i}`, `${String((7 + i) % 24).padStart(2, '0')}:00`, { x: LABEL_W + (TRACK_W / HOURS) * i - 14, y: 4, fontSize: TY.micro })),
])
const gridlines = () => canvas('grid', LABEL_W + TRACK_W, 6 * 22, {}, Array.from({ length: HOURS + 1 }, (_, i) =>
  rect(`g${i}`, { x: LABEL_W + (TRACK_W / HOURS) * i, y: 0, width: 1, height: 6 * 22, fills: solid(C.hairline) })))

const timeline = () =>
  col('timeline', { counterAxisSizingMode: 'FIXED', width: LABEL_W + TRACK_W + 32, itemSpacing: S.md, paddingTop: S.md, paddingRight: S.md, paddingBottom: S.md, paddingLeft: S.md, fills: solid(C['layer-2']), cornerRadius: R.card }, [
    row('head', { primaryAxisSizingMode: 'FIXED', width: LABEL_W + TRACK_W, primaryAxisAlignItems: 'SPACE_BETWEEN' }, [text('title', '{title}', { fontSize: TY.title, fontWeight: 500 }), legend()]),
    canvas('body', LABEL_W + TRACK_W, 6 * 22, {}, [
      { ...gridlines(), x: 0, y: 0 },
      { ...col('rows', { itemSpacing: 0 }, [
        ['BH-1001-20136093', 'a'], ['BH-1001-20134151', 'b'], ['BH-1001-20137002', 'c'], ['BH-1001-20132340', 'a'], ['BH-1001-20130892', 'c'], ['BH-1001-20138104', 'b'],
      ].map(([label, pattern], i) => ({ element: 'Instance', name: `r${i}`, component: 'TimelineRow', props: { pattern, label } }))), x: 0, y: 0 },
    ]),
    axis(),
  ])

export default {
  id: 'timeline', title: 'Timeline', eyebrow: 'Data / Schedule',
  definition: 'A Gantt strip: vehicle IDs down the left, a 24-hour axis along the bottom, 3px bars per row coloured by status, a dot legend top right.',
  overview: ['Scheduled spans over a day; each row is one asset.', 'Bars are on-time white unless something is wrong: critical red, major orange, minor yellow.', 'Three components: the bar, the row, and the strip; the strip is what a dashboard instances.'],
  extraComponents: [
    { name: 'TimelineBar', props: {}, axes: { status: ['on-time', 'critical', 'major', 'minor'], length: ['short', 'medium', 'long'] }, variant: timelineBar },
    { name: 'TimelineRow', props: { label: { type: 'TEXT', default: 'BH-1001-20136093' } }, axes: { pattern: ['a', 'b', 'c'] }, variant: timelineRow },
  ],
  component: { name: 'Timeline', props: { title: { type: 'TEXT', default: 'Fleet schedule' } }, axes: {}, variant: timeline },
  states: { samples: [{ label: 'default', props: {} }] },
  anatomy: ['1 timeline — layer-2 card, 1192 wide', '2 head — 16px title, legend of four dot+word pairs right', '3 body — 25 vertical hairline gridlines under six TimelineRow instances', '4 row — 160px label cell (12px ID and an 8px tick) then a 1000px track holding TimelineBar instances at hour offsets', '5 bar — 3px tall, 60 / 110 / 180 long, status colour', '6 axis — 25 hour labels 11px muted from 07:00 round to 07:00'],
  properties: [['title', 'TEXT', 'Fleet schedule', 'the card name'], ['TimelineRow.label', 'TEXT', 'BH-1001-20136093', 'the asset ID'], ['TimelineBar axes', 'status × length', '—', 'colour and drawn width']],
  measurements: [['track', '1000 wide, 24 hours at 41.67 each'], ['row', '22 tall'], ['bar', '3 tall; short 60 / medium 110 / long 180'], ['colours', 'mark / danger / alert / warn'], ['gridlines', '1px color#hairline'], ['axis labels', '11 (type#micro) muted']],
  inContext: () => ({ element: 'Instance', name: 'schedule', component: 'Timeline', props: { title: 'Fleet schedule' } }),
  guidance: { do: ['Keep bars 3px; the strip is dense.', 'Legend order is on time, critical, major, minor.'], dont: ['Stack bars in a row.', 'Label every bar.'] },
  accessibility: [['white bars', '14.1:1 — passes'], ['red bar 3px on layer-2', '3.9:1 — passes 1.4.11'], ['yellow bar', '8.4:1 — passes'], ['orange bar', '5.2:1 — passes'], ['11px axis labels', 'the smallest type; legible at 1× only']],
  content: [['ID', 'As the fleet names it: “BH-1001-20136093”'], ['hours', 'HH:00, 24-hour']],
  related: [['Sparkline', 'a line over time'], ['ActivityItem', 'events as a list']],
  changelog: [['0.1', 'first draft; three fixed row patterns, three bar lengths']],
  appearance: ['A wide dark card with a column of monospace-looking IDs, faint vertical hour lines, and thin horizontal dashes in white with a few in red and one in yellow; the legend is four tiny dots with words at the top right.'],
  constraints: ['A bar never crosses the track edge: x is clamped to width minus length.', 'Rows are 22 tall so six rows plus axis fit a 200px card body.'],
  intent: {
    core: 'Three components because three things vary independently: a bar’s status and length, a row’s bar layout, and the strip that composes rows. Only the bar has real axes; the row’s pattern axis quantises layouts the format cannot compute from data.',
    structure: 'Twelve sections; states shows the one strip; the bar and row sets sit beside the page at x 2600 and 3500.',
    antiPatterns: ['thicken bars for emphasis', 'draw the grid inside each row'],
    design: ['card layer-2; label col 160, track 1000; rows 22; bars 3px', 'status colours mark/danger/alert/warn; legend dots 6', 'gridlines 1px hairline every hour; axis 11px muted'],
  },
}
```

- [ ] **Step 2: Build, look, commit**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/simple/build/run.mjs timeline
```
The first batch inserts TimelineBar and TimelineRow before Timeline, so instances inside Timeline resolve. Read `design-systems/simple/.build/timeline/timeline.png`; expect the strip with red, yellow and white bars over faint hour lines. Then:
```bash
git add design-systems/simple/timeline.uidx design-systems/simple/build/components/timeline.mjs
git commit -m "Simple: Timeline, TimelineRow, TimelineBar

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 22: GeoMap page (MapMarker, GeoMap)

**Files:**
- Create: `design-systems/simple/build/components/geo-map.mjs`
- Create (generated): `design-systems/simple/geo-map.uidx`

**Interfaces:**
- Produces `MapMarker` with axis `kind ['node','hub','incident']` and `GeoMap` (main) with no axes, prop `title` (TEXT), slot `markers`. Dashboard: `instance('map', 'GeoMap', { title: 'Fraud probability map' })` with the default markers.

- [ ] **Step 1: Write the descriptor**

```js
// design-systems/simple/build/components/geo-map.mjs
import { C, S, TY, R, Z, MP, col, row, text, solid, ellipse, vector, canvas, slot, frame, NONE } from '../lib/n.mjs'
import { icon } from '../lib/icons.mjs'

const W = 680, H = 280
const marker = ({ kind }) => {
  if (kind === 'node') return canvas('marker', 8, 8, {}, [ellipse('dot', { x: 0, y: 0, width: 8, height: 8, fills: solid(MP.node) })])
  if (kind === 'hub') return canvas('marker', 24, 24, {}, [
    ellipse('ring', { x: 0, y: 0, width: 24, height: 24, strokes: solid(MP.node), strokeWeight: 2, fills: solid(C['layer-0']) }),
    ellipse('dot', { x: 8, y: 8, width: 8, height: 8, fills: solid(MP.node) }),
  ])
  return canvas('marker', 20, 20, {}, [
    ellipse('ring', { x: 0, y: 0, width: 20, height: 20, strokes: solid(MP.incident), strokeWeight: 2, fills: solid(C['layer-0']) }),
    ellipse('dot', { x: 6, y: 6, width: 8, height: 8, fills: solid(MP.incident) }),
  ])
}

// A stylised road net: a few majors and many minors, drawn once.
const majors = 'M0 150 L200 120 L420 130 L680 90 M300 0 L310 280 M120 0 L140 280 M0 40 L680 10'
const minors = Array.from({ length: 22 }, (_, i) => `M${(i * 31) % W} 0 L${(i * 37 + 40) % W} ${H}`).join(' ') + ' ' +
  Array.from({ length: 14 }, (_, i) => `M0 ${(i * 19 + 8) % H} L${W} ${(i * 23 + 30) % H}`).join(' ')
const connectors = 'M60 130 L120 100 L180 140 L240 90 L300 150 L360 120 L420 160 L500 110 L560 140 L620 100'
const points = [[110, 90, 'node'], [170, 130, 'node'], [230, 80, 'node'], [290, 140, 'node'], [350, 110, 'node'], [410, 150, 'node'], [490, 100, 'node'], [550, 130, 'node'],
  [48, 118, 'hub'], [330, 100, 'hub'], [608, 88, 'incident'], [260, 170, 'incident']]

const geoMap = () =>
  col('geo-map', { counterAxisSizingMode: 'FIXED', width: W + 32, itemSpacing: S.md, paddingTop: S.md, paddingRight: S.md, paddingBottom: S.md, paddingLeft: S.md, fills: solid(MP.surface), cornerRadius: R.card }, [
    row('head', { primaryAxisSizingMode: 'FIXED', width: W, primaryAxisAlignItems: 'SPACE_BETWEEN' }, [text('title', '{title}', { fontSize: TY.title, fontWeight: 500 }), icon.expand()]),
    canvas('map', W, H, { clipsContent: true, fills: solid(MP.surface) }, [
      vector('minors', minors, { x: 0, y: 0, width: W, height: H, strokes: solid(MP.road), strokeWeight: 1 }),
      vector('majors', majors, { x: 0, y: 0, width: W, height: H, strokes: solid(MP['road-major']), strokeWeight: 3 }),
      vector('connectors', connectors, { x: 0, y: 0, width: W, height: H, strokes: solid(MP.connector), strokeWeight: 1 }),
      slot('markers', { x: 0, y: 0, width: W, height: H, fills: NONE }, points.map(([x, y, kind], i) => ({
        element: 'Instance', name: `m${i}`, component: 'MapMarker', props: { kind }, x: x - (kind === 'hub' ? 12 : kind === 'incident' ? 10 : 4), y: y - (kind === 'hub' ? 12 : kind === 'incident' ? 10 : 4),
      }))),
      col('zoom', { x: W - 24, y: H - 44, itemSpacing: S.xs }, [icon.plus('in'), icon.minus('out')]),
    ]),
  ])

export default {
  id: 'geo-map', title: 'GeoMap', eyebrow: 'Data / Map',
  definition: 'A dark map panel: a faint road net, thin connector lines, white node dots, ringed hubs, and red-ringed incidents, with a title row and zoom controls.',
  overview: ['Where things are: vehicles, sites, incidents.', 'The map tiles are not the system’s; the marker language is. Three marker kinds and nothing else.', 'Markers are a slot so every screen places its own; the default set is the reference’s.'],
  tokenCollections: ['map'],
  extraComponents: [{ name: 'MapMarker', props: {}, axes: { kind: ['node', 'hub', 'incident'] }, variant: marker }],
  component: { name: 'GeoMap', props: { title: { type: 'TEXT', default: 'Fraud probability map' } }, axes: {}, variant: geoMap },
  states: { samples: [{ label: 'default', props: {} }] },
  anatomy: ['1 geo-map — layer-2 card, 712 wide', '2 head — 16px title and an expand glyph', '3 map — 680 × 280 clipped canvas: 1px minor roads (map#road), 3px major roads (map#road-major), 1px connectors', '4 markers slot — MapMarker instances at authored x/y', '5 marker — node 8px dot; hub 24 ring 2px + 8 dot; incident 20 red ring + 8 red dot', '6 zoom — plus and minus glyphs bottom right'],
  properties: [['title', 'TEXT', 'Fraud probability map', 'the card name'], ['markers (slot)', 'slot', '12 markers', 'the placed MapMarker instances'], ['MapMarker.kind', 'axis', 'node', 'node | hub | incident']],
  measurements: [['map', '680 × 280'], ['node', '8 (size#dot) map#node'], ['hub', '24 (size#hub): 2px map#node ring, layer-0 fill, 8 dot'], ['incident', '20: 2px map#incident ring, layer-0 fill, 8 dot'], ['roads', '1px map#road; majors 3px map#road-major'], ['connectors', '1px map#connector']],
  inContext: () => ({ element: 'Instance', name: 'map', component: 'GeoMap', props: { title: 'Fraud probability map' } }),
  guidance: { do: ['Use hubs for the few places that matter and nodes for everything else.', 'Keep incidents red and rare.'], dont: ['Add a third ring colour.', 'Label markers on the map; label them in a list beside it.'] },
  accessibility: [['node white on map surface', '14.1:1 — passes'], ['incident ring red on surface', '3.9:1 — passes 1.4.11'], ['roads', 'decorative; the map is illustration and the data is in the markers'], ['marker meaning', 'shape and colour together: hub is bigger and ringed, incident is red and ringed']],
  content: [['title', 'What the markers show: “Vehicle map”, “Fraud probability map”']],
  related: [['Tile', 'the card shape without the map'], ['Switch', 'the “Show incident” toggle that filters markers']],
  changelog: [['0.1', 'first draft; road net is a fixed stylisation']],
  appearance: ['A near-black rectangle scratched with faint grey street lines and a few darker thick avenues; bright white pinpricks joined by thin dotted paths, two of them enlarged into ringed targets, and two red rings where something is wrong; a small + and − at the bottom right.'],
  constraints: ['Markers are centred on their coordinates: the instance is offset by half its size.', 'The map clips; nothing draws outside 680 × 280.'],
  intent: {
    core: 'Two components: the marker has a kind axis because the three kinds are different drawings; the map has no axes and a markers slot because placement is the consumer’s. The road net is fixed art.',
    structure: 'Twelve sections; the marker set sits beside the page at x 2600.',
    antiPatterns: ['colour nodes by anything', 'use a pin shape — the language is dots and rings'],
    design: ['card layer-2; map 680×280 clipped', 'roads 1px hairline-grey, majors 3px layer-0, connectors 1px mark-muted', 'markers: node 8 white; hub 24 ring; incident 20 red ring'],
  },
}
```

- [ ] **Step 2: Build, look, commit**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/simple/build/run.mjs geo-map
```
Read `design-systems/simple/.build/geo-map/geo-map.png`; expect the dark map with white dots, two ringed hubs and two red rings. Then:
```bash
git add design-systems/simple/geo-map.uidx design-systems/simple/build/components/geo-map.mjs
git commit -m "Simple: GeoMap and MapMarker

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 23: Dashboard page

**Files:**
- Create: `design-systems/simple/build/dashboard.mjs` (a page script, not a descriptor)
- Create (generated): `design-systems/simple/dashboard.uidx`

**Interfaces:**
- Consumes every component above by the exact prop names listed in each task’s Interfaces block.

- [ ] **Step 1: Write the page script**

```js
// design-systems/simple/build/dashboard.mjs — the system dashboard from instances only.
//   node design-systems/simple/build/dashboard.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { C, S, TY, col, row, caption, figure, solid, slot, frame, text } from './lib/n.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '..'), REPO = resolve(ROOT, '..', '..'), CLI = resolve(REPO, 'packages/cli/dist/uidx.js')
const I = (name, component, props, children) => ({ element: 'Instance', name, component, props, ...(children ? { children } : {}) })
const tile = (name, title, opts, body) => I(name, 'Tile', { action: opts.action ?? 'kebab', title, subtitle: opts.subtitle ?? '', showSubtitle: Boolean(opts.subtitle) }, [slot('body', {}, body)])

const at = (node, x, y, width) => ({ ...node, x, y, ...(width ? { width } : {}) })

const screen = col('screen', { counterAxisSizingMode: 'FIXED', width: 1440, itemSpacing: 0, x: 0, y: 0, fills: solid(C['layer-1']) }, [
  I('system-bar', 'AppHeader', { productName: 'Simple', userName: 'Username' }),
  I('app-bar', 'AppSubHeader', { title: 'System dashboard' }, [slot('actions', {}, [
    text('l', 'Data preset', { fontSize: TY.body }),
    I('preset', 'Input', { kind: 'text', interaction: 'default', label: '', showLabel: false, value: 'Choose preset' }),
    I('load', 'Button', { kind: 'primary', interaction: 'default', size: 'md', label: 'Load' }),
  ])]),
  frame('grid', { width: 1440, height: 820, fills: solid(C['layer-1']) }, [
    at(tile('score', 'Total Compliance Score', {}, [
      row('c', { primaryAxisSizingMode: 'FIXED', width: 304, primaryAxisAlignItems: 'CENTER' }, [I('gauge', 'Gauge', { tone: 'alert', value: '85', unit: '%', min: '0', max: '1TB' })]),
      row('foot', { primaryAxisSizingMode: 'FIXED', width: 304, primaryAxisAlignItems: 'SPACE_BETWEEN' }, [
        row('a', { itemSpacing: S.sm, counterAxisAlignItems: 'BASELINE' }, [figure('n', '120'), caption('c', 'Assets Tracked')]),
        row('b', { itemSpacing: S.sm, counterAxisAlignItems: 'BASELINE' }, [figure('n', '134'), caption('c', 'Policies Enforced')]),
      ]),
    ]), 16, 8, 336),
    at(tile('status', 'Compliance status', { action: 'expand' }, [
      col('table', { itemSpacing: 0 }, [
        I('h', 'TableRow', { role: 'header', state: 'default', criticality: 'none', progress: 'none', cell1: 'Criticality', cell2: 'Asset name', cell3: 'Compliance score', percent: '' }),
        I('r1', 'TableRow', { role: 'body', state: 'default', criticality: 'extreme', progress: 'high', cell1: 'Extreme', cell2: 'VDC 05', cell3: '', percent: '67%' }),
        I('r2', 'TableRow', { role: 'body', state: 'default', criticality: 'high', progress: 'high', cell1: 'High', cell2: 'VDC 13', cell3: '', percent: '86%' }),
        I('r3', 'TableRow', { role: 'body', state: 'default', criticality: 'high', progress: 'mid', cell1: 'High', cell2: 'VDC 11', cell3: '', percent: '71%' }),
        I('r4', 'TableRow', { role: 'body', state: 'default', criticality: 'low', progress: 'low', cell1: 'Low', cell2: 'VDC 09', cell3: '', percent: '34%' }),
      ]),
      I('pg', 'Pagination', { current: '1', goTo: '2', entries: '4 entries' }),
    ]), 360, 8, 688),
    at(tile('presets', 'Compliance by preset', {}, [col('list', { itemSpacing: 0 }, [
      I('a', 'StatusListRow', { status: 'progress', label: 'Data preset A', detail: '50%' }),
      I('e', 'StatusListRow', { status: 'passed', label: 'Data preset E', detail: 'Passed' }),
      I('b', 'StatusListRow', { status: 'passed', label: 'Data preset B', detail: 'Passed' }),
      I('c', 'StatusListRow', { status: 'failed', label: 'Data preset C', detail: 'Failed' }),
      I('d', 'StatusListRow', { status: 'passed', label: 'Data preset D', detail: 'Passed' }),
      I('f', 'StatusListRow', { status: 'passed', label: 'Data preset F', detail: 'Passed' }),
    ])]), 1056, 8, 368),
    at(tile('alerts', 'Latest Alerts', {}, [col('feed', { itemSpacing: 0 }, [
      I('a', 'ActivityItem', { position: 'first', time: '2016-12-02 14:25', text: 'Excessive access attempts to non-existing…' }),
      I('b', 'ActivityItem', { position: 'middle', time: '2016-12-02 14:20', text: 'Initializing full-time diagnostic data…' }),
      I('c', 'ActivityItem', { position: 'middle', time: '2016-12-02 14:01', text: 'Code (SQL, HTML) seen as part of…' }),
      I('d', 'ActivityItem', { position: 'middle', time: '2016-12-02 13:56', text: 'System scan' }),
      I('e', 'ActivityItem', { position: 'middle', time: '2016-12-02 13:50', text: 'Device added' }),
      I('f', 'ActivityItem', { position: 'last', time: '2016-12-02 13:43', text: 'Policy added' }),
    ])]), 16, 280, 336),
    at(I('map', 'GeoMap', { title: 'Fraud probability map' }), 360, 280, 1064),
    at(tile('threats', 'Top threats', {}, [
      I('t1', 'BarStat', { fill: 'full', label: 'Port Scanning Activity', value: '642' }),
      I('t2', 'BarStat', { fill: 'two-thirds', label: 'Unauthorized Access', value: '421' }),
      I('t3', 'BarStat', { fill: 'half', label: 'Reconaissance Attempts', value: '370' }),
    ]), 16, 520, 336),
    at(tile('score7', 'Compliance score — last 7 days', {}, [
      row('kpis', { itemSpacing: S.xl, counterAxisAlignItems: 'MIN' }, [
        I('total', 'Label', { layout: 'inline', arrow: 'off', caption: "Today's Total", value: '450', suffix: '', showSuffix: false }),
        I('sp', 'Sparkline', { unit: 'Score' }),
        I('rp', 'RadialProgress', { size: 'md', value: '20' }),
      ]),
    ]), 360, 520, 1064),
  ]),
])

const intent = `## Core Intent

The system dashboard, rebuilt from Simple’s components and nothing else. Every
card is a Tile instance; every figure, row, bar, ring and marker is an instance
of the component that owns it. Nothing on this page is drawn that a component
does not define, so the page can only show what the system has.

## Page Structure

System bar, app bar, then a three-column grid on layer-1 with 8px gutters:
left 336, middle 688, right 368 in the first row; the map spans middle and
right in the second; the third row holds top threats and the seven-day score.

## Anti-Patterns

- NEVER draw a one-off on this page. If the dashboard needs it, the system needs it.
- NEVER let a card touch another; the gutter is the separator.
- NEVER colour a figure.

## Design

- Layer ladder: layer-0 system bar, layer-1 page, layer-2 cards.
- Grid: x 16 / 360 / 1056, widths 336 / 688 / 368, rows at y 8 / 280 / 520.
`

const out = resolve(ROOT, '.build', 'dashboard'); mkdirSync(out, { recursive: true })
writeFileSync(resolve(out, 'ops.json'), JSON.stringify([{ kind: 'insert_node', parent: '', node: screen }], null, 2))
writeFileSync(resolve(out, 'intent.md'), intent)
const uidx = (...a) => { console.log(`$ uidx ${a.join(' ')}`); process.stdout.write(execFileSync(process.execPath, [CLI, ...a], { cwd: REPO, encoding: 'utf8' })) }
if (!existsSync(resolve(ROOT, 'dashboard.uidx'))) uidx('create', ROOT, 'dashboard.uidx', '--id', 'dashboard')
uidx('apply', ROOT, 'dashboard.uidx', '--ops', resolve(out, 'ops.json'))
uidx('intent', ROOT, 'dashboard.uidx', '--file', resolve(out, 'intent.md'))
uidx('audit', ROOT, '--page', 'dashboard.uidx')
uidx('render', ROOT, 'dashboard.uidx', '-o', resolve(out, 'dashboard.png'), '--scale', '0.5')
```

- [ ] **Step 2: Build, look, commit**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/simple/build/dashboard.mjs
```
Read `design-systems/simple/.build/dashboard/dashboard.png`. Expected: the reference dashboard’s layout — gauge tile, table tile, preset list, alerts feed, the map spanning two columns, threats, and the seven-day row. Any card wider than its column is an overflow fault in the audit; fix the width passed to `at()` and rerun (the apply is idempotent only for a fresh page — if rerunning, first `git checkout design-systems/simple/dashboard.uidx` or delete the page). Then:
```bash
git add design-systems/simple/dashboard.uidx design-systems/simple/build/dashboard.mjs
git commit -m "Simple: the system dashboard from instances only

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 24: Whole-document sweep

**Files:**
- Modify: `design-systems/simple/README.md` — page list and renderer facts
- Verify: every page

- [ ] **Step 1: Audit the whole document with a real render**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node packages/cli/dist/uidx.js audit design-systems/simple
echo "exit $?"
node --test design-systems/simple/build/test/
node packages/cli/dist/uidx.js check 'design-systems/simple/*.uidx'
```
Expected: `exit 0`, tests pass, check reports 0 errors. Any fault names a page and an address; fix the descriptor, delete that page, rerun its task’s build command, re-audit.

- [ ] **Step 2: Render every page and look at each**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
for p in design-systems/simple/*.uidx; do b=$(basename "$p" .uidx); [ "$b" = tokens ] && continue; node packages/cli/dist/uidx.js render design-systems/simple "$b.uidx" -o "design-systems/simple/.build/sweep-$b.png" --scale 0.35; done
ls design-systems/simple/.build/sweep-*.png
```
Read each PNG. What to look for: any text running past its section (overflow the audit could not see because the text is inside an instance), any light in-context frame that stayed dark (a mode override on the wrong node), any “not designed” cell where a variant exists.

- [ ] **Step 3: Open the dashboard in the viewer and check the tokens view**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node packages/cli/dist/uidx.js open design-systems/simple/dashboard.uidx --root design-systems/simple --port 4500
```
Use the Browser pane: open the URL it prints, confirm the dashboard draws, switch the page to its Tokens view and confirm the `color` collection shows two mode columns with resolved swatches. Stop the server.

- [ ] **Step 4: Finish the README and commit**

Append to `design-systems/simple/README.md`:

```markdown
## Pages

tokens · app-header · app-sub-header · card-surface · card-header · tile ·
button · switch · input · pill · pagination · label · gauge · radial-progress ·
sparkline · bar-stat · table-row · status-list-row · activity-item · timeline ·
geo-map · dashboard

## Known contrast failures, stated on their pages

- Input rest border (gray-78 on layer-2) 2.4:1 — below 3:1.
- Switch off-track border 2.4:1 — below 3:1.
- Button disabled label at 40% — about 3.6:1.
```

```bash
git add design-systems/simple/README.md
git commit -m "Simple: sweep — whole-document audit green, every page viewed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review notes

- Spec coverage: tokens (T1); AppHeader, AppSubHeader, CardSurface, CardHeader, Tile (T3–7); Button, Switch, Input+Select, Pill, Pagination (T8–12); Label, Gauge, RadialProgress, Sparkline, BarStat (T13–17); TableRow, StatusListRow, ActivityItem (T18–20); Timeline×3 (T21); GeoMap+MapMarker (T22); dashboard (T23); accessibility statements ride each page’s table; light mode rides every in-context section.
- Deviations from the spec, deliberate: `size` gained `pill` and `row`; `color` gained `white`; BarStat’s width and TableRow’s progress became quantised axes because the format has no numeric geometry prop; Tile re-declares the header instead of instancing CardHeader (a Component may not host an Instance whose slot the consumer must fill).
- Type consistency: every dashboard instance in T23 uses the prop names in T3–T22’s Interfaces blocks; `docPage` fields used by descriptors are the ones the T2 header documents (`states.rows/cols/sample/samples`, `anatomyProps`, `tokenCollections`, `extraComponents`).
