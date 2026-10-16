/**
 * 읽기 전용 판정 테스트.
 *
 * 도면 편집은 정밀한 포인팅과 넓은 화면이 전제다. 손가락으로는 스냅 반경(12px)
 * 안을 집을 수 없고, 좁은 화면에서는 도구 바가 캔버스를 다 덮는다.
 */
import { describe, it, expect } from 'vitest'
import { isReadonlyViewport, probeViewport, READONLY_MAX_WIDTH } from '../../lib/readonlyMode'

describe('isReadonlyViewport', () => {
  it('넓은 화면 + 마우스면 편집 가능', () => {
    expect(isReadonlyViewport({ width: 1920, coarsePointer: false })).toBe(false)
    expect(isReadonlyViewport({ width: 1366, coarsePointer: false })).toBe(false)
  })

  it('중단점 이하면 읽기 전용', () => {
    expect(isReadonlyViewport({ width: READONLY_MAX_WIDTH, coarsePointer: false })).toBe(true)
    expect(isReadonlyViewport({ width: 768, coarsePointer: false })).toBe(true)
    expect(isReadonlyViewport({ width: 390, coarsePointer: false })).toBe(true)
  })

  it('중단점 바로 위는 편집 가능 (경계)', () => {
    expect(isReadonlyViewport({ width: READONLY_MAX_WIDTH + 1, coarsePointer: false })).toBe(false)
  })

  it('손가락 입력이면 폭과 무관하게 읽기 전용', () => {
    // 아이패드 프로 가로는 1366px 이라 폭 기준만으로는 안 걸린다.
    expect(isReadonlyViewport({ width: 1366, coarsePointer: true })).toBe(true)
    expect(isReadonlyViewport({ width: 2560, coarsePointer: true })).toBe(true)
  })
})

describe('probeViewport', () => {
  it('jsdom 창을 읽는다', () => {
    // 실제 창 값을 쓰는지 (하드코딩이 아닌지) 확인한다.
    const probe = probeViewport()
    expect(probe.width).toBe(window.innerWidth)
    expect(typeof probe.coarsePointer).toBe('boolean')
  })
})
