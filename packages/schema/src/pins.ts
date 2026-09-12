import { DEFAULT_ROOT_FONT_SIZE, lengthToPx, aliasTarget, type JsonValue } from '@uidx/format'
/**
 * The pin arithmetic (ADR 0011 §2), as pure functions over plain numbers.
 *
 * Deliberately free of `SceneGraph` and `UidxNode`. This is the half of pins
 * that has to be exercised exhaustively, and a test that needs a graph built
 * before it can check a subtraction is a test nobody writes enough of.
 * `resolvePins` in `pin-pass.ts` is the half that walks a tree, and it calls
 * this one.
 *
 * Not a constraint solver, despite the name Figma uses. Every child resolves
 * against a parent size that is already final, so there are no cycles, no
 * simultaneous equations and no iteration to a fixed point — one subtraction
 * per axis, under a single top-down walk.
 */

export type PinAxis = 'MIN' | 'CENTER' | 'MAX' | 'STRETCH'

export interface Pin {
  horizontal: PinAxis
  vertical: PinAxis
  right?: number
  bottom?: number
  centerX?: number
  centerY?: number
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

const AXES: readonly string[] = ['MIN', 'CENTER', 'MAX', 'STRETCH']
const OFFSETS = ['right', 'bottom', 'centerX', 'centerY'] as const

/**
 * The pin a node's attributes state, or undefined when it states none.
 *
 * Typed against `{ value: unknown }` rather than `UidxAttr` so callers can hand
 * it a shim, the way `authorship.ts` types `GeometryNode` structurally and for
 * the same reason: a predicate a test cannot call is one that gets duplicated.
 *
 * An offset with no constraint still produces a pin — `MIN` plus a `right`,
 * which is exactly the file UIDX134 refuses. Answering "unpinned" here would
 * make the resolver quietly agree with a file the checker calls wrong.
 *
 * `SCALE` reads as `MIN` rather than as itself: it is out of v1 (ADR 0011 §3)
 * and `uidx check` refuses it, so the resolver's job is to leave such a node
 * where it was rather than to invent a behaviour for a value it cannot honour.
 */
export function pinFrom(
  attrs: Record<string, { value: unknown }> | undefined,
  rootFontSize = DEFAULT_ROOT_FONT_SIZE,
  resolveAlias?: (address: string) => JsonValue | undefined,
): Pin | undefined {
  if (!attrs) return undefined

  const raw = attrs.constraints?.value
  const stated =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}

  const axis = (key: 'horizontal' | 'vertical'): PinAxis => {
    const value = stated[key]
    return typeof value === 'string' && AXES.includes(value) ? (value as PinAxis) : 'MIN'
  }

  const pin: Pin = { horizontal: axis('horizontal'), vertical: axis('vertical') }
  for (const key of OFFSETS) {
    const value = attrs[key]?.value
    const target = value === undefined ? null : aliasTarget(value as JsonValue)
    const px = lengthToPx(target === null ? value : resolveAlias?.(target), rootFontSize)
    if (px !== null) pin[key] = px
  }

  const unpinned =
    pin.horizontal === 'MIN' &&
    pin.vertical === 'MIN' &&
    OFFSETS.every((key) => pin[key] === undefined)
  return unpinned ? undefined : pin
}

/**
 * One axis, so the two can never drift apart. `near` and `size` are the pair
 * the file authored; `far` and `centre` are the offsets it may have stated
 * instead.
 */
function resolveAxis(
  constraint: PinAxis,
  near: number,
  size: number,
  far: number,
  centre: number,
  parent: number,
): { near: number; size: number } {
  switch (constraint) {
    case 'MAX':
      return { near: parent - far - size, size }
    case 'STRETCH':
      // A parent narrower than its own offsets would otherwise produce a
      // negative box, which the renderer draws inside-out — a child that
      // covers its parent rather than disappearing.
      return { near, size: Math.max(0, parent - near - far) }
    case 'CENTER':
      return { near: (parent - size) / 2 + centre, size }
    default:
      return { near, size }
  }
}

