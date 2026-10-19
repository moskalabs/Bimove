import type { Editor } from 'tldraw'
import { getSnapEnabled, getSnapMode } from './settings'

/** 스냅 타입: 어떤 종류의 스냅이 발생했는지 구분 */
export type SnapType = 'endpoint' | 'midpoint' | 'edge' | 'intersection' | 'perpendicular' | 'extension' | 'angle' | 'turn'

export type SnapPoint = { x: number; y: number; sourceId?: string; snapType?: SnapType }

/** Screen-space snap radius in px; converted to page units via current zoom. */
const SNAP_RADIUS_PX = 12

// ── Wall endpoint cache ──
//
// **캐시 키는 시간이 아니라 `getCurrentPageShapes()` 배열의 신원이다.**
//
// 전엔 `performance.now()` 로 16ms 창을 뒀다. 그게 정확히 제일 필요한 순간에
// 무너진다 — 선분 5만 개짜리 DXF 에서는 목록을 **만드는 데만 14ms** 가 걸리고,
// 한 프레임에 스냅 질의가 넷(끝점·교차·수직·연장)이라 두 번째 질의부터는
// 이미 16ms 가 지나 있다. 그래서 네 번 다 처음부터 다시 만들었다 (한 프레임
// 56ms). 재서 확인한 숫자다.
//
// 배열 신원으로 잡으면 **도형이 바뀔 때만** 만든다. 커서만 움직이는 동안은
// 공짜고, 그리는 중에도 프레임당 한 번이다. tldraw 의 computed 는 바뀔 때만
// 새 배열을 낸다.
type WallEndpoint = { x: number; y: number; mx: number; my: number; id: string; edge?: boolean }
let _snapCache: WallEndpoint[] = []
let _snapCacheSrc: readonly unknown[] | null = null
/**
 * DXF 에서 뽑은 부분만 따로. **그 도형들이 그대로면 다시 안 판다.**
 *
 * 벽 하나를 그리는 동안 `getCurrentPageShapes()` 는 매 프레임 새 배열을 낸다
 * (미리보기가 바뀌니까). 그렇다고 5만 선분짜리 pathData 를 다시 파싱하면
 * 프레임마다 14ms 를 버린다 — DXF 는 그 사이 하나도 안 바뀌는데.
 */
let _dxfEndpoints: WallEndpoint[] = []
let _dxfEndpointsKey = ''
let _snapDiagLogged = false

/**
 * DXF 캐시의 열쇠. 도형 id + **page 변환**이다.
 *
 * 레코드 참조만 보면 부족하다 — dxfgroup 을 **부모 그룹째** 옮기거나 돌리면
 * 자식 레코드는 그대로고 부모 것만 바뀐다. 그러면 page 좌표로 구워 둔 끝점이
 * 옛 자리에 남아서, 보이는 도면과 스냅이 어긋난다.
 *
 * `getShapePageTransform` 은 부모까지 합친 결과라 그 변화를 그대로 담는다.
 * 도형 개수만큼만 도므로(선분 수와 무관) 값싸다.
 */
function dxfKey(editor: Editor, groups: readonly { id: string }[]): string {
  let k = ''
  for (const g of groups) {
    const m = editor.getShapePageTransform(g as never)
    k += `${g.id}:${m.a},${m.b},${m.c},${m.d},${m.e},${m.f};`
  }
  return k
}

