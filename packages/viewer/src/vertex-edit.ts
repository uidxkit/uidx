import { grabRadius, type Point } from './gesture-model'
import type { PenVertex, Vec } from './pen-model'

/**
 * Editing the points of a path that already exists (story D12), with no canvas
 * in it — the same split `pen-model.ts` and `flow-reorder.ts` keep.
 *
 * D11 draws a path and D12 corrects one, so both want the same vertex: a point
 * with a tangent on each side. `PenVertex` is that already, and reusing it
 * means the two halves of vector authoring cannot disagree about what a smooth
 * point is, or spell one differently from the other — `pathData` is shared too.
 *
 * What is new here is **subpaths**. A pen draws one chain; an imported icon is
 * routinely several — a letter with a counter, a ring, a two-stroke glyph —
 * and all of them live in one `d` on one `<Vector>`. So the model is a list of
 * chains rather than a chain, and everything that addresses a vertex says
 * which chain it is in.
 *
 * Coordinates are the canvas's, because the pointer is and because the SDK's
 * `nodeEditState` overlay is drawn in that space too. The node's own local
 * space — what the file holds — is the host's to convert to and from, since a
 * rotated or nested node makes that a matrix rather than an offset.
 */

/** One chain of vertices. `closed` means a segment runs from the last back to the first. */
export interface Subpath {
  vertices: PenVertex[]
  closed: boolean
  region?: number
  windingRule?: string
}

/** Which vertex, in which chain. */
export interface VertexRef {
  subpath: number
  index: number
}

/** Which of a vertex's two tangents. `in` leads into it, `out` leads out. */
export interface HandleRef extends VertexRef {
  side: 'in' | 'out'
}

/* ------------------------------------------------------------ the network */

/**
 * The scene graph's own shape, as much of it as this module reads.
 *
 * Declared structurally rather than imported from `@open-pencil/scene-graph`
 * for the reason `EditableNode` is: the tests then need no SDK, and the module
 * says exactly which fields it depends on.
 */
export interface Network {
  vertices: readonly { x: number; y: number }[]
  segments: readonly { start: number; end: number; tangentStart: Vec; tangentEnd: Vec }[]
  regions?: readonly { windingRule: string; loops: number[][] }[]
}

const ZERO: Vec = { x: 0, y: 0 }
const clone = (v: Vec): Vec => ({ x: v.x, y: v.y })

/**
 * The chains a network spells, in the order its segments run.
 *
 * A `VectorNetwork` is a graph and a `d` string is a walk over one, so this is
 * the walk. `parseSVGPath` emits each subpath as a run of consecutive segments
 * — measured against `M0 0L10 0L10 10L0 0ZM20 20…`, which came back as two runs
 * of three, the closing segment a `Z` becomes included. That last part is what
 * makes `closed` readable off the geometry rather than guessed.
 *
 * A break in that continuity starts a new chain, which is the same rule read
 * from the other end. Every network here arrives through `parseSVGPath`, so it
 * spells some `d` and a chain is all it can be; a branching network — legal in
 * a `VectorNetwork`, unwriteable in a `d` — would come apart into chains here
 * rather than be refused, and could not survive the write-back either way.
 */
export function subpathsOf(network: Network): Subpath[] {
  const { vertices, segments } = network
  const subpaths: Subpath[] = []

  // Segments arrive grouped per subpath, so a chain is a run: keep taking
  // segments while each starts where the last one ended.
  let run: { start: number; end: number; tangentStart: Vec; tangentEnd: Vec }[] = []
  const flush = (): void => {
    if (run.length === 0) return
    const chain = run
    run = []
    const closed = chain.length > 1 && chain[chain.length - 1]!.end === chain[0]!.start
    // The closing segment is not a vertex of its own; its tangents belong to
    // the two ends it joins.
    const body = closed ? chain.slice(0, -1) : chain
    const built: PenVertex[] = []
    for (const [i, segment] of body.entries()) {
      const at = vertices[segment.start]
      if (!at) return
      built.push({
        x: at.x,
        y: at.y,
        in: i === 0 ? ZERO : clone(body[i - 1]!.tangentEnd),
        out: clone(segment.tangentStart),
      })
    }
    const last = vertices[body[body.length - 1]!.end]
    if (!last) return
    built.push({
      x: last.x,
      y: last.y,
      in: clone(body[body.length - 1]!.tangentEnd),
      out: ZERO,
    })
    if (closed) {
      const closer = chain[chain.length - 1]!
      built[built.length - 1]!.out = clone(closer.tangentStart)
      built[0]!.in = clone(closer.tangentEnd)
    }
    const firstSegment = segments.indexOf(chain[0]!)
    const region =
      network.regions?.findIndex((r) => r.loops.some((loop) => loop.includes(firstSegment))) ?? -1
    if (built.length >= 2)
      subpaths.push({
        vertices: built,
        closed,
        ...(region >= 0 && (network.regions?.length ?? 0) > 1
          ? { region, windingRule: network.regions![region]!.windingRule }
          : {}),
      })
  }

  for (const segment of segments) {
    if (run.length && run[run.length - 1]!.end !== segment.start) flush()
    run.push(segment)
  }
  flush()
  return subpaths
}

