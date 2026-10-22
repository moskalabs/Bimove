// 코멘트 창을 **캔버스 안쪽으로** 미는 셈.
//
// 컴포넌트에서 떼어 둔 건 테스트하기 위해서다. 가장자리에 달린 코멘트가
// 잘리는지는 눈으로만 보면 놓치기 쉽다 — 오른쪽 끝, 아래쪽 끝, 캔버스가
// 창보다 작을 때, 아직 재기 전일 때가 다 다른 경우다.

/** 핀 지름. 창을 핀 옆에 붙일 때 쓴다. */
export const PIN = 28

export const POPUP_W = 260

/**
 * 창 높이의 천장. App.css 의 `.comment-popup { max-height }` 와 **같은 값**이다.
 *
 * 창은 글타래 길이에 따라 늘었다 줄었다 한다. 그런데 자리를 잡으려면 얼마나
 * 큰지 **먼저** 알아야 하고, 그려 보고 재면 한 번 깜빡인다. 그래서 CSS 로
 * 천장을 두고 그 숫자로 민다 — 넘치는 건 안쪽 글타래가 굴러서 받는다.
 */
export const POPUP_MAX_H = 380

/** 캔버스 가장자리에서 띄울 여백. */
const EDGE = 8

/** 아무리 좁아도 이보다 낮게는 안 줄인다 — 입력칸이 사라지면 쓸 수가 없다. */
const MIN_H = 120

/** 핀과 창 사이. */
const GAP = 12

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

export type Box = { w: number; h: number }

export type PopupPlacement = {
  left: number
  top: number
  width: number
  maxHeight: number
}

/**
 * 창을 핀 옆에 붙이되 **캔버스 밖으로 나가지 않게** 민다.
 *
 * 기준이 창(window)이 아니라 **캔버스**인 게 중요하다. 부모인 `.canvas-area`
 * 는 좌우 패널을 뺀 자리고 overflow 가 hidden 이라, `window.innerWidth` 로
 * 재면 오른쪽 끝 핀의 입력칸과 버튼이 잘려 나간다. 아래쪽은 아예 보지도
 * 않았었다.
 *
 * 아직 못 쟀으면(첫 그림, `w`·`h` 가 0) **밀지 않는다** — 0 으로 밀면 전부
 * 왼쪽 위로 쏠린다. 다음 프레임에 제자리를 찾는다.
 */
export function placePopup(vx: number, vy: number, box: Box): PopupPlacement {
  const right = vx + PIN / 2 + GAP
  const maxHeight = box.h > 0
    ? Math.max(MIN_H, Math.min(POPUP_MAX_H, box.h - EDGE * 2))
    : POPUP_MAX_H

  if (box.w <= 0 || box.h <= 0) {
    return { left: right, top: vy - PIN, width: POPUP_W, maxHeight }
  }

  // 오른쪽에 자리가 없으면 왼쪽으로 뒤집고, 그래도 안 되면 그냥 민다.
  const flip = right + POPUP_W > box.w - EDGE
  const left = vx - PIN / 2 - GAP - POPUP_W
  return {
    left: clamp(flip ? left : right, EDGE, Math.max(EDGE, box.w - POPUP_W - EDGE)),
    top: clamp(vy - PIN, EDGE, Math.max(EDGE, box.h - maxHeight - EDGE)),
    width: POPUP_W,
    maxHeight,
  }
}
