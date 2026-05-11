const THICKNESS_KEY = 'bimove_wall_thickness'
const WALL_HEIGHT_KEY = 'bimove_wall_height_mm'

export function getDefaultWallThickness(): number {
  return Number(localStorage.getItem(THICKNESS_KEY) ?? 20)
}

export function setDefaultWallThickness(px: number) {
  localStorage.setItem(THICKNESS_KEY, String(px))
}

/** Wall height for 3D extrusion, in millimetres. */
export function getWallHeightMm(): number {
  return Number(localStorage.getItem(WALL_HEIGHT_KEY) ?? 2400)
}

export function setWallHeightMm(mm: number) {
  localStorage.setItem(WALL_HEIGHT_KEY, String(mm))
}