/**
 * A network spelling these chains, for the scene graph.
 *
 * The commit goes through the scene rather than straight to the file — a
 * vouched `updateNode`, the way a panel edit does — so `vectorNetworkToSVGPaths`
 * is what spells the `d`. That is deliberate: ADR 0006 §8 measured the round
 * trip as a fixed point through *that* pair of functions, and a second speller
 * here would be a second thing to keep agreeing with it.
 */
export function networkOf(subpaths: readonly Subpath[], windingRule = 'NONZERO'): Network {
  const vertices: { x: number; y: number }[] = []
  const segments: { start: number; end: number; tangentStart: Vec; tangentEnd: Vec }[] = []
  const regions = new Map<number, { windingRule: string; loops: number[][] }>()

  for (const subpath of subpaths) {
    const base = vertices.length
    const loop: number[] = []
    for (const v of subpath.vertices) vertices.push({ x: v.x, y: v.y })
    const step = (from: number, to: number): void => {
      loop.push(segments.length)
      segments.push({
        start: base + from,
        end: base + to,
        tangentStart: clone(subpath.vertices[from]!.out),
        tangentEnd: clone(subpath.vertices[to]!.in),
      })
    }
    for (let i = 1; i < subpath.vertices.length; i++) step(i - 1, i)
    if (subpath.closed && subpath.vertices.length > 1) step(subpath.vertices.length - 1, 0)
    // Only a closed chain encloses anything, so only a closed chain is a loop
    // of a region — an open one has no inside to fill and no winding rule.
    if (subpath.closed) {
      const key = subpath.region ?? -1
      const region = regions.get(key) ?? {
        windingRule: subpath.windingRule ?? windingRule,
        loops: [],
      }
      region.loops.push(loop)
      regions.set(key, region)
    }
  }

  return {
    vertices,
    segments,
    regions: [...regions.values()],
  }
}

/* ------------------------------------------------------------- hit-testing */

/**
 * Whether a vertex has a segment on this side.
 *
 * The ends of an open chain carry a tangent field the path never reads —
 * `pathData` takes `out` from the earlier vertex and `in` from the later one,
 * so the first vertex's `in` and the last one's `out` spell nothing. Offering
 * a handle for one would be an affordance for a drag that changes no geometry.
 */
export function hasHandle(subpath: Subpath, index: number, side: 'in' | 'out'): boolean {
  if (subpath.closed) return true
  return side === 'in' ? index > 0 : index < subpath.vertices.length - 1
}

/** Where a handle's grip is drawn: the vertex plus its tangent. */
export function handlePoint(vertex: PenVertex, side: 'in' | 'out'): Point {
  const t = side === 'in' ? vertex.in : vertex.out
  return { x: vertex.x + t.x, y: vertex.y + t.y }
}

const near = (a: Point, b: Point, reach: number): number | null => {
  const distance = Math.hypot(a.x - b.x, a.y - b.y)
  return distance <= reach ? distance : null
}

/** The vertex under a point, nearest first, or null. */
export function vertexNear(
  subpaths: readonly Subpath[],
  point: Point,
  zoom: number,
): VertexRef | null {
  const reach = grabRadius(zoom)
  let best: VertexRef | null = null
  let bestDistance = Infinity
  for (const [subpath, chain] of subpaths.entries()) {
    for (const [index, vertex] of chain.vertices.entries()) {
      const distance = near(point, vertex, reach)
      if (distance === null || distance >= bestDistance) continue
      best = { subpath, index }
      bestDistance = distance
    }
  }
  return best
}

/**
 * The handle under a point, or null.
 *
 * `visible` is the set of vertices whose handles the overlay is drawing, keyed
 * `"<subpath>:<index>"`. Hit-testing an undrawn handle would be a grab at
 * something nobody can see — and the SDK decides what is drawn (selected
 * vertices and their neighbours), so the caller passes that answer in rather
 * than this module guessing at it a second time.
 *
 * A zero-length tangent is skipped: its grip sits exactly on its own vertex, so
 * testing it would shadow every corner point with a handle that starts a drag
 * from nowhere.
 */
