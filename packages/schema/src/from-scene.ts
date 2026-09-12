import {
  LENGTH_PROPS,
  rootFontSizeOf,
  hasLengthUnits,
  preserveLengthUnit,
  isUnitLength,
  lengthToPx,
} from '@uidx/format'
import { resolve, type UidxDocument, type UidxPatch, type JsonValue, isAlias } from '@uidx/format'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import {
  IDENTITY_PROPS,
  isIdentityProp,
  mappingFor,
  normalizeFills,
  PROP_TABLE,
} from './prop-table.js'
import {
  hasAuthoredGeometry,
  isDerivedPosition,
  isDerivedSize,
  isPinnedAxis,
} from './authorship.js'
import type { PinMap } from './pin-index.js'
import { pinFrom, pinWrites, type PinAxisName } from './pins.js'
import type { AddressMap } from './to-scene.js'

export interface ChangeContext {
  doc: UidxDocument
  graph: SceneGraph
  addresses: AddressMap
  /**
   * Props this change is known to have been authored by a person (story C7).
   *
   * D4 asks "did a human decide this?" and answers with a heuristic, because
   * a reflow burst carries no authorship. A panel edit does carry it, so it
   * says so, and the derived-geometry check steps aside for exactly the props
   * named — never for the reflow that follows in the same burst.
   */
  authored?: ReadonlySet<string>
  /**
   * The scene id `authored` speaks for. One edit reflows its parent and its
   * children, and those arrive as their own changes in the same burst —
   * vouching for them would write computed geometry into the file, which is
   * exactly what D4 exists to prevent. Absent: the signal applies to nothing.
   */
  authoredFor?: string
  /**
   * Which node carries which pin (ADR 0011).
   *
   * Optional, and absent means "nothing is pinned" — which is every caller
   * written before H1, and every document that never states a constraint. When
   * it is absent the node's own attributes answer instead, so a caller holding
   * only a document is still told the truth.
   */
  pins?: PinMap
}

const POSITION_PROPS = new Set(['x', 'y'])
const SIZE_PROPS = new Set(['width', 'height'])

/**
 * Props that only ever reach the file when a gesture vouches for them.
 *
 * The position and size filters above ask whether a *value* was computed; this
 * asks whether the write was *intended* at all, which is a stronger question
 * and the right one for geometry that round-trips through a normalising
 * conversion. `vectorPaths` is spelled one way in the file and another after
 * `parseSVGPath`/`vectorNetworkToSVGPaths` have been through it (ADR 0006 §8),
 * so an unvouched write would re-spell every vector node touched for any other
 * reason — format churn arriving from an edit that had nothing to do with the
 * path. Only D11's pen and D12's vertex drag may say a path changed.
 */
const VOUCHED_ONLY = new Set(['vectorPaths', 'strokeStartCap', 'strokeEndCap'])

/** Reverse index: SceneNode field -> UIDX prop names that read it. */
const BY_SCENE_FIELD = new Map<string, Set<string>>()
for (const mapping of PROP_TABLE) {
  for (const field of mapping.sceneFields) {
    const set = BY_SCENE_FIELD.get(field) ?? new Set<string>()
    set.add(mapping.uidx)
    BY_SCENE_FIELD.set(field, set)
  }
}
for (const prop of IDENTITY_PROPS) {
  const set = BY_SCENE_FIELD.get(prop) ?? new Set<string>()
  set.add(prop)
  BY_SCENE_FIELD.set(prop, set)
}

/**
 * Translates a scene-graph mutation into patches.
 *
 * Returns an empty array — deliberately, not exceptionally — for anything the
 * scene graph derived rather than the author writing: nodes absent from the
 * bimap (instance children, see findings §4c) and layout-computed geometry.
 */
