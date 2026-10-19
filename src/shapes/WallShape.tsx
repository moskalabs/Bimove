import {
  Mat,
  Polygon2d,
  ShapeUtil,
  SVGContainer,
  T,
  type TLBaseShape,
  type TLHandle,
  type TLOnHandleDragHandler,
  type TLResizeInfo,
  type TLShapePartial,
  Vec,
  useEditor,
  useValue,
  type Editor,
} from 'tldraw'
import type { IndexKey } from '@tldraw/editor'
import { useEffect, useState } from 'react'
import { getGrayscaleMode } from '../lib/settings'
import { renderPatternDef } from '../lib/wallPatterns'
import { dxfStrokePx, screenStrokeWidth } from '../lib/dxfStroke'
import type { PatternId } from '../lib/materialPresets'

/** #ffffff 등 배경과 구분 안 되는 밝은 색 감지 */
export function isNearWhite(hex: string): boolean {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return false
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.85
}

export type WallShapeProps = {
  x2: number
  y2: number
  thickness: number
}

export type WallShape = TLBaseShape<'wall', WallShapeProps>

export function getCorners(shape: WallShape): Vec[] {
  const { x2, y2, thickness } = shape.props
  const len = Math.sqrt(x2 * x2 + y2 * y2)
  if (len < 1) return [new Vec(0, 0), new Vec(1, 0), new Vec(1, 1), new Vec(0, 1)]
  const nx = -y2 / len
  const ny = x2 / len
  const half = thickness / 2
  return [
    new Vec(nx * half, ny * half),
    new Vec(x2 + nx * half, y2 + ny * half),
    new Vec(x2 - nx * half, y2 - ny * half),
    new Vec(-nx * half, -ny * half),
  ]
}

/**
 * For two walls meeting at a point, compute how far to extend wall-1's end
 * so the outer corner gap is filled. Uses miter-join geometry:
 * extension = half_thickness_2 / tan(angle/2)
 */
export function miterExtension(
  d1x: number, d1y: number, // wall-1 dir pointing AWAY from junction (unit)
  d2x: number, d2y: number, // wall-2 dir pointing AWAY from junction (unit)
  h2: number,               // half-thickness of wall-2
): number {
  const sinT = Math.abs(d1x * d2y - d1y * d2x)
  if (sinT < 0.05) return 0 // nearly parallel — no gap to fill
  const cosT = d1x * d2x + d1y * d2y
  const tanHalf = sinT / (1 + Math.max(cosT, -0.9))
  return Math.min(h2 / Math.max(tanHalf, 0.05), h2 * 8) // cap extreme angles
}

/**
 * 꺾인 자리에서 **옆면 하나**가 상대 벽의 옆면과 만나는 지점. 접점 기준 오프셋.
 *
 * `miterExtension` 은 스칼라 하나를 내놓고 그걸 **양쪽 옆면에 똑같이** 더한다.
 * 바깥쪽은 그게 맞지만 안쪽은 반대로 **당겨야** 한다 — 안 당기면 90° 코너마다
 * 두께만큼 삐져나온 꼬다리가 생기고, 흰 속으로 바꾼 뒤로는 그게 그대로 보인다.
 * 경쟁 제품(Rayon)의 코너가 깔끔한 건 옆면을 각각 교차시키기 때문이다.
 *
 * @param ax,ay 접점에서 **바깥으로** 향하는 내 벽 방향 (단위)
 * @param bx,by 접점에서 **바깥으로** 향하는 상대 벽 방향 (단위)
 * @param side  +1 이면 perp(a) 쪽 옆면, -1 이면 반대쪽
 * @param maxInto 안쪽 옆면을 **벽 안으로** 당겨도 되는 한도. `a` 가 늘 접점에서
 *   벽 몸통 쪽을 보므로 양수 t 가 "당기는" 방향이다. 벽이 제 miter 보다 짧으면
 *   (예: 두께 100mm 인 36mm 토막) 당겨진 끝이 반대쪽 끝을 **지나쳐** 도형이
 *   뒤집힌다. 보통 벽 길이의 절반을 넘긴다.
 * @returns 접점에서의 오프셋. 거의 나란하면 `null` (꺾인 게 아니다).
 */
