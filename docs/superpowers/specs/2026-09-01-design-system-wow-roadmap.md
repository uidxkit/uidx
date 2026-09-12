# Design-system wow roadmap

The goal, in the user's words: *a wow effect for design system creation in an
agentic way.* This spec captures the agreed direction after the ten-run
measurement day (2026-09-01) — what is done, what is next, and the design
decisions already made.

## Done (this day, all committed)

- Phased flow: research → architecture → component → sections → prose → sweep,
  each gated by arithmetic and a real render. Driver: `packages/agent/scripts/e2e-arch.mjs`.
- Research first (item 1): visual references fetched and studied *before* the
  architecture is declared; vision distilled into a written `appearance` spec.
- Component after documentation (item 2): phase 0.5 builds the `<Component>`
  from the declared axes; first insert carries variants (UIDX121).
- design.md per component (Google Labs convention) inside the uidx intent as
  `## Design`; read back by later tasks. Tokens and future patterns take the
  same section.
- Twelve silent-failure audits, each measured to zero false positives on the
  39 hand-authored pages before shipping.
- Prompt caching (verified against billing), usage logging, verified prices
  (Sonnet 5 $2/$10, Haiku $1/$5; ~$4/page Sonnet, ~$1 Haiku).

## Next

### 3. Ask questions during research  *(mechanism this day; real home is the panel)*

The research phase may end with up to three short questions that would
materially change the design (sizes, axes, brand). The driver answers from
`E2E_ANSWERS` (defaults provided); the panel will put them to the designer.
The point is behaviour, not ceremony: a run that never asks is a generator,
one that asks well is a designer.

### 4. The states grid becomes a phase with a gate  *(this day)*

The marquee section under-delivered in every run while definitions succeeded.
It gets what fixed the component: its own phase (right after the component),
a brief naming the matrix shape, and an arithmetic gate — the states frame
must exist and hold at least one `<Instance>` of the component per designed
`<Variant>`; a combination nobody designed gets a "not designed" cell, never
a blank.

### 5. Page-style research from published design systems  *(next session)*

Study how the best public design-system *documentation pages* look — spacing
rhythm, specimen presentation, annotation style — and distill a page-level
visual spec the way component appearance is distilled today. Keep the current
sections. Constraint: Figma files are not fetchable (auth + canvas); the
sources are published documentation sites (m3.material.io, polaris.shopify.com,
carbondesignsystem.com, atlassian.design) through the same guarded fetch.
Output: a `page-style` skill (or document-level `## Design`) the architect
reads. This is also where the brand-seed idea lands: seed → three-tier tokens
→ themed pages.

### 6. CLI + MCP so Claude Code can be the agent  *(next session, spec first)*

Three ways to drive uidx, all first-class:

1. **Harness** (today): the agent server's own loop.
2. **Claude Code + CLI, local**: `uidx` subcommands exposing what the harness
   tools do — read/search/edit ops, render-to-png, the audits as one
   `uidx audit` command, architect store, and **selection** (the viewer's
   current selection served by the server, readable from the CLI; shipped
   2026-09-02 as `uidx selection` / `uidx_selection`, read-only, discovered
   through `.uidx-server.json`) — plus
   skills encoding this day's lessons so Claude Code follows the same flow.
3. **Claude Code + MCP, local or remote**: the same surface as MCP tools, so
   a remote session can work a published uidx document the way the harness
   works a local one. Tool schemas stay flat (measured: top-level `oneOf` is
   uncallable by small models, and MCP clients vary).

Design rule for all three: one shared implementation behind the surfaces —
the CLI and MCP call the same functions the harness tools call, so an audit
fixed once is fixed everywhere.

### 7. Tokens view and the refactor engine  *(shipped 2026-09-02)*

A `<Tokens>` page opens as a real table (modes as columns, alias chains with
their calculated values, inline editing, creation); every page toggles
Elements | Tokens; rename/delete/deprecate carry their blast radius, with
delete inlining resolved literals so no design breaks; component rename rides
the same engine. Spec:
`2026-09-02-tokens-view-and-refactor-engine-design.md`. Staged next from that
spec: component delete-as-detach.

## Deliberately not doing

- Taste-audits (audits are physics; taste comes from references + design.md).
- Multi-agent swarms (the single gated loop keeps failures diagnosable).
- A second JSX section in the uidx format (one Visual Contract is law; the
  design.md's visual form is the anatomy board inside it).
