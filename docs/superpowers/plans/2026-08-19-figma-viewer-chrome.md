# Figma viewer chrome — shell, theme and layers rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the viewer's intent rail with a Figma-shaped layers tree that
navigates, hides, renames and reorders, on a token-driven visual system close to
Figma's dark UI.

**Architecture:** The tree reads from `doc.tree` — the parsed file — not the
scene graph, so a row's address *is* the patch target and one gesture produces
exactly one patch by construction. All judgement lives in two pure modules
(`layer-rows.ts`, `layer-moves.ts`) that are tested without Vue or a canvas;
`LayersPane.vue` renders rows and emits patches. A single token file,
`theme.css`, carries every colour, size and spacing value in the viewer.

**Tech Stack:** TypeScript, Vue 3 `<script setup>`, Vitest, `@vue/test-utils`,
jsdom. `@open-pencil/vue` primitives only where they do not require mutating the
editor's scene graph.

**Spec:** [docs/superpowers/specs/2026-08-19-figma-viewer-chrome-design.md](../specs/2026-08-19-figma-viewer-chrome-design.md)

**Not in this plan:** the C6 inspector. It has its own reviewed plan at
[2026-08-17-properties-panel-c6.md](2026-08-17-properties-panel-c6.md) and is
executed after this one, with the two amendments recorded in Task 9.

## Global Constraints

- **Node 20.19+ is required** (root `package.json` `engines`, `.nvmrc` says
  `22.15.0`). The machine's default `node` is 18.20.4, which will fail the
  viewer's dev server on yoga's top-level await. Prefix commands with
  `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"` or run `nvm use`.
- **pnpm@9.12.2.** Run package-scoped commands as
  `pnpm --filter @uidx/viewer <script> -- <args>`.
- **No network calls at runtime (G7).** Icons are inline SVG in the repo. No
  icon font, no CDN, no webfont fetch. UI type uses the Inter faces already
  vendored from `@open-pencil/core/assets` for canvas text.
- **No raw hex in any component.** Every colour, size, radius and spacing value
  is a custom property defined in `packages/viewer/src/theme.css`. This is what
  makes the Figma match reviewable in one file.
- **The tree reads from the document, never the scene graph.** No module in this
  plan may import `SceneGraph` or call `buildLayerTreeModel`.
- **`move-node`'s `index` is post-removal.** `moveNode` in
  `packages/format/src/patch.ts:341` computes
  `newParent.children.filter((c) => c !== node)` and clamps `index` against
  *that* list. Every index this plan computes is an index into the sibling list
  with the dragged node already excluded.
- **Prose is hand-wrapped and Prettier ignores `*.md`.** Wrap docs by hand at
  roughly 80 columns; do not reflow existing prose.
- **The gate is** format → lint → typecheck → build → test → `uidx check`. Run
  `pnpm lint && pnpm typecheck && pnpm test` before the final commit of any task
  that touched more than one package.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `packages/viewer/src/layer-rows.ts` | **new** | `LayerRow`, `layerRows`, `visibleRows`, `ancestorsOf` — the document flattened into rows |
| `packages/viewer/test/layer-rows.test.ts` | **new** | flattening, depth, visibility default, collapse, ancestor derivation |
| `packages/viewer/src/layer-moves.ts` | **new** | `DropInstruction`, `moveFor`, `remapAddress`, `renameFor` — every write the tree can produce, and every refusal |
| `packages/viewer/test/layer-moves.test.ts` | **new** | index arithmetic, all six refusals, prefix remapping including the `/`-in-entity-name trap |
| `packages/viewer/src/theme.css` | **new** | the entire visual token layer |
| `packages/viewer/src/layer-icons.ts` | **new** | element → inline SVG path data |
| `packages/viewer/src/LayersPane.vue` | **new** | renders rows; emits `select`, `patches` |
| `packages/viewer/test/layers-pane.test.ts` | **new** | component tests for rows, chevrons, eye, rename |
| `packages/viewer/src/App.vue` | modify | three-column grid, theme import, `LayersPane` in the left slot, rename remapping |
| `packages/viewer/src/PropertiesPane.vue` | modify | the outline block is deleted; the pane becomes only the inspector |
| `packages/viewer/src/IntentPane.vue` | **delete** | intent leaves the viewer |
| `packages/viewer/test/intent-pane.test.ts` | **delete** | with it |
| `packages/viewer/package.json` | modify | drop `marked` — `IntentPane.vue` is its only consumer |
| `README.md`, `docs/backlog.md` | modify | seven bookkeeping rows from the spec |

---

## Task 1: The document flattened into rows

**Files:**
- Create: `packages/viewer/src/layer-rows.ts`
- Test: `packages/viewer/test/layer-rows.test.ts`

**Interfaces:**
- Consumes: `UidxDocument`, `UidxNode`, `UidxElement`, `ENTITY_SEP`, `PATH_SEP` from `@uidx/format`.
- Produces: `LayerRow`, `layerRows(doc)`, `visibleRows(rows, expanded)`, `ancestorsOf(address)`. Tasks 4–8 all consume these.

- [ ] **Step 1: Write the failing test**

Create `packages/viewer/test/layer-rows.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'

import { ancestorsOf, layerRows, visibleRows } from '../src/layer-rows'

const DOC = parseOrThrow(`---
id: primary-button
---

## Visual Contract

<Page>
  <Component name="Button/Primary" status="stable">
    <Frame name="container" layoutMode="HORIZONTAL">
      <Vector name="leading-icon" visible={false} />
      <Text name="label" characters="Click Me" />
    </Frame>
  </Component>
</Page>
`)

describe('layerRows', () => {
  it('flattens the document depth-first, root first', () => {
    expect(layerRows(DOC).map((r) => [r.address, r.depth])).toEqual([
      ['', 0],
      ['Button/Primary', 1],
      ['Button/Primary#container', 2],
      ['Button/Primary#container/leading-icon', 3],
      ['Button/Primary#container/label', 3],
    ])
  })

  it('carries the element and the display name', () => {
    const rows = layerRows(DOC)
    expect(rows[1]).toMatchObject({ element: 'Component', name: 'Button/Primary' })
    expect(rows[4]).toMatchObject({ element: 'Text', name: 'label' })
  })

  /** An absent `visible` attribute means visible — the eye must not read blank as hidden. */
  it('defaults visible to true and reads an explicit false', () => {
    const rows = layerRows(DOC)
    expect(rows[2]!.visible).toBe(true)
    expect(rows[3]!.visible).toBe(false)
  })

  it('marks which rows can be expanded', () => {
    expect(layerRows(DOC).map((r) => r.hasChildren)).toEqual([true, true, true, false, false])
  })

  it('is empty for no document', () => {
    expect(layerRows(null)).toEqual([])
  })
})

describe('visibleRows', () => {
  it('hides every descendant of a collapsed row', () => {
    const rows = layerRows(DOC)
    const shown = visibleRows(rows, new Set(['', 'Button/Primary']))
    expect(shown.map((r) => r.address)).toEqual(['', 'Button/Primary', 'Button/Primary#container'])
  })

  it('shows everything when all containers are expanded', () => {
    const rows = layerRows(DOC)
    const all = new Set(rows.filter((r) => r.hasChildren).map((r) => r.address))
    expect(visibleRows(rows, all)).toHaveLength(5)
  })

  it('collapsing the root leaves only the root', () => {
    expect(visibleRows(layerRows(DOC), new Set())).toHaveLength(1)
  })
})

describe('ancestorsOf', () => {
  it('walks up through the entity boundary and the path', () => {
    expect(ancestorsOf('Button/Primary#container/label')).toEqual([
      '',
      'Button/Primary',
      'Button/Primary#container',
    ])
  })

  it('stops at the page for an entity', () => {
    expect(ancestorsOf('Button/Primary')).toEqual([''])
    expect(ancestorsOf('')).toEqual([])
  })

  /**
   * `/` is a name character in an entity name — `Button/Primary` is one
   * component, not two levels. Splitting the whole address on `/` would invent
   * an ancestor called `Button`.
   */
  it('does not split the entity name into levels', () => {
    expect(ancestorsOf('Button/Primary#container')).toEqual(['', 'Button/Primary'])
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/viewer test -- test/layer-rows.test.ts
```

