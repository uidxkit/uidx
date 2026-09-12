# Typed Tokens, Modes and Scopes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `.uidx` tokens an explicit type, per-collection modes with inherited per-node selection, and picker scopes — so one token can hold different values in different contexts.

**Architecture:** The file grammar grows a `<Mode>` element and three `<Variable>` attributes. Resolution changes shape: a flat `address → literal` map becomes a pure `TokenIndex` plus `TokenResolver.resolve(tuple)`, memoised per mode tuple. The tuple rides **down** the renderer's existing descent as inherited context (Figma's `explicitVariableModes` / `resolvedVariableModes` split), so no node ever walks up.

**Tech Stack:** TypeScript, pnpm workspaces, Vue 3 (viewer), Vitest, `@open-pencil/scene-graph`.

**Spec:** [docs/superpowers/specs/2026-08-25-typed-tokens-and-modes-design.md](../specs/2026-08-25-typed-tokens-and-modes-design.md)

## Global Constraints

- **Node 22 is required for tests.** The default node 18 fails with `ERR_REQUIRE_ESM`. Every test command in this plan is prefixed: `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"`.
- **Work commits straight to `main`.** No worktree, no feature branch.
- **Diagnostic codes are append-only.** "editors and CI parse these, so entries are appended, never renumbered." The last code in use is `UIDX121`; new codes start at `UIDX122`.
- **Variable types are Figma's four:** `COLOR | FLOAT | STRING | BOOLEAN`. `EASING` and `TIMING` are out of scope.
- **Scopes are Figma's 22 plus `SPACING`.** Exact list in Task 3.
- **Binding writes are patches, never scene-graph commits.** Writing `"{radius#md}"` through the commit route hands D4 a string where it reflows numbers.
- **Detach writes the resolved literal**, never a blank.
- **TDD:** failing test → run it → minimal implementation → run it → commit.
- **Commit messages are a descriptive sentence**, not conventional commits. The repo
  has no `feat:`/`fix:` prefixes — see `git log`. Each message says what the change
  means, e.g. "A node selects a mode, the way Figma's Appearance section does".

---

## File Structure

**`@uidx/format`** — grammar and per-file validation
- Modify `src/types.ts` — `ELEMENTS`, `TOKEN_ELEMENTS`, `CONTAINER_ELEMENTS`, new `VARIABLE_CHILD_ELEMENTS`, `VARIABLE_SCOPES`, `STRUCTURAL_PROPS`
- Modify `src/diagnostics.ts` — codes `UIDX122`–`UIDX130`
- Modify `src/parse.ts` — `legalChildrenOf`, `checkVariable`, new `checkCollection`, `checkNodeModes`, null address for `<Mode>`
- Modify `src/alias.ts` — add `fitsVariableType`
- Test `test/tokens.test.ts` (existing file, new describes)

**`@uidx/schema`** — the token model and resolution
- Create `src/token-index.ts` — `TokenIndex`, `buildTokenIndex`
- Create `src/resolve-modes.ts` — `ModeTuple`, `modeTupleKey`, `defaultTuple`, `mergeModes`, `TokenResolver`
- Create `src/scope-for-prop.ts` — `SCOPE_FOR_PROP`
- Modify `src/tokens.ts` — `resolveTokenValues` delegates to the new modules
- Test `test/token-index.test.ts`, `test/resolve-modes.test.ts`

**`@uidx/server`** — cross-document reference diagnostics
- Modify `src/symbols.ts` — walk `<Mode>` values when collecting references; alias type-match check

**`@uidx/viewer`** — render and panel
- Modify `src/variable-binding.ts` — `variableCandidates` takes a resolver and a scope
- Modify the render descent to thread `ModeTuple`
- Modify `src/AssignPopup.vue` — scope filtering
- Create `src/ModeRow.vue` — the **Apply variable mode** control
- Modify `src/PropertiesPane.vue` — mount `ModeRow` in Appearance

**`@uidx/cli`**
- Create `src/commands/migrate-tokens.ts` — `uidx migrate tokens`

---

## Task 1: `type` becomes required on `<Variable>`

**Files:**
- Modify: `packages/format/src/alias.ts` (add `fitsVariableType`)
- Modify: `packages/format/src/diagnostics.ts` (add `UIDX122`, `UIDX123`)
- Modify: `packages/format/src/parse.ts:455` (`checkVariable`)
- Modify: `examples/core-tokens.uidx`, `examples/bound-card.uidx`, `examples/sign-in.uidx`, `examples/toggle.uidx`, `examples/checkbox.uidx` (only files containing `<Variable>`)
- Test: `packages/format/test/tokens.test.ts`

**Interfaces:**
- Consumes: existing `variableTypeOf(value): VariableType | null`, `isAlias(value)`
- Produces: `fitsVariableType(value: JsonValue, type: VariableType): boolean` — true when `value` is an alias (an alias takes its target's type) or when `variableTypeOf(value) === type`

- [x] **Step 1: Write the failing tests**

In `packages/format/test/tokens.test.ts`, add:

```ts
describe('explicit variable types (G8)', () => {
  const one = (attrs: string) =>
    tokens(`<Tokens>\n  <Collection name="c">\n    <Variable name="v" ${attrs} />\n  </Collection>\n</Tokens>`)

  it('requires a type attribute', () => {
    const codes = parse(one('value={8}')).diagnostics.map((d) => d.code)
    expect(codes).toContain(CODES.MISSING_VARIABLE_TYPE)
  })

  it('accepts a matching type', () => {
    expect(parse(one('type="FLOAT" value={8}')).diagnostics).toEqual([])
  })

  it('rejects a type the value contradicts', () => {
    const codes = parse(one('type="COLOR" value={8}')).diagnostics.map((d) => d.code)
    expect(codes).toContain(CODES.VARIABLE_TYPE_MISMATCH)
  })

  it('rejects an unknown type name', () => {
    const codes = parse(one('type="DIMENSION" value={8}')).diagnostics.map((d) => d.code)
    expect(codes).toContain(CODES.VARIABLE_TYPE_MISMATCH)
  })

  it('lets an alias declare any type, since it takes its target’s', () => {
    expect(parse(one('type="COLOR" value="{palette#blue}"')).diagnostics).toEqual([])
  })
})
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/format test -- tokens`
Expected: FAIL — `CODES.MISSING_VARIABLE_TYPE` is `undefined`.

- [x] **Step 3: Add the codes**

In `packages/format/src/diagnostics.ts`, after `VARIANT_SHAPE: 'UIDX121',`:

```ts
  // typed tokens, modes and scopes (story G8)
  /** A `<Variable>` with no `type`. Figma picks a type at creation; so do we. */
  MISSING_VARIABLE_TYPE: 'UIDX122',
  /** A declared `type` that is not one of the four, or that the value contradicts. */
  VARIABLE_TYPE_MISMATCH: 'UIDX123',
```

- [x] **Step 4: Add `fitsVariableType`**

In `packages/format/src/alias.ts`, append:

```ts
/**
 * Whether an authored value may sit under a declared type.
 *
 * An alias is always allowed: it has no type of its own and takes whatever its
 * target resolves to, which the symbol table settles across documents. This is
 * the validation half of `variableTypeOf` — inference stopped being the source
 * of truth in G8, but the logic was always right, only in the wrong position.
 */
export function fitsVariableType(value: JsonValue, type: VariableType): boolean {
  if (isAlias(value)) return true
  return variableTypeOf(value) === type
}
```

Export it from `packages/format/src/index.ts` alongside `variableTypeOf`.

- [x] **Step 5: Require and validate the type**

Replace `checkVariable` in `packages/format/src/parse.ts:455`. Note the doc comment must change too — it currently says the type "is inferred from it rather than declared", which G8 reverses.

```ts
  /**
   * A `<Variable>` declares its type and states its value (story G8).
   *
   * Inference is gone from this position: a variable's type is one fact across
   * every mode, so it cannot be re-derived per value, and a declared type is
   * the only thing a mismatch can be checked against. Figma does the same —
   * the type is chosen at creation, not guessed.
   */
  private checkVariable(attrs: Record<string, UidxAttr>, loc: Range): void {
    const type = attrs.type
    if (!type) {
      this.error(CODES.MISSING_VARIABLE_TYPE, '<Variable> requires a "type" attribute', loc)
    } else if (
      typeof type.value !== 'string' ||
      !(VARIABLE_TYPES as readonly string[]).includes(type.value)
    ) {
      this.error(
        CODES.VARIABLE_TYPE_MISMATCH,
        `a <Variable> type must be one of ${VARIABLE_TYPES.join(', ')}`,
        type.valueLoc,
      )
    }

    const value = attrs.value
    if (!value) {
      this.error(CODES.MISSING_VARIABLE_VALUE, '<Variable> requires a "value" attribute', loc)
      return
    }
    if (isAlias(value.value)) return
    if (variableTypeOf(value.value) === null) {
      this.error(
        CODES.BAD_VARIABLE_VALUE,
        'a <Variable> value must be a number, string, boolean, a colour ' +
          '{ r, g, b, a }, or an alias like "{other#token}"',
        value.valueLoc,
      )
      return
    }
    if (
      type &&
      typeof type.value === 'string' &&
      (VARIABLE_TYPES as readonly string[]).includes(type.value) &&
      !fitsVariableType(value.value, type.value as VariableType)
    ) {
      this.error(
        CODES.VARIABLE_TYPE_MISMATCH,
        `this value is ${variableTypeOf(value.value)}, not ${type.value}`,
        value.valueLoc,
      )
    }
  }
```

Add `VARIABLE_TYPES`, `fitsVariableType` and the `VariableType` type to the imports at the top of `parse.ts`.

> Task 2 relaxes the "value is required" branch for variables that use `<Mode>` children. Leave it strict here — Task 2's tests will drive the change.

- [x] **Step 6: Run the tests to verify they pass**

Run: `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/format test -- tokens`
Expected: PASS.

- [x] **Step 7: Migrate the example files**

Every `<Variable>` in `examples/` needs a `type`. In `examples/core-tokens.uidx`:

```jsx
<Tokens>
  <Collection name="radius">
    <Variable name="sm" type="FLOAT" value={4} />
    <Variable name="md" type="FLOAT" value={8} />
    <Variable name="lg" type="FLOAT" value={16} />
  </Collection>
  <Collection name="palette">
    <Variable name="blue-500" type="COLOR" value={{ r: 0.1, g: 0.4, b: 0.9, a: 1 }} />
    <Variable name="white" type="COLOR" value={{ r: 1, g: 1, b: 1, a: 1 }} />
  </Collection>
  <Collection name="semantic">
    <Variable name="brand" type="COLOR" value="{palette#blue-500}" />
    <Variable name="on-brand" type="COLOR" value="{palette#white}" />
  </Collection>
</Tokens>
```

Find any others: `grep -rln "<Variable" examples/`. Files that only *bind* tokens (`cornerRadius="{radius#lg}"`) need no change.

- [x] **Step 8: Run the full suite**

Run: `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm test`
Expected: PASS. Any failure here is a fixture elsewhere that declares a `<Variable>`; add the `type` there too.

- [x] **Step 9: Commit**

```bash
git add packages/format examples
git commit -m "A variable declares its type; inference moves to validation"
```

---

## Task 2: `<Mode>` element and `modes` on `<Collection>`

**Files:**
- Modify: `packages/format/src/types.ts`
- Modify: `packages/format/src/diagnostics.ts` (`UIDX124`–`UIDX127`)
- Modify: `packages/format/src/parse.ts` (`legalChildrenOf`, address rule, `checkCollection`, `checkVariable`)
- Test: `packages/format/test/tokens.test.ts`

**Interfaces:**
- Consumes: `fitsVariableType` from Task 1
- Produces: `<Mode name value>` legal only inside `<Variable>`; `modes` on `<Collection>` as `string[]`; a `<Mode>` node whose `address` is the empty string

- [x] **Step 1: Write the failing tests**

```ts
describe('modes (G8)', () => {
  const MODED = tokens(`<Tokens>
  <Collection name="semantic" modes={['light', 'dark']}>
    <Variable name="surface" type="COLOR">
      <Mode name="light" value={{ r: 1, g: 1, b: 1, a: 1 }} />
      <Mode name="dark" value={{ r: 0, g: 0, b: 0, a: 1 }} />
    </Variable>
  </Collection>
</Tokens>`)

  it('parses <Mode> children', () => {
    const { doc, diagnostics } = parse(MODED)
    expect(diagnostics).toEqual([])
    const v = resolve(doc!.tree, 'semantic#surface')!
    expect(v.children.map((m) => m.element)).toEqual(['Mode', 'Mode'])
  })

  // The collision this guards: addressOf joins with `/` once an address holds
  // `#`, so an addressed Mode would be `semantic#surface/light` — identical to
  // a real variable named `surface/light`.
  it('gives a <Mode> no address of its own', () => {
    const doc = parseOrThrow(MODED)
    const v = resolve(doc.tree, 'semantic#surface')!
    expect(v.children.map((m) => m.address)).toEqual(['', ''])
    expect(resolve(doc.tree, 'semantic#surface/light')).toBeNull()
  })

  it('rejects <Mode> children in a collection with no modes', () => {
    const src = tokens(`<Tokens>
  <Collection name="c">
    <Variable name="v" type="FLOAT"><Mode name="light" value={8} /></Variable>
  </Collection>
</Tokens>`)
    expect(parse(src).diagnostics.map((d) => d.code)).toContain(CODES.MODE_SHAPE)
  })

  it('rejects a bare value in a moded collection', () => {
    const src = tokens(`<Tokens>
  <Collection name="c" modes={['light']}>
    <Variable name="v" type="FLOAT" value={8} />
  </Collection>
</Tokens>`)
    expect(parse(src).diagnostics.map((d) => d.code)).toContain(CODES.MODE_SHAPE)
  })

  it('rejects a <Mode> name the collection never declared', () => {
    const src = tokens(`<Tokens>
  <Collection name="c" modes={['light']}>
    <Variable name="v" type="FLOAT"><Mode name="dusk" value={8} /></Variable>
  </Collection>
</Tokens>`)
    expect(parse(src).diagnostics.map((d) => d.code)).toContain(CODES.UNKNOWN_MODE)
  })

  it('rejects a variable that misses a declared mode', () => {
    const src = tokens(`<Tokens>
  <Collection name="c" modes={['light', 'dark']}>
    <Variable name="v" type="FLOAT"><Mode name="light" value={8} /></Variable>
  </Collection>
</Tokens>`)
    expect(parse(src).diagnostics.map((d) => d.code)).toContain(CODES.MISSING_MODE)
  })

  it('rejects duplicate mode names on a collection', () => {
    const src = tokens(`<Tokens>
  <Collection name="c" modes={['light', 'light']}>
    <Variable name="v" type="FLOAT"><Mode name="light" value={8} /></Variable>
  </Collection>
</Tokens>`)
    expect(parse(src).diagnostics.map((d) => d.code)).toContain(CODES.BAD_COLLECTION_MODES)
  })

  it('type-checks each mode value', () => {
    const src = tokens(`<Tokens>
  <Collection name="c" modes={['light']}>
    <Variable name="v" type="COLOR"><Mode name="light" value={8} /></Variable>
  </Collection>
</Tokens>`)
    expect(parse(src).diagnostics.map((d) => d.code)).toContain(CODES.VARIABLE_TYPE_MISMATCH)
  })
})
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/format test -- tokens`
Expected: FAIL — `<Mode> is not allowed inside <Variable>`.

- [x] **Step 3: Extend the grammar constants**

In `packages/format/src/types.ts`, add `'Mode'` to the `ELEMENTS` array after `'Variable'`, with a comment:

```ts
  // Story G8. A `<Mode>` is one column of a collection's table — the value a
  // variable takes in that context. It is not addressable: a binding names
  // `{semantic#surface}` and the render context picks the mode, so lowering it
  // with an address would collide with a variable named `surface/light`.
  'Mode',
