import { isDrawingTool, type DrawingTool } from './graphics-tools'

/**
 * Keyboard for the creation toolbar (story D1), and the guard every global
 * shortcut in the viewer has to pass first.
 *
 * Pure, because the controller cannot be driven headlessly (spike S1) and a
 * shortcut table buried in a `.vue` is one nobody can test.
 */

/**
 * Whether the keystroke belongs to something the author is typing in.
 *
 * The viewer listens for shortcuts on the window, so without this an `R` typed
 * into a hex field would also arm the rectangle tool, and an arrow meant to
 * move a caret would walk the selected node across the canvas.
 */
export function isTypingTarget(event: { target?: unknown }): boolean {
  const target = event.target as { tagName?: string; isContentEditable?: boolean } | null
  if (!target) return false
  if (target.isContentEditable === true) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * Figma's letters, which is the whole reason to have them: an author who knows
 * one tool already knows this one. `V` is the move tool, spelled here as "no
 * tool" because that is what this viewer's default state is.
 *
 * `P` rather than a fifth shape letter for `<Vector>`, because Figma's `V` is
 * taken and the pen is what makes vectors there.
 */
const TOOL_KEYS: Record<string, DrawingTool | 'move'> = {
  KeyV: 'move',
  KeyF: 'Frame',
  KeyR: 'Rectangle',
  KeyO: 'Ellipse',
  KeyT: 'Text',
  KeyP: 'Vector',
  KeyL: 'Line',
}

export interface ToolKeyEvent {
  code: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  target?: unknown
}

/**
 * The tool a keystroke arms, `null` to disarm, or `undefined` for "not mine".
 *
 * The three answers are deliberately distinct: `null` is Escape and `V`, which
 * *do* belong to the toolbar and put it back to selecting, where `undefined`
 * leaves the key for whatever else is listening.
 *
 * `event.code` rather than `event.key`, for the reason the zoom shortcuts give:
 * a letter is a different character on every layout, and a physical key is not.
 */
export function toolFor(event: ToolKeyEvent): DrawingTool | null | undefined {
  if (isTypingTarget(event)) return undefined
  // A modifier means the keystroke belongs to the platform or the browser.
  if (event.metaKey || event.ctrlKey || event.altKey) return undefined
  if (event.code === 'Escape') return null
  if (event.shiftKey && event.code === 'KeyP') return 'Pencil'
  if (event.shiftKey && event.code === 'KeyL') return 'Arrow'
  const tool = TOOL_KEYS[event.code]
  if (tool === undefined) return undefined
  return tool === 'move' ? null : isDrawingTool(tool) ? tool : undefined
}

/** Delete and Backspace both remove the selection, as they do everywhere else. */
export function isDeleteKey(event: ToolKeyEvent): boolean {
  if (isTypingTarget(event)) return false
  if (event.metaKey || event.ctrlKey || event.altKey) return false
  return event.code === 'Delete' || event.code === 'Backspace'
}
