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
 *  3. **본체가 하나라고 믿지 말 것.** 모델공간에 도면 여러 장을 멀리 떼어놓은
 *     파일이 흔하다. 사분위에서 걸어나가며 첫 빈 공간에서 끊던 구현은 제일 큰
 *     덩어리 하나만 남겼고, 리닝 파일에서 세그먼트 37033개 중 11563개(31%) 가
 *     — 가구(F-FUR-h), 벽(F_WALL), 창문(E-WIN) 이 — 쓰레기로 버려졌다.
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

  it('본체가 둘로 나뉘어 있으면 둘 다 본체로 본다', () => {
    // 같은 크기 덩어리 두 개가 멀리 떨어져 있다 — 어느 쪽도 쓰레기가 아니다.
    // (예전엔 한쪽을 통째로 지우려 들다가 MAX_OUTLIER_DROP_RATIO 에 걸려서
    //  겨우 살았다. 지금은 양쪽 다 좌표가 많으니 애초에 후보가 아니다.)
    const segs = [...body(30, 30), ...body(30, 30, 1e6, 1e6)]
    expect(removeOutlierSegments(segs)).toHaveLength(segs.length)
  })

  it('빈 공간이 작으면(본체와 이어진 덩어리) 안 지운다', () => {
    // 본체 X 범위 0~58. 간격 한도는 IQR 의 25% 라 10 정도 떨어진 건 본체로 본다.
    const segs = [...body(30, 30), ...body(3, 30, 66, 0)]
    expect(removeOutlierSegments(segs)).toHaveLength(segs.length)
  })

  it('도면 여러 장이 멀리 떨어져 있어도 작은 장까지 살린다 — 리닝 파일 모양', () => {
    // 실측한 리닝 파일의 축소판. 큰 도면 한 장(96%) + 작은 도면 두 장(각 1.5%)
    // + 길 잃은 점 2개(각 0.05%). 작은 장도 쓰레기와 30배 떨어져 있다.
    const big = body(100, 20)                          // 2000개, X 0~199
    const a = body(4, 8, 1_000_000, 1_000_000)         //   32개
    const b = body(4, 8, 2_000_000, 2_000_000)         //   32개
    const strays = [seg(3e6, 3e6), seg(4e6, 4e6)]      //    2개 — 이것만 쓰레기
    const kept = removeOutlierSegments([...big, ...a, ...b, ...strays])

    expect(kept).toHaveLength(big.length + a.length + b.length)
    expect(kept.filter(s => s.x1 >= 1e6 && s.x1 < 2e6)).toHaveLength(a.length)
    expect(kept.filter(s => s.x1 >= 2e6 && s.x1 < 3e6)).toHaveLength(b.length)
    expect(kept.some(s => s.x1 >= 3e6)).toBe(false)
  })

  it('떨어진 덩어리가 전체의 0.3% 미만이면 쓰레기로 본다', () => {
    // 본체 좌표 4000개 → 하한 12개. 떨어진 덩어리는 좌표 10개라 못 넘긴다.
    const segs = [...body(100, 20), ...body(5, 1, 1e6, 1e6)]
    expect(removeOutlierSegments(segs)).toHaveLength(2000)
  })

  it('도면이 작으면 비율 대신 절대 하한(좌표 8개)으로 가린다', () => {
    // 본체 좌표 800개 → 비율로는 2.4개가 하한이 되어 티끌도 통과한다.
    // OUTLIER_CLUSTER_MIN 이 8개로 받쳐준다.
    const small = body(20, 20)                                  // 400개
    const tiny = [...small, ...body(3, 1, 1e6, 1e6)]            // 좌표 6개 → 쓰레기
    expect(removeOutlierSegments(tiny)).toHaveLength(400)

    const enough = [...small, ...body(5, 1, 1e6, 1e6)]          // 좌표 10개 → 도면
    expect(removeOutlierSegments(enough)).toHaveLength(405)
  })
})