/** 테스트용: 캐시 초기화 */
export function _resetSnapCache() {
  _snapCacheSrc = null
  _lineCacheSrc = null
  _snapCache = []
  _lineCache = []
  _dxfEndpoints = []
  _dxfEndpointsKey = ''
  _dxfLines = []
  _dxfLinesKey = ''
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
  const shapes = editor.getCurrentPageShapes()
  if (shapes === _snapCacheSrc) return _snapCache
  _snapCacheSrc = shapes

  // 가르는 비용은 **도형 개수**에 비례한다 (선분 수가 아니라). DXF 한 장은
  // dxfgroup 몇 개에 선분 수만 개가 들어 있으므로 이 루프는 공짜에 가깝다.
  const groups: typeof shapes = []
  const walls: typeof shapes = []
  for (const s of shapes) {
    if (s.type === 'dxfgroup') groups.push(s)
    else if (s.type === 'wall') walls.push(s)
  }

  const epKey = dxfKey(editor, groups as never)
  if (epKey !== _dxfEndpointsKey) {
    _dxfEndpointsKey = epKey
    _dxfEndpoints = []
    let dxfSegCount = 0
    for (const shape of groups) {
      const pathData = (shape.props as Record<string, unknown>).pathData
      if (!pathData || typeof pathData !== 'string') continue
      const segs = parseDxfPathEndpoints(pathData)
      dxfSegCount += segs.length
      const mat = editor.getShapePageTransform(shape)
      for (const seg of segs) {
        const a = mat.applyToPoint({ x: seg.x1, y: seg.y1 })
        const b = mat.applyToPoint({ x: seg.x2, y: seg.y2 })
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
        _dxfEndpoints.push({ x: a.x, y: a.y, mx, my, id: shape.id })
        _dxfEndpoints.push({ x: b.x, y: b.y, mx, my, id: shape.id })
      }
    }
    if (!_snapDiagLogged) {
      _snapDiagLogged = true
      console.debug(`[snap] dxf endpoints: ${_dxfEndpoints.length} (groups: ${groups.length}, segs: ${dxfSegCount})`)
    }
  }

  // 벽은 몇 개 안 되므로 매번 새로 만든다.
  const wallPart: WallEndpoint[] = []
  for (const shape of walls) {
    const props = shape.props as { x2: number; y2: number; thickness: number }
    // getShapePageTransform: 그룹/회전 포함 정확한 page 좌표 변환
    const mat = editor.getShapePageTransform(shape)
    const s = mat.applyToPoint({ x: 0, y: 0 })
    const e = mat.applyToPoint({ x: props.x2, y: props.y2 })
    const mid = { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 }
    // 중심선 끝점
    wallPart.push({ x: s.x, y: s.y, mx: mid.x, my: mid.y, id: shape.id })
    wallPart.push({ x: e.x, y: e.y, mx: mid.x, my: mid.y, id: shape.id })
    // 양쪽 엣지 끝점 (두께 고려)
    const half = (props.thickness ?? 10) / 2
    const dx = e.x - s.x, dy = e.y - s.y
    const len = Math.hypot(dx, dy)
    if (len > 1) {
      const nx = -dy / len * half, ny = dx / len * half // 수직 방향
      wallPart.push({ x: s.x + nx, y: s.y + ny, mx: mid.x + nx, my: mid.y + ny, id: shape.id, edge: true })
      wallPart.push({ x: e.x + nx, y: e.y + ny, mx: mid.x + nx, my: mid.y + ny, id: shape.id, edge: true })
      wallPart.push({ x: s.x - nx, y: s.y - ny, mx: mid.x - nx, my: mid.y - ny, id: shape.id, edge: true })
      wallPart.push({ x: e.x - nx, y: e.y - ny, mx: mid.x - nx, my: mid.y - ny, id: shape.id, edge: true })
    }
  }

  // 벽이 없으면 **복사도 안 한다** (DXF 만 띄워 놓고 보는 동안이 그렇다).
  _snapCache = wallPart.length === 0 ? _dxfEndpoints : wallPart.concat(_dxfEndpoints)
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

// ── Wall line cache ──
// 키 잡는 이유는 `getWallEndpoints` 주석과 같다.
type WallLine = { x: number; y: number; dx: number; dy: number; len: number; thickness: number; id: string }
let _lineCache: WallLine[] = []
let _lineCacheSrc: readonly unknown[] | null = null
let _dxfLines: WallLine[] = []
let _dxfLinesKey = ''

function getWallLines(editor: Editor): WallLine[] {
  const shapes = editor.getCurrentPageShapes()
  if (shapes === _lineCacheSrc) return _lineCache
  _lineCacheSrc = shapes

  const groups: typeof shapes = []
  const walls: typeof shapes = []
  for (const s of shapes) {
    if (s.type === 'dxfgroup') groups.push(s)
    else if (s.type === 'wall') walls.push(s)
  }

  // DXF 는 끝점 쪽과 같은 이유로 따로 캐시한다 (주석은 _dxfEndpoints 참고).
  const lineKey = dxfKey(editor, groups as never)
  if (lineKey !== _dxfLinesKey) {
    _dxfLinesKey = lineKey
    _dxfLines = []
    for (const shape of groups) {
      const pathData = (shape.props as Record<string, unknown>).pathData
      if (!pathData || typeof pathData !== 'string') continue
      const mat = editor.getShapePageTransform(shape)
      for (const seg of parseDxfPathEndpoints(pathData)) {
        const a = mat.applyToPoint({ x: seg.x1, y: seg.y1 })
        const b = mat.applyToPoint({ x: seg.x2, y: seg.y2 })
        const dx = b.x - a.x, dy = b.y - a.y
        const len = Math.hypot(dx, dy)
        if (len < 1) continue
        _dxfLines.push({ x: a.x, y: a.y, dx, dy, len, thickness: 0, id: shape.id })
      }
    }
  }

  const wallPart: WallLine[] = []
  for (const shape of walls) {
    const props = shape.props as { x2: number; y2: number; thickness: number }
    const mat = editor.getShapePageTransform(shape)
    const a = mat.applyToPoint({ x: 0, y: 0 })
    const b = mat.applyToPoint({ x: props.x2, y: props.y2 })
    const dx = b.x - a.x, dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len < 1) continue
    wallPart.push({ x: a.x, y: a.y, dx, dy, len, thickness: props.thickness, id: shape.id })
  }

  _lineCache = wallPart.length === 0 ? _dxfLines : wallPart.concat(_dxfLines)
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
export const ALIGN_RADIUS_PX = 8

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
 *
 * ── 왜 거리 제한이 필요한가 ──
 *
 * 보조선은 **커서에서 8px 안**에 있을 때만 잡힌다. 그러니 제대로 된 교점도
 * 커서 근처에 있어야 맞다. 그런데 방향이 보조선과 거의 나란하면 1/denom 이
 * 폭발해서, 8px 짜리 어긋남이 수천 단위의 이동이 된다 — 세로로 긋는 중에
 * 세로 보조선이 살짝 스치기만 해도 벽 끝이 화면 밖으로 날아간다.
 *
 * 나란함을 각으로 막는 것만으로는 부족하다 (한계각 바로 안쪽에서 여전히 멀리
 * 간다). 그래서 **결과가 커서에서 얼마나 떨어지는지**를 직접 막는다.
 *
 * @param maxSlide 커서(= `start + dir`)에서 결과까지 허용할 거리. page 단위.
 *   부른 쪽이 `8px * 4 / zoom` 쯤을 넘긴다 — 60° 쯤 비스듬해도 닿고, 그보다
 *   나란해지면 거절한다.
 */
export function slideAlongTo(
  start: { x: number; y: number },
  dir: { x: number; y: number },
  guides: AlignGuide[],
  maxSlide = Infinity,
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
    // 커서에서 너무 멀리 끌려가면 안 쓴다 (위 주석).
    if (Math.abs(t - len) > maxSlide) continue
    const cand = { x: start.x + ux * t, y: start.y + uy * t }
    if (!best || t < best.t) best = { point: cand, used: g, t }
  }
  return best ? { point: best.point, used: best.used } : null
}

