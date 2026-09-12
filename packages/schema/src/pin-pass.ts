import { computeAllLayouts } from '@open-pencil/core/layout'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { addressDepth, isWithin } from '@uidx/format'

import type { PinMap } from './pin-index.js'
import { resolvedBox } from './pins.js'

/**
 * Applies every pin under `entityId`, top-down (ADR 0011 §4).
 *
 * Top-down is not a preference. A `STRETCH` child's resolved width is what its
 * *own* pinned children measure against, so a parent has to be final before its
 * children are asked — which is also what makes this a single pass with no
 * iteration and no fixed point to converge on.
 *
 * **The one way to make this expensive** is to re-run layout for the whole
 * subtree after each pinned node resolves: that is quadratic in the child count
 * and invisible until a page is large. So layout re-runs only under a node
 * whose size actually moved, and only where there is something to reflow.
 * `pin-budget.test.ts` is what keeps that true.
 *
 * Called from `layOutEntity` rather than by anyone directly, so that laying out
 * without resolving is not a thing a caller can do.
 */
/**
 * Resolves every pinned node inside `entityId` against its parent's size.
 *
 * Driven by the pin index rather than by a walk of the subtree: a page's nodes
 * are thousands and its pinned ones are a handful, and this runs after every
 * incremental apply. Scene ids are addresses (ADR 0003), so "inside the
 * entity" is a prefix test and depth ordering is a separator count — a pinned
 * parent has to resolve before a pinned child, because the child is measured
 * against the size the parent just took.
 */
export function resolvePins(graph: SceneGraph, entityId: string, pins: PinMap): void {
  const inside: string[] = []
  for (const id of pins.ids()) {
    if (entityId === '' || id === entityId || isWithin(entityId, id)) inside.push(id)
  }
  if (inside.length === 0) return
  inside.sort((a, b) => addressDepth(a) - addressDepth(b))

  for (const childId of inside) {
    const child = graph.getNode(childId)
    if (!child?.parentId) continue
    const parent = graph.getNode(child.parentId)
    if (!parent) continue
    const pin = pins.pinOf(childId)
    if (!pin) continue

    const next = resolvedBox(
      pin,
      { x: child.x, y: child.y, width: child.width, height: child.height },
      { width: parent.width, height: parent.height },
    )
    const resized = next.width !== child.width || next.height !== child.height
    graph.updateNode(childId, next)
    if (resized && (child.childIds?.length ?? 0) > 0) computeAllLayouts(graph, childId)
  }
}
