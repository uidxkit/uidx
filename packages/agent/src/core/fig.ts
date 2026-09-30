import type { UidxDocument, UidxNode } from '@uidx/format'
import { buildTokenIndex, resolveTokenValues, toSceneGraph, TokenResolver } from '@uidx/schema'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'

/**
 * The document as Figma files (backlog F2, first slice): one `.fig` per page,
 * drawn by the same scene build the canvas uses — derived variant sets,
 * instances of components on other pages, tokens resolved to their values,
 * model samples in repeats. One file per page because scene ids are the
 * page's own addresses, which two pages may share.
 *
 * Not yet carried: tokens as Figma variables (values arrive resolved), and
 * the component-set properties Figma builds from `state=hover` names.
 */
export async function exportFig(
  docs: ReadonlyMap<string, UidxDocument>,
): Promise<Map<string, Uint8Array>> {
  const all = [...docs.values()]
  const index = buildTokenIndex(all)
  const literals = resolveTokenValues(all)
  const components = new Map<string, UidxNode>()
  for (const doc of all)
    for (const child of doc.tree.children)
      if (child.element === 'Component') components.set(child.name, child)
  const out = new Map<string, Uint8Array>()
  for (const [file, doc] of docs) {
    if (doc.tree.element !== 'Page') continue
    const scene = toSceneGraph(doc, {
      resolveAlias: (address) => literals.get(address),
      resolveComponent: (name) => components.get(name),
      tokens: { resolver: new TokenResolver(index), index },
    })
    out.set(file.replace(/\.uidx$/, '.fig'), await exportFigFile(scene.graph))
  }
  return out
}
