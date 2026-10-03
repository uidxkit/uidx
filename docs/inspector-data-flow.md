# Review: models and the right panel

Reviewed from `design-system` at `ac796cc8`. The problem is the amount of
translation the panel asks of a designer: a model, a contract prop, a repeat,
a visual layer, and a library mapping are presented as separate concepts before
the relationship between them is clear.

## Findings and changes

| Friction in the previous panel | Change |
| --- | --- |
| Design, Contract, Connect, and Code are equally prominent. Contract and Connect sound interchangeable. | Three task tabs: **Design**, **Data**, and **Code**. Code contains Preview, Component API, and Setup. |
| Repeats appear in Design, Contract, and slot settings; sample previews and instance data appear elsewhere. | Data owns repeat setup, model inputs, field connections, instance values, and sample previews. Design keeps appearance and slot content. |
| Connecting a component to a model requires knowing to declare a prop with the model's type. | Choose a model on a component in Data. The panel adds the typed input without requiring contract syntax. |
| A repeat switch appears on before a model has been chosen. Two lists of the same model silently resolve to the first list. | Choose data before a repeat is written. If the model has several reachable lists, choose the list explicitly. Canceling changes nothing. |
| Selecting a child does not make its owning component or inherited repeat obvious. | A persistent component link identifies ownership. Data names the enclosing repeat; creating another repeat is a secondary action. |
| The headless element can be edited in both Contract and Connect. | Setup is the single editor. Component API shows the current element and links to Setup. |
| Opening Models interrupts the selected layer's workflow. | “Back to [layer]” restores the selection and opens Data. |
| “Items” sounds like a runtime content store. | Models labels these **Sample items** and explains that application code supplies runtime data. |

## The intended workflow

1. Define a model such as `Person`, with fields and representative sample items.
2. For a component that displays one person, choose `Person` in **Data → Model**.
   Select its text layer and choose the field it displays.
3. For a list, select the row or slot and use **Data → Repeat with data**. Choose
   `Person`, then the list source if there is more than one. The existing patch
   operation creates a list input if needed and connects compatible child instances.
4. Select a text or component instance inside the repeat. Data shows where its
   item comes from and offers compatible fields or inputs.
5. Edit sample items in Models, then return to the selected layer.
6. Open **Code** when ready to inspect output, edit the component API, or configure
   library mappings and output settings.

The saved format, generation behavior, and patch-based undo remain unchanged.
Inline binding controls in Design still work as shortcuts while styling. Global
model tables remain in Models because they need more space than an inspector.

## Further evaluation

Try this flow with someone unfamiliar with the format: create a two-row contact
list, connect name and email, change a sample, and return to the row. Check whether
they can distinguish a component's one-item input from a list input without
opening Component API. A later improvement could create a small model inline;
this change keeps one model editor and makes the round trip explicit.
