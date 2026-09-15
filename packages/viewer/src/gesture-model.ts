/**
 * The arithmetic of a canvas gesture (story C10), with no canvas in it.
 *
 * Everything a drag has to decide — which handle a press landed on, the rect a
 * delta implies, what the modifiers change, where an arrow key lands — is
 * decided here, so it can be tested without a renderer. Spike S1 established
 * that the canvas render path cannot be driven headlessly; this module is how
 * the gestures stay testable anyway, the same way `layer-moves.ts` keeps the
 * rail's rules out of its component.
 */

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The eight grips Figma puts on a selection, named by compass point. */
export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type Handle = (typeof HANDLES)[number]

/** Half the grab radius at 100%, in canvas units. The SDK draws them at 3px. */
const HANDLE_GRAB = 6

/** Where each handle sits on a rect, as a fraction of its width and height. */
const ANCHOR: Record<Handle, Point> = {
  nw: { x: 0, y: 0 },
  n: { x: 0.5, y: 0 },
  ne: { x: 1, y: 0 },
  e: { x: 1, y: 0.5 },
  se: { x: 1, y: 1 },
  s: { x: 0.5, y: 1 },
  sw: { x: 0, y: 1 },
  w: { x: 0, y: 0.5 },
}

/**
 * Turn a point about a pivot, in degrees — positive is clockwise in y-down
 * screen space, which is the SDK's own convention: measured on a node turned
 * 67.067°, `getWorldHandles` placed ne − nw at exactly R(67.067°)·(width, 0)
 * under this formula.
 */
