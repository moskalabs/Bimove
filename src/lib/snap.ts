import type { Editor } from 'tldraw'
import { getSnapEnabled } from './settings'

export type SnapPoint = { x: number; y: number; sourceId?: string }

/** Screen-space snap radius in px; converted to page units via current zoom. */
const SNAP_RADIUS_PX = 12

// ── Wall endpoint cache: 프레임당 1회만 수집 ──
type WallEndpoint = { x: number; y: number; mx: number; my: number; id: string }
let _snapCache: WallEndpoint[] = []
let _snapCacheTime = -1

/** 테스트용: 캐시 초기화 */
export function _resetSnapCache() {
  _snapCacheTime = -1
  _lineCacheTime = -1
  _snapCache = []
  _lineCache = []
}

function getWallEndpoints(editor: Editor): WallEndpoint[] {
  const now = performance.now()
  if (now - _snapCacheTime < 16) return _snapCache  // 같은 프레임 내 캐시 재사용
  _snapCacheTime = now
  _snapCache = []
  for (const shape of editor.getCurrentPageShapes()) {
    if (shape.type !== 'wall') continue
    const props = shape.props as { x2: number; y2: number }
    _snapCache.push({
      x: shape.x,
      y: shape.y,
      mx: shape.x + props.x2 / 2,
      my: shape.y + props.y2 / 2,
      id: shape.id,
    })
    _snapCache.push({
      x: shape.x + props.x2,
      y: shape.y + props.y2,
      mx: shape.x + props.x2 / 2,
      my: shape.y + props.y2 / 2,
      id: shape.id,
    })
  }
  return _snapCache
}

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

  const endpoints = getWallEndpoints(editor)
  for (const ep of endpoints) {
    if (ep.id === excludeId) continue
    // endpoint 자체
    const d1 = Math.hypot(ep.x - point.x, ep.y - point.y)
    if (d1 < bestDist) {
      bestDist = d1
      best = { x: ep.x, y: ep.y, sourceId: ep.id }
    }
    // midpoint (첫 endpoint에만 체크 — 중복 방지)
    const d2 = Math.hypot(ep.mx - point.x, ep.my - point.y)
    if (d2 < bestDist) {
      bestDist = d2
      best = { x: ep.mx, y: ep.my, sourceId: ep.id }
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

// ── Wall line cache: 프레임당 1회만 수집 ──
type WallLine = { x: number; y: number; dx: number; dy: number; len: number; thickness: number; id: string }
let _lineCache: WallLine[] = []
let _lineCacheTime = -1

function getWallLines(editor: Editor): WallLine[] {
  const now = performance.now()
  if (now - _lineCacheTime < 16) return _lineCache
  _lineCacheTime = now
  _lineCache = []
  for (const shape of editor.getCurrentPageShapes()) {
    if (shape.type !== 'wall') continue
    const props = shape.props as { x2: number; y2: number; thickness: number }
    const len = Math.hypot(props.x2, props.y2)
    if (len < 1) continue
    _lineCache.push({
      x: shape.x, y: shape.y,
      dx: props.x2, dy: props.y2,
      len, thickness: props.thickness, id: shape.id,
    })
  }
  return _lineCache
}

export function snapToWallLine(
  editor: Editor,
  point: { x: number; y: number },
): WallLineSnap | null {
  const radius = WALL_LINE_RADIUS_PX / editor.getZoomLevel()

  for (const w of getWallLines(editor)) {
    const t = Math.max(0, Math.min(1,
      ((point.x - w.x) * w.dx + (point.y - w.y) * w.dy) / (w.len * w.len),
    ))
    const px = w.x + t * w.dx
    const py = w.y + t * w.dy
    if (Math.hypot(point.x - px, point.y - py) <= radius) {
      return {
        x: px,
        y: py,
        angle: Math.atan2(w.dy, w.dx),
        thickness: w.thickness,
        wallId: w.id,
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

/**
 * Shared point resolution for draw tools (wall/dimension): endpoint snap takes
 * priority, then orthogonal angle snap — on by default, Shift inverts it.
 */
export function resolveDrawPoint(
  editor: Editor,
  startPoint: { x: number; y: number } | null,
  excludeId?: string,
): { x: number; y: number } {
  const point = editor.inputs.currentPagePoint
  const snapped = snapToWallEndpoint(editor, point, excludeId)
  if (snapped) return { x: snapped.x, y: snapped.y }

  const orthoOn = getSnapEnabled() !== editor.inputs.shiftKey
  if (startPoint && orthoOn) {
    const v = snapAngle(point.x - startPoint.x, point.y - startPoint.y)
    return { x: startPoint.x + v.x, y: startPoint.y + v.y }
  }
  return { x: point.x, y: point.y }
}
