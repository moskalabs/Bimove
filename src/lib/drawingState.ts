/** Shared mutable reference so WallTool can tell ToolOverlay which shape is being drawn. */

export type PickTarget = 'wall' | 'door-window' | null

export type PickResult =
  | { type: 'wall'; shapeId: string; label: string; lengthMm: number }
  | { type: 'door' | 'window'; shapeId: string; label: string; widthMm: number; heightMm: number }

export const drawingState = {
  drawingId: null as string | null,
  /**
   * 지금 그리는 벽 **앞 구간**의 방향 (page 좌표, 길이는 안 본다).
   *
   * 벽을 이어 그릴 때 꺾이는 각을 앞 구간 기준 직각으로 당기고(ToolOverlay 는
   * 그 각을 코너에 띄운다), 첫 구간이면 null 이다.
   */
  prevDir: null as { x: number; y: number } | null,
  /**
   * 지금 걸린 **보조선**. ToolOverlay 가 점선으로 그린다.
   *
   * 도구가 정해서 알려준다 — 오버레이가 스냅을 다시 계산하면 둘이 어긋날 수
   * 있고, 그러면 "그려진 선과 실제로 맞춰진 자리가 다른" 최악이 된다.
   */
  alignGuides: [] as Array<{ axis: 'x' | 'y'; at: number; through: { x: number; y: number } }>,
  pickTarget: null as PickTarget,
  pickCallback: null as ((result: PickResult) => void) | null,
  pickItemId: null as string | null,
}

export function enterPickMode(
  target: 'wall' | 'door-window',
  callback: (result: PickResult) => void,
  itemId?: string,
) {
  // 기존 pick 모드가 있으면 먼저 정리 (BUG 3: 재진입 방어)
  if (drawingState.pickTarget) exitPickMode()
  drawingState.pickTarget = target
  drawingState.pickCallback = callback
  drawingState.pickItemId = itemId ?? null
  window.dispatchEvent(new CustomEvent('bimova:pick-mode', { detail: { active: true, target } }))
}

export function exitPickMode() {
  drawingState.pickTarget = null
  drawingState.pickCallback = null
  drawingState.pickItemId = null
  window.dispatchEvent(new CustomEvent('bimova:pick-mode', { detail: { active: false } }))
}

// ── 면적 측정 모드 ──

export type AreaMeasureResult = {
  areaM2: number
  perimeterM: number
}

export const areaMeasureState = {
  active: false,
  callback: null as ((result: AreaMeasureResult) => void) | null,
}

export function startAreaMeasure(cb: (result: AreaMeasureResult) => void) {
  areaMeasureState.active = true
  areaMeasureState.callback = cb
  window.dispatchEvent(new CustomEvent('bimova:area-measure', { detail: { active: true } }))
}

export function completeAreaMeasure(result: AreaMeasureResult) {
  const cb = areaMeasureState.callback
  areaMeasureState.active = false
  areaMeasureState.callback = null
  window.dispatchEvent(new CustomEvent('bimova:area-measure', { detail: { active: false } }))
  cb?.(result)
}

export function cancelAreaMeasure() {
  areaMeasureState.active = false
  areaMeasureState.callback = null
  window.dispatchEvent(new CustomEvent('bimova:area-measure', { detail: { active: false } }))
}

// ── 공간지정(Zone) 드로잉 모드 ──

export type ZoneDrawResult = {
  points: { x: number; y: number }[]
  areaM2: number
  perimeterM: number
}

export const zoneDrawState = {
  active: false,
  callback: null as ((result: ZoneDrawResult) => void) | null,
}

export function startZoneDraw(cb: (result: ZoneDrawResult) => void) {
  zoneDrawState.active = true
  zoneDrawState.callback = cb
  window.dispatchEvent(new CustomEvent('bimova:zone-draw', { detail: { active: true } }))
}

export function completeZoneDraw(result: ZoneDrawResult) {
  const cb = zoneDrawState.callback
  zoneDrawState.active = false
  zoneDrawState.callback = null
  window.dispatchEvent(new CustomEvent('bimova:zone-draw', { detail: { active: false } }))
  cb?.(result)
}

export function cancelZoneDraw() {
  zoneDrawState.active = false
  zoneDrawState.callback = null
  window.dispatchEvent(new CustomEvent('bimova:zone-draw', { detail: { active: false } }))
}

// ── 폴리라인 드로잉 모드 ──
//
// tldraw 의 line 도구는 **드래그 한 번에 두 점**이고, 점을 더 붙이려면 기존
// 선을 shift 로 집어야 한다. CAD 에서 쓰는 "클릭 클릭 클릭" 이 안 된다.
// 그래서 공간지정과 같은 오버레이 방식으로 따로 받는다 — 덤으로 점마다
// 스냅 체인(끝점·중간점·교차점·수직·연장·직교)을 그대로 쓸 수 있다.

export const polylineDrawState = {
  active: false,
  callback: null as ((points: { x: number; y: number }[]) => void) | null,
}

export function startPolylineDraw(cb: (points: { x: number; y: number }[]) => void) {
  polylineDrawState.active = true
  polylineDrawState.callback = cb
  window.dispatchEvent(new CustomEvent('bimova:polyline-draw', { detail: { active: true } }))
}

export function completePolylineDraw(points: { x: number; y: number }[]) {
  const cb = polylineDrawState.callback
  polylineDrawState.active = false
  polylineDrawState.callback = null
  window.dispatchEvent(new CustomEvent('bimova:polyline-draw', { detail: { active: false } }))
  cb?.(points)
}

export function cancelPolylineDraw() {
  polylineDrawState.active = false
  polylineDrawState.callback = null
  window.dispatchEvent(new CustomEvent('bimova:polyline-draw', { detail: { active: false } }))
}

// ── 코멘트 핀 모드 ──
//
// 공간지정·폴리라인과 같은 식이다 — 켜 두고 **한 번** 찍으면 끝난다.
// tldraw 도구로 만들지 않은 이유는 코멘트가 도형이 아니기 때문이다
// (commentStore.ts 머리말).
//
// 스냅은 **일부러 안 건다.** 코멘트는 "이 근처" 를 가리키는 것이지 도면의
// 점을 집는 게 아니다. 끝점에 달라붙으면 벽 모서리마다 핀이 겹쳐 쌓인다.

export const commentPinState = {
  active: false,
  /**
   * **없어도 된다.** 다른 모드와 달리 찍은 결과를 받아 쓸 사람이 보통 없다 —
   * 글타래 창을 띄우는 일은 오버레이가 제자리에서 한다. 콜백은 "핀이 찍혔다"
   * 를 알고 싶은 쪽(패널 등)을 위해 남겨 둔 자리다.
   */
  callback: null as ((at: { x: number; y: number }) => void) | null,
}

export function startCommentPin(cb?: (at: { x: number; y: number }) => void) {
  commentPinState.active = true
  commentPinState.callback = cb ?? null
  window.dispatchEvent(new CustomEvent('bimova:comment-pin', { detail: { active: true } }))
}

export function completeCommentPin(at: { x: number; y: number }) {
  const cb = commentPinState.callback
  commentPinState.active = false
  commentPinState.callback = null
  window.dispatchEvent(new CustomEvent('bimova:comment-pin', { detail: { active: false } }))
  cb?.(at)
}

export function cancelCommentPin() {
  commentPinState.active = false
  commentPinState.callback = null
  window.dispatchEvent(new CustomEvent('bimova:comment-pin', { detail: { active: false } }))
}
