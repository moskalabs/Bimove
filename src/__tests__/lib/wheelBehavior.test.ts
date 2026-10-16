/**
 * 휠 감지 회귀 테스트
 *
 * 증상: 공간지정 도구를 쓰는 중에 휠 확대/축소가 반대로 동작했다.
 *
 * 원인: 자동 감지가 `.tl-container` 안에서만 돌았다. 공간지정·면적측정
 * 오버레이는 `<Tldraw>` 의 형제로 붙어서 그 밖이라, 오버레이 위에서 굴린 휠은
 * 감지를 그냥 건너뛰었다. 그러면 wheelBehavior 가 갱신되지 않고 직전 값
 * (터치패드로 잡혀 있던 'pan')이 그대로 쓰인다. 오버레이는 자기 휠을
 * editor.dispatch 로 직접 넘기므로, 그 낡은 설정으로 처리돼 동작이 뒤집힌 것처럼
 * 보였다.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { detectWheelBehavior, isCanvasWheelTarget, normalizeWheelDelta } from '../../lib/wheelBehavior'

describe('detectWheelBehavior', () => {
  it('마우스 라인 스크롤은 확대 (deltaMode 1)', () => {
    expect(detectWheelBehavior({ ctrlKey: false, deltaMode: 1, deltaY: 3 })).toBe('zoom')
  })

  it('마우스 픽셀 스크롤은 확대 — 큰 정수값', () => {
    expect(detectWheelBehavior({ ctrlKey: false, deltaMode: 0, deltaY: 100 })).toBe('zoom')
    expect(detectWheelBehavior({ ctrlKey: false, deltaMode: 0, deltaY: -120 })).toBe('zoom')
  })

  it('터치패드 두손가락은 이동 — 작거나 소수점 delta', () => {
    expect(detectWheelBehavior({ ctrlKey: false, deltaMode: 0, deltaY: 12 })).toBe('pan')
    expect(detectWheelBehavior({ ctrlKey: false, deltaMode: 0, deltaY: 53.5 })).toBe('pan')
  })

  it('ctrl 이 붙으면 pan 으로 둔다 — tldraw 가 뒤집어 확대가 된다', () => {
    // 터치패드 핀치가 ctrl 을 달고 온다. 여기서 zoom 으로 주면 두 번 뒤집혀 어긋난다.
    expect(detectWheelBehavior({ ctrlKey: true, deltaMode: 0, deltaY: 100 })).toBe('pan')
  })
})

describe('isCanvasWheelTarget', () => {
  afterEach(() => { document.body.innerHTML = '' })

  const mount = (html: string) => {
    document.body.innerHTML = html
    return document.querySelector('[data-probe]')
  }

  it('tldraw 캔버스 안이면 대상이다', () => {
    const el = mount('<div class="tl-container"><div data-probe></div></div>')
    expect(isCanvasWheelTarget(el)).toBe(true)
  })

  it('오버레이 캡처 레이어도 대상이다 — 이게 이 버그의 핵심이다', () => {
    // 공간지정·면적측정 오버레이는 Tldraw 의 형제라 .tl-container 밖에 있다.
    const el = mount('<main class="canvas-area"><div class="area-measure-capture" data-probe></div></main>')
    expect(isCanvasWheelTarget(el)).toBe(true)
  })

  it('패널이나 바 위에서는 대상이 아니다', () => {
    const el = mount('<aside class="rbar"><div data-probe></div></aside>')
    expect(isCanvasWheelTarget(el)).toBe(false)
  })

  it('target 이 없어도 터지지 않는다', () => {
    expect(isCanvasWheelTarget(null)).toBe(false)
  })
})

// ── 오버레이가 직접 쏘는 휠의 부호 ──
//
// tldraw 는 받은 delta 가 **이미 뒤집혀 있다고** 가정한다 (자기 리스너가
// normalizeWheel 로 부호를 뒤집어 넣는다). 오버레이는 날것을 그대로 넘겨서
// 공간지정·면적측정 중에는 확대·축소가 통째로 반대로 돌았다.

describe('normalizeWheelDelta', () => {
  const ev = (o: Partial<WheelEvent>) => ({
    deltaX: 0, deltaY: 0, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...o,
  })

  it('부호를 뒤집는다 — 이게 빠져서 방향이 반대였다', () => {
    expect(normalizeWheelDelta(ev({ deltaY: 100 }))).toMatchObject({ x: -0, y: -100 })
    expect(normalizeWheelDelta(ev({ deltaY: -100 }))).toMatchObject({ y: 100 })
    expect(normalizeWheelDelta(ev({ deltaX: 40 }))).toMatchObject({ x: -40 })
  })

  it('ctrl 을 누르면 z 에 확대량을 싣고 한 번에 뛰는 폭을 묶는다', () => {
    // 10 을 넘는 deltaY 는 10 으로 깎인다 (tldraw 의 MAX_ZOOM_STEP).
    expect(normalizeWheelDelta(ev({ deltaY: 500, ctrlKey: true })).z).toBeCloseTo(-0.1, 6)
    expect(normalizeWheelDelta(ev({ deltaY: -500, ctrlKey: true })).z).toBeCloseTo(0.1, 6)
    expect(normalizeWheelDelta(ev({ deltaY: 5, ctrlKey: true })).z).toBeCloseTo(-0.05, 6)
  })

  it('ctrl 없이는 z 가 0 이다', () => {
    expect(normalizeWheelDelta(ev({ deltaY: 100 })).z).toBe(-0)
  })

  it('shift 는 세로를 가로로 옮긴다 (윈도우 기준)', () => {
    const d = normalizeWheelDelta(ev({ deltaY: 100, shiftKey: true }))
    expect(d).toMatchObject({ x: -100, y: -0 })
  })
})
