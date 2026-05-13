const THICKNESS_MM_KEY = 'bimove_wall_thickness_mm'
const WALL_HEIGHT_KEY = 'bimove_wall_height_mm'
const SHOW_WALL_LENGTHS_KEY = 'bimove_show_wall_lengths'
const SHOW_ROOM_AREAS_KEY = 'bimove_show_room_areas'

/** Default wall thickness in mm (physical units, scale-independent). */
export function getDefaultWallThicknessMm(): number {
  return Number(localStorage.getItem(THICKNESS_MM_KEY) ?? 200)
}

export function setDefaultWallThicknessMm(mm: number) {
  localStorage.setItem(THICKNESS_MM_KEY, String(mm))
}

/** Wall height for 3D extrusion, in millimetres. */
export function getWallHeightMm(): number {
  return Number(localStorage.getItem(WALL_HEIGHT_KEY) ?? 2400)
}

export function setWallHeightMm(mm: number) {
  localStorage.setItem(WALL_HEIGHT_KEY, String(mm))
}

export function getShowWallLengths(): boolean {
  return localStorage.getItem(SHOW_WALL_LENGTHS_KEY) !== 'false'
}
export function setShowWallLengths(v: boolean) {
  localStorage.setItem(SHOW_WALL_LENGTHS_KEY, String(v))
}

export function getShowRoomAreas(): boolean {
  return localStorage.getItem(SHOW_ROOM_AREAS_KEY) !== 'false'
}
export function setShowRoomAreas(v: boolean) {
  localStorage.setItem(SHOW_ROOM_AREAS_KEY, String(v))
}

const ROOM_NAMES_KEY = 'bimove_room_names'

export function getRoomNames(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(ROOM_NAMES_KEY) ?? '{}') } catch { return {} }
}

export function setRoomName(key: string, name: string) {
  const names = getRoomNames()
  if (name.trim()) names[key] = name.trim()
  else delete names[key]
  localStorage.setItem(ROOM_NAMES_KEY, JSON.stringify(names))
}
