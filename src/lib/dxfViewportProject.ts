/**
 * 뷰포트를 통해 **모델공간 도형을 종이 좌표로** 끌어온다.
 *
 * 오토캐드의 배치 탭에는 도면틀·표제란만 그려져 있다. 평면도 자체는
 * 모델공간에 있고, 배치 위의 VIEWPORT 가 축척을 걸어 그걸 비춘다. 그래서
 * 종이공간만 읽으면 "틀만 있고 안은 빈" 페이지가 나온다 — 1단계에서
 * 거기까지 왔고, 여기가 2단계다.
 *
 * 사상(寫像)은 균일 축척 + 평행이동이다:
 *
 *   paperX = paperCX + (modelX - modelCX) * scale
 *
 * **비틀기(VIEWPORT gc 51)는 반영하지 않는다.** 평면 뷰포트는 거의 전부 0 이고,
 * 회전까지 넣으면 해치 패턴 각도·글자 회전까지 전부 돌려야 한다. 비틀린
 * 뷰포트는 도형이 축 방향으로만 어긋나 보일 것이다.
 */
import type { PolylineData, TextData, HatchData } from './dxf-fast-worker'
import type { ViewportProjection } from './dxf-shared'

/** 종이 좌표의 사각형 (창 테두리). */
export interface PaperRect { minX: number; minY: number; maxX: number; maxY: number }

/** 뷰포트가 종이 위에 차지하는 사각형. */
export function viewportPaperRect(vp: ViewportProjection): PaperRect {
  return {
    minX: vp.paperCX - vp.paperW / 2,
    minY: vp.paperCY - vp.paperH / 2,
    maxX: vp.paperCX + vp.paperW / 2,
    maxY: vp.paperCY + vp.paperH / 2,
  }
}

/** 두 사각형이 겹치는가 (한 점이라도 닿으면 참). */
export function rectsOverlap(a: PaperRect, b: PaperRect): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY
}

/**
 * 폴리라인들이 차지하는 범위. 도형이 어디 있는지 보는 진단용이고,
 * 종이·모델 어느 좌표계든 그대로 쓴다. 좌표가 하나도 없으면 null.
 */