export function miterOffset(
  ax: number, ay: number,
  bx: number, by: number,
  hA: number, hB: number,
  side: 1 | -1,
  maxInto = Infinity,
): { x: number; y: number } | null {
  const cross = ax * by - ay * bx
  if (Math.abs(cross) < 0.05) return null
  // 이어지는 외곽선이므로 내 +perp 쪽은 상대의 -perp 쪽과 한 줄이 된다.
  const nAx = -ay * side, nAy = ax * side
  const nBx = by * side, nBy = -bx * side
  const dx = hB * nBx - hA * nAx
  const dy = hB * nBy - hA * nAy
  let t = (dx * by - dy * bx) / cross

  // ── 안쪽으로 당기는 쪽만 길이로 묶는다 ──
  //
  // `a` 가 늘 접점에서 몸통 쪽을 보므로 양수 t 가 "당기는" 방향이다. 벽이 제
  // miter 보다 짧으면 당겨진 끝이 반대쪽 끝을 지나쳐 도형이 뒤집힌다.
  //
  // 이 한도는 **대칭이 아니다** (벽마다 길이가 다르다). 한쪽만 걸리면 두 벽의
  // 코너가 어긋나 턱이 생긴다 — 벽이 제 miter 보다 짧은 이상 피할 수 없는
  // 기하라서 그냥 둔다. 테스트에 그 경우를 적어 뒀다.
  if (t > maxInto) t = maxInto

  let ox = hA * nAx + t * ax
  let oy = hA * nAy + t * ay

  // ── 뾰족한 각에서 창처럼 뻗는 것만 막는다 ──
  //
  // **거리로** 묶어야 한다. 전엔 `t` 를 `hA*8` 로 묶었는데 그게 두 군데서
  // 깨졌다. 한도가 제 두께에만 달려 있어 두께가 다르면 서로 다른 값이고,
  // 무엇보다 t 를 묶는 건 **각자 제 방향으로** 자르는 것이라 두 벽이 다른
  // 자리에 멈춘다 — 그게 "대각선 꺾을 때 연결점이 자연스럽지 않다" 의 정체다.
  //
  // 안 자른 교점은 두 벽이 똑같이 계산한다. 그러니 **그 점을 같은 비율로**
  // 줄이고 한도를 두 두께에 대칭으로 잡으면, 잘린 뒤에도 같은 점에 선다.
  const limit = Math.max(hA, hB) * 8
  const dist = Math.hypot(ox, oy)
  if (dist > limit) {
    const k = limit / dist
    ox *= k
    oy *= k
  }
  return { x: ox, y: oy }
}

/**
 * 벽에 치수(길이선·화살표·숫자)를 띄울지.
 *
 * 전엔 모든 벽이 항상 달고 있었다. 벽 하나에 SVG 노드가 일곱이라 도면이 금세
 * 숫자밭이 되고, 정작 보려던 벽의 숫자를 못 찾는다. (끄는 토글은 코드에만 있고
 * UI 가 없어서 늘 켜져 있었다.)
 *
 * 그리는 중에는 `ToolOverlay` 가 길이와 꺾임 각을 띄우므로 여기선 안 봐도 된다.
 *
 * @param selCount 안 골랐으면 0, 골랐으면 **전체 선택 개수**. 전체 선택처럼 한
 *   번에 많이 고르면 숫자밭이 되는 건 그대로라 예전 200개 가드를 여기 남긴다.
 */
export function shouldShowWallDim(settingOn: boolean, selCount: number): boolean {
  return settingOn && selCount > 0 && selCount < 200
}

const JOIN_SNAP_R = 8 // page-unit radius for endpoint matching

// ── Wall snapshot cache: avoid calling getCurrentPageShapes() per-wall ──
/**
 * 이웃 벽 하나. 좌표는 **page 기준**이다.
 *
 * 전엔 `shape.x + props.x2` 를 page 좌표처럼 썼다. 그건 벽이 회전도 안 했고
 * 그룹 안에도 없을 때만 맞는다 — 벽에는 기본 회전 핸들이 뜨고 그룹도 묶을 수
 * 있으므로, 그러면 계산한 끝점이 실제 화면 끝점과 어긋나 miter 가 풀리거나
 * **엉뚱한 벽과 붙는다.** snap.ts 는 처음부터 getShapePageTransform 을 썼다.
 */
type WallSnapshot = {
  id: string
  /** 시작점 (page) */ sx: number; sy: number
  /** 끝점 (page) */   ex: number; ey: number
  /** 반두께 */        half: number
}
let _wallsCache: WallSnapshot[] = []
/** 이 캐시를 만든 원본 배열. 바뀌면(= 도형이 바뀌면) 다시 만든다. */
let _wallsCacheSrc: readonly unknown[] | null = null

