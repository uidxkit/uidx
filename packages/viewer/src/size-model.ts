/**
 * Which sizing prop governs a dimension (story C9).
 *
 * Figma's W and H boxes each carry a Hug/Fixed state, but the file has no
 * `widthSizingMode` — it has a primary and a counter axis, and which one is
 * which depends on the layout direction. That mapping is this module, so the
 * `SizeField` can stay a control and not a rulebook.
 */
export function sizingPropFor(
  layoutMode: string,
  dimension: 'width' | 'height',
): 'primaryAxisSizingMode' | 'counterAxisSizingMode' {
  const primaryIsWidth = layoutMode === 'HORIZONTAL'
  const isPrimary = dimension === 'width' ? primaryIsWidth : !primaryIsWidth
  return isPrimary ? 'primaryAxisSizingMode' : 'counterAxisSizingMode'
}

/**
 * The same question for a `<Text>`, whose sizing is one prop rather than two.
 *
 * A frame states each axis separately; a text states both at once in
 * `textAutoResize`, because Figma has no auto-width-but-fixed-height text —
 * measuring the glyphs' width means measuring their height too. So the four
 * legal values collapse to three of the four axis combinations, and
 * `TRUNCATE` (the legacy fixed-and-ellipsises state, see `TextResizeField`)
 * reads as fixed on both.
 */
export function textSizingFor(mode: string, dimension: 'width' | 'height'): 'FIXED' | 'AUTO' {
  if (dimension === 'width') return mode === 'WIDTH_AND_HEIGHT' ? 'AUTO' : 'FIXED'
  return mode === 'WIDTH_AND_HEIGHT' || mode === 'HEIGHT' ? 'AUTO' : 'FIXED'
}

/**
 * The `textAutoResize` that picking Hug or Fixed on *one* axis produces.
 *
 * The edited axis wins, and the other follows only where the vocabulary
 * forces it: hugging the width hugs the height with it, and fixing the height
 * of an auto-width text fixes its width too, since the alternative spells a
 * mode that does not exist. That is the same judgement `resize-writes.ts`
 * makes for a typed number and a dragged handle — kept here so the dropdown,
 * the panel's number field and the canvas gesture cannot disagree.
 */
export function textResizeWrite(
  current: string,
  dimension: 'width' | 'height',
  next: 'FIXED' | 'AUTO',
): 'NONE' | 'HEIGHT' | 'WIDTH_AND_HEIGHT' {
  if (dimension === 'width') {
    if (next === 'AUTO') return 'WIDTH_AND_HEIGHT'
    return textSizingFor(current, 'height') === 'AUTO' ? 'HEIGHT' : 'NONE'
  }
  if (next === 'AUTO')
    return textSizingFor(current, 'width') === 'AUTO' ? 'WIDTH_AND_HEIGHT' : 'HEIGHT'
  return 'NONE'
}