export function handleNear(
  subpaths: readonly Subpath[],
  point: Point,
  zoom: number,
  visible: ReadonlySet<string>,
): HandleRef | null {
  const reach = grabRadius(zoom)
  let best: HandleRef | null = null
  let bestDistance = Infinity
  for (const [subpath, chain] of subpaths.entries()) {
    for (const [index, vertex] of chain.vertices.entries()) {
      if (!visible.has(`${subpath}:${index}`)) continue
      for (const side of ['in', 'out'] as const) {
        if (!hasHandle(chain, index, side)) continue
        const tangent = side === 'in' ? vertex.in : vertex.out
        if (tangent.x === 0 && tangent.y === 0) continue
        const distance = near(point, handlePoint(vertex, side), reach)
        if (distance === null || distance >= bestDistance) continue
        best = { subpath, index, side }
        bestDistance = distance
      }
    }
  }
  return best
}

/* ------------------------------------------------------------------ edits */

/** Every edit returns a fresh model; nothing here mutates its input. */
const replace = (subpaths: readonly Subpath[], at: number, vertices: PenVertex[]): Subpath[] =>
  subpaths.map((s, i) => (i === at ? { ...s, vertices } : s))

/** The vertex moved to `to`. Its tangents are offsets, so they come with it. */
export function moveVertex(subpaths: readonly Subpath[], ref: VertexRef, to: Point): Subpath[] {
  const chain = subpaths[ref.subpath]
  const vertex = chain?.vertices[ref.index]
  if (!chain || !vertex) return [...subpaths]
  const moved = chain.vertices.map((v, i) =>
    i === ref.index ? { ...v, x: to.x, y: to.y, in: clone(v.in), out: clone(v.out) } : v,
  )
  return replace(subpaths, ref.subpath, moved)
}

const length = (v: Vec): number => Math.hypot(v.x, v.y)

/**
 * How the tangent on the far side of a vertex answers this one.
 *
 * Figma stores this per vertex (`handleMirroring`), and an SVG `d` has nowhere
 * to put it — so the file cannot tell us, and the geometry has to. That is not
 * a compromise: a point whose two tangents already point exactly opposite ways
 * *is* a smooth point, and one whose tangents disagree is a corner. Reading it
 * back off the shape keeps a smooth curve smooth through an edit and leaves a
 * deliberate corner sharp, which is the whole of what the flag was for.
 *
 * Equal lengths as well as opposite directions is Figma's ANGLE_AND_LENGTH;
 * opposite directions alone is ANGLE, where the far handle turns but keeps the
 * length someone chose for it.
 */
function mirroringOf(vertex: PenVertex): 'none' | 'angle' | 'both' {
  const a = vertex.in
  const b = vertex.out
  const la = length(a)
  const lb = length(b)
  if (la === 0 || lb === 0) return 'none'
  // Antiparallel: the cross product vanishes and the dot product is negative.
  const cross = a.x * b.y - a.y * b.x
  const dot = a.x * b.x + a.y * b.y
  const scale = la * lb
  if (Math.abs(cross) > scale * 1e-6 || dot >= 0) return 'none'
  // Relative, because these are canvas units: a hundredth of a pixel decides
  // nothing on a 4px handle and everything on a 4000px one.
  return Math.abs(la - lb) <= 1e-6 * Math.max(la, lb) ? 'both' : 'angle'
}

/** Mirrored, without the negative zeroes `-0 !== 0` makes trouble with (D11). */
const opposite = (v: Vec, to: number): Vec => {
  const l = length(v)
  if (l === 0) return { x: 0, y: 0 }
  const k = to / l
  return { x: v.x === 0 ? 0 : -v.x * k, y: v.y === 0 ? 0 : -v.y * k }
}

/**
 * The handle dragged so its grip sits at `to`.
 *
 * The far handle follows by `mirroringOf`'s reading of the point, unless
 * `independent` — Alt, the modifier Figma uses to break a smooth point.
 */