/**
 * 페이지의 벽 목록. **캐시 키를 시간이 아니라 원본 배열로 잡는다.**
 *
 * 전엔 `performance.now()` 로 16ms 캐시를 했는데, 그게 코너를 깨뜨리고 있었다.
 *
 * tldraw 는 도형의 `component()` 를 `useStateTracking` 안에서 부른다 — 그리는
 * 동안 읽은 **신호가 그대로 그 도형의 구독**이 된다. 그런데 캐시가 살아 있으면
 * `getCurrentPageShapes()` 를 아예 안 읽고 돌아가므로, 그 프레임에 캐시를
 * 맞은 벽은 **이웃을 구독하지 못한다.** 이웃이 나중에 움직여도 다시 안 그려지고,
 * 제 레코드는 안 변하니 영영 안 그려진다.
 *
 * 그래서 코너마다 한쪽은 옛 모양(이웃이 없던 때의 **각진 끝**)으로 남는다.
 * 특히 이어 그리기에서 그렇다 — 앞 구간이 마지막으로 그려지는 순간엔 다음
 * 구간이 아직 없으므로, 그때 모양이 "이웃 없음" 이다. 그 위에 다음 구간이
 * miter 된 채 올라오니 **겹쳐 보인다.** 한이 "겹치는 느낌" 이라고 한 게 이것이다.
 *
 * 읽기를 먼저 하면 구독이 걸리고, 배열이 그대로면 만드는 일만 건너뛴다.
 *
 * (테스트에서 직접 부르려고 export 한다 — 구독을 거르는 캐시는 화면으로만
 *  확인하기 어렵고, 되돌아오면 또 코너가 어긋난다.)
 */
export function getWallsSnapshot(editor: Editor, pageId?: string): WallSnapshot[] {
  // ── 다른 페이지를 그릴 때 ──
  //
  // 배치 썸네일은 **현재 페이지를 바꾸지 않고** 임의 페이지의 SVG 를 만든다.
  // 그때 현재 페이지 이웃을 보면 코너가 안 붙거나 **엉뚱한 페이지의 벽과**
  // 붙는다. 그 길은 한 번만 도는 일회성이라 캐시도 안 쓴다.
  if (pageId && pageId !== editor.getCurrentPageId()) {
    const out: WallSnapshot[] = []
    for (const id of editor.getPageShapeIds(pageId as never)) {
      const s = editor.getShape(id)
      if (!s || s.type !== 'wall') continue
      const props = s.props as WallShapeProps
      const mat = editor.getShapePageTransform(s)
      const a = mat.applyToPoint({ x: 0, y: 0 })
      const b = mat.applyToPoint({ x: props.x2, y: props.y2 })
      out.push({ id: s.id, sx: a.x, sy: a.y, ex: b.x, ey: b.y, half: (props.thickness ?? 10) / 2 })
    }
    return out
  }

  const shapes = editor.getCurrentPageShapes()
  // 같은 배열이면 도형이 하나도 안 바뀐 것이다 (tldraw 의 computed 는 바뀔 때만
  // 새 배열을 낸다). 구독은 위에서 이미 걸렸다.
  if (shapes === _wallsCacheSrc) return _wallsCache
  _wallsCacheSrc = shapes
  _wallsCache = []
  for (const s of shapes) {
    if (s.type !== 'wall') continue
    const props = s.props as WallShapeProps
    const mat = editor.getShapePageTransform(s)
    const a = mat.applyToPoint({ x: 0, y: 0 })
    const b = mat.applyToPoint({ x: props.x2, y: props.y2 })
    _wallsCache.push({ id: s.id, sx: a.x, sy: a.y, ex: b.x, ey: b.y, half: (props.thickness ?? 10) / 2 })
  }
  return _wallsCache
}

// ── Per-shape corner cache ──
/**
 * 벽 하나의 외곽선. `capStart`/`capEnd` 는 **그 끝을 막는 선을 그릴지**다.
 * 다른 벽이 붙은 끝은 막으면 안 된다 — 코너를 가로지르는 선이 되어 보인다.
 */
export type WallOutline = { corners: Vec[]; capStart: boolean; capEnd: boolean }

/**
 * 외곽선 → SVG path 두 개.
 *
 * `d` 는 **채움**(닫힌 사각형), `dStroke` 는 **윤곽**이다. 나눠 그리는 건 다른
 * 벽이 붙은 끝을 막는 선을 빼야 하기 때문이다 — 그걸 그리면 코너를 가로지르는
 * 선이 된다.
 *
 * 화면(WallComponent)과 내보내기(toSvg)가 **같은 것을 쓰도록** 여기 모았다.
 * 전엔 toSvg 만 옛 모양으로 남아서, 화면은 멀쩡한데 배치 썸네일과 PDF 에서만
 * 검은 벽에 겹친 코너가 나왔다.
 */
export function wallPaths(outline: WallOutline): { d: string; dStroke: string } {
  const c = outline.corners
  const d = `M${c[0].x},${c[0].y} L${c[1].x},${c[1].y} L${c[2].x},${c[2].y} L${c[3].x},${c[3].y} Z`
  const dStroke = outline.capStart && outline.capEnd
    ? d
    : `M${c[0].x},${c[0].y} L${c[1].x},${c[1].y}`
      + `${outline.capEnd ? ' L' : ' M'}${c[2].x},${c[2].y}`
      + ` L${c[3].x},${c[3].y}`
      + (outline.capStart ? ` L${c[0].x},${c[0].y}` : '')
  return { d, dStroke }
}

