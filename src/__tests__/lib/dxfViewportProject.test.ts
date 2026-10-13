/**
 * 뷰포트 사상(寫像) — 모델공간 도형을 종이 좌표로 끌어오기.
 *
 * 1단계에서 배치 탭이 페이지로 들어오게 됐지만 **도면틀만** 있고 안은 비었다.
 * 평면도는 모델공간에 있고, 배치 위의 VIEWPORT 가 축척을 걸어 비추기 때문.
 * 여기서 그 사상과 창 클리핑을 검증한다.
 */
import { describe, it, expect } from 'vitest'
import {
  projectPoint, viewportPaperRect, viewportModelRect, rectsOverlap, vertexBounds,
  clipSegment, clipPolyline, projectThroughViewport,
  type PaperRect,
} from '../../lib/dxfViewportProject'
import { toViewportProjection, type DxfViewport, type ViewportProjection } from '../../lib/dxf-shared'
import type { PolylineData, TextData, HatchData } from '../../lib/dxf-fast-worker'

/** 종이 (50,50)~(150,150) 창이 모델 (-500,-500)~(500,500) 을 1/10 로 비춘다. */
const VP: ViewportProjection = {
  paperCX: 100, paperCY: 100, paperW: 100, paperH: 100,
  modelCX: 0, modelCY: 0,
  scale: 0.1,
}

const RECT: PaperRect = { minX: 0, minY: 0, maxX: 10, maxY: 10 }

const pl = (vertices: number[][]): PolylineData => ({
  vertices, layer: '0', colorNumber: 7,
})

const tx = (x: number, y: number, height = 100, width?: number): TextData => ({
  x, y, text: '거실', height, width, layer: '0', colorNumber: 7,
})

const ha = (cx: number, cy: number, pathData: string): HatchData => ({
  pathData, patternName: 'ANSI31',
  patternScale: 2, patternAngle: 45, patternSpacing: 30,
  patternDefAngle: 45, patternDefLines: 1,
  patternDefs: [{ angle: 45, spacing: 30, dashes: [10, -5] }],
  solidFill: false, layer: '0', cx, cy,
})

describe('projectPoint / viewportPaperRect', () => {
  it('모델 중심은 종이 창 중심으로 간다', () => {
    expect(projectPoint(VP, 0, 0)).toEqual([100, 100])
  })

  it('중심에서 떨어진 만큼 축척이 걸린다', () => {
    const [x, y] = projectPoint(VP, 500, -500)
    expect(x).toBeCloseTo(150, 9)
    expect(y).toBeCloseTo(50, 9)
  })

  it('창 사각형은 중심 ± 절반', () => {
    expect(viewportPaperRect(VP)).toEqual({ minX: 50, minY: 50, maxX: 150, maxY: 150 })
  })
})

describe('viewportModelRect / rectsOverlap / vertexBounds', () => {
  it('창이 비추는 모델 영역은 종이 창을 축척으로 되돌린 크기', () => {
    expect(viewportModelRect(VP)).toEqual({ minX: -500, minY: -500, maxX: 500, maxY: 500 })
  })

  it('모서리만 닿아도 겹친 것으로 본다', () => {
    expect(rectsOverlap(RECT, { minX: 10, minY: 10, maxX: 20, maxY: 20 })).toBe(true)
    expect(rectsOverlap(RECT, { minX: 10.5, minY: 0, maxX: 20, maxY: 10 })).toBe(false)
  })

  it('폴리라인 범위는 모든 꼭짓점을 감싼다', () => {
    expect(vertexBounds([pl([[0, 0], [5, -3]]), pl([[-2, 9]])]))
      .toEqual({ minX: -2, minY: -3, maxX: 5, maxY: 9 })
  })

  it('꼭짓점이 없으면 null — Infinity 가 로그로 새 나가지 않게', () => {
    expect(vertexBounds([])).toBeNull()
    expect(vertexBounds([pl([])])).toBeNull()
  })

  it('NaN 좌표는 범위에서 빼고 센다', () => {
    expect(vertexBounds([pl([[0, 0], [NaN, NaN], [4, 4]])]))
      .toEqual({ minX: 0, minY: 0, maxX: 4, maxY: 4 })
  })
})