```

Then update these three and add one:

```ts
export type SceneElement = Exclude<UidxElement, 'Tokens' | 'Collection' | 'Variable' | 'Mode'>

export const CONTAINER_ELEMENTS: ReadonlySet<string> = new Set([
  'Page', 'Component', 'Variant', 'Frame', 'Tokens', 'Collection', 'Variable',
])

export const TOKEN_ELEMENTS: ReadonlySet<string> = new Set([
  'Tokens', 'Collection', 'Variable', 'Mode',
])

export const VARIABLE_CHILD_ELEMENTS: ReadonlySet<string> = new Set(['Mode'])
```

- [x] **Step 4: Teach `legalChildrenOf` and the address rule**

In `packages/format/src/parse.ts`, add to `legalChildrenOf` (around line 103):

```ts
    case 'Variable':
      return VARIABLE_CHILD_ELEMENTS
```

Then find the address assignment (`const address = isRoot ? '' : addressOf(parentAddress, name)`, around line 302) and make `<Mode>` exempt:

```ts
    // A `<Mode>` is a value carrier, not an entity. `addressOf` would join with
    // `/` here — `semantic#surface/light` — which is exactly the address a
    // variable named `surface/light` already owns.
    const address = isRoot || element === 'Mode' ? '' : addressOf(parentAddress, name)
```

- [x] **Step 5: Add the codes**

```ts
  /** `modes` on a `<Collection>` that is not an array of unique non-empty strings. */
  BAD_COLLECTION_MODES: 'UIDX124',
  /** The either/or rule: `<Mode>` children without `modes`, or `value` with them. */
  MODE_SHAPE: 'UIDX125',
  /** A `<Mode name>` the collection never declared. */
  UNKNOWN_MODE: 'UIDX126',
  /** A variable that does not cover every mode its collection declares. */
  MISSING_MODE: 'UIDX127',
```

- [x] **Step 6: Validate collections and moded variables**

`checkVariable` needs the collection's declared modes, which it cannot see from `attrs` alone. Thread them: in the `Lowerer`, keep a field `private collectionModes: string[] | null = null`, set it when lowering a `<Collection>` and clear it after its children are lowered.

Add to `parse.ts`:

```ts
  /**
   * A collection's mode list (story G8). Array order is the default — leftmost
   * wins, which is the same gesture Figma gives you by dragging a column left.
   */
  private checkCollection(attrs: Record<string, UidxAttr>): string[] | null {
    const modes = attrs.modes
    if (!modes) return null
    const v = modes.value
    const ok =
      Array.isArray(v) &&
      v.length > 0 &&
      v.every((m) => typeof m === 'string' && m.length > 0) &&
      new Set(v as string[]).size === v.length
    if (!ok) {
      this.error(
        CODES.BAD_COLLECTION_MODES,
        'a <Collection> "modes" must be a non-empty array of unique mode names',
        modes.valueLoc,
      )
      return null
    }
    return v as string[]
  }
```

In `checkVariable`, replace the "value is required" branch with the either/or rule. `checkVariable` gains two parameters — the declared modes and the variable's `<Mode>` children — so its call site at line 297 becomes a call made *after* children are known, or the mode checks move into a second pass. Simplest: keep `checkVariable` for `type`, and add a separate check run once a `<Variable>` node is fully built:

```ts
  /**
   * The either/or rule (story G8): a collection either declares `modes`, and
   * every variable in it uses `<Mode>` children, or it does not, and every
   * variable uses `value`. One rule, checkable in one place, and it keeps a
   * single-mode collection byte-identical to what G5 wrote.
   */
  private checkVariableModes(node: UidxNode, modes: string[] | null, loc: Range): void {
    const declaredType = node.attrs.type?.value
    const type =
      typeof declaredType === 'string' && (VARIABLE_TYPES as readonly string[]).includes(declaredType)
        ? (declaredType as VariableType)
        : null
    const hasValue = node.attrs.value !== undefined
    const modeChildren = node.children.filter((c) => c.element === 'Mode')

    if (modes === null) {
      if (modeChildren.length > 0) {
        this.error(
          CODES.MODE_SHAPE,
          '<Mode> requires its <Collection> to declare "modes"',
          loc,
        )
      }
      return
    }

    if (hasValue) {
      this.error(
        CODES.MODE_SHAPE,
        'a variable in a moded collection states its values as <Mode> children, not "value"',
        node.attrs.value!.valueLoc,
      )
    }

    const seen = new Set<string>()
    for (const child of modeChildren) {
      if (!modes.includes(child.name)) {
        this.error(CODES.UNKNOWN_MODE, `"${child.name}" is not a mode of this collection`, loc)
        continue
      }
      seen.add(child.name)
      const value = child.attrs.value
      if (!value) {
        this.error(CODES.MISSING_VARIABLE_VALUE, '<Mode> requires a "value" attribute', loc)
        continue
      }
      if (type && !fitsVariableType(value.value, type)) {
        this.error(
          CODES.VARIABLE_TYPE_MISMATCH,
          `this value is ${variableTypeOf(value.value)}, not ${type}`,
          value.valueLoc,
        )
      }
    }

    for (const mode of modes) {
      if (!seen.has(mode)) {
        this.error(CODES.MISSING_MODE, `no value for mode "${mode}"`, loc)
      }
    }
  }