const _cornersCache = new Map<string, { key: string; outline: WallOutline }>()

function shapeHashKey(shape: WallShape, sx: number, sy: number, ex: number, ey: number): string {
  // page 좌표를 넣는다. shape.x/y 만 넣으면 **회전만 바뀐 경우**를 못 잡아서
  // 캐시가 옛 코너를 계속 돌려준다.
  return `${sx}|${sy}|${ex}|${ey}|${shape.props.thickness}`
}

/**
 * 벽 하나의 외곽선. **반드시 `useValue` 안에서 불러야 한다** — 이웃을 읽는
 * 함수라, 추적 밖에서 부르면 이웃이 변해도 다시 안 그려진다 (WallComponent 의
 * 주석 참고).
 *
 * 안 바뀌었으면 **같은 객체**를 돌려준다. `useValue` 가 참조로 비교하므로
 * 그래야 벽 수백 개가 쓸데없이 다시 그려지지 않는다.
 */
export function computeWallOutline(editor: Editor, shape: WallShape, pageId?: string): WallOutline {
  const { x2, y2, thickness } = shape.props
  const len = Math.sqrt(x2 * x2 + y2 * y2)
  if (len < 1) return { corners: getCorners(shape), capStart: true, capEnd: true }

  // 캐시 확인: 자신의 geometry + 이웃 wall들의 hash가 같으면 재사용
  const walls = getWallsSnapshot(editor, pageId)

  // ── 이웃 찾기는 page 좌표로, 코너 만들기는 로컬 좌표로 ──
  //
  // 돌려줄 코너는 shape 로컬이다 (tldraw 가 바깥에서 변환을 건다). 그런데
  // 이웃이 어디 있는지는 page 에서만 알 수 있다 — 회전했거나 그룹 안에 있으면
  // 로컬 좌표끼리는 비교할 수 없다. 그래서 **찾을 때만** page 로 가고,
  // 찾은 이웃의 방향은 우리 로컬 프레임으로 되돌려서 쓴다 (`toLocalDir`).
  // 회전은 각을 보존하므로 miter 계산은 어느 프레임에서 해도 같다.
  const mat = editor.getShapePageTransform(shape)
  const pStart = mat.applyToPoint({ x: 0, y: 0 })
  const pEnd = mat.applyToPoint({ x: x2, y: y2 })
  const sx = pStart.x, sy = pStart.y
  const ex = pEnd.x, ey = pEnd.y
  const pageRot = Mat.Rotation(mat)
  const cosR = Math.cos(-pageRot), sinR = Math.sin(-pageRot)
  const toLocalDir = (vx: number, vy: number): [number, number] =>
    pageRot === 0 ? [vx, vy] : [vx * cosR - vy * sinR, vx * sinR + vy * cosR]

  const myKey = shapeHashKey(shape, sx, sy, ex, ey)

  // 이웃 wall의 변경도 감지하기 위해 근접 wall들의 hash 포함
  const ux = x2 / len, uy = y2 / len
  const nx = -uy, ny = ux
  const half = thickness / 2
  const snapR = Math.max(JOIN_SNAP_R, half * 0.5)

  // 근접 wall만 추려서 해시에 포함 (AABB pre-filter → distance check)
  // AABB bounding box: shape의 양 끝점 ± snapR
  const bbMinX = Math.min(sx, ex) - snapR
  const bbMaxX = Math.max(sx, ex) + snapR
  const bbMinY = Math.min(sy, ey) - snapR
  const bbMaxY = Math.max(sy, ey) + snapR

  let neighborHash = 0 // numeric hash (string concat 대신)
  const neighbors: WallSnapshot[] = []
  for (const w of walls) {
    if (w.id === shape.id) continue
    const wdx = w.ex - w.sx, wdy = w.ey - w.sy
    const wlen = Math.hypot(wdx, wdy)
    if (wlen < 1) continue

    // AABB pre-filter: 바운딩박스 겹침 체크 (Math.hypot 이전에 저렴한 비교)
    const wMinX = Math.min(w.sx, w.ex)
    const wMaxX = Math.max(w.sx, w.ex)
    const wMinY = Math.min(w.sy, w.ey)
    const wMaxY = Math.max(w.sy, w.ey)
    if (wMaxX < bbMinX || wMinX > bbMaxX || wMaxY < bbMinY || wMinY > bbMaxY) continue

    // 빠른 거리 체크: 두 endpoint와의 거리가 snapR 이내인 wall만 이웃
    const dSS = Math.hypot(w.sx - sx, w.sy - sy)
    const dSE = Math.hypot(w.ex - sx, w.ey - sy)
    const dES = Math.hypot(w.sx - ex, w.sy - ey)
    const dEE = Math.hypot(w.ex - ex, w.ey - ey)
    const nearEnd = dSS < snapR || dSE < snapR || dES < snapR || dEE < snapR

    // T-junction 체크도 포함
    let nearBody = false
    if (!nearEnd) {
      const wux = wdx / wlen, wuy = wdy / wlen
      const checkProj = (px: number, py: number) => {
        const t = (px - w.sx) * wux + (py - w.sy) * wuy
        if (t <= snapR || t >= wlen - snapR) return false
        const projX = w.sx + t * wux, projY = w.sy + t * wuy
        return Math.hypot(px - projX, py - projY) < snapR
      }
      nearBody = checkProj(sx, sy) || checkProj(ex, ey)
    }

    if (nearEnd || nearBody) {
      neighbors.push(w)
      // numeric hash: 빠른 비트 연산 (string concat GC 부담 제거)
      //
      // **1000 을 곱한 뒤 자른다.** 그냥 `|0` 이면 소수가 버려져서, 이웃이
      // 1 단위 안에서 움직이는 동안 해시가 그대로다 — 줌이 크면 그 1 단위가
      // 화면에서 여러 px 라 코너가 눈에 띄게 어긋난 채 멈춘다.
      const q = (v: number) => (v * 1000) | 0
      neighborHash = (neighborHash * 31 + q(w.sx) * 73 + q(w.sy) * 37 + q(w.ex) * 53 + q(w.ey) * 97 + q(w.half) * 11) | 0
    }
  }

  const fullKey = `${myKey}#${neighborHash}`
  // cornersCache 크기 제한 (메모리 누수 방지)
  if (_cornersCache.size > 1000) {
    const it = _cornersCache.keys()
    for (let i = 0; i < 500; i++) { const r = it.next(); if (r.done) break; _cornersCache.delete(r.value) }
  }
  const cached = _cornersCache.get(shape.id)
  if (cached && cached.key === fullKey) return cached.outline

  // ── 실제 계산 (이웃만 순회) ──
  let startExt = 0
  let endExt = 0
  // 끝점끼리 만난 상대. `[접점에서 바깥으로 향하는 방향 x, y, 반두께]`.
  // 여기 걸리면 스칼라 ext 대신 옆면을 각각 교차시킨다.
  let startPeer: [number, number, number] | null = null
  let endPeer: [number, number, number] | null = null
  let joinedStart = false
  let joinedEnd = false

  for (const w of neighbors) {
    const wdx = w.ex - w.sx, wdy = w.ey - w.sy
    const wlen = Math.hypot(wdx, wdy)
    // 이웃 방향을 **우리 로컬 프레임**으로 돌린다. 코너를 로컬 좌표로 만들기
    // 때문이다 — page 방향을 그대로 쓰면 회전한 벽에서 miter 가 엉뚱해진다.
    const [wux, wuy] = toLocalDir(wdx / wlen, wdy / wlen)
    const wh = w.half

    const dSS = Math.hypot(w.sx - sx, w.sy - sy)
    const dSE = Math.hypot(w.ex - sx, w.ey - sy)
    const dES = Math.hypot(w.sx - ex, w.sy - ey)
    const dEE = Math.hypot(w.ex - ex, w.ey - ey)

    // Corner miter: connection at our START — extend backward (−dir)
    if (dSS < snapR || dSE < snapR) {
      const [bx, by] = dSS < snapR ? [wux, wuy] : [-wux, -wuy]
      startExt = Math.max(startExt, miterExtension(ux, uy, bx, by, wh))
      joinedStart = true
      // 상대가 여럿이면 제일 많이 벌어지는 쪽에 맞춘다 (옛 max 와 같은 뜻).
      if (!startPeer || miterExtension(ux, uy, bx, by, wh) >= startExt) startPeer = [bx, by, wh]
    }

    // Corner miter: connection at our END — extend forward (+dir)
    if (dES < snapR || dEE < snapR) {
      const [bx, by] = dES < snapR ? [wux, wuy] : [-wux, -wuy]
      endExt = Math.max(endExt, miterExtension(-ux, -uy, bx, by, wh))
      joinedEnd = true
      if (!endPeer || miterExtension(-ux, -uy, bx, by, wh) >= endExt) endPeer = [bx, by, wh]
    }

    // T-junction: our endpoint near their BODY (not their endpoint)
    //
    // 각(sinAngle)은 어느 프레임에서 재도 같지만, **어디에 떨어지는지**는
    // page 에서 봐야 한다 — 우리 끝점(sx,sy)이 page 좌표다.
    const sinAngle = Math.abs(ux * wuy - uy * wux)
    if (sinAngle > 0.05) {
      const tExt = Math.min(wh / sinAngle, wh * 8)
      const pwux = wdx / wlen, pwuy = wdy / wlen
      const projectOntoW = (px: number, py: number) => {
        const t = (px - w.sx) * pwux + (py - w.sy) * pwuy
        const projX = w.sx + t * pwux, projY = w.sy + t * pwuy
        return { t, perpDist: Math.hypot(px - projX, py - projY), onBody: t > snapR && t < wlen - snapR }
      }
      const sp = projectOntoW(sx, sy)
      if (sp.onBody && sp.perpDist < snapR && dSS >= snapR && dSE >= snapR) {
        startExt = Math.max(startExt, tExt)
        joinedStart = true
      }
      const ep = projectOntoW(ex, ey)
      if (ep.onBody && ep.perpDist < snapR && dES >= snapR && dEE >= snapR) {
        endExt = Math.max(endExt, tExt)
        joinedEnd = true
      }
    }
  }

  // 끝점끼리 꺾여 만난 곳은 옆면을 각각 교차시킨다. 그래야 바깥은 뻗고 안쪽은
  // 당겨져서 코너가 딱 맞물린다. 나란히 이어지는 경우(`miterOffset` 이 null)는
  // 벌릴 것이 없으므로 스칼라 ext 로 돌아간다.
  //
  // 접점 기준 방향: 시작점에서 바깥은 +u, 끝점에서 바깥은 −u.
  // 옆면 부호는 `getCorners` 의 차례(+n, +n, −n, −n)에 맞춘다.
  const at = (px: number, py: number, o: { x: number; y: number } | null, sign: 1 | -1, edx: number, edy: number) =>
    o ? new Vec(px + o.x, py + o.y)
      : new Vec(px + nx * half * sign + edx, py + ny * half * sign + edy)

  // 늘리는 방향은 옆면과 무관하다 — 시작은 −u, 끝은 +u.
  const sdx = -ux * startExt, sdy = -uy * startExt
  const edx = ux * endExt, edy = uy * endExt

  // 양 끝이 다 꺾여 있으면 둘이 가운데서 만나도 안 되므로 절반씩만 내준다.
  const into = joinedStart && joinedEnd ? len / 2 : len
  const s0 = startPeer && miterOffset(ux, uy, startPeer[0], startPeer[1], half, startPeer[2], 1, into)
  const s3 = startPeer && miterOffset(ux, uy, startPeer[0], startPeer[1], half, startPeer[2], -1, into)
  const e1 = endPeer && miterOffset(-ux, -uy, endPeer[0], endPeer[1], half, endPeer[2], -1, into)
  const e2 = endPeer && miterOffset(-ux, -uy, endPeer[0], endPeer[1], half, endPeer[2], 1, into)

  const corners = [
    at(0, 0, s0 || null, 1, sdx, sdy),
    at(x2, y2, e1 || null, 1, edx, edy),
    at(x2, y2, e2 || null, -1, edx, edy),
    at(0, 0, s3 || null, -1, sdx, sdy),
  ]

  const outline: WallOutline = { corners, capStart: !joinedStart, capEnd: !joinedEnd }
  _cornersCache.set(shape.id, { key: fullKey, outline })
  return outline
}

