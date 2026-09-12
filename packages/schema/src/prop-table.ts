import { parseSVGPath } from '@open-pencil/scene-graph/parse-path'
import { vectorNetworkToSVGPaths } from '@open-pencil/core'
import type { JsonValue } from '@uidx/format'
import type { SceneNode, Stroke, WindingRule, VectorNetwork } from '@open-pencil/scene-graph'
import { strokeEndpointValue } from './stroke-endpoints.js'

/**
 * The authoritative prop mapping (spec §10). Every difference between the UIDX
 * dialect (Figma Plugin API vocabulary) and `SceneNode` lives here and nowhere
 * else.
 *
 * `SceneNode` turned out to be flat and close to Figma's naming, so most props
 * are identity mappings and the table stays small. The deltas below were
 * verified against `@open-pencil/scene-graph@0.14.0` during the Phase 0 spike.
 */
export interface PropMapping {
  /** Attribute name as written in `.uidx`. */
  uidx: string
  /** SceneNode fields this prop reads and writes — used for reverse lookup. */
  sceneFields: readonly (keyof SceneNode)[]
  /** Reads the scene-graph representation from UIDX value(s). */
  toScene: (value: JsonValue) => Partial<SceneNode>
  /** Reads the UIDX value back out of a scene node. Returns undefined if absent. */
  fromScene: (node: Partial<SceneNode>) => JsonValue | undefined
}

/**
 * Props whose UIDX name and SceneNode field coincide and need no conversion.
 *
 * The full triage of `SceneNode` — including everything deliberately excluded
 * and why — lives in `docs/property-vocabulary.md`. Keep the two in step.
 */
export const IDENTITY_PROPS = [
  // identity & geometry
  'name',
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'rotation',
  'x',
  'y',
  // appearance
  'opacity',
  'visible',
  'locked',
  'blendMode',
  'clipsContent',
  'fills',
  'strokes',
  'effects',
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomRightRadius',
  'bottomLeftRadius',
  'cornerSmoothing',
  // strokes
  'strokeCap',
  'strokeJoin',
  'strokeMiterLimit',
  'dashPattern',
  'strokesIncludedInLayout',
  // masking
  'isMask',
  'maskType',
  // auto layout
  'layoutMode',
  'layoutWrap',
  'itemSpacing',
  'counterAxisSpacing',
  'counterAxisAlignContent',
  'itemReverseZIndex',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'paddingBottom',
  // child participation in a parent's auto layout
  'layoutPositioning',
  'layoutGrow',
  // text
  'fontSize',
  'fontFamily',
  'italic',
  // Without this a TEXT node keeps a fixed 100x100 box whatever its glyphs are,
  // because SceneNode.textAutoResize defaults to 'NONE'. Auto-width text is
  // 'WIDTH_AND_HEIGHT'.
  'textAutoResize',
  'textDirection',
  'textAlignHorizontal',
  'textAlignVertical',
  'textCase',
  'textDecoration',
  'textTruncation',
  'maxLines',
  'letterSpacing',
  'lineHeight',
  // ellipse sweep
  'arcData',
] as const

/**
 * Figma exposes named weights, SceneNode stores numbers.
 * `@open-pencil/scene-graph` ships styleToWeight/weightToStyle, but the UIDX
 * surface is deliberately the smaller Figma set.
 */
const FONT_WEIGHTS: Record<string, number> = {
  THIN: 100,
  EXTRA_LIGHT: 200,
  LIGHT: 300,
  REGULAR: 400,
  MEDIUM: 500,
  SEMI_BOLD: 600,
  BOLD: 700,
  EXTRA_BOLD: 800,
  BLACK: 900,
}
const WEIGHT_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(FONT_WEIGHTS).map(([k, v]) => [v, k]),
)

const rename = (uidx: string, scene: keyof SceneNode): PropMapping => ({
  uidx,
  sceneFields: [scene],
  toScene: (value) => ({ [scene]: value }) as Partial<SceneNode>,
  fromScene: (node) => node[scene] as JsonValue | undefined,
})