```

Also relax Task 1's `checkVariable`: only report `MISSING_VARIABLE_VALUE` when the variable has no `<Mode>` children — otherwise a moded variable trips both rules and reports twice for one mistake.

- [x] **Step 7: Run the tests to verify they pass**

Run: `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/format test -- tokens`
Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add packages/format
git commit -m "A collection declares its modes; a variable states one value per mode"
```

---

## Task 3: `scopes` and `description` on `<Variable>`

**Files:**
- Modify: `packages/format/src/types.ts` (`VARIABLE_SCOPES`)
- Modify: `packages/format/src/diagnostics.ts` (`UIDX128`)
- Modify: `packages/format/src/parse.ts` (`checkVariable`)
- Test: `packages/format/test/tokens.test.ts`

**Interfaces:**
- Produces: `VARIABLE_SCOPES` (23 members), `VariableScope` type. An absent `scopes` attribute means `['ALL_SCOPES']`; an absent `description` is the empty string. Neither default is written into the file.

- [x] **Step 1: Write the failing tests**

```ts
describe('scopes and descriptions (G8)', () => {
  const one = (attrs: string) =>
    tokens(`<Tokens>\n  <Collection name="c">\n    <Variable name="v" type="FLOAT" value={8} ${attrs} />\n  </Collection>\n</Tokens>`)

  it('accepts a known scope', () => {
    expect(parse(one(`scopes={['CORNER_RADIUS']}`)).diagnostics).toEqual([])
  })

  it('accepts SPACING, which Figma lacks', () => {
    expect(parse(one(`scopes={['SPACING']}`)).diagnostics).toEqual([])
  })

  it('rejects an unknown scope', () => {
    expect(parse(one(`scopes={['PADDING']}`)).diagnostics.map((d) => d.code)).toContain(
      CODES.BAD_SCOPE,
    )
  })

  it('rejects a non-array scopes', () => {
    expect(parse(one(`scopes="CORNER_RADIUS"`)).diagnostics.map((d) => d.code)).toContain(
      CODES.BAD_SCOPE,
    )
  })

  it('accepts a description', () => {
    expect(parse(one(`description="Card corners only."`)).diagnostics).toEqual([])
  })
})
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/format test -- tokens`
Expected: FAIL — `CODES.BAD_SCOPE` is `undefined`, and `scopes`/`description` trip the unknown-attribute path.

- [x] **Step 3: Add the scope vocabulary**

In `packages/format/src/types.ts`:

```ts
/**
 * Figma's 22 `VariableScope` values, plus one (story G8).
 *
 * `SPACING` has no Figma equivalent: Figma filters padding with `GAP`, so a
 * padding scale and a gap scale are indistinguishable in its picker. Export
 * maps `SPACING` down to `GAP`.
 */
export const VARIABLE_SCOPES = [
  'ALL_SCOPES',
  'TEXT_CONTENT',
  'CORNER_RADIUS',
  'WIDTH_HEIGHT',
  'GAP',
  'SPACING',
  'ALL_FILLS',
  'FRAME_FILL',
  'SHAPE_FILL',
  'TEXT_FILL',
  'STROKE_COLOR',
  'STROKE_FLOAT',
  'EFFECT_FLOAT',
  'EFFECT_COLOR',
  'OPACITY',
  'FONT_FAMILY',
  'FONT_STYLE',
  'FONT_WEIGHT',
  'FONT_SIZE',
  'LINE_HEIGHT',
  'LETTER_SPACING',
  'PARAGRAPH_SPACING',
  'PARAGRAPH_INDENT',
] as const
export type VariableScope = (typeof VARIABLE_SCOPES)[number]
```

Add the code in `diagnostics.ts`:

```ts
  /** A `scopes` entry that is not one of `VARIABLE_SCOPES`. */
  BAD_SCOPE: 'UIDX128',
```

- [x] **Step 4: Validate them**

Append to `checkVariable` in `parse.ts`:

```ts
    const scopes = attrs.scopes
    if (scopes) {
      const v = scopes.value
      const ok =
        Array.isArray(v) &&
        v.every((s) => typeof s === 'string' && (VARIABLE_SCOPES as readonly string[]).includes(s))
      if (!ok) {
        this.error(
          CODES.BAD_SCOPE,
          `a <Variable> "scopes" must be an array of: ${VARIABLE_SCOPES.join(', ')}`,
          scopes.valueLoc,
        )
      }
    }
```

`description` needs no validation beyond the attribute grammar's own string check.

- [x] **Step 5: Run the tests to verify they pass**

Run: `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/format test -- tokens`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/format
git commit -m "Scopes narrow where a variable may be used, and SPACING is ours"
```

---

## Task 4: the `modes` attribute on scene nodes

**Files:**
- Modify: `packages/schema/src/known-props.ts` (`STRUCTURAL_PROPS`)
- Modify: `packages/format/src/diagnostics.ts` (`UIDX129`)
- Modify: `packages/format/src/parse.ts` (new `checkNodeModes`)
- Test: `packages/format/test/tokens.test.ts`

**Interfaces:**
- Produces: `modes` legal on any scene element and on `<Page>`, shaped `{ [collectionName: string]: string }`. It is resolution context, not a scene property — the same category as `component`, `overrides` and `props`.

- [x] **Step 1: Write the failing tests**

```ts
describe('node mode selection (G8)', () => {
  const page = (attrs: string) =>
    `---\nid: p\n---\n\n## Visual Contract\n\n<Page>\n  <Frame name="f" ${attrs} />\n</Page>\n`

  it('accepts a collection-to-mode map', () => {
    expect(parse(page(`modes={{ semantic: 'dark' }}`)).diagnostics).toEqual([])
  })

  it('rejects a non-object', () => {
    expect(parse(page(`modes="dark"`)).diagnostics.map((d) => d.code)).toContain(
      CODES.BAD_NODE_MODES,
    )
  })

  it('rejects a non-string mode', () => {
    expect(parse(page(`modes={{ semantic: 3 }}`)).diagnostics.map((d) => d.code)).toContain(
      CODES.BAD_NODE_MODES,
    )
  })

  it('does not lint modes as an unknown prop', () => {
    const codes = parse(page(`modes={{ semantic: 'dark' }}`)).diagnostics.map((d) => d.code)
    expect(codes).not.toContain(CODES.UNKNOWN_PROP)
  })
})
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/format test -- tokens`
Expected: FAIL — `CODES.BAD_NODE_MODES` is `undefined`.

- [x] **Step 3: Add the code and the shape check**

```ts
  /** A node's `modes` that is not a `{ collection: mode }` map of strings. */
  BAD_NODE_MODES: 'UIDX129',
```

In `parse.ts`, add and call from the element path (beside `checkInstance`):

```ts
  /**
   * A node's explicit mode selection (story G8).
   *
   * Figma's `explicitVariableModes`: what this node itself sets, as opposed to
   * what it resolves to. Keeping the two apart is what lets the panel say
   * "Auto" without walking the tree to find out.
   */
  private checkNodeModes(attrs: Record<string, UidxAttr>): void {
    const modes = attrs.modes
    if (!modes) return
    const v = modes.value
    const ok =
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      Object.values(v).every((m) => typeof m === 'string' && m.length > 0)
    if (!ok) {
      this.error(
        CODES.BAD_NODE_MODES,
        'a "modes" attribute maps a collection name to a mode name, e.g. modes={{ semantic: ‘dark’ }}',
        modes.valueLoc,
      )
    }
  }
```

- [x] **Step 4: Exempt it from the unknown-prop lint**

In `packages/schema/src/known-props.ts`, extend `STRUCTURAL_PROPS` and its comment — `modes` belongs with the props that "reach the scene by deciding what gets built, not by being set on anything":

```ts
export const STRUCTURAL_PROPS: readonly string[] = ['component', 'overrides', 'props', 'modes']
```

The drift test `known-props.test.ts` asserts this list is `IDENTITY_PROPS` plus every `PROP_TABLE` entry — check whether it treats `STRUCTURAL_PROPS` separately and update it if it does not.

- [x] **Step 5: Run the tests to verify they pass**

Run: `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/format test && PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/schema test`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/format packages/schema
git commit -m "A node selects a mode, the way Figma's Appearance section does"
```

---

---

## Deviations found while building (tasks 1–4, 2026-08-25)

Tasks 1–4 are complete and committed. Three of the plan's instructions were
wrong, and each was caught by a test rather than by reading the plan again.

1. **`matchesType` was already taken.** `component-props.ts` exports one for
   component property types, with the arguments the other way round
   (`matchesType(type, value)`). The plan's Task 1 would have produced a
   duplicate export. The new helper is **`fitsVariableType(value, type)`**, and
   every reference above has been corrected to match the code.

2. **A null address did not stop the `<Mode>` collision.** `resolve()` walks by
   *name*, not by the address field, so `semantic#surface/light` still found the
   light column of `surface` — the exact ambiguity the empty address exists to
   prevent, living one function away from where the plan looked. `resolve` now
   skips `<Mode>` during the path walk (`parse.ts`, the `PATH_SEP` loop). The
   test `gives a <Mode> no address of its own` covers both halves.

3. **`checkNodeModes` ran on `<Collection>`.** A collection's `modes` is the
   array *declaring* them, not a node *selecting* one, so the node-shape check
   called a correct file wrong. It is now gated on `!TOKEN_ELEMENTS.has(element)`.

Two deliberate departures, neither a defect:

- **Tasks 3 and 4 share one commit.** They touch the same three files; separate
  commits would have been bookkeeping rather than reviewability.
- **An emit round-trip test was added** beyond the task's steps, from the spec's
  verification list. It failed first on its own brittle assertion, not on the
  code: the emitter breaks a multi-attribute tag across lines by existing house
  rule, and `<Mode>` children survive it.

Also worth recording, since it cost time to diagnose: the CLI's
`passes uidx check` test failed mid-task on a **pre-existing** duplicate
component name between `examples/checkbox.uidx` and an untracked
`examples/checkbox copy.uidx`. Unrelated to G8, and resolved outside this work
when the copy was renamed to `Control/CheckboxCopy`.

