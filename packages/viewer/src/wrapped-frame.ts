import { instanceDefinition, wrappedFrameUpdate } from '@uidx/schema'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import type { UidxAttr, UidxNode } from '@uidx/format'
import type { InstanceScope } from './resize-writes'

/**
 * The frame inside an instance, drawn live while its size is a preview.
 *
 * A component with a styles table draws inside a variant wrapper, on a frame
 * that carries the instance's size (`pinnedFrame` in to-scene). Only a build
 * or the file's echo put the size there, so a resize on page1's Button1 moved
 * the selection box to 266 on every pointer move and left the pill at 160,
 * sliding with the wrapper, until the echo — when it jumped. A width typed
 * into the panel did the same.
 *
 * The rule for what the frame gets is the echo's own (`wrappedFrameUpdate`),
 * asked with the instance as the gesture would leave the file, so the preview
 * and the echo cannot disagree.
 */

/** A size a preview gives an instance, and the fills it lets go of to have it (`releasedFills`). */
export interface InstanceFraming {
  size: { width?: number; height?: number }
  removals: readonly string[]
}

/**
 * The instance as the file will hold it once `framing` is written: `saved`
 * stating each dimension in the size, without the fills the size lets go of.
 * Nothing reads it but the scene build's helpers, which take `value`.
 */
export function sizedInstance(saved: UidxNode, framing: InstanceFraming): UidxNode {
  const attrs: Record<string, UidxAttr> = {}
  for (const key in saved.attrs) if (!framing.removals.includes(key)) attrs[key] = saved.attrs[key]!
  for (const dimension of ['width', 'height'] as const) {
    const value = framing.size[dimension]
    if (value === undefined) continue
    attrs[dimension] = {
      name: dimension,
      value,
      raw: `{${value}}`,
      loc: saved.loc,
      valueLoc: saved.loc,
    }
  }
  return { ...saved, attrs }
}

/**
 * What the frame an instance's component wraps must be given to be drawn for
 * `next` rather than for `drawn` — two versions of the same instance. Null
 * when the component wraps no such frame: one that lays itself out *is* the
 * instance's root, which the preview already sizes.
 */
export function wrappedFramePreview(
  drawn: UidxNode,
  next: UidxNode,
  scope: InstanceScope,
  parentLayout?: SceneNode['layoutMode'],
): { id: string; props: Partial<SceneNode> } | null {
  const definition = instanceDefinition(next, scope)
  if (!definition) return null
  return wrappedFrameUpdate(
    next.address,
    { instance: drawn, definition },
    { instance: next, definition },
    scope,
    parentLayout,
  )
}

export interface WrappedFrame {
  /**
   * Draws the frame inside `saved` as the file would once `framing` is
   * written, or as the file is now for null. Called inside the caller's
   * preview scope, before its own write to the instance; the frame is
   * generated, so nothing it is given reaches the file either way.
   */
  draw(saved: UidxNode, framing: InstanceFraming | null): void
  /**
   * Puts back a frame a preview left drawn away from the file. Runs before a
   * new document lands, so the diff meets the scene the file drew.
   */
  release(): void
  /** Forgets what the frame is drawn for, moving nothing: a commit's echo makes that same update. */
  settle(): void
}

export function createWrappedFrame(context: {
  graph: () => SceneGraph
  scope: () => InstanceScope
  /** How the file states an instance now. */
  saved: (address: string) => UidxNode | null
  /** The editor's write, which lays out what it moved. */
  update: (id: string, props: Partial<SceneNode>) => void
}): WrappedFrame {
  /** The instance whose frame is drawn away from the file, and the version it is drawn for. */
  let drawnFor: { address: string; instance: UidxNode } | null = null

  const move = (drawn: UidxNode, next: UidxNode): void => {
    const graph = context.graph()
    const node = graph.getNode(next.address)
    if (!node) return
    const parentLayout = node.parentId ? graph.getNode(node.parentId)?.layoutMode : undefined
    const update = wrappedFramePreview(drawn, next, context.scope(), parentLayout)
    if (update && graph.getNode(update.id)) context.update(update.id, update.props)
  }

  const release = (): void => {
    const held = drawnFor
    drawnFor = null
    const now = held ? context.saved(held.address) : null
    if (held && now?.element === 'Instance') {
      context.graph().runPreviewUpdates(() => move(held.instance, now))
    }
  }

  return {
    draw(saved, framing) {
      // A preview left on another instance goes back before this one moves.
      if (drawnFor && drawnFor.address !== saved.address) release()
      const next = framing ? sizedInstance(saved, framing) : saved
      move(drawnFor?.instance ?? saved, next)
      drawnFor = framing ? { address: saved.address, instance: next } : null
    },
    release,
    settle() {
      drawnFor = null
    },
  }
}
