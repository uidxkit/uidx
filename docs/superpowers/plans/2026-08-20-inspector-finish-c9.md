# C9 — Inspector finish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Check boxes off as tasks land so a fresh session can resume from the first unchecked task.

**Goal:** Finish the inspector to the Figma reference: a real colour-picker
dialog, number fields that scrub on their icons and answer the wheel,
panel-hover canvas feedback, icon segments with tooltips everywhere a glyph
exists, and the Auto layout and Appearance sections rebuilt to Figma's
arrangement.

**Architecture:** Judgement stays in pure modules — colour math and swatch
collection in `paint-edit.ts`, wheel stepping in `wheel-step.ts`, the
padding/corner collapse decisions in `edit-models.ts`, the hover mapping in
`hover-map.ts`, the W/H↔sizing-axis mapping in `size-model.ts` — all tested
without Vue. Icons are data: one `field-icons.ts` table of stroke paths
rendered by a single tiny component. Components compose those: a
`ColorPickerDialog.vue` used by both paint and effect fields, an
`AlignmentMatrix.vue`, a `PaddingField.vue`, a `CornerField.vue`, a
`SizeField.vue`. Multi-prop gestures (padding pair, matrix, corner collapse)
emit one commit per prop in the same microtask and the existing
`patch-burst` machinery makes them one atomic envelope — no new patch
plumbing anywhere.

**Tech Stack:** TypeScript, Vue 3 `<script setup>`, `@open-pencil/vue`
(`NumberFieldRoot`, `SegmentedControlRoot/Item`, section primitives —
already in use), `@open-pencil/core` editor overlays (`setAutoLayoutHover`,
`setHoveredNode`), Vitest, `@vue/test-utils`.

**Spec:** [2026-08-20-inspector-finish-design.md](../specs/2026-08-20-inspector-finish-design.md)

## Global Constraints

- Node 22.15.0 (`.nvmrc`). Non-interactive shells default to node 18 and die
  with `ERR_REQUIRE_ESM`; prefix `PATH` with
  `~/.nvm/versions/node/v22.15.0/bin`.
- Run everything as `pnpm --filter <pkg> <script>` from the repo root.
- No raw colours in stylesheets — `theme.css` tokens only. Inline `:style`
  bindings carrying *data* colours (swatches, SV gradients) are data, not
  design, and are exempt.
- Every icon control carries `title` (tooltip) and `aria-label`.
- The editors never construct patches; every write is `preview`/`commit`
  with `(prop, wholeValue)` through the existing path. Multi-prop gestures
  are N commits in one microtask; `patch-burst` makes them one envelope.
- Wheel/scrub previews continuously; commits once per settled gesture
  (wheel: debounced ~400ms).
- Value shapes and prop domains: see the C8 plan's Global Constraints —
  unchanged.
- After every task: run that package's tests; before every commit: the
  touched files are prettier-clean (`pnpm format`).

## File structure

| File | Change | Responsibility |
|---|---|---|
| `packages/viewer/src/field-icons.ts` | **new** | one table of stroke-path glyphs + the `FieldIcon` renderer |
| `packages/viewer/src/wheel-step.ts` | **new** | pure wheel→delta math (notches, Shift ×10, Alt ×0.1) |
| `packages/viewer/src/paint-edit.ts` | extend | `rgbToHsv`, `hsvToRgb`, `documentSwatches` |
| `packages/viewer/src/edit-models.ts` | **new** | `paddingModel`, `cornerModel` — collapse/expand + what each field writes |
| `packages/viewer/src/size-model.ts` | **new** | which sizing prop governs W/H for a given `layoutMode` |
| `packages/viewer/src/hover-map.ts` | **new** | prop name → canvas overlay descriptor |
| `packages/viewer/src/ColorPickerDialog.vue` | **new** | SV area, hue, alpha, hex, opacity, eyedropper, swatches |
| `packages/viewer/src/AlignmentMatrix.vue` | **new** | Figma's 3×3 alignment matrix |
| `packages/viewer/src/PaddingField.vue` | **new** | H/V pair ⇄ four sides |
| `packages/viewer/src/CornerField.vue` | **new** | radius ⇄ four corners + smoothing |
| `packages/viewer/src/SizeField.vue` | **new** | W/H box with Hug/Fixed inside |
| `packages/viewer/src/PropertyField.vue` | modify | icon slot, wheel, hover events, new dispatches |
| `packages/viewer/src/PropertiesPane.vue` | modify | section rebuilds, header eye, hover forwarding |
| `packages/viewer/src/PaintStackField.vue` / `EffectListField.vue` | modify | swap native input → `ColorPickerDialog`; effect numbers → `NumberFieldRoot` |
| `packages/viewer/src/App.vue` / `CanvasPane.vue` | modify | hover plumbing → `setAutoLayoutHover` / `setHoveredNode` |
| tests | extend | mirrors of all the above |

---

## Phase A — instruments and the picker

### Task A1: `field-icons.ts` — glyphs as data

**Files:**
- Create: `packages/viewer/src/field-icons.ts`
- Create: `packages/viewer/test/field-icons.test.ts`

**Interfaces:**
- Produces:

```ts
export type IconName =
  | 'rotation' | 'opacity' | 'radius' | 'radius-corner'
  | 'padding-h' | 'padding-v' | 'padding-left' | 'padding-right' | 'padding-top' | 'padding-bottom'
  | 'gap-h' | 'gap-v' | 'stroke-weight' | 'blur' | 'spread'
  | 'flow-none' | 'flow-vertical' | 'flow-horizontal' | 'flow-grid' | 'wrap'
  | 'align-left' | 'align-center-h' | 'align-right' | 'align-justify'
  | 'align-top' | 'align-middle' | 'align-bottom'
  | 'resize-none' | 'resize-height' | 'resize-both' | 'resize-truncate'
  | 'stroke-inside' | 'stroke-center' | 'stroke-outside'
  | 'position-auto' | 'position-absolute'
  | 'italic' | 'case-original' | 'case-upper' | 'case-lower' | 'case-title'
  | 'deco-none' | 'deco-underline' | 'deco-strike'
  | 'eye' | 'eye-off' | 'expand' | 'droplet'

export const ICON_PATHS: Record<IconName, string>   // SVG path data, 12×12 grid
export const FieldIcon: FunctionalComponent<{ name: IconName }>
// Renders <svg viewBox="0 0 12 12" width="12" height="12" fill="none"
//   stroke="currentColor" stroke-width="1.2" stroke-linecap="round"
//   stroke-linejoin="round"><path :d="ICON_PATHS[name]" /></svg>
```

- Maps consumed by later tasks (exported from the same module):

```ts
/** Number-field glyphs by prop name; absent means letter/no glyph. */
export const PROP_ICON: Partial<Record<string, IconName>>
/** Segmented-option glyphs: `${prop}:${value}` → icon. Absent → text stays. */
export const OPTION_ICON: Record<string, IconName>
```