export function rotateAbout(point: Point, centre: Point, degrees: number): Point {
  if (degrees === 0) return point
  const rad = (degrees * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = point.x - centre.x
  const dy = point.y - centre.y
  return { x: centre.x + dx * cos - dy * sin, y: centre.y + dx * sin + dy * cos }
}

/**
 * The handle under a point, if any.
 *
 * `zoom` widens the tolerance as the view shrinks: a handle drawn at a fixed
 * pixel size covers more canvas units when zoomed out, and a grab radius fixed
 * in canvas units would become impossible to hit.
 *
 * A rotated node's grips are not where its axis-aligned rect puts them, so the
 * pointer is turned back into the node's own frame — about the origin, the
 * SDK's pivot — and tested there, one rotation instead of eight.
 */
export function handleAt(rect: Rect, point: Point, zoom: number, rotation = 0): Handle | null {
  const tolerance = HANDLE_GRAB / Math.max(zoom, 0.01)
  // Back into the node's own frame: the inverse of translate(origin) · rotate.
  const origin = { x: rect.x, y: rect.y }
  const local = rotateAbout(point, origin, -rotation)
  for (const handle of HANDLES) {
    const anchor = ANCHOR[handle]
    const hx = rect.x + rect.width * anchor.x
    const hy = rect.y + rect.height * anchor.y
    if (Math.abs(local.x - hx) <= tolerance && Math.abs(local.y - hy) <= tolerance) return handle
  }
  return null
}

/**
 * Where a point of the rect lands on screen once the node is turned.
 *
 * `anchor` is a fraction of the rect — `{x: 0, y: 0}` is its north-west
 * corner, `{x: 0.5, y: 0.5}` its centre. The node's world transform is
 * translate(origin) · rotate(rotation): the pivot is the top-left origin,
 * which the renderer's own drawing proved — dots computed centre-pivot sat
 * well off the drawn grips, origin-pivot dots sat exactly on them.
 */
export function cornerWorld(rect: Rect, rotation: number, anchor: Point): Point {
  const local = { x: rect.width * anchor.x, y: rect.height * anchor.y }
  const turned = rotateAbout(local, { x: 0, y: 0 }, rotation)
  return { x: rect.x + turned.x, y: rect.y + turned.y }
}

/** Where each of the eight grips sits, in canvas space. */
export type HandlePoints = Record<Handle, Point>

/**
 * The grip nearest a point, within `tolerance`, or null.
 *
 * The positions come from the scene graph's own world-handle helper — the
 * same one the renderer draws from — so hit-testing and drawing cannot
 * disagree about where a grip is, whatever rotation or ancestor transform
 * applies. Computing them here from a rect is what let the two drift apart.
 */
export function nearestHandle(
  handles: HandlePoints,
  point: Point,
  tolerance: number,
): Handle | null {
  let best: Handle | null = null
  let bestDistance = Infinity
  for (const handle of HANDLES) {
    const at = handles[handle]
    if (!at) continue
    const distance = Math.hypot(point.x - at.x, point.y - at.y)
    if (distance <= tolerance && distance < bestDistance) {
      best = handle
      bestDistance = distance
    }
  }
  return best
}

/** The grab radius at this zoom, in canvas units. */
export const grabRadius = (zoom: number): number => HANDLE_GRAB / Math.max(zoom, 0.01)

/**
 * The eight grips of a rect, turned about its origin — the same points
 * `getWorldHandles` answers for a node the graph can place, for a host that
 * cannot ask it.
 */
export function handlePointsOf(rect: Rect, rotation = 0): HandlePoints {
  const points = {} as HandlePoints
  for (const handle of HANDLES) points[handle] = cornerWorld(rect, rotation, ANCHOR[handle])
  return points
}

/**
 * How far above the top-centre grip the renderer draws its rotation grip, in
 * screen px: `drawBoundsHandles` puts it at `minY - 24 / zoom`, on a stem, in
 * the node's own frame. Fixed in screen space like the grips themselves, so
 * it is the same reach from the box whatever the zoom.
 */
export const ROTATE_HANDLE_STEM = 24
/** The grip's grab radius on screen, in px — the 6px square plus a little. */
export const ROTATE_HANDLE_RADIUS = 6

/**
 * Where the renderer's rotation grip sits, in canvas units: out along the
 * box's own up-axis from the top-centre grip, so it turns with the node.
 *
 * Measured from the drawn grips rather than a rect, so a nested or rotated
 * node puts the target exactly where the grip is painted. A box of no height
 * has no up-axis of its own, and the grip sits straight above it.
 */
export function rotationHandlePoint(handles: HandlePoints, zoom: number): Point {
  const centre = { x: (handles.nw.x + handles.se.x) / 2, y: (handles.nw.y + handles.se.y) / 2 }
  const top = handles.n
  const dx = top.x - centre.x
  const dy = top.y - centre.y
  const length = Math.hypot(dx, dy)
  const up = length > 0 ? { x: dx / length, y: dy / length } : { x: 0, y: -1 }
  const reach = ROTATE_HANDLE_STEM / Math.max(zoom, 0.01)
  return { x: top.x + up.x * reach, y: top.y + up.y * reach }
}

/**
 * The angle of each grip's resize axis in the node's own frame, in degrees.
 * An edge grip resizes along one axis; a corner along its diagonal.
 */
const HANDLE_AXIS: Record<Handle, number> = {
  e: 0,
  w: 0,
  n: 90,
  s: 90,
  se: 45,
  nw: 45,
  ne: 135,
  sw: 135,
}

/** The four orientations native cursors come in, by screen angle mod 180. */
const AXIS_CURSOR = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'] as const

/**
 * The cursor a grip should wear, given how far the node is turned.
 *
 * The arrows must point along the axis the grip actually resizes — an edge
 * drag only counts the component along the node's own axis, so a cursor that
 * points elsewhere invites a drag of which only a sliver registers, and the
 * gesture feels broken-slow. Native cursors come in four orientations, so
 * the true angle quantizes to the nearest 45°.
 */
export function resizeCursor(handle: Handle, rotation: number): string {
  const angle = (((HANDLE_AXIS[handle] + rotation) % 180) + 180) % 180
  return AXIS_CURSOR[Math.round(angle / 45) % 4]!
}

/** The rect after a move. `constrain` is Shift: lock to the dominant axis. */
export function movedRect(rect: Rect, delta: Point, constrain: boolean): Rect {
  let { x: dx, y: dy } = delta
  if (constrain) {
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0
    else dx = 0
  }
  return { x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height }
}

export interface ResizeModifiers {
  /** Shift: keep the original aspect ratio. */
  constrain?: boolean
  /** Alt: grow from the centre rather than the opposite edge. */
  fromCentre?: boolean
}

/**
 * The rect after dragging `handle` by `delta`.
 *
 * A dimension never goes negative: dragging an edge past its opposite pins it
 * at zero rather than inverting the box, because an inverted rect is not
 * something the file can hold.
 */
export function resizedRect(
  rect: Rect,
  handle: Handle,
  delta: Point,
  modifiers: ResizeModifiers,
  rotation = 0,
): Rect {
  // A rotated node grows along its own axes: a screen-down drag on the se grip
  // of a quarter-turned box widens it. The pointer's travel is turned into the
  // node's frame first.
  const travel = rotation === 0 ? delta : rotateAbout(delta, { x: 0, y: 0 }, -rotation)
  const anchor = ANCHOR[handle]
  const movesX = anchor.x !== 0.5
  const movesY = anchor.y !== 0.5
  // A west grip grows the box by moving its origin left, so the delta counts
  // against the width; an east grip adds to it directly.
  const signX = anchor.x === 0 ? -1 : 1
  const signY = anchor.y === 0 ? -1 : 1

  // Alt moves the opposite edge too, so the box gains twice the drag.
  const factor = modifiers.fromCentre ? 2 : 1
  let width = rect.width + (movesX ? travel.x * signX * factor : 0)
  let height = rect.height + (movesY ? travel.y * signY * factor : 0)

  if (modifiers.constrain && movesX && movesY && rect.width !== 0 && rect.height !== 0) {
    const ratio = rect.width / rect.height
    // The larger change leads, so the gesture follows the pointer's intent.
    if (Math.abs(width - rect.width) >= Math.abs(height - rect.height)) height = width / ratio
    else width = height * ratio
  }

  width = Math.max(0, width)
  height = Math.max(0, height)

  /*
   * The part of the node you are not dragging must not move on screen. The
   * world transform is translate(origin) · rotate, so the held local point
   * p = (ax·w, ay·h) sits at origin + R·p — holding it means the origin moves
   * by R·(p − p'). Alt holds the centre instead. At zero rotation this is the
   * familiar x + (w − w') arithmetic.
   */
  const ax = modifiers.fromCentre ? 0.5 : 1 - anchor.x
  const ay = modifiers.fromCentre ? 0.5 : 1 - anchor.y
  const shift = rotateAbout(
    { x: ax * (rect.width - width), y: ay * (rect.height - height) },
    { x: 0, y: 0 },
    rotation,
  )
  return { x: rect.x + shift.x, y: rect.y + shift.y, width, height }
}

/** Figma's rotation snap. */
const SNAP_DEGREES = 15

/**
 * The node's rotation after dragging from `from` to `to` about `centre`,
 * added to the rotation it already had. `constrain` is Shift: snap to 15°.
 */
export function rotationFor(
  centre: Point,
  from: Point,
  to: Point,
  original: number,
  constrain: boolean,
): number {
  const angle = (p: Point): number => (Math.atan2(p.y - centre.y, p.x - centre.x) * 180) / Math.PI
  const next = original + (angle(to) - angle(from))
  return constrain ? Math.round(next / SNAP_DEGREES) * SNAP_DEGREES : next
}

/** How far one arrow press moves the selection. Shift is Figma's big nudge. */
const NUDGE = 1
const NUDGE_BIG = 10

const ARROWS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
}

/** Where an arrow key puts a point, or null if the key is not an arrow. */
export function nudged(point: Point, key: string, big: boolean): Point | null {
  const direction = ARROWS[key]
  if (!direction) return null
  const step = big ? NUDGE_BIG : NUDGE
  return { x: point.x + direction.x * step, y: point.y + direction.y * step }
}

/**
 * The rect between two corners, whichever way the pointer swept.
 *
 * A draw gesture can go up and to the left, and a negative width is not
 * something the file can hold — nor something the marquee can draw.
 */
export function sweptRect(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  }
}