describe('clipSegment', () => {
  it('완전히 안쪽이면 그대로', () => {
    expect(clipSegment(2, 2, 8, 8, RECT)).toEqual([2, 2, 8, 8])
  })

  it('완전히 밖이면 null', () => {
    expect(clipSegment(20, 20, 30, 30, RECT)).toBeNull()
  })

  it('경계를 넘는 끝점만 잘린다', () => {
    expect(clipSegment(-5, 5, 5, 5, RECT)).toEqual([0, 5, 5, 5])
  })

  it('양쪽이 다 밖이어도 가로지르면 살린다', () => {
    expect(clipSegment(-10, 5, 30, 5, RECT)).toEqual([0, 5, 10, 5])
  })

  // dx=0 / dy=0 은 t = q/p 가 0 나누기다. 축 평행 선분이 조용히 NaN 이 되면
  // 벽선(수직선)이 전부 사라진다.
  it('축에 평행하고 밖에 있으면 null', () => {
    expect(clipSegment(-1, 0, -1, 10, RECT)).toBeNull()
    expect(clipSegment(0, 20, 10, 20, RECT)).toBeNull()
  })

  it('축에 평행하고 안에 있으면 살린다', () => {
    expect(clipSegment(3, -5, 3, 15, RECT)).toEqual([3, 0, 3, 10])
  })

  // 모서리만 스치는 선분. 길이 0 으로 줄어들며, clipPolyline 이 이걸 버린다.
  it('모서리만 스치면 길이 0 조각', () => {
    expect(clipSegment(10, 20, 10, 10, RECT)).toEqual([10, 10, 10, 10])
  })
})

describe('clipPolyline', () => {
  it('창을 드나들면 여러 조각이 된다', () => {
    // 안 → 밖(오른쪽) → 밖 → 안: 조각 두 개.
    const runs = clipPolyline([[5, 5], [25, 5], [25, 8], [5, 8]], RECT)
    expect(runs).toHaveLength(2)
    expect(runs[0]).toEqual([[5, 5], [10, 5]])
    expect(runs[1]).toEqual([[10, 8], [5, 8]])
  })

  it('이어지는 조각은 하나로 합친다', () => {
    const runs = clipPolyline([[2, 2], [5, 5], [8, 8]], RECT)
    expect(runs).toEqual([[[2, 2], [5, 5], [8, 8]]])
  })

  it('통째로 밖이면 빈 배열', () => {
    expect(clipPolyline([[20, 20], [30, 30]], RECT)).toEqual([])
  })

  // 모서리를 스치기만 한 선분은 길이 0 이다. 살려 두면 아무것도 안 그려지는
  // 폴리라인이 수천 개 쌓여 렌더가 느려진다.
  it('길이 0 으로 줄어든 조각은 버린다', () => {
    expect(clipPolyline([[10, 20], [10, 10]], RECT)).toEqual([])
  })

  it('점이 하나뿐인 폴리라인은 빈 배열', () => {
    expect(clipPolyline([[5, 5]], RECT)).toEqual([])
  })
})

