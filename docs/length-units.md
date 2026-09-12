# Length units

Length controls offer `px` and `rem` beside the number. Switching units converts
the value while retaining its current physical size. Entering a new number or
scrubbing then edits the amount in the selected unit. Sizing modes remain in the
adjacent menu; a typed width or height still changes a hugging axis to Fixed.

Supported lengths include position and pin offsets, dimensions and size limits,
padding, gaps, corner radii, stroke weights and dash patterns, text size and
spacing, and effect offsets, blur and spread. Rotation, opacity, grow factors,
font weight, smoothing and counts have no length units.

Existing numbers remain pixels. Files may also state explicit pixel or relative
lengths:

```jsx
<Page rootFontSize={16}>
  <Frame name="card" width="20rem" height="10rem" x="32px"
    paddingLeft="1rem" cornerRadius="0.5rem" />
</Page>
```

The root font size defaults to 16px. Deselect layers to edit **Root font size**
in the Design panel. It applies to the entire page, including components,
instances, and token values used there. Changing it recalculates rem lengths;
canvas zoom does not affect their meaning. A bare Component document must first
be formatted with an explicit Page wrapper to configure its root size.

FLOAT tokens accept numbers, `px`, `rem`, and aliases, including separate values
per mode. Use the unit selector in a token's value cell, or double-click the
number to type a value such as `1.5rem`. Token aliases retain their original
units when detached. Relative tokens are excluded from unitless property
pickers, and the workspace checker rejects such bindings across every mode.

```jsx
<Tokens>
  <Collection name="space">
    <Variable name="md" type="FLOAT" value="1rem" scopes={['SPACING', 'GAP']} />
  </Collection>
</Tokens>
```

The token table converts using the current page's root size, or 16px when
viewing a Tokens document with no `rootFontSize`. The token itself stores a
relative amount; each consuming page resolves that amount against its own root.

UIDX saves the authored unit through normal edits, canvas moves and resizes,
undo/redo, and reloads. The rendering engine receives resolved pixels, as do
image and Figma exports; `.uidx` remains the source for relative intent.

This implementation supports `px` and `rem`. Other CSS units and expressions
(`em`, `%`, viewport units, `calc()`) are rejected as unsupported lengths.