- [x] **Step 1: Failing test** — `packages/viewer/test/field-icons.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ICON_PATHS, OPTION_ICON, PROP_ICON } from '../src/field-icons'

describe('field icons', () => {
  it('every referenced icon has path data', () => {
    for (const name of Object.values(PROP_ICON)) {
      expect(ICON_PATHS[name!], String(name)).toBeTruthy()
    }
    for (const name of Object.values(OPTION_ICON)) {
      expect(ICON_PATHS[name], name).toBeTruthy()
    }
  })

  it('covers the spec inventory', () => {
    for (const prop of [
      'rotation', 'opacity', 'cornerRadius', 'itemSpacing', 'counterAxisSpacing',
      'strokeWeight', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom',
    ]) {
      expect(PROP_ICON[prop], prop).toBeTruthy()
    }
    for (const key of [
      'layoutMode:NONE', 'layoutMode:HORIZONTAL', 'layoutMode:VERTICAL', 'layoutMode:GRID',
      'layoutWrap:WRAP', 'layoutWrap:NO_WRAP',
      'textAlignHorizontal:LEFT', 'textAlignHorizontal:CENTER', 'textAlignHorizontal:RIGHT', 'textAlignHorizontal:JUSTIFIED',
      'textAlignVertical:TOP', 'textAlignVertical:CENTER', 'textAlignVertical:BOTTOM',
      'textAutoResize:NONE', 'textAutoResize:HEIGHT', 'textAutoResize:WIDTH_AND_HEIGHT', 'textAutoResize:TRUNCATE',
      'strokeAlign:INSIDE', 'strokeAlign:CENTER', 'strokeAlign:OUTSIDE',
      'layoutPositioning:AUTO', 'layoutPositioning:ABSOLUTE',
      'textDecoration:NONE', 'textDecoration:UNDERLINE', 'textDecoration:STRIKETHROUGH',
      'textCase:ORIGINAL', 'textCase:UPPER', 'textCase:LOWER', 'textCase:TITLE',
    ]) {
      expect(OPTION_ICON[key], key).toBeTruthy()
    }
  })
})
```

- [x] **Step 2: Run to verify it fails** —
  `pnpm --filter @uidx/viewer test test/field-icons.test.ts` → FAIL (module
  missing).

- [x] **Step 3: Implement.** Line-art on a 12×12 grid, stroke 1.2. These
  paths are a working starter set — Task B6's live pass tunes any that read
  poorly at size, but every name must render *something* legible now:

```ts
import { h, type FunctionalComponent } from 'vue'

/**
 * The inspector's glyph set (story C9): one table of 12×12 stroke paths, one
 * renderer. Icons are data so the theme owns their colour (`currentColor`)
 * and a review can diff a glyph like any other value.
 */
export const ICON_PATHS = {
  rotation: 'M2 10 L2 5 M2 10 L7 10 M2 10 A 6 6 0 0 1 8 4',
  opacity: 'M2 2 H10 V10 H2 Z M2 6 H10 M6 2 V10',
  radius: 'M2 10 V6 A4 4 0 0 1 6 2 H10',
  'radius-corner': 'M2 10 V5 A3 3 0 0 1 5 2 H10',
  'padding-h': 'M2 2 V10 M10 2 V10 M4.5 6 H7.5',
  'padding-v': 'M2 2 H10 M2 10 H10 M6 4.5 V7.5',
  'padding-left': 'M2 2 V10 M4.5 6 H9',
  'padding-right': 'M10 2 V10 M3 6 H7.5',
  'padding-top': 'M2 2 H10 M6 4.5 V9',
  'padding-bottom': 'M2 10 H10 M6 3 V7.5',
  'gap-h': 'M2 2 V10 M10 2 V10 M6 3.5 V8.5',
  'gap-v': 'M2 2 H10 M2 10 H10 M3.5 6 H8.5',
  'stroke-weight': 'M2 3 H10 M2 6.5 H10 M2 9.5 H10',
  blur: 'M6 2 C 8.5 5, 9.5 7, 9.5 8.5 A 3.5 3.5 0 0 1 2.5 8.5 C 2.5 7, 3.5 5, 6 2 Z',
  spread: 'M4 4 H8 V8 H4 Z M2 2 H10 V10 H2 Z',
  'flow-none': 'M3 3 H5 V5 H3 Z M7 5 H9 V7 H7 Z M4 8 H6 V10 H4 Z',
  'flow-vertical': 'M4 2 H8 V4 H4 Z M4 7 H8 V9 H4 Z M6 4.5 V6.5 M5 5.8 L6 6.8 L7 5.8',
  'flow-horizontal': 'M2 4 H4 V8 H2 Z M7 4 H9 V8 H7 Z M4.5 6 H6.5 M5.8 5 L6.8 6 L5.8 7',
  'flow-grid': 'M2.5 2.5 H5 V5 H2.5 Z M7 2.5 H9.5 V5 H7 Z M2.5 7 H5 V9.5 H2.5 Z M7 7 H9.5 V9.5 H7 Z',
  wrap: 'M2 3.5 H10 M2 6.5 H8 A1.8 1.8 0 0 1 8 10 H6 M7 9 L6 10 L7 11',
  'align-left': 'M2 3 H10 M2 6 H7 M2 9 H10',
  'align-center-h': 'M2 3 H10 M3.5 6 H8.5 M2 9 H10',
  'align-right': 'M2 3 H10 M5 6 H10 M2 9 H10',
  'align-justify': 'M2 3 H10 M2 6 H10 M2 9 H10',
  'align-top': 'M2 2 H10 M6 4.5 V10 M4.5 6 L6 4.5 L7.5 6',
  'align-middle': 'M2 6 H10 M6 2 V4.5 M6 7.5 V10',
  'align-bottom': 'M2 10 H10 M6 2 V7.5 M4.5 6 L6 7.5 L7.5 6',
  'resize-none': 'M3 3 H9 V9 H3 Z',
  'resize-height': 'M3 3 H9 M3 9 H9 M6 4.5 V7.5 M5 5.3 L6 4.3 L7 5.3 M5 6.7 L6 7.7 L7 6.7',
  'resize-both': 'M2 2 H6 V6 H2 Z M6 6 L9.5 9.5 M9.5 7 V9.5 H7',
  'resize-truncate': 'M2 6 H5 M6.5 6 H7 M8.5 6 H9 M10 6 H10.2',
  'stroke-inside': 'M2 2 H10 V10 H2 Z M4 4 H8 V8 H4 Z',
  'stroke-center': 'M3 3 H9 V9 H3 Z M2 6 H4 M8 6 H10 M6 2 V4 M6 8 V10',
  'stroke-outside': 'M4 4 H8 V8 H4 Z M2 2 H10 V10 H2 Z M2 2 L4 4 M10 2 L8 4 M2 10 L4 8 M10 10 L8 8',
  'position-auto': 'M2.5 3 H6 V6 H2.5 Z M6 6 H9.5 V9 H6 Z',
  'position-absolute': 'M2 2 H10 V10 H2 Z M5.5 5.5 H10 V10 H5.5 Z',
  italic: 'M5 2 H10 M2 10 H7 M7.5 2 L4.5 10',
  'case-original': 'M2 9 L4.5 3 L7 9 M3 7 H6 M8 5 A1.6 2 0 1 1 8 8.6 M9.6 5 V9',
  'case-upper': 'M2 9 L4.5 3 L7 9 M3 7 H6 M7.5 9 L10 3 M8.3 6.8 H11',
  'case-lower': 'M4 6 A1.8 1.8 0 1 0 4 9.4 M5.8 5.5 V9 M7 6 A1.8 1.8 0 1 0 7 9.4 M8.8 5.5 V9',
  'case-title': 'M2 9 L4.5 3 L7 9 M3 7 H6 M8.2 6 A1.6 1.7 0 1 0 8.2 9.2 M9.8 5.5 V9',
  'deco-none': 'M3 3 C 5 5, 7 5, 9 3 M3 9 C 5 7, 7 7, 9 9',
  'deco-underline': 'M3 2 V6 A3 3 0 0 0 9 6 V2 M2.5 10 H9.5',
  'deco-strike': 'M2 6 H10 M4 3 C 6 2, 8 2.5, 8.5 4 M8 9 C 6 10, 4 9.5, 3.5 8',
  eye: 'M1.5 6 C 3 3.5, 9 3.5, 10.5 6 C 9 8.5, 3 8.5, 1.5 6 Z M6 6 m-1.3 0 a1.3 1.3 0 1 0 2.6 0 a1.3 1.3 0 1 0 -2.6 0',
  'eye-off': 'M1.5 6 C 3 3.5, 9 3.5, 10.5 6 C 9 8.5, 3 8.5, 1.5 6 Z M2.5 9.5 L9.5 2.5',
  expand: 'M2 5 V2 H5 M7 2 H10 V5 M10 7 V10 H7 M5 10 H2 V7',
  droplet: 'M6 1.5 C 8 4.5, 9.5 6.5, 9.5 8 A 3.5 3.5 0 0 1 2.5 8 C 2.5 6.5, 4 4.5, 6 1.5 Z',
} as const

export type IconName = keyof typeof ICON_PATHS

export const FieldIcon: FunctionalComponent<{ name: IconName }> = (props) =>
  h(
    'svg',
    {
      viewBox: '0 0 12 12',
      width: 12,
      height: 12,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    },
    [h('path', { d: ICON_PATHS[props.name] })],
  )
FieldIcon.props = { name: { type: String, required: true } }

export const PROP_ICON: Partial<Record<string, IconName>> = {
  rotation: 'rotation',
  opacity: 'opacity',
  cornerRadius: 'radius',
  cornerSmoothing: 'radius',
  topLeftRadius: 'radius-corner',
  topRightRadius: 'radius-corner',
  bottomLeftRadius: 'radius-corner',
  bottomRightRadius: 'radius-corner',
  itemSpacing: 'gap-h',
  counterAxisSpacing: 'gap-v',
  paddingLeft: 'padding-left',
  paddingRight: 'padding-right',
  paddingTop: 'padding-top',
  paddingBottom: 'padding-bottom',
  strokeWeight: 'stroke-weight',
  strokeTopWeight: 'padding-top',
  strokeRightWeight: 'padding-right',
  strokeBottomWeight: 'padding-bottom',
  strokeLeftWeight: 'padding-left',
  strokeMiterLimit: 'stroke-weight',
  layoutGrow: 'resize-both',
  fontSize: 'case-upper',
  lineHeight: 'gap-v',
  letterSpacing: 'gap-h',
  maxLines: 'align-justify',
  blur: 'blur',
  spread: 'spread',
}

export const OPTION_ICON: Record<string, IconName> = {
  'layoutMode:NONE': 'flow-none',
  'layoutMode:HORIZONTAL': 'flow-horizontal',
  'layoutMode:VERTICAL': 'flow-vertical',
  'layoutMode:GRID': 'flow-grid',
  'layoutWrap:NO_WRAP': 'align-justify',
  'layoutWrap:WRAP': 'wrap',
  'textAlignHorizontal:LEFT': 'align-left',
  'textAlignHorizontal:CENTER': 'align-center-h',
  'textAlignHorizontal:RIGHT': 'align-right',
  'textAlignHorizontal:JUSTIFIED': 'align-justify',
  'textAlignVertical:TOP': 'align-top',
  'textAlignVertical:CENTER': 'align-middle',
  'textAlignVertical:BOTTOM': 'align-bottom',
  'textAutoResize:NONE': 'resize-none',
  'textAutoResize:HEIGHT': 'resize-height',
  'textAutoResize:WIDTH_AND_HEIGHT': 'resize-both',
  'textAutoResize:TRUNCATE': 'resize-truncate',
  'strokeAlign:INSIDE': 'stroke-inside',
  'strokeAlign:CENTER': 'stroke-center',
  'strokeAlign:OUTSIDE': 'stroke-outside',
  'layoutPositioning:AUTO': 'position-auto',
  'layoutPositioning:ABSOLUTE': 'position-absolute',
  'textDecoration:NONE': 'deco-none',
  'textDecoration:UNDERLINE': 'deco-underline',
  'textDecoration:STRIKETHROUGH': 'deco-strike',
  'textCase:ORIGINAL': 'case-original',
  'textCase:UPPER': 'case-upper',
  'textCase:LOWER': 'case-lower',
  'textCase:TITLE': 'case-title',
}
```