export function moveHandle(
  subpaths: readonly Subpath[],
  ref: HandleRef,
  to: Point,
  options: { independent?: boolean } = {},
): Subpath[] {
  const chain = subpaths[ref.subpath]
  const vertex = chain?.vertices[ref.index]
  if (!chain || !vertex) return [...subpaths]

  const dragged: Vec = { x: to.x - vertex.x, y: to.y - vertex.y }
  const mirroring = options.independent === true ? 'none' : mirroringOf(vertex)
  const far = ref.side === 'in' ? vertex.out : vertex.in
  const followed =
    mirroring === 'none'
      ? clone(far)
      : opposite(dragged, mirroring === 'both' ? length(dragged) : length(far))

  const next: PenVertex =
    ref.side === 'in'
      ? { ...vertex, in: dragged, out: followed }
      : { ...vertex, out: dragged, in: followed }
  return replace(
    subpaths,
    ref.subpath,
    chain.vertices.map((v, i) => (i === ref.index ? next : v)),
  )
}

/**
 * The path without this vertex, or null when there would be no path left.
 *
 * A chain of two is a segment and a chain of one is nothing a `<Vector>` can
 * draw, so taking a point below two takes the whole chain with it. Emptying the
 * last chain is refused rather than committed: a vector with no geometry
 * renders nothing (D1's note), and deleting the shape is D2's gesture on the
 * node, not this one on its last point.
 */
export function removeVertex(subpaths: readonly Subpath[], ref: VertexRef): Subpath[] | null {
  const chain = subpaths[ref.subpath]
  if (!chain || !chain.vertices[ref.index]) return null

  if (chain.vertices.length <= 2) {
    const rest = subpaths.filter((_, i) => i !== ref.subpath)
    return rest.length ? rest : null
  }

  const kept = chain.vertices.filter((_, i) => i !== ref.index)
  // An open chain that loses an end loses the segment that reached it; the new
  // end keeps whatever tangent it had, which is what the remaining curve says.
  return replace(subpaths, ref.subpath, kept)
}

export type VectorAction = 'smooth' | 'corner' | 'insert' | 'delete' | 'toggle-closed'
export interface VectorEditInfo {
  id: string
  points: number
  paths: number
  selected: boolean
  closed: boolean | null
  canDelete: boolean
}

/** Split a cubic with de Casteljau, preserving the curve exactly. */
export function insertVertex(
  subpaths: readonly Subpath[],
  ref: VertexRef,
  t = 0.5,
): Subpath[] | null {
  const chain = subpaths[ref.subpath]
  const a = chain?.vertices[ref.index]
  const nextIndex = chain && (ref.index + 1) % chain.vertices.length
  const b = chain?.vertices[nextIndex!]
  if (!chain || !a || !b || (!chain.closed && ref.index === chain.vertices.length - 1)) return null
  const mix = (p: Vec, q: Vec): Vec => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })
  const sub = (p: Vec, q: Vec): Vec => ({ x: p.x - q.x, y: p.y - q.y })
  const straight = length(a.out) === 0 && length(b.in) === 0
  const p = mix(a, handlePoint(a, 'out'))
  const q = mix(handlePoint(a, 'out'), handlePoint(b, 'in'))
  const r = mix(handlePoint(b, 'in'), b)
  const s = mix(p, q),
    u = mix(q, r),
    at = straight ? mix(a, b) : mix(s, u)
  const vertices = chain.vertices.map((v, i) => {
    if (i === ref.index) return { ...v, out: straight ? ZERO : sub(p, a) }
    if (i === nextIndex) return { ...v, in: straight ? ZERO : sub(r, b) }
    return v
  })
  vertices.splice(ref.index + 1, 0, {
    ...at,
    in: straight ? ZERO : sub(s, at),
    out: straight ? ZERO : sub(u, at),
  })
  return replace(subpaths, ref.subpath, vertices)
}

export function pointStyle(
  subpaths: readonly Subpath[],
  ref: VertexRef,
  smooth: boolean,
): Subpath[] | null {
  const chain = subpaths[ref.subpath]
  const v = chain?.vertices[ref.index]
  if (!chain || !v) return null
  const count = chain.vertices.length
  const before = chain.vertices[(ref.index + count - 1) % count]!
  const after = chain.vertices[(ref.index + 1) % count]!
  const start = !chain.closed && ref.index === 0 ? v : before
  const end = !chain.closed && ref.index === count - 1 ? v : after
  const distance = Math.hypot(end.x - start.x, end.y - start.y)
  const reach =
    Math.min(
      start === v ? Infinity : Math.hypot(v.x - start.x, v.y - start.y),
      end === v ? Infinity : Math.hypot(v.x - end.x, v.y - end.y),
    ) / 3
  const out =
    smooth && distance > 0
      ? { x: ((end.x - start.x) / distance) * reach, y: ((end.y - start.y) / distance) * reach }
      : ZERO
  return replace(
    subpaths,
    ref.subpath,
    chain.vertices.map((point, i) =>
      i === ref.index ? { ...point, in: opposite(out, length(out)), out } : point,
    ),
  )
}

