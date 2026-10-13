/**
 * clipToSheet / sheetRect 회귀 테스트 — 종이 탭을 시트 범위로 자른다
 *
 * 종이공간에선 "도면 본체" 가 추측이 아니다. LAYOUT 이 limits(gc 14/24/15/25)로
 * 시트 크기를 적어놓으니 그걸 쓰면 된다. 간격 기준 아웃라이어 필터
 * ([[removeOutlierSegments]]) 는 종이에서 양쪽으로 틀렸다 —
 *
 *  - 성수 파일 Plan 탭: 시트(108k×92k) 밖 X -7,268,816 에 가구가 세워져 있다
 *    (F-FUR 437개 + C-FUR 16개). 덩어리마다 좌표가 수천 개씩이라 "양이 티끌"
 *    로는 안 걸리고, bbox 가 60배 넓어져 자동 맞춤이 도면을 티끌로 만들었다.
 *  - 리닝 파일 Layout1: 거꾸로, 멀쩡한 시트(높이 47438)를 Y 로 687 단위만
 *    남기고 잘랐다. 시트 안의 여백을 덩어리 경계로 오해한 것이다.
 *
 * 실측: 시트 범위 + 여유 20% 로 자르면 리닝 두 탭은 한 개도 안 잘리고,
 * 성수 Plan 은 8222개(8%)만 떨어져 나가 bbox 가 시트의 1.1배로 돌아온다.
 */
import { describe, it, expect } from 'vitest'
import { clipToSheet, type RawSeg } from '../../lib/dxf'
import { sheetRect, type DxfLayout } from '../../lib/dxf-shared'

/** 시트 0,0~100,100. 여유 20% 를 더하면 화면 좌표로 X -20~120, Y -120~20 이다. */
const SHEET = { minX: 0, minY: 0, maxX: 100, maxY: 100 }

/**
 * (x,y) 에서 길이 1 짜리 수평 세그먼트. **화면 좌표** 다 — 세그먼트의 Y 는
 * 이미 반전돼 있어서(`Y = -dxfY * scale`) 시트 안쪽이 음수 Y 가 된다.
 */
function seg(x: number, y: number): RawSeg {
  return { x1: x, y1: y, dx: 1, dy: 0 }
}

/** cols×rows 격자 덩어리. 화면 좌표라 아래로(Y−) 깔린다. */
function blob(cols: number, rows: number, ox = 0, oy = 0): RawSeg[] {
  const out: RawSeg[] = []
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) out.push(seg(ox + i * 2, oy - j * 2))
  }
  return out
}

function layout(ext: Partial<DxfLayout>): DxfLayout {
  return {
    name: 'Plan', isModelSpace: false, tabOrder: 1,
    paperWidth: 420, paperHeight: 297, ...ext,
  }
}

describe('clipToSheet', () => {
  it('시트 안 도형은 하나도 안 자른다', () => {
    const segs = blob(20, 20)                       // X 0~39, Y -38~0
    expect(clipToSheet(segs, SHEET, 1)).toHaveLength(segs.length)
  })

  it('시트 한참 밖 덩어리를 잘라낸다 — 성수 Plan 모양', () => {
    // 종이에서 X 로 7백만 단위 떨어진 가구. 좌표가 수백 개라 간격 필터로는
    // "양이 티끌" 에 안 걸려 살아남던 것들이다.
    const inside = blob(20, 20)
    const furniture = blob(10, 10, -7_268_816, 0)
    const kept = clipToSheet([...inside, ...furniture], SHEET, 1)
    expect(kept).toHaveLength(inside.length)
    expect(kept.every(s => s.x1 >= 0)).toBe(true)
  })

  it('여유 20% 안쪽은 남기고 밖은 자른다', () => {
    const inside = blob(20, 20)
    const near = seg(110, -50)                      // hiX 120 안쪽 — 남는다
    const far = seg(130, -50)                       // 밖 — 잘린다
    const kept = clipToSheet([...inside, near, far], SHEET, 1)
    expect(kept).toContain(near)
    expect(kept).not.toContain(far)
  })

  it('Y 반전을 지킨다 — 시트 위아래를 뒤집어 가리지 않는다', () => {
    // 시트는 DXF Y 0~100 → 화면 Y -100~0. 여유 20 을 더해 -120~20.
    const inside = blob(20, 20)
    const above = seg(50, -110)                     // DXF Y 110 — 여유 안쪽
    const below = seg(50, 30)                       // DXF Y -30 — 여유 밖
    const kept = clipToSheet([...inside, above, below], SHEET, 1)
    expect(kept).toContain(above)
    expect(kept).not.toContain(below)
  })

  it('경계를 걸친 세그먼트는 남긴다 — 도면틀을 반 토막 내지 않는다', () => {
    const inside = blob(20, 20)
    const crossing: RawSeg = { x1: 100, y1: -50, dx: 1000, dy: 0 }
    expect(clipToSheet([...inside, crossing], SHEET, 1)).toContain(crossing)
  })

  it('scale 을 반영한다', () => {
    // scale 10 → 시트가 화면 좌표로 X -200~1200 이 된다.
    const far = seg(500, -500)
    const segs = [...blob(20, 20), far]
    expect(clipToSheet(segs, SHEET, 1)).not.toContain(far)
    expect(clipToSheet(segs, SHEET, 10)).toContain(far)
  })

  it('절반 넘게 지우게 되면 통째로 포기한다', () => {
    // limits 가 도형과 안 맞는 파일이라는 뜻이니 우리 전제가 틀렸다고 본다.
    // (아웃라이어 필터의 MAX_OUTLIER_DROP_RATIO 와 같은 안전망)
    const inside = blob(5, 5)                       // 25개
    const outside = blob(10, 10, 1e6, 0)            // 100개
    const segs = [...inside, ...outside]
    expect(clipToSheet(segs, SHEET, 1)).toHaveLength(segs.length)
  })
})

describe('sheetRect', () => {
  it('limits 넷이 멀쩡하면 시트로 쓴다', () => {
    const r = sheetRect(layout({ extMinX: -13246, extMinY: -59276, extMaxX: 94743, extMaxY: 32495 }))
    expect(r).toEqual({ minX: -13246, minY: -59276, maxX: 94743, maxY: 32495 })
  })

  it('0,0~0,0 이면 안 쓴다 — DWG→DXF 변환물에 그대로 남아 있는 파일이 있다', () => {
    expect(sheetRect(layout({ extMinX: 0, extMinY: 0, extMaxX: 0, extMaxY: 0 }))).toBeNull()
  })

  it('넷 중 하나라도 없으면 안 쓴다', () => {
    expect(sheetRect(layout({ extMinX: 0, extMinY: 0, extMaxX: 100 }))).toBeNull()
    expect(sheetRect(layout({}))).toBeNull()
  })

  it('가로나 세로가 뒤집혀 있으면 안 쓴다', () => {
    expect(sheetRect(layout({ extMinX: 100, extMinY: 0, extMaxX: 0, extMaxY: 100 }))).toBeNull()
    expect(sheetRect(layout({ extMinX: 0, extMinY: 100, extMaxX: 100, extMaxY: 0 }))).toBeNull()
  })
})