export function vertexBounds(
  polylines: Array<{ vertices: number[][] }>,
): PaperRect | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const pl of polylines) {
    for (const v of pl.vertices) {
      const x = v[0], y = v[1]
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  return minX <= maxX && minY <= maxY ? { minX, minY, maxX, maxY } : null
}

/**
 * 뷰포트가 비추는 **모델공간** 영역. 창 안에 뭐가 들어올지는 이 사각형이
 * 모델 도형과 겹치는지로 결정된다 — 안 겹치면 창이 통째로 빈다.
 */
export function viewportModelRect(vp: ViewportProjection): PaperRect {
  const hw = vp.paperW / 2 / vp.scale
  const hh = vp.paperH / 2 / vp.scale
  return {
    minX: vp.modelCX - hw, minY: vp.modelCY - hh,
    maxX: vp.modelCX + hw, maxY: vp.modelCY + hh,
  }
}

/** 사각형을 중심 기준으로 배율만큼 넓힌다. */
function growRect(r: PaperRect, k: number): PaperRect {
  const cx = (r.minX + r.maxX) / 2, cy = (r.minY + r.maxY) / 2
  const hw = (r.maxX - r.minX) / 2 * k, hh = (r.maxY - r.minY) / 2 * k
  return { minX: cx - hw, minY: cy - hh, maxX: cx + hw, maxY: cy + hh }
}

/** 폴리라인 AABB 의 중심. 어디쯤 있는지만 세는 용도다. */
function centroid(pl: { vertices: number[][] }): [number, number] | null {
  const b = vertexBounds([pl])
  return b ? [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2] : null
}

/** 창이 통째로 빌 때, 왜 비었는지 가르는 숫자들. */
export interface EmptyViewportProbe {
  /** 창 중심에서 가장 가까운 도형까지의 편차 */
  nearest: { dx: number; dy: number } | null
  /** 창을 그대로 / 10배 / 100배 넓혔을 때 들어오는 폴리라인 수 */
  inWindow: number
  in10x: number
  in100x: number
  /** 뷰 중심 부호를 뒤집었을 때 들어오는 수 */
  inFlipped: number
}

/**
 * 창이 비었을 때 범인을 가린다. 세 가지 고장이 똑같은 증상을 낸다:
 *
 * - **뷰 중심이 엉뚱하다** → 창을 100배 넓혀도 0개, 가장 가까운 도형이
 *   창 크기보다 훨씬 멀다.
 * - **축척이 틀렸다** (gc 45 를 변환기가 gc 41 로 베껴 써서 1/1 이 된다)
 *   → 창을 넓히면 갑자기 수천 개가 들어온다.
 * - **비틀기(gc 51) 를 반영해야 한다** → 뷰 타깃(gc 17/27) 이 원점이면
 *   180도 비틀기는 뷰 중심의 부호를 뒤집는 것과 같다. 뒤집은 쪽에서만
 *   도형이 잡히면 그게 답이다.
 *
 * 개수는 폴리라인 AABB 중심으로 센다 — 정확한 클리핑이 아니라 "저 근처에
 * 도형이 있냐" 를 보는 것이므로 충분하다.
 */
export function probeEmptyViewport(
  polylines: Array<{ vertices: number[][] }>,
  vp: ViewportProjection,
): EmptyViewportProbe {
  const r = viewportModelRect(vp)
  const r10 = growRect(r, 10), r100 = growRect(r, 100)
  const flipped: PaperRect = {
    minX: -vp.modelCX - (r.maxX - r.minX) / 2, maxX: -vp.modelCX + (r.maxX - r.minX) / 2,
    minY: -vp.modelCY - (r.maxY - r.minY) / 2, maxY: -vp.modelCY + (r.maxY - r.minY) / 2,
  }
  const out: EmptyViewportProbe = {
    nearest: null, inWindow: 0, in10x: 0, in100x: 0, inFlipped: 0,
  }
  let best = Infinity
  for (const pl of polylines) {
    const c = centroid(pl)
    if (!c) continue
    const [x, y] = c
    if (inRect(r, x, y)) out.inWindow++
    if (inRect(r10, x, y)) out.in10x++
    if (inRect(r100, x, y)) out.in100x++
    if (inRect(flipped, x, y)) out.inFlipped++
    const dx = x - vp.modelCX, dy = y - vp.modelCY
    const d = dx * dx + dy * dy
    if (d < best) { best = d; out.nearest = { dx, dy } }
  }
  return out
}

/** 모델 좌표 한 점 → 종이 좌표. */
export function projectPoint(vp: ViewportProjection, x: number, y: number): [number, number] {
  return [
    vp.paperCX + (x - vp.modelCX) * vp.scale,
    vp.paperCY + (y - vp.modelCY) * vp.scale,
  ]
}

function inRect(r: PaperRect, x: number, y: number): boolean {
  return x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY
}

/**
 * 선분 하나를 사각형으로 자른다 (Liang-Barsky). 완전히 밖이면 null.
 *
 * 폴리라인 AABB 만 보고 통째로 살리면, 종이를 가로지르는 긴 선 하나 때문에
 * 평면도가 창 밖으로 흘러넘쳐 표제란을 덮는다. 그래서 선분 단위로 자른다.
 */
export function clipSegment(
  ax: number, ay: number, bx: number, by: number, r: PaperRect,
): [number, number, number, number] | null {
  const dx = bx - ax, dy = by - ay
  let t0 = 0, t1 = 1
  // (p, q) 쌍: p*t <= q 형태의 네 변 조건.
  const edges: Array<[number, number]> = [
    [-dx, ax - r.minX], [dx, r.maxX - ax],
    [-dy, ay - r.minY], [dy, r.maxY - ay],
  ]
  for (const [p, q] of edges) {
    if (p === 0) {
      // 그 축으로 평행하다 — 밖에 있으면 통째로 버린다.
      if (q < 0) return null
      continue
    }
    const t = q / p
    if (p < 0) {
      if (t > t1) return null
      if (t > t0) t0 = t
    } else {
      if (t < t0) return null
      if (t < t1) t1 = t
    }
  }
  return [ax + t0 * dx, ay + t0 * dy, ax + t1 * dx, ay + t1 * dy]
}

/** 두 점이 같은 자리인가 (조각 이어붙이기 판정). */
function same(a: number[], x: number, y: number): boolean {
  return Math.abs(a[0] - x) < 1e-9 && Math.abs(a[1] - y) < 1e-9
}

/**
 * 폴리라인을 사각형으로 자른다. 창을 드나드는 선은 여러 조각이 된다.
 * 점 하나만 남는 조각은 버린다 (그릴 게 없다).
 */
export function clipPolyline(vertices: number[][], r: PaperRect): number[][][] {
  const runs: number[][][] = []
  let cur: number[][] = []
  const flush = () => { if (cur.length >= 2) runs.push(cur); cur = [] }

  for (let i = 0; i + 1 < vertices.length; i++) {
    const a = vertices[i], b = vertices[i + 1]
    const seg = clipSegment(a[0], a[1], b[0], b[1], r)
    if (!seg) { flush(); continue }
    // 모서리를 스치기만 한 선분은 길이 0 으로 줄어든다. 살려 두면 아무것도
    // 안 그려지는 조각이 쌓인다. 이어붙이기 판정은 건너뛰어도 안전하다 —
    // 다음 선분이 cur 의 끝점과 안 맞으면 거기서 flush 된다.
    if (same([seg[0], seg[1]], seg[2], seg[3])) continue
    const [x0, y0, x1, y1] = seg
    if (cur.length === 0) cur.push([x0, y0], [x1, y1])
    else if (same(cur[cur.length - 1], x0, y0)) cur.push([x1, y1])
    else { flush(); cur.push([x0, y0], [x1, y1]) }
  }
  flush()
  return runs
}

/** 사상 결과와 버린 개수. 조용히 버리면 "도형이 왜 없지" 가 된다. */
export interface ProjectResult {
  polylines: PolylineData[]
  texts: TextData[]
  hatches: HatchData[]
  /** 창 밖이라 버린 개수 (폴리라인 / 글자 / 해치) */
  dropped: { polylines: number; texts: number; hatches: number }
  /** 이 창에서 동결된 레이어라 아예 안 넣은 개수 (전체 합).
   *  창 밖과 섞어 세면 "뷰 중심이 빗나갔다" 진단이 엉뚱해진다. */
  frozen: number
}

/**
 * 모델공간 파싱 결과를 뷰포트 하나를 통해 종이 좌표로 옮긴다.
 *
 * 해치는 테두리 패스가 SVG 문자열이라 정밀하게 자를 수가 없다. 그래서
 * **중심이 창 안에 있으면 통째로 살린다** — 창 경계에 걸친 해치는 조금
 * 삐져나온다. 통째로 버리면 바닥 해치가 사라지는 쪽이 더 나쁘다.
 */
export function projectThroughViewport(
  src: { polylines: PolylineData[]; texts: TextData[]; hatches: HatchData[] },
  vp: ViewportProjection,
): ProjectResult {
  const r = viewportPaperRect(vp)
  const dropped = { polylines: 0, texts: 0, hatches: 0 }

  // 창마다 한 번만 만든다. 레이어 이름은 오토캐드에서 대소문자를 구분하지
  // 않으므로 양쪽을 소문자로 맞춘다 — 테이블엔 "C-Light", 엔티티엔 "C-LIGHT"
  // 로 들어오는 파일이 있다.
  const frozenSet = vp.frozenLayers && vp.frozenLayers.length > 0
    ? new Set(vp.frozenLayers.map(n => n.toLowerCase()))
    : null
  const isFrozen = (layer: string): boolean =>
    frozenSet !== null && frozenSet.has(layer.toLowerCase())
  let frozen = 0

  const polylines: PolylineData[] = []
  for (const pl of src.polylines) {
    if (isFrozen(pl.layer)) { frozen++; continue }
    const moved = pl.vertices.map(v => projectPoint(vp, v[0], v[1]) as number[])
    const runs = clipPolyline(moved, r)
    if (runs.length === 0) { dropped.polylines++; continue }
    for (const vertices of runs) polylines.push({ ...pl, vertices })
  }

  const texts: TextData[] = []
  for (const t of src.texts) {
    if (isFrozen(t.layer)) { frozen++; continue }
    const [x, y] = projectPoint(vp, t.x, t.y)
    // 글자는 기준점이 창 안인지로만 본다. 절반 걸친 글자를 반으로 자르는 건
    // 의미가 없고, 축척이 걸린 모델 글자는 종이에선 아주 작다.
    if (!inRect(r, x, y)) { dropped.texts++; continue }
    texts.push({
      ...t, x, y,
      height: t.height * vp.scale,
      width: t.width === undefined ? undefined : t.width * vp.scale,
    })
  }

  const hatches: HatchData[] = []
  for (const h of src.hatches) {
    if (isFrozen(h.layer)) { frozen++; continue }
    const [cx, cy] = projectPoint(vp, h.cx, h.cy)
    if (!inRect(r, cx, cy)) { dropped.hatches++; continue }
    hatches.push({
      ...h, cx, cy,
      pathData: projectHatchPath(h.pathData, vp),
      // 패턴 간격/축척도 도면 단위다 — 같이 줄여야 줄무늬 밀도가 맞는다.
      patternScale: h.patternScale * vp.scale,
      patternSpacing: h.patternSpacing * vp.scale,
      patternDefs: h.patternDefs.map(d => ({
        ...d,
        spacing: d.spacing * vp.scale,
        dashes: d.dashes.map(n => n * vp.scale),
      })),
    })
  }

  return { polylines, texts, hatches, dropped, frozen }
}

/**
 * 해치 테두리 SVG 패스의 좌표를 옮긴다.
 *
 * 워커가 호(弧)까지 선분으로 펴서 내보내므로 명령은 M/L/Z 뿐이다
 * (transformHatchForInsert 가 같은 가정으로 돌고 있다).
 */
function projectHatchPath(pathData: string, vp: ViewportProjection): string {
  return pathData.replace(
    /([ML])([\d.e+-]+),([\d.e+-]+)/g,
    (_m, cmd: string, xs: string, ys: string) => {
      const [x, y] = projectPoint(vp, parseFloat(xs), parseFloat(ys))
      return `${cmd}${x},${y}`
    },
  )
}