- [x] **Step 4: Run to verify it passes**, then commit:

```bash
git add packages/viewer/src/field-icons.ts packages/viewer/test/field-icons.test.ts
git commit -m "Add the inspector glyph set as data (C9)"
```

---

### Task A2: colour math and document swatches in `paint-edit.ts`

**Files:**
- Modify: `packages/viewer/src/paint-edit.ts`
- Modify: `packages/viewer/test/paint-edit.test.ts`

**Interfaces:**
- Produces:

```ts
export interface Hsv { h: number; s: number; v: number }   // h 0–360, s/v 0–1
export function rgbToHsv(color: Rgba): Hsv
export function hsvToRgb(hsv: Hsv, a: number): Rgba
/** Distinct solid paint colours in the document, first-seen order, capped at 24. */
export function documentSwatches(root: UidxNode): Rgba[]
```

- [x] **Step 1: Failing tests** — append to `paint-edit.test.ts`:

```ts
describe('colour math (C9)', () => {
  it('round-trips rgb through hsv', () => {
    for (const c of [
      { r: 1, g: 0, b: 0, a: 1 },
      { r: 0.2, g: 0.4, b: 0.8, a: 0.5 },
      { r: 0, g: 0, b: 0, a: 1 },
      { r: 1, g: 1, b: 1, a: 1 },
    ]) {
      const back = hsvToRgb(rgbToHsv(c), c.a)
      expect(back.r).toBeCloseTo(c.r, 5)
      expect(back.g).toBeCloseTo(c.g, 5)
      expect(back.b).toBeCloseTo(c.b, 5)
      expect(back.a).toBe(c.a)
    }
  })

  it('maps the corners of the SV square', () => {
    expect(hsvToRgb({ h: 0, s: 1, v: 1 }, 1)).toEqual({ r: 1, g: 0, b: 0, a: 1 })
    expect(hsvToRgb({ h: 0, s: 0, v: 1 }, 1)).toEqual({ r: 1, g: 1, b: 1, a: 1 })
    expect(hsvToRgb({ h: 0, s: 1, v: 0 }, 1)).toEqual({ r: 0, g: 0, b: 0, a: 1 })
  })
})

describe('documentSwatches (C9)', () => {
  it('collects distinct solid colours in first-seen order', () => {
    const doc = parseOrThrow(`---
id: sw
---

## Visual Contract

<Page>
  <Frame name="a" fills={[{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }]}>
    <Text name="t" characters="x" fills={[{ type: 'SOLID', color: { r: 0, g: 1, b: 0, a: 1 } }]} />
    <Rectangle name="r" fills={[{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }]} />
  </Frame>
</Page>
`)
    expect(documentSwatches(doc.tree)).toEqual([
      { r: 1, g: 0, b: 0, a: 1 },
      { r: 0, g: 1, b: 0, a: 1 },
    ])
  })
})
```

  (Add `parseOrThrow` and `type UidxNode` to the test's imports from
  `@uidx/format`, and the new functions to the `../src/paint-edit` import.)

- [x] **Step 2: RED**, then **Step 3: implement** in `paint-edit.ts`:

```ts
export interface Hsv {
  h: number
  s: number
  v: number
}

export function rgbToHsv(color: Rgba): Hsv {
  const { r, g, b } = color
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6)
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
  }
  if (h < 0) h += 360
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

export function hsvToRgb(hsv: Hsv, a: number): Rgba {
  const { h, s, v } = hsv
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const [r, g, b] =
    h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x]
  return { r: r + m, g: g + m, b: b + m, a }
}

/** Figma's "on this page": every distinct solid the document already uses. */
export function documentSwatches(root: UidxNode): Rgba[] {
  const seen = new Set<string>()
  const out: Rgba[] = []
  const visit = (node: UidxNode): void => {
    for (const prop of ['fills', 'strokes'] as const) {
      const paints = asPaints((node.attrs[prop]?.value as JsonValue) ?? null) ?? []
      for (const paint of paints) {
        if (paint.type !== 'SOLID' || !paint.color) continue
        const key = JSON.stringify(paint.color)
        if (seen.has(key) || out.length >= 24) continue
        seen.add(key)
        out.push(paint.color)
      }
    }
    node.children.forEach(visit)
  }
  visit(root)
  return out
}
```

  (Add `import type { UidxNode } from '@uidx/format'` alongside the existing
  `JsonValue` import.)

