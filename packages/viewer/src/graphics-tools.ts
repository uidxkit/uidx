import { isCreatable, type CreatableElement } from '@uidx/schema'
import { sweptRect, type Point, type Rect } from './gesture-model'
import { vertexAt, type PenVertex } from './pen-model'

export const GRAPHIC_SHAPES = ['Line', 'Arrow', 'Polygon', 'Star'] as const
export type GraphicShape = (typeof GRAPHIC_SHAPES)[number]
export type DrawingTool = CreatableElement | GraphicShape | 'Pencil'

export function isGraphicShape(tool: string): tool is GraphicShape {
  return (GRAPHIC_SHAPES as readonly string[]).includes(tool)
}

export function isDrawingTool(tool: string): tool is DrawingTool {
  return isCreatable(tool) || isGraphicShape(tool) || tool === 'Pencil'
}

export const GRAPHICS_TOOLS = [
  { tool: 'Vector', label: 'Pen', key: 'P', icon: 'M2 10l1-4 5-5 3 3-5 5zM3 6l3 3M8 1l3 3' },
  { tool: 'Pencil', label: 'Pencil', key: 'Shift+P', icon: 'M2 8l6-6 2 2-6 6-3 1zM7 3l2 2' },
  { tool: 'Line', label: 'Line', key: 'L', icon: 'M2 10L10 2' },
  { tool: 'Arrow', label: 'Arrow', key: 'Shift+L', icon: 'M2 10L10 2M4 2h6v6' },
  { tool: 'Polygon', label: 'Polygon', key: '', icon: 'M6 1l5 9H1z' },
  {
    tool: 'Star',
    label: 'Star',
    key: '',
    icon: 'M6 1l1.5 3 3.5.5-2.5 2.4.6 3.5L6 8.8l-3.1 1.6.6-3.5L1 4.5 4.5 4z',
  },
] as const

export function drawingHint(tool: string | null | undefined): string | null {
  if (tool === 'Vector')
    return 'Pen · Click to add points, drag for curves. Click the first point to close. Enter to finish · Esc to cancel.'
  if (tool === 'Pencil')
    return 'Pencil · Drag to draw a freehand path. Release to finish · Esc to cancel.'
  if (tool === 'Line' || tool === 'Arrow')
    return `${tool} · Drag from start to end. Shift snaps the angle · Alt draws from the center.`
  if (tool && ['Polygon', 'Star', 'Rectangle', 'Ellipse'].includes(tool))
    return `${tool} · Drag to draw. Shift keeps proportions · Alt draws from the center.`
  return null
}

export interface DrawModifiers {
  shiftKey?: boolean
  altKey?: boolean
}

export function drawingBounds(start: Point, end: Point, modifiers: DrawModifiers = {}): Rect {
  let dx = end.x - start.x
  let dy = end.y - start.y
  if (modifiers.shiftKey) {
    const side = Math.max(Math.abs(dx), Math.abs(dy))
    dx = (dx < 0 ? -1 : 1) * side
    dy = (dy < 0 ? -1 : 1) * side
  }
  const from = modifiers.altKey ? { x: start.x - dx, y: start.y - dy } : start
  return sweptRect(from, { x: start.x + dx, y: start.y + dy })
}

/** Presets are ordinary editable paths; there is no second graphics file format. */
export function graphicShape(
  tool: GraphicShape,
  start: Point,
  end: Point,
  modifiers: DrawModifiers = {},
): { vertices: PenVertex[]; closed: boolean } {
  if (tool === 'Line' || tool === 'Arrow') {
    let dx = end.x - start.x
    let dy = end.y - start.y
    if (modifiers.shiftKey) {
      const length = Math.hypot(dx, dy)
      const angle = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI) / 4
      dx = length * Math.cos(angle)
      dy = length * Math.sin(angle)
    }
    const from = modifiers.altKey ? { x: start.x - dx, y: start.y - dy } : start
    const to = { x: start.x + dx, y: start.y + dy }
    const points = [from, to]
    return { vertices: points.map((p) => vertexAt(p, null)), closed: false }
  }
  const box = drawingBounds(start, end, modifiers)
  const count = tool === 'Star' ? 10 : 3
  const vertices = Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / count
    const radius = tool === 'Star' && i % 2 ? 0.45 : 1
    return vertexAt(
      {
        x: box.x + box.width / 2 + ((Math.cos(angle) * box.width) / 2) * radius,
        y: box.y + box.height / 2 + ((Math.sin(angle) * box.height) / 2) * radius,
      },
      null,
    )
  })
  return { vertices, closed: true }
}

/** Iterative Ramer–Douglas–Peucker: bounded stack, preserving sharp corners. */
export function simplifyPencil(points: readonly Point[], tolerance: number): PenVertex[] {
  if (points.length < 3) return points.map((p) => vertexAt(p, null))
  const keep = new Set([0, points.length - 1])
  const ranges = [[0, points.length - 1]]
  while (ranges.length) {
    const [first, last] = ranges.pop()!
    const a = points[first!]!
    const b = points[last!]!
    const dx = b.x - a.x,
      dy = b.y - a.y
    const length = dx * dx + dy * dy
    let far = -1,
      distance = tolerance * tolerance
    for (let i = first! + 1; i < last!; i++) {
      const p = points[i]!
      const t = length
        ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
        : 0
      const d = (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2
      if (d > distance) {
        far = i
        distance = d
      }
    }
    if (far !== -1) {
      keep.add(far)
      ranges.push([first!, far], [far, last!])
    }
  }
  return [...keep].sort((a, b) => a - b).map((i) => vertexAt(points[i]!, null))
}
