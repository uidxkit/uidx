# Inspector layout

The Design inspector uses a 304px rail, 32px controls, consistent two-column
fields, and a sticky layer identity. Text layers lead with content and typography; other layers lead with geometry. Direction precedes auto
layout alignment, spacing, and padding. Paints, effects, and exports share the
same field and action sizes.

The reference is Figma's [properties panel](https://help.figma.com/hc/en-us/articles/360039832014-Design-prototype-and-explore-layer-properties-in-the-right-sidebar),
[stroke settings](https://help.figma.com/hc/en-us/articles/360049283914-Apply-and-adjust-stroke-properties),
and [fill controls](https://help.figma.com/hc/en-us/articles/360041003694-Guide-to-fills).
UIDX keeps its own supported property vocabulary and write semantics.

| Workflow | Where to find it |
| --- | --- |
| Position, rotation, absolute placement, constraints and pinned offsets | Position |
| Dimensions, fixed/hug sizing, text resizing | Layout |
| Min/max dimensions | Layout → Size limits |
| Direction, alignment, distribution, wrap, gaps, padding, clip, child grow/alignment | Layout |
| Wrapped-row distribution, stacking, stroke inclusion | Layout → Layout options |
| Content and component text bindings | Text |
| Family, style, size, line height, letter spacing, alignment | Typography |
| Italic, case, decoration, maximum lines, truncation | Typography → Text options |
| Opacity, blend, visibility, variable modes, uniform/individual corners and smoothing | Appearance |
| Masks, mask type and layer locking | Appearance → Layer options |
| Paint color, opacity, visibility, removal, variables and color picker | Fill / Stroke |
| Stroke position, weight and independent endpoint styles | Stroke |
| Caps, joins, miter limit, dashes and individual side weights | Stroke → Stroke details |
| All effect types, colors, offsets, blur, spread, visibility and removal | Effects |
| Vector points, curves, path closure, fill rule and reusable graphics | Vector |
| Component properties, variants, instance overrides/swaps and slot operations | Contextual controls above layer properties |
| Unmapped authored properties and their existing read-only reasons | Additional properties |
| PNG, JPEG, SVG, scale and pixel dimensions | Export |

Expandable groups show how many properties the document explicitly sets.
Their controls stay mounted, retain their bindings, and use the existing
preview/commit/patch routes. Opening or closing a group does not write anything.
The grouping function includes unlisted future fields in the main group and
keeps paired fields together; tests verify that every supplied row appears once.

Labels are presentation only. Saved names and enum values are unchanged.
Read-only documents still permit inspection, disclosures and export. Text
content accepts multiple lines; paint opacity accepts values with or without `%`.

Token actions remain visible beside scalar values and the compound size,
padding and corner controls. Content and visibility use their section-header
action, including outside components. Fill and stroke colors offer a direct
token picker as well as the color dialog's Libraries tab. Pickers filter by the
property's type and scope and explain when no compatible tokens are loaded.

Bound compound values show the token name with explicit change and detach
actions. Distinct bindings keep padding sides and corners expanded even when
their resolved numbers match. Binding and detaching use structural patches;
symmetric edits form one patch envelope, and pending literal gestures cannot
replace a new binding.
