import svgpath from 'svgpath'
import type { JsonValue } from '@uidx/format'

/** Always scale the saved geometry, so scrubbing and drag previews cannot compound. */
export function resizeVectorPaths(
  paths: JsonValue,
  from: { width: number; height: number },
  to: { width: number; height: number },
): JsonValue | null {
  if (
    !Array.isArray(paths) ||
    ![from.width, from.height, to.width, to.height].every(Number.isFinite)
  )
    return null
  const sx = from.width === 0 ? 1 : to.width / from.width
  const sy = from.height === 0 ? 1 : to.height / from.height
  return paths.map((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      typeof entry.data !== 'string'
    )
      return entry
    return { ...entry, data: svgpath(entry.data).scale(sx, sy).round(4).toString() }
  })
}