describe('projectThroughViewport', () => {
  it('창 안 폴리라인을 종이 좌표로 옮긴다', () => {
    const r = projectThroughViewport({ polylines: [pl([[0, 0], [500, 500]])], texts: [], hatches: [] }, VP)
    expect(r.polylines).toHaveLength(1)
    expect(r.polylines[0].vertices[0]).toEqual([100, 100])
    expect(r.polylines[0].vertices[1][0]).toBeCloseTo(150, 9)
    expect(r.polylines[0].layer).toBe('0')
    expect(r.dropped.polylines).toBe(0)
  })

  it('창 밖 폴리라인은 버리고 개수를 센다', () => {
    const r = projectThroughViewport({ polylines: [pl([[5000, 5000], [6000, 6000]])], texts: [], hatches: [] }, VP)
    expect(r.polylines).toEqual([])
    expect(r.dropped.polylines).toBe(1)
  })

  // 창을 가로지르는 긴 선 하나 때문에 평면도가 표제란을 덮는 게 걱정거리였다.
  it('창을 넘어가는 선은 창 테두리에서 잘린다', () => {
    const r = projectThroughViewport({ polylines: [pl([[0, 0], [5000, 0]])], texts: [], hatches: [] }, VP)
    expect(r.polylines).toHaveLength(1)
    expect(r.polylines[0].vertices[0]).toEqual([100, 100])
    expect(r.polylines[0].vertices[1][0]).toBeCloseTo(150, 9)
  })

  it('글자는 높이까지 축척을 걸고 기준점으로 걸러낸다', () => {
    const r = projectThroughViewport(
      { polylines: [], texts: [tx(0, 0, 300, 1000), tx(9000, 0)], hatches: [] }, VP)
    expect(r.texts).toHaveLength(1)
    expect(r.texts[0].x).toBe(100)
    expect(r.texts[0].height).toBeCloseTo(30, 9)
    expect(r.texts[0].width).toBeCloseTo(100, 9)
    expect(r.dropped.texts).toBe(1)
  })

  it('width 가 없는 글자는 undefined 를 지킨다', () => {
    const r = projectThroughViewport({ polylines: [], texts: [tx(0, 0)], hatches: [] }, VP)
    expect(r.texts[0].width).toBeUndefined()
  })

  // 테두리가 SVG 문자열이라 정밀하게 자를 수 없다 → 중심으로 살리거나 버린다.
  it('해치는 패스·패턴 간격까지 옮기고 중심으로 걸러낸다', () => {
    const r = projectThroughViewport(
      { polylines: [], texts: [], hatches: [ha(0, 0, 'M0,0L100,0L100,100Z'), ha(9000, 0, 'M0,0Z')] }, VP)
    expect(r.hatches).toHaveLength(1)
    expect(r.dropped.hatches).toBe(1)
    const h = r.hatches[0]
    expect(h.pathData).toBe('M100,100L110,100L110,110Z')
    expect(h.cx).toBe(100)
    expect(h.patternScale).toBeCloseTo(0.2, 9)
    expect(h.patternSpacing).toBeCloseTo(3, 9)
    expect(h.patternDefs[0].spacing).toBeCloseTo(3, 9)
    expect(h.patternDefs[0].dashes[0]).toBeCloseTo(1, 9)
    expect(h.patternDefs[0].dashes[1]).toBeCloseTo(-0.5, 9)
    // 각도는 축척과 무관하다 — 같이 줄이면 줄무늬 방향이 돌아간다.
    expect(h.patternAngle).toBe(45)
    expect(h.patternDefs[0].angle).toBe(45)
  })

  it('원본을 건드리지 않는다', () => {
    const src = { polylines: [pl([[0, 0], [100, 100]])], texts: [tx(0, 0)], hatches: [ha(0, 0, 'M0,0Z')] }
    projectThroughViewport(src, VP)
    expect(src.polylines[0].vertices).toEqual([[0, 0], [100, 100]])
    expect(src.texts[0].height).toBe(100)
    expect(src.hatches[0].patternSpacing).toBe(30)
    expect(src.hatches[0].patternDefs[0].dashes).toEqual([10, -5])
  })
})

describe('toViewportProjection', () => {
  const base = (over: Partial<DxfViewport>): DxfViewport => ({
    layoutName: '배치1',
    centerX: 1000, centerY: 2000,
    viewWidth: 20000, viewHeight: 15000,
    clipMinX: 0, clipMinY: 0, clipMaxX: 0, clipMaxY: 0,
    paperCX: 210, paperCY: 148.5, paperW: 200, paperH: 150,
    ...over,
  })

  it('축척은 종이높이 / 모델뷰높이', () => {
    const p = toViewportProjection(base({}))!
    expect(p.scale).toBeCloseTo(0.01, 12)
    expect(p.modelCX).toBe(1000)
    expect(p.paperCY).toBe(148.5)
  })

  // 0 이면 Infinity → 좌표 전체가 NaN 으로 번진다.
  it('뷰높이가 0 이거나 음수면 null', () => {
    expect(toViewportProjection(base({ viewHeight: 0 }))).toBeNull()
    expect(toViewportProjection(base({ viewHeight: -5 }))).toBeNull()
  })

  it('종이 창 크기가 0 이면 null', () => {
    expect(toViewportProjection(base({ paperH: 0 }))).toBeNull()
    expect(toViewportProjection(base({ paperW: 0 }))).toBeNull()
  })

  it('NaN 도 null', () => {
    expect(toViewportProjection(base({ viewHeight: NaN }))).toBeNull()
  })
})
