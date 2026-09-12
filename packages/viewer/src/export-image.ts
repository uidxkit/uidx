/**
 * An export is a question answered once, not a setting kept.
 *
 * Everything here is the arithmetic and the naming around a render — the
 * render itself belongs to the canvas, which is the only pane holding a scene
 * graph and a Skia renderer. Keeping the two apart is what lets the panel
 * state a pixel count and a file name without owning either.
 *
 * Nothing in this module writes to the document. A layer carries no export
 * list: the format and the scale live for as long as the question is open.
 */

/** The three the writer can produce, and nothing else. */
export type ExportFormat = 'PNG' | 'JPEG' | 'SVG'

export const EXPORT_FORMATS: readonly ExportFormat[] = ['PNG', 'JPEG', 'SVG']

/** What `computeContentBounds` returns: visual extent, strokes and effects in. */
export interface ExportBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface PixelSize {
  width: number
  height: number
}

/** One answered question: which node, in what shape, under what name. */
export interface ExportRequest {
  address: string
  format: ExportFormat
  scale: number
  fileName: string
}

/**
 * The panel's range for a scale, which is not the format's.
 *
 * `@open-pencil/scene-graph` clamps at 1024 because that is what a `.fig` file
 * may legally carry, and clamping there stops a malformed import from
 * allocating a canvas that kills the tab. A number typed into a field is a
 * different boundary: 4x is the largest multiplier that is a real answer to
 * "how big do you want this", and everything above it is a typo.
 */
const MIN_SCALE = 0.01
const MAX_SCALE = 4

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/**
 * The pixels the file will actually be.
 *
 * `Math.ceil`, because that is what `renderNodesToImage` does — a readout that
 * rounded to nearest would be wrong by a pixel on most fractional scales, and
 * a number beside a button is a promise about the file the button writes.
 */
export function pixelSizeFor(bounds: ExportBounds, scale: number): PixelSize | null {
  const width = Math.ceil((bounds.maxX - bounds.minX) * scale)
  const height = Math.ceil((bounds.maxY - bounds.minY) * scale)
  return width > 0 && height > 0 ? { width, height } : null
}

const EXTENSION: Record<ExportFormat, string> = { PNG: 'png', JPEG: 'jpg', SVG: 'svg' }

const MIME: Record<ExportFormat, string> = {
  PNG: 'image/png',
  JPEG: 'image/jpeg',
  SVG: 'image/svg+xml',
}

export function mimeTypeFor(format: ExportFormat): string {
  return MIME[format]
}

/** As much of a scene graph as finding a page needs. */
export interface NodeLookup {
  getNode(id: string): { id: string; type: string; parentId?: string | null } | undefined
}

/**
 * The page a node sits on, which is not always the page that is open.
 *
 * `renderNodesToImage` throws when the nodes it is given do not all belong to
 * the page id beside them, so the walk has to start from the node. The SDK has
 * this walk — `findPageId` — but keeps it behind its `io` barrel, which
 * re-exports `extractExportGraph` and not this. Eight lines are cheaper than
 * reaching into an unpublished path that may move between releases.
 */
export function pageIdFor(graph: NodeLookup, nodeId: string): string | null {
  let current = graph.getNode(nodeId)
  while (current) {
    // Asked about a page, the answer is that page. The SDK's own walk starts at
    // the parent and so answers null here, which is a surprise rather than a
    // rule — a page is trivially the page its content renders on.
    if (current.type === 'CANVAS') return current.id
    if (!current.parentId) return null
    current = graph.getNode(current.parentId)
  }
  return null
}

/**
 * The word Skia knows, or nothing for the format it does not rasterise.
 *
 * `renderNodesToImage` maps its format argument through a switch whose
 * `default` is PNG, so a spelling it does not recognise is not an error — it
 * is PNG bytes in a file named `.jpg`. The panel says JPEG because that is the
 * format's name; the renderer is told JPG because that is what it answers to.
 */
export function rasterFormatFor(format: ExportFormat): 'PNG' | 'JPG' | null {
  if (format === 'SVG') return null
  return format === 'JPEG' ? 'JPG' : 'PNG'
}

/**
 * The file name, which the button says out loud before it writes it.
 *
 * A slash in a layer name is a component path (`Button/Primary`), not a
 * directory — a browser handed one in a `download` attribute drops everything
 * before it, so the file would arrive called `Primary.png` and two components
 * in different folders would collide. Flattening keeps the name whole.
 *
 * An SVG never carries the multiplier: it has no pixels to multiply, so a
 * `@2x` on one would name a difference that is not in the file.
 */
export function fileNameFor(name: string, format: ExportFormat, scale: number): string {
  const flat = name.replace(/[/\\]/g, '-').trim()
  const stem = flat === '' ? 'layer' : flat
  const suffix = format === 'SVG' || scale === 1 ? '' : `@${scale}x`
  return `${stem}${suffix}.${EXTENSION[format]}`
}

/**
 * Hand the bytes to the browser.
 *
 * An anchor rather than a `File System Access` save dialog: the viewer is
 * served over plain http in development, where the picker is unavailable, and
 * a download that works everywhere beats one that works in one browser.
 */
export function downloadFile(data: Uint8Array | string, fileName: string, mime: string): void {
  const blob = new Blob([data as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    URL.revokeObjectURL(url)
  }
}
