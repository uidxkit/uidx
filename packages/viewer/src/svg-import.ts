import { parseColor } from '@open-pencil/core'
import type { JsonValue, UidxNodeSpec } from '@uidx/format'
import svgpath from 'svgpath'

/**
 * SVG in, `<Vector>` nodes out (story D8, the vector half).
 *
 * **Why this reads the SVG rather than using the SDK's importer.**
 * `prepareSVGImport` produces `VectorNetwork`s, and `vectorPaths` is a `d`
 * string — going the SDK's way means reconstructing a `d` from a network,
 * which `prop-table.ts` already documents as lossy and is exactly the round
 * trip D8 was written to avoid. An SVG *already contains* `d` strings. Reading
 * them straight across, and using `svgpath` only to bake ancestor transforms
 * into the coordinates, keeps arcs as arcs and curves as curves.
 *
 * **Why the viewer and not `@uidx/schema`.** D1 put "what a new node is made
 * of" in the schema package because every surface must agree on it. This is a
 * different kind of thing: a *source adapter*, reading someone else's file
 * format. It needs a DOM, which the schema package has neither at run time nor
 * in its tests, and the CLI resolves that package at run time and does not want
 * an SVG parser in its tree. If `uidx import` is ever wanted, this module and
 * its tests move as they are.
 *
 * **Nothing is dropped in silence.** What the format cannot hold — text that
 * was never outlined, embedded rasters, filters, clip paths, gradient
 * references — comes back in `problems` so the author is told. A silently
 * simplified logo is worse than a refused one.
 */

export type SvgProblemKind =
  | 'text'
  | 'image'
  | 'use'
  | 'filter'
  | 'clip-path'
  | 'mask'
  | 'paint-reference'
  | 'nested-svg'
  | 'stylesheet'
  | 'unsupported-element'

export interface SvgProblem {
  kind: SvgProblemKind
  /** Said in the author's terms, not the parser's. */
  detail: string
  count: number
}

export interface SvgImport {
  /**
   * One `<Vector>` per path, wrapped in a `<Frame>` when there is more than
   * one — never a single node that has forgotten which path was which.
   * Null when the source yielded no drawable geometry at all.
   */
  node: UidxNodeSpec | null
  size: { width: number; height: number }
  problems: SvgProblem[]
}

/** What an SVG with no `width`/`height`/`viewBox` is assumed to be. */
const FALLBACK_SIZE = 100

/** Elements that carry no geometry and are not worth reporting as skipped. */
const IGNORED = new Set(['defs', 'title', 'desc', 'metadata', 'symbol', 'marker'])

/** Elements the format has no answer for, and what to call them. */
const REFUSED: Record<string, { kind: SvgProblemKind; detail: string }> = {
  text: { kind: 'text', detail: 'text that was never outlined' },
  tspan: { kind: 'text', detail: 'text that was never outlined' },
  image: { kind: 'image', detail: 'an embedded raster image' },
  use: { kind: 'use', detail: 'a <use> reference to another element' },
  style: { kind: 'stylesheet', detail: 'a CSS stylesheet, so class-based paints are not read' },
  svg: { kind: 'nested-svg', detail: 'a nested <svg>' },
  foreignObject: { kind: 'unsupported-element', detail: 'a <foreignObject>' },
}

/** Attributes that change how a shape draws in ways `vectorPaths` cannot say. */
const REFUSED_ATTRS: Record<string, { kind: SvgProblemKind; detail: string }> = {
  filter: { kind: 'filter', detail: 'a filter, which is drawn without it' },
  'clip-path': { kind: 'clip-path', detail: 'a clip path, which is drawn without it' },
  mask: { kind: 'mask', detail: 'a mask, which is drawn without it' },
}

interface Path {
  d: string
  fills: JsonValue
  strokes: JsonValue
  strokeWeight?: number
  windingRule: 'NONZERO' | 'EVENODD'
}

/** Inherited SVG presentation state, since `fill` and `stroke` cascade. */
interface Inherited {
  fill: string
  stroke: string
  strokeWidth: string
  fillRule: string
  opacity: number
}

const ROOT_STATE: Inherited = {
  fill: 'black',
  stroke: 'none',
  strokeWidth: '1',
  fillRule: 'nonzero',
  opacity: 1,
}