Expected: FAIL — `Cannot find module '../src/layer-rows'`.

- [ ] **Step 3: Write the implementation**

Create `packages/viewer/src/layer-rows.ts`:

```ts
import { ENTITY_SEP, PATH_SEP, type UidxDocument, type UidxElement, type UidxNode } from '@uidx/format'

/**
 * One row of the layers rail.
 *
 * Read from the document rather than the scene graph, which is what makes
 * `address` do three jobs at once: it is the row's identity, the target of any
 * patch the row emits, and the scene-graph node id the canvas selects by. No
 * lookup sits between a row and the file it edits.
 */
export interface LayerRow {
  /** 'Button/Primary#container/label'. The root <Page> is the empty string. */
  address: string
  name: string
  element: UidxElement
  depth: number
  hasChildren: boolean
  /** From the `visible` attribute, defaulting true when it is not declared. */
  visible: boolean
}

/** The whole document, depth-first, root first. Collapse is applied separately. */
export function layerRows(doc: UidxDocument | null): LayerRow[] {
  if (!doc) return []
  const out: LayerRow[] = []
  const walk = (node: UidxNode, depth: number): void => {
    out.push({
      address: node.address,
      name: node.name,
      element: node.element,
      depth,
      hasChildren: node.children.length > 0,
      // Absent means visible. Reading a missing attribute as `false` would
      // show every node in the file as hidden.
      visible: node.attrs.visible?.value !== false,
    })
    for (const child of node.children) walk(child, depth + 1)
  }
  walk(doc.tree, 0)
  return out
}

/**
 * The rows a collapsed tree actually shows.
 *
 * Depth-tracking rather than an ancestor test per row: the list is already in
 * document order, so everything under a collapsed row is exactly the run of
 * rows deeper than it.
 */
export function visibleRows(
  rows: readonly LayerRow[],
  expanded: ReadonlySet<string>,
): LayerRow[] {
  const out: LayerRow[] = []
  let hiddenBelow = Number.POSITIVE_INFINITY
  for (const row of rows) {
    if (row.depth > hiddenBelow) continue
    hiddenBelow = Number.POSITIVE_INFINITY
    out.push(row)
    if (row.hasChildren && !expanded.has(row.address)) hiddenBelow = row.depth
  }
  return out
}

/**
 * Every address between the page and this one, outermost first.
 *
 * Used to open the tree down to a canvas selection. The entity boundary matters:
 * ADR 0004 keeps `/` free to be a name character, so `Button/Primary` is one
 * component and splitting the whole address on `/` would invent an ancestor.
 */
export function ancestorsOf(address: string): string[] {
  if (address === '') return []
  const hash = address.indexOf(ENTITY_SEP)
  if (hash === -1) return ['']

  const entity = address.slice(0, hash)
  const out = ['', entity]
  const segments = address.slice(hash + 1).split(PATH_SEP)
  for (let i = 1; i < segments.length; i += 1) {
    out.push(`${entity}${ENTITY_SEP}${segments.slice(0, i).join(PATH_SEP)}`)
  }
  return out
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/viewer test -- test/layer-rows.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/viewer/src/layer-rows.ts packages/viewer/test/layer-rows.test.ts
git commit -m "Flatten the document into layer rows"
```

---

## Task 2: Every write the tree can make, and every refusal

**Files:**
- Create: `packages/viewer/src/layer-moves.ts`
- Test: `packages/viewer/test/layer-moves.test.ts`

**Interfaces:**
- Consumes: `resolve`, `UidxDocument`, `UidxNode`, `UidxPatch`, `CONTAINER_ELEMENTS`, `PAGE_CHILD_ELEMENTS`, `NODE_CHILD_ELEMENTS`, `ENTITY_SEP`, `PATH_SEP` from `@uidx/format`.
- Produces: `DropInstruction`, `moveFor(doc, dragged, target, instruction)`, `renameFor(doc, address, name)`, `remapAddress(oldAddress, newAddress, address)`, `parentOf(doc, address)`. Tasks 6 and 7 consume these.

`moveFor` and `renameFor` return `null` for a refused gesture. Returning `null`
rather than throwing is deliberate: the caller uses it to disable a drop target
during the drag, so a refusal is a UI state, not an error.

- [ ] **Step 1: Write the failing test**

Create `packages/viewer/test/layer-moves.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'

import { moveFor, parentOf, remapAddress, renameFor } from '../src/layer-moves'

const DOC = parseOrThrow(`---
id: page
---

## Visual Contract

<Page>
  <Component name="Button/Primary">
    <Frame name="container">
      <Vector name="icon" />
      <Text name="label" characters="Hi" />
      <Frame name="slot" />
    </Frame>
  </Component>
  <Frame name="loose">
    <Text name="label" characters="Hi" />
  </Frame>
