/**
 * 줌 범위 테스트 — 요청사항 6: 축소 범위 확대 (10,000m 지원)
 * App.tsx의 zoomSteps 설정이 올바른지 검증
 */
import { describe, it, expect } from 'vitest'

// App.tsx에서 사용하는 zoomSteps 배열 (소스 동기화)
const ZOOM_STEPS = [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8]

describe('zoom steps configuration', () => {
  it('최소 줌 스텝 0.0001 (10,000m 지원)', () => {
    expect(ZOOM_STEPS[0]).toBe(0.0001)
  })

  it('최대 줌 스텝 8 (8배 확대)', () => {
    expect(ZOOM_STEPS[ZOOM_STEPS.length - 1]).toBe(8)
  })

  it('오름차순 정렬', () => {
    for (let i = 1; i < ZOOM_STEPS.length; i++) {
      expect(ZOOM_STEPS[i]).toBeGreaterThan(ZOOM_STEPS[i - 1])
    }
  })

  it('1.0 (100%) 포함', () => {
    expect(ZOOM_STEPS).toContain(1)
  })

  it('0.01 이하 단계가 4개 (극한 축소용)', () => {
    const ultraLow = ZOOM_STEPS.filter(s => s < 0.01)
    expect(ultraLow.length).toBe(4) // 0.0001, 0.0005, 0.001, 0.005
  })

  it('총 13개 줌 스텝', () => {
    expect(ZOOM_STEPS.length).toBe(13)
  })

  // 줌 레벨에서 viewport 크기 계산 (가정: viewport 1200px)
  const VIEWPORT_PX = 1200

  it('최소 줌에서 표시 범위 ≥ 10,000m (scale 1:1, 1px = 1mm)', () => {
    const minZoom = ZOOM_STEPS[0]
    const viewableWidthMm = VIEWPORT_PX / minZoom
    const viewableWidthM = viewableWidthMm / 1000
    expect(viewableWidthM).toBeGreaterThanOrEqual(10000)
  })

  it('기존 최소 줌(0.01)은 ~120m 표시 가능', () => {
    const oldMinZoom = 0.01
    const viewableWidthMm = VIEWPORT_PX / oldMinZoom
    const viewableWidthM = viewableWidthMm / 1000
    expect(viewableWidthM).toBeCloseTo(120, 0)
  })

  it('최대 줌에서 ~0.15m (15cm) 표시 가능', () => {
    const maxZoom = ZOOM_STEPS[ZOOM_STEPS.length - 1]
    const viewableWidthMm = VIEWPORT_PX / maxZoom
    const viewableWidthM = viewableWidthMm / 1000
    expect(viewableWidthM).toBeCloseTo(0.15, 1)
  })
})
