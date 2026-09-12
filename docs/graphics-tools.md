# Drawing icons and custom graphics

Open **Graphics** in the creation toolbar to draw a Pen path, Pencil stroke,
Line, Arrow, Polygon, or Star. All produce editable `<Vector>` layers. Rectangle
and Ellipse remain available beside the graphics control. The graphics icon
remembers your last choice: click it to draw with that tool again, or use its
adjacent arrow to choose another. Keyboard shortcuts update that choice too.

| Tool | Shortcut | Gesture |
| --- | --- | --- |
| Pen | P | Click for corners; drag a point for Bézier handles. Click the first point to close, Enter or Done to finish an open path, Escape to discard. |
| Pencil | Shift+P | Drag to sketch; release to save. Redundant points are simplified at the current zoom. |
| Line | L | Drag between endpoints. A click alone creates nothing. |
| Arrow | Shift+L | Drag from the tail to the arrowhead. A click alone creates nothing. |
| Polygon | Graphics menu | Drag a triangle. |
| Star | Graphics menu | Drag a five-point star. |

Shift constrains shape proportions or snaps line angles to 45 degrees. Alt
draws shapes from their center. Clicking with Polygon or Star places a default
size; Line and Arrow require a drag. Escape or changing tools discards an
unfinished drawing.

Select a vector and use **Edit vector** in the inspector or the button beside
its layer. Enter and canvas double-click also enter point editing. The canvas
guide and inspector show the current mode and point count. Select a point to
make it **Corner** or **Smooth**, **Add point**, or **Delete point**. Double-click
a segment to split it at the pointer without changing its curve. Drag handles
to adjust curves; Alt moves a handle independently. **Open path** / **Close
path** acts on the selected point's path. Done, Enter, or Escape leaves editing.

The inspector's Fill and Stroke sections style the graphic, including stroke
weight, caps, joins, and dashes. The Vector section exposes the winding rule.
Changing that rule preserves the original path text. Undo and redo refresh the
point overlay from the saved document.

For an open path with two endpoints, **Start point** and **End point** independently
set None, Round, Square, Line arrow, Triangle arrow, Reverse triangle, Diamond,
or Circle. Position and Weight share a row; rectangular per-side weights are
hidden for vectors. Endpoint styles are saved as `strokeStartCap` and
`strokeEndCap` and inherit `strokeCap` when omitted. New arrows keep a two-point
centerline, so their tip can be changed or removed without editing the path.
The renderer and SVG export include these styles, and export bounds include
their full extent. These controls follow Figma's
[stroke properties](https://help.figma.com/hc/en-us/articles/360049283914-Apply-and-adjust-stroke-properties).

Use **Make reusable component** to name an icon, for example `Icon/Check`, then
**Place instance** to reuse it. The existing SVG drop/import and SVG export
workflows also apply to these layers. Width/height edits and canvas resizing
scale the saved vector geometry, including compound paths.

## Research and implementation scope

Figma's [Pen tool and vector networks](https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks)
create custom shapes, icons, and illustrations. Its
[vector edit mode](https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers)
provides direct manipulation of points and curves, while
[shape tools](https://help.figma.com/hc/en-us/articles/360040450133-Basic-shape-tools-in-Figma-design)
and [Pencil drawing](https://help.figma.com/hc/en-us/articles/31440438150935-Draw-with-illustration-tools)
offer faster starting points. Reviewed September 6, 2026.

UIDX extends its existing path authoring and component model. Presets use
ordinary paths instead of adding schema elements. This implements the core
drawing and point-editing workflow; branching vector networks, boolean shape
operations, textured brushes, and variable stroke widths remain separate work.

The renderer patch preserves open stroke details alongside filled regions and
exports each region's winding rule. The schema reads every `vectorPaths` entry
and preserves open details on writeback. Explicit commits also record scalar
fields already applied by a preview: the scene graph's unchanged-value filter
must not prevent a resized width or height from reaching the file.
Stroke previews compose the renderer's full stroke record, while commits save
the single authored property, preserving paint aliases and avoiding unwanted
per-side weight attributes.
