import type { Editor } from 'tldraw'
import { getSnapEnabled, getSnapMode } from './settings'

/** 스냅 타입: 어떤 종류의 스냅이 발생했는지 구분 */
export type SnapType = 'endpoint' | 'midpoint' | 'intersection' | 'perpendicular' | 'extension' | 'angle'

export type SnapPoint = { x: number; y: number; sourceId?: string; snapType?: SnapType }

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
  _intersectionCacheTime = -1
  _snapCache = []
  _lineCache = []
  _intersectionCache = []
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

  const epEnabled = getSnapMode('endpoint')
  const midEnabled = getSnapMode('midpoint')
  if (!epEnabled && !midEnabled) return null

  const endpoints = getWallEndpoints(editor)
  for (const ep of endpoints) {
    if (ep.id === excludeId) continue
    // endpoint
    if (epEnabled) {
      const d1 = Math.hypot(ep.x - point.x, ep.y - point.y)
      if (d1 < bestDist) {
        bestDist = d1
        best = { x: ep.x, y: ep.y, sourceId: ep.id, snapType: 'endpoint' }
      }
    }
    // midpoint
    if (midEnabled) {
      const d2 = Math.hypot(ep.mx - point.x, ep.my - point.y)
      if (d2 < bestDist) {
        bestDist = d2
        best = { x: ep.mx, y: ep.my, sourceId: ep.id, snapType: 'midpoint' }
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

// ── 교차점 스냅: 벽-벽 교차점 ──

type IntersectionPoint = { x: number; y: number; id1: string; id2: string }
let _intersectionCache: IntersectionPoint[] = []
let _intersectionCacheTime = -1

/** 두 선분의 교차점 계산. 교차하지 않으면 null. */
export function lineSegmentIntersection(
  ax1: number, ay1: number, ax2: number, ay2: number,
  bx1: number, by1: number, bx2: number, by2: number,
): { x: number; y: number } | null {
  const dax = ax2 - ax1, day = ay2 - ay1
  const dbx = bx2 - bx1, dby = by2 - by1
  const denom = dax * dby - day * dbx
  if (Math.abs(denom) < 1e-10) return null // 평행 또는 일치

  const t = ((bx1 - ax1) * dby - (by1 - ay1) * dbx) / denom
  const u = ((bx1 - ax1) * day - (by1 - ay1) * dax) / denom

  // 두 선분 범위 내의 교차점만 (약간의 여유)
  if (t < -0.01 || t > 1.01 || u < -0.01 || u > 1.01) return null

  return { x: ax1 + t * dax, y: ay1 + t * day }
}

function getIntersections(editor: Editor): IntersectionPoint[] {
  const now = performance.now()
  if (now - _intersectionCacheTime < 16) return _intersectionCache
  _intersectionCacheTime = now
  _intersectionCache = []

  const walls = getWallLines(editor)
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const a = walls[i], b = walls[j]
      const pt = lineSegmentIntersection(
        a.x, a.y, a.x + a.dx, a.y + a.dy,
        b.x, b.y, b.x + b.dx, b.y + b.dy,
      )
      if (pt) {
        _intersectionCache.push({ x: pt.x, y: pt.y, id1: a.id, id2: b.id })
      }
    }
  }
  return _intersectionCache
}

/** 교차점 스냅: 두 벽의 교차점에 자동 흡착 */
export function snapToIntersection(
  editor: Editor,
  point: { x: number; y: number },
  excludeId?: string,
): SnapPoint | null {
  if (!getSnapMode('intersection')) return null
  const radius = SNAP_RADIUS_PX / editor.getZoomLevel()
  let best: SnapPoint | null = null
  let bestDist = radius

  for (const ip of getIntersections(editor)) {
    if (ip.id1 === excludeId || ip.id2 === excludeId) continue
    const d = Math.hypot(ip.x - point.x, ip.y - point.y)
    if (d < bestDist) {
      bestDist = d
      best = { x: ip.x, y: ip.y, sourceId: ip.id1, snapType: 'intersection' }
    }
  }
  return best
}

// ── 수직 스냅: 시작점에서 벽에 수직인 점 ──

/** 수직 스냅: 시작점에서 벽 선분에 수선을 내린 발. 새로 그리는 벽이 기존 벽과 직교가 됨. */
export function snapToPerpendicular(
  editor: Editor,
  startPoint: { x: number; y: number },
  point: { x: number; y: number },
  excludeId?: string,
): SnapPoint | null {
  if (!getSnapMode('perpendicular')) return null
  const radius = SNAP_RADIUS_PX / editor.getZoomLevel()
  let best: SnapPoint | null = null
  let bestDist = radius

  for (const w of getWallLines(editor)) {
    if (w.id === excludeId) continue
    // 시작점에서 벽 직선에 수선의 발 = 벽 위의 점 P, 이때 (startPoint -> P) ⊥ (wall direction)
    const t = ((startPoint.x - w.x) * w.dx + (startPoint.y - w.y) * w.dy) / (w.len * w.len)
    // 벽 선분 범위 내로 클램프
    const tc = Math.max(0, Math.min(1, t))
    const px = w.x + tc * w.dx
    const py = w.y + tc * w.dy
    // 커서가 이 수선발 근처에 있는지 확인
    const d = Math.hypot(point.x - px, point.y - py)
    if (d < bestDist) {
      bestDist = d
      best = { x: px, y: py, sourceId: w.id, snapType: 'perpendicular' }
    }
  }
  return best
}

// ── 연장 스냅: 벽 연장선 위의 점 ──

const EXTENSION_RADIUS_PX = 10

/** 연장 스냅: 벽 선분의 연장선(양 방향)에 커서가 가까우면 스냅 */
export function snapToExtension(
  editor: Editor,
  point: { x: number; y: number },
  excludeId?: string,
): SnapPoint | null {
  if (!getSnapMode('extension')) return null
  const radius = EXTENSION_RADIUS_PX / editor.getZoomLevel()
  let best: SnapPoint | null = null
  let bestDist = radius

  for (const w of getWallLines(editor)) {
    if (w.id === excludeId) continue
    // 무한 직선 위의 투영 파라미터
    const t = ((point.x - w.x) * w.dx + (point.y - w.y) * w.dy) / (w.len * w.len)
    // 선분 내부(0~1)는 건너뜀 — 연장선만 처리
    if (t >= 0 && t <= 1) continue
    // 연장은 최대 2배 길이까지만 허용 (너무 먼 연장은 무의미)
    if (t < -1 || t > 2) continue
    const px = w.x + t * w.dx
    const py = w.y + t * w.dy
    const d = Math.hypot(point.x - px, point.y - py)
    if (d < bestDist) {
      bestDist = d
      best = { x: px, y: py, sourceId: w.id, snapType: 'extension' }
    }
  }
  return best
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
 * Shared point resolution for draw tools (wall/dimension): snap priority is
 * endpoint > intersection > perpendicular > extension > orthogonal angle.
 * Returns resolved point with snap type info.
 */
export function resolveDrawPoint(
  editor: Editor,
  startPoint: { x: number; y: number } | null,
  excludeId?: string,
): SnapPoint {
  const point = editor.inputs.currentPagePoint

  // 1. 끝점/중간점 스냅 (최고 우선순위)
  const epSnap = snapToWallEndpoint(editor, point, excludeId)
  if (epSnap) return epSnap

  // 2. 교차점 스냅
  const intSnap = snapToIntersection(editor, point, excludeId)
  if (intSnap) return intSnap

  // 3. 수직 스냅 (시작점이 있을 때만)
  if (startPoint) {
    const perpSnap = snapToPerpendicular(editor, startPoint, point, excludeId)
    if (perpSnap) return perpSnap
  }

  // 4. 연장 스냅
  const extSnap = snapToExtension(editor, point, excludeId)
  if (extSnap) return extSnap

  // 5. 직교 각도 스냅 (폴백)
  const orthoOn = getSnapEnabled() !== editor.inputs.shiftKey
  if (startPoint && orthoOn) {
    const v = snapAngle(point.x - startPoint.x, point.y - startPoint.y)
    return { x: startPoint.x + v.x, y: startPoint.y + v.y, snapType: 'angle' }
  }
  return { x: point.x, y: point.y }
}