// eslint-disable-next-line react-refresh/only-export-components
function WallComponent({ shape }: { shape: WallShape }) {
  const editor = useEditor()
  const isSelected = useValue(
    'wall-selected',
    () => editor.getSelectedShapeIds().includes(shape.id),
    [editor, shape.id],
  )
  const [grayscale, setGrayscale] = useState(getGrayscaleMode)

  useEffect(() => {
    const onSettings = () => {
      setGrayscale(getGrayscaleMode())
    }
    window.addEventListener('bimova:settings', onSettings)
    return () => window.removeEventListener('bimova:settings', onSettings)
  }, [])

  const { x2, y2 } = shape.props

  // DXF 임포트 shapes는 miter join 불필요 → 비싼 이웃 탐색 스킵
  const isDxf = !!shape.meta?.dxfFingerprint

  // ── 외곽선은 **useValue 안에서** 만든다 ──
  //
  // 여기가 "꺾이는 지점이 겹친다" 의 진짜 원인이었다.
  //
  // tldraw 는 `ShapeUtil.component()` 를 `useStateTracking` 안에서 부른다.
  // 그런데 우리 `component()` 는 `<WallComponent/>` **엘리먼트만** 돌려준다 —
  // 추적은 그 엘리먼트를 **만드는 동안**에만 걸리고, 이 함수 본문은 React 가
  // 나중에 따로 돌린다. 즉 여기서 뭘 읽어도 **구독이 안 걸린다.**
  //
  // 그래서 벽은 제 레코드가 바뀔 때만 다시 그려졌다. 이웃이 생기거나 움직여도
  // 모른다. 이어 그리기에서 앞 구간이 마지막으로 그려지는 순간엔 다음 구간이
  // 아직 없으므로, 앞 구간은 **이웃 없음 = miter 없고 끝이 막힌** 모양으로
  // 굳는다. 그 위에 다음 구간이 miter 된 채 올라오니 겹쳐 보인다.
  //
  // `useValue` 로 감싸면 안에서 읽은 신호가 전부 의존성이 된다. 값이
  // 참조로 같으면 다시 안 그리므로(_cornersCache 가 같은 객체를 돌려준다)
  // 벽이 수백 개여도 쓸데없이 돌지 않는다.
  //
  // DXF 벽은 이웃을 안 보므로 추적에서 뺀다 — 수천 개가 서로를 다시 그린다.
  const joined = useValue(
    'wall-outline',
    () => (shape.meta?.dxfFingerprint ? null : computeWallOutline(editor, shape)),
    [editor, shape],
  )
  const outline: WallOutline = joined ?? { corners: getCorners(shape), capStart: true, capEnd: true }
  const { d, dStroke } = wallPaths(outline)

  // DXF 임포트 shapes는 가는 선으로 표시 (CAD 도면 스타일)
  if (isDxf) {
    const rawDxf = (shape.meta?.dxfColor as string) || '#333'
    const dxfColor = isSelected ? '#1a73e8' : (isNearWhite(rawDxf) ? '#333' : rawDxf)
    const dxfLw = (shape.meta?.dxfLineweight as number) ?? 0
    const baseSw = dxfStrokePx(dxfLw)
    const dxfTr = (shape.meta?.dxfTransparency as number) ?? 0
    const dxfOpacity = dxfTr > 0 ? Math.max(0.05, 1 - dxfTr / 100) : 1
    // 화면 px 로 고정. 이전에는 max(baseSw, 0.5/zoom) 을 shape 좌표로 넣었는데,
    // tldraw 가 컨테이너에 CSS scale(zoom) 을 걸기 때문에 실제 화면 두께는
    // max(baseSw * zoom, 0.5) 였다 - 줌을 올릴수록 선이 끝없이 두꺼워졌다.
    // DxfGroupShape 와 같은 --tl-scale 관용구로 통일한다. 자세한 설명은 lib/dxfStroke.
    const swPx = isSelected ? baseSw * 1.5 : baseSw
    // 채워진 사각형이 아닌, 중심선만 렌더
    return (
      <SVGContainer>
        <line x1={0} y1={0} x2={x2} y2={y2} stroke={dxfColor} strokeWidth={swPx} strokeLinecap="round"
          style={{ strokeWidth: screenStrokeWidth(swPx) }}
          {...(dxfOpacity < 1 ? { opacity: dxfOpacity } : {})} />
      </SVGContainer>
    )
  }

  // DXF lineweight → strokeWidth (0.01mm → screen px)
  const dxfLw = (shape.meta?.dxfLineweight as number) ?? 0
  // 0.8px. 1px 이면 가는 벽에서 윤곽이 속을 다 먹는다.
  const strokeW = dxfLw > 0 ? Math.max(0.5, Math.min(dxfLw * 0.04, 6)) : 0.8

  // Grayscale 모드: 패턴 OFF, 흑백 선
  // DXF 색상이 있으면 fill/stroke 대신 사용 (BUG 8)
  const dxfColorRaw = shape.meta?.dxfColor as string | undefined
  const dxfColor = dxfColorRaw && isNearWhite(dxfColorRaw) ? '#333' : dxfColorRaw
  // 기본 채움은 **흰색**이다. 전엔 '#555' (진회색) 이라 0.10m 짜리 벽도
  // 시커먼 막대로 보였다 — 한이 "너무 두껍게 나온다" 고 한 게 이거다.
  // 평면도에서 벽은 **가는 윤곽선 두 줄 + 흰 속**이 맞다 (경쟁 제품도 그렇다).
  // meta.fill 을 직접 준 벽과 패턴이 걸린 벽은 그대로 둔다.
  const rawFill = (shape.meta?.fill as string) ?? dxfColor ?? '#fff'
  const rawStroke = (shape.meta?.stroke as string) ?? dxfColor ?? '#222'
  const fill = isSelected ? '#e8f0fe' : (grayscale ? '#f5f5f5' : rawFill)
  const stroke = isSelected ? '#1a73e8' : (grayscale ? '#333' : rawStroke)
  const pattern = grayscale ? undefined : (shape.meta?.pattern as string | undefined)
  // 패턴 ID를 패턴 이름+색상으로 공유 (벽마다 <defs> 중복 방지)
  const patKey = pattern && pattern !== 'none' ? `pat-${pattern}-${stroke.replace('#', '')}` : null
  const patternDef = patKey ? renderPatternDef(pattern as PatternId, patKey, stroke) : null
  const fillAttr = patKey ? `url(#${patKey})` : fill

  // 치수와 코너 각도는 **여기서 안 그린다.** 화면 좌표로 그려야 줌과 무관하게
  // 읽히기 때문이다 — 전엔 `fontSize={10}` 을 shape 단위로 줘서, 축소하면
  // 글자가 같이 줄어 점이 됐다. components/WallDimOverlay 로 옮겼다.
  return (
    <SVGContainer>
      {patternDef}
      <path d={d} fill={fillAttr} stroke="none" />
      <path d={dStroke} fill="none" stroke={stroke} strokeWidth={strokeW} strokeLinecap="butt"
        style={{ strokeWidth: screenStrokeWidth(strokeW) }} />
    </SVGContainer>
  )
}

