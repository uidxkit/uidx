---
name: uidx-design-system
description: Build or extend this project's design system in uidx — tokens, component identities with contracts and state styles, models, behaviour, then check and generate code.
---

# Building a design system in uidx

A component here is an *identity* (ADRs 0012–0017): one `.uidx` file holding
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

Read `uidx-authoring` for the grammar and `uidx-eval-api` for scripted batches.
