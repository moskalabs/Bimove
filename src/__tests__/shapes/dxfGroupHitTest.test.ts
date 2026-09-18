/**
 * DxfGroupShape hitTestPoint / isPointNearPath / distPointToSeg 테스트
 * 요청사항 7: 개별 선 선택 버그 수정
 */
import { describe, it, expect } from 'vitest'
import { isPointNearPath, distPointToSeg } from '../../shapes/DxfGroupShape'

// ─── distPointToSeg ───

describe('distPointToSeg', () => {
  it('점이 선분 위에 있으면 거리 0', () => {
    // 수평선분 (0,0)-(100,0), 점 (50,0) → 정확히 위
    expect(distPointToSeg(50, 0, 0, 0, 100, 0)).toBeCloseTo(0)
  })

  it('점이 선분에서 수직으로 떨어져 있음', () => {
    // 수평선분 (0,0)-(100,0), 점 (50,10) → 거리 10
    expect(distPointToSeg(50, 10, 0, 0, 100, 0)).toBeCloseTo(10)
  })

  it('점이 선분 시작점 밖에 있음 (투영 t < 0)', () => {
    // 수평선분 (10,0)-(100,0), 점 (0,0) → 시작점까지 거리 10
    expect(distPointToSeg(0, 0, 10, 0, 100, 0)).toBeCloseTo(10)
  })

  it('점이 선분 끝점 밖에 있음 (투영 t > 1)', () => {
    // 수평선분 (0,0)-(100,0), 점 (110,0) → 끝점까지 거리 10
    expect(distPointToSeg(110, 0, 0, 0, 100, 0)).toBeCloseTo(10)
  })

  it('영길이 선분 (점)에 대한 거리', () => {
    // 선분 길이 0: (50,50)-(50,50), 점 (53,54)
    expect(distPointToSeg(53, 54, 50, 50, 50, 50)).toBeCloseTo(5) // sqrt(9+16)
  })

  it('수직선분', () => {
    // 수직선분 (0,0)-(0,100), 점 (7,50)
    expect(distPointToSeg(7, 50, 0, 0, 0, 100)).toBeCloseTo(7)
  })

  it('대각선 선분', () => {
    // 대각선 (0,0)-(100,100), 점 (0,100) → 가장 가까운 점 (50,50), 거리 = sqrt(2500+2500) ≈ 70.71
    expect(distPointToSeg(0, 100, 0, 0, 100, 100)).toBeCloseTo(70.71, 1)
  })

  it('대각선 선분 위의 점', () => {
    // 대각선 (0,0)-(100,100), 점 (50,50) → 거리 0
    expect(distPointToSeg(50, 50, 0, 0, 100, 100)).toBeCloseTo(0)
  })

  it('대각선 선분에서 수직 거리', () => {
    // 대각선 (0,0)-(10,0)에서 (5,3) → 거리 3
    expect(distPointToSeg(5, 3, 0, 0, 10, 0)).toBeCloseTo(3)
  })
})

// ─── isPointNearPath ───

describe('isPointNearPath', () => {
  const simplePath = 'M0,0L100,0 M0,50L100,50'

  it('선분 위의 점 → true', () => {
    expect(isPointNearPath(simplePath, { x: 50, y: 0 }, 6)).toBe(true)
  })

  it('선분에서 margin 이내 점 → true', () => {
    expect(isPointNearPath(simplePath, { x: 50, y: 5 }, 6)).toBe(true)
  })

  it('선분에서 margin 밖 점 → false', () => {
    expect(isPointNearPath(simplePath, { x: 50, y: 25 }, 6)).toBe(false)
  })

  it('두번째 선분 근처 → true', () => {
    expect(isPointNearPath(simplePath, { x: 30, y: 48 }, 6)).toBe(true)
  })

  it('빈 pathData → false', () => {
    expect(isPointNearPath('', { x: 50, y: 50 }, 6)).toBe(false)
  })

  it('끝점 근처 → true', () => {
    expect(isPointNearPath(simplePath, { x: 103, y: 0 }, 6)).toBe(true)
  })

  it('끝점에서 먼 점 → false', () => {
    expect(isPointNearPath(simplePath, { x: 110, y: 0 }, 6)).toBe(false)
  })

  it('margin 0이면 정확한 점만', () => {
    expect(isPointNearPath(simplePath, { x: 50, y: 0 }, 0)).toBe(true)
    expect(isPointNearPath(simplePath, { x: 50, y: 1 }, 0)).toBe(false)
  })

  it('복잡한 pathData (여러 세그먼트)', () => {
    const complex = 'M0,0L100,0 M0,50L100,50 M0,100L100,100 M50,0L50,100'
    // 수직선분 (50,0)-(50,100) 위의 점
    expect(isPointNearPath(complex, { x: 50, y: 75 }, 6)).toBe(true)
    // 모든 선분에서 먼 점
    expect(isPointNearPath(complex, { x: 25, y: 25 }, 3)).toBe(false)
  })

  it('소수점 좌표', () => {
    const path = 'M10.5,20.3L200.7,20.3'
    expect(isPointNearPath(path, { x: 100, y: 20.3 }, 1)).toBe(true)
    expect(isPointNearPath(path, { x: 100, y: 30 }, 1)).toBe(false)
  })

  it('음수 좌표', () => {
    const path = 'M-50,-50L50,-50'
    expect(isPointNearPath(path, { x: 0, y: -50 }, 1)).toBe(true)
    expect(isPointNearPath(path, { x: 0, y: 0 }, 1)).toBe(false)
  })

  it('large margin은 먼 점도 매칭', () => {
    expect(isPointNearPath(simplePath, { x: 50, y: 25 }, 30)).toBe(true)
  })
})
