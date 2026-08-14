import { describe, it, expect } from 'vitest'
import {
  shoelaceArea,
  polygonPerimeter,
  pxAreaToM2,
  pxLengthToM,
  measurePolygon,
  type Pt,
} from '../../lib/areaMeasure'

// ── shoelaceArea ──

describe('shoelaceArea', () => {
  it('3점 미만이면 0', () => {
    expect(shoelaceArea([])).toBe(0)
    expect(shoelaceArea([{ x: 0, y: 0 }])).toBe(0)
    expect(shoelaceArea([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBe(0)
  })

  it('직각삼각형 (3-4-5)', () => {
    const pts: Pt[] = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 4 }]
    expect(shoelaceArea(pts)).toBe(6)
  })

  it('정사각형 100×100', () => {
    const pts: Pt[] = [
      { x: 0, y: 0 }, { x: 100, y: 0 },
      { x: 100, y: 100 }, { x: 0, y: 100 },
    ]
    expect(shoelaceArea(pts)).toBe(10000)
  })

  it('직사각형 200×50', () => {
    const pts: Pt[] = [
      { x: 0, y: 0 }, { x: 200, y: 0 },
      { x: 200, y: 50 }, { x: 0, y: 50 },
    ]
    expect(shoelaceArea(pts)).toBe(10000)
  })

  it('반시계 방향도 같은 면적 (abs)', () => {
    const cw: Pt[] = [
      { x: 0, y: 0 }, { x: 100, y: 0 },
      { x: 100, y: 100 }, { x: 0, y: 100 },
    ]
    const ccw = [...cw].reverse()
    expect(shoelaceArea(cw)).toBe(shoelaceArea(ccw))
  })

  it('L자 모양 다각형 (6점)', () => {
    // 10×10 정사각형에서 5×5 오른쪽 위 빠진 L자
    // 면적 = 100 - 25 = 75
    const pts: Pt[] = [
      { x: 0, y: 0 }, { x: 10, y: 0 },
      { x: 10, y: 5 }, { x: 5, y: 5 },
      { x: 5, y: 10 }, { x: 0, y: 10 },
    ]
    expect(shoelaceArea(pts)).toBe(75)
  })

  it('오프셋된 좌표 (원점이 아닌 위치)', () => {
    const pts: Pt[] = [
      { x: 500, y: 300 }, { x: 600, y: 300 },
      { x: 600, y: 400 }, { x: 500, y: 400 },
    ]
    expect(shoelaceArea(pts)).toBe(10000)
  })

  it('음수 좌표', () => {
    const pts: Pt[] = [
      { x: -50, y: -50 }, { x: 50, y: -50 },
      { x: 50, y: 50 }, { x: -50, y: 50 },
    ]
    expect(shoelaceArea(pts)).toBe(10000)
  })

  it('소수점 좌표', () => {
    const pts: Pt[] = [
      { x: 0, y: 0 }, { x: 10.5, y: 0 },
      { x: 10.5, y: 20.3 }, { x: 0, y: 20.3 },
    ]
    expect(shoelaceArea(pts)).toBeCloseTo(213.15, 2)
  })
})

// ── polygonPerimeter ──

describe('polygonPerimeter', () => {
  it('2점 미만이면 0', () => {
    expect(polygonPerimeter([])).toBe(0)
    expect(polygonPerimeter([{ x: 0, y: 0 }])).toBe(0)
  })

  it('2점이면 왕복 거리 (닫힌 폴리곤)', () => {
    const pts: Pt[] = [{ x: 0, y: 0 }, { x: 3, y: 4 }]
    // 5 + 5 = 10 (a→b→a)
    expect(polygonPerimeter(pts)).toBe(10)
  })

  it('정사각형 100×100 둘레 = 400', () => {
    const pts: Pt[] = [
      { x: 0, y: 0 }, { x: 100, y: 0 },
      { x: 100, y: 100 }, { x: 0, y: 100 },
    ]
    expect(polygonPerimeter(pts)).toBe(400)
  })

  it('직사각형 200×50 둘레 = 500', () => {
    const pts: Pt[] = [
      { x: 0, y: 0 }, { x: 200, y: 0 },
      { x: 200, y: 50 }, { x: 0, y: 50 },
    ]
    expect(polygonPerimeter(pts)).toBe(500)
  })

  it('직각삼각형 3-4-5 둘레 = 12', () => {
    const pts: Pt[] = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 4 }]
    expect(polygonPerimeter(pts)).toBe(12)
  })

  it('L자 모양 (6점) 둘레', () => {
    const pts: Pt[] = [
      { x: 0, y: 0 }, { x: 10, y: 0 },
      { x: 10, y: 5 }, { x: 5, y: 5 },
      { x: 5, y: 10 }, { x: 0, y: 10 },
    ]
    // 10 + 5 + 5 + 5 + 5 + 10 = 40
    expect(polygonPerimeter(pts)).toBe(40)
  })
})

