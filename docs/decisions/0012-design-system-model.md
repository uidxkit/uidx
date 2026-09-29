# ADR 0012 — The design system model: identity, contract, behaviour; components are renders

Status: **accepted**, 2026-09-29. Umbrella for ADRs 0013–0017, which each
decide one region of the file.

## Context

A design system used to be a library of hand-built components that people
assembled. When agents generate most of the UI, generation is cheap and drift
is the default failure, so the question becomes: where does consistency live
when nobody assembles by hand?

UIDX already has the pieces of an answer. A `.uidx` file is a language, not a
picture: primitives (`Frame`, `Text`, `Vector`), auto-layout and constraints,
tokens with modes, named components with props and variants, and addresses an
agent can patch. What it lacks is everything a component *is* beyond its look:
what it accepts, what it does, and what data it shows.

Meanwhile the headless web components in `@hwc/components` hold exactly that
other half — state, behaviour, accessibility, form participation — as custom
elements with no paint, each described by a `SPEC.md` with an anatomy of named
parts.

## Decision

### 1. A component is an identity; targets render it

A component's **identity** is platform-free and theme-free and has three
layers, each in its own region of one `.uidx` file:

| Layer | Region | Reader |
|---|---|---|
| Intent, anatomy, layout, styles | intent prose + `## Visual Contract` | viewer, canvas, Figma export, code emitters |
| Contract: props, events, states, slots, parts, form, accessibility | `## Contract` (ADR 0013) | code emitters, audit, agents |
| Behaviour guidelines | `## Behavior` (ADR 0014) | developers, agents, tests |
| Data shapes and sample scenes | `## Models`, `## Examples` (ADR 0015) | canvas, Figma, code emitters |

A **theme** is token values in modes. A **concrete component** is
`render(identity, props, theme, target)`. Appearance variants are points in
that space and are never authored (ADR 0016); only variants that change
anatomy are authored trees.

The targets are the canvas (today), Figma export, HTML/CSS and React
(ADR 0017). Each target reads the regions it can use and ignores the rest.
The viewer and Figma never read `## Contract`, `## Behavior` or `## Models`
beyond what the canvas needs to draw sample data.

### 2. Declare, never compute

The file declares. It never contains an implementation:

- No TypeScript blocks. The headless element implements behaviour in code and
  is proven to conform to the declared contract (ADR 0013 §4).
- No expressions. The only dynamic values are aliases — `{radius#md}`, a
  component property `{label}`, or a model field `{item.name}` — and each is a
  lookup, not a formula. Derived values arrive as fields (ADR 0015 §2).
- No conditions in the visual contract. Presence and appearance under a state
  are rows in the styles table (ADR 0016 §2), not `when` attributes.

### 3. Behaviour lives in the headless layer

A component's `implements` attribute names its headless root, e.g.
`hwc-checkbox`. Its parts (`part="checked-indicator"`) are that root's part
elements. Slots are that root's slots. The design system owns how every part
looks and where it sits; the headless element owns what it does. Composition
(`Composes with`) is the headless layer's graph, which the audit reads.

### 4. What stays out of scope for now

- **Theming beyond modes** — several brands, density, per-product overrides —
  is a future task. Modes (ADR 0011 era, story G8) remain the only theming
  axis in this iteration.
- Responsive and adaptive layout rules.
- Evals for generated screens.

## Consequences

- One file per component is the single source of truth for what it is. Code,
  Figma sets and `SPEC.md` become renders of it.
- The parser gains three optional regions after the visual contract
  (ADR 0013 §1). Existing files are unchanged and stay valid.
- `uidx check` gains the rules each ADR names. They are what make the model a
  tool rather than a document.
- A new package, `@uidx/codegen`, renders HTML/CSS and React from the file
  (ADR 0017), and an example package demonstrates the whole path against
  `@hwc/components`.