export function importSvg(source: string, name: string): SvgImport {
  const problems = new Map<string, SvgProblem>()
  const note = (kind: SvgProblemKind, detail: string): void => {
    const key = `${kind}:${detail}`
    const seen = problems.get(key)
    if (seen) seen.count += 1
    else problems.set(key, { kind, detail, count: 1 })
  }

  const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
  const root = doc.documentElement
  if (!root || root.nodeName === 'parsererror' || root.localName !== 'svg') {
    return { node: null, size: { width: 0, height: 0 }, problems: [] }
  }

  const size = sizeOf(root)
  const paths: Path[] = []
  walk(root, viewBoxTransform(root, size), ROOT_STATE, paths, note, true)

  const problemList = [...problems.values()]
  if (paths.length === 0) return { node: null, size, problems: problemList }

  const vectors = paths.map((path, i) => vectorSpec(path, `${name}-path-${i + 1}`))
  if (vectors.length === 1) {
    return {
      node: { ...vectors[0]!, attrs: { ...vectors[0]!.attrs, name } },
      size,
      problems: problemList,
    }
  }
  return {
    node: {
      element: 'Frame',
      attrs: { name, width: size.width, height: size.height },
      children: vectors,
    },
    size,
    problems: problemList,
  }
}

function vectorSpec(path: Path, name: string): UidxNodeSpec {
  const attrs: Record<string, JsonValue> = {
    name,
    vectorPaths: [{ windingRule: path.windingRule, data: path.d }],
  }
  if (path.fills) attrs.fills = path.fills
  if (path.strokes) {
    attrs.strokes = path.strokes
    if (path.strokeWeight !== undefined) attrs.strokeWeight = path.strokeWeight
  }
  return { element: 'Vector', attrs }
}

/** The `width`/`height` the import lands at, in the SVG's own user units. */
function sizeOf(root: Element): { width: number; height: number } {
  const box = viewBox(root)
  const width = length(root.getAttribute('width')) ?? box?.width ?? FALLBACK_SIZE
  const height = length(root.getAttribute('height')) ?? box?.height ?? FALLBACK_SIZE
  return { width, height }
}

function viewBox(root: Element): { x: number; y: number; width: number; height: number } | null {
  const raw = root.getAttribute('viewBox')
  if (!raw) return null
  const parts = raw
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null
  return { x: parts[0]!, y: parts[1]!, width: parts[2]!, height: parts[3]! }
}

/**
 * The outermost transform: the viewBox mapped onto the node's own box.
 *
 * Without it, an icon authored in a 24-unit viewBox and placed at 96px would
 * import at a quarter of its size — the single most common way an SVG import
 * looks wrong.
 */
function viewBoxTransform(root: Element, size: { width: number; height: number }): string {
  const box = viewBox(root)
  if (!box || box.width === 0 || box.height === 0) return ''
  const sx = size.width / box.width
  const sy = size.height / box.height
  // Nothing at all when the viewBox already matches the box, which is the
  // common case for an icon. `svgpath` re-spells whatever it touches — legal
  // and equivalent, but a path that needed no transform should cross byte for
  // byte, so the file shows what the author's SVG actually said.
  if (sx === 1 && sy === 1 && box.x === 0 && box.y === 0) return ''
  const scale = sx === 1 && sy === 1 ? '' : `scale(${sx} ${sy})`
  const move = box.x === 0 && box.y === 0 ? '' : `translate(${-box.x} ${-box.y})`
  return `${scale} ${move}`.trim()
}

function length(raw: string | null): number | null {
  if (!raw) return null
  // Units other than px are not something a design file can honour anyway;
  // the number is what the viewBox is measured against.
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : null
}

function walk(
  el: Element,
  transform: string,
  inherited: Inherited,
  out: Path[],
  note: (kind: SvgProblemKind, detail: string) => void,
  isRoot = false,
): void {
  const tag = el.localName

  if (!isRoot) {
    if (IGNORED.has(tag)) return
    const refused = REFUSED[tag]
    if (refused) {
      note(refused.kind, refused.detail)
      return
    }
  }

  for (const [attr, problem] of Object.entries(REFUSED_ATTRS)) {
    const value = el.getAttribute(attr)
    if (value && value !== 'none') note(problem.kind, problem.detail)
  }

  const own = el.getAttribute('transform')
  const here = own ? `${transform} ${own}`.trim() : transform
  const state = inherit(el, inherited)

  const d = tag === 'path' ? el.getAttribute('d') : shapeToPath(el)
  if (d) {
    const baked = here ? svgpath(d).transform(here).round(4).toString() : d
    out.push(paint(baked, state, note))
    return
  }

  if (tag === 'g' || isRoot || tag === 'a') {
    for (const child of Array.from(el.children)) walk(child, here, state, out, note)
    return
  }
  if (!isRoot && !IGNORED.has(tag) && !REFUSED[tag]) {
    note('unsupported-element', `a <${tag}> element`)
  }
}