## Task 5: `buildTokenIndex`

**Files:**
- Create: `packages/schema/src/token-index.ts`
- Modify: `packages/schema/src/index.ts` (exports)
- Test: `packages/schema/test/token-index.test.ts`

**Interfaces:**
- Consumes: `UidxDocument`, `UidxNode`, `JsonValue`, `VariableType`, `VariableScope` from `@uidx/format`
- Produces:
  - `IMPLICIT_MODE = 'default'`
  - `interface TokenEntry { address, collection, name, type, scopes, description, valuesByMode }`
  - `interface CollectionInfo { name, modes }` — `modes[0]` is the default
  - `interface TokenIndex { entries: Map<string, TokenEntry>; collections: Map<string, CollectionInfo> }`
  - `buildTokenIndex(docs: readonly UidxDocument[]): TokenIndex`

- [x] **Step 1: Write the failing test**

Create `packages/schema/test/token-index.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { buildTokenIndex, IMPLICIT_MODE } from '../src/token-index.js'

const doc = (body: string) => parseOrThrow(`---\nid: t\n---\n\n## Visual Contract\n\n${body}\n`)

const FLAT = doc(`<Tokens>
  <Collection name="radius">
    <Variable name="md" type="FLOAT" value={8} scopes={['CORNER_RADIUS']} description="Cards." />
  </Collection>
</Tokens>`)

const MODED = doc(`<Tokens>
  <Collection name="semantic" modes={['light', 'dark']}>
    <Variable name="surface" type="COLOR">
      <Mode name="light" value={{ r: 1, g: 1, b: 1, a: 1 }} />
      <Mode name="dark" value={{ r: 0, g: 0, b: 0, a: 1 }} />
    </Variable>
  </Collection>
</Tokens>`)