// ── 단위 변환 ──

describe('pxAreaToM2', () => {
  it('1:1 스케일 (1px = 1mm)', () => {
    // 1000px × 1000px = 1,000,000 px² = 1,000,000 mm² = 1 m²
    expect(pxAreaToM2(1_000_000, 1)).toBe(1)
  })

  it('1:5 스케일 (pxPerMm = 0.2, 1px = 5mm)', () => {
    // 200px × 200px = 40,000 px²
    // 40,000 / (0.2²) = 40,000 / 0.04 = 1,000,000 mm² = 1 m²
    expect(pxAreaToM2(40_000, 0.2)).toBeCloseTo(1, 10)
  })

  it('1:10 스케일 (pxPerMm = 0.1)', () => {
    // 100px × 100px = 10,000 px²
    // 10,000 / (0.1²) = 10,000 / 0.01 = 1,000,000 mm² = 1 m²
    expect(pxAreaToM2(10_000, 0.1)).toBeCloseTo(1, 10)
  })

  it('0 면적이면 0', () => {
    expect(pxAreaToM2(0, 0.2)).toBe(0)
  })
})

describe('pxLengthToM', () => {
  it('1:1 스케일 (1px = 1mm)', () => {
    // 1000px = 1000mm = 1m
    expect(pxLengthToM(1000, 1)).toBe(1)
  })

  it('1:5 스케일 (pxPerMm = 0.2)', () => {
    // 200px / 0.2 = 1000mm = 1m
    expect(pxLengthToM(200, 0.2)).toBe(1)
  })

  it('1:10 스케일 (pxPerMm = 0.1)', () => {
    // 100px / 0.1 = 1000mm = 1m
    expect(pxLengthToM(100, 0.1)).toBeCloseTo(1, 10)
  })

  it('0 길이면 0', () => {
    expect(pxLengthToM(0, 0.2)).toBe(0)
  })
})

// ── measurePolygon (통합) ──

