const THICKNESS_KEY = 'bimove_wall_thickness'

export function getDefaultWallThickness(): number {
  return Number(localStorage.getItem(THICKNESS_KEY) ?? 20)
}

export function setDefaultWallThickness(px: number) {
  localStorage.setItem(THICKNESS_KEY, String(px))
}
