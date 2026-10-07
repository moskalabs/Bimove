import { scopedGet, scopedSet } from './scopedStorage'

const THICKNESS_MM_KEY = 'bimova_wall_thickness_mm'
const WALL_HEIGHT_KEY = 'bimova_wall_height_mm'
const SHOW_WALL_LENGTHS_KEY = 'bimova_show_wall_lengths'
const SHOW_ROOM_AREAS_KEY = 'bimova_show_room_areas'

/** Default wall thickness in mm (physical units, scale-independent). */
export function getDefaultWallThicknessMm(): number {
  return Number(scopedGet(THICKNESS_MM_KEY) ?? 200)
}

export function setDefaultWallThicknessMm(mm: number) {
  scopedSet(THICKNESS_MM_KEY, String(mm))
}

/** Wall height for 3D extrusion, in millimetres. */
export function getWallHeightMm(): number {
  return Number(scopedGet(WALL_HEIGHT_KEY) ?? 2400)
}

export function setWallHeightMm(mm: number) {
  scopedSet(WALL_HEIGHT_KEY, String(mm))
}

export function getShowWallLengths(): boolean {
  return scopedGet(SHOW_WALL_LENGTHS_KEY) !== 'false'
}
export function setShowWallLengths(v: boolean) {
  scopedSet(SHOW_WALL_LENGTHS_KEY, String(v))
}

export function getShowRoomAreas(): boolean {
  return scopedGet(SHOW_ROOM_AREAS_KEY) !== 'false'
}
export function setShowRoomAreas(v: boolean) {
  scopedSet(SHOW_ROOM_AREAS_KEY, String(v))
}

const SNAP_ENABLED_KEY = 'bimova_snap_enabled'

/** Orthogonal angle snap while drawing walls/dimensions (Shift inverts). */
export function getSnapEnabled(): boolean {
  return scopedGet(SNAP_ENABLED_KEY) !== 'false'
}
export function setSnapEnabled(v: boolean) {
  scopedSet(SNAP_ENABLED_KEY, String(v))
  window.dispatchEvent(new Event('bimova:settings'))
}

// ── 개별 스냅 모드 토글 ──
export type SnapMode = 'endpoint' | 'midpoint' | 'intersection' | 'perpendicular' | 'extension'

const SNAP_MODE_PREFIX = 'bimova_snap_'
const SNAP_DEFAULTS: Record<SnapMode, boolean> = {
  endpoint: true,
  midpoint: true,
  intersection: true,
  perpendicular: false,
  extension: false,
}

export function getSnapMode(mode: SnapMode): boolean {
  const val = scopedGet(SNAP_MODE_PREFIX + mode)
  if (val === null) return SNAP_DEFAULTS[mode]
  return val === 'true'
}

export function setSnapMode(mode: SnapMode, v: boolean) {
  scopedSet(SNAP_MODE_PREFIX + mode, String(v))
  window.dispatchEvent(new Event('bimova:settings'))
}

/** 현재 활성화된 스냅 모드 전체 반환 */
export function getActiveSnapModes(): Record<SnapMode, boolean> {
  return {
    endpoint: getSnapMode('endpoint'),
    midpoint: getSnapMode('midpoint'),
    intersection: getSnapMode('intersection'),
    perpendicular: getSnapMode('perpendicular'),
    extension: getSnapMode('extension'),
  }
}

/** 스냅 체크박스 UI 가 다루는 항목.
 *  'ortho' 는 개별 스냅이 아니라 직교 각도 스냅(SNAP_ENABLED_KEY) 이다 — 저장 위치가 다르다. */
export type SnapUiMode = SnapMode | 'ortho'

/** 스냅 패널 전체 상태.
 *
 *  ScaleRuler 와 RBar 가 같은 설정을 각자 useState 로 한 번 읽고 끝내서,
 *  한쪽에서 토글하면 다른 쪽 체크박스가 옛 값을 그대로 보여줬다. 이제 둘 다
 *  이 함수로 읽고 'bimova:settings' 이벤트로 다시 읽는다. */