describe('measurePolygon', () => {
  it('1:1 스케일로 1m × 1m 정사각형', () => {
    // 1m = 1000mm = 1000px (at 1px/mm)
    const pts: Pt[] = [
      { x: 0, y: 0 }, { x: 1000, y: 0 },
      { x: 1000, y: 1000 }, { x: 0, y: 1000 },
    ]
    const result = measurePolygon(pts, 1)
    expect(result.areaM2).toBe(1)
    expect(result.perimeterM).toBe(4)
  })

  it('1:5 스케일로 5m × 3m 직사각형', () => {
    // 5m = 5000mm, at 0.2 px/mm → 1000px
    // 3m = 3000mm, at 0.2 px/mm → 600px
    const pts: Pt[] = [
      { x: 0, y: 0 }, { x: 1000, y: 0 },
      { x: 1000, y: 600 }, { x: 0, y: 600 },
    ]
    const result = measurePolygon(pts, 0.2)
    expect(result.areaM2).toBe(15) // 5 × 3
    expect(result.perimeterM).toBe(16) // 2 × (5 + 3)
  })

  it('1:50 스케일로 실제 욕실 크기 (2.5m × 1.8m)', () => {
    // 2.5m = 2500mm, at 0.02 px/mm → 50px
    // 1.8m = 1800mm, at 0.02 px/mm → 36px
    const pts: Pt[] = [
      { x: 0, y: 0 }, { x: 50, y: 0 },
      { x: 50, y: 36 }, { x: 0, y: 36 },
    ]
    const result = measurePolygon(pts, 0.02)
    expect(result.areaM2).toBe(4.5) // 2.5 × 1.8
    expect(result.perimeterM).toBe(8.6) // 2 × (2.5 + 1.8)
  })

  it('L자 형 거실 (1:10 스케일)', () => {
    // L자: 큰 부분 6m × 4m, 빠진 부분 3m × 2m
    // 면적 = 24 - 6 = 18 m²
    // 6m = 6000mm at 0.1 px/mm → 600px
    // 4m = 4000mm → 400px, 3m → 300px, 2m → 200px
    const pts: Pt[] = [
      { x: 0, y: 0 }, { x: 600, y: 0 },
      { x: 600, y: 200 }, { x: 300, y: 200 },
      { x: 300, y: 400 }, { x: 0, y: 400 },
    ]
    const result = measurePolygon(pts, 0.1)
    expect(result.areaM2).toBe(18)
    // 둘레: 6 + 2 + 3 + 2 + 3 + 4 = 20m
    expect(result.perimeterM).toBe(20)
  })

  it('3점 미만이면 0', () => {
    const result = measurePolygon([{ x: 0, y: 0 }, { x: 100, y: 0 }], 1)
    expect(result.areaM2).toBe(0)
    expect(result.perimeterM).toBe(0.2) // 둘레는 2점이면 왕복
  })
})

// ── drawingState 면적 측정 함수 ──

describe('areaMeasureState', () => {
  // drawingState 동적 import로 격리
  const getState = async () => {
    const mod = await import('../../lib/drawingState')
    return mod
  }

  it('startAreaMeasure → active + callback 설정', async () => {
    const { areaMeasureState, startAreaMeasure, cancelAreaMeasure } = await getState()
    const cb = () => {}
    startAreaMeasure(cb)
    expect(areaMeasureState.active).toBe(true)
    expect(areaMeasureState.callback).toBe(cb)
    cancelAreaMeasure() // cleanup
  })

  it('completeAreaMeasure → callback 호출 + 상태 초기화', async () => {
    const { areaMeasureState, startAreaMeasure, completeAreaMeasure } = await getState()
    let received: { areaM2: number; perimeterM: number } | null = null
    startAreaMeasure((result) => { received = result })

    completeAreaMeasure({ areaM2: 12.30, perimeterM: 14.20 })

    expect(received).toEqual({ areaM2: 12.30, perimeterM: 14.20 })
    expect(areaMeasureState.active).toBe(false)
    expect(areaMeasureState.callback).toBeNull()
  })

  it('cancelAreaMeasure → callback 호출 없이 초기화', async () => {
    const { areaMeasureState, startAreaMeasure, cancelAreaMeasure } = await getState()
    let called = false
    startAreaMeasure(() => { called = true })

    cancelAreaMeasure()

    expect(called).toBe(false)
    expect(areaMeasureState.active).toBe(false)
    expect(areaMeasureState.callback).toBeNull()
  })

  it('CustomEvent 발행 확인', async () => {
    const { startAreaMeasure, cancelAreaMeasure } = await getState()
    const events: boolean[] = []
    const handler = (e: Event) => {
      events.push((e as CustomEvent).detail.active)
    }
    window.addEventListener('bimova:area-measure', handler)

    startAreaMeasure(() => {})
    cancelAreaMeasure()

    window.removeEventListener('bimova:area-measure', handler)
    expect(events).toEqual([true, false])
  })
})