/** Nearest segment within a screen-space tolerance, used by double-click to add a point. */
export function segmentNear(
  subpaths: readonly Subpath[],
  point: Point,
  zoom: number,
): (VertexRef & { t: number }) | null {
  let best: (VertexRef & { t: number }) | null = null
  let distance = grabRadius(zoom) ** 2
  for (const [subpath, chain] of subpaths.entries()) {
    const count = chain.closed ? chain.vertices.length : chain.vertices.length - 1
    for (let index = 0; index < count; index++) {
      const a = chain.vertices[index]!,
        b = chain.vertices[(index + 1) % chain.vertices.length]!
      const at = (t: number): Point => {
        if (length(a.out) === 0 && length(b.in) === 0)
          return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
        const u = 1 - t,
          c = handlePoint(a, 'out'),
          d = handlePoint(b, 'in')
        return {
          x: u ** 3 * a.x + 3 * u * u * t * c.x + 3 * u * t * t * d.x + t ** 3 * b.x,
          y: u ** 3 * a.y + 3 * u * u * t * c.y + 3 * u * t * t * d.y + t ** 3 * b.y,
        }
      }
      const squared = (t: number): number => {
        const p = at(t)
        return (p.x - point.x) ** 2 + (p.y - point.y) ** 2
      }
      let sample = 1,
        nearest = Infinity
      for (let i = 1; i < 32; i++) {
        const d = squared(i / 32)
        if (d < nearest) {
          nearest = d
          sample = i
        }
      }
      let lo = (sample - 1) / 32,
        hi = (sample + 1) / 32
      for (let i = 0; i < 18; i++) {
        const l = lo + (hi - lo) / 3,
          r = hi - (hi - lo) / 3
        if (squared(l) < squared(r)) hi = r
        else lo = l
      }
      const t = (lo + hi) / 2,
        d = squared(t)
      if (t > 0.001 && t < 0.999 && d < distance) {
        distance = d
        best = { subpath, index, t }
      }
    }
  }
  return best
}

/* --------------------------------------------------------------- overlay */

/** The SDK's `nodeEditState` payload, as much of it as this builds. */
export interface VertexOverlay {
  nodeId: string
  vertices: { x: number; y: number }[]
  segments: { start: number; end: number; tangentStart: Vec; tangentEnd: Vec }[]
  regions: { windingRule: string; loops: number[][] }[]
  selectedVertexIndices: Set<number>
  selectedHandles: Set<string>
}

/** Where a `{subpath, index}` lands in the flat vertex list `networkOf` builds. */
export function flatIndexOf(subpaths: readonly Subpath[], ref: VertexRef): number {
  let base = 0
  for (let i = 0; i < ref.subpath; i++) base += subpaths[i]?.vertices.length ?? 0
  return base + ref.index
}

/**
 * Which vertices the overlay will draw handles for, as `"<subpath>:<index>"`.
 *
 * The SDK's rule, restated in this module's coordinates: a selected vertex and
 * its immediate neighbours along the chain. Restated rather than imported
 * because `handleAt` has to agree with what is on screen, and the SDK's copy
 * speaks in flat indices over a network this module has not built yet.
 */
export function handleVisibility(
  subpaths: readonly Subpath[],
  selected: VertexRef | null,
): Set<string> {
  const visible = new Set<string>()
  if (!selected) return visible
  const chain = subpaths[selected.subpath]
  if (!chain) return visible
  const last = chain.vertices.length - 1
  const neighbour = (i: number): number | null => {
    if (i >= 0 && i <= last) return i
    if (!chain.closed) return null
    return i < 0 ? last : 0
  }
  for (const i of [selected.index - 1, selected.index, selected.index + 1]) {
    const at = neighbour(i)
    if (at !== null) visible.add(`${selected.subpath}:${at}`)
  }
  return visible
}

/** What to draw: the whole path, with the selected point called out. */
export function overlay(
  nodeId: string,
  subpaths: readonly Subpath[],
  selected: VertexRef | null,
  windingRule = 'NONZERO',
): VertexOverlay {
  const network = networkOf(subpaths, windingRule)
  return {
    nodeId,
    vertices: [...network.vertices],
    segments: [...network.segments],
    regions: [...(network.regions ?? [])],
    selectedVertexIndices: new Set(selected ? [flatIndexOf(subpaths, selected)] : []),
    selectedHandles: new Set<string>(),
  }
}
