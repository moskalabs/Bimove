/**
 * 벽이 **얇게** 보이는가.
 *
 * 한이 경쟁 제품(Rayon)과 나란히 놓고 "같은 0.10m 인데 우리 건 너무 두껍다"
 * 고 했다. 두께 값이 아니라 **그리는 방식**이 문제였다.
 *
 *   1. 기본 채움이 '#555' (진회색) 이었다 — 0.10m 벽이 시커먼 막대가 된다.
 *      평면도에서 벽은 가는 윤곽선 두 줄 + **흰 속**이 맞다.
 *   2. 윤곽선 두께를 shape 좌표로 줬다. tldraw 는 줌을 **CSS transform** 으로
 *      걸기 때문에 strokeWidth=1 이 화면에서 `1 × zoom` px 이 된다. 줌을
 *      올릴수록 끝없이 두꺼워진다 (lib/dxfStroke 주석에 같은 사고가 적혀 있다 —
 *      종이공간 7배 줌에서 도면이 검은 덩어리가 됐다).
 *
 * 여기서는 2번을 묶는다. `screenStrokeWidth` 가 --tl-scale 로 줌을 상쇄하는
 * 식을 내는지 본다 — 그게 "줌과 무관한 선" 의 유일한 수단이다.
 */
import { describe, it, expect } from 'vitest'
import { screenStrokeWidth, dxfStrokePx } from '../../lib/dxfStroke'

describe('화면 기준 선 두께', () => {
  it('--tl-scale 로 줌을 상쇄한다', () => {
    // vector-effect="non-scaling-stroke" 로는 안 된다. 그건 SVG 좌표계 변환만
    // 상쇄하는데, tldraw 의 줌은 컨테이너 CSS transform 이라 그 앞에서 돈다.
    expect(screenStrokeWidth(0.8)).toBe('calc(0.8px * var(--tl-scale, 1))')
  })

  it('--tl-scale 이 없는 데서도 깨지지 않는다', () => {
    // 폴백이 1 이라, 변수가 없으면 그냥 그 px 로 그려진다.
    expect(screenStrokeWidth(2)).toContain('var(--tl-scale, 1)')
  })

  it('lineweight 가 없으면 1px — 두께가 아니라 **색**으로 구분한다', () => {
    expect(dxfStrokePx(0)).toBe(1.0)
  })

  it('lineweight 가 있으면 눈에 구분되게 벌린다', () => {
    expect(dxfStrokePx(25)).toBe(1)     // 0.25mm
    expect(dxfStrokePx(50)).toBe(2)     // 0.50mm
    expect(dxfStrokePx(100)).toBe(4)    // 1.00mm
  })

  it('아무리 굵어도 6px 를 안 넘는다', () => {
    // 안 막으면 lineweight 가 큰 레이어 하나가 화면을 덮는다.
    expect(dxfStrokePx(10_000)).toBe(6)
  })

  it('아무리 가늘어도 0.5px 밑으로 안 간다', () => {
    // 0 이 되면 선이 통째로 사라진다.
    expect(dxfStrokePx(1)).toBe(0.5)
  })
})
