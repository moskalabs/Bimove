import type { Editor } from 'tldraw'

export type SnapPoint = { x: number; y: number; sourceId?: string }

/** Screen-space snap radius in px; converted to page units via current zoom. */
const SNAP_RADIUS_PX = 12

/**
 * Collect every wall endpoint on the current page (start + end), excluding the
 * shape currently being drawn, and return the nearest one within snap range of
 * `point`. Returns null when nothing is close enough.
 */
export function snapToWallEndpoint(
  editor: Editor,
  point: { x: number; y: number },
  excludeId?: string,
): SnapPoint | null {
  const radius = SNAP_RADIUS_PX / editor.getZoomLevel()
  let best: SnapPoint | null = null
  let bestDist = radius

  for (const shape of editor.getCurrentPageShapes()) {
    if (shape.type !== 'wall' || shape.id === excludeId) continue
    const props = shape.props as { x2: number; y2: number }
    const candidates = [
      { x: shape.x, y: shape.y },
      { x: shape.x + props.x2, y: shape.y + props.y2 },
      { x: shape.x + props.x2 / 2, y: shape.y + props.y2 / 2 },
    ]
    for (const pt of candidates) {
      const d = Math.hypot(pt.x - point.x, pt.y - point.y)
      if (d < bestDist) {
        bestDist = d
        best = { x: pt.x, y: pt.y, sourceId: shape.id }
      }
    }
  }
  return best
}

/** Snap the pointer onto the nearest wall centerline. Returns the projected point + wall info. */
export type WallLineSnap = {
  x: number
  y: number
  angle: number      // wall direction in radians
  thickness: number
  wallId: string
}

const WALL_LINE_RADIUS_PX = 20

export function snapToWallLine(
  editor: Editor,
  point: { x: number; y: number },
): WallLineSnap | null {
  const radius = WALL_LINE_RADIUS_PX / editor.getZoomLevel()

  for (const shape of editor.getCurrentPageShapes()) {
    if (shape.type !== 'wall') continue
    const props = shape.props as { x2: number; y2: number; thickness: number }
    const dx = props.x2, dy = props.y2
    const len = Math.hypot(dx, dy)
    if (len < 1) continue

    const t = Math.max(0, Math.min(1,
      ((point.x - shape.x) * dx + (point.y - shape.y) * dy) / (len * len),
    ))
    const px = shape.x + t * dx
    const py = shape.y + t * dy
    if (Math.hypot(point.x - px, point.y - py) <= radius) {
      return {
        x: px,
        y: py,
        angle: Math.atan2(dy, dx),
        thickness: props.thickness,
        wallId: shape.id,
      }
    }
  }
  return null
}

/** Snap a direction vector to the nearest 15° increment, preserving length. */
export function snapAngle(dx: number, dy: number, stepDeg = 15): { x: number; y: number } {
  const len = Math.hypot(dx, dy)
  if (len < 1) return { x: dx, y: dy }
  const step = (stepDeg * Math.PI) / 180
  const angle = Math.round(Math.atan2(dy, dx) / step) * step
  return { x: Math.cos(angle) * len, y: Math.sin(angle) * len }
}
