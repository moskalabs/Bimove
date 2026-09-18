/** Shared mutable reference so WallTool can tell ToolOverlay which shape is being drawn. */

export type PickTarget = 'wall' | 'door-window' | null

export type PickResult =
  | { type: 'wall'; shapeId: string; label: string; lengthMm: number }
  | { type: 'door' | 'window'; shapeId: string; label: string; widthMm: number; heightMm: number }

export const drawingState = {
  drawingId: null as string | null,
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
