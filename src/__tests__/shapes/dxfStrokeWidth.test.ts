/**
 * DXF 선 두께 회귀 테스트
 *
 * 성수 평면 DXF 의 "2 - Plan" 탭을 열면 도면 전체가 검은 덩어리로 나왔다.
 *
 * 원인: 메인 path 가 `strokeWidth={1.0}` + `vectorEffect="non-scaling-stroke"` 였다.
 * 주석은 "non-scaling-stroke: 화면 px 단위" 라고 적혀 있었지만 사실이 아니다.
 * tldraw 는 줌을 SVG 안쪽 변환이 아니라 컨테이너 CSS transform 으로 건다
 * (.tl-html-layer { transform: scale(zoom) translate(...) }).
 * non-scaling-stroke 는 SVG 좌표계 변환만 상쇄하므로 CSS transform 에는 무효 —
 * 즉 두께가 `1 * zoom` 화면 px 로 그려졌다.
 *
 * 측정값: 모형 탭(줌 ~1) 은 선이 1px, Plan 탭(종이공간 맞춤 줌 ~7) 은 7~8px 순수 검정.
 * 같은 세그먼트를 1px 로 로컬 래스터라이즈하면 평면이 멀쩡하게 읽힌다 →
 * 기하가 빽빽한 게 아니라 렌더 결함.
 *
 * 수정: tldraw 자신의 관용구인 --tl-scale (= calc(1 / var(--tl-zoom))) 로 나눈다.
 * 모형 탭은 줌이 1 이라 결과가 그대로 1px — 되던 건 안 건드린다.
 */
import { describe, it, expect } from 'vitest'
import { dxfStrokePx, screenStrokeWidth } from '../../shapes/DxfGroupShape'
import { readFileSync } from 'node:fs'

describe('dxfStrokePx', () => {
  it('lineweight 가 없으면 1px', () => {
    // 성수 Plan 의 세그먼트 149802개 전부 lineweight 가 undefined → 0 으로 들어온다
    expect(dxfStrokePx(0)).toBe(1.0)
  })

  it('0.25mm → 1px, 0.50mm → 2px, 1.00mm → 4px (두께 차이가 구분된다)', () => {
    expect(dxfStrokePx(25)).toBe(1)
    expect(dxfStrokePx(50)).toBe(2)
    expect(dxfStrokePx(100)).toBe(4)
  })

  it('아주 얇은 lineweight 도 0.5px 밑으로는 안 내려간다', () => {
    // 성수 LAYER 테이블의 최대값이 9 (0.09mm) 였다 → 0.36px 이지만 0.5 로 올린다
    expect(dxfStrokePx(9)).toBe(0.5)
    expect(dxfStrokePx(1)).toBe(0.5)
  })

  it('두꺼운 lineweight 는 6px 에서 멈춘다', () => {
    expect(dxfStrokePx(150)).toBe(6)
    expect(dxfStrokePx(211)).toBe(6)
  })
})

describe('screenStrokeWidth', () => {
  it('--tl-scale 로 나눠서 줌과 무관한 화면 두께를 만든다', () => {
    expect(screenStrokeWidth(1)).toBe('calc(1px * var(--tl-scale, 1))')
    expect(screenStrokeWidth(2.5)).toBe('calc(2.5px * var(--tl-scale, 1))')
  })

  it('--tl-zoom 이 안 꽂혀도(fallback 1) 기존 동작과 같다', () => {
    // tldraw.css 의 .tl-container 기본값은 --tl-zoom: 1 → --tl-scale: 1.
    // 폴백도 1 이므로 최악의 경우에도 수정 전과 동일한 두께다.
    expect(screenStrokeWidth(1)).toContain('var(--tl-scale, 1)')
  })

  it('줌 배율을 대입하면 화면 두께가 상수로 유지된다', () => {
    // calc 를 수동 평가해 의도를 못 박는다: px * (1 / zoom) * zoom === px
    const evalAt = (px: number, zoom: number) => {
      const m = screenStrokeWidth(px).match(/calc\((-?[\d.]+)px \* var\(--tl-scale, 1\)\)/)
      expect(m).not.toBeNull()
      const shapeUnits = Number(m![1]) * (1 / zoom)
      return shapeUnits * zoom // CSS transform: scale(zoom)
    }
    for (const zoom of [0.1, 1, 7.03, 64]) {
      expect(evalAt(1, zoom)).toBeCloseTo(1, 10)
    }
  })
})

describe('메인 path 렌더 (소스 가드)', () => {
  // vitest 는 프로젝트 루트에서 돈다. tldraw 도형을 띄우지 않고 JSX 를 직접 본다 —
  // non-scaling-stroke 를 "화면 px 보장" 이라고 착각해 되돌리는 걸 막는 게 목적이다.
  const src = readFileSync('src/shapes/DxfGroupShape.tsx', 'utf-8').replace(/\r\n/g, '\n')

  /** `{shape.props.pathData && (` 로 시작하는 메인 아웃라인 path JSX */
  function mainPathJsx(): string {
    const i = src.indexOf('{shape.props.pathData && (')
    if (i < 0) throw new Error('메인 path JSX 를 찾지 못했다')
    const close = src.indexOf('/>', i)
    if (close < 0) throw new Error('메인 path JSX 의 끝을 찾지 못했다')
    return src.slice(i, close)
  }

  it('non-scaling-stroke 에 의존하지 않는다', () => {
    // CSS transform 줌 앞에서는 무효다 — 이걸 믿으면 줌 배수만큼 선이 두꺼워진다
    expect(mainPathJsx()).not.toContain('non-scaling-stroke')
  })

  it('--tl-scale 기반 CSS 두께를 쓴다', () => {
    expect(mainPathJsx()).toContain('screenStrokeWidth(strokeW)')
  })
})