- [x] **Step 4: GREEN + typecheck + commit**

```bash
git add packages/viewer/src/paint-edit.ts packages/viewer/test/paint-edit.test.ts
git commit -m "Colour math and document swatches for the picker (C9)"
```

---

### Task A3: `wheel-step.ts` — the wheel as an instrument

**Files:**
- Create: `packages/viewer/src/wheel-step.ts`
- Create: `packages/viewer/test/wheel-step.test.ts`

**Interfaces:**
- Produces:

```ts
export interface WheelLike { deltaY: number; shiftKey: boolean; altKey: boolean }
/** The value after one wheel event. Scroll up increases. */
export function wheelValue(current: number, event: WheelLike, step: number,
  min?: number, max?: number): number
```

- [x] **Step 1: Failing tests**:

```ts
import { describe, expect, it } from 'vitest'
import { wheelValue } from '../src/wheel-step'

const ev = (deltaY: number, mods: Partial<{ shiftKey: boolean; altKey: boolean }> = {}) => ({
  deltaY,
  shiftKey: false,
  altKey: false,
  ...mods,
})

describe('wheelValue', () => {
  it('steps once per notch, up increases', () => {
    expect(wheelValue(10, ev(-1), 1)).toBe(11)
    expect(wheelValue(10, ev(1), 1)).toBe(9)
  })

  it('multiplies by ten with shift and divides by ten with alt — Figma’s modifiers', () => {
    expect(wheelValue(10, ev(-1, { shiftKey: true }), 1)).toBe(20)
    expect(wheelValue(10, ev(-1, { altKey: true }), 1)).toBeCloseTo(10.1)
  })

  it('respects the prop’s own step', () => {
    expect(wheelValue(0.5, ev(-1), 0.01)).toBeCloseTo(0.51)
  })

  it('clamps to min and max when given', () => {
    expect(wheelValue(1, ev(-1), 1, 0, 1)).toBe(1)
    expect(wheelValue(0, ev(1), 1, 0, 1)).toBe(0)
  })

  it('rounds away float drift at the step’s precision', () => {
    expect(wheelValue(0.3, ev(-1), 0.01)).toBe(0.31)
  })
})
```

- [x] **Step 2: RED**, then **Step 3: implement**:

```ts
export interface WheelLike {
  deltaY: number
  shiftKey: boolean
  altKey: boolean
}

/**
 * One wheel notch, one step — up increases, `Shift` ×10, `Alt` ×0.1,
 * Figma's own modifiers. Pure so the arithmetic (and its float hygiene) is
 * testable without an event loop.
 */
export function wheelValue(
  current: number,
  event: WheelLike,
  step: number,
  min?: number,
  max?: number,
): number {
  const direction = event.deltaY < 0 ? 1 : -1
  const factor = event.shiftKey ? 10 : event.altKey ? 0.1 : 1
  const raw = current + direction * step * factor
  const decimals = Math.max(0, -Math.floor(Math.log10(step * factor)) + 1)
  const rounded = Number(raw.toFixed(Math.min(6, decimals + 2)))
  const low = min ?? Number.NEGATIVE_INFINITY
  const high = max ?? Number.POSITIVE_INFINITY
  return Math.min(high, Math.max(low, rounded))
}
```

- [x] **Step 4: GREEN + commit**

```bash
git add packages/viewer/src/wheel-step.ts packages/viewer/test/wheel-step.test.ts
git commit -m "Pure wheel stepping with Figma's modifiers (C9)"
```

---

### Task A4: `ColorPickerDialog.vue`

**Files:**
- Create: `packages/viewer/src/ColorPickerDialog.vue`
- Modify: `packages/viewer/src/PaintStackField.vue`, `packages/viewer/src/EffectListField.vue`
- Modify: `packages/viewer/src/PropertiesPane.vue` (pass `doc` down for swatches — add a `swatches: Rgba[]` computed and hand it to `PropertyField`, which forwards it)
- Modify: `packages/viewer/test/properties-pane.test.ts`

**Interfaces:**
- Produces: `ColorPickerDialog.vue` with props
  `{ color: Rgba; opacity: number; swatches: Rgba[]; editable: boolean }`,
  emits `{ preview: [color: Rgba, opacity: number]; commit: [color: Rgba, opacity: number]; close: [] }`.
  Markup contract for tests: `.picker-dialog`, `.picker-sv` (the SV area),
  `.picker-hue` and `.picker-alpha` (range inputs), `.picker-hex`,
  `.picker-opacity`, `.picker-eyedropper` (absent when the API is), and
  `.picker-swatch` per document swatch.
- Consumes: `rgbToHsv`, `hsvToRgb`, `colorToHex`, `hexToColor`, `cssColor`
  (Task A2 / C8).

Behaviour, exactly:

- The dialog holds a local `Hsv` mirror of the incoming colour, re-derived
  when props change **except mid-drag** (the drag owns the state).
- SV area: `pointerdown` captures, `pointermove` maps the pointer to
  `s = x/width`, `v = 1 - y/height`, emits `preview`; `pointerup` emits
  `commit`. Hue/alpha are `<input type="range">` (0–360 / 0–100): `input`
  previews, `change` commits. Hex/opacity commit on change; invalid hex sets
  `.invalid` and writes nothing.
- Eyedropper: `if ('EyeDropper' in window)` render the button; on click,
  `new EyeDropper().open()`, convert `sRGBHex` via `hexToColor`, commit.
  Wrap in try/catch — cancelling the dropper rejects.
- A swatch click commits that colour at the current opacity.
- `Escape` or a click on the backdrop emits `close` (the field owning the
  dialog also re-emits the last committed state — closing never loses work
  because previews were never patches).
- Styling: tokens only; the SV thumb and track gradients are inline `:style`
  data (`background: linear-gradient(...)` built from the current hue) —
  data, not design.

The owning fields change like this: `PaintStackField` replaces the
`.paint-popover` native input with
`<ColorPickerDialog v-if="open === i" :color="..." :opacity="paint.opacity ?? 1" ...`
wiring `@preview` → `emit('preview', prop, setPaintColor(...)/setPaintOpacity(...))`
composed, `@commit` → the same through `commit()`, `@close` → `open = null`.
`EffectListField` gains the same dialog on its colour swatch (state
`openColor: number | null`).

- [x] **Step 1: Failing tests** — in `properties-pane.test.ts`, replace the
  C8 picker test and add dialog coverage:

```ts
    it('opens the picker dialog from a swatch; SV drags preview and release commits once', async () => {
      const wrapper = pane()
      await row(wrapper, 'fills').find('.paint-swatch').trigger('click')
      const sv = row(wrapper, 'fills').find('.picker-sv')
      expect(sv.exists()).toBe(true)

      const el = sv.element as HTMLElement
      el.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => '' }) as DOMRect
      Object.assign(el, { setPointerCapture: () => {}, releasePointerCapture: () => {} })

      const point = async (type: string, x: number, y: number) => {
        const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true })
        Object.defineProperty(event, 'pointerId', { value: 1 })
        el.dispatchEvent(event)
        await wrapper.vm.$nextTick()
      }
      await point('pointerdown', 100, 0)   // s=1, v=1 → pure hue
      expect(wrapper.emitted('preview')!.length).toBeGreaterThan(0)
      expect(wrapper.emitted('commit')).toBeUndefined()
      await point('pointerup', 100, 0)
      expect(wrapper.emitted('commit')).toHaveLength(1)
      // fills was red → hue 0, s=1 v=1 stays pure red
      expect(wrapper.emitted('commit')![0]).toEqual([
        'Card#root', 'fills', [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }],
      ])
    })

    it('commits a document swatch with one click', async () => {
      const wrapper = pane()
      await row(wrapper, 'fills').find('.paint-swatch').trigger('click')
      const swatches = row(wrapper, 'fills').findAll('.picker-swatch')
      expect(swatches.length).toBeGreaterThan(0)
      await swatches[0]!.trigger('click')
      expect(wrapper.emitted('commit')).toHaveLength(1)
    })

    it('refuses invalid hex in the dialog without writing', async () => {
      const wrapper = pane()
      await row(wrapper, 'fills').find('.paint-swatch').trigger('click')
      await row(wrapper, 'fills').find('.picker-hex').setValue('nope')
      expect(wrapper.emitted('commit')).toBeUndefined()
      expect(row(wrapper, 'fills').find('.picker-hex.invalid').exists()).toBe(true)
    })
```

- [x] **Step 2: RED.**

- [x] **Step 3: Implement the dialog.** Full component:

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  colorToHex,
  cssColor,
  hexToColor,
  hsvToRgb,
  rgbToHsv,
  type Hsv,
  type Rgba,
} from './paint-edit'

/**
 * Figma's colour dialog (story C9): SV area, hue and alpha, hex + opacity,
 * the eyedropper where the browser has one, and the document's own colours.
 * Continuous gestures preview; settling commits — the C4 discipline, which
 * is also why closing mid-drag loses nothing: previews were never patches.
 */
const props = defineProps<{
  color: Rgba
  opacity: number
  swatches: Rgba[]
  editable: boolean
}>()

const emit = defineEmits<{
  preview: [color: Rgba, opacity: number]
  commit: [color: Rgba, opacity: number]
  close: []
}>()

const hsv = ref<Hsv>(rgbToHsv(props.color))
const alpha = ref(props.color.a)
const dragging = ref(false)
const invalidHex = ref(false)

watch(
  () => props.color,
  (color) => {
    if (dragging.value) return
    hsv.value = rgbToHsv(color)
    alpha.value = color.a
  },
)

const current = (): Rgba => hsvToRgb(hsv.value, alpha.value)
const hueColor = computed(() => cssColor(hsvToRgb({ h: hsv.value.h, s: 1, v: 1 }, 1)))

function svFromPointer(event: PointerEvent, el: HTMLElement): void {
  const rect = el.getBoundingClientRect()
  const s = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  const v = 1 - Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
  hsv.value = { ...hsv.value, s, v }
}

function onSvDown(event: PointerEvent): void {
  if (!props.editable) return
  const el = event.currentTarget as HTMLElement
  dragging.value = true
  el.setPointerCapture?.(event.pointerId)
  svFromPointer(event, el)
  emit('preview', current(), props.opacity)
}
function onSvMove(event: PointerEvent): void {
  if (!dragging.value) return
  svFromPointer(event, event.currentTarget as HTMLElement)
  emit('preview', current(), props.opacity)
}
function onSvUp(event: PointerEvent): void {
  if (!dragging.value) return
  dragging.value = false
  ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
  emit('commit', current(), props.opacity)
}

function onHue(event: Event, done: boolean): void {
  hsv.value = { ...hsv.value, h: Number((event.target as HTMLInputElement).value) }
  emit(done ? 'commit' : 'preview', current(), props.opacity)
}
function onAlpha(event: Event, done: boolean): void {
  alpha.value = Number((event.target as HTMLInputElement).value) / 100
  emit(done ? 'commit' : 'preview', current(), props.opacity)
}
function onHex(event: Event): void {
  const parsed = hexToColor((event.target as HTMLInputElement).value, alpha.value)
  if (!parsed) {
    invalidHex.value = true
    return
  }
  invalidHex.value = false
  hsv.value = rgbToHsv(parsed)
  emit('commit', current(), props.opacity)
}
function onOpacity(event: Event): void {
  const pct = Number(String((event.target as HTMLInputElement).value).replace('%', ''))
  if (!Number.isFinite(pct)) return
  emit('commit', current(), Math.min(100, Math.max(0, pct)) / 100)
}

const hasEyeDropper = 'EyeDropper' in globalThis
async function onEyedrop(): Promise<void> {
  try {
    const Dropper = (globalThis as Record<string, unknown>).EyeDropper as new () => {
      open(): Promise<{ sRGBHex: string }>
    }
    const picked = await new Dropper().open()
    const color = hexToColor(picked.sRGBHex, alpha.value)
    if (!color) return
    hsv.value = rgbToHsv(color)
    emit('commit', current(), props.opacity)
  } catch {
    /* cancelled — nothing to do */
  }
}

function onSwatch(color: Rgba): void {
  hsv.value = rgbToHsv(color)
  alpha.value = color.a
  emit('commit', current(), props.opacity)
}
</script>

<template>
  <div class="picker-dialog" @keydown.escape="emit('close')">
    <div
      class="picker-sv"
      :style="{
        background: `linear-gradient(to top, rgb(0 0 0), transparent),
          linear-gradient(to right, rgb(255 255 255), ${hueColor})`,
      }"
      @pointerdown="onSvDown"
      @pointermove="onSvMove"
      @pointerup="onSvUp"
    >
      <span
        class="picker-thumb"
        :style="{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: cssColor(current()) }"
      />
    </div>

    <div class="picker-row">
      <button
        v-if="hasEyeDropper"
        type="button"
        class="picker-eyedropper"
        title="pick a colour from the screen"
        aria-label="eyedropper"
        :disabled="!editable"
        @click="onEyedrop"
      >
        ⌖
      </button>
      <div class="picker-sliders">
        <input
          class="picker-hue"
          type="range"
          min="0"
          max="360"
          :value="hsv.h"
          :disabled="!editable"
          aria-label="hue"
          @input="onHue($event, false)"
          @change="onHue($event, true)"
        />
        <input
          class="picker-alpha"
          type="range"
          min="0"
          max="100"
          :value="Math.round(alpha * 100)"
          :disabled="!editable"
          aria-label="alpha"
          @input="onAlpha($event, false)"
          @change="onAlpha($event, true)"
        />
      </div>
    </div>

    <div class="picker-row">
      <input
        class="picker-hex"
        :class="{ invalid: invalidHex }"
        type="text"
        :value="colorToHex(current())"
        :disabled="!editable"
        aria-label="hex"
        @change="onHex"
      />
      <input
        class="picker-opacity"
        type="text"
        :value="`${Math.round(opacity * 100)}%`"
        :disabled="!editable"
        aria-label="opacity"
        @change="onOpacity"
      />
    </div>

    <div v-if="swatches.length" class="picker-swatches" aria-label="on this page">
      <button
        v-for="(swatch, i) in swatches"
        :key="i"
        type="button"
        class="picker-swatch"
        :style="{ background: cssColor(swatch) }"
        :title="colorToHex(swatch)"
        :disabled="!editable"
        @click="onSwatch(swatch)"
      />
    </div>
  </div>
</template>

