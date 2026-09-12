import type { Point, Rect } from './gesture-model'

/**
 * The arithmetic of drawing a path point by point (story D11), with no canvas
 * in it — the same reason `gesture-model.ts` and `flow-reorder.ts` exist.
 *
 * Tangents rather than absolute control points, because that is the shape both
 * consumers want: the SDK's `penState` overlay draws `{ tangentStart,
 * tangentEnd }` per segment, and a `VectorNetwork` stores the same. Keeping one
 * representation means the preview and the committed geometry cannot disagree.
 *
 * Everything here is in canvas (world) coordinates, because the pointer is.
 * Only `pathData` takes an origin, because only the file needs the path
 * relative to the node that will hold it.
 */

export interface Vec {
  x: number
  y: number
}

export interface PenVertex {
  x: number
  y: number
  /** Offset from the vertex to the control point leading *into* it. */
  in: Vec
  /** Offset to the control point leading *out* of it. Zero for a corner. */
  out: Vec
}

const ZERO: Vec = { x: 0, y: 0 }
const isZero = (v: Vec): boolean => v.x === 0 && v.y === 0

/**
 * Mirrored, without the negative zeroes.
 *
 * `-0` compares unequal to `0` under `Object.is`, which is what `toEqual` and
 * every structural comparison in this repo use — so a tangent mirrored from a
 * flat handle would read as a change that never happened, all the way out to
 * `fromSceneChange` deciding a path had moved.
 */
const mirror = (v: Vec): Vec => ({ x: v.x === 0 ? 0 : -v.x, y: v.y === 0 ? 0 : -v.y })

/** How near the first vertex the pointer must be to close the path, in px. */
export const CLOSE_RADIUS = 8

/**
 * A vertex placed at `at`. A press that travels pulls handles out of it, and
 * they mirror — which is what makes a pen draw smooth curves rather than
 * corners, and what Figma does unless you hold Alt.
 */
export function vertexAt(at: Point, drag: Point | null): PenVertex {
  if (!drag) return { x: at.x, y: at.y, in: ZERO, out: ZERO }
  const out = { x: drag.x - at.x, y: drag.y - at.y }
  return { x: at.x, y: at.y, in: mirror(out), out }
}

/** Whether a press here would close the path rather than extend it. */
export function closesPath(vertices: readonly PenVertex[], at: Point, zoom: number): boolean {
  const first = vertices[0]
  if (!first || vertices.length < 2) return false
  const reach = CLOSE_RADIUS / Math.max(zoom, 0.01)
  return Math.hypot(at.x - first.x, at.y - first.y) <= reach
}

const fmt = (n: number): string => {
  const r = Math.round(n * 100) / 100
  return Object.is(r, -0) ? '0' : String(r)
}

/**
 * The `d` for this path, relative to `origin`.
 *
 * A segment is a line when neither end pulls a tangent, and a cubic otherwise —
 * the same rule `vectorNetworkToSVGPaths` applies coming the other way, which
 * is what makes the round trip in ADR 0006 §8 a fixed point rather than a
 * conversion.
 */
export function pathData(
  vertices: readonly PenVertex[],
  closed: boolean,
  origin: Point = ZERO,
): string {
  if (vertices.length === 0) return ''
  const px = (v: { x: number }): number => v.x - origin.x
  const py = (v: { y: number }): number => v.y - origin.y

  const segment = (a: PenVertex, b: PenVertex): string => {
    if (isZero(a.out) && isZero(b.in)) return `L${fmt(px(b))} ${fmt(py(b))}`
    return (
      `C${fmt(px(a) + a.out.x)} ${fmt(py(a) + a.out.y)}` +
      ` ${fmt(px(b) + b.in.x)} ${fmt(py(b) + b.in.y)}` +
      ` ${fmt(px(b))} ${fmt(py(b))}`
    )
  }

  let d = `M${fmt(px(vertices[0]!))} ${fmt(py(vertices[0]!))}`
  for (let i = 1; i < vertices.length; i++) d += segment(vertices[i - 1]!, vertices[i]!)
  if (closed && vertices.length > 1)
    d += `${segment(vertices[vertices.length - 1]!, vertices[0]!)}Z`
  return d
}

