import { scopedGet, scopedSet } from './scopedStorage'

const THICKNESS_MM_KEY = 'bimove_wall_thickness_mm'
const WALL_HEIGHT_KEY = 'bimove_wall_height_mm'
const SHOW_WALL_LENGTHS_KEY = 'bimove_show_wall_lengths'
const SHOW_ROOM_AREAS_KEY = 'bimove_show_room_areas'

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

const SNAP_ENABLED_KEY = 'bimove_snap_enabled'

/** Orthogonal angle snap while drawing walls/dimensions (Shift inverts). */
export function getSnapEnabled(): boolean {
  return scopedGet(SNAP_ENABLED_KEY) !== 'false'
}
export function setSnapEnabled(v: boolean) {
  scopedSet(SNAP_ENABLED_KEY, String(v))
}

const GRAYSCALE_KEY = 'bimove_grayscale'

/** Grayscale (CAD 흑백) 렌더링 모드 */
export function getGrayscaleMode(): boolean {
  return scopedGet(GRAYSCALE_KEY) === 'true'
}
export function setGrayscaleMode(v: boolean) {
  scopedSet(GRAYSCALE_KEY, String(v))
  // body data attr for CSS filter
  document.body.dataset.grayscale = v ? 'true' : ''
  window.dispatchEvent(new Event('bimove:settings'))
}

/** 초기화 시 body attr 동기화 */
export function initGrayscaleAttr() {
  document.body.dataset.grayscale = getGrayscaleMode() ? 'true' : ''
}

const DARK_MODE_KEY = 'bimove_dark_mode'

/** 다크모드 */
export function getDarkMode(): boolean {
  return scopedGet(DARK_MODE_KEY) === 'true'
}
export function setDarkMode(v: boolean) {
  scopedSet(DARK_MODE_KEY, String(v))
  document.documentElement.dataset.dark = v ? 'true' : ''
  window.dispatchEvent(new Event('bimove:settings'))
}

/** 초기화 시 dark attr 동기화 */
export function initDarkAttr() {
  document.documentElement.dataset.dark = getDarkMode() ? 'true' : ''
}

const ROOM_NAMES_KEY = 'bimove_room_names'

export function getRoomNames(): Record<string, string> {
  try { return JSON.parse(scopedGet(ROOM_NAMES_KEY) ?? '{}') } catch { return {} }
}

export function setRoomName(key: string, name: string) {
  const names = getRoomNames()
  if (name.trim()) names[key] = name.trim()
  else delete names[key]
  scopedSet(ROOM_NAMES_KEY, JSON.stringify(names))
}