<style scoped>
.picker-dialog {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 10;
  width: 200px;
  display: flex;
  flex-direction: column;
  gap: var(--gap);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: var(--gap);
  box-shadow: var(--shadow);
}
.picker-sv {
  position: relative;
  width: 100%;
  height: 120px;
  border-radius: var(--radius);
  cursor: crosshair;
  touch-action: none;
}
.picker-thumb {
  position: absolute;
  width: 10px;
  height: 10px;
  border: 1.5px solid var(--text);
  border-radius: 999px;
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.picker-row {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
}
.picker-sliders {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
}
.picker-hue,
.picker-alpha {
  width: 100%;
  height: 10px;
  accent-color: var(--accent);
}
.picker-eyedropper {
  flex: none;
  width: 24px;
  height: 24px;
  background: var(--raised);
  border: 1px solid transparent;
  border-radius: var(--radius);
  color: var(--text);
  cursor: pointer;
}
.picker-hex {
  flex: 1;
  min-width: 0;
}
.picker-opacity {
  flex: none;
  width: 48px;
  text-align: right;
}
.picker-hex,
.picker-opacity {
  height: var(--field-h);
  box-sizing: border-box;
  background: var(--raised);
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  color: var(--text);
  font-family: var(--ui-font);
  font-size: var(--ui-size);
  padding: 2px 6px;
}
.picker-hex:focus,
.picker-opacity:focus {
  outline: none;
  border-color: var(--accent);
}
.picker-hex.invalid {
  border-color: var(--danger);
}
.picker-swatches {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: var(--gap-sm);
}
.picker-swatch {
  aspect-ratio: 1;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  cursor: pointer;
  padding: 0;
}
button:disabled,
input:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
```

- [x] **Step 4: Wire the owners.** In `PaintStackField.vue`: props gain
  `swatches: Rgba[]`; the popover becomes

```vue
      <ColorPickerDialog
        v-if="open === i && paint.type === 'SOLID'"
        :color="paint.color ?? { r: 0.5, g: 0.5, b: 0.5, a: 1 }"
        :opacity="paint.opacity ?? 1"
        :swatches="swatches"
        :editable="editable"
        @preview="(c, o) => emitPreviewColor(i, c, o)"
        @commit="(c, o) => commitColor(i, c, o)"
        @close="open = null"
      />
```

  with the two handlers composing `setPaintColor`/`setPaintOpacity`:

```ts
function emitPreviewColor(index: number, color: Rgba, opacity: number): void {
  if (!props.editable) return
  const withColor = asPaints(setPaintColor(paints(), index, color))!
  emit('preview', props.field.name, setPaintOpacity(withColor, index, opacity))
}
function commitColor(index: number, color: Rgba, opacity: number): void {
  const withColor = asPaints(setPaintColor(paints(), index, color))!
  commit(setPaintOpacity(withColor, index, opacity))
}
```

  `EffectListField.vue` swaps its `input[type=color]` swatch for a button
  opening the same dialog (state `openColor: number | null`), committing via
  `setEffectColor`. `PropertyField.vue` forwards a new `swatches` prop to
  both; `PropertiesPane.vue` computes it once:

```ts
const swatches = computed(() => (props.doc ? documentSwatches(props.doc.tree) : []))
```

  and passes `:swatches="swatches"` to every `PropertyField`.

- [x] **Step 5: GREEN** — dialog tests, then the whole viewer suite and
  typecheck. **Step 6: Commit**

```bash
git add packages/viewer/src packages/viewer/test/properties-pane.test.ts
git commit -m "The colour picker becomes Figma's dialog (C9)"
```

---

### Task A5: number fields become instruments

**Files:**
- Modify: `packages/viewer/src/PropertyField.vue`
- Modify: `packages/viewer/src/EffectListField.vue`
- Modify: `packages/viewer/test/properties-pane.test.ts`

**Interfaces:**
- Consumes: `wheelValue` (A3), `PROP_ICON`/`FieldIcon` (A1), `propUiFor`
  (min/max/step).
- Produces: every `control === 'number'` field renders
  `.field-glyph` (icon or letter) inside the box when `PROP_ICON[name]` or
  `FIELD_PREFIX[name]` exists; the glyph scrubs
  (`actions.startScrub`); the box handles `@wheel.prevent` →
  `preview` per tick + one `commit` after 400ms of rest. Effect
  X/Y/blur/spread move onto `NumberFieldRoot` with glyphs
  (`blur`, `spread`, `padding-left`-style letters X/Y) and the same wheel.

Wheel wiring in `PropertyField.vue` (script):

```ts
import { wheelValue } from './wheel-step'
import { FieldIcon, PROP_ICON } from './field-icons'

let wheelTimer: ReturnType<typeof setTimeout> | null = null
function onWheel(event: WheelEvent): void {
  if (!props.editable) return
  const ui = propUiFor(props.field.name)
  const next = wheelValue(numberValue(), event, ui?.step ?? 1, ui?.min, ui?.max)
  emit('preview', props.field.name, next)
  if (wheelTimer) clearTimeout(wheelTimer)
  wheelTimer = setTimeout(() => emit('commit', props.field.name, next), 400)
}
```

  Template: the number branch's `.number` span gains
  `@wheel.prevent="onWheel"`; before the input/scrub, render

```vue
      <span
        v-if="compact || PROP_ICON[field.name]"
        class="prefix field-glyph"
        :class="{ disabled: !editable }"
        :title="field.name"
        @pointerdown="actions.startScrub($event)"
      >
        <FieldIcon v-if="PROP_ICON[field.name]" :name="PROP_ICON[field.name]!" />
        <template v-else>{{ prefix() }}</template>
      </span>
```

  (replacing the existing compact-only prefix span; `prefix()` still serves
  X/Y/W/H letters).

- [x] **Step 1: Failing tests**:

```ts
  describe('number instruments (C9)', () => {
    it('renders a glyph inside a prop that has one, with a tooltip', () => {
      const wrapper = pane()
      const glyph = row(wrapper, 'itemSpacing').find('.field-glyph')
      expect(glyph.exists()).toBe(true)
      expect(glyph.attributes('title')).toBe('itemSpacing')
      expect(glyph.find('svg').exists()).toBe(true)
    })

    it('wheel previews per tick and commits once after rest', async () => {
      vi.useFakeTimers()
      const wrapper = pane()
      const box = row(wrapper, 'itemSpacing').find('.number')
      await box.trigger('wheel', { deltaY: -1 })
      await box.trigger('wheel', { deltaY: -1 })
      expect(wrapper.emitted('preview')).toHaveLength(2)
      expect(wrapper.emitted('commit')).toBeUndefined()
      vi.advanceTimersByTime(450)
      expect(wrapper.emitted('commit')).toHaveLength(1)
      vi.useRealTimers()
    })

    it('shift multiplies the wheel step by ten', async () => {
      const wrapper = pane()
      // itemSpacing authored 8 in this fixture
      await row(wrapper, 'itemSpacing').find('.number').trigger('wheel', { deltaY: -1, shiftKey: true })
      expect(wrapper.emitted('preview')![0]).toEqual(['Card#root', 'itemSpacing', 18])
    })

    it('effect numbers scrub like everything else now', () => {
      const effects = row(pane(), 'effects')
      expect(effects.find('.effect-radius .scrub').exists()).toBe(true)
    })
  })
```

  (Fixture: add `itemSpacing={8}` to `Card#root` in the test DOC; import
  `vi` from vitest.)

- [x] **Step 2: RED. Step 3:** implement the PropertyField wiring above, and
  rebuild `EffectListField`'s number boxes on `NumberFieldRoot` — each of
  the four fields becomes the same slot markup PropertyField's number branch
  uses (input when editing, `.scrub` span otherwise), classed
  `effect-x` / `effect-y` / `effect-radius` / `effect-spread`, wired
  `@update:model-value` → `emit('preview', field.name, setEffectField(...))`
  and `@commit` → `commit(setEffectField(...))`, with the `blur`/`spread`
  glyphs and X/Y letters as their prefixes and the same `@wheel.prevent`
  handler (local, calling `setEffectField` with the wheeled value, debounced
  commit).

