# C6 — Properties panel structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the properties panel from a flat, guessed-control list into a
structured inspector — grouped into Figma-style sections, with real enum
controls and paired X/Y and W/H rows — generated from a new property-metadata
table in `@uidx/schema`, with no change to what any edit writes to the file.

**Architecture:** A new pure-data module, `packages/schema/src/prop-ui.ts`,
carries grouping, applicability, control kind, enum domains and pairing for
every property the prop table maps — the vocabulary's other home, alongside
`prop-table.ts` and `docs/property-vocabulary.md`. `packages/viewer/src/editable.ts`
stays the pure layer that turns a `UidxNode` plus this table into what the
panel renders (sections, paired fields, enum options) — testable without Vue
or a canvas. `PropertiesPane.vue` gets thinner: it stops guessing control kinds
and instead lays out what `editable.ts` already decided, using
`@open-pencil/vue`'s headless section/grid/segmented-control primitives. A new
`PropertyField.vue` factors the one piece of per-field markup (number scrub,
checkbox, text input, enum control, or read-only span) so it isn't repeated for
solo and paired fields.

**Tech Stack:** TypeScript, Vue 3 `<script setup>`, `@open-pencil/vue` headless
primitives (`PropertySectionRoot/Header/Content`, `PropertyGridRoot`,
`SegmentedControlRoot/Item`, `NumberFieldRoot` — already in use), Vitest,
`@vue/test-utils`.

**Spec:** [docs/properties-panel.md](../../properties-panel.md) — this plan
implements the **C6** story only (§"C6 — an inspector with structure"). **C7**
("unset properties") is out of scope: the spec itself says C7 "is only
reachable once unset geometry can be set" and frames C6 as "independently
shippable and independently reviewable." A follow-up plan covers C7 once this
lands. Backlog entry: [docs/backlog.md](../../backlog.md) §"C6 / C7. The panel
becomes a real inspector."

## Amendments from the Figma chrome work

The 2026-08-19 Figma viewer chrome work (see
[the spec](../specs/2026-08-19-figma-viewer-chrome-design.md)) landed the
layers rail and the visual system before this plan was executed, and changes
two things this plan assumed:

1. **The outline is already gone from `PropertiesPane.vue`.** The layer tree
   it used to flatten under the comment *"so the outline still reads like a
   layers panel"* now lives in `LayersPane.vue` on the left. Task 3's markup
   for `PropertiesPane.vue` should expect a pane that contains only the
   editor — no `Outline` heading, no flattened-tree list, and no test
   asserting one renders whether or not anything is selected.
2. **All new markup uses `theme.css` tokens; no component defines a colour.**
   `packages/viewer/src/theme.css` now holds every colour and metric in the
   viewer. Task 3's styling should read from its tokens (`var(--accent)`,
   `var(--bound)`, spacing and radius tokens, and so on) rather than the
   plan's own literal values, the same way the rest of the viewer already
   does.

## Global Constraints

- **The metadata goes in `@uidx/schema`, not the viewer** (spec, "The core
  problem"). `packages/viewer/src/editable.ts` reads grouping/control/enum data
  from `@uidx/schema`; it must never keep its own copy of a property list.
- **Two drift tests are mandatory** for the new table (spec, "The core
  problem"): (1) every `PROP_UI` key is a real prop (`IDENTITY_PROPS` or
  `PROP_TABLE`); (2) every prop the schema maps has a `PROP_UI` entry *or* an
  explicit opt-out in `PROP_UI_OPT_OUT` — so a newly added mapped prop that
  nobody assigned a group to fails the build rather than silently not
  appearing in the panel.
- **Enum domains come from `@open-pencil/scene-graph`'s own type aliases, not
  from memory** (spec, "Enum domains"). Every option list in this plan was
  read directly from `@open-pencil/scene-graph@0.14.0`'s `types2.d.ts`, not
  copied from the spec's own table blind — see Task 1 for the verified values.
- **`primaryAxisSizingMode` / `counterAxisSizingMode` must not offer `FILL`**
  (spec, "`LayoutSizing` is `FIXED | HUG | FILL`..."; ADR 0002; A2). Options
  are exactly `['FIXED', 'AUTO']`.
- **No change to what gets written.** C6 touches only what the panel *shows*
  and what control renders a field — never `fromSceneChange`, `to-scene.ts`,
  or the patch-emission shape. Every `commit`/`preview` event this plan's code
  emits has the same `(address, prop, value)` shape C5 already emits.
- **Test split** (spec, "How this gets verified"): pure grouping/applicability
  logic is unit-tested in `@uidx/schema` and in `packages/viewer/src/editable.ts`
  (no Vue, no canvas); section/enum/pairing *rendering* is component-tested
  with `@vue/test-utils` (no canvas — the SDK's canvas surface cannot be
  tested headlessly, per spike S1); anything neither covers is verified by
  hand in the running app (Task 4).
- **Package manager / versions**: `pnpm@9.12.2`, Node `>=20.19` (root
  `package.json`). Run package-scoped commands as `pnpm --filter <pkg> <script>
  [-- args]`.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `packages/schema/src/prop-ui.ts` | **new** | `PropGroup`, `PropUi`, the `PROP_UI` table, `PROP_UI_OPT_OUT`, `SECTION_ORDER`, `SECTION_LABEL`, `SEGMENTED_MAX_OPTIONS`, `propUiFor` |
| `packages/schema/src/index.ts` | modify | re-export the above |
| `packages/schema/test/prop-ui.test.ts` | **new** | the two drift tests, enum-domain and pairing/applicability checks |
| `packages/viewer/src/editable.ts` | rewrite | `EditableProp` gains `group`/`control`/`options`; new `sectionsFor`, `parentOf`; `isMapped`/`selectedNode` unchanged |
| `packages/viewer/test/editable.test.ts` | extend | grouping, pairing, applicability, parent-gated Layout child section |
| `packages/viewer/src/PropertyField.vue` | **new** | one field's markup: bound-token row, number scrub, checkbox, text input, enum (segmented or select), read-only row |
| `packages/viewer/src/PropertiesPane.vue` | rewrite (template only; props/emits unchanged) | lays out sections via `PropertySectionRoot`, paired rows via `PropertyGridRoot`, remembers open/closed per section across re-selection |
| `packages/viewer/test/properties-pane.test.ts` | extend | sections render/collapse/remember, enum exact-options, `<Rectangle>` has no Typography section, X/Y pair on one row |
| `docs/backlog.md` | modify (Task 4) | flip C6's status once verified |

`App.vue`'s use of `PropertiesPane` (`:doc :selection :tokens :writable` /
`@preview @commit`) does not change — confirmed by reading
`packages/viewer/src/App.vue:164-171`.

---

## Task 1: `prop-ui.ts` — the property metadata table

**Files:**
- Create: `packages/schema/src/prop-ui.ts`
- Create: `packages/schema/test/prop-ui.test.ts`
- Modify: `packages/schema/src/index.ts`