export class WallShapeUtil extends ShapeUtil<WallShape> {
  static override type = 'wall' as const

  static override props = {
    x2: T.number,
    y2: T.number,
    thickness: T.number,
  }

  override getDefaultProps(): WallShapeProps {
    return { x2: 200, y2: 0, thickness: 20 }
  }

  canEdit = () => false
  canResize = () => false
  isAspectRatioLocked = () => false

  override getHandles(shape: WallShape): TLHandle[] {
    return [
      { id: 'start', type: 'vertex', index: 'a1' as IndexKey, x: 0, y: 0, canSnap: true },
      { id: 'end', type: 'vertex', index: 'a2' as IndexKey, x: shape.props.x2, y: shape.props.y2, canSnap: true },
    ]
  }

  onHandleDrag: TLOnHandleDragHandler<WallShape> = (shape, { handle }) => {
    if (handle.id === 'end') {
      return { id: shape.id, type: 'wall', props: { x2: handle.x, y2: handle.y } } as TLShapePartial<WallShape>
    }
    if (handle.id === 'start') {
      return {
        id: shape.id, type: 'wall',
        x: shape.x + handle.x,
        y: shape.y + handle.y,
        props: { x2: shape.props.x2 - handle.x, y2: shape.props.y2 - handle.y },
      } as TLShapePartial<WallShape>
    }
  }

