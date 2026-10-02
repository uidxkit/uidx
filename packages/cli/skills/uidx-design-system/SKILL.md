---
name: uidx-design-system
description: Build or extend this project's design system in uidx — tokens, component identities with contracts and state styles, models, behaviour, then check and generate code.
---

# Building a design system in uidx

A component here is an *identity* (ADRs 0012–0018): one `.uidx` file holding
its anatomy, its contract, its state styles and its behaviour. Code, the canvas
and Figma are renders of it. Work in this order and check after each step.

1. **Read what exists.** `uidx search`, `uidx read <page> --mode outline`,
   `uidx contract <page>`; the viewer's selection (`uidx selection`) is what
   "this" means. Reuse tokens and components before adding any.
2. **Tokens first.** A `<Tokens>` page: collections of `<Variable type=… value=…>`,
   modes as `<Mode>` children. Name by purpose (`surface#accent`, `space#md`),
   and alias primitives from semantic tokens. Components reference tokens only.
3. **Anatomy.** One `<Component name=… implements="…">` per file, drawn once
   in its default state, with `part="…"` on each layer the headless element
   owns. Bind text to props (`characters="{label}"`).
4. **Contract.** `declare` each prop (`visual` for anything that changes the
   look — enums become axes, booleans states), event, slot, state the element
   produces itself, part. Every declaration has words a developer can build from.
5. **States.** One `<Styles>` cell per difference: `style({state:'hover'}, 'root',
   'fills', '{surface#accentHover}')`. Never write per-state trees; add a
   `<Variant>` only when a value changes the anatomy.
6. **Data.** A list prop is typed `Model[]`; declare the model once with a key
   field and samples; `repeat="{items}"` on the layer that repeats.
7. **Behaviour and examples** as prose: `- id: when X, the component does Y`.
   Decide, or name the prop that selects.
8. **Verify.** `uidx check` (every region against the others), `uidx render
   <page> -o out.png` and look at it, then `uidx codegen` if the project
   generates code. Fix what they name before moving on.

**A use restyles only its outer box** (ADR 0018): fills, strokes, corners,
padding, opacity and effects, plus `textFills` for every text inside, never the
component's layout or layers. A row keyed by a state (`hover`, a visual
boolean, a declared state) wins over that override, and a row keyed only by
visual enums is the resting look it replaces. So a look that must hold in some
state belongs on that state's row, and a look many uses want is a visual prop
with rows, not a restyle repeated. Generated components read the override
through `--uidx-*` custom properties (`--uidx-fill`, `--uidx-radius`,
`--uidx-padding-left`, `--uidx-text-color`, …), which a use sets in `style`.
Each component root resets them, except the text colour, which inherits. A
use's box goes through a frame that only wraps another to the one inside, so
the Shoelace example's Button is restyled on its `base` part. Over a
shadow-DOM library, code reads only the hooks for what the design states on
that node: where it states none, as on the Shoelace Checkbox, Switch and
Input, a look its uses vary is a visual prop. Never name a token collection
`uidx`: its variables would spell those hooks (UIDX155).

Read `uidx-authoring` for the grammar and `uidx-eval-api` for scripted batches.
