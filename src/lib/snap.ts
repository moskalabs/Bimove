import type { Editor } from 'tldraw'
import { getSnapEnabled, getSnapMode } from './settings'

/** 스냅 타입: 어떤 종류의 스냅이 발생했는지 구분 */
export type SnapType = 'endpoint' | 'midpoint' | 'edge' | 'intersection' | 'perpendicular' | 'extension' | 'angle' | 'turn'

export type SnapPoint = { x: number; y: number; sourceId?: string; snapType?: SnapType }

/** Screen-space snap radius in px; converted to page units via current zoom. */
const SNAP_RADIUS_PX = 12

// ── Wall endpoint cache: 프레임당 1회만 수집 ──
type WallEndpoint = { x: number; y: number; mx: number; my: number; id: string; edge?: boolean }
let _snapCache: WallEndpoint[] = []
let _snapCacheTime = -1
let _snapDiagLogged = false

/** 테스트용: 캐시 초기화 */
export function _resetSnapCache() {
  _snapCacheTime = -1
  _lineCacheTime = -1
  _snapCache = []
  _lineCache = []
  _snapDiagLogged = false
}

/** dxfgroup pathData에서 끝점 추출: "M0,5L100,5 M0,50L100,50" → [{x1,y1,x2,y2}, ...] */
export function parseDxfPathEndpoints(pathData: string): { x1: number; y1: number; x2: number; y2: number }[] {
  const segs: { x1: number; y1: number; x2: number; y2: number }[] = []
  const re = /M([\d.e+-]+),([\d.e+-]+)\s*L([\d.e+-]+),([\d.e+-]+)/gi
  let m
  while ((m = re.exec(pathData)) !== null) {
    segs.push({ x1: parseFloat(m[1]), y1: parseFloat(m[2]), x2: parseFloat(m[3]), y2: parseFloat(m[4]) })
  }
  return segs
}