export const PROP_TABLE: readonly PropMapping[] = [
  // --- renames -----------------------------------------------------------
  rename('primaryAxisAlignItems', 'primaryAxisAlign'),
  rename('counterAxisAlignItems', 'counterAxisAlign'),
  rename('characters', 'text'),
  // Figma calls this layoutAlign on the child; SceneNode spells it out.
  rename('layoutAlign', 'layoutAlignSelf'),
  // Figma exposes per-side stroke weights as strokeTopWeight and friends;
  // SceneNode uses border*. Setting one of these alongside the uniform
  // `strokeWeight` is last-writer-wins in attribute order — documented rather
  // than guarded, since the file is the source of truth and `uidx check` can
  // flag the overlap later.
  rename('strokeTopWeight', 'borderTopWeight'),
  rename('strokeRightWeight', 'borderRightWeight'),
  rename('strokeBottomWeight', 'borderBottomWeight'),
  rename('strokeLeftWeight', 'borderLeftWeight'),

  // --- value conversions -------------------------------------------------
  {
    uidx: 'fontWeight',
    sceneFields: ['fontWeight'],
    toScene: (value) => ({
      fontWeight: typeof value === 'string' ? (FONT_WEIGHTS[value] ?? 400) : Number(value),
    }),
    fromScene: (node) =>
      node.fontWeight === undefined
        ? undefined
        : (WEIGHT_NAMES[node.fontWeight] ?? node.fontWeight),
  },

  // --- sizing ------------------------------------------------------------
  // `layoutMode` alone does not make a frame hug its children: sizing is a
  // separate axis property, defaulting to FIXED. Without these a button frame
  // stays at its default 100x100 no matter what its contents are.
  //
  // Figma spells the values AUTO/FIXED on primaryAxisSizingMode; SceneNode uses
  // HUG/FIXED/FILL. Mapping the mode props (rather than Figma's newer
  // layoutSizingHorizontal/Vertical) keeps the conversion independent of
  // layoutMode, which the axis-absolute spelling would not be.
  ...(['primaryAxisSizingMode', 'counterAxisSizingMode'] as const).map((uidx): PropMapping => {
    const field = (
      uidx === 'primaryAxisSizingMode' ? 'primaryAxisSizing' : 'counterAxisSizing'
    ) as keyof SceneNode
    return {
      uidx,
      sceneFields: [field],
      toScene: (value) => ({ [field]: value === 'AUTO' ? 'HUG' : value }) as Partial<SceneNode>,
      fromScene: (node) => {
        const v = node[field] as string | undefined
        return v === undefined ? undefined : v === 'HUG' ? 'AUTO' : v
      },
    }
  }),

  // --- vector geometry ----------------------------------------------------
  // Spec §3.3 whitelists <Vector> but gave it no way to carry path data, so a
  // vector reserved layout space and painted nothing. `vectorPaths` is Figma's
  // own spelling — an array of `{ windingRule, data }` where `data` is an SVG
  // `d` string — which keeps files readable and stays inside the JSON5 value
  // grammar.
  //
  // Two-way since ADR 0006 §8, which measured what the old one-way note
  // assumed. The note said reconstructing a `d` from a VectorNetwork is lossy
  // and that nothing could originate a geometry change anyway. The second is a
  // scope statement D11 retires; the first is only half true. Round-tripping
  // reaches a *fixed point after one pass* — the normalisation makes a closing
  // line explicit and turns `Q` and `S` into `C` exactly, and the one real
  // approximation, an arc becoming cubics, happens on the way **in** through
  // `parseSVGPath`'s `.unarc()`. Everything a drawing tool produces survives.
  //
  // `vectorPaths` is in VOUCHED_ONLY (`from-scene.ts`) so this can never fire
  // on its own: without that, any unrelated edit to a vector node would
  // re-spell its path, and the normalisation would arrive as format churn
  // nobody asked for. A vector gesture vouches; nothing else writes geometry.
  {
    uidx: 'vectorPaths',
    sceneFields: ['vectorNetwork'],
    toScene: (value) => {
      if (!Array.isArray(value) || value.length === 0) return {}
      const vectorNetwork: VectorNetwork = { vertices: [], segments: [], regions: [] }
      for (const entry of value) {
        const path = entry as { windingRule?: string; data?: string } | null
        if (typeof path?.data !== 'string') continue
        const network = parseSVGPath(path.data, (path.windingRule ?? 'NONZERO') as WindingRule)
        const vertexOffset = vectorNetwork.vertices.length
        const segmentOffset = vectorNetwork.segments.length
        vectorNetwork.vertices.push(...network.vertices)
        vectorNetwork.segments.push(
          ...network.segments.map((segment) => ({
            ...segment,
            start: segment.start + vertexOffset,
            end: segment.end + vertexOffset,
          })),
        )
        vectorNetwork.regions.push(
          ...network.regions.map((region) => ({
            ...region,
            loops: region.loops.map((loop) => loop.map((index) => index + segmentOffset)),
          })),
        )
      }
      return { vectorNetwork }
    },
    fromScene: (node) => {
      const network = node.vectorNetwork
      if (!network || network.segments.length === 0) return undefined
      // An open path has no region and so no winding rule to report; NONZERO is
      // what `toScene` assumes on the way back, which keeps the pair symmetric.
      const paths = vectorNetworkToSVGPaths(network).map((data, index) => ({
        windingRule: network.regions[index]?.windingRule ?? 'NONZERO',
        data,
      }))
      // The SDK serializer emits only regions when any exist. Preserve the
      // unfilled strokes too (a closed icon outline with an open detail).
      if (network.regions.length) {
        const filled = new Set(network.regions.flatMap((region) => region.loops.flat()))
        const segments = network.segments.filter((_, index) => !filled.has(index))
        if (segments.length)
          paths.push(
            ...vectorNetworkToSVGPaths({ vertices: network.vertices, segments, regions: [] }).map(
              (data) => ({ windingRule: 'NONZERO' as const, data }),
            ),
          )
      }
      return paths
    },
  },

  ...(['strokeStartCap', 'strokeEndCap'] as const).map((uidx): PropMapping => ({
    uidx,
    sceneFields: ['vectorNetwork'],
    // Requires the sibling vectorPaths; scenePropsFor composes them after
    // reading all attributes, and interactive edits use withStrokeEndpoints.
    toScene: () => ({}),
    fromScene: (node) => strokeEndpointValue(node, uidx),
  })),

  // --- one UIDX prop <-> several scene fields -----------------------------
  {
    // Figma has one node-level strokeWeight. SceneNode splits it: a per-side
    // weight for layout, plus a `weight` on each Stroke for rendering. Both are
    // written; `composeStrokes` folds the value into the strokes themselves
    // because that needs sibling attributes this signature cannot see.
    uidx: 'strokeWeight',
    sceneFields: [
      'strokes',
      'borderTopWeight',
      'borderRightWeight',
      'borderBottomWeight',
      'borderLeftWeight',
    ],
    toScene: (value) => {
      const w = Number(value)
      return {
        borderTopWeight: w,
        borderRightWeight: w,
        borderBottomWeight: w,
        borderLeftWeight: w,
      }
    },
    fromScene: (node) => {
      const stroke = node.strokes?.[0]
      if (stroke) return stroke.weight
      const {
        borderTopWeight: t,
        borderRightWeight: r,
        borderBottomWeight: b,
        borderLeftWeight: l,
      } = node
      if (t === undefined) return undefined
      // Only collapse back to the single Figma prop when all four agree.
      return t === r && t === b && t === l ? t : undefined
    },
  },
  {
    // Figma and CSS both treat stroke alignment as one decision per box, so the
    // file spells it node-level even though SceneNode stores it per stroke
    // (ADR 0002). Applied by `composeStrokes`.
    uidx: 'strokeAlign',
    sceneFields: ['strokes'],
    toScene: () => ({}),
    fromScene: (node) => node.strokes?.[0]?.align,
  },
  {
    uidx: 'constraints',
    sceneFields: ['horizontalConstraint', 'verticalConstraint'],
    toScene: (value) => {
      const v = (value ?? {}) as { horizontal?: string; vertical?: string }
      return {
        ...(v.horizontal
          ? { horizontalConstraint: v.horizontal as SceneNode['horizontalConstraint'] }
          : {}),
        ...(v.vertical
          ? { verticalConstraint: v.vertical as SceneNode['verticalConstraint'] }
          : {}),
      }
    },
    fromScene: (node) =>
      node.horizontalConstraint === undefined && node.verticalConstraint === undefined
        ? undefined
        : {
            horizontal: node.horizontalConstraint as string,
            vertical: node.verticalConstraint as string,
          },
  },
]

