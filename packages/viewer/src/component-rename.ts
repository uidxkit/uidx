import type { UidxDocument, UidxNode, UidxPatch } from '@uidx/format'
import { renameComponent, type DependentsIndex, type RefactorPlan } from '@uidx/schema'

/**
 * Component rename on the refactor engine (spec §14).
 *
 * The rail's rename is an ordinary `set name` patch, and for a frame that is
 * the whole story. For a component with instances it used to be a footgun the
 * symbols band could only diagnose — every `component="…"` across the
 * document went stale. This helper watches the one choke point every rail
 * patch passes through: a batch that is exactly one set-name on an
 * instantiated `<Component>` becomes the engine's multi-file plan (behind the
 * shell's confirm); anything else stays on the direct path, zero-dependent
 * components included.
 */
export function componentRenamePlan(
  pages: ReadonlyMap<string, UidxDocument>,
  deps: DependentsIndex,
  patches: readonly UidxPatch[],
): RefactorPlan | null {
  if (patches.length !== 1) return null
  const patch = patches[0]!
  if (patch.op !== 'set' || patch.prop !== 'name' || typeof patch.value !== 'string') return null
  if (!isComponent(pages, patch.address)) return null
  if ((deps.ofComponent.get(patch.address) ?? []).length === 0) return null
  return renameComponent(pages, deps, patch.address, patch.value)
}

/** A top-level component's address is its bare name, so one scan answers it. */
function isComponent(pages: ReadonlyMap<string, UidxDocument>, address: string): boolean {
  for (const doc of pages.values()) {
    if (doc.tree.element === 'Tokens') continue
    for (const node of doc.tree.children) {
      if (node.element === 'Component' && node.name === address) return true
    }
  }
  return false
}

/**
 * What the instance picker offers (spec §12): every component that is not
 * deprecated. Existing instances of a deprecated one keep rendering — the
 * badge is about new work, not old.
 */
export function offerableComponents(components: ReadonlyMap<string, UidxNode>): string[] {
  return [...components.entries()]
    .filter(([, node]) => node.attrs.deprecated?.value !== true)
    .map(([name]) => name)
}
