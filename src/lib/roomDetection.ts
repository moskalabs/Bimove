/**
 * Planar graph face detection for closed room areas.
 * Walls that share (nearly) coincident endpoints form a graph;
 * each bounded face of that graph is a room.
 */

export type Pt = { x: number; y: number }
export type Room = { vertices: Pt[]; area: number; centroid: Pt }

// Endpoints closer than this (page px) are treated as the same node.
// Generous on purpose: hand-drawn corners rarely land pixel-perfect even
// with snapping, and a false merge is far less bad than a missed room.
const MERGE_TOL = 8

// Faces smaller than this (page px²) are ignored as slivers.
const MIN_AREA = 50

/** Signed shoelace area (positive = counter-clockwise in math coords). */
function signedArea(pts: Pt[]): number {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]
    s += a.x * b.y - b.x * a.y
  }
  return s / 2
}

function centroid(pts: Pt[]): Pt {
  let cx = 0, cy = 0
  for (const p of pts) { cx += p.x; cy += p.y }
  return { x: cx / pts.length, y: cy / pts.length }
}

type WallData = { x1: number; y1: number; x2: number; y2: number }

export function detectRooms(walls: WallData[]): Room[] {
  if (walls.length < 3) return []

  // --- 1. Merge endpoints into nodes ---
  const nodes: Pt[] = []
  const nodeOf = (x: number, y: number): number => {
    for (let i = 0; i < nodes.length; i++) {
      if (Math.hypot(nodes[i].x - x, nodes[i].y - y) <= MERGE_TOL) return i
    }
    nodes.push({ x, y })
    return nodes.length - 1
  }

  // --- 2. Build undirected, de-duplicated edge set + adjacency lists ---
  const edgeSet = new Set<string>()
  const adj = new Map<number, number[]>()
  const link = (a: number, b: number) => {
    if (!adj.has(a)) adj.set(a, [])
    adj.get(a)!.push(b)
  }
  for (const w of walls) {
    const a = nodeOf(w.x1, w.y1)
    const b = nodeOf(w.x2, w.y2)
    if (a === b) continue
    const key = a < b ? `${a}-${b}` : `${b}-${a}`
    if (edgeSet.has(key)) continue
    edgeSet.add(key)
    link(a, b)
    link(b, a)
  }
  if (edgeSet.size < 3) return []

  // Sort each node's neighbours by angle so we can walk faces deterministically.
  for (const [v, list] of adj) {
    list.sort(
      (p, q) =>
        Math.atan2(nodes[p].y - nodes[v].y, nodes[p].x - nodes[v].x) -
        Math.atan2(nodes[q].y - nodes[v].y, nodes[q].x - nodes[v].x),
    )
  }

  // --- 3. Walk every half-edge face ---
  // From directed edge u→v, at v pick the neighbour immediately *before* u
  // in v's CCW-sorted list (i.e. the next edge clockwise). Repeating this
  // traces one face; doing it for all half-edges yields every face exactly once.
  const used = new Set<string>()
  const faces: number[][] = []
  for (const [u0, neighbours] of adj) {
    for (const v0 of neighbours) {
      if (used.has(`${u0}>${v0}`)) continue
      const face: number[] = []
      let u = u0, v = v0
      while (!used.has(`${u}>${v}`)) {
        used.add(`${u}>${v}`)
        face.push(u)
        const list = adj.get(v)!
        const i = list.indexOf(u)
        const next = list[(i - 1 + list.length) % list.length]
        u = v
        v = next
        if (face.length > nodes.length + 2) break // safety
      }
      if (face.length >= 3) faces.push(face)
    }
  }

  // --- 4. Keep bounded faces, drop the outer face(s) ---
  // With the clockwise-walk rule above, bounded faces wind one way and the
  // single outer face of each connected component winds the other. Rather
  // than reason about screen-y sign flips, just drop the largest-area face
  // per component proxy: in practice the outer face always has the greatest
  // |area|, so we drop the global maximum and keep the rest. For multiple
  // disconnected groups this would miss one, but a drawn floor plan is
  // effectively always connected.
  const candidates = faces
    .map((face) => {
      const pts = face.map((i) => nodes[i])
      return { pts, area: Math.abs(signedArea(pts)) }
    })
    .filter((f) => f.area >= MIN_AREA)

  if (candidates.length === 0) return []

  let maxIdx = 0
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].area > candidates[maxIdx].area) maxIdx = i
  }

  return candidates
    .filter((_, i) => i !== maxIdx)
    .map(({ pts, area }) => ({ vertices: pts, area, centroid: centroid(pts) }))
}