const BY_UIDX = new Map(PROP_TABLE.map((m) => [m.uidx, m]))

export function mappingFor(uidx: string): PropMapping | undefined {
  return BY_UIDX.get(uidx)
}

export function isIdentityProp(uidx: string): boolean {
  return (IDENTITY_PROPS as readonly string[]).includes(uidx)
}

/**
 * A `Fill` in scene-graph requires `opacity` and `visible`; the Figma-shaped
 * literal authors write in `.uidx` carries neither.
 */
export function normalizeFills(value: JsonValue): JsonValue {
  if (!Array.isArray(value)) return value
  return value.map((fill) => {
    if (typeof fill !== 'object' || fill === null || Array.isArray(fill)) return fill
    const f = fill as Record<string, JsonValue>
    return { opacity: 1, visible: true, ...f }
  })
}

export const DEFAULT_STROKE_WEIGHT = 1
/** Figma's strokeAlign getter and the CSS border model agree on this (ADR 0002). */
export const DEFAULT_STROKE_ALIGN = 'INSIDE'

/**
 * Builds scene-graph `Stroke` records from the Figma-shaped `Paint[]` the file
 * carries plus the node-level `strokeWeight` / `strokeAlign`.
 *
 * The two shapes genuinely differ: Figma's `strokes` is `Paint[]` (a `type` and
 * a `color`, no geometry), while `Stroke` folds in `weight`, `align`, `cap`,
 * `join` and `dashPattern` and has no `type` at all. Composing needs sibling
 * attributes, which is why it does not live in a single `PropMapping`.
 *
 * Known limitation: `Stroke` carries only a flat `color`, so gradient and image
 * strokes cannot be represented. Solid strokes only.
 */
