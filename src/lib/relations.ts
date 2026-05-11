import type { Editor } from 'tldraw'
import { detectRooms } from './roomDetection'
import { getBlock } from './blockLibrary'
import { getScaleConfig } from './scaleConfig'

export type WallOpening = {
  id: string
  type: 'door' | 'window'
  name: string
  wallId: string
}

export type RoomRelation = {
  index: number
  areaM2: number
  openings: WallOpening[]
  furniture: { id: string; name: string }[]
}

/** True if point is inside the polygon (ray-cast algorithm). */
function pointInPolygon(px: number, py: number, poly: { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y
    const xj = poly[j].x, yj = poly[j].y
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

export function computeRelations(editor: Editor): RoomRelation[] {
  const shapes = editor.getCurrentPageShapes()
  const scale = getScaleConfig(editor)

  // Build wall segments for room detection
  const wallData: { x1: number; y1: number; x2: number; y2: number; id: string }[] = []
  for (const s of shapes) {
    if (s.type !== 'wall') continue
    const p = s.props as { x2: number; y2: number }
    wallData.push({ x1: s.x, y1: s.y, x2: s.x + p.x2, y2: s.y + p.y2, id: s.id })
  }

  const rooms = detectRooms(wallData)

  // Collect openings with wallId from meta
  const openings: WallOpening[] = []
  for (const s of shapes) {
    if (s.type !== 'door' && s.type !== 'window') continue
    const wallId = (s.meta as Record<string, unknown>)?.wallId as string | undefined
    openings.push({
      id: s.id,
      type: s.type as 'door' | 'window',
      name: s.type === 'door' ? '문' : '창문',
      wallId: wallId ?? '',
    })
  }

  // Collect blocks
  const blocks = shapes.filter(s => s.type === 'block')

  return rooms.map((room, idx) => {
    const poly = room.vertices
    const areaMm2 = room.area / (scale.pxPerMm ** 2)
    const areaM2 = areaMm2 / 1_000_000

    // Which openings belong to walls that bound this room?
    const roomWallIds = new Set<string>()
    for (const w of wallData) {
      // A wall bounds a room if at least one of its endpoints is close to the polygon
      const mid = { x: (w.x1 + w.x2) / 2, y: (w.y1 + w.y2) / 2 }
      if (pointInPolygon(mid.x, mid.y, poly)) roomWallIds.add(w.id)
    }

    const roomOpenings = openings.filter(o => roomWallIds.has(o.wallId))

    // Which blocks are inside this room?
    const roomFurniture = blocks
      .filter(b => pointInPolygon(b.x, b.y, poly))
      .map(b => ({
        id: b.id,
        name: getBlock((b.props as { blockId: string }).blockId)?.name ?? b.id,
      }))

    return { index: idx + 1, areaM2, openings: roomOpenings, furniture: roomFurniture }
  })
}
