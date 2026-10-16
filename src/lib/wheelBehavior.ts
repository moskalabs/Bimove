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

// ── 오버레이가 직접 쏘는 휠 ──
//
// 공간지정·면적측정 오버레이는 `<Tldraw>` 의 형제로 붙어 자기 휠 이벤트를
// 받아 editor.dispatch 로 넘긴다. 그런데 **tldraw 는 넘겨받은 delta 가 이미
// 뒤집혀 있다고 가정한다** — 자기 리스너는 normalizeWheel 로 부호를 뒤집어
// 넣는다. 오버레이는 날것을 그대로 넘겨서 확대·축소와 이동이 통째로 반대로
// 돌았다.
//
// normalizeWheel 은 tldraw 가 내보내지 않아(release type 에서 제외) 여기에
// 같은 계산을 둔다. 바꾸지 말 것 — tldraw 쪽과 **글자 그대로 같아야** 한다.

/** ctrl/alt/meta 를 눌렀을 때 한 번에 허용하는 최대 확대 폭. */
const MAX_ZOOM_STEP = 10

const IS_DARWIN = typeof navigator !== 'undefined' &&
  /Mac|iPod|iPhone|iPad/.test(navigator.platform ?? '')

/** 휠 이벤트에서 읽는 값만 추린 것. */
export type WheelDeltaSignal =
  Pick<WheelEvent, 'deltaX' | 'deltaY' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey'>

/** tldraw 가 기대하는 모양의 delta. tldraw 의 normalizeWheel 과 같은 계산이다. */
export function normalizeWheelDelta(e: WheelDeltaSignal): { x: number; y: number; z: number } {
  let { deltaX, deltaY } = e
  let deltaZ = 0
  if (e.ctrlKey || e.altKey || e.metaKey) {
    deltaZ = (Math.abs(deltaY) > MAX_ZOOM_STEP ? MAX_ZOOM_STEP * Math.sign(deltaY) : deltaY) / 100
  } else if (e.shiftKey && !IS_DARWIN) {
    // 윈도우·리눅스는 shift+휠을 가로 스크롤로 쓴다
    deltaX = deltaY
    deltaY = 0
  }
  return { x: -deltaX, y: -deltaY, z: -deltaZ }
}