export function getSnapUiState(): Record<SnapUiMode, boolean> {
  return { ...getActiveSnapModes(), ortho: getSnapEnabled() }
}

export function setSnapUiMode(mode: SnapUiMode, v: boolean) {
  if (mode === 'ortho') setSnapEnabled(v)
  else setSnapMode(mode, v)
}

const GRAYSCALE_KEY = 'bimova_grayscale'

/** Grayscale (CAD 흑백) 렌더링 모드 */
export function getGrayscaleMode(): boolean {
  return scopedGet(GRAYSCALE_KEY) === 'true'
}
export function setGrayscaleMode(v: boolean) {
  scopedSet(GRAYSCALE_KEY, String(v))
  // body data attr for CSS filter
  document.body.dataset.grayscale = v ? 'true' : ''
  window.dispatchEvent(new Event('bimova:settings'))
}

/** 초기화 시 body attr 동기화 */
export function initGrayscaleAttr() {
  document.body.dataset.grayscale = getGrayscaleMode() ? 'true' : ''
}

const DARK_MODE_KEY = 'bimova_dark_mode'

/** 다크모드 */
export function getDarkMode(): boolean {
  return scopedGet(DARK_MODE_KEY) === 'true'
}
export function setDarkMode(v: boolean) {
  scopedSet(DARK_MODE_KEY, String(v))
  document.documentElement.dataset.dark = v ? 'true' : ''
  window.dispatchEvent(new Event('bimova:settings'))
}

const WHEEL_BEHAVIOR_KEY = 'bimova_wheel_behavior'

/** 휠/터치패드 동작.
 *
 *  tldraw 는 ctrl 이 눌려 있으면 이 값을 뒤집는다 (Editor.js):
 *    behavior = ctrlKey ? (wheelBehavior === 'pan' ? 'zoom' : 'pan') : wheelBehavior
 *
 *  터치패드는 두 손가락 스크롤을 ctrl 없이, 핀치를 `ctrlKey: true` 로 보낸다.
 *  따라서 'zoom' 으로 두면 스크롤이 확대, 핀치가 이동이 되어 정확히 뒤집힌다. */
export type WheelBehavior = 'pan' | 'zoom'

/** 설정에 저장되는 값.
 *
 *  'auto' = App 이 휠 이벤트를 보고 마우스/터치패드를 감지해 매번 고른다.
 *  'pan' / 'zoom' = 한이 직접 고른 값. 이 경우 **자동 감지는 손을 뗀다.**
 *  (전엔 자동 감지가 설정을 무조건 덮어써서 토글이 아무 효과도 없었다.)
 *
 *  기본값은 'auto' — 저장된 값이 없던 기존 사용자도 그대로 자동 감지를 받는다. */
export type WheelMode = 'auto' | WheelBehavior

export function getWheelMode(): WheelMode {
  const stored = scopedGet(WHEEL_BEHAVIOR_KEY)
  if (stored === 'pan' || stored === 'zoom') return stored
  return 'auto'
}
export function setWheelMode(v: WheelMode) {
  scopedSet(WHEEL_BEHAVIOR_KEY, v)
  window.dispatchEvent(new Event('bimova:settings'))
}

/** tldraw cameraOptions.wheelBehavior 에 넣을 값.
 *  'auto' 는 'zoom'(오토캐드 방식) 으로 시작하고 이후 자동 감지가 덮어쓴다. */
export function getWheelBehavior(): WheelBehavior {
  return getWheelMode() === 'pan' ? 'pan' : 'zoom'
}

/** 초기화 시 dark attr 동기화 */
export function initDarkAttr() {
  document.documentElement.dataset.dark = getDarkMode() ? 'true' : ''
}

const ROOM_NAMES_KEY = 'bimova_room_names'

export function getRoomNames(): Record<string, string> {
  try { return JSON.parse(scopedGet(ROOM_NAMES_KEY) ?? '{}') } catch { return {} }
}

export function setRoomName(key: string, name: string) {
  const names = getRoomNames()
  if (name.trim()) names[key] = name.trim()
  else delete names[key]
  scopedSet(ROOM_NAMES_KEY, JSON.stringify(names))
}
