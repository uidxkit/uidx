import type { JsonValue, UidxDocument, UidxNode } from './types.js'

/**
 * Image references, per ADR 0006 (story D8, the image half).
 *
 * A raster cannot live in a text file, so it is referenced: an image paint
 * carries a `src` that is a path relative to the directory holding
 * `uidx.json`. This module owns two things about that path — what makes one
 * *well formed*, and where they all are in a document — because three callers
 * need both: `uidx check` fails a build on a bad one, the server refuses to
 * serve one, and the viewer decides what to draw.
 *
 * What it deliberately does not own is whether the file *exists* or whether the
 * manifest *declared* its folder. Both are questions about a filesystem, and
 * this package has none.
 */

/**
 * Where artwork lives when `uidx.json` does not say.
 *
 * Three, not one, because there is no single convention: a repo keeps artwork
 * in `assets/`, or splits it into `images/` and `icons/`, and both are
 * ordinary. Defaulting to one would make the others a configuration step for
 * something nobody thinks of as configuration (ADR 0006 §3).
 */
export const DEFAULT_ASSET_GLOBS: readonly string[] = ['assets/**', 'images/**', 'icons/**']

/** One image paint's reference, and enough to say where it was written. */
export interface AssetRef {
  address: string
  /** Always `fills`; see `PAINT_PROPS`. */
  prop: string
  /** Which entry of that paint stack. */
  index: number
  src: string
}

/**
 * Why this `src` cannot be used, in the author's terms — or null if it is fine.
 *
 * The constraints are ADR 0006 §3's, and each has a reason a person can act on
 * rather than a rule number. A remote URL is refused rather than fetched: G7's
 * no-network rule is not negotiable for the renderer, and a contract that only
 * draws when a host is up is not one.
 */
export function assetPathProblem(src: string): string | null {
  if (src === '') return 'an image needs a "src"'
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(src) || src.startsWith('//')) {
    return `"${src}" is a URL; images are files in this document, not fetched at render time`
  }
  if (src.startsWith('/')) {
    return `"${src}" is an absolute path; a "src" is relative to uidx.json so the document travels`
  }
  if (src.includes('\\')) {
    return `"${src}" uses backslashes; a "src" is written with "/" on every platform`
  }
  if (src.split('/').includes('..')) {
    return `"${src}" reaches outside the document; a "src" may not contain ".."`
  }
  return null
}

/** Whether this paint is an image reference rather than a solid or gradient. */
function imageSrc(paint: JsonValue): string | null {
  if (typeof paint !== 'object' || paint === null || Array.isArray(paint)) return null
  const record = paint as Record<string, JsonValue>
  if (record.type !== 'IMAGE') return null
  return typeof record.src === 'string' ? record.src : ''
}

/**
 * Fills only.
 *
 * Figma allows an image stroke; this scene graph does not. Measured: `Stroke`
 * carries a flat `color` and no image field at all, and `composeStrokes` says
 * so itself — "gradient and image strokes cannot be represented. Solid strokes
 * only." Scanning `strokes` here would mean validating the path of a reference
 * that can never draw, which reads as support rather than as the gap it is.
 * ADR 0006 §1 says fills, and this is why.
 */
const PAINT_PROPS = ['fills'] as const

/**
 * Every image reference in a document, in document order.
 *
 * Reads the attribute values rather than the scene graph, because the callers
 * that matter — `check` and the server — have a parsed document and no graph,
 * and because the file is what declares the reference.
 */
export function assetRefs(doc: UidxDocument): AssetRef[] {
  const found: AssetRef[] = []
  const walk = (node: UidxNode): void => {
    for (const prop of PAINT_PROPS) {
      const value = node.attrs[prop]?.value
      if (!Array.isArray(value)) continue
      value.forEach((paint, index) => {
        const src = imageSrc(paint)
        if (src !== null) found.push({ address: node.address, prop, index, src })
      })
    }
    node.children.forEach(walk)
  }
  walk(doc.tree)
  return found
}
