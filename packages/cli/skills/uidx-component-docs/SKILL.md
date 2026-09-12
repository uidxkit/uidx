---
name: uidx-component-docs
description: Build a component documentation page in .uidx with live examples of the component's properties, variants, and intended usage.
---

# Component documentation

Describe the component's purpose, public properties, variant axes, slots,
anatomy, and usage constraints in Markdown above `## Visual Contract`.
Follow the project's documentation style and the user's requested scope.

On the canvas, use instances of the component to demonstrate designed states
and property values. Put the component definition beside the documentation
frame as a direct `Page` child: the grammar forbids nesting a `Component` in a
`Frame`. A documentation frame can hold labelled examples, anatomy, size
measurements, usage context, and do/don't examples as needed.

Keep state, interaction, and size as distinct axes when they represent distinct
questions. Presence and label text usually belong in component properties.
Display combinations that the component actually declares; label missing
combinations rather than creating an instance of a nonexistent variant.

Read [uidx-authoring](../uidx-authoring/SKILL.md) for the node grammar. Use an
outline read to find existing addresses, then create or edit the relevant
sections through CLI/MCP. Check the resulting file and render or inspect the
page in the viewer. Document actual limitations of the implementation without
claiming checks that were not performed.