</Page>
`)

const A = 'Button/Primary#container'

describe('parentOf', () => {
  it('finds the parent node of an address', () => {
    expect(parentOf(DOC, `${A}/icon`)?.address).toBe(A)
    expect(parentOf(DOC, 'Button/Primary')?.address).toBe('')
    expect(parentOf(DOC, '')).toBeNull()
  })
})

describe('moveFor', () => {
  /**
   * `moveNode` filters the dragged node out of the sibling list before
   * clamping the index (patch.ts:341), so every index here is computed against
   * the list as it will be *after* removal. Computing it against the list as
   * displayed is the classic reorder off-by-one.
   */
  it('drops above a sibling using the post-removal index', () => {
    expect(moveFor(DOC, `${A}/label`, `${A}/icon`, 'above')).toEqual({
      op: 'move-node',
      address: `${A}/label`,
      newParent: A,
      index: 0,
    })
  })

  it('drops below a sibling', () => {
    expect(moveFor(DOC, `${A}/icon`, `${A}/label`, 'below')).toEqual({
      op: 'move-node',
      address: `${A}/icon`,
      newParent: A,
      index: 1,
    })
  })

  it('drops into a container, appending', () => {
    expect(moveFor(DOC, `${A}/icon`, `${A}/slot`, 'into')).toEqual({
      op: 'move-node',
      address: `${A}/icon`,
      newParent: `${A}/slot`,
      index: 0,
    })
  })

  it('refuses to move the root page', () => {
    expect(moveFor(DOC, '', `${A}/icon`, 'above')).toBeNull()
  })

  it('refuses a drop into the dragged node or its own descendant', () => {
    expect(moveFor(DOC, A, `${A}/icon`, 'into')).toBeNull()
    expect(moveFor(DOC, A, A, 'into')).toBeNull()
  })

  it('refuses to drag the sole child of a component out', () => {
    expect(moveFor(DOC, A, 'loose', 'into')).toBeNull()
  })

  it('refuses a drop into an element that cannot have children', () => {
    expect(moveFor(DOC, `${A}/icon`, `${A}/label`, 'into')).toBeNull()
  })

  it('refuses an element the target may not contain', () => {
    // <Component> is a page child only — it may not nest inside a frame.
    expect(moveFor(DOC, 'Button/Primary', `${A}/slot`, 'into')).toBeNull()
  })

  it('refuses a move that would duplicate a sibling name', () => {
    // `loose` already has a child called `label`.
    expect(moveFor(DOC, `${A}/label`, 'loose', 'into')).toBeNull()
  })
})

describe('renameFor', () => {
  it('writes the new name onto the node', () => {
    expect(renameFor(DOC, `${A}/icon`, 'glyph')).toEqual({
      op: 'set',
      address: `${A}/icon`,
      prop: 'name',
      value: 'glyph',
    })
  })

  it('refuses a name a sibling already has', () => {
    expect(renameFor(DOC, `${A}/icon`, 'label')).toBeNull()
  })

  it('refuses renaming the root page, whose name is the frontmatter id', () => {
    expect(renameFor(DOC, '', 'other')).toBeNull()
  })

  it('refuses an empty name', () => {
    expect(renameFor(DOC, `${A}/icon`, '  ')).toBeNull()
  })

  it('accepts renaming to the name it already has as a no-op refusal', () => {
    expect(renameFor(DOC, `${A}/icon`, 'icon')).toBeNull()
  })
})

describe('remapAddress', () => {
  it('moves a descendant address under the new name', () => {
    expect(remapAddress(A, 'Button/Primary#box', `${A}/label`)).toBe('Button/Primary#box/label')
  })

  it('moves the renamed address itself', () => {
    expect(remapAddress(A, 'Button/Primary#box', A)).toBe('Button/Primary#box')
  })

  it('leaves an unrelated address alone', () => {
    expect(remapAddress(A, 'Button/Primary#box', 'loose/label')).toBe('loose/label')
  })

  /**
   * The trap. `/` is a name character inside an entity name, so a component
   * called `Button/Primary` and one called `Button/Primary/Old` are siblings,
   * not parent and child. Only `#` bounds an entity.
   */
  it('does not remap a different entity that shares a name prefix', () => {
    expect(remapAddress('Button/Primary', 'Button/Secondary', 'Button/Primary/Old#root')).toBe(
      'Button/Primary/Old#root',
    )
  })

  it('remaps across the entity boundary when the entity is renamed', () => {
    expect(remapAddress('Button/Primary', 'Button/Secondary', `${A}/label`)).toBe(
      'Button/Secondary#container/label',
    )
  })

  /** Inside an entity the boundary is `/`, and a longer sibling name must not match. */
  it('does not remap a sibling whose name extends the renamed one', () => {
    expect(remapAddress(A, 'Button/Primary#box', `${A}Extra/label`)).toBe(`${A}Extra/label`)
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/viewer test -- test/layer-moves.test.ts
```

Expected: FAIL — `Cannot find module '../src/layer-moves'`.

- [ ] **Step 3: Write the implementation**

Create `packages/viewer/src/layer-moves.ts`:

```ts
import {
  CONTAINER_ELEMENTS,
  ENTITY_SEP,
  NODE_CHILD_ELEMENTS,
  PAGE_CHILD_ELEMENTS,
  PATH_SEP,
  resolve,
  type UidxDocument,
  type UidxNode,
  type UidxPatch,
} from '@uidx/format'

/** The three drops a layer tree offers. */
export type DropInstruction = 'above' | 'below' | 'into'

/**
 * Every refusal below mirrors a guard `applyPatch` already enforces.
 *
 * Duplicating them is deliberate and bounded: the patcher's guards protect the
 * file, and these protect the gesture. A drag needs to know a drop is illegal
 * while the pointer is still moving, which is a question a thrown PatchError
 * arriving after the write cannot answer. `null` is that answer.
 */
export function parentOf(doc: UidxDocument, address: string): UidxNode | null {
  if (address === '') return null
  const find = (node: UidxNode): UidxNode | null => {
    for (const child of node.children) {
      if (child.address === address) return node
      const hit = find(child)
      if (hit) return hit
    }
    return null
  }
  return find(doc.tree)
}

function isDescendant(ancestor: UidxNode, address: string): boolean {
  for (const child of ancestor.children) {
    if (child.address === address || isDescendant(child, address)) return true
  }
  return false
}

export function moveFor(
  doc: UidxDocument,
  dragged: string,
  target: string,
  instruction: DropInstruction,
): UidxPatch | null {
  if (dragged === '') return null

  const node = resolve(doc.tree, dragged)
  const targetNode = resolve(doc.tree, target)
  if (!node || !targetNode) return null

  const newParent = instruction === 'into' ? targetNode : parentOf(doc, target)
  if (!newParent) return null

  // A synthetic <Page> has no source span, so nothing can be written into it
  // until `uidx fmt` materialises the wrapper.
  if (newParent.synthetic) return null
  if (!CONTAINER_ELEMENTS.has(newParent.element)) return null
  if (newParent.address === dragged || isDescendant(node, newParent.address)) return null

  const oldParent = parentOf(doc, dragged)
  if (oldParent?.element === 'Component') return null
  if (oldParent?.synthetic) return null

  const legal = newParent.element === 'Page' ? PAGE_CHILD_ELEMENTS : NODE_CHILD_ELEMENTS
  if (!legal.has(node.element)) return null

  // The index `move-node` wants is an index into the siblings *after* the
  // dragged node is removed (patch.ts:341). Filtering first makes the
  // same-parent reorder arithmetic fall out rather than needing correction.
  const siblings = newParent.children.filter((c) => c.address !== dragged)
  if (newParent.element === 'Component' && siblings.length >= 1) return null
  if (newParent !== oldParent && siblings.some((c) => c.name === node.name)) return null

  let index: number
  if (instruction === 'into') {
    index = siblings.length
  } else {
    const at = siblings.findIndex((c) => c.address === target)
    if (at === -1) return null
    index = instruction === 'above' ? at : at + 1
  }

  return { op: 'move-node', address: dragged, newParent: newParent.address, index }
}

/**
 * A rename is an ordinary `set` on `name` — the patcher says so itself
 * (`patch.ts:216`). What makes it structural is not the write but the fallout:
 * every address beneath the node moves with it. See `remapAddress`.
 */
export function renameFor(doc: UidxDocument, address: string, name: string): UidxPatch | null {
  const next = name.trim()
  if (address === '' || next === '') return null

  const node = resolve(doc.tree, address)
  if (!node || node.name === next) return null
  // Nothing to replace when the attribute was never authored.
  if (!node.attrs.name) return null

  const parent = parentOf(doc, address)
  if (parent?.children.some((c) => c.address !== address && c.name === next)) return null

  return { op: 'set', address, prop: 'name', value: next }
}

/**
 * One address, rewritten for a rename that happened above it.
 *
 * The boundary character is the whole subtlety. ADR 0004 keeps `/` free to be a
 * name character and uses `#` to bound the entity, so `Button/Primary` and
 * `Button/Primary/Old` are two components rather than a parent and a child.
 * Which separator counts as "beneath" therefore depends on which side of the
 * `#` the renamed node sits.
 */
export function remapAddress(oldAddress: string, newAddress: string, address: string): string {
  if (address === oldAddress) return newAddress
  if (!address.startsWith(oldAddress)) return address

  const boundary = oldAddress.includes(ENTITY_SEP) ? PATH_SEP : ENTITY_SEP
  if (address.charAt(oldAddress.length) !== boundary) return address

  return newAddress + address.slice(oldAddress.length)
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/viewer test -- test/layer-moves.test.ts
```

Expected: PASS, 19 tests. If `resolve` is not exported from `@uidx/format`,
check `packages/format/src/index.ts` — it is used the same way by
`packages/schema/src/from-scene.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/viewer/src/layer-moves.ts packages/viewer/test/layer-moves.test.ts
git commit -m "Compute the tree's moves and renames, and refuse the illegal ones"
```

---

## Task 3: The visual token layer

**Files:**
- Create: `packages/viewer/src/theme.css`
- Modify: `packages/viewer/src/main.ts`
- Modify: `packages/viewer/src/App.vue` (delete the `:root` block, restyle the bar)

No test: this task changes only appearance, which the component tests must not
pin. Verified by eye against the reference screenshot in Task 8.

**Interfaces:**
- Produces: the custom-property names below. Every later task's CSS uses them and defines no colours of its own.

- [ ] **Step 1: Write the token file**

Create `packages/viewer/src/theme.css`:

```css
/*
 * Every colour, size and spacing value in the viewer.
 *
 * One file rather than per-component values so that "does this look like
 * Figma" is a question you answer by reading one screen of tokens against a
 * reference, instead of hunting hex codes through six components. No component
 * in this package may contain a raw colour.
 *
 * Type is Inter, already vendored for canvas text by `scripts/setup-assets.mjs`
 * into `public/fonts/`. Declaring the faces here points the chrome at those same
 * local files — no font fetch, so G7's no-network rule stays true for the UI as
 * well as the canvas. Without these @font-face rules `font-family: Inter` would
 * silently fall through to system-ui, because the canvas loads its copies
 * through CanvasKit's font manager, not through CSS.
 */
@font-face {
  font-family: Inter;
  src: url('/fonts/Inter-Regular.ttf') format('truetype');
  font-weight: 400;
  font-display: block;
}
@font-face {
  font-family: Inter;
  src: url('/fonts/Inter-Medium.ttf') format('truetype');
  font-weight: 500;
  font-display: block;
}
@font-face {
  font-family: Inter;
  src: url('/fonts/Inter-SemiBold.ttf') format('truetype');
  font-weight: 600;
  font-display: block;
}
@font-face {
  font-family: Inter;
  src: url('/fonts/Inter-Bold.ttf') format('truetype');
  font-weight: 700;
  font-display: block;
}

:root {
  /* Surfaces, back to front. */
  --bg: #1e1e1e;
  --panel: #2c2c2c;
  --canvas-bg: #1e1e1e;
  --raised: #383838;
  --line: #444444;

  /* Text, by emphasis. */
  --text: #ffffff;
  --text-dim: #b3b3b3;
  --text-faint: #7c7c7c;

  /* Selection and state. */
  --accent: #0d99ff;
  --accent-dim: #0d99ff33;
  --danger: #f24822;
  --warn: #ffcd29;
  --ok: #14ae5c;

  /* Type. */
  --ui-font: Inter, system-ui, -apple-system, sans-serif;
  --ui-size: 11px;
  --ui-size-sm: 10px;
  --ui-line: 16px;

  /* Rhythm. */
  --row-h: 24px;
  --field-h: 24px;
  --bar-h: 40px;
  --rail-w: 240px;
  --indent: 16px;
  --gap: 8px;
  --gap-sm: 4px;
  --pad: 8px;
  --radius: 2px;
  --radius-lg: 4px;
  --icon: 12px;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--ui-font);
  font-size: var(--ui-size);
  line-height: var(--ui-line);
  /* Figma's chrome is dense; the browser's default text rendering is not. */
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 2: Import it at the entrypoint**

Modify `packages/viewer/src/main.ts`:

```ts
import { createApp } from 'vue'
import App from './App.vue'
import './theme.css'

createApp(App).mount('#app')
```

- [ ] **Step 3: Delete the old palette**

In `packages/viewer/src/App.vue`, delete the entire unscoped `<style>` block —
the `:root` palette, the `*` reset and the `body` rule are all in `theme.css`
now. Leave `<style scoped>` in place; the next step rewrites it.

- [ ] **Step 4: Restyle the top bar**

In `App.vue`'s `<style scoped>`, replace the `.bar`, `.title`, `.rev`, `.sel`,
`.conn` and `.dismiss` rules. The monospace goes; the height comes from
`--bar-h`; the connection pill keeps its three states but takes its colours from
tokens:

```css
.bar {
  display: flex;
  align-items: center;
  gap: var(--gap);
  padding: 0 var(--pad);
  height: var(--bar-h);
  flex: none;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  font-size: var(--ui-size);
}
.title {
  font-weight: 600;
}
.rev,
.sel {
  color: var(--text-faint);
}
.spacer {
  flex: 1;
}
.conn {
  font-size: var(--ui-size-sm);
  padding: 1px var(--gap);
  border-radius: var(--radius-lg);
  border: 1px solid var(--line);
  color: var(--text-faint);
}
.conn[data-state='open'] {
  color: var(--ok);
  border-color: var(--ok);
}
.conn[data-state='reconnecting'] {
  color: var(--warn);
  border-color: var(--warn);
}
.conn[data-state='closed'] {
  color: var(--danger);
  border-color: var(--danger);
}
.dismiss {
  margin-left: auto;
  background: none;
  border: 1px solid currentcolor;
  border-radius: var(--radius);
  color: inherit;
  font-family: inherit;
  font-size: var(--ui-size-sm);
  padding: 1px var(--gap);
  cursor: pointer;
}
```

- [ ] **Step 5: Verify the suite still passes and nothing references the old tokens**

```bash
PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/viewer test
grep -rn "\-\-surface\|--mono" packages/viewer/src || echo "no stale tokens"
```

Expected: tests PASS; the grep prints `no stale tokens`. If it prints hits,
those components were using the deleted palette — replace each with the nearest
token above (`--surface` becomes `--panel`; a `--mono` stack becomes
`--ui-font`, since nothing in the new chrome is monospace).

- [ ] **Step 6: Commit**

```bash
git add packages/viewer/src/theme.css packages/viewer/src/main.ts packages/viewer/src/App.vue
git commit -m "Give the viewer one token layer, and a chrome that uses it"
```

---

## Task 4: The layers rail, read-only

**Files:**
- Create: `packages/viewer/src/layer-icons.ts`
- Create: `packages/viewer/src/LayersPane.vue`
- Create: `packages/viewer/test/layers-pane.test.ts`
- Modify: `packages/viewer/src/App.vue`
- Modify: `packages/viewer/src/PropertiesPane.vue`
- Delete: `packages/viewer/src/IntentPane.vue`, `packages/viewer/test/intent-pane.test.ts`
- Modify: `packages/viewer/package.json`

**Interfaces:**
- Consumes: `LayerRow`, `layerRows`, `visibleRows`, `ancestorsOf` from Task 1.
- Produces: `LayersPane` with props `{ doc, selection }` and emits `select: [address: string]`. Tasks 5–7 add `patches` to those emits.

- [ ] **Step 1: Write the icon table**

Create `packages/viewer/src/layer-icons.ts`:

```ts
import type { UidxElement } from '@uidx/format'

/**
 * Inline SVG path data, one per element.
 *
 * Inline rather than an icon font or a sprite fetched at runtime, because G7
 * forbids network calls — the same rule that made the canvas vendor CanvasKit's
 * wasm. Every path is drawn in a 12x12 box to match `--icon`.
 */
export const LAYER_ICONS: Record<UidxElement, string> = {
  Page: 'M2 1h5l3 3v7H2z',
  Component: 'M6 1l2.5 2.5L6 6 3.5 3.5zM6 6l2.5 2.5L6 11 3.5 8.5z',
  Frame: 'M3 1v10M9 1v10M1 3h10M1 9h10',
  Text: 'M2 2h8M6 2v8M4 10h4',
  Rectangle: 'M2 2h8v8H2z',
  Ellipse: 'M6 2a4 4 0 110 8 4 4 0 010-8z',
  Vector: 'M2 10L6 2l4 8-4-2z',
  Tokens: 'M2 3h8M2 6h8M2 9h5',
  Collection: 'M2 2h8v3H2zM2 7h8v3H2z',
  Variable: 'M4 2v8M8 2v8M2 5h8',
}

/** Elements drawn as outlines rather than filled shapes. */
export const STROKE_ICONS: ReadonlySet<UidxElement> = new Set([
  'Frame',
  'Text',
  'Rectangle',
  'Ellipse',
  'Tokens',
  'Variable',
])
```

- [ ] **Step 2: Write the failing component test**

Create `packages/viewer/test/layers-pane.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { parseOrThrow } from '@uidx/format'

import LayersPane from '../src/LayersPane.vue'

const DOC = parseOrThrow(`---
id: page
---

## Visual Contract

<Page>
  <Component name="Button/Primary">
    <Frame name="container">
      <Vector name="icon" visible={false} />
      <Text name="label" characters="Hi" />
    </Frame>
  </Component>
</Page>
`)

const rowsOf = (w: ReturnType<typeof mount>) => w.findAll('[data-address]')

describe('LayersPane', () => {
  it('renders every row of an expanded tree, indented by depth', () => {
    const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
    const rows = rowsOf(w)
    expect(rows).toHaveLength(5)
    expect(rows[4]!.attributes('data-address')).toBe('Button/Primary#container/label')
    expect(rows[4]!.attributes('style')).toContain('--depth: 3')
  })

  it('collapses a subtree when its chevron is clicked', async () => {
    const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
    await w.get('[data-address="Button/Primary"] .chevron').trigger('click')
    expect(rowsOf(w).map((r) => r.attributes('data-address'))).toEqual(['', 'Button/Primary'])
  })

  it('emits the address when a row is clicked', async () => {
    const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
    await w.get('[data-address="Button/Primary#container"] .label').trigger('click')
    expect(w.emitted('select')?.[0]).toEqual(['Button/Primary#container'])
  })

  it('marks the selected row', () => {
    const w = mount(LayersPane, {
      props: { doc: DOC, selection: ['Button/Primary#container'] },
    })
    expect(
      w.get('[data-address="Button/Primary#container"]').attributes('data-selected'),
    ).toBe('true')
  })

  /** A hidden node has to read as hidden without hovering to find out. */
  it('marks a row whose node is not visible', () => {
    const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
    const icon = w.get('[data-address="Button/Primary#container/icon"]')
    expect(icon.attributes('data-hidden')).toBe('true')
  })

  it('opens the tree down to a selection made elsewhere', async () => {
    const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
    await w.get('[data-address="Button/Primary"] .chevron').trigger('click')
    expect(rowsOf(w)).toHaveLength(2)

    await w.setProps({ selection: ['Button/Primary#container/label'] })
    expect(rowsOf(w).map((r) => r.attributes('data-address'))).toContain(
      'Button/Primary#container/label',
    )
  })

  it('renders nothing for no document', () => {
    const w = mount(LayersPane, { props: { doc: null, selection: [] } })
    expect(rowsOf(w)).toHaveLength(0)
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

```bash
PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/viewer test -- test/layers-pane.test.ts
```

Expected: FAIL — `Cannot find module '../src/LayersPane.vue'`.

- [ ] **Step 4: Write the component**

Create `packages/viewer/src/LayersPane.vue`:

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { UidxDocument } from '@uidx/format'

import { LAYER_ICONS, STROKE_ICONS } from './layer-icons'
import { ancestorsOf, layerRows, visibleRows } from './layer-rows'

const props = defineProps<{
  doc: UidxDocument | null
  selection?: string[]
}>()

const emit = defineEmits<{ select: [address: string] }>()

/**
 * Expansion is keyed by address rather than by row index, so a save that
 * re-parses the file does not collapse the tree the author is working in.
 * Everything starts open: a contract is small, and a tree that hides the node
 * you just selected is worse than a long list.
 */
const collapsed = ref(new Set<string>())

const all = computed(() => layerRows(props.doc))
const expanded = computed(
  () => new Set(all.value.filter((r) => !collapsed.value.has(r.address)).map((r) => r.address)),
)
const rows = computed(() => visibleRows(all.value, expanded.value))

function toggle(address: string): void {
  const next = new Set(collapsed.value)
  if (!next.delete(address)) next.add(address)
  collapsed.value = next
}

/**
 * A selection made on the canvas has to become visible here, which means
 * opening whatever the author collapsed above it. Figma does the same thing,
 * and without it clicking a nested node leaves the rail showing nothing.
 */
watch(
  () => props.selection?.[0],
  (address) => {
    if (!address) return
    const next = new Set(collapsed.value)
    for (const ancestor of ancestorsOf(address)) next.delete(ancestor)
    collapsed.value = next
  },
)

const isSelected = (address: string): boolean => (props.selection ?? []).includes(address)
</script>

<template>
  <div class="layers">
    <div
      v-for="row in rows"
      :key="row.address"
      class="row"
      :data-address="row.address"
      :data-selected="isSelected(row.address) ? 'true' : 'false'"
      :data-hidden="row.visible ? 'false' : 'true'"
      :style="{ '--depth': row.depth }"
    >
      <button
        v-if="row.hasChildren"
        type="button"
        class="chevron"
        :aria-expanded="!collapsed.has(row.address)"
        @click.stop="toggle(row.address)"
      >
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
          <path d="M2 1l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
      <span v-else class="chevron-spacer" />

      <svg class="icon" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path
          :d="LAYER_ICONS[row.element]"
          :fill="STROKE_ICONS.has(row.element) ? 'none' : 'currentColor'"
          :stroke="STROKE_ICONS.has(row.element) ? 'currentColor' : 'none'"
          stroke-width="1"
        />
      </svg>

      <span class="label" @click="emit('select', row.address)">{{ row.name }}</span>
    </div>
  </div>
</template>

<style scoped>
.layers {
  background: var(--panel);
  border-right: 1px solid var(--line);
  overflow: auto;
  padding: var(--gap-sm) 0;
  user-select: none;
}
.row {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  height: var(--row-h);
  padding-right: var(--pad);
  padding-left: calc(var(--pad) + var(--depth) * var(--indent));
  color: var(--text);
}
.row:hover {
  background: var(--raised);
}
.row[data-selected='true'] {
  background: var(--accent-dim);
  box-shadow: inset 2px 0 0 var(--accent);
}
.row[data-hidden='true'] {
  color: var(--text-faint);
}
.chevron,
.chevron-spacer {
  width: var(--icon);
  height: var(--icon);
  flex: none;
}
.chevron {
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-dim);
  cursor: pointer;
  transition: transform 80ms ease;
}
.chevron[aria-expanded='true'] {
  transform: rotate(90deg);
}
.icon {
  flex: none;
  color: var(--text-dim);
}
.label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: default;
}
</style>
```

- [ ] **Step 5: Run it and watch it pass**

```bash
PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/viewer test -- test/layers-pane.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 6: Put it in the shell and take the intent pane out**

In `packages/viewer/src/App.vue`:

1. Replace the `IntentPane` import with `import LayersPane from './LayersPane.vue'`.
2. Replace the left pane block:

```html
      <ErrorBoundary pane="Layers">
        <LayersPane :doc="doc" :selection="selection" @select="selection = [$event]" />
      </ErrorBoundary>
```

3. Change the grid to fixed rails:

```css
.panes {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: var(--rail-w) minmax(0, 1fr) var(--rail-w);
}
```

4. Rename the right pane's boundary label from `Contract` to `Inspector`.

Then delete the files it replaces and the dependency only it used:

```bash
git rm packages/viewer/src/IntentPane.vue packages/viewer/test/intent-pane.test.ts
```

Remove `"marked": "^15.0.6"` from `packages/viewer/package.json` dependencies,
then `pnpm install`.

- [ ] **Step 7: Take the outline out of the properties pane**

In `packages/viewer/src/PropertiesPane.vue`, delete the `Row` interface, the
`rows` computed (the `walk`/flatten block at line 35), the `attrsOf` helper if
nothing else uses it, the `<h3 class="outline-head">Outline</h3>` block and
every row it renders, and their CSS. The pane keeps only the editor for the
selected node.

Update `packages/viewer/test/properties-pane.test.ts` — delete any test that
asserts on outline rows. Do not delete tests that assert on the editor.

- [ ] **Step 8: Run the whole gate**

```bash
PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm lint && pnpm typecheck && pnpm test
```

Expected: PASS. `marked` should now appear nowhere in `packages/viewer/src`.

- [ ] **Step 9: Commit**

```bash
git add -A packages/viewer
git commit -m "Give the viewer a layers rail, and take the intent pane out"
```

---

## Task 5: The eye

**Files:**
- Modify: `packages/viewer/src/LayersPane.vue`
- Modify: `packages/viewer/test/layers-pane.test.ts`
- Modify: `packages/viewer/src/App.vue`

**Interfaces:**
- Consumes: `LayerRow.visible` from Task 1.
- Produces: `LayersPane` gains `patches: [patches: UidxPatch[]]` to its emits. Tasks 6 and 7 emit through the same channel.

- [ ] **Step 1: Write the failing tests**

Add to `packages/viewer/test/layers-pane.test.ts`:

```ts
describe('the eye', () => {
  it('hides a visible node by setting the attribute it already declares', async () => {
    const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
    await w.get('[data-address="Button/Primary#container/icon"] .eye').trigger('click')
    // `icon` declares visible={false}, so toggling it writes true.
    expect(w.emitted('patches')?.[0]).toEqual([
      [{ op: 'set', address: 'Button/Primary#container/icon', prop: 'visible', value: true }],
    ])
  })

  /**
   * A node with no `visible` attribute is visible. Hiding it has to *add* the
   * attribute, not set one that is not there — `set` on an absent prop has no
   * span to replace.
   */
  it('adds the attribute when the node never declared it', async () => {
    const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
    await w.get('[data-address="Button/Primary#container/label"] .eye').trigger('click')
    expect(w.emitted('patches')?.[0]).toEqual([
      [{ op: 'add', address: 'Button/Primary#container/label', prop: 'visible', value: false }],
    ])
  })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/viewer test -- test/layers-pane.test.ts
```

Expected: FAIL — no `.eye` element.

- [ ] **Step 3: Add `declaresVisible` to the row**

In `packages/viewer/src/layer-rows.ts`, add one field to `LayerRow`:

```ts
  /** Whether `visible` is authored, which decides between a `set` and an `add`. */
  declaresVisible: boolean
```

and populate it in `layerRows`:

```ts
      declaresVisible: node.attrs.visible !== undefined,
```

Add to `packages/viewer/test/layer-rows.test.ts`:

```ts
  it('records whether visible was authored, to choose set over add', () => {
    const rows = layerRows(DOC)
    expect(rows[3]!.declaresVisible).toBe(true)
    expect(rows[4]!.declaresVisible).toBe(false)
  })
```

- [ ] **Step 4: Emit the patch**

In `LayersPane.vue`, extend the emits and add the handler:

```ts
const emit = defineEmits<{
  select: [address: string]
  patches: [patches: UidxPatch[]]
}>()

/**
 * Visibility is an ordinary property write, which is why the tree can do it
 * without any structural machinery. The only wrinkle is that an undeclared
 * `visible` has no span to replace, so hiding such a node is an `add`.
 */
function toggleVisible(row: LayerRow): void {
  emit('patches', [
    row.declaresVisible
      ? { op: 'set', address: row.address, prop: 'visible', value: !row.visible }
      : { op: 'add', address: row.address, prop: 'visible', value: false },
  ])
}
```

Import `type UidxPatch` from `@uidx/format` and `type LayerRow` from
`./layer-rows`. Add the button to the row template, after `.label`:

```html
      <button type="button" class="eye" :aria-pressed="!row.visible" @click.stop="toggleVisible(row)">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M1 6s2-3.5 5-3.5S11 6 11 6s-2 3.5-5 3.5S1 6 1 6z"
            fill="none"
            stroke="currentColor"
          />
          <circle cx="6" cy="6" r="1.5" fill="currentColor" />
          <path v-if="!row.visible" d="M2 10L10 2" stroke="currentColor" />
        </svg>
      </button>
```

and the CSS — the eye appears on hover, or stays whenever the node is hidden,
which is Figma's behaviour:

```css
.eye {
  flex: none;
  display: grid;
  place-items: center;
  width: var(--icon);
  height: var(--icon);
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-dim);
  cursor: pointer;
  visibility: hidden;
}
.row:hover .eye,
.row[data-hidden='true'] .eye {
  visibility: visible;
}
```

- [ ] **Step 5: Route it through the shell**

In `App.vue`, add `@patches="commitPatches"` to the `LayersPane` element.
`commitPatches` already exists and takes `UidxPatch[]`.

- [ ] **Step 6: Run and watch it pass**

```bash
PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/viewer test
```

Expected: PASS, including the new `layer-rows` assertion.

- [ ] **Step 7: Commit**

```bash
git add packages/viewer
git commit -m "Let the layers rail hide a node"
```

---

## Task 6: Rename, and the addresses it moves

**Files:**
- Modify: `packages/viewer/src/LayersPane.vue`
- Modify: `packages/viewer/test/layers-pane.test.ts`
- Modify: `packages/viewer/src/App.vue`

**Interfaces:**
- Consumes: `renameFor`, `remapAddress` from Task 2.
- Produces: `LayersPane` gains `rename: [oldAddress: string, newAddress: string]`, emitted alongside the patch so the shell can move the selection with it.

- [ ] **Step 1: Write the failing tests**

Add to `packages/viewer/test/layers-pane.test.ts`:

```ts
describe('rename', () => {
  const startRename = async (w: ReturnType<typeof mount>, address: string) => {
    await w.get(`[data-address="${address}"] .label`).trigger('dblclick')
    return w.get(`[data-address="${address}"] .rename-input`)
  }

  it('commits a new name as a set on the name attribute', async () => {
    const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
    const input = await startRename(w, 'Button/Primary#container/icon')
    await input.setValue('glyph')
    await input.trigger('keydown', { key: 'Enter' })

    expect(w.emitted('patches')?.[0]).toEqual([
      [{ op: 'set', address: 'Button/Primary#container/icon', prop: 'name', value: 'glyph' }],
    ])
  })

  /**
   * Addresses are name paths, so the rename moves every address beneath it.
   * The shell needs both halves to remap selection and expansion; emitting only
   * the patch would leave the rail pointing at an address that no longer
   * exists the moment the file comes back.
   */
  it('reports the address it moved, so the shell can follow', async () => {
    const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
    const input = await startRename(w, 'Button/Primary#container')
    await input.setValue('box')
    await input.trigger('keydown', { key: 'Enter' })

    expect(w.emitted('rename')?.[0]).toEqual([
      'Button/Primary#container',
      'Button/Primary#box',
    ])
  })

  it('refuses a name a sibling already has, and writes nothing', async () => {
    const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
    const input = await startRename(w, 'Button/Primary#container/icon')
    await input.setValue('label')
    await input.trigger('keydown', { key: 'Enter' })

    expect(w.emitted('patches')).toBeUndefined()
    expect(w.get('[data-address="Button/Primary#container/icon"]').attributes('data-invalid')).toBe(
      'true',
    )
  })

  it('abandons the edit on escape', async () => {
    const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
    const input = await startRename(w, 'Button/Primary#container/icon')
    await input.setValue('glyph')
    await input.trigger('keydown', { key: 'Escape' })

    expect(w.emitted('patches')).toBeUndefined()
    expect(w.find('.rename-input').exists()).toBe(false)
  })

  it('does not offer a rename on the root page', async () => {
    const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
    await w.get('[data-address=""] .label').trigger('dblclick')
    expect(w.find('.rename-input').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/viewer test -- test/layers-pane.test.ts
```

Expected: FAIL — no `.rename-input`.

- [ ] **Step 3: Implement the inline editor**

In `LayersPane.vue`, add to the emits:

```ts
  rename: [oldAddress: string, newAddress: string]
```

and the state and handlers:

```ts
import { renameFor } from './layer-moves'

const editing = ref<string | null>(null)
const draft = ref('')
const invalid = ref<string | null>(null)

function startRename(row: LayerRow): void {
  // The root <Page>'s name is the frontmatter `id`, not a `name` attribute.
  if (row.address === '') return
  editing.value = row.address
  draft.value = row.name
  invalid.value = null
}

function commitRename(row: LayerRow): void {
  if (!props.doc) return
  const patch = renameFor(props.doc, row.address, draft.value)
  if (!patch) {
    // Refused before the write rather than after: the patcher would reject a
    // duplicate name too, but only once the edit had already left the rail.
    invalid.value = row.address
    return
  }

  const next = draft.value.trim()
  const parent = row.address.slice(0, row.address.length - row.name.length)
  editing.value = null
  invalid.value = null
  emit('patches', [patch])
  emit('rename', row.address, parent + next)
}

function cancelRename(): void {
  editing.value = null
  invalid.value = null
}

/**
 * `autofocus` is not reliable on an element inserted after load, and a rename
 * box you have to click into is not a rename box. Selecting the text too, so
 * that typing replaces the old name the way Figma does.
 */
function focusRename(vnode: { el: HTMLInputElement }): void {
  vnode.el.focus()
  vnode.el.select()
}
```

Replace the `.label` span in the template with:

```html
      <input
        v-if="editing === row.address"
        v-model="draft"
        class="rename-input"
        @vue:mounted="focusRename"
        @keydown.enter="commitRename(row)"
        @keydown.esc="cancelRename"
        @blur="cancelRename"
        @click.stop
      />
      <span v-else class="label" @click="emit('select', row.address)" @dblclick="startRename(row)">
        {{ row.name }}
      </span>
```

Add `:data-invalid="invalid === row.address ? 'true' : 'false'"` to the row
element, and the CSS:

```css
.rename-input {
  flex: 1;
  min-width: 0;
  height: calc(var(--row-h) - 6px);
  padding: 0 var(--gap-sm);
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--text);
  font: inherit;
  outline: none;
}
.row[data-invalid='true'] .rename-input {
  border-color: var(--danger);
}
```

- [ ] **Step 4: Follow the rename in the shell**

In `App.vue`, wire the new event:

```html
        <LayersPane
          :doc="doc"
          :selection="selection"
          @select="selection = [$event]"
          @patches="commitPatches"
          @rename="onRename"
        />
```

and add the handler, importing `remapAddress` from `./layer-moves`:

```ts
/**
 * A rename moves every address beneath the renamed node, and the selection is
 * held as addresses. Without this the rail and the canvas keep pointing at a
 * node that stopped existing the moment the file came back.
 */
function onRename(oldAddress: string, newAddress: string): void {
  selection.value = selection.value.map((a) => remapAddress(oldAddress, newAddress, a))
}
```

- [ ] **Step 5: Run and watch it pass**

```bash
PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/viewer test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/viewer
git commit -m "Rename a layer, and move the addresses it carries"
```

---

## Task 7: Drag to reorder and reparent

**Files:**
- Modify: `packages/viewer/src/LayersPane.vue`
- Modify: `packages/viewer/test/layers-pane.test.ts`

**Interfaces:**
- Consumes: `moveFor`, `DropInstruction` from Task 2.
- Produces: nothing new — drops emit through the existing `patches`.

- [ ] **Step 1: Spike — can `useLayerDrag` be used without mutating the graph?**

Read `useLayerDrag` in
`packages/viewer/node_modules/@open-pencil/vue/dist/index.js` (find it by
searching for `useLayerDrag`). The question is narrow: **does it apply the move
to the editor itself on drop, or does it only report `draggingId`,
`instruction` and `instructionTargetId` and leave the write to the caller?**

- If it only reports, use it: it gives hitboxes, `make-child` and autoscroll for
  free, and the editor must then be hoisted out of `CanvasPane.vue:36` into
  `App.vue` and provided there so both rails can inject it.
- If it mutates, **do not use it** — a graph mutation would produce exactly the
  double-write this design exists to avoid. Hand-roll the hitboxes per Step 3.

Record the answer in a comment at the top of the drag code, so the next reader
does not repeat the investigation.

Steps 2–4 below assume the hand-rolled path, because it is the one that needs
writing out. If the spike says `useLayerDrag` is usable, replace Step 3's
pointer maths with it and keep everything else — `moveFor`, the guards, the
emit — exactly as written.

- [ ] **Step 2: Write the failing tests**

Add to `packages/viewer/test/layers-pane.test.ts`:

```ts
describe('drag', () => {
  const drag = async (w: ReturnType<typeof mount>, from: string, to: string, offsetY: number) => {
    await w.get(`[data-address="${from}"]`).trigger('dragstart')
    const target = w.get(`[data-address="${to}"]`)
    // 24px rows: <6 is above, >18 is below, the middle band is into.
    Object.defineProperty(target.element, 'getBoundingClientRect', {
      value: () => ({ top: 0, height: 24 }),
    })
    await target.trigger('dragover', { clientY: offsetY })
    await target.trigger('drop')
  }

  it('reorders a sibling upward', async () => {
    const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
    await drag(w, 'Button/Primary#container/label', 'Button/Primary#container/icon', 2)
    expect(w.emitted('patches')?.[0]).toEqual([
      [
        {
          op: 'move-node',
          address: 'Button/Primary#container/label',
          newParent: 'Button/Primary#container',
          index: 0,
        },
      ],
    ])
  })

  it('writes nothing for a refused drop', async () => {
    const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
    // A container cannot be dropped into its own child.
    await drag(w, 'Button/Primary#container', 'Button/Primary#container/icon', 12)
    expect(w.emitted('patches')).toBeUndefined()
  })

  it('shows no drop indicator for a refused target', async () => {
    const w = mount(LayersPane, { props: { doc: DOC, selection: [] } })
    await w.get('[data-address="Button/Primary#container"]').trigger('dragstart')
    const target = w.get('[data-address="Button/Primary#container/icon"]')
    Object.defineProperty(target.element, 'getBoundingClientRect', {
      value: () => ({ top: 0, height: 24 }),
    })
    await target.trigger('dragover', { clientY: 12 })
    expect(target.attributes('data-drop')).toBe('none')
  })
})
```

- [ ] **Step 3: Implement the drag**

In `LayersPane.vue`, add:

```ts
import { moveFor, type DropInstruction } from './layer-moves'

const dragging = ref<string | null>(null)
const dropTarget = ref<string | null>(null)
const dropAt = ref<DropInstruction | 'none'>('none')

/**
 * Which third of the row the pointer is in.
 *
 * Figma's own bands: the outer sixths reorder, the middle reparents. Reading
 * geometry here rather than from a drag library keeps the whole gesture in one
 * place, and the only thing it produces is a `DropInstruction` — the patch is
 * still `moveFor`'s to decide.
 */
function bandFor(event: DragEvent, el: HTMLElement): DropInstruction {
  const box = el.getBoundingClientRect()
  const offset = event.clientY - box.top
  if (offset < box.height / 4) return 'above'
  if (offset > (box.height * 3) / 4) return 'below'
  return 'into'
}

function onDragOver(event: DragEvent, row: LayerRow): void {
  event.preventDefault()
  if (!props.doc || !dragging.value) return

  const instruction = bandFor(event, event.currentTarget as HTMLElement)
  const patch = moveFor(props.doc, dragging.value, row.address, instruction)
  dropTarget.value = row.address
  // A refused drop shows no indicator at all, so the author never sees an
  // affordance for something that will not happen.
  dropAt.value = patch ? instruction : 'none'
}

function onDrop(row: LayerRow): void {
  if (!props.doc || !dragging.value || dropAt.value === 'none') return reset()
  const patch = moveFor(props.doc, dragging.value, row.address, dropAt.value)
  if (patch) emit('patches', [patch])
  reset()
}

function reset(): void {
  dragging.value = null
  dropTarget.value = null
  dropAt.value = 'none'
}
```

On the row element add:

```
        draggable="true"
        :data-drop="dropTarget === row.address ? dropAt : 'none'"
        @dragstart="dragging = row.address"
        @dragover="onDragOver($event, row)"
        @drop.prevent="onDrop(row)"
        @dragend="reset"
```

and the indicator CSS:

```css
.row[data-drop='above'] {
  box-shadow: inset 0 1px 0 var(--accent);
}
.row[data-drop='below'] {
  box-shadow: inset 0 -1px 0 var(--accent);
}
.row[data-drop='into'] {
  background: var(--accent-dim);
  box-shadow: inset 0 0 0 1px var(--accent);
}
```

- [ ] **Step 4: Run and watch it pass**

```bash
PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/viewer test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/viewer
git commit -m "Drag a layer to reorder it, or into a new parent"
```

---

## Task 8: Drive the real app

**Files:** none — this is verification. Spike S1 established the render path
cannot be driven headlessly, so these are the behaviours no test above covers.

- [ ] **Step 1: Build and serve**

```bash
PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm build:cli
PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" node packages/cli/dist/uidx.js open examples/primary-button.uidx
```

- [ ] **Step 2: Check each behaviour, and the diff after each write**

Keep `git diff examples/primary-button.uidx` open in a second terminal.

- [ ] Click a row — the canvas selects that node.
- [ ] Click a node on the canvas — the rail highlights it and opens its ancestors.
- [ ] Collapse a row, then save the file in an editor — the collapse survives.
- [ ] Click the eye on `leading-icon` — it dims, the canvas hides it, and the diff is **one line**.
- [ ] Click the eye on a node with no `visible` attribute — the diff is **one added attribute**.
- [ ] Rename `container` to `box` — the diff is one line, the rail keeps the node selected, and the properties panel still shows its properties.
- [ ] Rename `label` to `leading-icon` — refused inline, red border, **no write**.
- [ ] Drag `label` above `leading-icon` — the diff is one moved element and **one write**.
- [ ] Drag `container` onto its own child — no indicator appears, and nothing is written.
- [ ] Compare the rail and the top bar against the reference screenshot; adjust `theme.css` only.

- [ ] **Step 3: Commit any token adjustments**

```bash
git add packages/viewer/src/theme.css
git commit -m "Tune the chrome against the reference"
```

---

## Task 9: Make the documents describe the repo again

**Files:**
- Modify: `README.md`
- Modify: `docs/backlog.md`
- Modify: `docs/superpowers/plans/2026-08-17-properties-panel-c6.md`

- [ ] **Step 1: Update the README**

The viewer is no longer "three-pane ... intent, canvas and properties". In the
package table, `@uidx/viewer`'s description becomes the layers/canvas/inspector
shell, and the sentence about the intent pane goes. Note that the intent region
is still parsed and still never written — it is simply not displayed.

- [ ] **Step 2: Update the backlog**

Add the seven rows the spec's "Effect on the plan" table names:

- **B3** — mark superseded, pointing at the spec.
- **D3** — mark done, noting it landed document-native, so the
  `node:reparented` / `node:reordered` coalescing watch-item is moot and can be
  struck.
- **Rename** — record that it landed in the layers rail rather than Epic D.
- **C6** — unchanged, still next, with its plan linked.
- **C7** — unchanged.
- **D1**, **D2** — unchanged, still not started.
- **F3** — add the note that an `<Instance>`'s generated children will need
  adding to the tree as read-only rows, since the document-native tree cannot
  see them.

- [ ] **Step 3: Amend the C6 plan**

Add a short "Amendments from the Figma chrome work" section to
`2026-08-17-properties-panel-c6.md` recording the two changes the spec names:

1. The outline is already gone from `PropertiesPane.vue` — the C6 plan's task
   that touches it should expect a pane containing only the editor.
2. All new markup uses `theme.css` tokens; no component defines a colour.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/backlog.md docs/superpowers/plans/2026-08-17-properties-panel-c6.md
git commit -m "Update the docs for a viewer with a layers rail"
```

---

## Task 10: Sweep the residual raw hex into tokens

**Added during execution.** The plan's Global Constraints say "no raw hex in
any component", but Tasks 1–9 only ever asked for that of *new* CSS. Task 3's
review found 29 raw values surviving in components it touched — banners, error
overlays, token-binding highlights, status chips — none of which any task
closed. The constraint is only worth having if something enforces it.

**Runs after Task 7 and before Task 8**, deliberately: Task 4 deletes the
outline block from `PropertiesPane.vue`, so sweeping earlier would tokenise
colours about to be deleted, and Task 8's visual calibration should see the
final state.

**Files:**
- Modify: `packages/viewer/src/theme.css`
- Modify: `packages/viewer/src/App.vue`, `CanvasPane.vue`, `ErrorBoundary.vue`, `PropertiesPane.vue`

No test: appearance only, same reasoning as Task 3.

- [ ] **Step 1: Find what is actually left**

Task 4 and the C6 work delete some of these, so re-derive the list rather than
trusting the one below:

```bash
grep -nE "#[0-9a-fA-F]{3,8}\b|rgba?\(" packages/viewer/src/*.vue
```

At the time of writing the survivors were: `App.vue` banner amber/red pairs;
`CanvasPane.vue` bound-value purple, error red, dim grey, warning amber and its
two `rgba` scrims; `ErrorBoundary.vue` error red and a border grey;
`PropertiesPane.vue` amber, bound-value purple, selection blue and its `rgba`
tint, and the three status-chip colour pairs.

- [ ] **Step 2: Add the tokens the sweep needs**

`theme.css` already carries `--accent`, `--danger`, `--warn` and `--ok`. Three
roles have no token yet. Add them beside the existing colour block, keeping the
comment style of the file:

```css
  /* A value that comes from a design token rather than a literal. */
  --bound: #c08bff;
  /* Scrim behind an overlay that must stay readable over the canvas. */
  --overlay: rgba(12, 14, 18, 0.9);
  /* Tinted row background for a selected or bound row. */
  --accent-tint: #0d99ff10;
```

Do not invent tokens beyond what the sweep consumes. If a colour maps cleanly
onto an existing token, use the existing one.

- [ ] **Step 3: Replace every literal with its token**

Map by role, not by hue — two colours that merely look similar may mean
different things:

| Literal | Token |
|---|---|
| `#ffb4b4`, `#ff8b8b`, `#6f3030` | `--danger` |
| `#ffd98a`, `#d8b25a`, `#ffc46a`, `#3a2f16`, `#6b5a2a`, `#fff0d4` | `--warn` |
| `#7ee08a`, `#2f6f45` | `--ok` |
| `#6fb5ff` | `--accent` |
| `rgba(111, 181, 255, 0.06)` | `--accent-tint` |
| `#c08bff`, `#a78bfa` | `--bound` |
| `rgba(12, 14, 18, 0.86)`, `rgba(12, 14, 18, 0.94)` | `--overlay` |
| `#8b94a3` | `--text-faint` |
| `#3b434f` | `--line` |
| `#3a1c1c` | `--danger` at low alpha — use `color-mix(in srgb, var(--danger) 18%, transparent)` |

Where a literal was a *background* and its token is a foreground colour (the
banner backgrounds `#3a2f16` and `#3a1c1c`), use `color-mix` against the token
rather than inventing a second hex — one source of truth per hue.

- [ ] **Step 4: Verify nothing is left and nothing broke**

```bash
grep -nE "#[0-9a-fA-F]{3,8}\b|rgba?\(" packages/viewer/src/*.vue && echo "STILL RAW" || echo "clean"
PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/viewer test
```

Expected: the grep prints `clean`; the suite passes. `theme.css` is not a
component and keeps its hex values — the grep above deliberately covers `*.vue`
only.

- [ ] **Step 5: Commit**

```bash
git add packages/viewer/src
git commit -m "Put every colour in the token layer"
```
