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
  window.dispatchEvent(new CustomEvent('bimove:pick-mode', { detail: { active: true, target } }))
}

export function exitPickMode() {
  drawingState.pickTarget = null
  drawingState.pickCallback = null
  drawingState.pickItemId = null
  window.dispatchEvent(new CustomEvent('bimove:pick-mode', { detail: { active: false } }))
}
