// 엔진 캔버스의 **화면 ↔ 도면** 좌표 변환.
//
// 핀·라벨처럼 캔버스 **위에** 얹는 것들은 전부 이 변환을 쓴다. 엔진이 그린
// 픽셀과 그 위의 HTML 이 한 좌표계를 보지 않으면, 확대할수록 벌어진다.
//
// ── 두 번 뒤집힌다 ──
//
// 1. **y 방향.** Bimove 캔버스(page 좌표)는 y 가 아래로 자라고, 엔진은
//    DXF 를 따라 y 가 위로 자란다. 그래서 도형을 엔진으로 옮길 때 y 를
//    뒤집었다 (`crates/bimove-wasm/src/wall.rs` 의 `frame`). 되돌아올 때도
//    같은 만큼 뒤집는다.
// 2. **화면 y.** 화면은 다시 아래로 자란다. 그래서 엔진→화면에서 한 번 더.
//
// 두 번 뒤집으면 제자리로 보이지만 **같은 뒤집기가 아니다** — 하나는 문서
// 좌표계 차이고 하나는 화면 좌표계 차다. 따로 적어 둬야 나중에 한쪽만
// 바뀌어도 알아챈다.
//
// 카메라는 CadCraftViewer 가 들고 있는 그것이다 — `cx,cy` 는 **엔진 좌표**
// 로 본 화면 한가운데, `scale` 은 도면 한 단위당 CSS 픽셀.

/** 화면 한가운데가 보고 있는 엔진 좌표와 배율. */
export type CadCam = {
  cx: number
  cy: number
  scale: number
}

/** 캔버스 크기 (CSS 픽셀). */
export type CanvasBox = {
  w: number
  h: number
}

export type Pt = { x: number; y: number }

/** 캔버스 안의 화면 좌표 → **Bimove page 좌표** (코멘트가 저장된 그 좌표). */
export function screenToPage(cam: CadCam, s: Pt, box: CanvasBox): Pt {
  const ex = cam.cx + (s.x - box.w / 2) / cam.scale
  const ey = cam.cy - (s.y - box.h / 2) / cam.scale
  // 엔진(y 위로) → page(y 아래로)
  return { x: ex, y: -ey }
}

/** **Bimove page 좌표** → 캔버스 안의 화면 좌표. */
export function pageToScreen(cam: CadCam, p: Pt, box: CanvasBox): Pt {
  // page(y 아래로) → 엔진(y 위로)
  const ex = p.x
  const ey = -p.y
  return {
    x: box.w / 2 + (ex - cam.cx) * cam.scale,
    y: box.h / 2 - (ey - cam.cy) * cam.scale,
  }
}

/**
 * 이 점이 캔버스 안에 들어오나 — 여백 `pad` 만큼 너그럽게 본다.
 *
 * 핀은 가운데가 기준이라 가장자리에서 반쯤 걸친다. 딱 잘라 버리면 **화면
 * 끝의 핀이 깜빡이며 사라진다.**
 */
export function onScreen(s: Pt, box: CanvasBox, pad = 0): boolean {
  return s.x >= -pad && s.y >= -pad && s.x <= box.w + pad && s.y <= box.h + pad
}

/**
 * 그 점이 제자리에 남도록 확대/축소한다 (커서 밑으로 들어가는 느낌).
 *
 * `cam` 을 **고쳐 쓴다** — 뷰어가 ref 로 들고 있는 그 객체다.
 */
export function zoomAt(cam: CadCam, s: Pt, box: CanvasBox, factor: number): void {
  const dx = s.x - box.w / 2
  const dy = s.y - box.h / 2
  const wx = cam.cx + dx / cam.scale
  const wy = cam.cy - dy / cam.scale
  cam.scale *= factor
  cam.cx = wx - dx / cam.scale
  cam.cy = wy + dy / cam.scale
}