  override getGeometry(shape: WallShape) {
    return new Polygon2d({ points: getCorners(shape), isFilled: true })
  }

  indicator(shape: WallShape) {
    const { x2, y2 } = shape.props
    // CAD 스타일: 중심선만 표시 (바운딩 폴리곤 대신)
    return <line x1={0} y1={0} x2={x2} y2={y2} />
  }

  override component(shape: WallShape) {
    return <WallComponent shape={shape} />
  }

  onResize = (shape: WallShape, _info: TLResizeInfo<WallShape>) => shape

  override toSvg(shape: WallShape) {
    const { x2, y2 } = shape.props
    const isDxf = !!shape.meta?.dxfFingerprint

    if (isDxf) {
      const rawDxf = (shape.meta?.dxfColor as string) || '#333'
      const color = isNearWhite(rawDxf) ? '#333' : rawDxf
      const dxfLw = (shape.meta?.dxfLineweight as number) ?? 0
      const sw = dxfLw > 0 ? Math.max(0.4, Math.min(dxfLw * 0.03, 4)) : 0.6
      return <line x1={0} y1={0} x2={x2} y2={y2} stroke={color} strokeWidth={sw} strokeLinecap="round" />
    }

    // 화면과 **같은 외곽선**을 쓴다. 전엔 여기만 getCorners(이어 붙이지 않은
    // 사각형) + 기본색 '#555' 였다. 그래서 화면은 고쳐도 배치 썸네일·SVG/PDF
    // 내보내기에서는 검은 벽, 겹치는 코너, 끝을 가로지르는 선이 그대로 나왔다.
    // **그 도형이 있는 페이지**의 이웃을 본다. 배치 썸네일은 현재 페이지를
    // 바꾸지 않고 다른 페이지의 SVG 를 만들기 때문이다 — 안 넘기면 코너가
    // 안 붙거나 엉뚱한 페이지의 벽과 붙는다.
    const outline = computeWallOutline(this.editor, shape, this.editor.getAncestorPageId(shape))
    const { d, dStroke } = wallPaths(outline)
    const rawFill = (shape.meta?.fill as string) ?? '#fff'
    const rawStroke = (shape.meta?.stroke as string) ?? '#222'
    const dxfLw = (shape.meta?.dxfLineweight as number) ?? 0
    const sw = dxfLw > 0 ? Math.max(0.4, Math.min(dxfLw * 0.03, 4)) : 0.6
    return (
      <g>
        <path d={d} fill={rawFill} stroke="none" />
        <path d={dStroke} fill="none" stroke={rawStroke} strokeWidth={sw} strokeLinecap="butt" />
      </g>
    )
  }
}
