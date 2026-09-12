import type { JsonValue, UidxNode } from '@uidx/format'

/**
 * What flipping the absolute-position toggle commits (Figma parity, following
 * C10a's `resize-writes` pattern of a gesture saying everything it means).
 *
 * Figma pins a node the moment it escapes the flow: it stays exactly where the
 * layout last put it, and moves only when the author does. So ABSOLUTE writes
 * the node's current x/y in the same commit — without them the file would hold
 * an absolute child with no position, which lands at 0,0 on the next load.
 *
 * AUTO is the reverse: position is the layout's again, so the pinned numbers
 * leave the file with the flip. Left behind they would be worse than dead —
 * `fromSceneChange` keeps existing attributes current, so every reflow would
 * write computed geometry over what the author once chose (D4's exact no).
 */
export interface PositioningWrites {
  /** Scene writes for one `updateNode`, vouched as one authored commit. */
  fields: Record<string, JsonValue>
  /** Attributes to remove from the file in the same envelope. */
  removals: ('x' | 'y')[]
}

export function positioningWrites(
  position: { x: number; y: number },
  value: 'ABSOLUTE' | 'AUTO',
  docNode: UidxNode | null,
): PositioningWrites {
  if (value === 'ABSOLUTE') {
    return {
      fields: { layoutPositioning: 'ABSOLUTE', x: position.x, y: position.y },
      removals: [],
    }
  }
  return {
    fields: { layoutPositioning: 'AUTO' },
    removals: (['x', 'y'] as const).filter((prop) => docNode?.attrs[prop] !== undefined),
  }
}