export function fromSceneChange(
  sceneId: string,
  changes: Partial<SceneNode>,
  ctx: ChangeContext,
): UidxPatch[] {
  const address = ctx.addresses.addressOf(sceneId)
  // Not authored: generated instance children and anything else the SDK made.
  if (address === undefined) return []

  const node = resolve(ctx.doc.tree, address)
  if (!node) return []

  // ADR 0005 §5: a `<Variant>`'s geometry is generated — its position by
  // `arrangeVariants` and its size by hugging its child — so a reflow burst
  // carrying either is the layout talking, not the author. It has no legal
  // attribute beyond its coordinates either, which is why this is the whole
  // node rather than the geometry props alone: any patch here would produce a
  // file `uidx check` rejects.
  if (!hasAuthoredGeometry(node.element)) return []

  const sceneNode = ctx.graph.getNode(sceneId)
  if (!sceneNode) return []

  const rootFontSize = rootFontSizeOf(ctx.doc)
  const positionDerived = isDerivedPosition(ctx.graph, sceneNode)
  // From the document, never from the scene node: the offsets have no scene
  // field to read (ADR 0011 §2), and C7 already paid for asking a node that a
  // gesture in flight had already moved.
  const pin = ctx.pins?.pinOf(sceneId) ?? pinFrom(node.attrs, rootFontSize)

  const candidates = new Set<string>()
  for (const field of Object.keys(changes)) {
    for (const prop of BY_SCENE_FIELD.get(field) ?? []) candidates.add(prop)
  }

  const patches: UidxPatch[] = []

  /*
   * A geometry write on a pinned axis is converted, not dropped (ADR 0011).
   *
   * A drag settles as `updateNode({x, y})` — the coordinate language — and on
   * a pinned axis the file speaks offsets. H1 dropped those writes, which made
   * a drag half-work: the unpinned axis landed and the pinned one snapped
   * back. The settled box against the parent's edges *is* the new offset, so
   * that is what leaves.
   *
   * No vouch is needed to tell a gesture from a reflow, and that is the
   * pleasant surprise: the resolve pass puts the node exactly where the
   * offsets already say, so converting a reflow round-trips to the stored
   * numbers and the equality check below emits nothing. A gesture is a no-op
   * of that same arithmetic only when it changed nothing.
   */
  if (pin) {
    const parent = sceneNode.parentId ? ctx.graph.getNode(sceneNode.parentId) : undefined
    const axes: PinAxisName[] = []
    if ((candidates.has('x') || candidates.has('width')) && pin.horizontal !== 'MIN') {
      axes.push('horizontal')
    }
    if ((candidates.has('y') || candidates.has('height')) && pin.vertical !== 'MIN') {
      axes.push('vertical')
    }
    if (parent && axes.length) {
      const writes = pinWrites(
        pin,
        { x: sceneNode.x, y: sceneNode.y, width: sceneNode.width, height: sceneNode.height },
        { width: parent.width, height: parent.height },
        axes,
        Object.values(node.attrs).some((attr) => isUnitLength(attr.value) || isAlias(attr.value))
          ? 6
          : 0,
      )
      // The converted axes leave the per-prop loop; a size on a non-STRETCH
      // axis stays, because it is still the author's plain number there.
      for (const axis of axes) {
        candidates.delete(axis === 'horizontal' ? 'x' : 'y')
        if (pin[axis] === 'STRETCH') candidates.delete(axis === 'horizontal' ? 'width' : 'height')
      }
      for (const prop of writes.removals) {
        if (node.attrs[prop] !== undefined) patches.push({ op: 'remove', address, prop })
      }
      for (const [prop, px] of Object.entries(writes.fields)) {
        const existing = node.attrs[prop]
        if (existing) {
          const resolved = isAlias(existing.value)
            ? pin[prop as keyof typeof pin]
            : lengthToPx(existing.value, rootFontSize)
          if (typeof resolved === 'number' && Math.abs(resolved - px) < 0.000001) continue
          if (
            isAlias(existing.value) &&
            !(
              ctx.authoredFor === sceneId &&
              (ctx.authored?.has('x') || ctx.authored?.has('y') || ctx.authored?.has(prop))
            )
          )
            continue
        }
        const value = preserveLengthUnit(px, existing?.value, rootFontSize)
        if (existing === undefined) patches.push({ op: 'add', address, prop, value })
        else if (existing.value !== value) patches.push({ op: 'set', address, prop, value })
      }
    }
  }
  for (const prop of candidates) {
    const existing = node.attrs[prop]

    // Never write computed geometry. For *size*, an authored attribute still
    // tracks the scene — the author wrote the number, keeping it current is
    // what they asked for. For *position* the parent owns the answer outright:
    // a flowed child's x/y can linger in the file from an earlier life (a pin
    // since released, a hand-written source), and an unvouched change to them
    // is by definition the layout engine talking — every gesture that could
    // say otherwise is refused on a flowed child. Measured live: the reflow
    // after releasing an absolute-position pin re-announced its computed x one
    // revision behind the flip, and "keep it current" wrote it back.
    const vouched = ctx.authoredFor === sceneId && ctx.authored?.has(prop) === true
    if (!vouched) {
      // An alias in the file is a binding, and the scene only ever holds what
      // it resolved to. For geometry the comparison "file !== scene" is then
      // always true, which is how the layout engine came to write
      // `width={1456}` over `{layout#doc-inner}` on 413 nodes of one page.
      // Geometry only: text typed on the canvas over a `{label}` binding is a
      // gesture, and the layout engine never announces text.
      if (
        existing &&
        isAlias(existing.value) &&
        (SIZE_PROPS.has(prop) || POSITION_PROPS.has(prop))
      ) {
        continue
      }
      if (existing && hasLengthUnits(prop, existing.value)) {
        if (!SIZE_PROPS.has(prop) && !POSITION_PROPS.has(prop)) continue
        if (SIZE_PROPS.has(prop) && isDerivedSize(sceneNode, prop as 'width' | 'height', ctx.graph))
          continue
      }
      if (VOUCHED_ONLY.has(prop)) continue
      if (POSITION_PROPS.has(prop)) {
        if (positionDerived) continue
        // A pinned axis is the pass's answer, not the author's — and unlike a
        // flowed child, this is per axis: a horizontal pin says nothing about y.
        if (isPinnedAxis(pin, prop as 'x' | 'y')) continue
      }
      if (SIZE_PROPS.has(prop)) {
        // No `!existing` guard on the pinned branch, on purpose. Under STRETCH
        // a `width` in the file is illegal (UIDX134), so an existing one is a
        // file being corrected rather than a number to keep current.
        if (isPinnedAxis(pin, prop as 'width' | 'height')) continue
        if (!existing && isDerivedSize(sceneNode, prop as 'width' | 'height', ctx.graph)) continue
      }
    }

    const mapping = mappingFor(prop)
    let next = mapping
      ? mapping.fromScene(sceneNode)
      : isIdentityProp(prop)
        ? ((sceneNode as unknown as Record<string, unknown>)[prop] as JsonValue | undefined)
        : undefined
    if (next === undefined) continue
    if (typeof next === 'number' && LENGTH_PROPS.has(prop)) {
      next = preserveLengthUnit(next, existing?.value, rootFontSize)
    }

    if (!existing) {
      patches.push({ op: 'add', address, prop, value: next })
    } else if (!deepEqual(comparable(prop, existing.value), comparable(prop, next))) {
      patches.push({ op: 'set', address, prop, value: next })
    }
  }
  return patches
}

/**
 * The shape a value is compared in. The scene carries fills and strokes with
 * the defaults `normalizeFills` added on the way in (`opacity: 1`,
 * `visible: true`) while the author may have written only `{ type, color }` —
 * comparing those raw shapes calls the difference an edit and rewrites
 * untouched nodes with normalization noise. Equal once both sides are
 * normalized means equal.
 */
function comparable(prop: string, value: JsonValue): JsonValue {
  return prop === 'fills' || prop === 'strokes' ? normalizeFills(value) : value
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  return ka.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  )
}