function inherit(el: Element, parent: Inherited): Inherited {
  const attr = (n: string): string | null => el.getAttribute(n)
  const opacity = Number.parseFloat(attr('opacity') ?? '1')
  return {
    fill: attr('fill') ?? parent.fill,
    stroke: attr('stroke') ?? parent.stroke,
    strokeWidth: attr('stroke-width') ?? parent.strokeWidth,
    fillRule: attr('fill-rule') ?? parent.fillRule,
    opacity: parent.opacity * (Number.isFinite(opacity) ? opacity : 1),
  }
}

function paint(
  d: string,
  state: Inherited,
  note: (kind: SvgProblemKind, detail: string) => void,
): Path {
  const fills = solid(state.fill, state.opacity, note)
  const strokes = solid(state.stroke, state.opacity, note)
  const weight = Number.parseFloat(state.strokeWidth)
  return {
    d,
    fills: fills ? [fills] : null,
    strokes: strokes ? [strokes] : null,
    ...(strokes && Number.isFinite(weight) ? { strokeWeight: weight } : {}),
    windingRule: state.fillRule === 'evenodd' ? 'EVENODD' : 'NONZERO',
  } as Path
}

/**
 * One SVG paint value as a solid, or null for "nothing to paint".
 *
 * `url(#…)` is a gradient or a pattern. C8's paint stack holds gradients, but
 * not the SVG spelling of one, and guessing at it would put a colour in the
 * file that nobody chose — so it is reported and the paint is left off.
 */
function solid(
  value: string,
  opacity: number,
  note: (kind: SvgProblemKind, detail: string) => void,
): JsonValue | null {
  const raw = value.trim()
  if (raw === '' || raw === 'none' || raw === 'transparent') return null
  if (raw.startsWith('url(')) {
    note('paint-reference', 'a gradient or pattern fill, which is left unpainted')
    return null
  }
  // `currentColor` inherits from CSS this importer cannot see. Black is the
  // SVG default for `color`, and saying so beats refusing the whole shape.
  const colour = parseColor(raw === 'currentColor' ? 'black' : raw)
  const alpha = colour.a * opacity
  return {
    type: 'SOLID',
    color: { r: round(colour.r), g: round(colour.g), b: round(colour.b), a: 1 },
    ...(alpha < 1 ? { opacity: round(alpha) } : {}),
  } as JsonValue
}

const round = (n: number): number => Math.round(n * 1e4) / 1e4

/**
 * The basic shapes as path data.
 *
 * Exact conversions, all of them — the point of doing this rather than letting
 * a rasteriser near it. Circles and ellipses use two half-arcs because a single
 * arc of 360° is degenerate in SVG.
 */
function shapeToPath(el: Element): string | null {
  const n = (name: string, fallback = 0): number => {
    const value = Number.parseFloat(el.getAttribute(name) ?? '')
    return Number.isFinite(value) ? value : fallback
  }
  switch (el.localName) {
    case 'rect': {
      const [x, y, w, h] = [n('x'), n('y'), n('width'), n('height')]
      if (w <= 0 || h <= 0) return null
      const rxRaw = el.getAttribute('rx')
      const ryRaw = el.getAttribute('ry')
      const rx = Math.min(rxRaw !== null ? n('rx') : ryRaw !== null ? n('ry') : 0, w / 2)
      const ry = Math.min(ryRaw !== null ? n('ry') : rxRaw !== null ? n('rx') : 0, h / 2)
      if (rx <= 0 || ry <= 0) {
        return `M${x} ${y}H${x + w}V${y + h}H${x}Z`
      }
      return (
        `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}` +
        `V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}` +
        `H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}` +
        `V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
      )
    }
    case 'circle': {
      const r = n('r')
      if (r <= 0) return null
      const [cx, cy] = [n('cx'), n('cy')]
      return `M${cx - r} ${cy}A${r} ${r} 0 0 1 ${cx + r} ${cy}A${r} ${r} 0 0 1 ${cx - r} ${cy}Z`
    }
    case 'ellipse': {
      const [rx, ry] = [n('rx'), n('ry')]
      if (rx <= 0 || ry <= 0) return null
      const [cx, cy] = [n('cx'), n('cy')]
      return `M${cx - rx} ${cy}A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}A${rx} ${ry} 0 0 1 ${cx - rx} ${cy}Z`
    }
    case 'line':
      return `M${n('x1')} ${n('y1')}L${n('x2')} ${n('y2')}`
    case 'polyline':
    case 'polygon': {
      const points = (el.getAttribute('points') ?? '')
        .trim()
        .split(/[\s,]+/)
        .map(Number)
      if (points.length < 4 || points.some((v) => !Number.isFinite(v))) return null
      const pairs: string[] = []
      for (let i = 0; i + 1 < points.length; i += 2) pairs.push(`${points[i]} ${points[i + 1]}`)
      return `M${pairs.join('L')}${el.localName === 'polygon' ? 'Z' : ''}`
    }
    default:
      return null
  }
}