function getWallEndpoints(editor: Editor): WallEndpoint[] {
  const now = performance.now()
  if (now - _snapCacheTime < 16) return _snapCache  // 같은 프레임 내 캐시 재사용
  _snapCacheTime = now
  _snapCache = []
  let wallCount = 0
  let dxfCount = 0
  let dxfSegCount = 0
  for (const shape of editor.getCurrentPageShapes()) {
    if (shape.type === 'wall') {
      wallCount++
      const props = shape.props as { x2: number; y2: number; thickness: number }
      // getShapePageTransform: 그룹/회전 포함 정확한 page 좌표 변환
      const mat = editor.getShapePageTransform(shape)
      const s = mat.applyToPoint({ x: 0, y: 0 })
      const e = mat.applyToPoint({ x: props.x2, y: props.y2 })
      const mid = { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 }
      // 중심선 끝점
      _snapCache.push({ x: s.x, y: s.y, mx: mid.x, my: mid.y, id: shape.id })
      _snapCache.push({ x: e.x, y: e.y, mx: mid.x, my: mid.y, id: shape.id })
      // 양쪽 엣지 끝점 (두께 고려)
      const half = (props.thickness ?? 10) / 2
      const dx = e.x - s.x, dy = e.y - s.y
      const len = Math.hypot(dx, dy)
      if (len > 1) {
        const nx = -dy / len * half, ny = dx / len * half // 수직 방향
        // 왼쪽 엣지 끝점 2개
        _snapCache.push({ x: s.x + nx, y: s.y + ny, mx: mid.x + nx, my: mid.y + ny, id: shape.id, edge: true })
        _snapCache.push({ x: e.x + nx, y: e.y + ny, mx: mid.x + nx, my: mid.y + ny, id: shape.id, edge: true })
        // 오른쪽 엣지 끝점 2개
        _snapCache.push({ x: s.x - nx, y: s.y - ny, mx: mid.x - nx, my: mid.y - ny, id: shape.id, edge: true })
        _snapCache.push({ x: e.x - nx, y: e.y - ny, mx: mid.x - nx, my: mid.y - ny, id: shape.id, edge: true })
      }
    } else if (shape.type === 'dxfgroup') {
      dxfCount++
      // DXF 그룹: pathData에서 각 선분의 시작/끝점 추출
      const pathData = (shape.props as Record<string, unknown>).pathData
      if (!pathData || typeof pathData !== 'string') continue
      const segs = parseDxfPathEndpoints(pathData)
      dxfSegCount += segs.length
      const mat = editor.getShapePageTransform(shape)
      for (const seg of segs) {
        const s = mat.applyToPoint({ x: seg.x1, y: seg.y1 })
        const e = mat.applyToPoint({ x: seg.x2, y: seg.y2 })
        _snapCache.push({
          x: s.x, y: s.y,
          mx: (s.x + e.x) / 2, my: (s.y + e.y) / 2,
          id: shape.id,
        })
        _snapCache.push({
          x: e.x, y: e.y,
          mx: (s.x + e.x) / 2, my: (s.y + e.y) / 2,
          id: shape.id,
        })
      }
    }
  }
  // 진단: 첫 호출 시 1회 로그 (브라우저 콘솔에서 확인)
  if (!_snapDiagLogged && _snapCache.length > 0) {
    _snapDiagLogged = true
    console.debug(`[snap] endpoints: ${_snapCache.length} (wall: ${wallCount}, dxfgroup: ${dxfCount}, dxfSegs: ${dxfSegCount})`)
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
  // **모드를 여기서 거른다.** 예전엔 종류를 가리지 않고 가장 가까운 점 하나를
  // 돌려주고, 부른 쪽에서 "그 종류가 꺼져 있으면 버리는" 식이었다. 그래서
  // 끝점을 꺼두면, 커서가 중간점보다 끝점에 조금이라도 가까울 때 **켜져 있는
  // 중간점까지 같이 사라졌다.**
  const wantEnd = getSnapMode('endpoint')
  const wantMid = getSnapMode('midpoint')
  if (!wantEnd && !wantMid) return null

  const radius = SNAP_RADIUS_PX / editor.getZoomLevel()
  let best: SnapPoint | null = null
  let bestDist = radius

  const endpoints = getWallEndpoints(editor)

  // 패스 1: 중심선 끝점/중간점 (우선순위 높음)
  for (const ep of endpoints) {
    if (ep.id === excludeId || ep.edge) continue
    if (wantEnd) {
      const d1 = Math.hypot(ep.x - point.x, ep.y - point.y)
      if (d1 < bestDist) {
        bestDist = d1
        best = { x: ep.x, y: ep.y, sourceId: ep.id, snapType: 'endpoint' }
      }
    }
    if (wantMid) {
      const d2 = Math.hypot(ep.mx - point.x, ep.my - point.y)
      if (d2 < bestDist) {
        bestDist = d2
        best = { x: ep.mx, y: ep.my, sourceId: ep.id, snapType: 'midpoint' }
      }
    }
  }

  // 패스 2: 두께 쪽(엣지) 점 — 중심선 스냅이 없을 때만.
  //
  // 끝점과 중간점을 **각각의 토글에 맞춰** 본다. 둘 다 'edge' 로 내보내던 때는
  // 중간점을 꺼도 엣지의 중간점이 그대로 걸렸다.
  if (!best) {
    for (const ep of endpoints) {
      if (ep.id === excludeId || !ep.edge) continue
      if (wantEnd) {
        const d1 = Math.hypot(ep.x - point.x, ep.y - point.y)
        if (d1 < bestDist) {
          bestDist = d1
          best = { x: ep.x, y: ep.y, sourceId: ep.id, snapType: 'edge' }
        }
      }
      if (wantMid) {
        const d2 = Math.hypot(ep.mx - point.x, ep.my - point.y)
        if (d2 < bestDist) {
          bestDist = d2
          best = { x: ep.mx, y: ep.my, sourceId: ep.id, snapType: 'edge' }
        }
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
    if (shape.type === 'wall') {
      const props = shape.props as { x2: number; y2: number; thickness: number }
      const mat = editor.getShapePageTransform(shape)
      const s = mat.applyToPoint({ x: 0, y: 0 })
      const e = mat.applyToPoint({ x: props.x2, y: props.y2 })
      const dx = e.x - s.x, dy = e.y - s.y
      const len = Math.hypot(dx, dy)
      if (len < 1) continue
      _lineCache.push({
        x: s.x, y: s.y,
        dx, dy, len, thickness: props.thickness, id: shape.id,
      })
    } else if (shape.type === 'dxfgroup') {
      const pathData = (shape.props as Record<string, unknown>).pathData
      if (!pathData || typeof pathData !== 'string') continue
      const thickness = ((shape.props as Record<string, unknown>).thickness as number) ?? 2
      const segs = parseDxfPathEndpoints(pathData)
      const mat = editor.getShapePageTransform(shape)
      for (const seg of segs) {
        const s = mat.applyToPoint({ x: seg.x1, y: seg.y1 })
        const e = mat.applyToPoint({ x: seg.x2, y: seg.y2 })
        const dx = e.x - s.x, dy = e.y - s.y
        const len = Math.hypot(dx, dy)
        if (len < 1) continue
        _lineCache.push({
          x: s.x, y: s.y,
          dx, dy, len, thickness, id: shape.id,
        })
      }
    }
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
//
// 페이지의 **모든 선 쌍**을 미리 구해 캐시하고 있었다. 직접 그린 벽 몇 개라면
// 괜찮지만, DXF 를 가져오면 선이 수만 개라 쌍이 수십억이 된다 — 커서를 움직일
// 때마다 그걸 돌리니 탭이 멈춘다. ToolOverlay 가 그리기 중이 아닐 때도 부르기
// 때문에 도면을 띄워 놓기만 해도 걸린다.
//
// 지금은 **커서 반경 안을 지나는 선만** 추려서 그것들끼리만 교차를 본다.
// 교차점이 반경 안에 있으면 두 선 모두 반경 안을 지나므로 놓치는 건 없다.

/** 한 번에 짝지어 볼 선의 상한. 밀집한 도면에서 쌍이 폭발하지 않게 막는다. */
const MAX_INTERSECTION_CANDIDATES = 64

/** 점에서 선분까지 최단거리의 제곱. */
function distSqToSeg(px: number, py: number, w: WallLine): number {
  const t = Math.max(0, Math.min(1, ((px - w.x) * w.dx + (py - w.y) * w.dy) / (w.len * w.len)))
  const cx = w.x + w.dx * t, cy = w.y + w.dy * t
  return (px - cx) * (px - cx) + (py - cy) * (py - cy)
}

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

  // 커서 반경 안을 지나는 선만 추린다
  const r2 = radius * radius
  const near: WallLine[] = []
  for (const w of getWallLines(editor)) {
    if (w.id === excludeId) continue
    if (distSqToSeg(point.x, point.y, w) > r2) continue
    near.push(w)
    if (near.length >= MAX_INTERSECTION_CANDIDATES) break
  }

  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      const a = near[i], b = near[j]
      const ip = lineSegmentIntersection(
        a.x, a.y, a.x + a.dx, a.y + a.dy,
        b.x, b.y, b.x + b.dx, b.y + b.dy,
      )
      if (!ip) continue
      const d = Math.hypot(ip.x - point.x, ip.y - point.y)
      if (d < bestDist) {
        bestDist = d
        best = { x: ip.x, y: ip.y, sourceId: a.id, snapType: 'intersection' }
      }
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

/** 보조선 하나. 이 점을 지나는 **세로(x) 또는 가로(y)** 선이다. */
export type AlignGuide = { axis: 'x' | 'y'; at: number; through: { x: number; y: number } }

/** 맞출 자리를 찾는 범위 (화면 px). 스냅 반경과 같은 느낌이어야 손에 익는다. */
const ALIGN_RADIUS_PX = 8

/**
 * 커서가 **기존 점과 가로/세로로 나란한지** 본다.
 *
 * 평면도에서 제일 많이 하는 일이 "위 벽이랑 끝을 맞추는 것" 이다. 끝점 스냅은
 * 그 점에 **붙을 때**만 걸리는데, 맞추고 싶은 건 대개 멀리 떨어진 채로 x 나
 * y 만 같은 자리다. 그래서 좌표 하나만 보고 당긴다.
 *
 * 돌려주는 건 **보조선**이다 — 어디에 맞춰졌는지 화면에 그려줘야 한다.
 * 안 그리면 왜 커서가 끌려갔는지 알 수가 없다 (CAD 에서 제일 답답한 순간이다).
 */
export function findAlignGuides(
  editor: Editor,
  point: { x: number; y: number },
  excludeId?: string,
): AlignGuide[] {
  const radius = ALIGN_RADIUS_PX / editor.getZoomLevel()
  let bestX: AlignGuide | null = null
  let bestY: AlignGuide | null = null
  let dx = radius
  let dy = radius

  for (const ep of getWallEndpoints(editor)) {
    if (ep.id === excludeId) continue
    const ax = Math.abs(ep.x - point.x)
    if (ax < dx) {
      dx = ax
      bestX = { axis: 'x', at: ep.x, through: { x: ep.x, y: ep.y } }
    }
    const ay = Math.abs(ep.y - point.y)
    if (ay < dy) {
      dy = ay
      bestY = { axis: 'y', at: ep.y, through: { x: ep.x, y: ep.y } }
    }
  }
  // 둘 다 걸리면 둘 다 준다 — 교차점이 "모서리 맞춤" 이다.
  return [bestX, bestY].filter((g): g is AlignGuide => g !== null)
}

/**
 * 방향은 그대로 두고 **보조선까지 미끄러뜨린다.**
 *
 * 각을 이미 직각(또는 15°)으로 맞춰 놓았으므로, 좌표 하나를 억지로 바꾸면
 * 그 각이 깨진다. 대신 **그 방향 위에서** 보조선과 만나는 점을 찾는다 —
 * 각도 유지한 채 길이만 달라진다. Rayon 이 하는 것도 이거다.
 *
 * 방향이 보조선과 나란하면(세로선인데 가로로 긋는 중) 만나는 점이 없다.
 * 그때는 그냥 둔다.
 */
export function slideAlongTo(
  start: { x: number; y: number },
  dir: { x: number; y: number },
  guides: AlignGuide[],
): { point: { x: number; y: number }; used: AlignGuide } | null {
  const len = Math.hypot(dir.x, dir.y)
  if (len < 1e-9) return null
  const ux = dir.x / len
  const uy = dir.y / len

  let best: { point: { x: number; y: number }; used: AlignGuide; t: number } | null = null
  for (const g of guides) {
    const denom = g.axis === 'x' ? ux : uy
    // 방향이 보조선과 나란하다 — 아무리 가도 안 만난다
    if (Math.abs(denom) < 1e-6) continue
    const t = ((g.axis === 'x' ? g.at - start.x : g.at - start.y)) / denom
    // 뒤로 가는 건 안 쓴다. 커서 반대편으로 벽이 뒤집힌다.
    if (!(t > 0) || !Number.isFinite(t)) continue
    const cand = { x: start.x + ux * t, y: start.y + uy * t }
    if (!best || t < best.t) best = { point: cand, used: g, t }
  }
  return best ? { point: best.point, used: best.used } : null
}

/**
 * 꺾이는 각을 **앞 구간 기준 직각**으로 당긴다.
 *
 * 15° 직교 스냅(`snapAngle`)은 **화면 축**을 기준으로 돈다. 앞 벽이 축에
 * 나란하면 90° 가 15 의 배수라 저절로 맞지만, 앞 벽이 37° 로 비스듬하면
 * 아무리 조심해도 직각이 안 나온다. 평면도에서 벽은 거의 다 직각으로
 * 꺾이므로 그게 그대로 손해다.
 *
 * 그래서 앞 구간과 이루는 각을 보고 90 의 배수에 가까우면 **정확히** 그
 * 각으로 맞춘다. 길이는 커서가 간 만큼 그대로 둔다 — 각만 바로잡는다.
 *
 * 끝점·교차점 같은 **진짜 geometry** 스냅이 이겼을 때는 부르면 안 된다.
 * 거기서 각을 맞추겠다고 점을 옮기면 벽이 안 붙는다.
 *
 * @param prevDir 앞 구간의 방향 (길이는 안 본다)
 */
export function snapToTurn(
  startPoint: { x: number; y: number },
  point: { x: number; y: number },
  prevDir: { x: number; y: number },
  toleranceDeg = 10,
): SnapPoint | null {
  const dx = point.x - startPoint.x
  const dy = point.y - startPoint.y
  const len = Math.hypot(dx, dy)
  const prevLen = Math.hypot(prevDir.x, prevDir.y)
  // 길이가 없으면 방향이 없다 — 0 으로 나누면 NaN 이 번진다.
  if (len < 1 || prevLen < 1e-9) return null

  const prevAngle = Math.atan2(prevDir.y, prevDir.x)
  const cur = Math.atan2(dy, dx)
  // 앞 구간 기준 상대각을 (-180, 180] 로 접는다.
  //
  // **맞고 틀리고를 가르는 줄은 아니다** — atan2 가 둘 다 (-180,180] 를 주므로
  // 차는 (-360,360) 이고, 접지 않아도 가장 가까운 90 의 배수(±270 까지)가 같은
  // 방향을 가리킨다. 빼고 돌려봐서 확인했다. `rel` 을 사람이 읽을 수 있게
  // 두려고 접는다.
  let rel = ((cur - prevAngle) * 180) / Math.PI
  rel = ((rel % 360) + 540) % 360 - 180

  const nearest = Math.round(rel / 90) * 90
  if (Math.abs(rel - nearest) > toleranceDeg) return null

  const snapped = prevAngle + (nearest * Math.PI) / 180
  return {
    x: startPoint.x + Math.cos(snapped) * len,
    y: startPoint.y + Math.sin(snapped) * len,
    snapType: 'turn',
  }
}

/**
 * 그리기 도구가 쓰는 스냅 체인 전체.
 * 끝점 > 교차점 > 수직 > 연장 > 직교 각도 순으로 본다.
 *
 * **커서 위치를 인자로 받는다.** tldraw 도구는 editor.inputs 에서 읽으면
 * 되지만, 공간지정·면적측정 오버레이는 `<Tldraw>` 의 형제로 붙어 자기 포인터
 * 이벤트를 직접 받는다 — editor.inputs 가 따라오지 않는다. 그래서 그쪽은
 * 끝점 스냅 하나만 쓰고 있었고 **직교·교차점·수직·연장이 전부 죽어 있었다.**
 * shiftKey 도 같은 이유로 넘겨받는다.
 */
export function resolveDrawPointAt(
  editor: Editor,
  point: { x: number; y: number },
  startPoint: { x: number; y: number } | null,
  shiftKey: boolean,
  excludeId?: string,
): SnapPoint {
  // 1. 끝점/중간점/엣지 스냅 (최고 우선순위). 모드 필터는 함수 안에 있다.
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
  const orthoOn = getSnapEnabled() !== shiftKey
  if (startPoint && orthoOn) {
    const v = snapAngle(point.x - startPoint.x, point.y - startPoint.y)
    return { x: startPoint.x + v.x, y: startPoint.y + v.y, snapType: 'angle' }
  }
  return { x: point.x, y: point.y }
}

/** tldraw 도구용 — 커서와 shift 를 editor.inputs 에서 읽는 래퍼. */
export function resolveDrawPoint(
  editor: Editor,
  startPoint: { x: number; y: number } | null,
  excludeId?: string,
): SnapPoint {
  return resolveDrawPointAt(
    editor,
    editor.inputs.currentPagePoint,
    startPoint,
    editor.inputs.shiftKey,
    excludeId,
  )
}
