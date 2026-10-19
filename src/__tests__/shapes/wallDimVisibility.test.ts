/**
 * 치수는 **고른 벽에만** 뜬다.
 *
 * 한이 "선택했을 때만 그 숫자들 보이게끔, 지금은 그냥 계속 보이잖아" 라고 했다.
 * 끄는 설정은 코드에 있었지만 토글 UI 가 없어서 늘 켜진 채였고, 그래서 벽마다
 * 치수선 두 줄 + 화살표 둘 + 연장선 둘 + 숫자가 항상 붙어 있었다.
 *
 * 그리는 중에는 ToolOverlay 가 길이와 꺾임 각을 띄우므로 여기선 안 봐도 된다.
 */
import { describe, it, expect } from 'vitest'
import { shouldShowWallDim } from '../../shapes/WallShape'

describe('shouldShowWallDim', () => {
  it('안 고른 벽에는 안 뜬다 — 이게 바뀐 점이다', () => {
    expect(shouldShowWallDim(true, 0)).toBe(false)
  })

  it('고르면 뜬다', () => {
    expect(shouldShowWallDim(true, 1)).toBe(true)
  })

  it('여럿 골라도 뜬다 — 일부러 고른 것이다', () => {
    expect(shouldShowWallDim(true, 12)).toBe(true)
    expect(shouldShowWallDim(true, 199)).toBe(true)
  })

  it('전체 선택처럼 많이 고르면 접는다 (숫자밭 방지)', () => {
    // 예전엔 **페이지의 벽 수**로 걸었다. 치수가 선택 기준이 된 이상 기준도
    // 선택 개수로 옮겨야 같은 것을 막는다.
    expect(shouldShowWallDim(true, 200)).toBe(false)
    expect(shouldShowWallDim(true, 5000)).toBe(false)
  })

  it('설정을 끄면 골라도 안 뜬다', () => {
    expect(shouldShowWallDim(false, 1)).toBe(false)
    expect(shouldShowWallDim(false, 0)).toBe(false)
  })
})
