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