export function composeStrokes(
  paints: JsonValue,
  opts: {
    weight?: number
    align?: string
    cap?: JsonValue
    join?: JsonValue
    dashPattern?: JsonValue
  },
): Stroke[] | undefined {
  if (!Array.isArray(paints)) return undefined
  const out: Stroke[] = []
  for (const paint of paints) {
    if (typeof paint !== 'object' || paint === null || Array.isArray(paint)) continue
    // `type` is deliberately dropped: it is part of the Figma Paint shape and
    // has no counterpart on Stroke.
    const { color, opacity, visible } = paint as Record<string, JsonValue>
    out.push({
      color: (color ?? { r: 0, g: 0, b: 0, a: 1 }) as unknown as Stroke['color'],
      weight: opts.weight ?? DEFAULT_STROKE_WEIGHT,
      align: (opts.align ?? DEFAULT_STROKE_ALIGN) as Stroke['align'],
      opacity: typeof opacity === 'number' ? opacity : 1,
      visible: typeof visible === 'boolean' ? visible : true,
      ...(opts.cap !== undefined ? { cap: opts.cap as Stroke['cap'] } : {}),
      ...(opts.join !== undefined ? { join: opts.join as Stroke['join'] } : {}),
      ...(opts.dashPattern !== undefined
        ? { dashPattern: opts.dashPattern as Stroke['dashPattern'] }
        : {}),
    })
  }
  return out
}
