import type { Box } from '@uidx/schema'

/**
 * The conversion itself lives in `@uidx/schema` now — `fromSceneChange`
 * became a caller when gestures learned to speak offsets, and the schema
 * cannot import the viewer. This file keeps the viewer-side shape and the
 * import path the panel already uses.
 */
export { pinWrites, type PinAxisName, type PinWrites } from '@uidx/schema'

/**
 * A node's resolved box and the box it is pinned inside — what the canvas
 * measures and hands the panel. The panel cannot work either out for itself:
 * a pinned node's coordinate is the resolve pass's answer and appears in no
 * attribute, and the parent's size is whatever layout settled on. Measured by
 * the canvas, like `ExportBounds`.
 */
export interface PinFrame {
  box: Box
  parent: { width: number; height: number }
}
