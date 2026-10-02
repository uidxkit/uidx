import { instanceDefinition, instancePreview, tupleAt } from '@uidx/schema'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import type { JsonValue, UidxAttr, UidxNode } from '@uidx/format'
import type { InstanceScope } from './resize-writes'

/**
 * The frame inside an instance, drawn live while its size or its outer box is
 * a preview.
 *
 * A component with a styles table draws inside a variant wrapper, on a frame
 * that carries the instance's size (`pinnedFrame` in to-scene) and its outer
 * box (`boxTargetOf`, ADR 0018 §2). Only a build or the file's echo put either
 * there, so a resize on page1's Button1 moved the selection box to 266 on
 * every pointer move and left the pill at 160, sliding with the wrapper, until
 * the echo — when it jumped. A width typed into the panel did the same, and a
 * fill scrubbed in the panel painted the wrapper instead: a square box behind
 * the pill.
 *
 * What moves is asked of the echo's own rules (`instancePreview`: the
 * instance's own node, the frame by `wrappedFrameUpdate`, and the texts its
 * colour reaches), with the instance as the gesture would leave the file and
 * its tokens in the modes it is drawn in, so the preview and the echo cannot
 * disagree.
 */

/**
 * What a preview states on an instance before the file does: a size and the
 * fills it lets go of to have it (`releasedFills`), and the outer box and text
 * colour a panel scrub restyles (ADR 0018 §7), each as the file would hold it.
 */
export interface InstanceFraming {
  size: { width?: number; height?: number }
  removals: readonly string[]
  box?: Readonly<Record<string, JsonValue>>
}

/**
 * The instance as the file will hold it once `framing` is written: `saved`
 * stating each dimension in the size and each value in the box, without the
 * fills the size lets go of. Nothing reads it but the scene build's helpers,
 * which take `value`.
 */
export function framedInstance(saved: UidxNode, framing: InstanceFraming): UidxNode {
  const attrs: Record<string, UidxAttr> = {}
  for (const key in saved.attrs) if (!framing.removals.includes(key)) attrs[key] = saved.attrs[key]!
  for (const [prop, value] of Object.entries({ ...framing.size, ...framing.box })) {
    if (value === undefined) continue
    attrs[prop] = {
      name: prop,
      value,
      raw: typeof value === 'string' ? JSON.stringify(value) : `{${JSON.stringify(value)}}`,
      loc: saved.loc,
      valueLoc: saved.loc,
    }
  }
  return { ...saved, attrs }
}

/**
 * `scope` as the build reads it at the instance at `address` in `tree`: a
 * token resolves in the modes in force there, an enclosing frame's and the
 * instance's own (ADR 0018 §5), the tuple the echo's `update-instance-root`
 * carries. Bound as the build's `withModes` binds it: a token address from
 * the tuple's values, anything else from `scope`. Without a token index, or a
 * tree to read the modes from, every token is at its first mode, as before.
 */
function scopeAt(
  scope: InstanceScope,
  tree: UidxNode | null | undefined,
  address: string,
): InstanceScope {
  const tokens = scope.tokens
  if (!tokens || !tree) return scope
  const values = tokens.resolver.resolve(tupleAt(tree, address, tokens.index))
  const base = scope.resolveAlias
  return {
    ...scope,
    resolveAlias: (alias) => (alias.includes('#') ? values.get(alias) : base?.(alias)),
  }
}

export interface WrappedFrame {
  /**
   * Draws the instance as the file would hold it once `framing` is written,
   * or as `saved`, the file, holds it now for null: its own node, the frame
   * inside it and the texts its colour reaches, wherever one moves. `id` is
   * where it is drawn — its address, but for a use in a slot fill where the
   * definition puts it (ADR 0007 §3). Called inside the caller's preview
   * scope, before its own write to the instance, if any; nothing it moves
   * reaches the file either way.
   */
  draw(saved: UidxNode, framing: InstanceFraming | null, id?: string): void
  /**
   * Puts back what a preview left drawn away from the file. Runs before a
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
  /** The file's tree, where the modes in force at an instance are read (`scopeAt`). */
  tree?: () => UidxNode | null
  /** The editor's write, which lays out what it moved. */
  update: (id: string, props: Partial<SceneNode>) => void
  /** The texts an instance's colour reaches, by where it is drawn (`SceneResult.textTargets`). */
  textTargets?: (id: string) => readonly string[] | undefined
}): WrappedFrame {
  /** The instance drawn away from the file: its address, and the version drawn, at its scene id. */
  let drawnFor: { address: string; instance: UidxNode } | null = null

  /**
   * From what is drawn for `drawn` to what is drawn for `next`: one instance,
   * drawn at `next.address`, written at `address` in the file.
   */
  const move = (drawn: UidxNode, next: UidxNode, address: string): void => {
    const graph = context.graph()
    const node = graph.getNode(next.address)
    if (!node) return
    const parentLayout = node.parentId ? graph.getNode(node.parentId)?.layoutMode : undefined
    const scope = scopeAt(context.scope(), context.tree?.(), address)
    const updates = instancePreview(
      drawn,
      next,
      instanceDefinition(next, scope),
      scope,
      parentLayout,
      context.textTargets?.(next.address),
    )
    for (const update of updates ?? [])
      if (graph.getNode(update.id)) context.update(update.id, update.props)
  }

  const release = (): void => {
    const held = drawnFor
    drawnFor = null
    const now = held ? context.saved(held.address) : null
    if (held && now?.element === 'Instance') {
      const at = { ...now, address: held.instance.address }
      context.graph().runPreviewUpdates(() => move(held.instance, at, held.address))
    }
  }

  return {
    draw(saved, framing, id = saved.address) {
      // A preview left on another instance goes back before this one moves.
      if (drawnFor && drawnFor.address !== saved.address) release()
      const now = { ...saved, address: id }
      const next = framing ? framedInstance(now, framing) : now
      move(drawnFor?.instance ?? now, next, saved.address)
      drawnFor = framing ? { address: saved.address, instance: next } : null
    },
    release,
    settle() {
      drawnFor = null
    },
  }
}