/**
 * 그리는 중인 구간 옆에 **라벨을 놓을 자리**. 화면(viewport) 좌표로 받고 준다.
 *
 * 전엔 길이를 구간 **한가운데 가로로** 얹었다. 선 위에 글자가 올라타서, 가로
 * 벽에서는 벽을 가리고 세로 벽에서는 글자가 선을 가로지른다. 경쟁 제품(Rayon)
 * 은 글자를 **벽을 따라 돌리고 옆으로 비켜** 놓는다 — 그래야 선도 글자도 다
 * 보인다.
 *
 * 비키는 쪽은 **진행 방향 기준 왼쪽**으로 고정한다. 바깥/안쪽을 따지려면 앞
 * 구간까지 봐야 하는데, 꺾임마다 라벨이 좌우로 튀면 그게 더 산만하다.
 *
 * @param at 라벨을 놓을 기준점 (대개 구간 중점이나 코너)
 * @param offsetPx 선에서 떨어뜨릴 화면 px
 * @returns `deg` 는 CSS `rotate()` 에 그대로 넣는 각. 글자가 뒤집히지 않게 접었다.
 */
export function labelPlacement(
  at: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
  offsetPx: number,
): { x: number; y: number; deg: number } {
  const dx = end.x - start.x, dy = end.y - start.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return { x: at.x, y: at.y, deg: 0 }
  // 화면 좌표는 y 가 아래로 간다. 그 좌표계에서 진행 방향의 **왼쪽**은
  // (dy, -dx) 다.
  const nx = dy / len, ny = -dx / len
  let deg = Math.atan2(dy, dx) * 180 / Math.PI
  // 글자가 거꾸로 서지 않게 반 바퀴 돌린다. 180° 를 더해도 **놓는 자리는
  // 그대로** 라 라벨이 선 반대쪽으로 넘어가지 않는다.
  if (deg > 90) deg -= 180
  else if (deg <= -90) deg += 180
  return { x: at.x + nx * offsetPx, y: at.y + ny * offsetPx, deg }
}

/**
 * 그 자리에 붙은 이웃 벽과 이루는 **코너 내각**(도). 이웃이 없으면 `null`.
 *
 * `wallDirIntoPoint` 는 이웃이 접점으로 **들어오는** 방향을 준다. 내각은 서로
 * **멀어지는** 두 방향 사이 각이므로 그걸 뒤집어서 넣어야 한다 — 여기서 부호를
 * 틀리면 90° 가 90° 로 나와서(대칭이라) 안 보이다가, 비스듬한 코너에서만
 * 조용히 틀린다. 그래서 조합을 한 군데로 모았다.
 *
 * @param atPage   코너 (page 좌표)
 * @param awayPage 내 벽이 그 코너에서 **뻗어 나가는** 방향 (page)
 * @param excludeId 나 자신
 */