describe('buildTokenIndex (G8)', () => {
  it('indexes a flat collection under an implicit mode', () => {
    const index = buildTokenIndex([FLAT])
    const entry = index.entries.get('radius#md')!
    expect(entry.type).toBe('FLOAT')
    expect(entry.scopes).toEqual(['CORNER_RADIUS'])
    expect(entry.description).toBe('Cards.')
    expect(entry.valuesByMode).toEqual({ [IMPLICIT_MODE]: 8 })
    expect(index.collections.get('radius')!.modes).toEqual([IMPLICIT_MODE])
  })

  it('defaults scopes to ALL_SCOPES and description to empty', () => {
    const bare = doc(`<Tokens>
  <Collection name="c"><Variable name="v" type="FLOAT" value={1} /></Collection>
</Tokens>`)
    const entry = buildTokenIndex([bare]).entries.get('c#v')!
    expect(entry.scopes).toEqual(['ALL_SCOPES'])
    expect(entry.description).toBe('')
  })

  it('indexes every mode of a moded collection, leftmost first', () => {
    const index = buildTokenIndex([MODED])
    expect(index.collections.get('semantic')!.modes).toEqual(['light', 'dark'])
    const entry = index.entries.get('semantic#surface')!
    expect(Object.keys(entry.valuesByMode)).toEqual(['light', 'dark'])
    expect(entry.valuesByMode.dark).toEqual({ r: 0, g: 0, b: 0, a: 1 })
  })

  it('spans documents, since names are global (ADR 0004 §2)', () => {
    const index = buildTokenIndex([FLAT, MODED])
    expect([...index.collections.keys()].sort()).toEqual(['radius', 'semantic'])
  })

  it('ignores documents that are not token files', () => {
    const page = doc(`<Page><Frame name="f" /></Page>`)
    expect(buildTokenIndex([page]).entries.size).toBe(0)
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/schema test -- token-index`
Expected: FAIL — cannot resolve `../src/token-index.js`.

- [x] **Step 3: Write the implementation**

Create `packages/schema/src/token-index.ts`:

```ts
import type { JsonValue, UidxDocument, VariableScope, VariableType } from '@uidx/format'

/**
 * The mode a collection that declares none still has.
 *
 * Figma has no unmoded collection — every one carries at least a default
 * column — so the index gives flat collections the same shape rather than
 * branching on "has modes" at every read site. A collection with no `modes`
 * cannot hold `<Mode>` children, so this name can never collide with an
 * authored one.
 */
export const IMPLICIT_MODE = 'default'

export interface TokenEntry {
  address: string
  collection: string
  name: string
  type: VariableType
  scopes: readonly VariableScope[]
  description: string
  /** Mode name → the authored value, which may still be an alias. */
  valuesByMode: Record<string, JsonValue>
}

export interface CollectionInfo {
  name: string
  /** Ordered. `modes[0]` is the default — leftmost wins, as in Figma. */
  modes: string[]
}

export interface TokenIndex {
  entries: Map<string, TokenEntry>
  collections: Map<string, CollectionInfo>
}

/**
 * Every token a document declares, as data — no alias resolution.
 *
 * Resolution is separated out because it depends on a mode tuple and this does
 * not: the index is built once per document load, while `TokenResolver.resolve`
 * runs once per distinct tuple encountered during a render.
 */
export function buildTokenIndex(docs: readonly UidxDocument[]): TokenIndex {
  const entries = new Map<string, TokenEntry>()
  const collections = new Map<string, CollectionInfo>()

  for (const doc of docs) {
    if (doc.tree.element !== 'Tokens') continue

    for (const collection of doc.tree.children) {
      const declared = collection.attrs.modes?.value
      const modes =
        Array.isArray(declared) && declared.length > 0
          ? (declared as string[])
          : [IMPLICIT_MODE]
      collections.set(collection.name, { name: collection.name, modes })

      for (const variable of collection.children) {
        const type = variable.attrs.type?.value
        if (typeof type !== 'string') continue

        const scopes = variable.attrs.scopes?.value
        const description = variable.attrs.description?.value

        const valuesByMode: Record<string, JsonValue> = {}
        if (modes[0] === IMPLICIT_MODE && variable.attrs.value !== undefined) {
          valuesByMode[IMPLICIT_MODE] = variable.attrs.value.value
        } else {
          for (const mode of variable.children) {
            if (mode.element !== 'Mode') continue
            const value = mode.attrs.value?.value
            if (value !== undefined) valuesByMode[mode.name] = value
          }
        }

        entries.set(variable.address, {
          address: variable.address,
          collection: collection.name,
          name: variable.name,
          type: type as VariableType,
          scopes: Array.isArray(scopes) ? (scopes as VariableScope[]) : ['ALL_SCOPES'],
          description: typeof description === 'string' ? description : '',
          valuesByMode,
        })
      }
    }
  }

  return { entries, collections }
}
```

Export `buildTokenIndex`, `IMPLICIT_MODE` and the three types from `packages/schema/src/index.ts`.

- [x] **Step 4: Run the test to verify it passes**

Run: `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/schema test -- token-index`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/schema
git commit -m "Tokens become an index: what the file declares, before anything resolves"
```

---

## Task 6: `TokenResolver` and the tuple cache

**Files:**
- Create: `packages/schema/src/resolve-modes.ts`
- Modify: `packages/schema/src/tokens.ts` (`resolveTokenValues` delegates)
- Modify: `packages/schema/src/index.ts` (exports)
- Test: `packages/schema/test/resolve-modes.test.ts`

**Interfaces:**
- Consumes: `TokenIndex`, `IMPLICIT_MODE` from Task 5; `aliasTarget` from `@uidx/format`
- Produces:
  - `type ModeTuple = ReadonlyMap<string, string>`
  - `defaultTuple(index: TokenIndex): ModeTuple`
  - `modeTupleKey(tuple: ModeTuple): string`
  - `mergeModes(tuple: ModeTuple, overrides: Record<string, string>, index: TokenIndex): ModeTuple`
  - `class TokenResolver { constructor(index: TokenIndex); resolve(tuple: ModeTuple): ReadonlyMap<string, JsonValue>; readonly misses: number }`

- [x] **Step 1: Write the failing test**

Create `packages/schema/test/resolve-modes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { buildTokenIndex } from '../src/token-index.js'
import { defaultTuple, mergeModes, modeTupleKey, TokenResolver } from '../src/resolve-modes.js'

const doc = (body: string) => parseOrThrow(`---\nid: t\n---\n\n## Visual Contract\n\n${body}\n`)

const WHITE = { r: 1, g: 1, b: 1, a: 1 }
const BLACK = { r: 0, g: 0, b: 0, a: 1 }

const DOCS = [
  doc(`<Tokens>
  <Collection name="palette" modes={['light', 'dark']}>
    <Variable name="bg" type="COLOR">
      <Mode name="light" value={{ r: 1, g: 1, b: 1, a: 1 }} />
      <Mode name="dark" value={{ r: 0, g: 0, b: 0, a: 1 }} />
    </Variable>
  </Collection>
  <Collection name="semantic">
    <Variable name="surface" type="COLOR" value="{palette#bg}" />
  </Collection>
</Tokens>`),
]

describe('TokenResolver (G8)', () => {
  const index = buildTokenIndex(DOCS)

  it('resolves the default tuple to the leftmost mode', () => {
    const map = new TokenResolver(index).resolve(defaultTuple(index))
    expect(map.get('palette#bg')).toEqual(WHITE)
  })

  it('follows an alias into whatever mode the target collection is in', () => {
    const resolver = new TokenResolver(index)
    const dark = mergeModes(defaultTuple(index), { palette: 'dark' }, index)
    // The alias lives in an unmoded collection, but resolves through to the
    // moded one — which is why resolution is per-tuple, not per-mode.
    expect(resolver.resolve(dark).get('semantic#surface')).toEqual(BLACK)
    expect(resolver.resolve(defaultTuple(index)).get('semantic#surface')).toEqual(WHITE)
  })

  it('keys a tuple stably regardless of insertion order', () => {
    const a = new Map([['x', '1'], ['y', '2']])
    const b = new Map([['y', '2'], ['x', '1']])
    expect(modeTupleKey(a)).toBe(modeTupleKey(b))
  })

  it('resolves once per distinct tuple, not once per call', () => {
    const resolver = new TokenResolver(index)
    const tuple = defaultTuple(index)
    resolver.resolve(tuple)
    resolver.resolve(tuple)
    resolver.resolve(tuple)
    expect(resolver.misses).toBe(1)
  })

  it('ignores an unknown collection or mode in an override', () => {
    const tuple = mergeModes(defaultTuple(index), { nope: 'x', palette: 'dusk' }, index)
    expect(tuple.get('nope')).toBeUndefined()
    expect(tuple.get('palette')).toBe('light')
  })

  it('leaves a cycle unresolved rather than hanging', () => {
    const cyclic = buildTokenIndex([
      doc(`<Tokens>
  <Collection name="c">
    <Variable name="a" type="FLOAT" value="{c#b}" />
    <Variable name="b" type="FLOAT" value="{c#a}" />
  </Collection>
</Tokens>`),
    ])
    const map = new TokenResolver(cyclic).resolve(defaultTuple(cyclic))
    expect(map.has('c#a')).toBe(false)
  })

  it('falls back to the default mode for a variable missing one', () => {
    const partial = buildTokenIndex([
      doc(`<Tokens>
  <Collection name="c" modes={['light', 'dark']}>
    <Variable name="v" type="FLOAT"><Mode name="light" value={8} /></Variable>
  </Collection>
</Tokens>`),
    ])
    const dark = mergeModes(defaultTuple(partial), { c: 'dark' }, partial)
    expect(new TokenResolver(partial).resolve(dark).get('c#v')).toBe(8)
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/schema test -- resolve-modes`
Expected: FAIL — cannot resolve `../src/resolve-modes.js`.

- [x] **Step 3: Write the implementation**

Create `packages/schema/src/resolve-modes.ts`:

```ts
import { aliasTarget, type JsonValue } from '@uidx/format'
import type { TokenIndex } from './token-index.js'

/** Which mode is in effect for each collection. Figma's `resolvedVariableModes`. */
export type ModeTuple = ReadonlyMap<string, string>

/** Every collection at its leftmost mode. */
export function defaultTuple(index: TokenIndex): ModeTuple {
  const out = new Map<string, string>()
  for (const [name, info] of index.collections) out.set(name, info.modes[0]!)
  return out
}

/**
 * A stable cache key.
 *
 * Sorted, because two tuples with the same pairs in a different insertion order
 * are the same tuple. Keying on object identity instead is the way to make this
 * design the slow one it was chosen over — every render would miss.
 */
export function modeTupleKey(tuple: ModeTuple): string {
  return [...tuple]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([c, m]) => `${c}:${m}`)
    .join('|')
}

/**
 * A node's explicit selection layered over what it inherited.
 *
 * An override naming a collection or mode that does not exist is dropped rather
 * than honoured: the file is diagnosed elsewhere, and the renderer's job is to
 * draw what it can.
 */
export function mergeModes(
  tuple: ModeTuple,
  overrides: Record<string, string>,
  index: TokenIndex,
): ModeTuple {
  let next: Map<string, string> | null = null
  for (const [collection, mode] of Object.entries(overrides)) {
    const info = index.collections.get(collection)
    if (!info || !info.modes.includes(mode)) continue
    if (tuple.get(collection) === mode) continue
    next ??= new Map(tuple)
    next.set(collection, mode)
  }
  return next ?? tuple
}

/**
 * Flattens alias chains under one mode tuple, memoised.
 *
 * One instance per document load; the cache is dropped by discarding the
 * resolver, which is what G6's rebuild-wholesale behaviour already does on any
 * token change.
 */
export class TokenResolver {
  #cache = new Map<string, ReadonlyMap<string, JsonValue>>()
  #misses = 0

  constructor(private readonly index: TokenIndex) {}

  /** Cache misses so far. A test hook: the property A′ exists to guarantee. */
  get misses(): number {
    return this.#misses
  }

  resolve(tuple: ModeTuple): ReadonlyMap<string, JsonValue> {
    const key = modeTupleKey(tuple)
    const hit = this.#cache.get(key)
    if (hit) return hit
    this.#misses++
    const built = this.#build(tuple)
    this.#cache.set(key, built)
    return built
  }

  /** The authored value of one address under this tuple, before alias-following. */
  #authored(address: string, tuple: ModeTuple): JsonValue | undefined {
    const entry = this.index.entries.get(address)
    if (!entry) return undefined
    const info = this.index.collections.get(entry.collection)
    const mode = tuple.get(entry.collection) ?? info?.modes[0]
    // A variable missing one of its collection's modes is a diagnostic, and
    // resolves to the default-mode value so an incomplete file still draws.
    return (
      (mode !== undefined ? entry.valuesByMode[mode] : undefined) ??
      (info ? entry.valuesByMode[info.modes[0]!] : undefined)
    )
  }

  #build(tuple: ModeTuple): ReadonlyMap<string, JsonValue> {
    const resolved = new Map<string, JsonValue>()
    for (const address of this.index.entries.keys()) {
      const seen = new Set<string>([address])
      let current = this.#authored(address, tuple)

      for (;;) {
        const target = current === undefined ? null : aliasTarget(current)
        if (target === null) break
        if (seen.has(target)) {
          current = undefined // a cycle: leave it unresolved
          break
        }
        seen.add(target)
        current = this.#authored(target, tuple)
      }

      if (current !== undefined) resolved.set(address, current)
    }
    return resolved
  }
}
```

- [x] **Step 4: Keep `resolveTokenValues` working**

In `packages/schema/src/tokens.ts`, reimplement `resolveTokenValues` over the new modules so existing callers keep working while Task 8 migrates them:

```ts
/**
 * Every token flattened at the default mode of every collection.
 *
 * Retained for callers that have no node context — `uidx check` and the
 * viewer's address list. Anything rendering a node wants `TokenResolver`, since
 * only a tuple can say which mode that node is in.
 */
export function resolveTokenValues(docs: readonly UidxDocument[]): Map<string, JsonValue> {
  const index = buildTokenIndex(docs)
  return new Map(new TokenResolver(index).resolve(defaultTuple(index)))
}
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/schema test`
Expected: PASS, including the pre-existing `tokens` tests.

- [x] **Step 6: Commit**

```bash
git add packages/schema
git commit -m "Resolution takes a mode tuple, and runs once per distinct one"
```

---

## Task 7: alias diagnostics across modes

**Files:**
- Modify: `packages/server/src/symbols.ts:342` (reference collection), and the unresolved/cycle reporter around `:400`
- Modify: `packages/format/src/diagnostics.ts` (`UIDX130`)
- Test: `packages/server/test/instance-symbols.test.ts` (or a new `token-modes.test.ts` beside it)

**Interfaces:**
- Consumes: `buildTokenIndex` from Task 5
- Produces: `ALIAS_TYPE_MISMATCH: 'UIDX130'`; reference collection that descends into `<Mode>` children

- [x] **Step 1: Write the failing test**

```ts
describe('token aliases across modes (G8)', () => {
  it('reports an alias inside a <Mode> that points at nothing', () => {
    const codes = checkCodes(`<Tokens>
  <Collection name="c" modes={['light']}>
    <Variable name="v" type="COLOR"><Mode name="light" value="{nope#missing}" /></Variable>
  </Collection>
</Tokens>`)
    expect(codes).toContain(CODES.UNRESOLVED_REFERENCE)
  })

  it('reports an alias whose target has a different type', () => {
    const codes = checkCodes(`<Tokens>
  <Collection name="p"><Variable name="n" type="FLOAT" value={8} /></Collection>
  <Collection name="s"><Variable name="c" type="COLOR" value="{p#n}" /></Collection>
</Tokens>`)
    expect(codes).toContain(CODES.ALIAS_TYPE_MISMATCH)
  })

  it('accepts an alias whose target matches', () => {
    const codes = checkCodes(`<Tokens>
  <Collection name="p"><Variable name="n" type="FLOAT" value={8} /></Collection>
  <Collection name="s"><Variable name="m" type="FLOAT" value="{p#n}" /></Collection>
</Tokens>`)
    expect(codes).not.toContain(CODES.ALIAS_TYPE_MISMATCH)
  })
})
```

Use whichever helper the existing tests in that file use to run a document through `buildSymbolTable`; name it `checkCodes` here and adapt to the file's own harness.

- [x] **Step 2: Run the test to verify it fails**

Run: `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/server test`
Expected: FAIL — the `<Mode>` alias is never collected, and `ALIAS_TYPE_MISMATCH` is `undefined`.

- [x] **Step 3: Add the code**

```ts
  /** An alias whose target resolves to a different variable type. */
  ALIAS_TYPE_MISMATCH: 'UIDX130',
```

- [x] **Step 4: Collect references from `<Mode>` children**

`collectReferences` (symbols.ts:~332) walks each node's attributes looking for `aliasTarget(attr.value)`. A `<Mode>` is an ordinary `UidxNode` child of a `<Variable>`, so if the walk already recurses through `node.children` it needs no change — **verify this first**. If it stops at `<Variable>` because token trees were leaf-shaped before G8, extend the recursion to include `Mode` children.

- [x] **Step 5: Add the type check**

Where unresolved references are reported (symbols.ts:~400), add a second pass over the index. Type is mode-independent — a variable has one type across every mode — so this needs no tuple:

```ts
  // Existence and type are facts about a variable, not about a mode, so both
  // are checkable without enumerating tuples. Only *values* are tuple-dependent.
  const index = buildTokenIndex(docs)
  for (const entry of index.entries.values()) {
    for (const value of Object.values(entry.valuesByMode)) {
      const target = aliasTarget(value)
      if (target === null) continue
      const referenced = index.entries.get(target)
      if (!referenced) continue // already reported as an unresolved reference
      if (referenced.type !== entry.type) {
        diagnostics.push({
          code: CODES.ALIAS_TYPE_MISMATCH,
          severity: 'error',
          message: `"${entry.address}" is ${entry.type} but "${target}" is ${referenced.type}`,
          // Reuse the location the existing reference collector records for this alias.
        })
      }
    }
  }
```

Match the surrounding code's diagnostic construction — `severity`, `loc` and `file` fields as the neighbouring pushes build them.

- [x] **Step 6: Run the tests to verify they pass**

Run: `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/server test`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add packages/format packages/server
git commit -m "Alias diagnostics reach into modes, and an alias must match its target's type"
```

---

## Task 8: thread the mode tuple through the render descent

**Files:**
- Modify: `packages/schema/src/to-scene.ts:123` (`AliasResolver` neighbours), `:147` (options), `:196` and `:517` (the scope swap)
- Modify: `packages/viewer/src/App.vue:58` (build a `TokenResolver`)
- Modify: `packages/viewer/src/CanvasPane.vue:80` (pass it through)
- Test: `packages/schema/test/resolve-modes.test.ts` (descent cases)

**Interfaces:**
- Consumes: `TokenResolver`, `ModeTuple`, `defaultTuple`, `mergeModes` from Task 6
- Produces: `ToSceneOptions.tokens?: { resolver: TokenResolver; index: TokenIndex }`. When present, `#`-bearing addresses resolve through the tuple maintained by the descent; when absent, the existing flat `resolveAlias` is used unchanged, so every current caller keeps working.

- [x] **Step 1: Write the failing test**

```ts
describe('mode inheritance down the tree (G8)', () => {
  it('resolves a child under its ancestor’s mode, and stops at a re-override', () => {
    const index = buildTokenIndex(DOCS)
    const resolver = new TokenResolver(index)
    const page = parseOrThrow(`---\nid: p\n---\n\n## Visual Contract\n\n<Page>
  <Frame name="outer" modes={{ palette: 'dark' }}>
    <Frame name="inherits" fills={[{ type: 'SOLID', color: '{palette#bg}' }]} />
    <Frame name="overrides" modes={{ palette: 'light' }}
           fills={[{ type: 'SOLID', color: '{palette#bg}' }]} />
  </Frame>
</Page>\n`)

    const scene = toSceneGraph(page, { tokens: { resolver, index } })
    expect(colorOf(scene, 'inherits')).toEqual(BLACK)
    expect(colorOf(scene, 'overrides')).toEqual(WHITE)
  })

  it('resolves once per distinct tuple across a whole page', () => {
    const index = buildTokenIndex(DOCS)
    const resolver = new TokenResolver(index)
    toSceneGraph(manyNodesUnderOneMode(), { tokens: { resolver, index } })
    expect(resolver.misses).toBe(1)
  })
})
```

Write `colorOf(scene, name)` as a small helper that finds the node by name in the built graph and reads its first fill's colour, following whatever accessor the existing `to-scene` tests use. Write `manyNodesUnderOneMode()` to emit a `<Page>` with 200 sibling frames, each binding `{palette#bg}`, under one `modes` frame.

- [x] **Step 2: Run the test to verify it fails**

Run: `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/schema test -- resolve-modes`
Expected: FAIL — `tokens` is not an option `toSceneGraph` accepts.

- [x] **Step 3: Add the option and the wrapper**

In `to-scene.ts`, beside `withProperties` (line 357) — it is the same shape, and deliberately so:

```ts
/**
 * A resolver bound to one mode tuple (story G8).
 *
 * The mirror of `withProperties`: that one intercepts bare names and delegates
 * addresses; this one intercepts addresses and delegates bare names. Composed,
 * a component's subtree keeps its declared defaults while its tokens resolve in
 * whatever mode the enclosing frame selected.
 */
function withModes(
  base: AliasResolver | undefined,
  values: ReadonlyMap<string, JsonValue>,
): AliasResolver {
  return (address) => (address.includes('#') ? values.get(address) : base?.(address))
}
```

Add to the options interface at `:147`:

```ts
  /**
   * Mode-aware token resolution. When given, the descent maintains a mode tuple
   * and `#` addresses resolve through it; `resolveAlias` still serves callers
   * that have no index — `uidx check` among them.
   */
  tokens?: { resolver: TokenResolver; index: TokenIndex }
```

- [x] **Step 4: Maintain the tuple during the descent**

The descent already rebuilds `scope` when a component introduces declared defaults (`:196`, `:517`). Add the same move for modes: where a node's own scope is derived, check for a `modes` attribute and swap the resolver.

```ts
    // Figma's explicitVariableModes over resolvedVariableModes: the attribute
    // is what this node sets, the tuple is what it ends up with. Merging on the
    // way down is what makes this O(1) per node — nothing ever walks up.
    let scope = parentScope
    const declared = node.attrs.modes?.value
    if (options.tokens && declared && typeof declared === 'object' && !Array.isArray(declared)) {
      const tuple = mergeModes(
        scope.modeTuple,
        declared as Record<string, string>,
        options.tokens.index,
      )
      if (tuple !== scope.modeTuple) {
        scope = {
          ...scope,
          modeTuple: tuple,
          resolveAlias: withModes(scope.resolveAlias, options.tokens.resolver.resolve(tuple)),
        }
      }
    }
```

Add `modeTuple: ModeTuple` to the scope type, seeded at the root with `defaultTuple(options.tokens.index)` and the root resolver set to `withModes(options.resolveAlias, resolver.resolve(defaultTuple(index)))`. When `options.tokens` is absent, leave both untouched.

- [x] **Step 5: Run the tests to verify they pass**

Run: `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/schema test`
Expected: PASS.

- [x] **Step 6: Wire the viewer**

In `packages/viewer/src/App.vue:58`, build the index and resolver alongside the flat map that other panels still use:

```ts
const tokenIndex = computed(() => buildTokenIndex([...pages.value.values()]))
const tokenResolver = computed(() => new TokenResolver(tokenIndex.value))
const tokens = computed(() =>
  new Map(tokenResolver.value.resolve(defaultTuple(tokenIndex.value))),
)
```

A new resolver per index change is the invalidation: G6 already rebuilds wholesale on a token change, so discarding the resolver discards the cache.

Pass `:token-index="tokenIndex"` and `:token-resolver="tokenResolver"` to `CanvasPane` beside the existing `:tokens`, declare them in its `defineProps`, and hand them to `toSceneGraph` / `applyChanges` as `tokens: { resolver, index }`.

`CanvasPane.vue:1186`'s `tokenSignature` compares the flat map by value to decide on a rebuild. Leave it: the flat map is still derived from the same documents, so it still changes exactly when tokens change.

- [x] **Step 7: Verify live**

Run the viewer, open a page, add `modes={{ palette: 'dark' }}` to a frame in the file, save, and confirm the subtree repaints while its siblings do not. **Check the terminal for a Vite reload 500 before trusting what you see** — a stale page will happily show the old colours.

- [x] **Step 8: Commit**

```bash
git add packages/schema packages/viewer
git commit -m "The mode tuple rides down the descent; nothing ever walks up"
```

### Tasks 9–13 (2026-08-26)

1. **`SCOPE_FOR_PROP` belongs in `@uidx/format`, not `@uidx/schema`.** The
   scope-violation warning has to live in the server so the editor shows it,
   and the server does not depend on schema on purpose. Property names and
   `VariableScope` are both format's own, so the table moved there and no
   dependency edge was needed at all — a simpler answer than the
   `@uidx/schema/known-props` subpath precedent would have given.

2. **The scope code is `UIDX409`,** in the workspace range beside
   `ALIAS_TYPE_MISMATCH`, not the plan's `UIDX131` in the format range.

3. **Detach already wrote the literal.** The rule existed inline in
   `PropertiesPane.onDetach`, unnamed and untested. Task 13 did not add the
   behaviour so much as name it, test it, and — through `panelTokens` — make it
   resolve in the selected node's own mode rather than the default one.

4. **`tupleAt` was needed and unplanned.** The canvas learns a node's tuple by
   carrying it down the descent; the inspector is handed an address and has to
   reconstruct it. Without that the picker previewed light values for a node
   painting dark, and detach would have written the wrong literal.

5. **`vue-tsc` does not flag an unresolved component in a template.** A missing
   `import ModeRow` typechecked clean and would only have failed at runtime.
   Worth knowing: typecheck is not a guard for template wiring.

6. **A pre-existing flaky test.** `session.test.ts > broadcasts file:changed …`
   failed once under load with a dev server running, and passed 3/3 in
   isolation and in every subsequent full run. Timing-sensitive file watching,
   unrelated to G8.

**Verified live**, through the built binary and the running editor:
mode inheritance and override on canvas; **Apply variable mode** reading `Auto`
on an unset node and `dark` on a set one; changing it writing
`modes={{ theme: 'light' }}` to disk and repainting the subtree; the corner
radius picker offering only the `CORNER_RADIUS` token while `cornerSmoothing`
(no scope entry) offers every FLOAT; and `uidx check` reporting an
out-of-scope binding as `UIDX409 warning`, not an error.

---

## Task 9: `SCOPE_FOR_PROP` and the scope-filtered picker

**Files:**
- Create: `packages/schema/src/scope-for-prop.ts`
- Modify: `packages/schema/src/index.ts` (exports)
- Modify: `packages/viewer/src/variable-binding.ts` (`variableCandidates`)
- Modify: `packages/viewer/src/PropertiesPane.vue:228`, `:294`, `packages/viewer/src/PaintStackField.vue:52`
- Test: `packages/schema/test/scope-for-prop.test.ts`, `packages/viewer/test/variable-binding.test.ts`

**Interfaces:**
- Consumes: `VariableScope` from `@uidx/format`, `TokenIndex` from Task 5
- Produces:
  - `SCOPE_FOR_PROP: Readonly<Record<string, readonly VariableScope[]>>`
  - `scopesForProp(prop: string): readonly VariableScope[] | null` — `null` when the prop has no entry
  - `variableCandidates(tokens, index, type, prop)` — `prop` may be `null` to skip scope filtering

- [x] **Step 1: Write the failing tests**

`packages/schema/test/scope-for-prop.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { scopesForProp } from '../src/scope-for-prop.js'

describe('SCOPE_FOR_PROP (G8)', () => {
  it('maps corner radius to CORNER_RADIUS', () => {
    expect(scopesForProp('cornerRadius')).toContain('CORNER_RADIUS')
  })

  it('separates padding from gap, which Figma does not', () => {
    expect(scopesForProp('paddingLeft')).toContain('SPACING')
    expect(scopesForProp('itemSpacing')).toContain('GAP')
    expect(scopesForProp('paddingLeft')).not.toContain('GAP')
  })

  it('returns null for a prop with no entry, so it is under-filtered not unbindable', () => {
    expect(scopesForProp('somethingNew')).toBeNull()
  })
})
```

`packages/viewer/test/variable-binding.test.ts` (create if absent):

```ts
describe('scope-filtered candidates (G8)', () => {
  it('hides a variable scoped away from this property', () => {
    // radius#md is CORNER_RADIUS; space#sm is SPACING.
    const names = variableCandidates(tokens, index, 'FLOAT', 'cornerRadius').map((c) => c.address)
    expect(names).toEqual(['radius#md'])
  })

  it('shows an ALL_SCOPES variable everywhere', () => {
    const names = variableCandidates(tokens, index, 'FLOAT', 'itemSpacing').map((c) => c.address)
    expect(names).toContain('any#loose')
  })

  it('falls back to type-only filtering when the prop has no scope entry', () => {
    const names = variableCandidates(tokens, index, 'FLOAT', 'somethingNew').map((c) => c.address)
    expect(names).toHaveLength(3)
  })
})
```

Build `tokens` and `index` in the test from a small `<Tokens>` document with three FLOAT variables: `radius#md` scoped `['CORNER_RADIUS']`, `space#sm` scoped `['SPACING']`, and `any#loose` with no `scopes` attribute.

- [x] **Step 2: Run the tests to verify they fail**

Run: `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/schema test -- scope-for-prop`
Expected: FAIL — cannot resolve `../src/scope-for-prop.js`.

- [x] **Step 3: Write the map**

Create `packages/schema/src/scope-for-prop.ts`. Values are transcribed from
`docs/research/figma-binding-matrix.json`, whose rows carry the Figma scope for
each bindable property — read them from the file rather than from memory.

```ts
import type { VariableScope } from '@uidx/format'

/**
 * Which scopes gate each bindable property (story G8).
 *
 * Seeded from `docs/research/figma-binding-matrix.json`. Two deliberate
 * departures from Figma, both recorded in the spec's divergence table:
 * padding gets `SPACING` rather than sharing `GAP`, and that is the only
 * addition — every other value is Figma's own.
 */
export const SCOPE_FOR_PROP: Readonly<Record<string, readonly VariableScope[]>> = {
  cornerRadius: ['CORNER_RADIUS'],
  topLeftRadius: ['CORNER_RADIUS'],
  topRightRadius: ['CORNER_RADIUS'],
  bottomLeftRadius: ['CORNER_RADIUS'],
  bottomRightRadius: ['CORNER_RADIUS'],
  width: ['WIDTH_HEIGHT'],
  height: ['WIDTH_HEIGHT'],
  minWidth: ['WIDTH_HEIGHT'],
  maxWidth: ['WIDTH_HEIGHT'],
  minHeight: ['WIDTH_HEIGHT'],
  maxHeight: ['WIDTH_HEIGHT'],
  paddingTop: ['SPACING'],
  paddingRight: ['SPACING'],
  paddingBottom: ['SPACING'],
  paddingLeft: ['SPACING'],
  itemSpacing: ['GAP'],
  counterAxisSpacing: ['GAP'],
  strokeWeight: ['STROKE_FLOAT'],
  strokeTopWeight: ['STROKE_FLOAT'],
  strokeRightWeight: ['STROKE_FLOAT'],
  strokeBottomWeight: ['STROKE_FLOAT'],
  strokeLeftWeight: ['STROKE_FLOAT'],
  opacity: ['OPACITY'],
  characters: ['TEXT_CONTENT'],
  fontFamily: ['FONT_FAMILY'],
  fontStyle: ['FONT_STYLE'],
  fontWeight: ['FONT_WEIGHT'],
  fontSize: ['FONT_SIZE'],
  lineHeight: ['LINE_HEIGHT'],
  letterSpacing: ['LETTER_SPACING'],
  paragraphSpacing: ['PARAGRAPH_SPACING'],
  paragraphIndent: ['PARAGRAPH_INDENT'],
  fills: ['ALL_FILLS', 'FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL'],
  strokes: ['STROKE_COLOR'],
}

/** The scopes gating a property, or null when it has no entry. */
export function scopesForProp(prop: string): readonly VariableScope[] | null {
  return SCOPE_FOR_PROP[prop] ?? null
}
```

- [x] **Step 4: Filter the candidates**

In `packages/viewer/src/variable-binding.ts`, replace `variableCandidates`:

```ts
/**
 * Variables the popup may offer for one field (spec §3, scoped in G8).
 *
 * Two filters, in Figma's order: the one type this input takes, then the
 * property's scope. Scope is a picker filter and nothing more — a file that
 * binds outside it is warned about, never rejected, because Figma's API binds
 * regardless and an imported file would otherwise fail to open.
 */
export function variableCandidates(
  tokens: ReadonlyMap<string, JsonValue> | undefined,
  index: TokenIndex | undefined,
  type: VariableType | null,
  prop: string | null,
): VariableCandidate[] {
  if (!tokens || !type) return []
  const wanted = prop === null ? null : scopesForProp(prop)
  const out: VariableCandidate[] = []
  for (const [address, value] of tokens) {
    if (variableTypeOf(value) !== type) continue
    if (wanted) {
      const scopes = index?.entries.get(address)?.scopes ?? ['ALL_SCOPES']
      const shown = scopes.includes('ALL_SCOPES') || scopes.some((s) => wanted.includes(s))
      if (!shown) continue
    }
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
```

- [x] **Step 5: Update the three call sites**

- `PropertiesPane.vue:228` → `variableCandidates(props.tokens, props.tokenIndex, variableTypeForControl(field.control), field.prop)` — use whatever the field object calls its property key.
- `PropertiesPane.vue:294` → pass `prop` through as the fourth argument (it is already in scope there).
- `PaintStackField.vue:52` → `variableCandidates(props.tokens, props.tokenIndex, 'COLOR', props.prop)`, where `prop` is `'fills'` or `'strokes'`.

Add a `tokenIndex?: TokenIndex` prop to both components and thread it from `App.vue`.

- [x] **Step 6: Run the tests to verify they pass**

Run: `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm test`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add packages/schema packages/viewer
git commit -m "The picker filters by scope: a radius scale stops offering itself for gaps"
```

---

## Task 10: the **Apply variable mode** control

**Files:**
- Modify: `packages/viewer/src/variable-binding.ts` (`setNodeMode`, `clearNodeMode`)
- Create: `packages/viewer/src/ModeRow.vue`
- Modify: `packages/viewer/src/PropertiesPane.vue` (mount it in Appearance)
- Test: `packages/viewer/test/variable-binding.test.ts`

**Interfaces:**
- Consumes: `TokenIndex` (for the collection and mode lists), `UidxDocument`, `UidxPatch`
- Produces:
  - `setNodeMode(doc, address, collection, mode): UidxPatch[] | null`
  - `clearNodeMode(doc, address, collection): UidxPatch[] | null` — removes the attribute entirely when the last entry goes

- [x] **Step 1: Write the failing tests**

```ts
describe('mode patches (G8)', () => {
  it('adds a modes attribute when the node has none', () => {
    expect(setNodeMode(doc, 'p#f', 'semantic', 'dark')).toEqual([
      { op: 'add', address: 'p#f', prop: 'modes', value: { semantic: 'dark' } },
    ])
  })

  it('merges into an existing modes attribute', () => {
    // node already carries modes={{ density: 'compact' }}
    expect(setNodeMode(doc2, 'p#f', 'semantic', 'dark')).toEqual([
      { op: 'set', address: 'p#f', prop: 'modes', value: { density: 'compact', semantic: 'dark' } },
    ])
  })

  it('removes only the named collection', () => {
    expect(clearNodeMode(doc3, 'p#f', 'semantic')).toEqual([
      { op: 'set', address: 'p#f', prop: 'modes', value: { density: 'compact' } },
    ])
  })

  it('removes the attribute when the last entry goes', () => {
    expect(clearNodeMode(doc4, 'p#f', 'semantic')).toEqual([
      { op: 'remove', address: 'p#f', prop: 'modes' },
    ])
  })

  it('returns null for an unknown address', () => {
    expect(setNodeMode(doc, 'p#nope', 'semantic', 'dark')).toBeNull()
  })
})
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/viewer test -- variable-binding`
Expected: FAIL — `setNodeMode` is not exported.

- [x] **Step 3: Write the patch builders**

Append to `packages/viewer/src/variable-binding.ts`. Structural like `bindVariable`, and for the same reason recorded there.

```ts
/** The node's own `modes` map, or an empty one. */
function modesOf(node: UidxNode): Record<string, string> {
  const value = node.attrs.modes?.value
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, string>) }
    : {}
}

/** Select a mode for one collection on one node. Figma's explicitVariableModes. */
export function setNodeMode(
  doc: UidxDocument,
  address: string,
  collection: string,
  mode: string,
): UidxPatch[] | null {
  const node = resolve(doc.tree, address)
  if (!node) return null
  const next = modesOf(node)
  const op = node.attrs.modes === undefined ? 'add' : 'set'
  next[collection] = mode
  return [{ op, address, prop: 'modes', value: next }]
}

/** Return one collection to Auto — inheriting whatever an ancestor selected. */
export function clearNodeMode(
  doc: UidxDocument,
  address: string,
  collection: string,
): UidxPatch[] | null {
  const node = resolve(doc.tree, address)
  if (!node || node.attrs.modes === undefined) return null
  const next = modesOf(node)
  delete next[collection]
  return Object.keys(next).length === 0
    ? [{ op: 'remove', address, prop: 'modes' }]
    : [{ op: 'set', address, prop: 'modes', value: next }]
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/viewer test -- variable-binding`
Expected: PASS.

- [x] **Step 5: Build the control**

Create `packages/viewer/src/ModeRow.vue` — one row per collection that declares modes, in the **Appearance** section, using Figma's own label **Apply variable mode**.

Follow the UI3 rules the panel already obeys, from `docs/panel-ui3-and-variables.md`: a caption line in `--text-dim` at `--ui-size` with a ~4px below-gap, then the control; inputs at `--field-h` (28px) on `--raised` with `--radius-lg`. The control is a select whose options are the collection's modes plus a leading `Auto`.

- `Auto` is the value when the node's `modes` has no entry for this collection. It is the default and must read as inherited, not as a mode named "Auto".
- Choosing a mode emits `setNodeMode`; choosing `Auto` emits `clearNodeMode`.
- The row renders only when at least one collection declares modes; a document with no moded collection shows nothing rather than an empty section.

- [x] **Step 6: Mount it**

In `PropertiesPane.vue`, render `ModeRow` in the Appearance section, passing the `TokenIndex` and the selected node's address, and forward its patch emission to the same handler `bindVariable`'s callers use.

- [x] **Step 7: Verify live**

Run the viewer. Select a nested frame, set a mode, confirm the file gains `modes={{ … }}` and the subtree repaints. Set it back to `Auto`, confirm the attribute disappears and the subtree returns to its parent's mode. Check the terminal for a Vite reload 500 first.

- [x] **Step 8: Commit**

```bash
git add packages/viewer
git commit -m "Apply variable mode: Auto until a node says otherwise"
```

---

## Task 11: `uidx migrate tokens`

**Files:**
- Create: `packages/cli/src/commands/migrate-tokens.ts`
- Modify: the CLI's command registration (follow how `check` and `fmt` are registered)
- Test: `packages/cli/test/migrate-tokens.test.ts`

**Interfaces:**
- Consumes: `parse`, `variableTypeOf`, `isAlias` from `@uidx/format`
- Produces: `migrateTokens(source: string): { source: string; changed: number }` — a pure string-to-string transform, so it is testable without touching disk

- [x] **Step 1: Write the failing test**

```ts
describe('uidx migrate tokens (G8)', () => {
  it('adds a type derived from the value', () => {
    const { source, changed } = migrateTokens(
      `<Variable name="md" value={8} />\n<Variable name="w" value={{ r: 1, g: 1, b: 1, a: 1 }} />`,
    )
    expect(source).toContain('<Variable name="md" type="FLOAT" value={8} />')
    expect(source).toContain('type="COLOR"')
    expect(changed).toBe(2)
  })

  it('leaves a variable that already declares a type', () => {
    const src = `<Variable name="md" type="FLOAT" value={8} />`
    expect(migrateTokens(src)).toEqual({ source: src, changed: 0 })
  })

  it('leaves an alias alone — its type is its target’s, which this cannot see', () => {
    const src = `<Variable name="brand" value="{palette#blue}" />`
    expect(migrateTokens(src).changed).toBe(0)
  })
})
```

The alias case is the one that cannot be automated: an alias has no type of its
own, and the codemod works one file at a time while the target may live in
another document. Those are reported for the author to type by hand.

- [x] **Step 2: Run the test to verify it fails**

Run: `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/cli test -- migrate-tokens`
Expected: FAIL — module not found.

- [x] **Step 3: Write the transform**

Insert `type="…"` immediately after the `name="…"` attribute, so the migrated
file reads in the order the examples use. Derive the type with `variableTypeOf`;
skip when the value is an alias or a `type` is already present. Report the
skipped aliases on stdout with their file and address so the author knows
exactly what is left to do — `uidx check` will error on them until they are typed.

- [x] **Step 4: Run the test to verify it passes**

Run: `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/cli test -- migrate-tokens`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "uidx migrate tokens writes the type every variable now declares"
```

---

## Task 12: the performance guarantee

**Files:**
- Test: `packages/schema/test/resolve-modes.test.ts` (append)

**Interfaces:**
- Consumes: `TokenResolver.misses` from Task 6, `toSceneGraph` from Task 8

- [x] **Step 1: Write the test**

The property A′ exists to guarantee is that resolution runs **once per distinct
tuple**, not once per node. Assert the miss counter, not the clock: wall-clock in
CI is flaky, and a miss count tests the thing that actually matters.

```ts
describe('resolution cost (G8)', () => {
  const page = (n: number, modedIndex: number) => {
    const frames = Array.from({ length: n }, (_, i) =>
      i === modedIndex
        ? `<Frame name="f${i}" modes={{ palette: 'dark' }} fills={[{ type: 'SOLID', color: '{palette#bg}' }]} />`
        : `<Frame name="f${i}" fills={[{ type: 'SOLID', color: '{palette#bg}' }]} />`,
    ).join('\n    ')
    return parseOrThrow(`---\nid: p\n---\n\n## Visual Contract\n\n<Page>\n    ${frames}\n</Page>\n`)
  }

  it('resolves once per distinct tuple over a 1,000-node page', () => {
    const index = buildTokenIndex(DOCS)
    const resolver = new TokenResolver(index)
    toSceneGraph(page(1000, 500), { tokens: { resolver, index } })
    // The default tuple and the one dark frame's tuple. Not 1,000.
    expect(resolver.misses).toBe(2)
  })

  it('stays well inside a smoke-test ceiling', () => {
    const index = buildTokenIndex(DOCS)
    const resolver = new TokenResolver(index)
    const started = performance.now()
    toSceneGraph(page(1000, 500), { tokens: { resolver, index } })
    expect(performance.now() - started).toBeLessThan(2000)
  })
})
```

- [x] **Step 2: Run it**

Run: `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/schema test -- resolve-modes`
Expected: PASS. **A miss count near 1,000 means the cache key is wrong** — check `modeTupleKey` is being used and that `mergeModes` returns the *same* tuple object when nothing changed.

- [x] **Step 3: Run the whole suite and the typechecker**

```bash
PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm test
PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm typecheck
PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm lint
```

- [x] **Step 4: Commit**

```bash
git add packages/schema
git commit -m "Resolution runs once per mode tuple, and a test holds it there"
```

---

---

## Task 13: detach, the scope warning, and mode-aware previews

Three spec requirements with no task of their own, found in the plan's own
coverage check. Each is small; together they are the difference between the
panel obeying the spec and merely resembling it.

**Files:**
- Modify: `packages/viewer/src/variable-binding.ts` (`detachVariable`)
- Modify: `packages/server/src/symbols.ts` (scope-violation warning)
- Modify: `packages/format/src/diagnostics.ts` (`UIDX131`)
- Modify: `packages/viewer/src/PropertiesPane.vue`, `PaintStackField.vue` (preview tuple)
- Test: `packages/viewer/test/variable-binding.test.ts`, `packages/server/test/` token tests

**Interfaces:**
- Consumes: `TokenResolver`, `TokenIndex`, `scopesForProp`
- Produces: `detachVariable(doc, address, prop, resolved): UidxPatch[] | null`;
  `SCOPE_VIOLATION: 'UIDX131'` at **warning** severity

- [x] **Step 1: Write the failing tests**

```ts
describe('detach writes the literal (G8)', () => {
  it('replaces the alias with the value it resolved to', () => {
    // node has cornerRadius="{radius#md}", radius#md resolves to 8
    expect(detachVariable(doc, 'p#f', 'cornerRadius', 8)).toEqual([
      { op: 'set', address: 'p#f', prop: 'cornerRadius', value: 8 },
    ])
  })

  it('never blanks the property', () => {
    const patches = detachVariable(doc, 'p#f', 'cornerRadius', 8)!
    expect(patches.some((p) => p.op === 'remove')).toBe(false)
  })

  it('returns null when the token resolved to nothing', () => {
    expect(detachVariable(doc, 'p#f', 'cornerRadius', undefined)).toBeNull()
  })
})

describe('scope violations warn rather than fail (G8)', () => {
  it('warns when a binding sits outside the variable’s scopes', () => {
    // radius#md is scoped ['CORNER_RADIUS']; the node binds it to itemSpacing
    const d = check(`<Frame name="f" itemSpacing="{radius#md}" />`)
    const hit = d.find((x) => x.code === CODES.SCOPE_VIOLATION)!
    expect(hit.severity).toBe('warning')
  })

  it('does not warn for an ALL_SCOPES variable', () => {
    expect(check(`<Frame name="f" itemSpacing="{any#loose}" />`)
      .some((x) => x.code === CODES.SCOPE_VIOLATION)).toBe(false)
  })
})
```

- [x] **Step 2: Run them to verify they fail**

Run: `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/viewer test -- variable-binding && PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm --filter @uidx/server test`
Expected: FAIL — `detachVariable` is not exported; `CODES.SCOPE_VIOLATION` is `undefined`.

- [x] **Step 3: Write `detachVariable`**

```ts
/**
 * Detach a binding by writing the value it was resolving to.
 *
 * Not by clearing the property: a detach that blanks the value loses the
 * design. Figma's own equivalent — dragging an auto-layout handle — silently
 * drops the binding, which the review named as fatal for bidirectional sync.
 * `resolved` comes from the caller's `TokenResolver`, in the node's own tuple,
 * so detaching in dark mode writes the dark value.
 */
export function detachVariable(
  doc: UidxDocument,
  address: string,
  prop: string,
  resolved: JsonValue | undefined,
): UidxPatch[] | null {
  if (resolved === undefined) return null
  const node = resolve(doc.tree, address)
  if (!node) return null
  return [{ op: 'set', address, prop, value: resolved }]
}
```

Route the panel's existing detach affordance (the unlink icon in `PropertyLink.vue`) through it, passing the resolved value from the node's tuple.

- [x] **Step 4: Add the scope warning**

```ts
  /** A binding to a variable whose scopes do not cover this property. */
  SCOPE_VIOLATION: 'UIDX131',
```

In `symbols.ts`, where property bindings are already validated, add the check at
**warning** severity — matching the surrounding code's warning construction:

```ts
      // A warning, deliberately. Figma's scopes only filter its picker; its API
      // binds regardless. A hard error would make the file stricter than the
      // tool it mirrors, and would reject a file that arrived by import.
      const wanted = scopesForProp(prop)
      const scopes = index.entries.get(target)?.scopes
      if (wanted && scopes && !scopes.includes('ALL_SCOPES') &&
          !scopes.some((s) => wanted.includes(s))) {
        diagnostics.push({
          code: CODES.SCOPE_VIOLATION,
          severity: 'warning',
          message: `"${target}" is not scoped for ${prop}`,
        })
      }
```

- [x] **Step 5: Preview in the node's own mode**

`variableCandidates` takes the flat default-tuple map today, so a picker opened
on a dark subtree previews light values. Pass the resolved map for the selected
node's tuple instead: `App.vue` already holds the `TokenResolver`, and the
selection already knows its address, so compute the tuple once per selection
change and hand `resolver.resolve(tuple)` to `PropertiesPane` and
`PaintStackField` in place of `tokens`. The token pill's tooltip reads from the
same map.

- [x] **Step 6: Run the tests to verify they pass**

Run: `PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH" pnpm test`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add packages/format packages/server packages/viewer
git commit -m "Detach writes the value, not a blank; a scope violation warns"
```

## Done when

- `examples/core-tokens.uidx` declares a type on every variable and still renders.
- A frame carrying `modes={{ … }}` paints its subtree in that mode, and a nested
  frame can override it back.
- The picker offers a `CORNER_RADIUS` variable for corner radius and not for gap.
- **Apply variable mode** reads `Auto` on an unset node and writes the attribute
  when changed.
- Detaching a bound property writes the resolved literal, never a blank.
- A binding outside a variable's scopes warns; it does not fail the check.
- `pnpm test`, `pnpm typecheck` and `pnpm lint` all pass on node 22.
