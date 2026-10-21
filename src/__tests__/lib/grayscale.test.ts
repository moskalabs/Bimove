/**
 * 흑백(CAD) 모드의 **먹 농도**.
 *
 * "grayscale 로 보면 선이 잘 안 보인다" 는 말이 왔다. 재 보니 값이 옅었다 —
 * 흰 배경(255) 위에서 해치가 98, 글자가 79 였다. 거의 중간 회색이다.
 *
 * 숫자가 어긋난 이유가 따로 있었다. 흑백 처리가 **두 겹**이라, 도형이 칠한
 * `#666`(102) 위에 CSS 가 `contrast(1.15)` 를 또 걸어 98 로 바꿨다. 코드에
 * 적은 값이 화면의 값이 아니었던 것이다. contrast 를 걷어내고 농도를 여기
 * 한 곳으로 모았으므로, **이 숫자가 곧 화면 숫자**다.
 *
 * 그래서 여기서 재는 건 둘이다 — 전보다 진한가, 그리고 단이 유지되는가.
 */
import { describe, it, expect } from 'vitest'
import { grayTones } from '../../lib/grayscale'

/** #rrggbb → 명도(0~255). 회색이라 r=g=b 지만 식은 일반형으로 둔다. */
function lum(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) throw new Error(`색을 못 읽었다: ${hex}`)
  const [r, g, b] = [1, 2, 3].map(i => parseInt(m[i], 16))
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/** 고치기 전에 **화면에 찍히던** 값 (지정값에 contrast(1.15) 를 먹인 결과). */
const BEFORE_LIGHT = { line: 39, text: 79, hatch: 98 }

describe('grayTones — 밝은 배경', () => {
  const t = grayTones(false)

  it('셋 다 **전보다 진하다**', () => {
    expect(lum(t.line)).toBeLessThan(BEFORE_LIGHT.line)
    expect(lum(t.text)).toBeLessThan(BEFORE_LIGHT.text)
    expect(lum(t.hatch)).toBeLessThan(BEFORE_LIGHT.hatch)
  })

  it('선 → 글자 → 해치 **순서**가 있다', () => {
    // 색이 사라진 자리를 농도가 대신한다. 전부 검정이면 해치가 선과 같은
    // 무게가 되어 도면이 검은 덩어리가 된다 (종이공간 줌에서 실제로 겪었다).
    expect(lum(t.line)).toBeLessThan(lum(t.text))
    expect(lum(t.text)).toBeLessThan(lum(t.hatch))
  })

  it('선은 **거의 검정** — 읽으려는 대상이다', () => {
    expect(lum(t.line)).toBeLessThan(30)
  })

  it('해치는 바탕으로 남는다 — 순검정으로 밀지 않는다', () => {
    expect(lum(t.hatch)).toBeGreaterThan(60)
  })
})

describe('grayTones — 어두운 배경', () => {
  const t = grayTones(true)

  it('밝기 방향이 **뒤집힌다**', () => {
    // 어두운 배경에서는 밝을수록 진하게 읽힌다. 여기서 부호를 틀리면
    // 다크+흑백일 때 도면이 배경에 통째로 묻는다.
    expect(lum(t.line)).toBeGreaterThan(200)
    expect(lum(t.text)).toBeGreaterThan(150)
  })

  it('순서는 그대로 — 선이 가장 또렷하다', () => {
    expect(lum(t.line)).toBeGreaterThan(lum(t.text))
    expect(lum(t.text)).toBeGreaterThan(lum(t.hatch))
  })

  it('밝은 배경과 **겹치지 않는다**', () => {
    // 두 묶음이 섞이면 어느 쪽 값인지 눈으로 구분이 안 된다.
    expect(lum(t.hatch)).toBeGreaterThan(lum(grayTones(false).hatch))
  })
})

describe('grayTones — 형식', () => {
  it('셋 다 #rrggbb 회색이다', () => {
    for (const dark of [false, true]) {
      const t = grayTones(dark)
      for (const v of [t.line, t.text, t.hatch]) {
        expect(v).toMatch(/^#[0-9a-f]{6}$/)
        // 회색이 아니면 흑백 모드에서 색이 새어 나온다.
        expect(v.slice(1, 3)).toBe(v.slice(3, 5))
        expect(v.slice(3, 5)).toBe(v.slice(5, 7))
      }
    }
  })
})
