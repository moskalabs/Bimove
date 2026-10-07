/**
 * removeOutlierSegments 회귀 테스트
 *
 * 이 필터는 두 가지를 동시에 해내야 한다 — 둘 중 하나만 맞추면 반대쪽이 망가진다.
 *
 *  1. **본체 가장자리를 자르지 말 것.** 예전 구현은 5~95 퍼센타일 bbox 로 잘라서,
 *     모델공간에 시트를 가로로 늘어놓은 도면의 Y 양끝을 먹었다. 리비전 구름의
 *     위아래 호가 통째로 사라지고 좌우 호만 남아 "{ }" 모양이 됐다.
 *  2. **뚝 떨어진 쓰레기는 걷어낼 것.** 안 걷어내면 bbox 가 부풀고 autoScale 이
 *     쪼그라들어서, 도면이 시트 한가운데 티끌만 하게 들어간다.
 */
import { describe, it, expect } from 'vitest'
import { removeOutlierSegments, type RawSeg } from '../../lib/dxf'

/** (x,y) 에서 길이 1 짜리 수평 세그먼트 */
function seg(x: number, y: number): RawSeg {
  return { x1: x, y1: y, dx: 1, dy: 0 }
}

/** w×h 격자로 촘촘한 "도면 본체" 를 만든다 (endpoint 400개 넘기려면 200개 이상 필요) */
function body(cols: number, rows: number, ox = 0, oy = 0): RawSeg[] {
  const out: RawSeg[] = []
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) out.push(seg(ox + i * 2, oy + j * 2))
  }
  return out
}

describe('removeOutlierSegments', () => {
  it('쓰레기가 없으면 하나도 안 지운다', () => {
    const segs = body(30, 30)
    expect(removeOutlierSegments(segs)).toHaveLength(segs.length)
  })

  it('세그먼트가 적으면(endpoint 400 미만) 통째로 건너뛴다', () => {
    const segs = [...body(5, 5), seg(1e6, 1e6)]
    expect(removeOutlierSegments(segs)).toHaveLength(segs.length)
  })

  it('뚝 떨어진 쓰레기를 걷어낸다', () => {
    const segs = [...body(30, 30), seg(1e6, 1e6), seg(1e6 + 5, 1e6 + 5)]
    const kept = removeOutlierSegments(segs)
    expect(kept).toHaveLength(900)
    expect(kept.every(s => s.x1 < 1e5)).toBe(true)
  })

  it('본체 가장자리(리비전 구름)는 안 자른다 — 가로로 긴 도면', () => {
    // 폭 600, 높이 60 짜리 납작한 도면. 구름이 위아래 끝단을 차지한다.
    const segs = body(300, 30)
    const yTop = Math.max(...segs.map(s => s.y1))
    const kept = removeOutlierSegments(segs)
    expect(kept).toHaveLength(segs.length)
    expect(kept.some(s => s.y1 === yTop)).toBe(true)
    expect(kept.some(s => s.y1 === 0)).toBe(true)
  })

  it('본체가 둘로 나뉘어도 절반 넘게 지우려 들면 거부한다', () => {
    // 같은 크기 덩어리 두 개가 멀리 떨어져 있다 — 어느 쪽이 "본체" 인지 알 수 없다.
    const segs = [...body(30, 30), ...body(30, 30, 1e6, 1e6)]
    expect(removeOutlierSegments(segs)).toHaveLength(segs.length)
  })

  it('빈 공간이 작으면(본체와 이어진 덩어리) 안 지운다', () => {
    // 본체 X 범위 0~58. 간격 한도는 IQR 의 25% 라 10 정도 떨어진 건 본체로 본다.
    const segs = [...body(30, 30), ...body(3, 30, 66, 0)]
    expect(removeOutlierSegments(segs)).toHaveLength(segs.length)
  })
})
