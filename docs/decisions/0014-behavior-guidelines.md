# ADR 0014 — Behaviour guidelines: prose with ids, traced to tests

Status: **accepted**, 2026-09-29. Part of ADR 0012.

## Context

Two behaviours can both be legitimate — a number input that clamps at its
limit and one that wraps — and whoever implements the renderer must not be
the one who decides. The decision has to be in the file, in words a developer
and an agent implement from and a test is written against.

## Decision

### 1. A `## Behavior` region of bullets

```mdx
## Behavior

- toggle: click or Space flips `checked`; a click while `indeterminate` sets `checked` and clears `indeterminate`.
- change-event: `change` fires once per user toggle, never when `checked` is set from code.
- limit-reached: `overflow="clamp"` (default) stops at `min`/`max`; `overflow="wrap"` continues from the other end.
```

Each bullet is one observable behaviour: an id before the colon, then a
sentence in the form "when X, the component does Y", naming the props, states
and events involved in backticks. Prose stays prose; the parser reads only the
id and the text.

### 2. Decide or expose, never leave open

When more than one behaviour is legitimate, the rule either decides it or
names the prop that selects it. A bullet describing alternatives without a
selecting prop is an open decision and the audit reports it.

### 3. Traceability

Every id is an address, `Checkbox#behavior/toggle`. The headless
implementation's tests carry the same ids; a conformance report lists rules
without a test and tests without a rule. The visual targets never read this
region: where a rule has a visual consequence, that consequence is a state in
the contract and a row in the styles table.

### 4. Conventions

- Name a rule by the situation, not the implementation. "Clamps" is
  behaviour; "uses a reducer" is not.
- Platform parity is a complete rule when true: "matches native
  `<input type=checkbox>`".
- Rationale may follow the sentence; it stops the decision being reopened.

## Consequences

- `SPEC.md` sections Accessibility, Form participation and the behaviour parts
  of Composition become renders of this region.
- Agents writing pages read the rules to know how a component behaves without
  opening its implementation.