- [x] **Step 4: GREEN + full viewer suite + typecheck. Step 5: Commit**

```bash
git add packages/viewer/src packages/viewer/test/properties-pane.test.ts
git commit -m "Number fields scrub on their glyphs and answer the wheel (C9)"
```

**Phase A gate:** `pnpm format:check && pnpm lint && pnpm typecheck && pnpm build && pnpm test`
all green, plus a live smoke: open the viewer, pick a colour from the SV
area (canvas recolours during the drag, one revision on release), wheel a
padding field. Commit any live-pass fixes before starting Phase B.

---

## Phase B — sections and hover

### Task B1: `hover-map.ts` + the hover plumbing

**Files:**
- Create: `packages/viewer/src/hover-map.ts`
- Create: `packages/viewer/test/hover-map.test.ts`
- Modify: `packages/viewer/src/PropertyField.vue`, `PropertiesPane.vue`,
  `App.vue`, `CanvasPane.vue`

**Interfaces:**
- Produces:

```ts
export type HoverTarget =
  | { kind: 'node' }
  | { kind: 'spacing-value' }
  | { kind: 'padding-value'; side: 'top' | 'right' | 'bottom' | 'left' }
  | { kind: 'children' }
/** What the canvas should light up while this prop's control is hovered. Null: nothing. */
export function hoverTargetFor(prop: string): HoverTarget | null
```

  Mapping: `itemSpacing`/`counterAxisSpacing` → `spacing-value`;
  `padding<Side>` → `padding-value` with the side;
  `layoutMode`/`layoutWrap`/`primaryAxisAlignItems`/`counterAxisAlignItems`/
  `counterAxisAlignContent` → `children`; `x`/`y`/`width`/`height`/
  `rotation`/`cornerRadius`/the four corner radii/`minWidth`…`maxHeight` →
  `node`; everything else → null.

- Event chain: `PropertyField` emits `hover: [prop: string | null]` on
  `mouseenter`(prop)/`mouseleave`(null) of its root controls;
  `PropertiesPane` re-emits `hover: [address, prop | null]`; `App.vue`
  forwards to `canvasPane.value?.applyHover(address, prop)`; `CanvasPane`
  exposes `applyHover` via `defineExpose`:

```ts
function applyHover(address: string, prop: string | null): void {
  const id = scene.value?.addresses.sceneIdOf(address)
  const target = prop ? hoverTargetFor(prop) : null
  if (!id || !target) {
    editor.setAutoLayoutHover(null)
    editor.setHoveredNode(null)
  } else if (target.kind === 'node') {
    editor.setAutoLayoutHover(null)
    editor.setHoveredNode(id)
  } else {
    editor.setHoveredNode(null)
    editor.setAutoLayoutHover(
      target.kind === 'padding-value'
        ? { nodeId: id, kind: 'padding-value', side: target.side }
        : { nodeId: id, kind: target.kind },
    )
  }
  canvas.renderNow()
}
```

- [x] **Step 1: failing pure tests** (`hover-map.test.ts`): assert the table
  above — one `it` per family, e.g.
  `expect(hoverTargetFor('paddingTop')).toEqual({ kind: 'padding-value', side: 'top' })`,
  `expect(hoverTargetFor('fills')).toBeNull()`.
- [x] **Step 2: RED. Step 3:** implement `hover-map.ts` (a literal record +
  function) and the event chain. In the pane test, assert the pane re-emits:
  `await row(wrapper, 'itemSpacing').trigger('mouseenter')` →
  `wrapper.emitted('hover')` ends with `['Card#root', 'itemSpacing']`, and
  `mouseleave` appends `['Card#root', null]`.
- [x] **Step 4: GREEN + typecheck. Step 5: Commit**

```bash
git add packages/viewer/src packages/viewer/test
git commit -m "Panel hover lights the canvas through the SDK overlays (C9)"
```

### Task B2: `edit-models.ts` — padding and corner collapse

**Files:**
- Create: `packages/viewer/src/edit-models.ts`
- Create: `packages/viewer/test/edit-models.test.ts`

**Interfaces:**
- Produces:

```ts
export interface SideValues { top: number; right: number; bottom: number; left: number }
export interface CollapsedModel {
  /** Both members equal → one field; else null and the UI expands. */
  horizontal: number | null   // left/right (padding) — or all four for corners
  vertical: number | null
}
export function paddingModel(values: SideValues): CollapsedModel
/** The prop-name→value writes one collapsed field implies. */
export function paddingWrites(axis: 'horizontal' | 'vertical', value: number):
  Array<{ prop: string; value: number }>
export interface CornerModel { uniform: number | null }   // all four equal → one field
export function cornerModel(values: SideValues): CornerModel
export function cornerWrites(value: number): Array<{ prop: string; value: number }>
```

  `paddingWrites('horizontal', 12)` →
  `[{prop:'paddingLeft',value:12},{prop:'paddingRight',value:12}]`;
  `cornerWrites(8)` → the four corner-radius props. The component emits one
  `commit` per entry in the same tick; patch-burst makes it one envelope.

- [x] **Step 1: failing tests** — collapse when equal, null when not,
  writes enumerate the right props. **Step 2: RED. Step 3: implement**
  (straightforward comparisons; keep the four-prop name lists here and
  nowhere else). **Step 4: GREEN. Step 5: Commit**

```bash
git add packages/viewer/src/edit-models.ts packages/viewer/test/edit-models.test.ts
git commit -m "Pure collapse models for padding and corners (C9)"
```

### Task B3: `AlignmentMatrix.vue` + icon segments

**Files:**
- Create: `packages/viewer/src/AlignmentMatrix.vue`
- Modify: `packages/viewer/src/PropertyField.vue` (segmented items render
  `OPTION_ICON` glyphs with tooltips when one exists)
- Modify: `packages/viewer/test/properties-pane.test.ts`