/** The parameters where a cubic turns back on itself, on one axis. */
function extrema(p0: number, p1: number, p2: number, p3: number): number[] {
  // B'(t) = 0, written from the control-point differences.
  const d0 = p1 - p0
  const d1 = p2 - p1
  const d2 = p3 - p2
  const a = d0 - 2 * d1 + d2
  const b = 2 * (d1 - d0)
  const c = d0
  const inRange = (t: number): boolean => t > 0 && t < 1
  if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b].filter(inRange)
  const disc = b * b - 4 * a * c
  if (disc < 0) return []
  const root = Math.sqrt(disc)
  return [(-b + root) / (2 * a), (-b - root) / (2 * a)].filter(inRange)
}

const at = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
  const u = 1 - t
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
}

/**
 * The tight box around the drawn ink.
 *
 * Tight, not the control polygon's: a handle can reach well outside the curve
 * it shapes, and a node whose box is bigger than its ink selects and resizes
 * around empty space. Cheap to do properly — a cubic's extremes are the roots
 * of one quadratic per axis.
 */
export function bounds(vertices: readonly PenVertex[], closed: boolean): Rect {
  if (vertices.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  const xs: number[] = []
  const ys: number[] = []

  const add = (a: PenVertex, b: PenVertex): void => {
    if (isZero(a.out) && isZero(b.in)) return
    const [c1x, c1y] = [a.x + a.out.x, a.y + a.out.y]
    const [c2x, c2y] = [b.x + b.in.x, b.y + b.in.y]
    for (const t of extrema(a.x, c1x, c2x, b.x)) xs.push(at(a.x, c1x, c2x, b.x, t))
    for (const t of extrema(a.y, c1y, c2y, b.y)) ys.push(at(a.y, c1y, c2y, b.y, t))
  }

  for (const v of vertices) {
    xs.push(v.x)
    ys.push(v.y)
  }
  for (let i = 1; i < vertices.length; i++) add(vertices[i - 1]!, vertices[i]!)
  if (closed && vertices.length > 1) add(vertices[vertices.length - 1]!, vertices[0]!)

  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

/** The SDK's own in-progress overlay payload, which the renderer already draws. */
export interface PenOverlay {
  vertices: Vec[]
  segments: { start: number; end: number; tangentStart: Vec; tangentEnd: Vec }[]
  dragTangent: Vec | null
  oppositeDragTangent: Vec | null
  closingToFirst: boolean
  cursorX?: number
  cursorY?: number
}

/**
 * What to draw for the path in progress.
 *
 * Built from the same vertices the commit will use, so what the author watched
 * being drawn is what lands — the property C10b's drop target and D7's caret
 * both keep, and the reason neither draws its own overlay.
 */
export function overlay(
  vertices: readonly PenVertex[],
  cursor: Point | null,
  options: { closing?: boolean; dragging?: boolean } = {},
): PenOverlay {
  const segments = []
  for (let i = 1; i < vertices.length; i++) {
    segments.push({
      start: i - 1,
      end: i,
      tangentStart: vertices[i - 1]!.out,
      tangentEnd: vertices[i]!.in,
    })
  }
  const last = vertices[vertices.length - 1]
  const dragTangent = options.dragging && last ? last.out : null
  return {
    vertices: vertices.map((v) => ({ x: v.x, y: v.y })),
    segments,
    dragTangent,
    oppositeDragTangent: dragTangent ? mirror(dragTangent) : null,
    closingToFirst: options.closing === true,
    ...(cursor ? { cursorX: cursor.x, cursorY: cursor.y } : {}),
  }
}