**Interfaces:**
- Consumes: `IDENTITY_PROPS`, `PROP_TABLE` from `packages/schema/src/prop-table.ts` (existing); `SceneElement` from `@uidx/format` (existing).
- Produces (for Task 2 and beyond):
  - `type PropGroup = 'position' | 'layout' | 'layout-child' | 'appearance' | 'fill' | 'stroke' | 'text' | 'effects'`
  - `interface PropUi { group: PropGroup; appliesTo?: readonly SceneElement[]; control: 'number' | 'boolean' | 'enum' | 'text' | 'opaque'; options?: readonly string[]; min?: number; max?: number; step?: number; pairs?: string }` (no `fallback` field yet — C7's concern; C6 never renders an unset row)
  - `PROP_UI: Record<string, PropUi>` — one entry per mapped prop except `name`
  - `PROP_UI_OPT_OUT: ReadonlySet<string>` — `{'name'}`
  - `SECTION_ORDER: readonly PropGroup[]` — the 8 groups, in spec order
  - `SECTION_LABEL: Record<PropGroup, string>`
  - `SEGMENTED_MAX_OPTIONS: number` — `4`
  - `propUiFor(name: string): PropUi | undefined`

- [ ] **Step 1: Write the failing test file**

Create `packages/schema/test/prop-ui.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  IDENTITY_PROPS,
  PROP_TABLE,
  PROP_UI,
  PROP_UI_OPT_OUT,
  SECTION_LABEL,
  SECTION_ORDER,
  propUiFor,
} from '../src/index.js'

/**
 * `prop-ui.ts` is the second home of the vocabulary the spec asks for
 * (docs/properties-panel.md, "The core problem"). These are its two drift
 * tests: every key here names a real prop, and every real prop is covered
 * here or opted out explicitly.
 */
describe('PROP_UI', () => {
  const KNOWN = new Set([...IDENTITY_PROPS, ...PROP_TABLE.map((m) => m.uidx)])

  it('every key names a prop the schema actually maps', () => {
    for (const key of Object.keys(PROP_UI)) {
      expect(KNOWN.has(key), `PROP_UI has an entry for unknown prop "${key}"`).toBe(true)
    }
  })

  it('every mapped prop has an entry or an explicit opt-out', () => {
    for (const prop of KNOWN) {
      const covered = prop in PROP_UI || PROP_UI_OPT_OUT.has(prop)
      expect(covered, `"${prop}" has neither a PROP_UI entry nor an opt-out`).toBe(true)
    }
  })

  it('opted-out props are not also entries', () => {
    for (const prop of PROP_UI_OPT_OUT) {
      expect(PROP_UI[prop], `"${prop}" is both an entry and an opt-out`).toBeUndefined()
    }
  })

  it('name is the only opt-out — renaming is a structural op (Epic D), not a property edit', () => {
    expect([...PROP_UI_OPT_OUT]).toEqual(['name'])
  })

  it('every entry belongs to a group SECTION_ORDER knows, with a label', () => {
    for (const [prop, ui] of Object.entries(PROP_UI)) {
      expect(SECTION_ORDER, `"${prop}"'s group is not in SECTION_ORDER`).toContain(ui.group)
      expect(SECTION_LABEL[ui.group], `no label for group "${ui.group}"`).toBeTruthy()
    }
  })

  it('pairs point at a sibling that points back', () => {
    for (const [prop, ui] of Object.entries(PROP_UI)) {
      if (!ui.pairs) continue
      const partner = PROP_UI[ui.pairs]
      expect(partner, `"${prop}" pairs with unknown prop "${ui.pairs}"`).toBeDefined()
      expect(partner?.pairs, `"${prop}"/"${ui.pairs}" pairing is not mutual`).toBe(prop)
    }
  })

  it('layoutMode offers exactly the engine four, and nothing lets you type a fifth', () => {
    expect(propUiFor('layoutMode')).toMatchObject({
      control: 'enum',
      options: ['NONE', 'HORIZONTAL', 'VERTICAL', 'GRID'],
    })
  })

  it('sizing modes do not offer FILL — the format cannot write it yet (ADR 0002, A2)', () => {
    expect(propUiFor('primaryAxisSizingMode')?.options).toEqual(['FIXED', 'AUTO'])
    expect(propUiFor('counterAxisSizingMode')?.options).toEqual(['FIXED', 'AUTO'])
  })

  it('typography applies to Text only', () => {
    for (const [prop, ui] of Object.entries(PROP_UI)) {
      if (ui.group === 'text') expect(ui.appliesTo, prop).toEqual(['Text'])
    }
  })

  it('auto layout applies only to Frame and Component', () => {
    for (const [prop, ui] of Object.entries(PROP_UI)) {
      if (ui.group === 'layout') expect(ui.appliesTo, prop).toEqual(['Frame', 'Component'])
    }
  })

  it('layout child names no appliesTo — applicability is the parent laying out children, not the element', () => {
    for (const [prop, ui] of Object.entries(PROP_UI)) {
      if (ui.group === 'layout-child') expect(ui.appliesTo, prop).toBeUndefined()
    }
  })

  it('every enum entry actually carries options', () => {
    for (const [prop, ui] of Object.entries(PROP_UI)) {
      if (ui.control === 'enum') expect(ui.options?.length, prop).toBeGreaterThan(0)
    }
  })

  it('x/y and width/height are the only paired props, per the spec table', () => {
    const paired = Object.entries(PROP_UI)
      .filter(([, ui]) => ui.pairs)
      .map(([name]) => name)
      .sort()
    expect(paired).toEqual(['height', 'width', 'x', 'y'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @uidx/schema test test/prop-ui.test.ts`
Expected: FAIL — `../src/index.js` has no export `PROP_UI` (etc.); the file
does not compile.

- [ ] **Step 3: Write `packages/schema/src/prop-ui.ts`**

```ts
import type { SceneElement } from '@uidx/format'

/**
 * Where a property sits in the panel, and what control shows it.
 *
 * The panel is meant to be *generated from* the prop table (spec,
 * "The core problem"), which is why this lives beside `prop-table.ts` rather
 * than in `@uidx/viewer`: a second copy of this list in the viewer would
 * drift from the schema package the first time a property is added, and the
 * drift would be silent.
 */
export type PropGroup =
  | 'position'
  | 'layout'
  | 'layout-child'
  | 'appearance'
  | 'fill'
  | 'stroke'
  | 'text'
  | 'effects'

export interface PropUi {
  group: PropGroup
  /** Elements this applies to. Omitted means every scene element. */
  appliesTo?: readonly SceneElement[]
  control: 'number' | 'boolean' | 'enum' | 'text' | 'opaque'
  /** Legal values, for `enum`. */
  options?: readonly string[]
  min?: number
  max?: number
  /** Scrub and arrow-key granularity, for `number`. @default 1 */
  step?: number
  /** Renders on one row with this sibling — x/y, width/height. Mutual. */
  pairs?: string
}

export const SECTION_ORDER: readonly PropGroup[] = [
  'position',
  'layout',
  'layout-child',
  'appearance',
  'fill',
  'stroke',
  'text',
  'effects',
]

export const SECTION_LABEL: Record<PropGroup, string> = {
  position: 'Position',
  layout: 'Auto layout',
  'layout-child': 'Layout child',
  appearance: 'Appearance',
  fill: 'Fill',
  stroke: 'Stroke',
  text: 'Typography',
  effects: 'Effects',
}

/**
 * `SegmentedControlRoot` for a short enum, a `<select>` for a long one. The
 * threshold matches the spec's own two examples: alignment/sizing/wrap enums
 * (<=4 options) are segmented; `blendMode` (17) and `fontWeight` (9) are not.
 */
export const SEGMENTED_MAX_OPTIONS = 4

/**
 * Props the schema maps but the panel deliberately never shows: `name` is a
 * node's address component, and renaming it moves every address below it —
 * a structural operation (Epic D), not a property edit. Every other mapped
 * prop must have a `PROP_UI` entry; `prop-ui.test.ts` enforces this.
 */
export const PROP_UI_OPT_OUT: ReadonlySet<string> = new Set(['name'])

const FRAME_OR_COMPONENT: readonly SceneElement[] = ['Frame', 'Component']
const TEXT_ONLY: readonly SceneElement[] = ['Text']

export const PROP_UI: Record<string, PropUi> = {
  // --- position ------------------------------------------------------------
  x: { group: 'position', control: 'number', step: 1, pairs: 'y' },
  y: { group: 'position', control: 'number', step: 1, pairs: 'x' },
  width: { group: 'position', control: 'number', step: 1, pairs: 'height' },
  height: { group: 'position', control: 'number', step: 1, pairs: 'width' },
  minWidth: { group: 'position', control: 'number', step: 1 },
  maxWidth: { group: 'position', control: 'number', step: 1 },
  minHeight: { group: 'position', control: 'number', step: 1 },
  maxHeight: { group: 'position', control: 'number', step: 1 },
  rotation: { group: 'position', control: 'number', step: 1 },
  // A compound {horizontal, vertical} anchor pair. Read-only in C5 (an
  // object has no control there either) and stays that way — a two-select
  // constraints editor is not part of this story.
  constraints: { group: 'position', control: 'opaque' },
  // Vector/ellipse-only geometry. Neither doc section names them (see the
  // spec's "Sections and order" — Vector never gets one); grouped with the
  // rest of a node's geometry rather than left out of every section.
  vectorPaths: { group: 'position', control: 'opaque', appliesTo: ['Vector'] },
  arcData: { group: 'position', control: 'opaque', appliesTo: ['Ellipse'] },

  // --- auto layout (Frame, Component) --------------------------------------
  layoutMode: {
    group: 'layout',
    control: 'enum',
    options: ['NONE', 'HORIZONTAL', 'VERTICAL', 'GRID'],
    appliesTo: FRAME_OR_COMPONENT,
  },
  layoutWrap: {
    group: 'layout',
    control: 'enum',
    options: ['NO_WRAP', 'WRAP'],
    appliesTo: FRAME_OR_COMPONENT,
  },
  // Figma spells these AUTO/FIXED; SceneNode's own domain is FIXED/HUG/FILL.
  // FILL is excluded: the format cannot write it yet (ADR 0002, A2).
  primaryAxisSizingMode: {
    group: 'layout',
    control: 'enum',
    options: ['FIXED', 'AUTO'],
    appliesTo: FRAME_OR_COMPONENT,
  },
  counterAxisSizingMode: {
    group: 'layout',
    control: 'enum',
    options: ['FIXED', 'AUTO'],
    appliesTo: FRAME_OR_COMPONENT,
  },
  primaryAxisAlignItems: {
    group: 'layout',
    control: 'enum',
    options: ['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN'],
    appliesTo: FRAME_OR_COMPONENT,
  },
  counterAxisAlignItems: {
    group: 'layout',
    control: 'enum',
    options: ['MIN', 'CENTER', 'MAX', 'STRETCH', 'BASELINE'],
    appliesTo: FRAME_OR_COMPONENT,
  },
  // Not named in the doc's Auto layout bullet; it is that section's own
  // "wrap alignment" (only meaningful when layoutWrap is WRAP), so it groups
  // with the rest of auto layout rather than sitting in no section at all.
  counterAxisAlignContent: {
    group: 'layout',
    control: 'enum',
    options: ['AUTO', 'SPACE_BETWEEN'],
    appliesTo: FRAME_OR_COMPONENT,
  },
  itemSpacing: { group: 'layout', control: 'number', step: 1, appliesTo: FRAME_OR_COMPONENT },
  counterAxisSpacing: {
    group: 'layout',
    control: 'number',
    step: 1,
    appliesTo: FRAME_OR_COMPONENT,
  },
  // z-order of overlapping auto-layout children — an auto-layout-only
  // concern the doc's bullet omits; same reasoning as counterAxisAlignContent.
  itemReverseZIndex: { group: 'layout', control: 'boolean', appliesTo: FRAME_OR_COMPONENT },
  paddingLeft: { group: 'layout', control: 'number', step: 1, appliesTo: FRAME_OR_COMPONENT },
  paddingRight: { group: 'layout', control: 'number', step: 1, appliesTo: FRAME_OR_COMPONENT },
  paddingTop: { group: 'layout', control: 'number', step: 1, appliesTo: FRAME_OR_COMPONENT },
  paddingBottom: { group: 'layout', control: 'number', step: 1, appliesTo: FRAME_OR_COMPONENT },
  clipsContent: { group: 'layout', control: 'boolean', appliesTo: FRAME_OR_COMPONENT },

  // --- layout child ----------------------------------------------------------
  // No `appliesTo`: any element can sit inside an auto-layout parent. The
  // section itself is gated on the *parent's* layoutMode, which this table
  // cannot see — @uidx/viewer's `sectionsFor` does that check.
  layoutPositioning: { group: 'layout-child', control: 'enum', options: ['AUTO', 'ABSOLUTE'] },
  layoutGrow: { group: 'layout-child', control: 'number', step: 1 },
  // Figma calls this layoutAlign on the child; SceneNode spells it
  // layoutAlignSelf (prop-table.ts's `rename`). Not named in the doc's
  // bullet; it is exactly this section's third child-participation prop.
  layoutAlign: {
    group: 'layout-child',
    control: 'enum',
    options: ['AUTO', 'MIN', 'CENTER', 'MAX', 'STRETCH', 'BASELINE'],
  },

  // --- appearance ------------------------------------------------------------
  opacity: { group: 'appearance', control: 'number', step: 0.01, min: 0, max: 1 },
  visible: { group: 'appearance', control: 'boolean' },
  locked: { group: 'appearance', control: 'boolean' },
  blendMode: {
    group: 'appearance',
    control: 'enum',
    options: [
      'NORMAL',
      'DARKEN',
      'MULTIPLY',
      'COLOR_BURN',
      'LIGHTEN',
      'SCREEN',
      'COLOR_DODGE',
      'OVERLAY',
      'SOFT_LIGHT',
      'HARD_LIGHT',
      'DIFFERENCE',
      'EXCLUSION',
      'HUE',
      'SATURATION',
      'COLOR',
      'LUMINOSITY',
      'PASS_THROUGH',
    ],
  },
  cornerRadius: { group: 'appearance', control: 'number', step: 1 },
  topLeftRadius: { group: 'appearance', control: 'number', step: 1 },
  topRightRadius: { group: 'appearance', control: 'number', step: 1 },
  bottomRightRadius: { group: 'appearance', control: 'number', step: 1 },
  bottomLeftRadius: { group: 'appearance', control: 'number', step: 1 },
  cornerSmoothing: { group: 'appearance', control: 'number', step: 0.01, min: 0, max: 1 },
  // Neither doc section names masking. It is an appearance-level toggle in
  // Figma's own model, so it groups with the rest of this section.
  isMask: { group: 'appearance', control: 'boolean' },
  maskType: { group: 'appearance', control: 'enum', options: ['ALPHA', 'VECTOR', 'LUMINANCE'] },

  // --- fill --------------------------------------------------------------
  fills: { group: 'fill', control: 'opaque' },

  // --- stroke --------------------------------------------------------------
  strokes: { group: 'stroke', control: 'opaque' },
  strokeWeight: { group: 'stroke', control: 'number', step: 1 },
  strokeAlign: { group: 'stroke', control: 'enum', options: ['INSIDE', 'CENTER', 'OUTSIDE'] },
  strokeCap: {
    group: 'stroke',
    control: 'enum',
    options: ['NONE', 'ROUND', 'SQUARE', 'ARROW_LINES', 'ARROW_EQUILATERAL'],
  },
  strokeJoin: { group: 'stroke', control: 'enum', options: ['MITER', 'BEVEL', 'ROUND'] },
  strokeMiterLimit: { group: 'stroke', control: 'number', step: 0.01 },
  dashPattern: { group: 'stroke', control: 'opaque' },
  strokesIncludedInLayout: { group: 'stroke', control: 'boolean' },
  // Independent per-side weights; overlap `strokeWeight` last-writer-wins
  // (prop-table.ts). Not named in the doc's Stroke bullet, grouped with it.
  strokeTopWeight: { group: 'stroke', control: 'number', step: 1 },
  strokeRightWeight: { group: 'stroke', control: 'number', step: 1 },
  strokeBottomWeight: { group: 'stroke', control: 'number', step: 1 },
  strokeLeftWeight: { group: 'stroke', control: 'number', step: 1 },

  // --- typography (Text only) -----------------------------------------------
  characters: { group: 'text', control: 'text', appliesTo: TEXT_ONLY },
  fontSize: { group: 'text', control: 'number', step: 1, appliesTo: TEXT_ONLY },
  // Open-ended family name — no closed domain, so free text rather than enum.
  fontFamily: { group: 'text', control: 'text', appliesTo: TEXT_ONLY },
  fontWeight: {
    group: 'text',
    control: 'enum',
    options: [
      'THIN',
      'EXTRA_LIGHT',
      'LIGHT',
      'REGULAR',
      'MEDIUM',
      'SEMI_BOLD',
      'BOLD',
      'EXTRA_BOLD',
      'BLACK',
    ],
    appliesTo: TEXT_ONLY,
  },
  italic: { group: 'text', control: 'boolean', appliesTo: TEXT_ONLY },
  textAutoResize: {
    group: 'text',
    control: 'enum',
    options: ['NONE', 'HEIGHT', 'WIDTH_AND_HEIGHT', 'TRUNCATE'],
    appliesTo: TEXT_ONLY,
  },
  textAlignHorizontal: {
    group: 'text',
    control: 'enum',
    options: ['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'],
    appliesTo: TEXT_ONLY,
  },
  textAlignVertical: {
    group: 'text',
    control: 'enum',
    options: ['TOP', 'CENTER', 'BOTTOM'],
    appliesTo: TEXT_ONLY,
  },
  textCase: {
    group: 'text',
    control: 'enum',
    options: ['ORIGINAL', 'UPPER', 'LOWER', 'TITLE'],
    appliesTo: TEXT_ONLY,
  },
  textDecoration: {
    group: 'text',
    control: 'enum',
    options: ['NONE', 'UNDERLINE', 'STRIKETHROUGH'],
    appliesTo: TEXT_ONLY,
  },
  letterSpacing: { group: 'text', control: 'number', step: 1, appliesTo: TEXT_ONLY },
  lineHeight: { group: 'text', control: 'number', step: 1, appliesTo: TEXT_ONLY },
  maxLines: { group: 'text', control: 'number', step: 1, appliesTo: TEXT_ONLY },
  // Not in the spec's Enum domains table; confirmed against
  // `@open-pencil/scene-graph@0.14.0`'s `SceneNode.textTruncation` directly.
  textTruncation: {
    group: 'text',
    control: 'enum',
    options: ['DISABLED', 'ENDING'],
    appliesTo: TEXT_ONLY,
  },

  // --- effects -------------------------------------------------------------
  effects: { group: 'effects', control: 'opaque' },
}

export function propUiFor(name: string): PropUi | undefined {
  return PROP_UI[name]
}
```

This table has exactly 70 entries (71 `KNOWN_PROPS` minus the one opt-out,
`name`) — count position(12) + layout(15) + layout-child(3) + appearance(12) +
fill(1) + stroke(12) + text(14) + effects(1) = 70.

- [ ] **Step 4: Export from `packages/schema/src/index.ts`**

Add, after the existing `prop-table.js` export block:

```ts
export {
  PROP_UI,
  PROP_UI_OPT_OUT,
  SECTION_LABEL,
  SECTION_ORDER,
  SEGMENTED_MAX_OPTIONS,
  propUiFor,
  type PropGroup,
  type PropUi,
} from './prop-ui.js'
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @uidx/schema test test/prop-ui.test.ts`
Expected: PASS, all 13 tests.

- [ ] **Step 6: Run the schema package's full test suite and typecheck**

Run: `pnpm --filter @uidx/schema test && pnpm --filter @uidx/schema typecheck`
Expected: PASS — `known-props.test.ts` and every other existing schema test
are untouched by this change (nothing here alters `PROP_TABLE`, `IDENTITY_PROPS`
or `KNOWN_PROPS`).

- [ ] **Step 7: Commit**

```bash
git add packages/schema/src/prop-ui.ts packages/schema/src/index.ts packages/schema/test/prop-ui.test.ts
git commit -m "$(cat <<'EOF'
Give the prop table a UI vocabulary (C6)

prop-ui.ts groups every mapped property into the eight sections Figma
uses, with applicability, control kind, enum domains and pairing. Two
drift tests keep it honest as the vocabulary grows. Nothing consumes
it yet — that's the viewer's editable.ts, next.
EOF
)"
```

---

## Task 2: `editable.ts` — sections, pairing and applicability

**Files:**
- Modify: `packages/viewer/src/editable.ts`
- Modify: `packages/viewer/test/editable.test.ts`

**Interfaces:**
- Consumes: `PROP_UI`, `PROP_UI_OPT_OUT`, `SECTION_LABEL`, `SECTION_ORDER`, `propUiFor`, `type PropGroup` from `@uidx/schema` (Task 1); `isIdentityProp`, `mappingFor` from `@uidx/schema` (existing); `aliasTarget`, `isAlias`, `METADATA_ATTRS`, `type JsonValue`, `type UidxNode` from `@uidx/format` (existing).
- Produces (for Task 3):
  - `type ControlKind = 'number' | 'boolean' | 'enum' | 'text' | 'readonly'`
  - `interface EditableProp { name: string; group: PropGroup | null; control: ControlKind; options: readonly string[] | null; value: JsonValue; raw: string; boundTo: string | null; readonlyReason: string | null }` — `group: null` marks a prop the prop table does not know (was `readonlyReason: 'not in the prop table...'` before; still is, plus `group` now tells the caller it can't be sectioned). This task's own code additionally carries a temporary `kind` field duplicating `control`, solely so `PropertiesPane.vue` (unmodified until Task 3) still compiles against this file mid-plan — Task 3 Step 1 removes it. Treat `control` as the real field; do not build against `kind`.
  - `interface PairedField { field: EditableProp; pairedWith: EditableProp | null }`
  - `interface PropSection { group: PropGroup; label: string; fields: PairedField[] }`
  - `isMapped(name: string): boolean` — unchanged signature and behavior
  - `editableProps(node: UidxNode): EditableProp[]` — same authored-order, name/metadata-filtering contract as before; `kind` renamed `control`, gains `group`/`options`
  - `sectionsFor(node: UidxNode, fields: readonly EditableProp[], parent: UidxNode | null): PropSection[]`
  - `parentOf(root: UidxNode, address: string): UidxNode | null`
  - `selectedNode(root: UidxNode | null, selection: readonly string[]): UidxNode | null` — unchanged

**Note:** after this task, `PropertiesPane.vue` will not compile — it still
calls the pre-C6 `editable.ts` shape (`field.kind`, no `sectionsFor`). That is
expected; Task 3 migrates it. Do not touch `PropertiesPane.vue` in this task.

- [ ] **Step 1: Write the failing tests**

Replace `packages/viewer/test/editable.test.ts` with (existing `selectedNode`
describe block and its four tests are unchanged from the current file — kept
verbatim below for completeness since this step replaces the whole file):

```ts
import { describe, expect, it } from 'vitest'
import { parseOrThrow, type UidxNode } from '@uidx/format'
import { editableProps, isMapped, parentOf, sectionsFor, selectedNode } from '../src/editable'

const PAGE = parseOrThrow(`---
id: fields
---

## Visual Contract

<Page>
  <Component name="Card" status="stable" version="2">
    <Frame name="root" cornerRadius="{radius#md}" opacity={0.5} visible={true}
      clipsContent={false} layoutMode="VERTICAL" notAThing={3}
      x={10} y={20} width={120} height={40}
      fills={[{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }]}>
      <Text name="label" characters="Hi" fontSize={14} />
      <Rectangle name="swatch" layoutPositioning="AUTO" x={5} />
    </Frame>
  </Component>
</Page>
`)

const node = (address: string): UidxNode => selectedNode(PAGE.tree, [address])!
const field = (address: string, name: string) =>
  editableProps(node(address)).find((f) => f.name === name)!

describe('selectedNode', () => {
  it('finds a node by address', () => {
    expect(node('Card#root').name).toBe('root')
    expect(node('Card#root/label').element).toBe('Text')
  })

  it('edits nothing when several nodes are selected', () => {
    expect(selectedNode(PAGE.tree, ['Card#root', 'Card#root/label'])).toBeNull()
    expect(selectedNode(PAGE.tree, [])).toBeNull()
  })

  it('returns null for an address that is not in the tree', () => {
    expect(selectedNode(PAGE.tree, ['Card#ghost'])).toBeNull()
  })
})

describe('parentOf', () => {
  it("finds a node's parent by address", () => {
    expect(parentOf(PAGE.tree, 'Card#root/label')?.name).toBe('root')
  })

  it('returns null for the tree root', () => {
    expect(parentOf(PAGE.tree, '')).toBeNull()
  })

  it('returns null for an address not in the tree', () => {
    expect(parentOf(PAGE.tree, 'Card#ghost')).toBeNull()
  })
})

describe('editableProps', () => {
  it('picks a control from prop-ui, not the authored value', () => {
    expect(field('Card#root', 'layoutMode').control).toBe('enum')
    expect(field('Card#root', 'visible').control).toBe('boolean')
    expect(field('Card#root', 'x').control).toBe('number')
  })

  it('offers every legal value for an enum, and nothing else', () => {
    expect(field('Card#root', 'layoutMode').options).toEqual([
      'NONE',
      'HORIZONTAL',
      'VERTICAL',
      'GRID',
    ])
  })

  it('refuses to edit a prop the prop table does not know, and marks it ungroupable', () => {
    const unknown = field('Card#root', 'notAThing')
    expect(isMapped('notAThing')).toBe(false)
    expect(unknown.group).toBeNull()
    expect(unknown.control).toBe('readonly')
    expect(unknown.readonlyReason).toMatch(/not in the prop table/)
  })

  it('shows a value shape it cannot edit as read-only, with the reason, but still groups it', () => {
    const fills = field('Card#root', 'fills')
    expect(isMapped('fills')).toBe(true)
    expect(fills.group).toBe('fill')
    expect(fills.control).toBe('readonly')
    expect(fills.readonlyReason).toMatch(/colour editor/)
  })

  it('reports a token binding as bound, not as its number', () => {
    const bound = field('Card#root', 'cornerRadius')
    expect(bound.boundTo).toBe('radius#md')
    expect(bound.raw).toBe('"{radius#md}"')
    expect(bound.readonlyReason).toBeNull()
    // Bound values are still edited via NumberFieldRoot's detach affordance.
    expect(bound.control).toBe('number')
  })

  it("leaves out the node's name and its component metadata", () => {
    const names = editableProps(node('Card')).map((f) => f.name)
    expect(names).not.toContain('name')
    expect(names).not.toContain('status')
    expect(names).not.toContain('version')
  })

  it('keeps the authored order', () => {
    const names = editableProps(node('Card#root')).map((f) => f.name)
    expect(names.slice(0, 3)).toEqual(['cornerRadius', 'opacity', 'visible'])
  })

  it('offers a control for a boolean that is false', () => {
    const clips = field('Card#root', 'clipsContent')
    expect(clips.control).toBe('boolean')
    expect(clips.value).toBe(false)
    expect(clips.readonlyReason).toBeNull()
  })
})

describe('sectionsFor', () => {
  it('groups fields into sections, in SECTION_ORDER', () => {
    const root = node('Card#root')
    const sections = sectionsFor(root, editableProps(root), parentOf(PAGE.tree, root.address))
    expect(sections.map((s) => s.group)).toEqual(['position', 'layout', 'appearance', 'fill'])
    expect(sections.map((s) => s.label)).toEqual(['Position', 'Auto layout', 'Appearance', 'Fill'])
  })

  it('omits a section with nothing applicable — no Typography on a Frame', () => {
    const root = node('Card#root')
    const sections = sectionsFor(root, editableProps(root), parentOf(PAGE.tree, root.address))
    expect(sections.some((s) => s.group === 'text')).toBe(false)
  })

  it('a Text node shows Typography; a Rectangle does not', () => {
    const text = node('Card#root/label')
    const textSections = sectionsFor(text, editableProps(text), parentOf(PAGE.tree, text.address))
    expect(textSections.some((s) => s.group === 'text')).toBe(true)

    const rect = node('Card#root/swatch')
    const rectSections = sectionsFor(rect, editableProps(rect), parentOf(PAGE.tree, rect.address))
    expect(rectSections.some((s) => s.group === 'text')).toBe(false)
  })

  it('pairs x with y and width with height on one field', () => {
    const root = node('Card#root')
    const sections = sectionsFor(root, editableProps(root), parentOf(PAGE.tree, root.address))
    const position = sections.find((s) => s.group === 'position')!
    const names = position.fields.map((f) => f.field.name)
    // x/y and width/height each surface once, as the pair's first-authored member.
    expect(names).toEqual(['x', 'width'])
    expect(position.fields.find((f) => f.field.name === 'x')?.pairedWith?.name).toBe('y')
    expect(position.fields.find((f) => f.field.name === 'width')?.pairedWith?.name).toBe('height')
  })

  it('leaves a field solo when its pair partner is not authored', () => {
    const rect = node('Card#root/swatch') // has x={5} but no y
    const sections = sectionsFor(rect, editableProps(rect), parentOf(PAGE.tree, rect.address))
    const position = sections.find((s) => s.group === 'position')!
    expect(position.fields.map((f) => f.field.name)).toEqual(['x'])
    expect(position.fields[0]?.pairedWith).toBeNull()
  })

  it('shows Layout child only when the parent lays its children out', () => {
    const rect = node('Card#root/swatch')
    const parent = parentOf(PAGE.tree, rect.address) // Card#root, layoutMode="VERTICAL"
    const withLayout = sectionsFor(rect, editableProps(rect), parent)
    expect(withLayout.some((s) => s.group === 'layout-child')).toBe(true)

    const withoutLayout = sectionsFor(rect, editableProps(rect), null)
    expect(withoutLayout.some((s) => s.group === 'layout-child')).toBe(false)
  })

  it('excludes an unmapped prop from every section', () => {
    const root = node('Card#root')
    const sections = sectionsFor(root, editableProps(root), parentOf(PAGE.tree, root.address))
    const allNames = sections.flatMap((s) => s.fields.flatMap((f) => [f.field.name, f.pairedWith?.name]))
    expect(allNames).not.toContain('notAThing')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @uidx/viewer test test/editable.test.ts`
Expected: FAIL — `sectionsFor` and `parentOf` are not exported;
`field.control`/`field.group`/`field.options` do not exist yet on the current
`EditableProp` (`kind` does).

- [ ] **Step 3: Rewrite `packages/viewer/src/editable.ts`**

```ts
import { aliasTarget, isAlias, METADATA_ATTRS, type JsonValue, type UidxNode } from '@uidx/format'
import {
  isIdentityProp,
  mappingFor,
  propUiFor,
  PROP_UI_OPT_OUT,
  SECTION_LABEL,
  SECTION_ORDER,
  type PropGroup,
} from '@uidx/schema'

/**
 * What the properties panel is allowed to offer for a node, and how it is
 * grouped (story C5, structured by C6).
 *
 * Two gates, and they answer different questions:
 *
 * 1. **Is the prop in the prop table?** If the mapping layer does not know it,
 *    no edit to it can reach the scene graph, so offering a control would let
 *    the author make a change that silently fails to persist. `@uidx/schema`
 *    is the authority; this file never keeps its own list.
 * 2. **Can this value's shape be edited yet?** A number, a flag, a string or
 *    an enum has an obvious control, sourced from `@uidx/schema`'s `prop-ui`
 *    table. `fills`, `effects` and a few others do not (`control: 'opaque'`)
 *    — a paint stack needs a real colour editor, and a half-built one that
 *    writes a malformed paint is worse than a read-only row.
 *
 * A prop that fails either gate is still *shown*, because the contract pane
 * is also how you read a node. It is shown as read-only with the reason
 * attached, so "cannot edit this" never looks like "this does not exist".
 */

export type ControlKind = 'number' | 'boolean' | 'enum' | 'text' | 'readonly'

export interface EditableProp {
  name: string
  /** Null when the prop table does not know this prop — it cannot be sectioned. */
  group: PropGroup | null
  kind: ControlKind
  control: ControlKind
  /** Legal values, present only when `control === 'enum'`. */
  options: readonly string[] | null
  /** The literal value, or the alias text when this is a token binding. */
  value: JsonValue
  /** Source text exactly as authored, for the read-only rows. */
  raw: string
  /** The token address when the value is a binding, else null. */
  boundTo: string | null
  /** Why this row cannot be edited. Null when it can. */
  readonlyReason: string | null
}

export interface PairedField {
  field: EditableProp
  /** The sibling rendered on the same row (x's `y`, width's `height`). */
  pairedWith: EditableProp | null
}

export interface PropSection {
  group: PropGroup
  label: string
  fields: PairedField[]
}

const UNEDITABLE_SHAPES: Record<string, string> = {
  fills: 'a paint stack needs a colour editor; edit it in the file for now',
  strokes: 'a paint stack needs a colour editor; edit it in the file for now',
  effects: 'effects need their own control; edit them in the file for now',
  vectorPaths: 'vector geometry is one-way — nothing on the canvas can originate it',
  arcData: 'ellipse sweep needs its own control; edit it in the file for now',
  constraints: 'a constraint pair needs its own control; edit it in the file for now',
  dashPattern: 'a dash pattern needs its own control; edit it in the file for now',
}

/** Whether the mapping layer knows this prop at all. */
export function isMapped(name: string): boolean {
  return isIdentityProp(name) || mappingFor(name) !== undefined
}

/**
 * The rows the panel shows for one node, in authored order.
 *
 * `name` and the metadata attributes are excluded: `name` is the node's
 * address component (Epic D, not a property edit); `status` and `version`
 * describe the component and already have their own chip.
 */
export function editableProps(node: UidxNode): EditableProp[] {
  return Object.entries(node.attrs)
    .filter(([name]) => name !== 'name' && !METADATA_ATTRS.has(name))
    .map(([name, attr]) => {
      const bound = isAlias(attr.value) ? aliasTarget(attr.value) : null

      if (!isMapped(name)) {
        const control: ControlKind = 'readonly'
        return {
          name,
          group: null,
          kind: control,
          control,
          options: null,
          value: attr.value,
          raw: attr.raw,
          boundTo: bound,
          readonlyReason: 'not in the prop table, so no edit to it can be written',
        }
      }

      // Every mapped prop has a PROP_UI entry or an explicit opt-out
      // (drift-tested in @uidx/schema). `name` is the only opt-out, and it
      // was already filtered above, so `ui` is defined for everything left.
      const ui = propUiFor(name)
      const shapeReason =
        ui?.control === 'opaque' ? (UNEDITABLE_SHAPES[name] ?? 'this value shape has no control yet') : null

      // A bound value is edited through its binding, not its literal: the
      // number on screen belongs to the token, and typing over it is a
      // detach. `NumberFieldRoot` models exactly this.
      const control: ControlKind = shapeReason
        ? 'readonly'
        : bound
          ? 'number'
          : ((ui?.control as ControlKind) ?? 'readonly')

      return {
        name,
        group: ui?.group ?? null,
        kind: control,
        control,
        options: ui?.control === 'enum' ? (ui.options ?? []) : null,
        value: attr.value,
        raw: attr.raw,
        boundTo: bound,
        readonlyReason: shapeReason,
      }
    })
}

/** Whether `parent` lays its children out — gates the Layout child section. */
function parentLaysOutChildren(parent: UidxNode | null): boolean {
  const mode = parent?.attrs.layoutMode?.value
  return mode === 'HORIZONTAL' || mode === 'VERTICAL'
}

/**
 * Groups a node's editable fields into the sections story C6 defines, in
 * `SECTION_ORDER`. A section with nothing applicable to `node.element` — or,
 * for Layout child, no laid-out parent — is omitted entirely. Fields the prop
 * table does not know (`group: null`) are excluded; the panel renders those
 * separately, unsectioned, as it always has.
 */
export function sectionsFor(
  node: UidxNode,
  fields: readonly EditableProp[],
  parent: UidxNode | null,
): PropSection[] {
  const byName = new Map(fields.map((f) => [f.name, f]))
  const consumed = new Set<string>()
  const byGroup = new Map<PropGroup, PairedField[]>()

  for (const current of fields) {
    if (current.group === null) continue
    if (PROP_UI_OPT_OUT.has(current.name)) continue
    if (consumed.has(current.name)) continue

    const ui = propUiFor(current.name)
    if (!ui) continue
    if (ui.appliesTo && !(ui.appliesTo as readonly string[]).includes(node.element)) continue
    if (ui.group === 'layout-child' && !parentLaysOutChildren(parent)) continue

    let pairedWith: EditableProp | null = null
    if (ui.pairs && !consumed.has(ui.pairs)) {
      const partner = byName.get(ui.pairs)
      if (partner) {
        pairedWith = partner
        consumed.add(ui.pairs)
      }
    }

    consumed.add(current.name)
    const list = byGroup.get(current.group) ?? []
    list.push({ field: current, pairedWith })
    byGroup.set(current.group, list)
  }

  return SECTION_ORDER.filter((group) => byGroup.has(group)).map((group) => ({
    group,
    label: SECTION_LABEL[group],
    fields: byGroup.get(group)!,
  }))
}

/** `node`'s parent in the tree, or null for the root or an unknown address. */
export function parentOf(root: UidxNode, address: string): UidxNode | null {
  const find = (candidate: UidxNode): UidxNode | null => {
    for (const child of candidate.children) {
      if (child.address === address) return candidate
      const hit = find(child)
      if (hit) return hit
    }
    return null
  }
  return address === '' ? null : find(root)
}

/**
 * The node the panel is editing.
 *
 * Selection is a list because the canvas can hold several nodes, but v1 edits
 * one at a time: a multi-select control has to model a mixed value, and
 * `NumberFieldRoot` supports that but nothing else here does yet. Showing the
 * single selected node — and nothing when several are selected — is the
 * honest version of that limit.
 */
export function selectedNode(root: UidxNode | null, selection: readonly string[]): UidxNode | null {
  if (!root || selection.length !== 1) return null
  const address = selection[0]!
  const find = (node: UidxNode): UidxNode | null => {
    if (node.address === address) return node
    for (const child of node.children) {
      const hit = find(child)
      if (hit) return hit
    }
    return null
  }
  return find(root)
}
```

Note: `EditableProp` carries both `kind` and `control` with the same value.
`kind` is kept **only** so any code Task 3 has not yet touched still compiles
during this task's own test run; Task 3 removes `kind` when it migrates
`PropertiesPane.vue` to `control`, and updates this file to drop the
duplicate field in the same pass. Do not treat `kind` as a stable API —
it is a one-task scaffold.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @uidx/viewer test test/editable.test.ts`
Expected: PASS, all tests including the retained `selectedNode` block.

- [ ] **Step 5: Commit**

```bash
git add packages/viewer/src/editable.ts packages/viewer/test/editable.test.ts
git commit -m "$(cat <<'EOF'
Group editable props into sections (C6)

editable.ts now reads control kind, grouping and enum options from
@uidx/schema's prop-ui table instead of guessing from the authored
value's runtime type, and sectionsFor groups a node's fields the way
Figma does — including pairing x/y and width/height, and gating
Layout child on the parent actually laying its children out.

PropertiesPane.vue still renders the old, flat way; it does not yet
consume sectionsFor. That's next.
EOF
)"
```

---

## Task 3: `PropertyField.vue` + `PropertiesPane.vue` — render the structure

**Files:**
- Create: `packages/viewer/src/PropertyField.vue`
- Modify: `packages/viewer/src/PropertiesPane.vue`
- Modify: `packages/viewer/src/editable.ts:29-31` (drop the scaffold `kind` field left by Task 2)
- Modify: `packages/viewer/test/properties-pane.test.ts`

**Interfaces:**
- Consumes: `EditableProp`, `PairedField`, `PropSection`, `editableProps`, `isMapped`, `parentOf`, `sectionsFor`, `selectedNode` from `./editable` (Task 2); `SECTION_ORDER`, `SEGMENTED_MAX_OPTIONS`, `propUiFor`, `type PropGroup` from `@uidx/schema`; `NumberFieldRoot`, `PropertyGridRoot`, `PropertySectionContent`, `PropertySectionHeader`, `PropertySectionRoot`, `PropertySectionTitle`, `SegmentedControlItem`, `SegmentedControlRoot` from `@open-pencil/vue`.
- Produces: `PropertyField.vue` — props `{ field: EditableProp; resolvedValue: number | null; editable: boolean }`, emits `{ preview: [prop: string, value: JsonValue]; commit: [prop: string, value: JsonValue] }`. `PropertiesPane.vue`'s own public props/emits (`doc`/`selection`/`tokens`/`writable`, `preview`/`commit` with `(address, prop, value)`) are unchanged — confirmed against `App.vue:164-171`, which needs no edit.

- [ ] **Step 1: Drop the Task-2 scaffold field**

In `packages/viewer/src/editable.ts`, remove the `kind` line from the
`EditableProp` interface and from both return objects in `editableProps`
(the two places that currently write `kind: control,`). Confirm nothing else
in the package still references `.kind` — `PropertiesPane.vue` is the only
other reader, and Step 3 below rewrites it in the same task.

Run: `pnpm --filter @uidx/viewer test test/editable.test.ts`
Expected: PASS (no test in that file reads `.kind`).

- [ ] **Step 2: Write the failing component tests**

Replace `packages/viewer/test/properties-pane.test.ts` with:

```ts
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { parseOrThrow, type JsonValue } from '@uidx/format'
import PropertiesPane from '../src/PropertiesPane.vue'

const DOC = parseOrThrow(`---
id: fields
---

## Visual Contract

<Page>
  <Component name="Card" status="stable">
    <Frame name="root" cornerRadius="{radius#md}" opacity={0.5} visible={true}
      layoutMode="VERTICAL" notAThing={3} x={10} y={20} width={120} height={40}
      fills={[{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }]}>
      <Text name="label" characters="Hi" fontSize={14} />
      <Rectangle name="swatch" opacity={1} />
    </Frame>
  </Component>
</Page>
`)

const tokens = new Map<string, JsonValue>([['radius#md', 8]])

function pane(selection: string[] = ['Card#root'], writable = true) {
  return mount(PropertiesPane, {
    props: { doc: DOC, selection, tokens, writable },
  })
}

const row = (wrapper: ReturnType<typeof pane>, prop: string) =>
  wrapper.find(`.editor [data-prop="${prop}"]`)

const sectionTitles = (wrapper: ReturnType<typeof pane>) =>
  wrapper.findAll('.section-title').map((t) => t.text())

describe('properties pane', () => {
  it('asks for a selection before offering anything to edit', () => {
    const wrapper = pane([])
    expect(wrapper.find('.editor').exists()).toBe(false)
    expect(wrapper.text()).toContain('Select a node on the canvas')
  })

  it('shows the outline whether or not anything is selected', () => {
    expect(pane([]).findAll('.node').length).toBeGreaterThan(0)
  })

  it('groups fields into sections, in spec order', () => {
    const wrapper = pane()
    expect(sectionTitles(wrapper)).toEqual(['Position', 'Auto layout', 'Appearance', 'Fill'])
  })

  it('a Text node shows Typography; a Frame does not', () => {
    const text = pane(['Card#root/label'])
    expect(sectionTitles(text)).toContain('Typography')

    const frame = pane(['Card#root'])
    expect(sectionTitles(frame)).not.toContain('Typography')
  })

  it('offers no control for a prop the prop table does not know', () => {
    const wrapper = pane()
    const unknown = row(wrapper, 'notAThing')
    expect(unknown.find('input, select, button:not(.detach)').exists()).toBe(false)
    expect(unknown.text()).toContain('not in the prop table')
  })

  it('offers no control for a value shape it cannot edit', () => {
    const wrapper = pane()
    expect(row(wrapper, 'fills').find('input').exists()).toBe(false)
    expect(row(wrapper, 'fills').text()).toContain('colour editor')
  })

  it('shows a bound value as its token, with what it resolves to', () => {
    const wrapper = pane()
    const bound = row(wrapper, 'cornerRadius')
    expect(bound.find('.token').text()).toBe('"{radius#md}"')
    expect(bound.find('.resolves').text()).toContain('8')
    expect(bound.find('input[type="text"]').exists()).toBe(false)
  })

  it('detaches a binding only when the button is pressed, and writes the literal', async () => {
    const wrapper = pane()
    expect(wrapper.emitted('commit')).toBeUndefined()
    await row(wrapper, 'cornerRadius').find('button.detach').trigger('click')
    expect(wrapper.emitted('commit')).toEqual([['Card#root', 'cornerRadius', 8]])
  })

  it('commits a toggled flag immediately', async () => {
    const wrapper = pane()
    const checkbox = row(wrapper, 'visible').find('input[type="checkbox"]')
    await checkbox.setValue(false)
    expect(wrapper.emitted('commit')).toEqual([['Card#root', 'visible', false]])
  })

  it('renders an enum with exactly its legal options, and nothing lets you type a fifth', () => {
    const wrapper = pane()
    const layoutMode = row(wrapper, 'layoutMode')
    expect(layoutMode.find('input[type="text"]').exists()).toBe(false)
    const items = layoutMode.findAllComponents({ name: 'SegmentedControlItem' })
    expect(items.map((i) => i.props('value'))).toEqual(['NONE', 'HORIZONTAL', 'VERTICAL', 'GRID'])
  })

  it('commits an enum selection', async () => {
    const wrapper = pane()
    const segmented = row(wrapper, 'layoutMode').findComponent({ name: 'SegmentedControlRoot' })
    segmented.vm.$emit('update:modelValue', 'HORIZONTAL')
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('commit')).toEqual([['Card#root', 'layoutMode', 'HORIZONTAL']])
  })

  it('keeps preview and commit apart', async () => {
    const wrapper = pane()
    const numberField = wrapper.findComponent({ name: 'NumberFieldRoot' })

    numberField.vm.$emit('update:modelValue', 0.7)
    numberField.vm.$emit('update:modelValue', 0.8)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('preview')).toHaveLength(2)
    expect(wrapper.emitted('commit')).toBeUndefined()

    numberField.vm.$emit('commit', 0.8, 0.5)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('commit')).toHaveLength(1)
  })

  it('goes read-only when the socket is down, and says so', async () => {
    const wrapper = pane(['Card#root'], false)
    expect(wrapper.text()).toContain('Not connected')

    const checkbox = row(wrapper, 'visible').find('input[type="checkbox"]')
    expect(checkbox.attributes('disabled')).toBeDefined()
    await checkbox.setValue(false)
    expect(wrapper.emitted('commit')).toBeUndefined()

    expect(row(wrapper, 'cornerRadius').find('button.detach').attributes('disabled')).toBeDefined()
  })

  it('says so plainly when a node declares nothing to edit', () => {
    const wrapper = pane(['Card'])
    expect(wrapper.find('.editor').text()).toContain('declares no properties')
  })

  it('puts X and Y on one row, and Width and Height on another', () => {
    const wrapper = pane()
    const position = row(wrapper, 'x')
    expect(position.findComponent({ name: 'PropertyGridRoot' }).exists()).toBe(true)
    expect(position.text()).toContain('y')

    const size = row(wrapper, 'width')
    expect(size.findComponent({ name: 'PropertyGridRoot' }).exists()).toBe(true)
    expect(size.text()).toContain('height')
  })

  it('collapsing a section survives re-selecting the node', async () => {
    const wrapper = pane(['Card#root'])
    const appearanceSection = wrapper
      .findAllComponents({ name: 'PropertySectionRoot' })
      .find((s) => s.find('.section-title').text() === 'Appearance')!

    appearanceSection.vm.$emit('update:open', false)
    await wrapper.vm.$nextTick()
    expect(appearanceSection.props('open')).toBe(false)

    await wrapper.setProps({ selection: ['Card#root/swatch'] })
    const appearanceAgain = wrapper
      .findAllComponents({ name: 'PropertySectionRoot' })
      .find((s) => s.find('.section-title').text() === 'Appearance')!
    expect(appearanceAgain.props('open')).toBe(false)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @uidx/viewer test test/properties-pane.test.ts`
Expected: FAIL — `PropertiesPane.vue` still renders the flat C5 layout;
`.section-title` does not exist, `layoutMode` still renders a text input, no
`PropertyGridRoot` wraps `x`.

- [ ] **Step 4: Write `packages/viewer/src/PropertyField.vue`**

```vue
<script setup lang="ts">
import { NumberFieldRoot, SegmentedControlItem, SegmentedControlRoot } from '@open-pencil/vue'
import type { JsonValue } from '@uidx/format'
import { propUiFor, SEGMENTED_MAX_OPTIONS } from '@uidx/schema'
import type { EditableProp } from './editable'

/**
 * One field's markup — a label plus the control its `control` kind calls
 * for. Factored out of `PropertiesPane.vue` so it isn't repeated for a solo
 * field and for each half of a paired row (story C6).
 */
const props = defineProps<{
  field: EditableProp
  /** What a bound row displays: the token's resolved value. Null if unresolved. */
  resolvedValue: number | null
  editable: boolean
}>()

const emit = defineEmits<{
  preview: [prop: string, value: JsonValue]
  commit: [prop: string, value: JsonValue]
}>()

function numberValue(): number {
  if (props.field.boundTo) return props.resolvedValue ?? 0
  return typeof props.field.value === 'number' ? props.field.value : 0
}

function step(): number {
  return propUiFor(props.field.name)?.step ?? 1
}

function onNumberPreview(value: number): void {
  if (!props.editable) return
  emit('preview', props.field.name, value)
}

function onNumberCommit(value: number): void {
  if (!props.editable) return
  // Committing over a binding replaces it with the literal — the file gets
  // a number where it had `{radius#md}`. Same for the detach button below.
  emit('commit', props.field.name, value)
}

function onToggle(event: Event): void {
  if (!props.editable) return
  emit('commit', props.field.name, (event.target as HTMLInputElement).checked)
}

function onText(event: Event): void {
  if (!props.editable) return
  emit('commit', props.field.name, (event.target as HTMLInputElement).value)
}

function onEnum(value: string | string[] | undefined): void {
  if (!props.editable || typeof value !== 'string') return
  emit('commit', props.field.name, value)
}
</script>

<template>
  <label :for="`f-${field.name}`" :class="{ bound: field.boundTo }">{{ field.name }}</label>

  <!-- A bound value is the token's, not this node's: it shows the address
       it came from, and editing it is a detach the author has to ask for. -->
  <div v-if="field.boundTo" class="value bound-value">
    <span class="token" :title="`bound to ${field.boundTo}`">{{ field.raw }}</span>
    <span class="resolves">= {{ resolvedValue ?? '?' }}</span>
    <button
      type="button"
      class="detach"
      :disabled="!editable || resolvedValue === null"
      :title="`replace the binding with ${resolvedValue}`"
      @click="onNumberCommit(numberValue())"
    >
      detach
    </button>
  </div>

  <!--
    `NumberFieldRoot` is headless: it owns scrubbing, expression parsing and
    the keyboard contract, and renders nothing. The markup below is the whole
    of what this component adds — a label to drag on and an input to type
    into, wired to the actions the primitive hands back.
  -->
  <NumberFieldRoot
    v-else-if="field.control === 'number'"
    v-slot="{ attrs, actions, state, displayValue, draftValue }"
    :model-value="numberValue()"
    :disabled="!editable"
    :aria-label="field.name"
    :step="step()"
    @update:model-value="onNumberPreview"
    @commit="onNumberCommit"
  >
    <span class="value number" v-bind="attrs">
      <input
        v-if="state.editing"
        :id="`f-${field.name}`"
        class="number-input"
        type="text"
        :value="draftValue"
        :disabled="!editable"
        @input="actions.input($event)"
        @keydown="actions.keydown($event)"
        @blur="actions.commitEdit($event)"
      />
      <template v-else>
        <!-- Drag here to scrub; click to type. Figma's own affordance. -->
        <span
          class="scrub"
          :class="{ disabled: !editable }"
          @pointerdown="actions.startScrub($event)"
          @dblclick="actions.startEdit()"
          >{{ displayValue }}</span
        >
      </template>
    </span>
  </NumberFieldRoot>

  <input
    v-else-if="field.control === 'boolean'"
    :id="`f-${field.name}`"
    class="value"
    type="checkbox"
    :checked="field.value === true"
    :disabled="!editable"
    @change="onToggle"
  />

  <input
    v-else-if="field.control === 'text'"
    :id="`f-${field.name}`"
    class="value"
    type="text"
    :value="field.value"
    :disabled="!editable"
    @change="onText"
  />

  <!-- Short enums (<=4 legal values) get icon-row segmented controls, the
       way Figma shows alignment, sizing and wrap. Long ones (blendMode,
       fontWeight) get a native select — a segmented row that long doesn't
       scan. -->
  <SegmentedControlRoot
    v-else-if="field.control === 'enum' && (field.options?.length ?? 0) <= SEGMENTED_MAX_OPTIONS"
    class="value enum-segmented"
    :aria-label="field.name"
    :disabled="!editable"
    :model-value="typeof field.value === 'string' ? field.value : undefined"
    @update:model-value="onEnum"
  >
    <SegmentedControlItem
      v-for="option in field.options"
      :key="option"
      :value="option"
      :disabled="!editable"
      class="enum-item"
    >
      {{ option }}
    </SegmentedControlItem>
  </SegmentedControlRoot>

  <select
    v-else-if="field.control === 'enum'"
    :id="`f-${field.name}`"
    class="value enum-select"
    :disabled="!editable"
    :value="typeof field.value === 'string' ? field.value : ''"
    @change="onEnum(($event.target as HTMLSelectElement).value)"
  >
    <option v-for="option in field.options" :key="option" :value="option">{{ option }}</option>
  </select>

  <span v-else class="value readonly" :title="field.readonlyReason ?? undefined">
    {{ field.raw }}
    <em class="why">{{ field.readonlyReason }}</em>
  </span>
</template>
```

- [ ] **Step 5: Rewrite `packages/viewer/src/PropertiesPane.vue`**

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  PropertyGridRoot,
  PropertySectionContent,
  PropertySectionHeader,
  PropertySectionRoot,
  PropertySectionTitle,
} from '@open-pencil/vue'
import type { JsonValue, UidxDocument, UidxNode } from '@uidx/format'
import { SECTION_ORDER, type PropGroup } from '@uidx/schema'

import {
  editableProps,
  isMapped,
  parentOf,
  sectionsFor,
  selectedNode,
  type EditableProp,
} from './editable'
import PropertyField from './PropertyField.vue'

const props = defineProps<{
  doc: UidxDocument | null
  selection?: string[]
  /** Token address -> literal, so a bound row can show what it resolves to. */
  tokens?: Map<string, JsonValue>
  /** False while the socket is down; every control goes read-only. */
  writable?: boolean
}>()

/**
 * Two events, because story C4 turns on the difference.
 *
 * `preview` is a value passing through — a scrub in progress. It updates the
 * canvas and touches nothing else. `commit` is the author saying they meant
 * it, and is the only thing that becomes a patch and a line in the diff.
 */
const emit = defineEmits<{
  preview: [address: string, prop: string, value: JsonValue]
  commit: [address: string, prop: string, value: JsonValue]
}>()

interface Row {
  depth: number
  node: UidxNode
}

/** Flattened tree, so the outline still reads like a layers panel. */
const rows = computed<Row[]>(() => {
  if (!props.doc) return []
  const out: Row[] = []
  const walk = (node: UidxNode, depth: number): void => {
    out.push({ node, depth })
    node.children.forEach((child) => walk(child, depth + 1))
  }
  walk(props.doc.tree, 0)
  return out
})

const active = computed(() => selectedNode(props.doc?.tree ?? null, props.selection ?? []))
const parent = computed(() =>
  active.value && props.doc ? parentOf(props.doc.tree, active.value.address) : null,
)
const fields = computed<EditableProp[]>(() => (active.value ? editableProps(active.value) : []))
const sections = computed(() =>
  active.value ? sectionsFor(active.value, fields.value, parent.value) : [],
)
/** Props the prop table does not know — shown flat, as C5 always has. */
const unmapped = computed(() => fields.value.filter((f) => f.group === null))

/**
 * Open/closed per section, keyed by group rather than by node — a `ref`
 * declared once, so collapsing "Appearance" survives selecting a different
 * node (story C6's "Done when").
 */
const openSections = ref<Record<PropGroup, boolean>>(
  Object.fromEntries(SECTION_ORDER.map((group) => [group, true])) as Record<PropGroup, boolean>,
)

/**
 * A component's maturity, shown as a chip rather than an ordinary row — it is
 * the fact a reviewer scans for, and since ADR 0003 §3 it lives on the
 * component instead of in the frontmatter badges.
 */
function statusOf(node: UidxNode): string | null {
  const value = node.attrs.status?.value
  return node.element === 'Component' && typeof value === 'string' ? value : null
}

function attrsOf(node: UidxNode): { name: string; value: string; known: boolean }[] {
  return Object.entries(node.attrs)
    .filter(([key]) => key !== 'name' && key !== 'status' && key !== 'version')
    .map(([key, attr]) => ({ name: key, value: attr.raw, known: isMapped(key) }))
}

/** What a bound row displays: the token's value, since the literal is elsewhere. */
function resolved(field: EditableProp): number | null {
  if (!field.boundTo) return typeof field.value === 'number' ? field.value : null
  const value = props.tokens?.get(field.boundTo)
  return typeof value === 'number' ? value : null
}

const editable = (field: EditableProp): boolean =>
  props.writable !== false && field.readonlyReason === null

function onPreview(prop: string, value: JsonValue): void {
  if (!active.value) return
  emit('preview', active.value.address, prop, value)
}

function onCommit(prop: string, value: JsonValue): void {
  if (!active.value) return
  emit('commit', active.value.address, prop, value)
}
</script>

<template>
  <aside class="properties">
    <h2>Contract</h2>

    <p v-if="!active" class="note">
      Select a node on the canvas to edit it. Click for an entity, double-click to enter it,
      ⌘/ctrl+click for the leaf.
    </p>
    <p v-else-if="writable === false" class="note warn">
      Not connected — showing values, but nothing can be written back right now.
    </p>

    <!-- The editor for the one selected node, above the outline. -->
    <section v-if="active" class="editor">
      <div class="node-head">
        <span class="element">{{ active.element }}</span>
        <span class="name">{{ active.name }}</span>
      </div>
      <p v-if="!fields.length" class="note">This node declares no properties.</p>

      <PropertySectionRoot
        v-for="section in sections"
        :key="section.group"
        :open="openSections[section.group]"
        class="section"
        :aria-label="section.label"
        @update:open="openSections[section.group] = $event"
      >
        <PropertySectionHeader class="section-head">
          <PropertySectionTitle class="section-title">{{ section.label }}</PropertySectionTitle>
        </PropertySectionHeader>
        <PropertySectionContent class="section-body">
          <template v-for="paired in section.fields" :key="paired.field.name">
            <PropertyGridRoot
              v-if="paired.pairedWith"
              :columns="2"
              class="field field-pair"
              :data-prop="paired.field.name"
            >
              <PropertyField
                :field="paired.field"
                :resolved-value="resolved(paired.field)"
                :editable="editable(paired.field)"
                @preview="onPreview"
                @commit="onCommit"
              />
              <PropertyField
                :field="paired.pairedWith"
                :resolved-value="resolved(paired.pairedWith)"
                :editable="editable(paired.pairedWith)"
                @preview="onPreview"
                @commit="onCommit"
              />
            </PropertyGridRoot>
            <div v-else class="field" :data-prop="paired.field.name">
              <PropertyField
                :field="paired.field"
                :resolved-value="resolved(paired.field)"
                :editable="editable(paired.field)"
                @preview="onPreview"
                @commit="onCommit"
              />
            </div>
          </template>
        </PropertySectionContent>
      </PropertySectionRoot>

      <!-- Unknown to the prop table: no section to sit in, shown flat as before. -->
      <div v-for="field in unmapped" :key="field.name" class="field" :data-prop="field.name">
        <PropertyField
          :field="field"
          :resolved-value="null"
          :editable="editable(field)"
          @preview="onPreview"
          @commit="onCommit"
        />
      </div>
    </section>

    <h3 class="outline-head">Outline</h3>
    <div
      v-for="row in rows"
      :key="row.node.address || '<root>'"
      class="node"
      :class="{ selected: (selection ?? []).includes(row.node.address) }"
    >
      <div class="node-head" :style="{ paddingLeft: `${row.depth * 12}px` }">
        <span class="element">{{ row.node.element }}</span>
        <span class="name">{{ row.node.name }}</span>
        <span v-if="statusOf(row.node)" class="status" :data-status="statusOf(row.node)">
          {{ statusOf(row.node) }}
        </span>
      </div>
      <dl class="attrs" :style="{ paddingLeft: `${row.depth * 12 + 12}px` }">
        <template v-for="attr in attrsOf(row.node)" :key="attr.name">
          <dt
            :class="{ unknown: !attr.known }"
            :title="attr.known ? undefined : 'not in the prop table'"
          >
            {{ attr.name }}
          </dt>
          <dd>{{ attr.value }}</dd>
        </template>
      </dl>
    </div>
  </aside>
</template>

<style scoped>
.properties {
  overflow: auto;
  padding: 16px;
  border-left: 1px solid var(--line);
  font-family: var(--mono);
  font-size: 11px;
}
h2 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--text-faint);
  margin: 0 0 8px;
}
.outline-head {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--text-faint);
  margin: 20px 0 8px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.note {
  color: var(--text-faint);
  font-size: 11px;
  line-height: 1.5;
  margin: 0 0 16px;
}
.note.warn {
  color: #d8b25a;
}
.editor {
  margin-bottom: 8px;
}
.section {
  margin-bottom: 4px;
}
.section-head {
  display: flex;
  align-items: center;
  padding: 4px 0;
  cursor: pointer;
}
.section-title {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--text-faint);
}
.section-body {
  padding: 2px 0 6px;
}
.field {
  display: grid;
  grid-template-columns: minmax(90px, auto) 1fr;
  align-items: center;
  gap: 4px 10px;
  padding: 2px 0;
}
.field-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 12px;
}
.field-pair > :deep(label) {
  color: var(--text-faint);
}
.field label {
  color: var(--text-faint);
}
.field label.bound {
  color: #a78bfa;
}
.value {
  min-width: 0;
}
input[type='text'],
select,
.number {
  display: block;
  width: 100%;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 3px;
  color: var(--text);
  font-family: var(--mono);
  font-size: 11px;
  padding: 2px 5px;
}
.number {
  padding: 0;
}
.number[data-scrubbing] {
  border-color: #6fb5ff;
}
.number-input {
  border: none;
  background: none;
  width: 100%;
  padding: 2px 5px;
}
.scrub {
  display: block;
  padding: 2px 5px;
  cursor: ew-resize;
  user-select: none;
}
.scrub.disabled {
  cursor: default;
}
.enum-segmented {
  display: flex;
  gap: 1px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 3px;
  padding: 1px;
}
.enum-item {
  flex: 1;
  background: none;
  border: none;
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 10px;
  padding: 2px 4px;
  cursor: pointer;
  border-radius: 2px;
}
.enum-item[data-state='on'] {
  background: var(--line);
  color: var(--text);
}
input:disabled,
select:disabled,
:deep([aria-disabled='true']) {
  opacity: 0.5;
}
.bound-value {
  display: flex;
  align-items: center;
  gap: 6px;
}
.token {
  color: #a78bfa;
}
.resolves {
  color: var(--text-faint);
}
.detach {
  margin-left: auto;
  background: none;
  border: 1px solid var(--line);
  border-radius: 3px;
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 10px;
  padding: 1px 6px;
  cursor: pointer;
}
.detach:disabled {
  opacity: 0.4;
  cursor: default;
}
.readonly {
  color: var(--text-dim);
  word-break: break-all;
}
.why {
  display: block;
  color: var(--text-faint);
  font-style: normal;
  font-size: 10px;
}
.node {
  margin-bottom: 12px;
  border-left: 2px solid transparent;
  margin-left: -8px;
  padding-left: 6px;
}
.node.selected {
  border-left-color: #6fb5ff;
  background: rgba(111, 181, 255, 0.06);
}
.node-head {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding-bottom: 3px;
}
.element {
  color: #c08bff;
}
.name {
  color: var(--text);
  font-weight: 700;
}
.status {
  padding: 1px 6px;
  border: 1px solid var(--line);
  border-radius: 999px;
  font-size: 10px;
  color: var(--text-dim);
}
.status[data-status='stable'] {
  border-color: #2f6f45;
  color: #7ee08a;
}
.status[data-status='draft'] {
  border-color: #6b5a2a;
  color: #d8b25a;
}
.status[data-status='deprecated'] {
  border-color: #6f3030;
  color: #ff8b8b;
}
.attrs {
  display: grid;
  grid-template-columns: minmax(90px, auto) 1fr;
  gap: 1px 10px;
  margin: 0;
}
dt {
  color: var(--text-faint);
}
dt.unknown {
  color: #d8b25a;
}
dt.unknown::after {
  content: ' ?';
}
dd {
  margin: 0;
  color: var(--text-dim);
  word-break: break-all;
}
</style>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @uidx/viewer test test/properties-pane.test.ts test/editable.test.ts`
Expected: PASS, every test in both files. If a `SegmentedControlItem`/`SegmentedControlRoot`
assertion fails because the primitive's rendered `data-state`/prop names
differ from what this plan assumed, adjust the test's selector to match the
primitive's actual output — the component's real API
(`packages/vue/src/primitives/SegmentedControl/*.vue` in the sibling
`open-pencil` repo, and `PanelGrid.vue`/`PanelSection.vue` there for the
idiomatic usage this plan's markup follows) is the authority, not this plan.

- [ ] **Step 7: Run the full viewer package suite and typecheck**

Run: `pnpm --filter @uidx/viewer test && pnpm --filter @uidx/viewer typecheck`
Expected: PASS. `socket.test.ts`, `patch-channel.test.ts`, `canvas-controls.test.ts`,
etc. are untouched by this task and must not regress.

- [ ] **Step 8: Commit**

```bash
git add packages/viewer/src/PropertyField.vue packages/viewer/src/PropertiesPane.vue packages/viewer/src/editable.ts packages/viewer/test/properties-pane.test.ts
git commit -m "$(cat <<'EOF'
Render the properties panel as sectioned, structured inspector (C6)

PropertiesPane.vue now lays out PropertySectionRoot/PropertyGridRoot/
SegmentedControlRoot instead of a flat label:control list, using
prop-ui via editable.ts to decide grouping, pairing and enum options.
Section open/closed state is keyed by group, not by node, so
collapsing a section survives re-selecting.

PropertyField.vue factors the one piece of per-field markup so it
isn't repeated for a solo field and each half of a paired row.

No change to what any edit writes: preview/commit still carry the
same (address, prop, value) shape, and fromSceneChange is untouched.
EOF
)"
```

---

## Task 4: Full-suite verification, live check, and backlog

**Files:**
- None created. Verifies the whole repo; modifies `docs/backlog.md`.

**Interfaces:** None — this task runs the existing gate and updates project
bookkeeping.

- [ ] **Step 1: Run the full monorepo gate**

Run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm build && pnpm test`
Expected: every step exits 0. This is the same gate backlog.md describes as
running on every push (`docs/backlog.md:19-20`).

- [ ] **Step 2: Run the dogfood check**

Run: `pnpm --filter @uidx/cli build && pnpm check:examples`
Expected: exits 0 — this story does not change `@uidx/format` or emitted
`.uidx` syntax, so the repo's own example files must still validate.

- [ ] **Step 3: Verify by hand in the running app**

Start the viewer (`pnpm viewer`, or open an example `.uidx` file with
`uidx open`) and confirm, against a component with a `<Frame>` and a `<Text>`
child, each item from the spec's "Done when" bullet
(`docs/properties-panel.md`, "C6 — an inspector with structure"):

- Selecting the `<Text>` node shows a Typography section; selecting the
  `<Frame>` does not.
- `layoutMode` renders as a control with exactly four options (segmented
  control: NONE / HORIZONTAL / VERTICAL / GRID) and there is no text field to
  type a fifth value into.
- If the frame has `x`/`y` or `width`/`height` authored, X and Y render on one
  row, and Width and Height render on one row.
- Collapse a section (e.g. Appearance), select a different node that also has
  an Appearance section, and confirm it is still collapsed.
- Edit a property that exists today (e.g. scrub `opacity`) and confirm the
  file's diff is identical in shape to what it was before this story — same
  one-line `set`, same value. (Nothing in this plan touches `fromSceneChange`
  or `to-scene.ts`, so this should hold by construction; this step is the
  human confirmation the "Definition of done" at `docs/backlog.md:926-931`
  asks for on anything touching the write path.)

If any of these fail, stop and fix before proceeding — do not update the
backlog status until they pass.

- [ ] **Step 4: Update `docs/backlog.md`**

In the "C6 / C7. The panel becomes a real inspector" entry
(`docs/backlog.md:603-627`), split it: mark C6 done, leave C7 as specced but
not started. Replace:

```
### C6 / C7. The panel becomes a real inspector  — M + M

> ⬜ **specced, not started** — see
> [docs/properties-panel.md](properties-panel.md), awaiting approval
```

with:

```
### C6 / C7. The panel becomes a real inspector  — M + M

> **C6 done.** C7 ⬜ **specced, not started** — see
> [docs/properties-panel.md](properties-panel.md)
```

Also update the top-of-file status table entry for Phase 3
(`docs/backlog.md:13`) only if C7 remaining work changes that row's meaning —
re-read the row first; Phase 3 is already marked ✅ complete with a note that
C5 deferred work is named, and C6/C7 are additions layered on top per the
"Effect on the plan" section (`docs/backlog.md:245-257` in the spec,
mirrored in the backlog's Epic C section) — leave Phase 3's row as-is unless
this reading turns out to be wrong.

- [ ] **Step 5: Commit**

```bash
git add docs/backlog.md
git commit -m "$(cat <<'EOF'
Mark C6 done in the backlog

Structure, pairing and enum controls landed; C7 (unset properties)
is still specced and not started.
EOF
)"
```

---

## Self-review notes (for the plan author, not the executor)

- **Spec coverage:** every "C6" bullet in `docs/properties-panel.md` maps to a
  task — the `prop-ui.ts` table (Task 1), sections/pairing/applicability
  (Task 2), `PropertySectionRoot`/`PropertyGridRoot`/`SegmentedControlRoot`
  rendering and per-section open-state memory (Task 3), and the "Done when"
  acceptance bullets plus "byte-identical" write-back (Task 4). C7 is out of
  scope by design — see the plan header.
- **Deliberate scope decisions not fully pinned by the spec**, each with a
  code comment at its point of use: `constraints`, `vectorPaths`, `arcData`
  grouped under `position`; `isMask`/`maskType` under `appearance`;
  `counterAxisAlignContent`/`itemReverseZIndex`/per-side stroke weights/
  `strokeMiterLimit`/`strokesIncludedInLayout` grouped with their nearest
  named section; `textTruncation`'s enum domain confirmed directly against
  `@open-pencil/scene-graph`; the `<=4 options -> segmented, else select`
  threshold. `min`/`max` deliberately left unset except `opacity` and
  `cornerSmoothing` (true 0–1 engine invariants) — see Global Constraints,
  "No change to what gets written."
- **Type consistency:** `EditableProp.control`, `PropSection`, `PairedField`,
  `sectionsFor`'s signature and `PropertyField`'s props/emits match across
  Tasks 2 and 3 (Task 2's Interfaces block is what Task 3 consumes).