**AlignmentMatrix** — props
`{ primary: string; counter: string; layoutMode: string; editable: boolean }`,
emits `commit: [writes: Array<{ prop: string; value: string }>]`. Renders a
3×3 grid of dot buttons; cell (row, col) maps to
(`primaryAxisAlignItems`, `counterAxisAlignItems`) with the axis orientation
decided by `layoutMode` (HORIZONTAL: columns = primary MIN/CENTER/MAX, rows
= counter; VERTICAL: transposed). The active cell shows the bar glyph, the
rest dots (Figma's affordance). `SPACE_BETWEEN` on the primary axis renders
as the distributed row/column variant via a fourth state on the active
axis toggle beneath the grid (a small icon segment: packed / space-between).
Every button: `title` naming both values. One click emits both writes; the
pane turns each into a `commit` in the same tick.

Icon segments in `PropertyField`: the segmented branch's item body becomes

```vue
      <FieldIcon
        v-if="OPTION_ICON[`${field.name}:${option}`]"
        :name="OPTION_ICON[`${field.name}:${option}`]!"
      />
      <template v-else>{{ option }}</template>
```

  (the `:title="option"` tooltip already exists from C6).

- [x] **Step 1: failing tests** — matrix renders 9 cells for `Card#root`;
  clicking the center cell emits commits for both axis props
  (`['Card#root','primaryAxisAlignItems','CENTER']` and the counter twin —
  assert both appear in `emitted('commit')`); `layoutMode` segments render
  `svg` icons and keep their `title`.
- [x] **Step 2: RED. Step 3: implement. Step 4: GREEN. Step 5: Commit**

```bash
git add packages/viewer/src packages/viewer/test
git commit -m "The 9-dot alignment matrix and icon segments (C9)"
```

### Task B4: the Auto layout section rebuilt

**Files:**
- Create: `packages/viewer/src/SizeField.vue`, `packages/viewer/src/PaddingField.vue`
- Create: `packages/viewer/src/size-model.ts` + test
- Modify: `packages/viewer/src/PropertiesPane.vue`
- Modify: `packages/viewer/test/properties-pane.test.ts`

**`size-model.ts`:**

```ts
/** Which sizing prop governs this dimension under this layout mode. */
export function sizingPropFor(layoutMode: string, dimension: 'width' | 'height'):
  'primaryAxisSizingMode' | 'counterAxisSizingMode'
// HORIZONTAL: width→primary, height→counter; VERTICAL and everything else: transposed.
```

**`SizeField.vue`** — props `{ dimension, value, sizingMode, editable }`,
emits `preview/commit` with prop names resolved through `size-model`. Renders
the letter, the number (NumberFieldRoot, wheel), and — for frames — the
`Hug`/`Fixed` state as a compact `<select>` inside the box (`FIXED`→"Fixed",
`AUTO`→"Hug", Figma's words) writing the sizing prop.

**`PaddingField.vue`** — props `{ values: SideValues, expanded, editable }`
+ `update:expanded`, emits `commit` per prop write. Collapsed: two boxes
(`padding-h`/`padding-v` glyphs) from `paddingModel`, each committing its
`paddingWrites` pair; the `expand` glyph button toggles; expanded: four
boxes with per-side glyphs. Opens expanded automatically when the sides
disagree (`paddingModel` returns null for that axis).

**PropertiesPane** — the `layout` section body stops being generic rows for
the props these components own. Implementation: a `HANDLED_BY_SECTION` set
(`layoutMode`, sizing modes, align items props, itemSpacing when… no —
keep gap generic, it is already an instrument) — precisely:
`primaryAxisSizingMode`, `counterAxisSizingMode`, `primaryAxisAlignItems`,
`counterAxisAlignItems`, `paddingLeft/Right/Top/Bottom`, `width`, `height`
render through the rebuilt rows (Flow row is the generic `layoutMode` field,
already icon-segmented). The section template renders, in order: flow field,
Resizing row (two `SizeField`s, fed from the position fields' values),
Alignment matrix + gap field side by side, `PaddingField`, remaining fields
(wrap, clip, spacing extras) as generic rows. All values read from the same
`fields` computed; nothing new is written to `editable.ts`.

- [x] **Step 1: failing tests** — `sizingPropFor` pure cases; pane: the
  layout section shows `.size-field` W with `Hug`/`Fixed` select whose
  change commits the right sizing prop for the fixture's layoutMode;
  padding collapsed shows two boxes when symmetric and committing the H box
  emits both left+right commits; expanded shows four.
- [x] **Step 2: RED. Step 3: implement. Step 4: GREEN + full suite.
  Step 5: Commit**

```bash
git add packages/viewer/src packages/viewer/test
git commit -m "Auto layout rebuilt to the reference: resizing, matrix, padding pairs (C9)"
```

### Task B5: the Appearance section rebuilt

**Files:**
- Create: `packages/viewer/src/CornerField.vue`
- Modify: `packages/viewer/src/PropertiesPane.vue`, `PropertyField.vue`
- Modify: `packages/viewer/test/properties-pane.test.ts`

- **`CornerField.vue`** — mirror of `PaddingField` over `cornerModel`:
  one box with the `radius` glyph when uniform; `expand` toggles four
  per-corner boxes (`radius-corner` glyph, rotated per corner via CSS
  transform) plus `cornerSmoothing` as a percent field, only when expanded.
  A uniform commit writes `cornerRadius` alone when only `cornerRadius` is
  authored; when per-corner props are authored it writes `cornerWrites`.
- **Opacity as percent** — in `PropertyField`, a `PERCENT_PROPS` set
  (`opacity`, `cornerSmoothing`): display ×100 with `%`, wheel/scrub in
  percent steps, commits ÷100.
- **The eye on the header** — `PropertiesPane`'s section header row, for the
  `appearance` group, renders an eye button (`eye`/`eye-off` glyph) showing
  the node's effective `visible` (field value, default true) and committing
  the toggle; the `visible` checkbox row disappears from the section body
  (filter it from the generic rows).
- **Blend mode** — its generic select row gains the `droplet` glyph via
  `PROP_ICON` (add `blendMode: 'droplet'` to the table) rendered beside the
  label.

- [x] **Step 1: failing tests** — opacity shows `50%` for the fixture's
  `0.5` and a wheel tick previews `0.51`; the appearance header has
  `.section-eye` whose click commits `['Card#root','visible',false]`; the
  `visible` row is gone from the body; corner field expands and a uniform
  edit writes one prop.
- [x] **Step 2: RED. Step 3: implement. Step 4: GREEN + full suite.
  Step 5: Commit**

```bash
git add packages/viewer/src packages/viewer/test
git commit -m "Appearance rebuilt: percent opacity, corner collapse, the header eye (C9)"
```

### Task B6: gate, live verification, backlog

- [x] **Step 1:** full monorepo gate:
  `pnpm format:check && pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm build:cli && pnpm check:examples`.
- [x] **Step 2:** live pass against the spec's Done-when, on a scratch copy
  (never a repo example): SV-drag recolours the canvas live and lands one
  line; wheel on numbers → one patch per pause; hover padding → the band
  lights; matrix one-click writes both axes atomically (check the diff);
  W/H show `Hug`; padding pairs collapse and expand; every icon tooltips.
  **Tune any glyph that reads poorly at 12px — this step owns icon
  quality.** Fix-and-commit anything found before proceeding.
- [x] **Step 3:** update `docs/backlog.md` — C9 entry (✅ done, what
  shipped, deviations if any), roadmap pointer moves to C10, test counts in
  backlog + README refreshed from the actual `pnpm test` totals.
- [x] **Step 4:** Commit:

```bash
git add docs/backlog.md README.md
git commit -m "Record C9 as shipped"
```

---

## Self-review notes

- **Spec coverage:** picker dialog §1 → A4 (SV/hue/alpha/hex/opacity/
  eyedropper/swatches, preview-commit discipline); instruments §2 → A1+A3+A5
  (glyph scrub handles, wheel with modifiers, effect numbers promoted);
  hover §3 → B1 (the exact overlay kinds); icons-everywhere §4 → A1+B3
  (OPTION_ICON drives segments, tooltips kept); Auto layout §5 → B2+B3+B4
  (flow icons, SizeField Hug/Fixed, matrix+gap, paddingModel, clip);
  Appearance §6 → B5 (percent opacity, cornerModel+smoothing, header eye,
  droplet); inventory appendix rows either land in these tasks or are named
  out-of-scope in the spec itself.
- **Multi-prop atomicity** rides on `patch-burst` (C8's fix): N commits in
  one tick → one envelope. No new dispatch machinery — verified live in B6
  by reading the matrix click's diff.
- **Type consistency:** `Rgba`/`Hsv` from `paint-edit.ts` are the only
  colour types; `SideValues`/`CollapsedModel` cross B2→B4/B5;
  `HoverTarget` crosses B1's module→CanvasPane; `IconName` crosses A1→A5/B3.
- **Known risks, owned in-plan:** hand-drawn glyph quality (B6 Step 2 owns
  tuning), `setAutoLayoutHover`'s exact runtime shape (B1 verifies live
  before the API is leaned on further), fake timers with VTU in A5 (if
  `vi.useFakeTimers` fights the wheel debounce, switch the test to a real
  100ms debounce interval override via an exported `WHEEL_COMMIT_MS`
  constant — export it from `wheel-step.ts` and read it in PropertyField so
  the test can shrink it).
