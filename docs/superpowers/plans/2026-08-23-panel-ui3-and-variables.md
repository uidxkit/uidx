# Panel UI3 Look + Variables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the properties panel to Figma UI3's geometry, replace the property menu with Figma's searchable assignment popup listing properties *and* variables, and make variables bindable end to end — including color variables inside fills and strokes.

**Architecture:** Three shippable stages. Stage 1 is presentation only (theme tokens, label-above field blocks, header icon clusters, pill-row anatomy). Stage 2 adds `AssignPopup.vue` — one shared popup hosted by every binding surface — plus `variable-binding.ts`, which turns the tokens map into typed, previewed candidates and a variable choice into patches. Stage 3 teaches `@uidx/schema` to resolve aliases *inside* paint objects, renders token pills, and gives the color picker a Libraries tab.

**Tech Stack:** Vue 3 + `@open-pencil/vue` headless primitives, Vitest + @vue/test-utils (jsdom), pnpm workspace.

**Spec:** `docs/panel-ui3-and-variables.md` (continues `docs/panel-figma-parity.md`). Read both before starting.

## Global Constraints

- **Node:** tests fail with ERR_REQUIRE_ESM on the default node 18. Prefix every test command: `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"` (once per shell).
- **Branch:** work directly on `main`, commit per task. No worktree, no feature branch.
- **Test commands:** `pnpm --filter @uidx/viewer test` and `pnpm --filter @uidx/schema test` (they run `vitest run`); single file: append the path, e.g. `pnpm --filter @uidx/viewer test test/properties-pane.test.ts`. Typecheck: `pnpm --filter @uidx/viewer typecheck`.
- **No raw colors in viewer components** — every color/size/spacing is a `theme.css` token (that file's own header rule).
- **Patches always key on the authored prop name** (`characters`, not "Content"); display names are presentation (`PropUi.label`).
- **Property vs token binding test:** a token's address contains `#`, a property name may not. This distinction is used all over; keep it.
- **Existing behavior that must not regress:** the three property-apply flows (Content / eye / instance swap), token scrubbing detach on numbers, per-section collapse state, C4's preview/commit split.

## File Structure

| File | Role |
|---|---|
| `packages/viewer/src/theme.css` | modify — rhythm tokens for UI3 chrome |
| `packages/viewer/src/field-icons.ts` | modify — 5 new glyphs |
| `packages/viewer/src/PropertiesPane.vue` | modify — field blocks, captions, header clusters, popup wiring, edit-property dialog |
| `packages/viewer/src/PropertyField.vue` | modify — caption labels, token pill, number-field variable affordance |
| `packages/viewer/src/PropertyLink.vue` | modify — pill click opens popup, ◎ edit button; inline menu removed |
| `packages/viewer/src/AssignPopup.vue` | create — the shared assignment popup (search + properties + variables) |
| `packages/viewer/src/VariableRow.vue` | create — one variable row (glyph/swatch + name + preview), shared with the color picker |
| `packages/viewer/src/variable-binding.ts` | create — variable candidates from the tokens map; variable → patches |
| `packages/viewer/src/paint-edit.ts` | modify — alias-aware paint helpers |
| `packages/viewer/src/PaintStackField.vue` | modify — alias-aware rows, `+` moves out, Libraries wiring |
| `packages/viewer/src/EffectListField.vue` | modify — `+` moves out |
| `packages/viewer/src/ColorPickerDialog.vue` | modify — Custom \| Libraries tabs |
| `packages/schema/src/to-scene.ts` | modify — paint-level alias resolution |
| `packages/schema/src/prop-ui.ts` | modify — `lineHeight` ⇄ `letterSpacing` pair |
| Tests | `packages/viewer/test/variable-binding.test.ts` (create), `assign-popup.test.ts` (create), plus named modifications below |

---

## Stage 1 — the UI3 look

### Task 1: Theme rhythm, section chrome, and the new glyphs

Presentation tokens plus the icon data every later task draws with. No behavior.

**Files:**
- Modify: `packages/viewer/src/theme.css`
- Modify: `packages/viewer/src/field-icons.ts`
- Modify: `packages/viewer/src/PropertiesPane.vue` (styles only)
- Test: `packages/viewer/test/field-icons.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: theme tokens `--field-h: 28px`, `--radius-lg: 5px`, `--section-pad: 16px`; icon names `'search' | 'close' | 'plus' | 'variable' | 'variables-grid'` valid as `IconName`; a `.cluster-btn` class in `PropertiesPane.vue` for 24×24 header icon buttons.

- [ ] **Step 1: Extend the icon test with the new glyph names**

In `packages/viewer/test/field-icons.test.ts`, add to the existing `describe`:

```ts
it('carries the popup and header glyphs the UI3 pass added', () => {
  for (const name of ['search', 'close', 'plus', 'variable', 'variables-grid'] as const) {
    expect(ICON_PATHS[name], name).toBeTruthy()
  }
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @uidx/viewer test test/field-icons.test.ts`
Expected: FAIL — the five names are not in `ICON_PATHS` (TypeScript may refuse the `as const` array first; that is the same failure).

- [ ] **Step 3: Add the glyphs to `ICON_PATHS`**

In `packages/viewer/src/field-icons.ts`, append inside `ICON_PATHS` (12×12 stroke style like their neighbors):

```ts
  // The UI3 pass (spec §5): the popup's chrome and the variable glyphs.
  search: 'M5.2 1.8 A 3.4 3.4 0 1 1 5.2 8.6 A 3.4 3.4 0 1 1 5.2 1.8 M7.8 7.8 L10.5 10.5',
  close: 'M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5',
  plus: 'M6 2 V10 M2 6 H10',
  variable: 'M2.5 2.5 H9.5 V9.5 H2.5 Z M4.8 4 L4.2 8 M7.8 4 L7.2 8 M3.5 5.2 H8.7 M3.3 6.8 H8.5',
  'variables-grid': 'M3.2 3.2 m-1 0 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0 M8.8 3.2 m-1 0 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0 M3.2 8.8 m-1 0 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0 M8.8 8.8 m-1 0 a1 1 0 1 0 2 0 a1 1 0 1 0 -2 0',
```

- [ ] **Step 4: Run the icon test again**

Run: `pnpm --filter @uidx/viewer test test/field-icons.test.ts`
Expected: PASS

- [ ] **Step 5: Retune the theme tokens**

In `packages/viewer/src/theme.css` `:root`, change/add (keep everything else):

```css
  --field-h: 28px;      /* was 24px — UI3's input height */
  --radius-lg: 5px;     /* was 4px — UI3's input corner */
  --section-pad: 16px;  /* new — a section's horizontal inset */
```

- [ ] **Step 6: Restyle the section chrome in `PropertiesPane.vue`**

In the `<style scoped>` block, replace the `.section`, `.section-head`, `.section-title` and `.section-eye` rules with:

```css
.section {
  /* Full-bleed separators: the rule runs edge to edge of the pane, UI3's
     section boundary, so the margins undo the pane's own padding. */
  margin: 0 calc(-1 * var(--section-pad));
  padding: 0 var(--section-pad);
  border-bottom: 1px solid var(--line);
}
.section-head {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: var(--bar-h);
}
.section-title {
  font-size: var(--ui-size);
  font-weight: 600;
  color: var(--text);
}
/* One box for every header icon: 24px hit target, 12px glyph, quiet at
   rest, a raised pill on hover — Figma's header cluster buttons. */
.cluster-btn {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--row-h);
  height: var(--row-h);
  padding: 0;
  border: 0;
  border-radius: var(--radius);
  background: none;
  color: var(--text-dim);
  cursor: pointer;
}
.cluster-btn:hover:not(:disabled) {
  background: var(--raised);
  color: var(--text);
}
.cluster-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.section-eye[aria-pressed='true'] {
  color: var(--accent);
}
```

Then add `cluster-btn` to the eye's class list in the template (`class="section-eye"` → `class="cluster-btn section-eye"`) and delete the now-redundant `.section-eye` base rules (keep only the `[aria-pressed]` one above). Update `.properties { padding: 16px }` to `padding: 12px var(--section-pad)`.

- [ ] **Step 7: Full viewer suite + typecheck**

Run: `pnpm --filter @uidx/viewer test && pnpm --filter @uidx/viewer typecheck`
Expected: PASS. If a test asserted a removed `.section-eye` style hook (selector, not class), fix the selector — the class names all still exist.

- [ ] **Step 8: Commit**

```bash
git add packages/viewer/src/theme.css packages/viewer/src/field-icons.ts packages/viewer/src/PropertiesPane.vue packages/viewer/test/field-icons.test.ts
git commit -m "UI3 pass 1: rhythm tokens, section chrome, and the new glyphs"
```

---

### Task 2: Label-above field blocks

The layout change: captions over controls, paired boxes under shared captions, solo number boxes at half width.

**Files:**
- Modify: `packages/viewer/src/PropertyField.vue`
- Modify: `packages/viewer/src/PropertiesPane.vue`
- Modify: `packages/schema/src/prop-ui.ts` (+ its test if the pair count is pinned)
- Test: `packages/viewer/test/properties-pane.test.ts`

**Interfaces:**
- Consumes: Task 1's tokens.
- Produces: `label.field-caption` on every non-compact labeled row; `.pair-captions` caption line on pair rows; `PAIR_CAPTION` map (`{ x: 'Position' }`) in `PropertiesPane.vue`; `.field` is a stacked block, no longer a 3-column grid.

- [ ] **Step 1: Write the failing test**

In `packages/viewer/test/properties-pane.test.ts`:

```ts
it('renders captions above controls, UI3 style', () => {
  const wrapper = pane()
  // The X/Y pair gets one shared caption — the group's name, Figma's word.
  expect(wrapper.find('[data-prop="x"] .pair-captions').text()).toBe('Position')
  // A solo labeled row's label is a caption block over the box.
  expect(row(wrapper, 'opacity').find('label.field-caption').exists()).toBe(true)
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @uidx/viewer test test/properties-pane.test.ts`
Expected: FAIL — no `.pair-captions`, no `.field-caption`.

- [ ] **Step 3: Pair line height with letter spacing in `prop-ui.ts`**

In `packages/schema/src/prop-ui.ts`, add to the two entries (matching how `x`/`y` declare theirs):

```ts
  lineHeight: { ...existing fields..., pairs: 'letterSpacing' },
  letterSpacing: { ...existing fields..., pairs: 'lineHeight' },
```

(Keep every existing field of those entries — only `pairs` is new. If `pnpm --filter @uidx/schema test` pins pair symmetry or counts in `prop-ui.test.ts`, extend the pinned list rather than deleting the assertion.)

- [ ] **Step 4: Caption the label in `PropertyField.vue`**

Change the label element to carry the caption class:

```html
<label
  v-if="!compact && field.control !== 'boolean' && !STRUCTURED.has(field.control)"
  :for="`f-${field.name}`"
  class="field-caption"
  :class="{ bound: field.boundTo }"
  >{{ field.label }}</label
>
```

And in its scoped styles, replace the bare `label` rule with:

```css
.field-caption {
  display: block;
  margin-bottom: 4px;
  color: var(--text-dim);
}
.field-caption.bound {
  color: var(--bound);
}
```

- [ ] **Step 5: Restack the field blocks in `PropertiesPane.vue`**

Template — wrap the pair row so a caption line can sit above the grid. Replace the `PropertyGridRoot v-if="paired.pairedWith"` block with:

```html
<div
  v-if="paired.pairedWith"
  class="field field-pair"
  :data-prop="paired.field.name"
  :data-authored="paired.field.authored || paired.pairedWith?.authored"
  :title="paired.field.readonlyReason ?? undefined"
  @mouseenter="onHover(paired.field.name)"
  @mouseleave="onHover(null)"
>
  <div class="pair-captions">
    <span v-if="pairCaption(paired)" class="field-caption span-caption">{{ pairCaption(paired) }}</span>
    <template v-else>
      <span class="field-caption">{{ paired.field.label }}</span>
      <span class="field-caption">{{ paired.pairedWith.label }}</span>
    </template>
  </div>
  <PropertyGridRoot :columns="2" class="pair-grid">
    <!-- the two <PropertyField compact …> children stay exactly as they are -->
  </PropertyGridRoot>
</div>
```

Script — beside `HANDLED_BY_SECTION`:

```ts
/**
 * A compact pair whose letters live inside the boxes gets one group caption
 * instead of two redundant ones — "Position" over X|Y, Figma's own line.
 * Pairs with real names (Line height | Letter spacing) caption each half.
 */
const PAIR_CAPTION: Record<string, string> = { x: 'Position' }
const pairCaption = (paired: PairedField): string | null =>
  PAIR_CAPTION[paired.field.name] ?? null
```

(`PairedField` is already exported from `./editable`; add it to the existing import.)

Styles — replace the `.field` / `.field-pair` rules:

```css
.field {
  /* Anchor for the popup, which is absolutely positioned. */
  position: relative;
  display: block;
  padding: 5px 0;
}
/* UI3: a lone number box is half a column, not a full-width bar. */
.field:not(.field-pair) > :deep(.value.number) {
  max-width: calc(50% - var(--gap) / 2);
}
.pair-captions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--gap);
  margin-bottom: 4px;
}
.pair-captions .field-caption {
  margin-bottom: 0;
}
.field-caption {
  display: block;
  color: var(--text-dim);
}
.span-caption {
  grid-column: 1 / -1;
}
.pair-grid {
  display: block;
}
.pair-grid :deep([data-slot='fields']) {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--gap-sm) var(--gap);
  align-items: center;
}
```

Delete the old `.field-pair :deep([data-slot='fields'])` rule (the `.pair-grid` one replaces it) and the old 3-column `.field` grid comment block. Keep `.field[data-linked]` but reduce it to hiding the label: the grid columns it overrode no longer exist —

```css
.field[data-linked] :deep(label) {
  display: none;
}
```

Add a caption to the Resizing block (template):

```html
<div v-if="sizeGroup && section.group === sizeGroup" class="field field-resizing">
  <span class="field-caption span-caption">Resizing</span>
  <SizeField … (unchanged) />
</div>
```

- [ ] **Step 6: Run the target test, then the whole suite**

Run: `pnpm --filter @uidx/viewer test test/properties-pane.test.ts`
Expected: the new test PASSES. Then `pnpm --filter @uidx/viewer test && pnpm --filter @uidx/schema test`.
Expected fallout to fix (selector updates only, no behavior): any test in `properties-pane.test.ts`, `panel-authored.test.ts`, `unset-props.test.ts`, `panel-typed-size.test.ts`, or `position-writes.test.ts` that located a pair row via `PropertyGridRoot` root classes or relied on `label` without a class. Update selectors to `.field-pair`, `label.field-caption` — assertions about values, patches, and aria-labels must not change.

- [ ] **Step 7: Typecheck and commit**

```bash
pnpm --filter @uidx/viewer typecheck
git add -A packages/viewer packages/schema
git commit -m "UI3 pass 2: captions above controls, paired caption rows, half-width numbers"
```

---

### Task 3: Header icon clusters — the + moves up

Fill/Stroke/Effects get their `+` on the section header, Figma's placement; the in-field header rows go.

**Files:**
- Modify: `packages/viewer/src/PropertiesPane.vue`
- Modify: `packages/viewer/src/PaintStackField.vue`
- Modify: `packages/viewer/src/EffectListField.vue`
- Test: `packages/viewer/test/properties-pane.test.ts`

**Interfaces:**
- Consumes: `plus` glyph (Task 1), `addSolidPaint`/`addEffect`/`asPaints`/`asEffects` from `./paint-edit` (existing).
- Produces: `[data-section-add="<group>"]` buttons on the Fill/Stroke/Effects headers; `PaintStackField` and `EffectListField` render rows only (no `.paints-head` / `.effects-head`).

- [ ] **Step 1: Write the failing test**

```ts
it('offers + on the Fill header and appends a solid through it', async () => {
  const wrapper = pane()
  const add = wrapper.find('[data-section-add="fill"]')
  expect(add.exists()).toBe(true)
  // The in-field header row is gone — the section title is the label now.
  expect(wrapper.find('.paints-head').exists()).toBe(false)
  await add.trigger('click')
  const commits = wrapper.emitted('commit')!
  const [, prop, value] = commits[commits.length - 1]!
  expect(prop).toBe('fills')
  expect((value as unknown[]).length).toBe(2) // DOC's red solid + the appended one
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @uidx/viewer test test/properties-pane.test.ts`
Expected: FAIL — no `[data-section-add]`.

- [ ] **Step 3: Implement**

`PropertiesPane.vue` script:

```ts
import { addEffect, addSolidPaint, asEffects, asPaints, documentSwatches } from './paint-edit'

/** Sections whose header carries Figma's `+` — each appends to one list prop. */
const ADDABLE: Partial<Record<PropGroup, 'fills' | 'strokes' | 'effects'>> = {
  fill: 'fills',
  stroke: 'strokes',
  effects: 'effects',
}

function onSectionAdd(group: PropGroup): void {
  const prop = ADDABLE[group]
  const field = fields.value.find((f) => f.name === prop)
  if (!prop || !field) return
  const next =
    prop === 'effects' ? addEffect(asEffects(field.value)) : addSolidPaint(asPaints(field.value))
  onCommit(prop, next)
}
```

Template, inside `PropertySectionHeader` after the eye/section-link markup:

```html
<button
  v-if="ADDABLE[section.group]"
  type="button"
  class="cluster-btn"
  :data-section-add="section.group"
  :disabled="writable === false"
  :title="`add ${section.group === 'effects' ? 'an effect' : 'a solid paint'}`"
  @click="onSectionAdd(section.group)"
>
  <FieldIcon name="plus" />
</button>
```

(If the template cannot see `ADDABLE` because it is typed as a plain const, expose a `const addable = (g: PropGroup) => ADDABLE[g] !== undefined` helper and use that in `v-if`.)

`PaintStackField.vue`: delete the whole `.paints-head` div from the template and the `.paints-head`, `.paints-label`, `.paint-add` style rules. `EffectListField.vue`: same for `.effects-head`, `.effects-label`, `.effect-add`.

- [ ] **Step 4: Run the test, then sweep for orphaned selectors**

Run: `pnpm --filter @uidx/viewer test test/properties-pane.test.ts` — expected PASS.
Then: `grep -rn "paint-add\|effect-add\|paints-head\|effects-head" packages/viewer/test packages/viewer/src` — update any test that clicked the old buttons to click `[data-section-add="…"]` instead; expected hits are in the C8-era paint/effect tests inside `properties-pane.test.ts`.
Then full suite: `pnpm --filter @uidx/viewer test`.

- [ ] **Step 5: Commit**

```bash
git add packages/viewer/src packages/viewer/test
git commit -m "UI3 pass 3: Fill/Stroke/Effects add moves to the section header"
```

---

### Task 4: The ◎ edit-property button on the pill row

A linked row gets Figma's second trailing control: ◎ opens the existing PropertyDialog in edit mode on the bound property.

**Files:**
- Modify: `packages/viewer/src/PropertyLink.vue`
- Modify: `packages/viewer/src/PropertyField.vue`
- Modify: `packages/viewer/src/PropertiesPane.vue`
- Test: `packages/viewer/test/properties-pane.test.ts`

**Interfaces:**
- Consumes: `PropertyDialog` (`mode="edit"`, props `type/name/value`, emits `submit(name, value, type)`); `editProperty(doc, address, from, to, fallback?)` and `enclosingComponent(doc, address)` from `./component-prop-edits`; `componentProps` from `@uidx/format`.
- Produces: `PropertyLink` emits `edit: []` and renders `.edit-property` when `boundTo`; `PropertyField` re-emits `edit: [prop: string]`; the pane owns `editing: { from: string; type: PropertyType; value: JsonValue } | null`.

- [ ] **Step 1: Write the failing test**

Add a linked fixture and test to `properties-pane.test.ts`:

```ts
const LINKED = parseOrThrow(`---
id: linked
---

## Visual Contract

<Page>
  <Component name="Chip" status="draft" props={{ Label: { type: 'TEXT', default: 'Hi' } }}>
    <Frame name="root" width={10} height={10}>
      <Text name="label" characters="{Label}" fontSize={12} />
    </Frame>
  </Component>
</Page>
`)

it('edits the bound property from the pill row', async () => {
  const wrapper = mount(PropertiesPane, {
    props: { doc: LINKED, selection: ['Chip#root/label'], tokens, writable: true },
  })
  await wrapper.find('[data-prop="characters"] .edit-property').trigger('click')
  const dialog = wrapper.find('form')
  expect(dialog.exists()).toBe(true)
  const name = wrapper.find('#prop-name')
  expect((name.element as HTMLInputElement).value).toBe('Label')
  await name.setValue('Caption')
  await dialog.trigger('submit')
  const patches = wrapper.emitted('patches')!.at(-1)![0] as UidxPatch[]
  // One envelope: the renamed declaration plus the re-pointed binding site.
  expect(patches.some((p) => p.prop === 'props')).toBe(true)
  expect(patches.some((p) => p.prop === 'characters' && p.value === '{Caption}')).toBe(true)
})
```

(`UidxPatch` joins the existing `@uidx/format` type import. If the layer address `Chip#root/label` misses, print `wrapper.html()` — the address scheme is `Component#child/grandchild`, the same shape `component-prop-edits.test.ts` fixtures use; copy the working form from there.)

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @uidx/viewer test test/properties-pane.test.ts`
Expected: FAIL — no `.edit-property` element.

- [ ] **Step 3: Implement**

`PropertyLink.vue` — add to emits: `edit: []`. Template, between the apply button and the unlink button:

```html
<button
  v-if="boundTo"
  type="button"
  class="icon-button edit-property"
  :disabled="!editable"
  title="edit the property"
  @click="emit('edit')"
>
  <FieldIcon name="apply-property" />
</button>
```

`PropertyField.vue` — add `edit: [prop: string]` to its emits and `@edit="emit('edit', field.name)"` on its `<PropertyLink>`.

`PropertiesPane.vue` — extend the component-prop-edits import with `editProperty, enclosingComponent`, import `componentProps` from `@uidx/format`, then:

```ts
/** The property the ◎ button opened for editing, while the dialog is up. */
const editing = shallowRef<{ from: string; type: PropertyType; value: JsonValue } | null>(null)

function onEditProperty(prop: string): void {
  const node = active.value
  if (!props.doc || !node) return
  const held = node.attrs[prop]?.value
  const target = held !== undefined ? aliasTarget(held) : null
  if (!target || target.includes('#')) return // a token has no declaration to edit
  const component = enclosingComponent(props.doc, node.address)
  const declaration = component ? componentProps(component).declared.get(target) : undefined
  if (!declaration) return
  editing.value = { from: target, type: declaration.type, value: declaration.default }
}

function onEditSubmit(name: string, value: JsonValue): void {
  const address = active.value?.address
  const pending = editing.value
  if (!props.doc || !address || !pending) return
  const patches = editProperty(props.doc, address, pending.from, name, value)
  if (!patches) return
  emit('patches', patches)
  editing.value = null
}
```

Template — beside the existing create dialog:

```html
<PropertyDialog
  v-if="editing"
  :key="editing.from"
  mode="edit"
  :type="editing.type"
  :name="editing.from"
  :value="editing.value"
  @submit="onEditSubmit"
  @close="editing = null"
/>
```

Wire `@edit` at every `PropertyLink`/`PropertyField` host: row fields (`@edit="onEditProperty"` on both `PropertyField`s in the pair branch and the solo branch), and the instance swap row's `PropertyLink` (`@edit="onEditProperty('component')"`). The section-header links render only unbound, so they never show ◎.

- [ ] **Step 4: Run the test, the suite, typecheck**

Run: `pnpm --filter @uidx/viewer test && pnpm --filter @uidx/viewer typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/viewer/src packages/viewer/test
git commit -m "UI3 pass 4: edit-property from the pill row"
```

---

## Stage 2 — the assignment popup

### Task 5: `variable-binding.ts` — candidates and the patch

**Files:**
- Create: `packages/viewer/src/variable-binding.ts`
- Test: `packages/viewer/test/variable-binding.test.ts` (create)

**Interfaces:**
- Consumes: `variableTypeOf`, `toAlias`, `resolve`, types `VariableType`, `JsonValue`, `UidxDocument`, `UidxPatch` from `@uidx/format`; `colorToHex`, `Rgba` from `./paint-edit`; `ControlKind` from `./editable`.
- Produces (later tasks import exactly these):

```ts
export interface VariableCandidate {
  address: string      // 'radius#md'
  collection: string   // 'radius'
  name: string         // 'md'
  type: VariableType
  value: JsonValue     // the resolved literal
  preview: string      // '8' | 'Accept terms…' | '#1A66E5'
}
export function variableCandidates(
  tokens: ReadonlyMap<string, JsonValue> | undefined,
  type: VariableType | null,
): VariableCandidate[]
export function variableTypeForControl(control: ControlKind): VariableType | null
export function bindVariable(
  doc: UidxDocument,
  address: string,
  prop: string,
  token: string,
): UidxPatch[] | null
```

- [ ] **Step 1: Write the failing tests**

`packages/viewer/test/variable-binding.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseOrThrow, type JsonValue } from '@uidx/format'
import { bindVariable, variableCandidates, variableTypeForControl } from '../src/variable-binding'

const TOKENS = new Map<string, JsonValue>([
  ['radius#md', 8],
  ['radius#lg', 16],
  ['palette#blue', { r: 0.1, g: 0.4, b: 0.9, a: 1 }],
  ['strings#label', 'Accept'],
  ['flags#on', true],
])

describe('variableCandidates', () => {
  it('filters by type and splits the address', () => {
    const floats = variableCandidates(TOKENS, 'FLOAT')
    expect(floats.map((c) => c.address)).toEqual(['radius#md', 'radius#lg'])
    expect(floats[0]).toMatchObject({ collection: 'radius', name: 'md', preview: '8' })
  })
  it('previews a color as its hex', () => {
    expect(variableCandidates(TOKENS, 'COLOR')[0]!.preview).toMatch(/^#/)
  })
  it('answers empty for no tokens or no type', () => {
    expect(variableCandidates(undefined, 'FLOAT')).toEqual([])
    expect(variableCandidates(TOKENS, null)).toEqual([])
  })
})

describe('variableTypeForControl', () => {
  it('maps the three bindable controls and nothing else', () => {
    expect(variableTypeForControl('number')).toBe('FLOAT')
    expect(variableTypeForControl('text')).toBe('STRING')
    expect(variableTypeForControl('boolean')).toBe('BOOLEAN')
    expect(variableTypeForControl('enum')).toBeNull()
    expect(variableTypeForControl('paint')).toBeNull()
  })
})

describe('bindVariable', () => {
  const DOC = parseOrThrow(`---
id: bind
---

## Visual Contract

<Page>
  <Component name="Card" status="draft">
    <Frame name="root" cornerRadius={4} width={10} height={10} />
  </Component>
</Page>
`)
  it('sets over an authored value and adds over an absent one', () => {
    expect(bindVariable(DOC, 'Card#root', 'cornerRadius', 'radius#md')).toEqual([
      { op: 'set', address: 'Card#root', prop: 'cornerRadius', value: '{radius#md}' },
    ])
    expect(bindVariable(DOC, 'Card#root', 'opacity', 'radius#md')).toEqual([
      { op: 'add', address: 'Card#root', prop: 'opacity', value: '{radius#md}' },
    ])
  })
  it('refuses an address that resolves to nothing', () => {
    expect(bindVariable(DOC, 'Card#nope', 'cornerRadius', 'radius#md')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @uidx/viewer test test/variable-binding.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

`packages/viewer/src/variable-binding.ts`:

```ts
import {
  resolve,
  toAlias,
  variableTypeOf,
  type JsonValue,
  type UidxDocument,
  type UidxPatch,
  type VariableType,
} from '@uidx/format'
import { colorToHex, type Rgba } from './paint-edit'
import type { ControlKind } from './editable'

/**
 * Variables as the panel's popup lists them (spec §3): typed, grouped by the
 * collection half of their address, with the resolved literal as a preview.
 * The tokens map is `App.vue`'s `resolveTokenValues` output, so alias chains
 * are already flattened — a candidate's value is always a literal.
 */
export interface VariableCandidate {
  address: string
  collection: string
  name: string
  type: VariableType
  value: JsonValue
  preview: string
}

export function variableCandidates(
  tokens: ReadonlyMap<string, JsonValue> | undefined,
  type: VariableType | null,
): VariableCandidate[] {
  if (!tokens || !type) return []
  const out: VariableCandidate[] = []
  for (const [address, value] of tokens) {
    if (variableTypeOf(value) !== type) continue
    const sep = address.indexOf('#')
    if (sep < 0) continue
    out.push({
      address,
      collection: address.slice(0, sep),
      name: address.slice(sep + 1),
      type,
      value,
      preview: type === 'COLOR' ? colorToHex(value as unknown as Rgba) : String(value),
    })
  }
  return out
}

/** The one variable type a control kind can read, or null when none can. */
export function variableTypeForControl(control: ControlKind): VariableType | null {
  return control === 'number'
    ? 'FLOAT'
    : control === 'text'
      ? 'STRING'
      : control === 'boolean'
        ? 'BOOLEAN'
        : null
}

/**
 * Bind an attribute to a variable. Structural like `bindProperty`, and for the
 * same reason: writing `"{radius#md}"` through the scene-graph commit route
 * would hand D4 a string where it reflows numbers. A patch says exactly what
 * the file should hold.
 */
export function bindVariable(
  doc: UidxDocument,
  address: string,
  prop: string,
  token: string,
): UidxPatch[] | null {
  const node = resolve(doc.tree, address)
  if (!node) return null
  const op = node.attrs[prop] === undefined ? 'add' : 'set'
  return [{ op, address, prop, value: toAlias(token) }]
}
```

(If `VariableType` is not re-exported from `@uidx/format`'s index, export it there from `./types.js` — `alias.ts` already imports it from that module.)

- [ ] **Step 4: Run to verify pass, then commit**

Run: `pnpm --filter @uidx/viewer test test/variable-binding.test.ts` — PASS.

```bash
git add packages/viewer/src/variable-binding.ts packages/viewer/test/variable-binding.test.ts
git commit -m "Variables as candidates, and a variable choice as a patch"
```

---

### Task 6: `AssignPopup.vue` + `VariableRow.vue`

The shared popup, tested standalone before anything hosts it.

**Files:**
- Create: `packages/viewer/src/AssignPopup.vue`
- Create: `packages/viewer/src/VariableRow.vue`
- Test: `packages/viewer/test/assign-popup.test.ts` (create)

**Interfaces:**
- Consumes: `VariableCandidate` (Task 5), `FieldIcon`/`IconName` (Task 1's glyphs), `cssColor`/`Rgba` from `./paint-edit`.
- Produces:
  - `AssignPopup` props `{ candidates: { name: string; declaration: { type: string; default: JsonValue } }[] | null; componentName: string | null; variables: VariableCandidate[]; boundTo: string | null; icon: IconName }`, emits `{ property: [name: string]; variable: [address: string]; create: []; close: [] }`.
  - `VariableRow` props `{ candidate: VariableCandidate; current: boolean }`, emits `{ pick: [] }`, renders `[data-variable="<address>"]`.
  - Openers that must not re-trigger close mark themselves `data-popup-trigger` (the same convention `ColorPickerDialog` uses with `data-picker-trigger`).

- [ ] **Step 1: Write the failing tests**

`packages/viewer/test/assign-popup.test.ts`:

```ts
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AssignPopup from '../src/AssignPopup.vue'
import type { VariableCandidate } from '../src/variable-binding'

const VARIABLES: VariableCandidate[] = [
  { address: 'radius#md', collection: 'radius', name: 'md', type: 'FLOAT', value: 8, preview: '8' },
  { address: 'radius#lg', collection: 'radius', name: 'lg', type: 'FLOAT', value: 16, preview: '16' },
  { address: 'space#sm', collection: 'space', name: 'sm', type: 'FLOAT', value: 4, preview: '4' },
]

const CANDIDATES = [
  { name: 'Label', declaration: { type: 'TEXT', default: 'Accept terms' } },
  { name: 'Description', declaration: { type: 'TEXT', default: 'You agree' } },
]

function popup(overrides = {}) {
  return mount(AssignPopup, {
    props: {
      candidates: CANDIDATES,
      componentName: 'Checkbox Field',
      variables: VARIABLES,
      boundTo: null,
      icon: 'prop-text' as const,
      ...overrides,
    },
  })
}

describe('assign popup', () => {
  it('groups properties under the component and variables by collection', () => {
    const wrapper = popup()
    expect(wrapper.text()).toContain('Properties in Checkbox Field')
    expect(wrapper.findAll('.popup-collection').map((c) => c.text())).toEqual(['radius', 'space'])
    expect(wrapper.findAll('[data-variable]')).toHaveLength(3)
  })

  it('previews a property default and a variable value', () => {
    const wrapper = popup()
    expect(wrapper.text()).toContain('Accept terms')
    expect(wrapper.find('[data-variable="radius#md"]').text()).toContain('8')
  })

  it('filters both groups as the query types', async () => {
    const wrapper = popup()
    await wrapper.find('input').setValue('md')
    expect(wrapper.findAll('[data-variable]')).toHaveLength(1)
    expect(wrapper.findAll('.popup-row:not(.variable-row)')).toHaveLength(0)
  })

  it('emits the choice and highlights the current binding', async () => {
    const wrapper = popup({ boundTo: 'radius#md' })
    expect(wrapper.find('[data-variable="radius#md"]').classes()).toContain('current')
    await wrapper.find('[data-variable="radius#lg"]').trigger('click')
    expect(wrapper.emitted('variable')![0]).toEqual(['radius#lg'])
    await wrapper.find('.popup-row:not(.variable-row)').trigger('click')
    expect(wrapper.emitted('property')![0]).toEqual(['Label'])
    await wrapper.find('.popup-create').trigger('click')
    expect(wrapper.emitted('create')).toBeTruthy()
  })

  it('hides the property group entirely when candidates are null', () => {
    const wrapper = popup({ candidates: null })
    expect(wrapper.text()).not.toContain('Properties in')
    expect(wrapper.find('.popup-create').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @uidx/viewer test test/assign-popup.test.ts`
Expected: FAIL — components do not exist.

- [ ] **Step 3: Implement `VariableRow.vue`**

```vue
<script setup lang="ts">
import { FieldIcon, type IconName } from './field-icons'
import { cssColor, type Rgba } from './paint-edit'
import type { VariableCandidate } from './variable-binding'

/**
 * One variable as a popup row — glyph (or swatch, for a colour) + name +
 * resolved preview. Its own component because the assignment popup and the
 * colour picker's Libraries tab are the same list (spec §4), and two
 * renderings of "a variable" would drift.
 */
defineProps<{ candidate: VariableCandidate; current: boolean }>()
defineEmits<{ pick: [] }>()

const GLYPH: Record<string, IconName> = {
  FLOAT: 'variable',
  STRING: 'prop-text',
  BOOLEAN: 'prop-boolean',
}
</script>

<template>
  <button
    type="button"
    class="popup-row variable-row"
    :class="{ current }"
    :data-variable="candidate.address"
    :title="candidate.address"
    @click="$emit('pick')"
  >
    <span
      v-if="candidate.type === 'COLOR'"
      class="row-swatch"
      :style="{ background: cssColor(candidate.value as unknown as Rgba) }"
    />
    <FieldIcon v-else :name="GLYPH[candidate.type] ?? 'variable'" />
    <span class="row-name">{{ candidate.name }}</span>
    <span class="row-preview">{{ candidate.preview }}</span>
  </button>
</template>

<style scoped>
.popup-row {
  display: flex;
  gap: var(--gap-sm);
  align-items: center;
  width: 100%;
  height: var(--row-h);
  padding: 0 6px;
  border: 0;
  border-radius: var(--radius);
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.popup-row:hover {
  background: var(--raised);
}
.popup-row.current {
  background: color-mix(in srgb, var(--accent) 25%, transparent);
}
.row-swatch {
  flex: none;
  width: 12px;
  height: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
}
.row-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-preview {
  flex: none;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-faint);
}
</style>
```

- [ ] **Step 4: Implement `AssignPopup.vue`**

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { JsonValue } from '@uidx/format'
import { FieldIcon, type IconName } from './field-icons'
import VariableRow from './VariableRow.vue'
import type { VariableCandidate } from './variable-binding'

/**
 * Figma's assignment popup (spec §3): search on top, the enclosing
 * component's same-type properties, then variables grouped by collection.
 * Holds no document knowledge — the host filtered both lists by the one type
 * this input takes, and turns a choice into patches.
 */
const props = defineProps<{
  /** Same-type properties, or null to hide the group (outside a component). */
  candidates: { name: string; declaration: { type: string; default: JsonValue } }[] | null
  componentName: string | null
  /** Already type-filtered by the host. */
  variables: VariableCandidate[]
  /** Current binding — a property name or a token address — for highlight. */
  boundTo: string | null
  /** The glyph property rows wear: the one type this input takes. */
  icon: IconName
}>()

const emit = defineEmits<{
  property: [name: string]
  variable: [address: string]
  create: []
  close: []
}>()

const query = ref('')
const search = ref<HTMLInputElement | null>(null)
const root = ref<HTMLElement | null>(null)

const matches = (name: string): boolean =>
  name.toLowerCase().includes(query.value.trim().toLowerCase())

const properties = computed(() => (props.candidates ?? []).filter((c) => matches(c.name)))

/** Collection name -> its matching variables, in declaration order. */
const collections = computed(() => {
  const groups = new Map<string, VariableCandidate[]>()
  for (const candidate of props.variables) {
    if (!matches(candidate.name)) continue
    const list = groups.get(candidate.collection) ?? []
    list.push(candidate)
    groups.set(candidate.collection, list)
  }
  return [...groups]
})

const previewOf = (value: JsonValue): string =>
  typeof value === 'string' ? value : JSON.stringify(value)

/** Escape clears a live query first, then closes — Figma's order. */
function onKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  if (query.value) query.value = ''
  else emit('close')
}
function onPointer(event: Event): void {
  const target = event.target as HTMLElement | null
  if (target && (root.value?.contains(target) || target.closest?.('[data-popup-trigger]'))) return
  emit('close')
}

onMounted(() => {
  search.value?.focus()
  document.addEventListener('keydown', onKey)
  document.addEventListener('pointerdown', onPointer, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  document.removeEventListener('pointerdown', onPointer, true)
})
</script>

<template>
  <div ref="root" class="assign-popup">
    <div class="popup-search">
      <FieldIcon name="search" />
      <input ref="search" v-model="query" placeholder="Search" aria-label="search bindings" />
      <button v-if="query" type="button" class="popup-clear" aria-label="clear" @click="query = ''">
        <FieldIcon name="close" />
      </button>
    </div>

    <template v-if="candidates">
      <p class="popup-heading">Properties in {{ componentName ?? 'this component' }}</p>
      <button
        v-for="option in properties"
        :key="option.name"
        type="button"
        class="popup-row"
        :class="{ current: option.name === boundTo }"
        @click="emit('property', option.name)"
      >
        <FieldIcon :name="icon" class="prop-glyph" />
        <span class="row-name">{{ option.name }}</span>
        <span class="row-preview">{{ previewOf(option.declaration.default) }}</span>
      </button>
      <p v-if="!properties.length" class="popup-empty">Nothing declared yet</p>
      <button type="button" class="popup-create" @click="emit('create')">Create property…</button>
    </template>

    <template v-if="collections.length">
      <p class="popup-heading">Variables</p>
      <template v-for="[collection, rows] in collections" :key="collection">
        <p class="popup-collection">{{ collection }}</p>
        <VariableRow
          v-for="candidate in rows"
          :key="candidate.address"
          :candidate="candidate"
          :current="candidate.address === boundTo"
          @pick="emit('variable', candidate.address)"
        />
      </template>
    </template>
  </div>
</template>

<style scoped>
.assign-popup {
  position: absolute;
  top: calc(100% + 2px);
  right: 0;
  z-index: 20;
  width: 208px;
  max-height: 320px;
  overflow-y: auto;
  padding: var(--gap-sm);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: var(--shadow);
}
.popup-search {
  display: flex;
  gap: var(--gap-sm);
  align-items: center;
  height: var(--field-h);
  margin-bottom: var(--gap-sm);
  padding: 0 6px;
  border-radius: var(--radius);
  background: var(--raised);
  color: var(--text-faint);
}
.popup-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  outline: none;
}
.popup-clear {
  display: inline-flex;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-faint);
  cursor: pointer;
}
.popup-heading {
  margin: var(--gap-sm) 0 2px;
  padding: 0 6px;
  color: var(--text);
  font-weight: 600;
}
.popup-collection {
  margin: 2px 0 0;
  padding: 0 6px;
  color: var(--text-faint);
}
.popup-empty {
  margin: 0;
  padding: 0 6px;
  color: var(--text-faint);
  line-height: var(--row-h);
}
/* The same row shape VariableRow draws, for the property rows this file owns. */
.popup-row {
  display: flex;
  gap: var(--gap-sm);
  align-items: center;
  width: 100%;
  height: var(--row-h);
  padding: 0 6px;
  border: 0;
  border-radius: var(--radius);
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.popup-row:hover {
  background: var(--raised);
}
.popup-row.current {
  background: color-mix(in srgb, var(--accent) 25%, transparent);
}
.prop-glyph {
  color: var(--bound);
}
.row-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-preview {
  flex: none;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-faint);
}
.popup-create {
  display: block;
  width: 100%;
  margin-top: var(--gap-sm);
  padding: var(--gap-sm) 6px 0;
  border: 0;
  border-top: 1px solid var(--line);
  background: none;
  color: var(--text-dim);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.popup-create:hover {
  color: var(--text);
}
</style>
```

- [ ] **Step 5: Run to verify pass, then commit**

Run: `pnpm --filter @uidx/viewer test test/assign-popup.test.ts` — PASS.

```bash
git add packages/viewer/src/AssignPopup.vue packages/viewer/src/VariableRow.vue packages/viewer/test/assign-popup.test.ts
git commit -m "The assignment popup: search, properties, variables by collection"
```

---

### Task 7: The popup replaces PropertyLink's menu

Every existing binding surface — row pills, section headers, the instance swap row — opens `AssignPopup`; choosing a variable writes the alias patch.

**Files:**
- Modify: `packages/viewer/src/PropertyLink.vue`
- Modify: `packages/viewer/src/PropertyField.vue`
- Modify: `packages/viewer/src/PropertiesPane.vue`
- Test: `packages/viewer/test/properties-pane.test.ts`

**Interfaces:**
- Consumes: `AssignPopup` (Task 6), `variableCandidates`, `variableTypeForControl`, `bindVariable`, `VariableCandidate` (Task 5).
- Produces: `PropertyLink` props gain `variables?: VariableCandidate[]` and `componentName?: string | null`; emits gain `pickVariable: [address: string]`. `PropertyField` props gain the same two; emits gain `pickVariable: [prop: string, address: string]`. The pane exposes `variablesFor(field)` and `onPickVariable(prop, token)`; the pill (`.property-pill`) is a button and opens the popup.

- [ ] **Step 1: Write the failing tests**

In `properties-pane.test.ts` (the `DOC` fixture already authors `visible={true}` on `Card#root`, and `tokens` already maps `radius#md`; extend `tokens` first):

```ts
const tokens = new Map<string, JsonValue>([
  ['radius#md', 8],
  ['flags#on', true],
  ['strings#label', 'Hello'],
])
```

```ts
it('offers matching variables in the eye popup and binds one as a patch', async () => {
  const wrapper = pane()
  await wrapper.find('.section-link .apply-property').trigger('click')
  // BOOLEAN input: the boolean variable shows, the number one does not.
  expect(wrapper.find('[data-variable="flags#on"]').exists()).toBe(true)
  expect(wrapper.find('[data-variable="radius#md"]').exists()).toBe(false)
  await wrapper.find('[data-variable="flags#on"]').trigger('click')
  const patches = wrapper.emitted('patches')!.at(-1)![0] as UidxPatch[]
  expect(patches).toEqual([
    { op: 'set', address: 'Card#root', prop: 'visible', value: '{flags#on}' },
  ])
})
```

(The eye's section-link renders because `Card#root` sits inside `<Component name="Card">` — `bindCandidates` answers `[]`, not null. If the selector `.section-link .apply-property` matches nothing, check what Task 1 renamed; the button keeps the `apply-property` class.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @uidx/viewer test test/properties-pane.test.ts`
Expected: FAIL — the old `.property-menu` renders property options only; no `[data-variable]`.

- [ ] **Step 3: Rework `PropertyLink.vue`**

Script: add to props `variables?: VariableCandidate[]` and `componentName?: string | null` (import the type from `./variable-binding`); add `pickVariable: [address: string]` to emits; add:

```ts
function chooseVariable(address: string): void {
  picking.value = false
  emit('pickVariable', address)
}
```

Template: make the pill a button that opens the popup (Figma: clicking the pill switches):

```html
<button
  v-if="boundTo"
  type="button"
  class="property-pill"
  data-popup-trigger
  :disabled="!editable"
  :title="`linked to ${boundTo}`"
  @click="picking = !picking"
>
  <FieldIcon :name="icon" />
  {{ boundTo }}
</button>
```

Mark the apply button `data-popup-trigger` too. Replace the whole `.property-menu` div with:

```html
<AssignPopup
  v-if="picking"
  :candidates="candidates"
  :component-name="componentName ?? null"
  :variables="variables ?? []"
  :bound-to="boundTo"
  :icon="icon"
  @property="choose"
  @variable="chooseVariable"
  @create="startCreate"
  @close="picking = false"
/>
```

Delete the `.property-menu`, `.property-option`, `.property-create`, `.menu-empty` styles. Add to `.property-pill`'s rule: `border: 0; font: inherit; cursor: pointer;` (it was a span). Keep `.link-controls` as the positioning anchor; when only the pill renders (`boundTo` with `candidates`), the popup still needs an anchor — move the `<AssignPopup>` inside the `.link-controls` span and keep that span rendered whenever `candidates` is non-null (already the case).

- [ ] **Step 4: Thread the props through `PropertyField.vue`**

Add to props: `variables?: VariableCandidate[]`, `componentName?: string | null`. Add to emits: `pickVariable: [prop: string, address: string]`. On its `<PropertyLink>`: `:variables="variables" :component-name="componentName ?? null" @pick-variable="(a) => emit('pickVariable', field.name, a)"`.

- [ ] **Step 5: Wire the pane**

`PropertiesPane.vue` script:

```ts
import { bindVariable, variableCandidates, variableTypeForControl } from './variable-binding'
import type { VariableCandidate } from './variable-binding'

/** The variables this field's control can read, from every loaded token doc. */
function variablesFor(field: EditableProp): VariableCandidate[] {
  return variableCandidates(props.tokens, variableTypeForControl(field.control))
}

const componentName = computed(() => {
  const address = active.value?.address
  return address && props.doc ? (enclosingComponent(props.doc, address)?.name ?? null) : null
})

function onPickVariable(prop: string, token: string): void {
  const address = active.value?.address
  if (!props.doc || !address) return
  const patches = bindVariable(props.doc, address, prop, token)
  if (patches) emit('patches', patches)
}
```

Template: every `<PropertyField>` (both pair halves, the solo branch, and the unmapped loop may skip it) gains

```html
:variables="variablesFor(paired.field)"
:component-name="componentName"
@pick-variable="onPickVariable"
```

(adjusting `paired.field` / `paired.pairedWith` / `field` per site). The section-header `<PropertyLink>` gains `:variables="variableCandidates(props.tokens ?? undefined, link!.prop === 'visible' ? 'BOOLEAN' : 'STRING')"` — hoist that into `sectionLink`'s return instead if the inline expression fights the template compiler:

```ts
// inside sectionLink(), extend the return:
return {
  prop,
  boundTo: target && !target.includes('#') ? target : null,
  candidates,
  variables: variableCandidates(props.tokens, prop === 'visible' ? 'BOOLEAN' : 'STRING'),
}
```

then `:variables="link!.variables"` in the template, plus `:component-name="componentName"` and `@pick-variable="(a) => onPickVariable(link!.prop, a)"`. The instance swap `<PropertyLink>` gains `:variables="[]"` (INSTANCE_SWAP takes no variable, spec §3) and `:component-name="componentName"`.

- [ ] **Step 6: A variable-driven visibility stills the eye**

Binding `visible` to a BOOLEAN variable creates a state the property-era guards miss: `visibleLink.boundTo` excludes `#` addresses, so the eye would stay live (a click silently detaches the variable) and `genericFields` would suppress the row (no pill anywhere). Failing test first:

```ts
const EYED = parseOrThrow(`---
id: eyed
---

## Visual Contract

<Page>
  <Component name="Card" status="draft">
    <Frame name="root" width={10} height={10} visible="{flags#on}" />
  </Component>
</Page>
`)

it('a variable-driven visibility stills the eye and keeps a pill row', () => {
  const wrapper = mount(PropertiesPane, {
    props: { doc: EYED, selection: ['Card#root'], tokens, writable: true },
  })
  expect(wrapper.find('.section-eye').attributes('disabled')).toBeDefined()
  // The row renders (Task 10 styles it as the token pill; here it just exists).
  expect(row(wrapper, 'visible').exists()).toBe(true)
})
```

Fix in `PropertiesPane.vue` — one computed for "anything drives visibility":

```ts
/** The binding driving `visible` — property or token — or null. Either kind
    stills the eye: a stray click must not silently detach it. */
const visibleBound = computed(
  () => fields.value.find((f) => f.name === 'visible')?.boundTo ?? null,
)
```

The eye's `:disabled` becomes `writable === false || !!visibleBound`, its bound `:title` branch reads `visibleBound` instead of `visibleLink?.boundTo`, and `genericFields`' suppression clause becomes `(name === 'visible' && !visibleBound.value)`. `visibleLink` stays as-is for the header's *property* apply flow.

- [ ] **Step 7: Run the tests and sweep the fallout**

Run: `pnpm --filter @uidx/viewer test`
Expected: both new tests PASS. Any existing test that clicked `.property-option` in the old menu (the F12/F13 link-flow tests in `properties-pane.test.ts` / `instance-rows.test.ts`) now finds the same options as `.popup-row` buttons inside `.assign-popup` — update selectors only; the emitted patch assertions must pass unchanged. A pre-existing test may also pin the eye's disabled state to the property case only — extend it rather than fighting it.

- [ ] **Step 8: Typecheck and commit**

```bash
pnpm --filter @uidx/viewer typecheck
git add packages/viewer/src packages/viewer/test
git commit -m "AssignPopup replaces the property menu on every binding surface"
```

---

### Task 8: The number-field variable affordance

Figma's hover glyph at the right edge of every number input whose type has variables.

**Files:**
- Modify: `packages/viewer/src/PropertyField.vue`
- Test: `packages/viewer/test/properties-pane.test.ts`

**Interfaces:**
- Consumes: `AssignPopup`, `variables`/`pickVariable` plumbing from Task 7 (the pane already passes `variables` to every field).
- Produces: `.field-variables` button inside `.value.number`, revealed on hover/focus, opening `AssignPopup` with `candidates: null`.

- [ ] **Step 1: Write the failing test**

```ts
it('binds a number field to a FLOAT variable from its own glyph', async () => {
  const wrapper = pane()
  const gapRow = row(wrapper, 'itemSpacing')
  await gapRow.find('.field-variables').trigger('click')
  await gapRow.find('[data-variable="radius#md"]').trigger('click')
  const patches = wrapper.emitted('patches')!.at(-1)![0] as UidxPatch[]
  expect(patches).toEqual([
    { op: 'set', address: 'Card#root', prop: 'itemSpacing', value: '{radius#md}' },
  ])
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @uidx/viewer test test/properties-pane.test.ts`
Expected: FAIL — no `.field-variables`.

- [ ] **Step 3: Implement in `PropertyField.vue`**

Script:

```ts
const pickingVariable = ref(false)
```

(add `ref` to the vue import). Template — inside the `.value.number` span, after the scrub/input template block:

```html
<button
  v-if="editable && (variables?.length ?? 0) > 0"
  type="button"
  class="field-variables"
  data-popup-trigger
  title="apply a variable"
  @click="pickingVariable = !pickingVariable"
>
  <FieldIcon name="variables-grid" />
</button>
```

Immediately after the closing `</NumberFieldRoot>`, add the popup (anchored by the row's `position: relative`):

```html
<AssignPopup
  v-if="pickingVariable"
  :candidates="null"
  :component-name="null"
  :variables="variables ?? []"
  :bound-to="field.boundTo"
  icon="variable"
  @variable="
    (a) => {
      pickingVariable = false
      emit('pickVariable', field.name, a)
    }
  "
  @close="pickingVariable = false"
/>
```

(import `AssignPopup` in the script block). Styles:

```css
/* Figma's own visibility: revealed by the row, not always-on — every number
   input is bindable, and a resting glyph on all of them is a wall (spec §2). */
.field-variables {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-faint);
  cursor: pointer;
  opacity: 0;
}
.number:hover .field-variables,
.number:focus-within .field-variables,
.field-variables:focus-visible {
  opacity: 1;
}
.field-variables:hover {
  color: var(--text);
}
```

- [ ] **Step 4: Run to verify pass, full suite, commit**

Run: `pnpm --filter @uidx/viewer test` — PASS (jsdom does not gate clicks on CSS opacity, so the hover-reveal does not break the test).

```bash
git add packages/viewer/src/PropertyField.vue packages/viewer/test/properties-pane.test.ts
git commit -m "Number fields bind to FLOAT variables from Figma's hover glyph"
```

---

## Stage 3 — variables end to end

### Task 9: Paint-level aliases in `@uidx/schema`

`color: "{palette#blue}"` inside a fills/strokes/effects entry resolves; unresolved drops the entry with a warning; a sibling edit leaves the alias alone.

**Files:**
- Modify: `packages/schema/src/to-scene.ts`
- Test: `packages/schema/test/tokens.test.ts`

**Why no reconcile/authorship guard:** the spec asked for a "sibling edit preserves the alias" pin. Investigation: `reconcile.ts` is the file→canvas direction (it cannot write the file), the canvas cannot originate fill edits, and every viewer write that touches fills computes the next whole value in `paint-edit.ts` by spreading the existing paint objects — which carries an alias string along untouched. The pin therefore lives at that level: Task 11's paint-edit tests include the sibling-preservation case.

**Interfaces:**
- Consumes: `aliasTarget` (already imported in `to-scene.ts`), `AliasResolver` (existing type).
- Produces: `scenePropFor` resolves paint-entry `color` aliases for `fills`/`strokes`/`effects`; `overridesFor` feeds `composeStrokes` resolved paints. No new exports.

- [ ] **Step 1: Write the failing tests**

In `packages/schema/test/tokens.test.ts` (reuse its `values()` helper — the resolved map of `TOKENS`, which declares `palette#blue`):

```ts
it('resolves a color alias inside a fill paint', () => {
  const map = values()
  const warnings: string[] = []
  const fields = scenePropFor(
    'fills',
    [{ type: 'SOLID', color: '{palette#blue}' }],
    { warnings, resolveAlias: (a) => map.get(a) },
  )
  expect(warnings).toEqual([])
  expect(JSON.stringify(fields)).not.toContain('palette#blue')
  expect(JSON.stringify(fields)).toContain('0.4') // blue's g channel made it through
})

it('drops only the unresolvable paint, and says so', () => {
  const warnings: string[] = []
  const fields = scenePropFor(
    'fills',
    [
      { type: 'SOLID', color: '{palette#nope}' },
      { type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } },
    ],
    { warnings, resolveAlias: () => undefined },
  )
  expect(warnings.join()).toMatch(/unresolved token "palette#nope"/)
  // The literal red paint still draws.
  expect(JSON.stringify(fields)).toContain('"r":1')
  expect(JSON.stringify(fields)).not.toContain('palette#nope')
})

it('resolves a stroke paint alias through the graph', () => {
  const page = parseOrThrow(`---
id: stroked
---

## Visual Contract

<Page>
  <Component name="Card" status="draft">
    <Frame name="root" width={10} height={10}
      strokes={[{ type: 'SOLID', color: "{palette#blue}" }]} strokeWeight={2} />
  </Component>
</Page>
`)
  const map = values()
  const { graph, warnings } = toSceneGraph(page, { resolveAlias: (a) => map.get(a) })
  expect(warnings).toEqual([])
  const strokes = graph.getNode('Card#root')!.strokes as { color: { g: number } }[]
  expect(strokes[0]!.color.g).toBeCloseTo(0.4)
})
```

(`scenePropFor` joins the imports from `'../src/index.js'`; it is already exported there.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @uidx/schema test`
Expected: the fill test FAILS (the alias string passes through unresolved into the scene value today). The strokes one FAILS the same way.

- [ ] **Step 3: Implement in `to-scene.ts`**

Above `scenePropFor`:

```ts
/** Attrs whose array entries may carry a `color` alias (spec §4). */
const PAINT_PROPS: ReadonlySet<string> = new Set(['fills', 'strokes', 'effects'])

/**
 * Resolves `color` aliases inside paint/effect entries. An entry whose token
 * is missing is dropped — not the whole attribute — because the renderer's
 * job is to draw what it can (same stance as the attribute-level branch).
 */
function resolvePaintAliases(
  value: JsonValue,
  resolveAlias: AliasResolver | undefined,
  warnings: string[],
  at: string,
): JsonValue {
  if (!Array.isArray(value)) return value
  const out: JsonValue[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      out.push(entry)
      continue
    }
    const color = (entry as Record<string, JsonValue>).color
    const target = color === undefined ? null : aliasTarget(color)
    if (target === null) {
      out.push(entry)
      continue
    }
    const bound = resolveAlias?.(target)
    if (bound === undefined) {
      warnings.push(`${at}: unresolved token "${target}"`)
      continue
    }
    out.push({ ...(entry as Record<string, JsonValue>), color: bound })
  }
  return out
}
```

In `scenePropFor`, after the attribute-level alias block sets `authored`:

```ts
const entries = PAINT_PROPS.has(prop)
  ? resolvePaintAliases(authored, resolveAlias, warnings, at)
  : authored
```

and use `entries` where `authored` fed the fills branch and the fall-throughs:

```ts
const resolvedValue =
  prop === 'fills'
    ? resolveImagePaints(normalizeFills(entries), resolveAsset, warnings, at)
    : entries
```

In `overridesFor`, resolve before composing:

```ts
if (node.attrs.strokes) {
  const strokes = composeStrokes(
    resolvePaintAliases(
      node.attrs.strokes.value,
      resolveAlias,
      warnings,
      node.address || '<root>',
    ),
    { …existing sibling options unchanged… },
  )
  if (strokes) out.strokes = strokes
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @uidx/schema test`
Expected: PASS, including the authorship test (reconcile only rewrites attrs it changed; the test now pins that).

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/to-scene.ts packages/schema/test
git commit -m "Paint-level color aliases: fills, strokes and effects resolve per entry"
```

---

### Task 10: Token pills in the panel

The `{radius#md} = 8 [detach]` text row becomes Figma's variable pill; clicking it opens the popup to switch.

**Files:**
- Modify: `packages/viewer/src/PropertyField.vue`
- Test: `packages/viewer/test/properties-pane.test.ts` (and whichever file `grep` finds asserting the old row)

**Interfaces:**
- Consumes: `AssignPopup`, `pickingVariable` state (Task 8), the `variables` prop.
- Produces: `.token-pill` button (glyph `variable` + the variable's short name, full address + resolved value in `title`); `.token-detach` icon button that commits the resolved literal.

- [ ] **Step 1: Write the failing test**

`DOC` in `properties-pane.test.ts` already binds `cornerRadius="{radius#md}"` with `radius#md → 8` in `tokens`:

```ts
it('renders a token binding as a pill and detaches to the literal', async () => {
  const wrapper = pane()
  const pill = row(wrapper, 'cornerRadius').find('.token-pill')
  expect(pill.text()).toBe('md')
  expect(pill.attributes('title')).toContain('radius#md')
  expect(pill.attributes('title')).toContain('8')
  await row(wrapper, 'cornerRadius').find('.token-detach').trigger('click')
  const commits = wrapper.emitted('commit')!
  expect(commits.at(-1)).toEqual(['Card#root', 'cornerRadius', 8])
})

it('switches the token from the pill popup', async () => {
  const wrapper = pane()
  await row(wrapper, 'cornerRadius').find('.token-pill').trigger('click')
  await wrapper.find('[data-variable="radius#lg"]').trigger('click')
  const patches = wrapper.emitted('patches')!.at(-1)![0] as UidxPatch[]
  expect(patches).toEqual([
    { op: 'set', address: 'Card#root', prop: 'cornerRadius', value: '{radius#lg}' },
  ])
})
```

Add `['radius#lg', 16]` to the test file's `tokens` map.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @uidx/viewer test test/properties-pane.test.ts`
Expected: FAIL — the row renders `.token`/`.detach`, not `.token-pill`.

- [ ] **Step 3: Implement in `PropertyField.vue`**

Replace the `v-else-if="field.boundTo"` bound-value block with:

```html
<!--
  A token binding is Figma's variable pill: the name, the glyph, and nothing
  else in the box — the resolved value moves to the tooltip, typing waits for
  a detach (spec §4). Clicking the pill switches; the trailing icon detaches
  to the resolved literal.
-->
<div v-else-if="field.boundTo" class="value bound-value">
  <button
    type="button"
    class="token-pill"
    data-popup-trigger
    :disabled="!editable"
    :title="`${field.boundTo} = ${resolvedValue ?? '?'}`"
    @click="pickingVariable = !pickingVariable"
  >
    <FieldIcon name="variable" />
    {{ field.boundTo.split('#').pop() }}
  </button>
  <button
    type="button"
    class="icon-button token-detach"
    :disabled="!editable || resolvedValue === null"
    :title="`replace the binding with ${resolvedValue}`"
    @click="onNumberCommit(numberValue())"
  >
    <FieldIcon name="unlink-property" />
  </button>
</div>
```

The Task 8 `<AssignPopup v-if="pickingVariable">` block already renders for this state and already passes `:bound-to="field.boundTo"` — it needs no change; the pill and the glyph share `pickingVariable`. Styles — replace `.token`, `.resolves`, `.detach` rules with:

```css
.token-pill {
  display: inline-flex;
  flex: 1;
  gap: var(--gap-sm);
  align-items: center;
  min-width: 0;
  height: var(--field-h);
  padding: 0 6px;
  border: 0;
  border-radius: var(--radius-lg);
  background: var(--raised);
  color: var(--text);
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.token-pill:hover:not(:disabled) {
  background: color-mix(in srgb, var(--raised) 80%, var(--text) 8%);
}
.icon-button {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--field-h);
  height: var(--field-h);
  padding: 0;
  border: 0;
  border-radius: var(--radius);
  background: none;
  color: var(--text-faint);
  cursor: pointer;
}
.icon-button:hover:not(:disabled) {
  background: var(--raised);
  color: var(--text);
}
.icon-button:disabled {
  opacity: 0.4;
  cursor: default;
}
```

(Both pills are the same shape by design — purple = property, raised grey = token; spec §4.)

- [ ] **Step 4: Sweep the old selectors, run, commit**

`grep -rn '"\.token"\|\.detach\|resolves' packages/viewer/test` — update hits (the C6-era bound-row tests in `properties-pane.test.ts` / `panel-authored.test.ts`) to the new selectors, keeping their value assertions. Then `pnpm --filter @uidx/viewer test && pnpm --filter @uidx/viewer typecheck`.

```bash
git add packages/viewer/src/PropertyField.vue packages/viewer/test
git commit -m "Token bindings render as Figma's variable pill; the pill switches"
```

---

### Task 11: Alias-aware paint rows

A fill whose color is a token shows the resolved swatch + the variable name; detach writes the literal back.

**Files:**
- Modify: `packages/viewer/src/paint-edit.ts`
- Modify: `packages/viewer/src/PaintStackField.vue`
- Modify: `packages/viewer/src/PropertyField.vue`, `packages/viewer/src/PropertiesPane.vue` (plumb `tokens`)
- Test: `packages/viewer/test/paint-edit.test.ts`, `packages/viewer/test/properties-pane.test.ts`

**Interfaces:**
- Consumes: `aliasTarget`, `toAlias` from `@uidx/format`; the pane's `tokens` prop (already `Map<string, JsonValue>`).
- Produces, in `paint-edit.ts`:

```ts
// PaintLike.color widens to: color?: Rgba | string
export function paintColorAlias(paint: PaintLike): string | null
export function paintRgba(paint: PaintLike, tokens?: ReadonlyMap<string, JsonValue>): Rgba | null
export function setPaintColorAlias(paints: readonly PaintLike[], index: number, token: string): JsonValue
```

`PaintStackField` gains prop `tokens?: ReadonlyMap<string, JsonValue>`; `PropertyField` gains and forwards the same.

- [ ] **Step 1: Write the failing unit tests**

In `packages/viewer/test/paint-edit.test.ts`:

```ts
import { paintColorAlias, paintRgba, setPaintColorAlias } from '../src/paint-edit'

describe('alias-aware paints', () => {
  const tokens = new Map<string, JsonValue>([['palette#blue', { r: 0.1, g: 0.4, b: 0.9, a: 1 }]])
  const aliased = { type: 'SOLID', color: '{palette#blue}' }
  const literal = { type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }

  it('reads the alias out of a paint, and only an alias', () => {
    expect(paintColorAlias(aliased)).toBe('palette#blue')
    expect(paintColorAlias(literal)).toBeNull()
  })

  it('resolves to Rgba through the tokens map', () => {
    expect(paintRgba(aliased, tokens)).toEqual({ r: 0.1, g: 0.4, b: 0.9, a: 1 })
    expect(paintRgba(aliased, new Map())).toBeNull()
    expect(paintRgba(literal)).toEqual({ r: 1, g: 0, b: 0, a: 1 })
  })

  it('writes an alias into one paint and leaves the others', () => {
    const next = setPaintColorAlias([literal, aliased], 0, 'palette#blue') as {
      color: unknown
    }[]
    expect(next[0]!.color).toBe('{palette#blue}')
    expect(next[1]!.color).toBe('{palette#blue}')
  })

  // The spec §4 preservation pin: every fill write goes through this file's
  // whole-value algebra, so a sibling edit spreading the paint keeps the alias.
  it('sibling paint edits leave a color alias in place', () => {
    const paints = [aliased]
    expect((setPaintOpacity(paints, 0, 0.5) as { color: unknown }[])[0]!.color).toBe(
      '{palette#blue}',
    )
    expect((togglePaintVisible(paints, 0) as { color: unknown }[])[0]!.color).toBe(
      '{palette#blue}',
    )
  })
})
```

(match the file's existing import style for `JsonValue`.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @uidx/viewer test test/paint-edit.test.ts`
Expected: FAIL — no such exports.

- [ ] **Step 3: Implement the helpers**

In `paint-edit.ts`: widen `PaintLike`'s `color` to `Rgba | string`, import `aliasTarget, toAlias` from `@uidx/format`, and add:

```ts
/** The token a paint's color reads, or null when it holds a literal. */
export function paintColorAlias(paint: PaintLike): string | null {
  return typeof paint.color === 'string' ? aliasTarget(paint.color) : null
}

/** A paint's color as Rgba — resolving an alias through the tokens map. */
export function paintRgba(
  paint: PaintLike,
  tokens?: ReadonlyMap<string, JsonValue>,
): Rgba | null {
  if (typeof paint.color === 'string') {
    const target = aliasTarget(paint.color)
    const resolved = target ? tokens?.get(target) : undefined
    return isRgba(resolved) ? resolved : null
  }
  return paint.color ?? null
}

/** Point one paint's color at a variable. */
export function setPaintColorAlias(
  paints: readonly PaintLike[],
  index: number,
  token: string,
): JsonValue {
  return paints.map((p, i) =>
    i === index ? { ...p, color: toAlias(token) } : p,
  ) as unknown as JsonValue
}
```

Fix the type fallout the widened `color` causes inside this file (`setPaintColor` writes an Rgba over whatever was there — no change needed; anything reading `.color` as Rgba now goes through `paintRgba` or narrows with `typeof`). `documentSwatches` must skip alias colors (`typeof color === 'string'` → skip).

- [ ] **Step 4: Write the failing component test**

In `properties-pane.test.ts`, a second document (the main `DOC` keeps its literal fill):

```ts
const ALIASED_FILL = parseOrThrow(`---
id: aliased
---

## Visual Contract

<Page>
  <Component name="Card" status="draft">
    <Frame name="root" width={10} height={10}
      fills={[{ type: 'SOLID', color: "{palette#blue}" }]} />
  </Component>
</Page>
`)

it('shows a token fill as swatch + variable name, and detaches to the literal', async () => {
  const blue = { r: 0.1, g: 0.4, b: 0.9, a: 1 }
  const wrapper = mount(PropertiesPane, {
    props: {
      doc: ALIASED_FILL,
      selection: ['Card#root'],
      tokens: new Map<string, JsonValue>([['palette#blue', blue]]),
      writable: true,
    },
  })
  const tokenRow = wrapper.find('.paint-token')
  expect(tokenRow.text()).toBe('blue')
  expect(tokenRow.attributes('title')).toBe('palette#blue')
  await wrapper.find('.paint-detach').trigger('click')
  const [, prop, value] = wrapper.emitted('commit')!.at(-1)!
  expect(prop).toBe('fills')
  expect((value as { color: unknown }[])[0]!.color).toEqual(blue)
})
```

- [ ] **Step 5: Implement the row**

Plumb `tokens`: `PropertyField.vue` props gain `tokens?: ReadonlyMap<string, JsonValue>`, forwarded to `<PaintStackField :tokens="tokens" …>`; `PropertiesPane.vue` passes `:tokens="tokens"` at every `<PropertyField>` site.

`PaintStackField.vue` — props gain `tokens?: ReadonlyMap<string, JsonValue>`; import `paintColorAlias, paintRgba, setPaintColorAlias` from `./paint-edit`. Add a script helper and use it for the swatch:

```ts
function swatchCss(paint: PaintLike): string {
  const rgba = paintRgba(paint, props.tokens)
  return rgba ? cssColor(rgba, paint.opacity ?? 1) : 'transparent'
}
```

```html
:style="{ background: swatchCss(paint) }"
```

Replace the solid-row inputs branch:

```html
<template v-if="paint.type === 'SOLID' && !paintColorAlias(paint)">
  <!-- the hex + opacity inputs, unchanged -->
</template>
<template v-else-if="paint.type === 'SOLID'">
  <button
    type="button"
    class="paint-token"
    data-picker-trigger
    :disabled="!editable"
    :title="paintColorAlias(paint)!"
    @click="open = open === i ? null : i"
  >
    {{ paintColorAlias(paint)!.split('#').pop() }}
  </button>
  <button
    type="button"
    class="paint-detach"
    :disabled="!editable || !paintRgba(paint, tokens)"
    title="replace the binding with its color"
    @click="commit(setPaintColor(paints(), i, paintRgba(paint, tokens)!))"
  >
    ×
  </button>
</template>
```

(keep the existing eye/remove buttons after it; `onHex` and `nextPaints` only run from the literal branch, so their Rgba reads stay narrow — add `as Rgba` narrows where TypeScript complains, guarded by the branch). The `ColorPickerDialog`'s `:color` prop becomes `paintRgba(paint, tokens) ?? { r: 0.5, g: 0.5, b: 0.5, a: 1 }`. Styles: `.paint-token` mirrors `.token-pill` (raised, `--radius-lg`, ellipsis, `flex: 1`); `.paint-detach` mirrors `.paint-remove`.

- [ ] **Step 6: Run everything, commit**

Run: `pnpm --filter @uidx/viewer test && pnpm --filter @uidx/viewer typecheck`

```bash
git add packages/viewer/src packages/viewer/test
git commit -m "Paint rows read and detach color variables"
```

---

### Task 12: The color picker's Libraries tab

**Files:**
- Modify: `packages/viewer/src/ColorPickerDialog.vue`
- Modify: `packages/viewer/src/PaintStackField.vue`
- Test: `packages/viewer/test/properties-pane.test.ts`

**Interfaces:**
- Consumes: `VariableRow` (Task 6), `variableCandidates` (Task 5), `setPaintColorAlias`/`paintColorAlias` (Task 11).
- Produces: `ColorPickerDialog` props gain `libraries?: VariableCandidate[]` and `currentToken?: string | null`; emits gain `pick: [address: string]`. Tabs render only when `libraries` is non-empty.

- [ ] **Step 1: Write the failing test**

```ts
it('binds a fill to a color variable from the Libraries tab', async () => {
  const blue = { r: 0.1, g: 0.4, b: 0.9, a: 1 }
  const wrapper = mount(PropertiesPane, {
    props: {
      doc: DOC, // the literal red fill
      selection: ['Card#root'],
      tokens: new Map<string, JsonValue>([['palette#blue', blue]]),
      writable: true,
    },
  })
  await wrapper.find('.paint-swatch').trigger('click')
  await wrapper.find('.picker-tab-libraries').trigger('click')
  await wrapper.find('[data-variable="palette#blue"]').trigger('click')
  const [, prop, value] = wrapper.emitted('commit')!.at(-1)!
  expect(prop).toBe('fills')
  expect((value as { color: unknown }[])[0]!.color).toBe('{palette#blue}')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @uidx/viewer test test/properties-pane.test.ts`
Expected: FAIL — no `.picker-tab-libraries`.

- [ ] **Step 3: Implement**

`ColorPickerDialog.vue` — props gain `libraries?: VariableCandidate[]` and `currentToken?: string | null` (type import from `./variable-binding`); emits gain `pick: [address: string]`. Script:

```ts
const tab = ref<'custom' | 'libraries'>(props.currentToken ? 'libraries' : 'custom')
const libraryQuery = ref('')
const libraryCollections = computed(() => {
  const groups = new Map<string, VariableCandidate[]>()
  for (const candidate of props.libraries ?? []) {
    if (!candidate.name.toLowerCase().includes(libraryQuery.value.trim().toLowerCase())) continue
    const list = groups.get(candidate.collection) ?? []
    list.push(candidate)
    groups.set(candidate.collection, list)
  }
  return [...groups]
})
```

Template — at the top of the dialog root:

```html
<div v-if="libraries?.length" class="picker-tabs">
  <button
    type="button"
    class="picker-tab picker-tab-custom"
    :class="{ on: tab === 'custom' }"
    @click="tab = 'custom'"
  >
    Custom
  </button>
  <button
    type="button"
    class="picker-tab picker-tab-libraries"
    :class="{ on: tab === 'libraries' }"
    @click="tab = 'libraries'"
  >
    Libraries
  </button>
</div>
```

Wrap the existing picker body in `<template v-if="tab === 'custom'">…</template>` and add:

```html
<template v-else>
  <div class="library-search">
    <FieldIcon name="search" />
    <input v-model="libraryQuery" placeholder="Search" aria-label="search color variables" />
  </div>
  <div class="library-list">
    <template v-for="[collection, rows] in libraryCollections" :key="collection">
      <p class="library-collection">{{ collection }}</p>
      <VariableRow
        v-for="candidate in rows"
        :key="candidate.address"
        :candidate="candidate"
        :current="candidate.address === currentToken"
        @pick="emit('pick', candidate.address)"
      />
    </template>
  </div>
</template>
```

Styles: `.picker-tabs` a row of two text tabs (`.on` gets `background: var(--raised); color: var(--text)`, off gets `--text-dim`); `.library-search` mirrors the popup's search bar; `.library-list { max-height: 240px; overflow-y: auto; }`; `.library-collection` mirrors `.popup-collection`.

`PaintStackField.vue` — script:

```ts
import { variableCandidates } from './variable-binding'
const colorVariables = computed(() => variableCandidates(props.tokens, 'COLOR'))
```

(add `computed` to the vue import). On the `<ColorPickerDialog>`:

```html
:libraries="colorVariables"
:current-token="paintColorAlias(paint)"
@pick="(a) => commit(setPaintColorAlias(paints(), i, a), false)"
```

- [ ] **Step 4: Run to verify pass, full suites, commit**

Run: `pnpm --filter @uidx/viewer test && pnpm --filter @uidx/viewer typecheck && pnpm --filter @uidx/schema test`

```bash
git add packages/viewer/src packages/viewer/test
git commit -m "Custom | Libraries: the color picker lists and binds color variables"
```

---

### Task 13: Live verification against the reference

**Files:** none (fixes go wherever the eyeball finds them)

- [ ] **Step 1: Stage a scratch copy** (standing rule: never live-edit `examples/`)

```bash
cp -r examples /private/tmp/claude-501/-Users-guybehar-projects-uidx/*/scratchpad/live-examples 2>/dev/null || cp -r examples "$TMPDIR/live-examples"
```

- [ ] **Step 2: Run the viewer on the scratch copy.** The repo's dev flow is `.claude/launch.json`'s `uidx-example` config: `node packages/cli/dist/uidx.js open --port 4400 --no-open <file>`. Build first (`pnpm build:cli`), temporarily point the config's file argument at a file in the scratch copy (revert this edit before the final commit — `git checkout .claude/launch.json`), then open it with the Browser pane's `preview_start {name: "uidx-example"}` — never a raw Bash server. Before trusting any probe, check `preview_logs` for Vite reload 500s (known pitfall from earlier live sessions).

- [ ] **Step 3: Walk the spec's §9 live list** on `bound-card.uidx` + `core-tokens.uidx` + `sign-in.uidx`:
  1. Bind `cornerRadius` → `radius#md` from the number field's hover glyph; confirm the file diff reads `cornerRadius="{radius#md}"` and the canvas redraws.
  2. Bind a fill → `palette#blue-500` from Libraries; diff reads the alias inside the paint; swatch shows the resolved blue.
  3. Bind Content → a STRING variable (add one to the scratch tokens file if none exists); pill renders; detach restores.
  4. The three property flows (Content / eye / swap) still produce F12's file edits.
  5. Screenshot the panel beside the reference screenshots; walk spec §1's table row by row (captions, separators, cluster icons, pill anatomy, popup anatomy, token pills, Libraries tab).

- [ ] **Step 4: Fix what the eyeball catches** (spacing constants in `theme.css`, popup width, caption weights) — style-only diffs, suite green, then:

```bash
git add -A packages
git commit -m "UI3 polish from the side-by-side against the reference"
```

- [ ] **Step 5: Update the spec's status line** (`docs/panel-ui3-and-variables.md`: "approved, not yet built" → built/verified with date, plus a §-style deviations note for anything that changed while building, following the house pattern). Commit.

---

## Self-review notes (already applied)

- Spec §2's "no glyph on unlinked rows / dimmed glyph on section headers" is preserved: Task 7 keeps the header `PropertyLink` apply buttons and their `.apply-property` dimmed-at-rest styling untouched.
- Spec §3's instance-swap rule (properties only, no variables) is Task 7's `:variables="[]"` on the swap row.
- Spec §6 "number-field property binding" stays impossible: `AssignPopup` gets `candidates: null` from number fields (Task 8), so only variables render.
- Spec §4's "typing unavailable while bound" was already true (the bound branch renders no input) and stays true with the pill.
- `documentSwatches` skipping alias colors (Task 11) keeps the picker's "on this page" row honest — an alias is not a literal the document uses.