/** The concrete box a pinned child occupies inside a parent of this size. */
export function resolvedBox(pin: Pin, box: Box, parent: { width: number; height: number }): Box {
  const h = resolveAxis(
    pin.horizontal,
    box.x,
    box.width,
    pin.right ?? 0,
    pin.centerX ?? 0,
    parent.width,
  )
  const v = resolveAxis(
    pin.vertical,
    box.y,
    box.height,
    pin.bottom ?? 0,
    pin.centerY ?? 0,
    parent.height,
  )
  return { x: h.near, y: v.near, width: h.size, height: v.size }
}

/**
 * What a settled edit writes for a pinned node — the inverse of `resolvedBox`.
 *
 * Lived in the viewer while only the panel converted; moved here when
 * `fromSceneChange` became a caller, because a gesture's settled geometry has
 * to become offsets *in the filter*, where every scene write already passes.
 *
 * A gesture says everything it means, in one envelope: switching an axis from
 * MIN to MAX writes `right` *and* removes `x`, so the child does not jump and
 * the file never holds both (UIDX134). Rounded, because a converted offset is
 * a number a person then reads and scrubs.
 */
export interface PinWrites {
  /** Attributes to write, in the file's vocabulary. */
  fields: Record<string, number>
  /** Attributes to take out of the file in the same envelope. */
  removals: string[]
}

export type PinAxisName = 'horizontal' | 'vertical'

const BOTH: readonly PinAxisName[] = ['horizontal', 'vertical']

/** One axis, named by the props it may write, so the two cannot drift apart. */
function axisWrites(
  constraint: PinAxis,
  near: number,
  size: number,
  parent: number,
  props: { near: string; far: string; centre: string; size: string },
  precision: number,
): PinWrites {
  const round = (n: number): number => Number(n.toFixed(precision))
  const offsets = [props.near, props.far, props.centre]
  /** Everything this constraint does not state, so it leaves the file with it. */
  const others = (...written: string[]): string[] =>
    offsets.filter((name) => !written.includes(name))

  switch (constraint) {
    case 'MAX':
      return {
        fields: { [props.far]: round(parent - near - size) },
        removals: others(props.far),
      }
    case 'STRETCH':
      return {
        fields: { [props.near]: round(near), [props.far]: round(parent - near - size) },
        // The size is the pin's answer now, so the file must stop stating it.
        removals: [...others(props.near, props.far), props.size],
      }
    case 'CENTER':
      return {
        fields: { [props.centre]: round(near + size / 2 - parent / 2) },
        removals: others(props.centre),
      }
    default:
      return { fields: { [props.near]: round(near) }, removals: others(props.near) }
  }
}

/**
 * `axes` is which axes the caller actually changed, and defaults to both.
 *
 * Converting an axis nobody touched rewrites a line the author did not edit —
 * and re-derives it from a measured box, so any staleness in the measurement
 * corrupts an axis the gesture had nothing to do with. Reported live, as a
 * horizontal pin change that moved an element's bottom.
 */
export function pinWrites(
  pin: Pin,
  box: Box,
  parent: { width: number; height: number },
  axes: readonly PinAxisName[] = BOTH,
  precision = 0,
): PinWrites {
  const out: PinWrites = { fields: {}, removals: [] }

  if (axes.includes('horizontal')) {
    const written = axisWrites(
      pin.horizontal,
      box.x,
      box.width,
      parent.width,
      {
        near: 'x',
        far: 'right',
        centre: 'centerX',
        size: 'width',
      },
      precision,
    )
    Object.assign(out.fields, written.fields)
    out.removals.push(...written.removals)
  }

  if (axes.includes('vertical')) {
    const written = axisWrites(
      pin.vertical,
      box.y,
      box.height,
      parent.height,
      {
        near: 'y',
        far: 'bottom',
        centre: 'centerY',
        size: 'height',
      },
      precision,
    )
    Object.assign(out.fields, written.fields)
    out.removals.push(...written.removals)
  }

  return out
}
