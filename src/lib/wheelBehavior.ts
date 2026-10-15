// 마우스 휠 vs 터치패드 감지.
//
// 여기서 고르는 건 tldraw 에 넘길 **설정값**이고, 실제 동작은 tldraw 가 ctrl
// 여부로 한 번 더 뒤집는다 (settings.ts 의 WheelBehavior 주석 참고).
//
//   마우스 휠          → 'zoom'  : 그냥 굴려서 확대/축소 (오토캐드 방식)
//   터치패드 두손가락  → 'pan'   : 스크롤 = 이동
//   터치패드 핀치      → 'pan'   : ctrl 이 붙어 오므로 tldraw 가 zoom 으로 뒤집는다

/**
 * 휠 감지를 적용할 영역.
 *
 * tldraw 캔버스만 보면 **오버레이 위에서 감지가 멈춘다.** 공간지정·면적측정
 * 오버레이는 `<Tldraw>` 의 형제로 붙어서 `.tl-container` 밖이고, 자기 휠을
 * editor.dispatch 로 직접 넘긴다. 그런데 설정은 갱신되지 않으니 직전 값
 * (예: 터치패드로 잡혀 있던 'pan')이 그대로 쓰여 확대·축소가 뒤집힌 것처럼
 * 보였다. 오버레이의 캡처 레이어도 같이 본다.
 */
export const CANVAS_WHEEL_SELECTOR = '.tl-container, .area-measure-capture'

/** 휠 이벤트에서 읽는 값만 추린 것 — 테스트에서 가짜로 만들기 쉽게. */
export type WheelSignal = Pick<WheelEvent, 'ctrlKey' | 'deltaMode' | 'deltaY'>

/**
 * 이 휠이 마우스인지 터치패드인지 보고 tldraw 에 넘길 설정값을 고른다.
 *
 *   ctrlKey        → 터치패드 핀치 (또는 Ctrl+휠)
 *   deltaMode 1    → 마우스 라인 스크롤
 *   deltaMode 0 + 큰 정수값 → 마우스 픽셀 스크롤
 *   그 외 (작은/소수점 delta) → 터치패드 두손가락 스크롤
 */
export function detectWheelBehavior(e: WheelSignal): 'pan' | 'zoom' {
  if (e.ctrlKey) return 'pan'          // tldraw 가 ctrl 로 뒤집어 결과적으로 확대가 된다
  if (e.deltaMode === 1) return 'zoom' // 마우스 라인 모드
  // 마우스 픽셀 모드는 큰 값을 정수로 보낸다. 터치패드는 작거나 소수점이 붙는다.
  if (Math.abs(e.deltaY) >= 50 && e.deltaY % 1 === 0) return 'zoom'
  return 'pan'
}

/** 이 요소 위에서 굴린 휠을 감지 대상으로 볼지. */
export function isCanvasWheelTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el?.closest?.(CANVAS_WHEEL_SELECTOR)
}