export function cornerAngleAt(
  editor: Editor,
  atPage: { x: number; y: number },
  awayPage: { x: number; y: number },
  excludeId?: string,
): { deg: number; prevAway: { x: number; y: number } } | null {
  const into = wallDirIntoPoint(editor, atPage, excludeId)
  if (!into) return null
  const prevAway = { x: -into.x, y: -into.y }
  return { deg: cornerAngleDeg(prevAway, awayPage), prevAway }
}

/**
 * 코너의 **내각**(도) — 두 벽이 코너에서 벌어진 각. 직각이면 90, 곧게
 * 이어가면 180, 왔던 길로 되접히면 0.
 *
 * 두 인자 모두 **코너에서 바깥으로** 향하는 방향이다. 앞 벽은 코너로
 * 들어오므로 뒤집어서 넣어야 한다.
 *
 * ── 왜 "꺾인 각" 이 아니라 내각인가 ──
 *
 * 전엔 곧게 이어가면 0, 직각이면 90 이 되는 **꺾임 각**을 띄웠다. 직각에서는
 * 둘이 같아서 차이가 안 보였는데, 코너에 부채꼴 가이드를 그리면서 갈렸다 —
 * 가이드는 **두 벽 사이**를 칠하므로 그 각은 내각이다. 120° 를 칠해 놓고
 * "60°" 라고 적으면 둘 다 못 믿게 된다. 경쟁 제품(Rayon)도 내각을 띄운다.
 *
 * 부호(좌/우)는 안 돌려준다 — 화면에서 바로 보이고, 숫자에 부호가 붙으면
 * "-90도" 가 무슨 뜻인지 또 설명해야 한다.
 *
 * 화면 축 기준 **절대** 각(atan2 그대로)과 헷갈리면 안 된다. 평면도에서 알고
 * 싶은 건 앞 벽과 이루는 각이다 — 앞 벽이 37° 로 비스듬하면 절대 각으로는
 * 직각인지 영영 알 수 없다.
 */
export function cornerAngleDeg(
  prevAway: { x: number; y: number },
  dirAway: { x: number; y: number },
): number {
  const la = Math.hypot(prevAway.x, prevAway.y)
  const lb = Math.hypot(dirAway.x, dirAway.y)
  if (la < 1e-9 || lb < 1e-9) return 0
  // acos 는 부동소수 오차로 |x|>1 이 들어오면 NaN 을 낸다. 먼저 조인다.
  const cos = Math.max(-1, Math.min(1, (prevAway.x * dirAway.x + prevAway.y * dirAway.y) / (la * lb)))
  return Math.acos(cos) * 180 / Math.PI
}

/**
 * 이미 있는 벽 끝에서 새로 그리기 시작할 때, **그 벽이 들어온 방향**.
 *
 * 이어 그리기(클릭-클릭)로 꺾으면 앞 구간 방향을 도구가 들고 있지만, 한 번
 * 끊었다가 기존 벽 끝에서 다시 시작하면 그게 없다. 그러면 직각 스냅도 안 걸리고
 * 코너에 각도도 안 뜬다 — 사용자 눈에는 **같은 동작인데 어떤 때만 된다.**
 *
 * 돌려주는 방향은 이어 그리기와 같은 약속이다: 접점으로 **들어오는** 쪽.
 *
 * 거리 기준은 `WallShape` 가 "두 벽이 붙었다" 고 보는 값과 같게 둔다. 그래야
 * 코너가 맞물려 보이는 것과 각이 뜨는 것이 늘 같이 간다.
 *
 * @param excludeId 지금 그리는 미리보기 — 자기 자신을 앞 구간으로 삼으면 안 된다
 */
export function wallDirIntoPoint(
  editor: Editor,
  point: { x: number; y: number },
  excludeId?: string,
  radius = 8,
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null
  let bestDist = radius
  for (const shape of editor.getCurrentPageShapes()) {
    if (shape.type !== 'wall' || shape.id === excludeId) continue
    const props = shape.props as { x2: number; y2: number }
    const mat = editor.getShapePageTransform(shape)
    const s = mat.applyToPoint({ x: 0, y: 0 })
    const e = mat.applyToPoint({ x: props.x2, y: props.y2 })
    const dx = e.x - s.x, dy = e.y - s.y
    if (Math.hypot(dx, dy) < 1) continue
    const dEnd = Math.hypot(e.x - point.x, e.y - point.y)
    if (dEnd < bestDist) {
      bestDist = dEnd
      best = { x: dx, y: dy }
    }
    const dStart = Math.hypot(s.x - point.x, s.y - point.y)
    if (dStart < bestDist) {
      bestDist = dStart
      // 시작점에 붙었으면 그 벽은 접점에서 **나가는** 중이다 — 뒤집어야 약속이 맞다.
      best = { x: -dx, y: -dy }
    }
  }
  return best
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
