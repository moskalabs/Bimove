/**
 * dxf-fast-worker.ts — Custom DXF parser in a Web Worker
 *
 * Replaces npm `dxf` package (parseString + denormalise + toPolylines).
 * Key advantages:
 * - Only parses selected layers (skips 80–90% of entities)
 * - No lodash.cloneDeep for block expansion
 * - No intermediate JSON object model
 * - Progress reporting to main thread
 * - Zero npm dependencies
 */

// ===== Public message types (also used by main thread) =====

export interface ParseRequest {
  type: 'parse'
  dxfText: string
  selectedLayers: string[]
}

export interface PolylineData {
  vertices: number[][]   // [x,y][]
  layer: string
  colorNumber: number
}

export interface TextData {
  x: number
  y: number
  text: string
  height: number
  rotation?: number
  layer: string
  colorNumber: number
}

export interface HatchData {
  pathData: string       // SVG path: "M0,0L100,0 ... Z"
  patternName: string    // "SOLID", "ANSI31", etc.
  patternScale: number
  patternAngle: number
  color?: string         // hex color
  layer: string
  cx: number; cy: number // centroid
}

export type WorkerOut =
  | { type: 'progress'; phase: string; percent: number }
  | { type: 'result'; polylines: PolylineData[]; insUnits: number; texts: TextData[]; hatches: HatchData[] }
  | { type: 'error'; message: string }

// ===== Internal types =====

interface Vertex { x: number; y: number; bulge: number }

interface PrecomputedPoly {
  vertices: number[][]     // pre-computed polyline points (entity EZ applied)
  rawLayer: string | null  // null = gc8 absent, inherit from INSERT's layer
  colorNumber: number
}

interface BlockDef {
  name: string
  baseX: number
  baseY: number
  entityChunks: string[]          // raw text chunks for complex entities (INSERT, TEXT, ATTRIB...)
  precomputed: PrecomputedPoly[]  // pre-parsed geometry (LINE, ARC, CIRCLE, ELLIPSE, LWPOLYLINE, SPLINE, SOLID, 3DFACE, POLYLINE)
}

interface Transform {
  x: number; y: number
  sx: number; sy: number
  rot: number             // degrees
  ez: number              // extrusionZ
}

const MAX_DEPTH = 8
const ARC_STEP  = 5       // degrees
const MAX_POLYLINES = 200_000  // 폴리라인 수 제한 (성능 보호)
const MAX_TEXTS = 5_000        // 텍스트 수 제한
const MAX_HATCHES = 2_000      // 해치 수 제한

// ===== Geometry helpers =====

/** LWPOLYLINE bulge → arc interpolation points (from/to excluded) */
function bulgeArc(fx: number, fy: number, tx: number, ty: number, bulge: number): number[][] {
  const theta = Math.atan(Math.abs(bulge)) * 4
  let ax: number, ay: number, bx: number, by: number
  if (bulge < 0) { ax = fx; ay = fy; bx = tx; by = ty }
  else           { ax = tx; ay = ty; bx = fx; by = fy }

  const abx = bx - ax, aby = by - ay
  const lenAB = Math.sqrt(abx * abx + aby * aby)
  if (lenAB < 1e-10) return []

  const mx = ax + abx * 0.5, my = ay + aby * 0.5
  const nxAB = abx / lenAB, nyAB = aby / lenAB
  const perpX = -nyAB, perpY = nxAB
  const h = Math.abs(lenAB / 2 / Math.tan(theta / 2))

  let cx: number, cy: number
  if (theta < Math.PI) { cx = mx - perpX * h; cy = my - perpY * h }
  else                 { cx = mx + perpX * h; cy = my + perpY * h }

  const sa = Math.atan2(by - cy, bx - cx) * 180 / Math.PI
  let ea = Math.atan2(ay - cy, ax - cx) * 180 / Math.PI
  if (ea < sa) ea += 360
  const r = Math.sqrt((bx - cx) ** 2 + (by - cy) ** 2)

  const pts: number[][] = []
  const s0 = Math.floor(sa / ARC_STEP) * ARC_STEP + ARC_STEP
  const s1 = Math.ceil(ea / ARC_STEP) * ARC_STEP - ARC_STEP
  for (let d = s0; d <= s1; d += ARC_STEP) {
    const rad = d * Math.PI / 180
    pts.push([cx + Math.cos(rad) * r, cy + Math.sin(rad) * r])
  }
  if (bulge < 0) pts.reverse()
  return pts
}

/** Interpolate ellipse/arc/circle → polyline */
function interpEllipse(
  cx: number, cy: number, rx: number, ry: number,
  start: number, end: number, rotAngle = 0,
): number[][] {
  if (end < start) end += Math.PI * 2
  const step = Math.PI * 2 / 72
  const pts: number[][] = []
  for (let t = start; t < end - 1e-6; t += step) {
    pts.push([Math.cos(t) * rx, Math.sin(t) * ry])
  }
  pts.push([Math.cos(end) * rx, Math.sin(end) * ry])

  if (rotAngle) {
    const c = Math.cos(rotAngle), s = Math.sin(rotAngle)
    for (const p of pts) { const x = p[0], y = p[1]; p[0] = x * c - y * s; p[1] = y * c + x * s }
  }
  for (const p of pts) { p[0] += cx; p[1] += cy }
  return pts
}

/** De Boor B-spline evaluation at parameter t */
function deBoor(degree: number, pts: number[][], knots: number[], t: number, weights?: number[]): number[] {
  const n = pts.length
  let k = degree
  while (k < n && knots[k + 1] !== undefined && knots[k + 1] <= t) k++
  if (k >= n) k = n - 1

  const d: number[][] = []
  for (let j = 0; j <= degree; j++) {
    const idx = k - degree + j
    if (idx >= 0 && idx < n) {
      const w = weights ? (weights[idx] || 1) : 1
      d.push([pts[idx][0] * w, pts[idx][1] * w, w])
    } else {
      d.push([0, 0, 1])
    }
  }
  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const i = k - degree + j
      const den = knots[i + degree - r + 1] - knots[i]
      if (Math.abs(den) < 1e-10) continue
      const a = (t - knots[i]) / den
      d[j][0] = (1 - a) * d[j - 1][0] + a * d[j][0]
      d[j][1] = (1 - a) * d[j - 1][1] + a * d[j][1]
      d[j][2] = (1 - a) * d[j - 1][2] + a * d[j][2]
    }
  }
  const w = d[degree][2]
  return w ? [d[degree][0] / w, d[degree][1] / w] : [d[degree][0], d[degree][1]]
}

/** Interpolate B-spline to polyline */
function interpBSpline(
  cps: Array<{ x: number; y: number }>, degree: number,
  knots: number[], weights?: number[],
): number[][] {
  if (!cps.length || !knots.length) return []
  const pts2d = cps.map(p => [p.x, p.y])
  const lo = knots[degree], hi = knots[knots.length - 1 - degree]
  if (lo >= hi) return pts2d  // degenerate, return control points as fallback

  // Collect unique knot spans
  const spans = [lo]
  for (let k = degree + 1; k < knots.length - degree; k++) {
    if (spans[spans.length - 1] !== knots[k]) spans.push(knots[k])
  }

  const result: number[][] = []
  const N = 25  // interpolations per span
  for (let s = 1; s < spans.length; s++) {
    const u0 = spans[s - 1], u1 = spans[s]
    for (let k = 0; k <= N; k++) {
      const u = u0 + (k / N) * (u1 - u0)
      result.push(deBoor(degree, pts2d, knots, u, weights))
    }
  }
  return result
}

/** Apply INSERT transform to polyline points (mutates) */
function applyTransform(poly: number[][], t: Transform): void {
  const rad = t.rot * Math.PI / 180
  const cosR = Math.cos(rad), sinR = Math.sin(rad)
  for (const p of poly) {
    let x = p[0], y = p[1]
    // Extrusion Z flip — OCS→WCS, must be BEFORE scale/rotate/translate (FreeCAD convention)
    if (t.ez === -1) x = -x
    // Scale
    x *= t.sx; y *= t.sy
    // Rotate
    if (t.rot) { const nx = x * cosR - y * sinR; y = y * cosR + x * sinR; x = nx }
    // Translate
    x += t.x; y += t.y
    p[0] = x; p[1] = y
  }
}

// ===== indexOf-based helpers (zero-alloc scanning) =====

/** Find needle in text within [start, end). Returns -1 if not found. */
function idxIn(text: string, needle: string, start: number, end: number): number {
  const i = text.indexOf(needle, start)
  return (i >= 0 && i < end) ? i : -1
}

/** Extract value string: from `start` to next newline (or `end`). Trims. */
function valAt(text: string, start: number, end: number): string {
  const nl = text.indexOf('\n', start)
  return text.substring(start, (nl >= 0 && nl <= end) ? nl : end).trim()
}

/** Parse float from text starting at `start` to next newline. */
function floatAt(text: string, start: number, end: number): number {
  const nl = text.indexOf('\n', start)
  return parseFloat(text.substring(start, (nl >= 0 && nl <= end) ? nl : end))
}

// ===== DXF Parsing =====

/** Extract a named section's inner text (padding-aware) */
function extractSection(dxf: string, name: string, gc: (c: number) => string): string | null {
  const hdr = `\n${gc(0)}\nSECTION\n${gc(2)}\n${name}\n`
  const idx = dxf.indexOf(hdr)
  if (idx < 0) return null
  const start = idx + hdr.length
  const end = dxf.indexOf(`\n${gc(0)}\nENDSEC`, start)
  return end > start ? dxf.substring(start, end) : null
}

/** Parse $INSUNITS from HEADER section */
function parseInsUnits(dxf: string, gc: (c: number) => string): number {
  const hdr = extractSection(dxf, 'HEADER', gc)
  if (!hdr) return 4  // default mm
  const m = hdr.match(/\$INSUNITS\n\s*70\n\s*(\d+)/)
  return m ? parseInt(m[1]) : 4
}

/** Parse BLOCKS section → Map<name, BlockDef> (padding-aware) */
function parseBlocks(dxf: string, gc: (c: number) => string): Map<string, BlockDef> {
  const blocks = new Map<string, BlockDef>()
  const sec = extractSection(dxf, 'BLOCKS', gc)
  if (!sec) return blocks

  const sep = `\n${gc(0)}\n`
  const gc2 = `\n${gc(2)}\n`
  const gc10 = `\n${gc(10)}\n`
  const gc20 = `\n${gc(20)}\n`
  // prepend \n so the first entity separator \n0\n is properly matched
  // (extractSection returns content starting with "0\nBLOCK\n..." — without leading \n,
  //  split misidentifies first chunk's type as "0" instead of "BLOCK")
  const chunks = ('\n' + sec).split(sep)
  let cur: BlockDef | null = null

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const type = chunk.split('\n', 1)[0].trim()

    if (type === 'BLOCK') {
      const nameMatch = chunk.indexOf(gc2) >= 0 ? chunk.substring(chunk.indexOf(gc2) + gc2.length).split('\n', 1)[0].trim() : `_anon_${i}`
      const bxIdx = chunk.indexOf(gc10)
      const byIdx = chunk.indexOf(gc20)
      cur = {
        name: nameMatch,
        baseX: bxIdx >= 0 ? parseFloat(chunk.substring(bxIdx + gc10.length).split('\n', 1)[0]) : 0,
        baseY: byIdx >= 0 ? parseFloat(chunk.substring(byIdx + gc20.length).split('\n', 1)[0]) : 0,
        entityChunks: [],
        precomputed: [],
      }
    } else if (type === 'ENDBLK') {
      if (cur) {
        // ── Phase 1: heavyweight POLYLINE sequences → precomputed polylines ──
        // POLYLINE → VERTEX* → SEQEND 시퀀스를 감지하여 바로 precomputed로 변환
        const afterPoly: string[] = []
        let polyState: { rawLayer: string | null; colorNumber: number; vertices: Vertex[]; closed: boolean } | null = null
        for (const ec of cur.entityChunks) {
          const ecType = ec.split('\n', 1)[0].trim()
          if (ecType === 'POLYLINE') {
            const { codes: pc } = parseGroupCodes(ec)
            polyState = {
              rawLayer: pc.get(8)?.[0]?.trim() ?? null,
              colorNumber: pc.get(62)?.[0] ? parseInt(pc.get(62)![0]) : -1,
              vertices: [],
              closed: (parseInt(pc.get(70)?.[0] ?? '0') & 1) !== 0,
            }
          } else if (ecType === 'VERTEX' && polyState) {
            const { codes: vc } = parseGroupCodes(ec)
            polyState.vertices.push({
              x: parseFloat(vc.get(10)?.[0] ?? '0'),
              y: parseFloat(vc.get(20)?.[0] ?? '0'),
              bulge: parseFloat(vc.get(42)?.[0] ?? '0'),
            })
          } else if (ecType === 'SEQEND' && polyState) {
            if (polyState.closed && polyState.vertices.length > 0) {
              polyState.vertices.push({ ...polyState.vertices[0], bulge: 0 })
            }
            if (polyState.vertices.length >= 2) {
              const verts = polyState.vertices
              const poly: number[][] = []
              for (let j = 0; j < verts.length - 1; j++) {
                const f = verts[j], t = verts[j + 1]
                poly.push([f.x, f.y])
                if (f.bulge) poly.push(...bulgeArc(f.x, f.y, t.x, t.y, f.bulge))
                if (j === verts.length - 2) poly.push([t.x, t.y])
              }
              if (poly.length >= 2) {
                cur.precomputed.push({ vertices: poly, rawLayer: polyState.rawLayer, colorNumber: polyState.colorNumber })
              }
            }
            polyState = null
          } else {
            if (polyState) polyState = null  // orphaned POLYLINE — reset
            afterPoly.push(ec)
          }
        }
        cur.entityChunks = afterPoly

        // ── Phase 2: precompute simple geometry (LINE/ARC/CIRCLE/ELLIPSE/LWPOLYLINE/SPLINE/SOLID/3DFACE) ──
        // 블록 정의 시 1회 파싱 → INSERT마다 clone+transform만 (재파싱 없음)
        const remaining: string[] = []
        for (const ec of cur.entityChunks) {
          const pre = precomputeEntity(ec)
          if (pre) {
            cur.precomputed.push(pre)
          } else {
            remaining.push(ec)
          }
        }
        cur.entityChunks = remaining
        blocks.set(cur.name, cur)
        cur = null
      }
    } else if (cur && type) {
      cur.entityChunks.push(chunk)
    }
  }
  return blocks
}

/** Parse group codes from entity text chunk */
function parseGroupCodes(text: string): { type: string; codes: Map<number, string[]> } {
  const lines = text.split('\n')
  const type = lines[0]?.trim() || ''
  const codes = new Map<number, string[]>()

  for (let i = 1; i < lines.length - 1; i += 2) {
    const code = parseInt(lines[i].trim())
    if (isNaN(code)) continue
    const val = lines[i + 1]?.trim() ?? ''
    let arr = codes.get(code)
    if (!arr) { arr = []; codes.set(code, arr) }
    arr.push(val)
  }
  return { type, codes }
}

// ===== ACI color table (subset: 1-9 standard colors) =====
const ACI_HEX: Record<number, string> = {
  1: '#ff0000', 2: '#ffff00', 3: '#00ff00', 4: '#00ffff',
  5: '#0000ff', 6: '#ff00ff', 7: '#ffffff', 8: '#808080', 9: '#c0c0c0',
  10: '#ff0000', 11: '#ff7f7f', 12: '#cc0000',
  30: '#ff7f00', 40: '#ff7f00', 50: '#ffbf00',
  250: '#333333', 251: '#545454', 252: '#787878', 253: '#a3a3a3', 254: '#c8c8c8', 255: '#ffffff',
}

function aciToHexFast(idx: number): string | undefined {
  if (idx <= 0 || idx > 255) return undefined
  return ACI_HEX[idx] || `hsl(${((idx - 1) * 360 / 255) | 0},80%,50%)`
}

function trueColorToHexFast(tc: number): string {
  const r = (tc >> 16) & 0xff, g = (tc >> 8) & 0xff, b = tc & 0xff
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

// ===== HATCH entity parser =====

/** Parse a HATCH entity from its group-code text chunk → HatchData or null */
function parseHatchEntity(chunk: string, entityLayer: string): HatchData | null {
  const lines = chunk.split('\n')
  // Build sequential pairs for stateful parsing
  const pairs: Array<{ code: number; value: string }> = []
  for (let i = 1; i < lines.length - 1; i += 2) {
    const code = parseInt(lines[i].trim())
    if (isNaN(code)) continue
    pairs.push({ code, value: lines[i + 1]?.trim() ?? '' })
  }

  let layer = entityLayer
  let colorIndex = 0
  let trueColor = 0
  let patternName = 'SOLID'
  let patternScale = 1
  let patternAngle = 0
  let numBoundaryPaths = 0

  // Parse header fields until group code 91 (boundary path count)
  let pi = 0
  while (pi < pairs.length && pairs[pi].code !== 91) {
    const c = pairs[pi].code, v = pairs[pi].value
    if (c === 8) layer = v
    else if (c === 62) colorIndex = parseInt(v) || 0
    else if (c === 420) trueColor = parseInt(v) || 0
    else if (c === 2) patternName = v
    else if (c === 41) patternScale = parseFloat(v) || 1
    else if (c === 52) patternAngle = parseFloat(v) || 0
    pi++
  }
  if (pi < pairs.length && pairs[pi].code === 91) {
    numBoundaryPaths = parseInt(pairs[pi].value) || 0
    pi++
  }

  // Resolve color
  let color: string | undefined
  if (trueColor > 0) color = trueColorToHexFast(trueColor)
  else if (colorIndex > 0) color = aciToHexFast(colorIndex)

  // Parse boundary paths → SVG path data
  const svgParts: string[] = []
  let sumX = 0, sumY = 0, ptCount = 0

  for (let bp = 0; bp < numBoundaryPaths && pi < pairs.length; bp++) {
    if (pairs[pi].code !== 92) break
    const pathTypeFlag = parseInt(pairs[pi].value) || 0
    pi++
    const isPolyline = (pathTypeFlag & 2) !== 0

    if (isPolyline) {
      // Polyline boundary
      const hasBulge = (pi < pairs.length && pairs[pi].code === 72) ? (parseInt(pairs[pi++].value) || 0) : 0
      const isClosed = (pi < pairs.length && pairs[pi].code === 73) ? (parseInt(pairs[pi++].value) || 0) : 1
      const numVerts = (pi < pairs.length && pairs[pi].code === 93) ? (parseInt(pairs[pi++].value) || 0) : 0

      const verts: Array<{ x: number; y: number }> = []
      for (let v = 0; v < numVerts && pi < pairs.length; v++) {
        let vx = 0, vy = 0
        if (pairs[pi].code === 10) { vx = parseFloat(pairs[pi].value) || 0; pi++ }
        if (pi < pairs.length && pairs[pi].code === 20) { vy = parseFloat(pairs[pi].value) || 0; pi++ }
        if (hasBulge && pi < pairs.length && pairs[pi].code === 42) pi++
        verts.push({ x: vx, y: vy })
        sumX += vx; sumY += vy; ptCount++
      }
      if (verts.length >= 2) {
        const pts = [`M${verts[0].x},${verts[0].y}`]
        for (let v = 1; v < verts.length; v++) pts.push(`L${verts[v].x},${verts[v].y}`)
        if (isClosed) pts.push('Z')
        svgParts.push(pts.join(''))
      }
    } else {
      // Edge boundary
      const numEdges = (pi < pairs.length && pairs[pi].code === 93) ? (parseInt(pairs[pi++].value) || 0) : 0
      const edgeParts: string[] = []
      let started = false

      for (let e = 0; e < numEdges && pi < pairs.length; e++) {
        if (pairs[pi].code !== 72) break
        const edgeType = parseInt(pairs[pi].value) || 0
        pi++

        if (edgeType === 1) {
          // Line edge
          let x1 = 0, y1 = 0, x2 = 0, y2 = 0
          while (pi < pairs.length && pairs[pi].code !== 72 && pairs[pi].code !== 92 && pairs[pi].code !== 0) {
            const c = pairs[pi].code, v = parseFloat(pairs[pi].value) || 0
            if (c === 10) x1 = v; else if (c === 20) y1 = v
            else if (c === 11) x2 = v; else if (c === 21) y2 = v
            else if (c === 97) break
            pi++
          }
          if (!started) { edgeParts.push(`M${x1},${y1}`); started = true }
          edgeParts.push(`L${x2},${y2}`)
          sumX += x1 + x2; sumY += y1 + y2; ptCount += 2
        } else if (edgeType === 2) {
          // Arc edge
          let cx = 0, cy = 0, r = 0, sa = 0, ea = 360, ccw = 1
          while (pi < pairs.length && pairs[pi].code !== 72 && pairs[pi].code !== 92 && pairs[pi].code !== 0) {
            const c = pairs[pi].code, v = parseFloat(pairs[pi].value) || 0
            if (c === 10) cx = v; else if (c === 20) cy = v
            else if (c === 40) r = v; else if (c === 50) sa = v
            else if (c === 51) ea = v; else if (c === 73) ccw = v
            else if (c === 97) break
            pi++
          }
          let saRad = sa * Math.PI / 180, eaRad = ea * Math.PI / 180
          if (!ccw) { const tmp = saRad; saRad = eaRad; eaRad = tmp }
          if (eaRad <= saRad) eaRad += 2 * Math.PI
          const steps = Math.max(3, Math.ceil(((eaRad - saRad) * 180) / (Math.PI * 15)))
          const dt = (eaRad - saRad) / steps
          for (let s = 0; s <= steps; s++) {
            const t = saRad + dt * s
            const px = cx + r * Math.cos(t), py = cy + r * Math.sin(t)
            edgeParts.push(s === 0 && !started ? `M${px},${py}` : `L${px},${py}`)
            if (s === 0) started = true
          }
          sumX += cx; sumY += cy; ptCount++
        } else if (edgeType === 3) {
          // Ellipse edge
          let cx = 0, cy = 0, mx = 0, my = 0, ratio = 1, esa = 0, eea = 2 * Math.PI
          while (pi < pairs.length && pairs[pi].code !== 72 && pairs[pi].code !== 92 && pairs[pi].code !== 0) {
            const c = pairs[pi].code, v = parseFloat(pairs[pi].value) || 0
            if (c === 10) cx = v; else if (c === 20) cy = v
            else if (c === 11) mx = v; else if (c === 21) my = v
            else if (c === 40) ratio = v
            else if (c === 50) esa = v; else if (c === 51) eea = v
            else if (c === 97) break
            pi++
          }
          const a = Math.hypot(mx, my), b = a * ratio
          const rot = Math.atan2(my, mx)
          const cosR = Math.cos(rot), sinR = Math.sin(rot)
          if (eea <= esa) eea += 2 * Math.PI
          const N = 18, ddt = (eea - esa) / N
          for (let s = 0; s <= N; s++) {
            const t = esa + ddt * s
            const lx = a * Math.cos(t), ly = b * Math.sin(t)
            const px = cx + lx * cosR - ly * sinR, py = cy + lx * sinR + ly * cosR
            edgeParts.push(s === 0 && !started ? `M${px},${py}` : `L${px},${py}`)
            if (s === 0) started = true
          }
          sumX += cx; sumY += cy; ptCount++
        } else if (edgeType === 4) {
          // Spline edge
          let spDegree = 3, numKnots = 0, numCtrl = 0
          while (pi < pairs.length && pairs[pi].code !== 72 && pairs[pi].code !== 92 && pairs[pi].code !== 0) {
            const c = pairs[pi].code
            if (c === 94) spDegree = parseInt(pairs[pi].value) || 3
            else if (c === 95) numKnots = parseInt(pairs[pi].value) || 0
            else if (c === 96) { numCtrl = parseInt(pairs[pi].value) || 0; pi++; break }
            else if (c === 97) break
            pi++
          }
          const spKnots: number[] = []
          for (let kk = 0; kk < numKnots && pi < pairs.length; kk++) {
            if (pairs[pi].code === 40) { spKnots.push(parseFloat(pairs[pi].value) || 0); pi++ }
          }
          const spCtrl: Array<{ x: number; y: number }> = []
          for (let cp = 0; cp < numCtrl && pi < pairs.length; ) {
            if (pairs[pi].code === 10) {
              const cx2 = parseFloat(pairs[pi].value) || 0; pi++
              const cy2 = (pi < pairs.length && pairs[pi].code === 20) ? (parseFloat(pairs[pi++].value) || 0) : 0
              spCtrl.push({ x: cx2, y: cy2 }); cp++
            } else if (pairs[pi].code === 72 || pairs[pi].code === 92 || pairs[pi].code === 0 || pairs[pi].code === 97) {
              break
            } else { pi++ }
          }
          // Skip fit points
          while (pi < pairs.length && pairs[pi].code === 42) pi++
          while (pi < pairs.length && (pairs[pi].code === 11 || pairs[pi].code === 21)) pi++

          // B-spline evaluation
          if (spCtrl.length >= 2 && spKnots.length >= spCtrl.length + spDegree + 1) {
            const pts2d = spCtrl.map(p => [p.x, p.y])
            const N2 = Math.max(spCtrl.length * 4, 16)
            const tMin = spKnots[spDegree], tMax = spKnots[spCtrl.length]
            if (tMax > tMin) {
              for (let s = 0; s <= N2; s++) {
                const t = tMin + (tMax - tMin) * s / N2
                const pt = deBoor(spDegree, pts2d, spKnots, t)
                edgeParts.push(s === 0 && !started ? `M${pt[0]},${pt[1]}` : `L${pt[0]},${pt[1]}`)
                if (s === 0) started = true
                sumX += pt[0]; sumY += pt[1]; ptCount++
              }
            }
          } else if (spCtrl.length >= 2) {
            for (let s = 0; s < spCtrl.length; s++) {
              edgeParts.push(s === 0 && !started ? `M${spCtrl[s].x},${spCtrl[s].y}` : `L${spCtrl[s].x},${spCtrl[s].y}`)
              if (s === 0) started = true
              sumX += spCtrl[s].x; sumY += spCtrl[s].y; ptCount++
            }
          }
        } else {
          // Unknown edge type - skip
          while (pi < pairs.length && pairs[pi].code !== 72 && pairs[pi].code !== 92 && pairs[pi].code !== 0) {
            if (pairs[pi].code === 97) break
            pi++
          }
        }
      }

      if (started) {
        edgeParts.push('Z')
        svgParts.push(edgeParts.join(''))
      }
    }

    // Skip source boundary objects (gc 97 + 330 handles)
    while (pi < pairs.length && (pairs[pi].code === 97 || pairs[pi].code === 330)) {
      if (pairs[pi].code === 97) {
        const cnt = parseInt(pairs[pi].value) || 0
        pi++
        for (let s = 0; s < cnt && pi < pairs.length; s++) {
          if (pairs[pi].code === 330) pi++
        }
      } else { pi++ }
    }
  }

  if (svgParts.length === 0 || ptCount === 0) return null

  return {
    pathData: svgParts.join(''),
    patternName: patternName.toUpperCase(),
    patternScale,
    patternAngle,
    color,
    layer,
    cx: sumX / ptCount,
    cy: sumY / ptCount,
  }
}

/** Pre-compute block entity into polyline (LINE/ARC/CIRCLE/ELLIPSE/LWPOLYLINE).
 *  Returns null for entities that can't be precomputed (INSERT, TEXT, SPLINE, etc.) */
function precomputeEntity(chunk: string): PrecomputedPoly | null {
  const { type, codes } = parseGroupCodes(chunk)
  const rawLayer = codes.get(8)?.[0]?.trim() ?? null
  const colorNumber = codes.get(62)?.[0] ? parseInt(codes.get(62)![0]) : -1
  const ez = codes.get(230)?.[0] ? parseFloat(codes.get(230)![0]) : 1

  let poly: number[][] | null = null

  switch (type) {
    case 'LINE': {
      const x1 = parseFloat(codes.get(10)?.[0] ?? '0')
      const y1 = parseFloat(codes.get(20)?.[0] ?? '0')
      const x2 = parseFloat(codes.get(11)?.[0] ?? '0')
      const y2 = parseFloat(codes.get(21)?.[0] ?? '0')
      if (Math.abs(x1 - x2) > 1e-6 || Math.abs(y1 - y2) > 1e-6) {
        poly = [[x1, y1], [x2, y2]]
      }
      break
    }
    case 'ARC': {
      const cx = parseFloat(codes.get(10)?.[0] ?? '0')
      const cy = parseFloat(codes.get(20)?.[0] ?? '0')
      const r = parseFloat(codes.get(40)?.[0] ?? '0')
      if (r > 0.01) {
        const sa = parseFloat(codes.get(50)?.[0] ?? '0') * Math.PI / 180
        const ea = parseFloat(codes.get(51)?.[0] ?? '360') * Math.PI / 180
        poly = interpEllipse(cx, cy, r, r, sa, ea)
        if (ez === -1) for (const p of poly) p[0] = -p[0]
      }
      break
    }
    case 'CIRCLE': {
      const cx = parseFloat(codes.get(10)?.[0] ?? '0')
      const cy = parseFloat(codes.get(20)?.[0] ?? '0')
      const r = parseFloat(codes.get(40)?.[0] ?? '0')
      if (r > 0.01) {
        poly = interpEllipse(cx, cy, r, r, 0, Math.PI * 2)
        if (ez === -1) for (const p of poly) p[0] = -p[0]
      }
      break
    }
    case 'ELLIPSE': {
      const cx = parseFloat(codes.get(10)?.[0] ?? '0')
      const cy = parseFloat(codes.get(20)?.[0] ?? '0')
      const mjx = parseFloat(codes.get(11)?.[0] ?? '1')
      const mjy = parseFloat(codes.get(21)?.[0] ?? '0')
      const ratio = parseFloat(codes.get(40)?.[0] ?? '1')
      const sp = parseFloat(codes.get(41)?.[0] ?? '0')
      const ep = parseFloat(codes.get(42)?.[0] ?? `${Math.PI * 2}`)
      const rx = Math.sqrt(mjx * mjx + mjy * mjy)
      const ry = ratio * rx
      const rot = -Math.atan2(-mjy, mjx)
      poly = interpEllipse(cx, cy, rx, ry, sp, ep, rot)
      if (ez === -1) for (const p of poly) p[0] = -p[0]
      break
    }
    case 'LWPOLYLINE': {
      const xs = codes.get(10) || []
      const ys = codes.get(20) || []
      const bulges = codes.get(42) || []
      const flag = parseInt(codes.get(70)?.[0] ?? '0')
      const closed = (flag & 1) !== 0
      const n = Math.min(xs.length, ys.length)
      if (n < 2) break
      const verts: Vertex[] = []
      for (let i = 0; i < n; i++) {
        verts.push({ x: parseFloat(xs[i]), y: parseFloat(ys[i]), bulge: parseFloat(bulges[i] || '0') })
      }
      if (closed) verts.push({ ...verts[0], bulge: 0 })
      poly = []
      for (let i = 0; i < verts.length - 1; i++) {
        const f = verts[i], t = verts[i + 1]
        poly.push([f.x, f.y])
        if (f.bulge) poly.push(...bulgeArc(f.x, f.y, t.x, t.y, f.bulge))
        if (i === verts.length - 2) poly.push([t.x, t.y])
      }
      break
    }
    case 'SPLINE': {
      const degree = parseInt(codes.get(71)?.[0] ?? '3')
      const xs = codes.get(10) || []
      const ys = codes.get(20) || []
      const knotVals = codes.get(40) || []
      const weightVals = codes.get(41) || []
      const n = Math.min(xs.length, ys.length)
      if (n < 2) break
      const cps = []
      for (let i = 0; i < n; i++) {
        cps.push({ x: parseFloat(xs[i]), y: parseFloat(ys[i]) })
      }
      const knots = knotVals.map(v => parseFloat(v))
      const weights = weightVals.length ? weightVals.map(v => parseFloat(v)) : undefined
      if (knots.length >= n + degree + 1) {
        poly = interpBSpline(cps, degree, knots, weights)
      } else {
        poly = cps.map(p => [p.x, p.y])
      }
      break
    }
    case 'SOLID':
    case '3DFACE': {
      const x0 = parseFloat(codes.get(10)?.[0] ?? '0')
      const y0 = parseFloat(codes.get(20)?.[0] ?? '0')
      const x1 = parseFloat(codes.get(11)?.[0] ?? '0')
      const y1 = parseFloat(codes.get(21)?.[0] ?? '0')
      const x2 = parseFloat(codes.get(12)?.[0] ?? '0')
      const y2 = parseFloat(codes.get(22)?.[0] ?? '0')
      const x3 = parseFloat(codes.get(13)?.[0] ?? `${x2}`)
      const y3 = parseFloat(codes.get(23)?.[0] ?? `${y2}`)
      const dx01 = Math.abs(x0 - x1) + Math.abs(y0 - y1)
      const dx02 = Math.abs(x0 - x2) + Math.abs(y0 - y2)
      if (dx01 < 1e-6 && dx02 < 1e-6) break
      if (type === 'SOLID') {
        poly = [[x0, y0], [x1, y1], [x3, y3], [x2, y2], [x0, y0]]
      } else {
        poly = [[x0, y0], [x1, y1], [x2, y2], [x3, y3], [x0, y0]]
      }
      break
    }
    default:
      return null
  }

  if (!poly || poly.length < 2) return null
  return { vertices: poly, rawLayer, colorNumber }
}

/** 글로벌 엔티티 평가 카운터 (INSERT 재귀 폭발 방지) */
let globalEntityEvals = 0
const MAX_ENTITY_EVALS = 500_000

/** Convert a parsed entity to polyline vertices. Returns null for unsupported types. */
function entityToPolyline(
  type: string,
  codes: Map<number, string[]>,
  blocks: Map<string, BlockDef>,
  layerOverride: string,
  transforms: Transform[],
  depth: number,
  selectedLayers: Set<string>,
  output: PolylineData[],
  textsOutput?: TextData[],
): void {
  if (++globalEntityEvals > MAX_ENTITY_EVALS) return  // 총 평가 횟수 초과 → bail
  // DXF layer "0" inheritance: 블록 내부 엔티티가 layer "0"이면 INSERT 레이어 상속
  const entityOwnLayer = codes.get(8)?.[0]?.trim() || '0'
  const layer = (entityOwnLayer === '0' && layerOverride) ? layerOverride : entityOwnLayer
  const colorNum = codes.get(62)?.[0] ? parseInt(codes.get(62)![0]) : -1

  // TEXT/MTEXT → texts output (if provided)
  if ((type === 'TEXT' || type === 'MTEXT') && textsOutput) {
    const td = extractTextEntity(type, codes, layer, colorNum, transforms)
    if (td) textsOutput.push(td)
    return
  }
  const ez = codes.get(230)?.[0] ? parseFloat(codes.get(230)![0]) : 1

  let poly: number[][] | null = null

  switch (type) {
    case 'LINE': {
      const x1 = parseFloat(codes.get(10)?.[0] ?? '0')
      const y1 = parseFloat(codes.get(20)?.[0] ?? '0')
      const x2 = parseFloat(codes.get(11)?.[0] ?? '0')
      const y2 = parseFloat(codes.get(21)?.[0] ?? '0')
      poly = [[x1, y1], [x2, y2]]
      break
    }

    case 'LWPOLYLINE': {
      const xs = codes.get(10) || []
      const ys = codes.get(20) || []
      const bulges = codes.get(42) || []
      const flag = parseInt(codes.get(70)?.[0] ?? '0')
      const closed = (flag & 1) !== 0
      const n = Math.min(xs.length, ys.length)
      if (n < 2) break

      const verts: Vertex[] = []
      for (let i = 0; i < n; i++) {
        verts.push({ x: parseFloat(xs[i]), y: parseFloat(ys[i]), bulge: parseFloat(bulges[i] || '0') })
      }
      if (closed) verts.push({ ...verts[0], bulge: 0 })

      poly = []
      for (let i = 0; i < verts.length - 1; i++) {
        const f = verts[i], t = verts[i + 1]
        poly.push([f.x, f.y])
        if (f.bulge) {
          poly.push(...bulgeArc(f.x, f.y, t.x, t.y, f.bulge))
        }
        if (i === verts.length - 2) poly.push([t.x, t.y])
      }
      break
    }

    case 'ARC': {
      const cx = parseFloat(codes.get(10)?.[0] ?? '0')
      const cy = parseFloat(codes.get(20)?.[0] ?? '0')
      const r  = parseFloat(codes.get(40)?.[0] ?? '0')
      if (r <= 0.01) break  // 극소 반지름 → 점 방지
      const sa = parseFloat(codes.get(50)?.[0] ?? '0') * Math.PI / 180
      const ea = parseFloat(codes.get(51)?.[0] ?? '360') * Math.PI / 180
      poly = interpEllipse(cx, cy, r, r, sa, ea)
      if (ez === -1) for (const p of poly) p[0] = -p[0]
      break
    }

    case 'CIRCLE': {
      const cx = parseFloat(codes.get(10)?.[0] ?? '0')
      const cy = parseFloat(codes.get(20)?.[0] ?? '0')
      const r  = parseFloat(codes.get(40)?.[0] ?? '0')
      if (r <= 0.01) break  // 극소 반지름 → 점 방지
      poly = interpEllipse(cx, cy, r, r, 0, Math.PI * 2)
      if (ez === -1) for (const p of poly) p[0] = -p[0]
      break
    }

    case 'ELLIPSE': {
      const cx = parseFloat(codes.get(10)?.[0] ?? '0')
      const cy = parseFloat(codes.get(20)?.[0] ?? '0')
      const mjx = parseFloat(codes.get(11)?.[0] ?? '1')
      const mjy = parseFloat(codes.get(21)?.[0] ?? '0')
      const ratio = parseFloat(codes.get(40)?.[0] ?? '1')
      const sp = parseFloat(codes.get(41)?.[0] ?? '0')
      const ep = parseFloat(codes.get(42)?.[0] ?? `${Math.PI * 2}`)
      const rx = Math.sqrt(mjx * mjx + mjy * mjy)
      const ry = ratio * rx
      const rot = -Math.atan2(-mjy, mjx)
      poly = interpEllipse(cx, cy, rx, ry, sp, ep, rot)
      if (ez === -1) for (const p of poly) p[0] = -p[0]
      break
    }

    case 'SPLINE': {
      const degree = parseInt(codes.get(71)?.[0] ?? '3')
      const xs = codes.get(10) || []
      const ys = codes.get(20) || []
      const knotVals = codes.get(40) || []
      const weightVals = codes.get(41) || []
      const n = Math.min(xs.length, ys.length)
      if (n < 2) break
      const cps = []
      for (let i = 0; i < n; i++) {
        cps.push({ x: parseFloat(xs[i]), y: parseFloat(ys[i]) })
      }
      const knots = knotVals.map(v => parseFloat(v))
      const weights = weightVals.length ? weightVals.map(v => parseFloat(v)) : undefined
      if (knots.length >= n + degree + 1) {
        poly = interpBSpline(cps, degree, knots, weights)
      } else {
        // Fallback: connect control points
        poly = cps.map(p => [p.x, p.y])
      }
      break
    }

    case 'SOLID':
    case '3DFACE': {
      const x0 = parseFloat(codes.get(10)?.[0] ?? '0')
      const y0 = parseFloat(codes.get(20)?.[0] ?? '0')
      const x1 = parseFloat(codes.get(11)?.[0] ?? '0')
      const y1 = parseFloat(codes.get(21)?.[0] ?? '0')
      const x2 = parseFloat(codes.get(12)?.[0] ?? '0')
      const y2 = parseFloat(codes.get(22)?.[0] ?? '0')
      const x3 = parseFloat(codes.get(13)?.[0] ?? `${x2}`)
      const y3 = parseFloat(codes.get(23)?.[0] ?? `${y2}`)
      // 축퇴된 SOLID/3DFACE 건너뛰기 (모든 꼭짓점이 같은 위치 → 점처럼 보임)
      const dx01 = Math.abs(x0 - x1) + Math.abs(y0 - y1)
      const dx02 = Math.abs(x0 - x2) + Math.abs(y0 - y2)
      if (dx01 < 1e-6 && dx02 < 1e-6) break  // 모두 같은 점
      if (type === 'SOLID') {
        // SOLID vertex order is swapped: 0→1→3→2→close
        poly = [[x0, y0], [x1, y1], [x3, y3], [x2, y2], [x0, y0]]
      } else {
        poly = [[x0, y0], [x1, y1], [x2, y2], [x3, y3], [x0, y0]]
      }
      break
    }

    case 'DIMENSION': {
      // DIMENSION: 익명 블록(*D0, *D1) 확장은 엔티티 폭발 + 좌표 이상 유발 → 건너뜀
      // 치수선은 시각적 보조 요소로, 구조 도면에 필수가 아님
      break
    }

    case 'INSERT': {
      if (depth >= MAX_DEPTH) break
      const blockName = codes.get(2)?.[0]?.trim() ?? ''
      const block = blocks.get(blockName)
      if (!block) break
      const totalEnts = block.entityChunks.length + block.precomputed.length
      if (totalEnts > 2000) break  // 거대 블록 건너뛰기 (성능 보호)

      const ix = parseFloat(codes.get(10)?.[0] ?? '0')
      const iy = parseFloat(codes.get(20)?.[0] ?? '0')
      const sx = parseFloat(codes.get(41)?.[0] ?? '1')
      const sy = parseFloat(codes.get(42)?.[0] ?? '1')
      const rot = parseFloat(codes.get(50)?.[0] ?? '0')
      const rowN = Math.min(parseInt(codes.get(71)?.[0] ?? '1') || 1, 50)  // 배열 폭발 방지
      const colN = Math.min(parseInt(codes.get(70)?.[0] ?? '1') || 1, 50)
      const colSp = parseFloat(codes.get(44)?.[0] ?? '0')  // 44 = column spacing (DXF spec)
      const rowSp = parseFloat(codes.get(45)?.[0] ?? '0')  // 45 = row spacing (DXF spec)
      const iez = codes.get(230)?.[0] ? parseFloat(codes.get(230)![0]) : 1

      const rotRad = rot * Math.PI / 180
      const cosR = Math.cos(rotRad), sinR = Math.sin(rotRad)

      for (let r = 0; r < rowN; r++) {
        for (let c = 0; c < colN; c++) {
          const ox = ix + (-sinR * rowSp * r) + (cosR * colSp * c)
          const oy = iy + (cosR * rowSp * r) + (sinR * colSp * c)

          const t: Transform = { x: ox, y: oy, sx, sy, rot, ez: iez }
          const nextTransforms = [...transforms, t]

          // ── Fast path: precomputed entities (LINE/ARC/CIRCLE/ELLIPSE/LWPOLYLINE) ──
          // 블록 정의 시 1회 파싱 완료 → INSERT마다 clone+transform만 (재파싱 없음)
          for (const pe of block.precomputed) {
            if (output.length >= MAX_POLYLINES) break
            globalEntityEvals++
            if (globalEntityEvals > MAX_ENTITY_EVALS) break

            // DXF layer "0" inheritance: null(gc8 없음) 또는 "0" → INSERT 레이어 상속
            const entityLayer = (!pe.rawLayer || pe.rawLayer === '0') ? layer : pe.rawLayer
            if (selectedLayers.size > 0 && !selectedLayers.has(entityLayer)) continue

            // Clone vertices + apply base point offset + transforms
            const verts: number[][] = new Array(pe.vertices.length)
            for (let vi = 0; vi < pe.vertices.length; vi++) {
              verts[vi] = [pe.vertices[vi][0] - block.baseX, pe.vertices[vi][1] - block.baseY]
            }
            for (const tr of nextTransforms) applyTransform(verts, tr)
            output.push({ vertices: verts, layer: entityLayer, colorNumber: pe.colorNumber })
          }

          // ── Slow path: remaining entity chunks (INSERT, TEXT, ATTRIB, etc.) ──
          for (const chunk of block.entityChunks) {
            if (output.length >= MAX_POLYLINES) break
            if (textsOutput && textsOutput.length >= MAX_TEXTS) break
            const { type: eType, codes: eCodes } = parseGroupCodes(chunk)
            // 블록 내부 엔티티 레이어: "0"이면 INSERT 레이어 상속
            const eOwnLayer = eCodes.get(8)?.[0]?.trim() || '0'
            const eLayer = (eOwnLayer === '0' && layer) ? layer : eOwnLayer
            if (eType === 'INSERT') {
              const subOutput: PolylineData[] = []
              entityToPolyline(eType, eCodes, blocks, layer, [], depth + 1, selectedLayers, subOutput, textsOutput)
              for (const pl of subOutput) {
                if (selectedLayers.size > 0 && !selectedLayers.has(pl.layer)) continue
                for (const p of pl.vertices) { p[0] -= block.baseX; p[1] -= block.baseY }
                for (const tr of nextTransforms) applyTransform(pl.vertices, tr)
                output.push(pl)
              }
            } else if ((eType === 'TEXT' || eType === 'MTEXT' || eType === 'ATTRIB') && textsOutput) {
              // ATTRIB: INSERT에 부착된 속성 텍스트 (이름표, 번호 등)
              if (selectedLayers.size > 0 && !selectedLayers.has(eLayer)) continue
              const blockColor = eCodes.get(62)?.[0] ? parseInt(eCodes.get(62)![0]) : -1
              const td = extractTextEntity(eType === 'ATTRIB' ? 'TEXT' : eType, eCodes, eLayer, blockColor, nextTransforms)
              if (td) {
                const rawX = parseFloat(eCodes.get(10)?.[0] ?? '0') - block.baseX
                const rawY = parseFloat(eCodes.get(20)?.[0] ?? '0') - block.baseY
                const pt = [[rawX, rawY]]
                for (const tr of nextTransforms) applyTransform(pt, tr)
                td.x = pt[0][0]; td.y = pt[0][1]
                textsOutput.push(td)
              }
            } else {
              if (selectedLayers.size > 0 && !selectedLayers.has(eLayer)) continue
              const subOutput: PolylineData[] = []
              entityToPolyline(eType, eCodes, blocks, layer, [], depth + 1, selectedLayers, subOutput, textsOutput)
              for (const pl of subOutput) {
                for (const p of pl.vertices) { p[0] -= block.baseX; p[1] -= block.baseY }
                for (const tr of nextTransforms) applyTransform(pl.vertices, tr)
                output.push(pl)
              }
            }
          }
        }
      }
      return  // INSERT/DIMENSION handled, don't add poly
    }
  }

  if (poly && poly.length >= 2) {
    // Apply accumulated transforms (from parent INSERTs)
    if (transforms.length) {
      for (const tr of transforms) applyTransform(poly, tr)
    }

    // 점 방지: 바운딩박스가 극소인 폴리라인 건너뛰기
    let pMinX = poly[0][0], pMaxX = poly[0][0], pMinY = poly[0][1], pMaxY = poly[0][1]
    for (let i = 1; i < poly.length; i++) {
      if (poly[i][0] < pMinX) pMinX = poly[i][0]
      if (poly[i][0] > pMaxX) pMaxX = poly[i][0]
      if (poly[i][1] < pMinY) pMinY = poly[i][1]
      if (poly[i][1] > pMaxY) pMaxY = poly[i][1]
    }
    const span = Math.max(pMaxX - pMinX, pMaxY - pMinY)
    if (span < 0.1) return  // 너무 작은 폴리라인 → 점처럼 보임

    output.push({ vertices: poly, layer, colorNumber: colorNum })
  }
}

// ===== Main parsing orchestrator =====

/** DXF 특수문자 코드(%%X) → 유니코드 변환 */
function decodeDxfSpecialChars(text: string): string {
  return text
    .replace(/%%[Pp]/g, '±')
    .replace(/%%[Dd]/g, '°')
    .replace(/%%[Cc]/g, '∅')
    .replace(/%%[Uu]/g, '')
    .replace(/%%[Oo]/g, '')
    .replace(/%%%/g, '%')
    .replace(/%%(\d{3})/g, (_, code) => String.fromCharCode(parseInt(code)))
}

/** MTEXT 서식 코드 제거 */
function cleanMtextFormatting(text: string): string {
  return text
    .replace(/\\P/g, ' ')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\[a-zA-Z][^;]*;/g, '')
    .trim()
}

/** Extract TEXT/MTEXT data from parsed group codes */
function extractTextEntity(
  type: string,
  codes: Map<number, string[]>,
  layer: string,
  colorNum: number,
  transforms: Transform[],
): TextData | null {
  if (type !== 'TEXT' && type !== 'MTEXT') return null

  let x = parseFloat(codes.get(10)?.[0] ?? '0')
  let y = parseFloat(codes.get(20)?.[0] ?? '0')
  const height = parseFloat(codes.get(40)?.[0] ?? '2.5')
  const rotation = parseFloat(codes.get(50)?.[0] ?? '0') || undefined

  let text: string
  if (type === 'TEXT') {
    text = decodeDxfSpecialChars((codes.get(1)?.[0] ?? '').trim())
  } else {
    // MTEXT: group code 1 + additional content in group code 3
    const parts = [codes.get(1)?.[0] ?? '', ...(codes.get(3) || [])]
    text = cleanMtextFormatting(decodeDxfSpecialChars(parts.join('').trim()))
  }
  if (!text) return null

  // Apply transforms (from parent INSERTs)
  if (transforms.length) {
    const pt = [[x, y]]
    for (const tr of transforms) applyTransform(pt, tr)
    x = pt[0][0]; y = pt[0][1]
  }

  return { x, y, text, height, rotation, layer, colorNumber: colorNum }
}

function parseDxfFast(rawText: string, selectedLayers: string[], progress: (phase: string, pct: number) => void): { polylines: PolylineData[]; insUnits: number; texts: TextData[]; hatches: HatchData[] } {
  const t0 = performance.now()
  globalEntityEvals = 0  // 글로벌 카운터 리셋
  const layerSet = new Set(selectedLayers)

  // 0. \r\n → \n 정규화 (Windows DXF 파일 호환)
  progress('줄바꿈 정규화', 2)
  const dxfText = rawText.indexOf('\r') >= 0 ? rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n') : rawText

  // 0-1. 패딩 감지 → 패턴 동적 생성 (186MB 파일에서 regex 정규화 대신 메모리 절약)
  const padded = dxfText.charCodeAt(0) === 32
  const gc = padded ? (c: number) => String(c).padStart(3) : (c: number) => String(c)
  const SEP_PAT = `\n${gc(0)}\n`   // entity/section boundary pattern
  const GC8_PAT = `\n${gc(8)}\n`   // layer group code
  console.log(`[fast-worker] 텍스트 길이: ${dxfText.length} chars, 패딩: ${padded}, SEP=${JSON.stringify(SEP_PAT)}`)

  // 1. Header → units
  progress('헤더 분석', 5)
  const insUnits = parseInsUnits(dxfText, gc)

  // 2. Blocks
  progress('블록 정의 파싱', 10)
  const blocks = parseBlocks(dxfText, gc)
  console.log(`[fast-worker] ${blocks.size}개 블록 정의 (${(performance.now() - t0).toFixed(0)}ms)`)

  // 3. Entities section (padding-aware)
  progress('엔티티 섹션 추출', 20)
  const ENDSEC_PAT = `\n${gc(0)}\nENDSEC`
  let entHdr = `\n${gc(0)}\nSECTION\n${gc(2)}\nENTITIES\n`
  let entIdx = dxfText.indexOf(entHdr)
  if (entIdx < 0) {
    // 파일 시작이 0\nSECTION 인 경우 (HEADER 없는 DXF)
    entHdr = `${gc(0)}\nSECTION\n${gc(2)}\nENTITIES\n`
    entIdx = dxfText.indexOf(entHdr)
  }
  if (entIdx < 0) {
    console.warn('[fast-worker] ENTITIES 섹션 없음')
    return { polylines: [], insUnits, texts: [], hatches: [] }
  }
  const entStart = entIdx + entHdr.length
  const entEnd = dxfText.indexOf(ENDSEC_PAT, entStart)
  if (entEnd <= entStart) return { polylines: [], insUnits, texts: [], hatches: [] }

  // 4. indexOf-based entity scanning (padding-aware SEP_PAT / GC8_PAT)
  //    Peak memory: O(selected entities) instead of O(all entities)

  // Additional padded group code patterns for entity parsing
  const GC1  = `\n${gc(1)}\n`
  const GC10 = `\n${gc(10)}\n`
  const GC11 = `\n${gc(11)}\n`
  const GC20 = `\n${gc(20)}\n`
  const GC21 = `\n${gc(21)}\n`
  const GC40 = `\n${gc(40)}\n`
  const GC42 = `\n${gc(42)}\n`
  const GC50 = `\n${gc(50)}\n`
  const GC51 = `\n${gc(51)}\n`
  const GC62 = `\n${gc(62)}\n`
  const GC70 = `\n${gc(70)}\n`
  const GC230 = `\n${gc(230)}\n`

  // Estimate total entities from section size (skip expensive pre-count scan)
  const entSectionLen = entEnd - entStart
  const estEntities = Math.max(1, Math.round(entSectionLen / 300))  // ~300 bytes per entity avg
  console.log(`[fast-worker] ENTITIES 섹션: ${(entSectionLen / 1048576).toFixed(1)}MB, 추정 ${estEntities}개 (${(performance.now() - t0).toFixed(0)}ms)`)

  progress('도면 요소 변환', 30)
  const output: PolylineData[] = []
  const texts: TextData[] = []
  const hatches: HatchData[] = []

  // Handle POLYLINE (old-style): accumulate VERTEX entities
  let polylineState: { layer: string; colorNum: number; vertices: Vertex[]; closed: boolean } | null = null

  let errCount = 0
  let entityIdx = 0

  // First SEP is at entStart - 1 (the \n from ENTITIES header + gc(0) + \n)
  let sepPos = entStart - 1

  while (true) {
    if (output.length >= MAX_POLYLINES && texts.length >= MAX_TEXTS) {
      console.warn(`[fast-worker] 폴리라인 ${MAX_POLYLINES}개 + 텍스트 ${MAX_TEXTS}개 제한 도달, 나머지 건너뜀`)
      break
    }

    const si = dxfText.indexOf(SEP_PAT, sepPos)
    if (si < 0 || si >= entEnd) break

    const eStart = si + SEP_PAT.length             // entity content start (TYPE\n...)
    const nextSi = dxfText.indexOf(SEP_PAT, eStart)
    const eEnd = (nextSi >= 0 && nextSi < entEnd) ? nextSi : entEnd

    entityIdx++
    if (entityIdx % 5000 === 0) {
      progress('도면 요소 변환', 30 + Math.round(((si - entStart) / entSectionLen) * 60))
    }

    try {
      // Extract type (first line only — tiny substring)
      const typeNl = dxfText.indexOf('\n', eStart)
      const type = dxfText.substring(eStart, (typeNl > 0 && typeNl < eEnd) ? typeNl : eEnd).trim()

      // --- POLYLINE state machine ---
      if (type === 'VERTEX' && polylineState) {
        const x10 = idxIn(dxfText, GC10, eStart, eEnd)
        const y20 = idxIn(dxfText, GC20, eStart, eEnd)
        if (x10 >= 0 && y20 >= 0) {
          const b42 = idxIn(dxfText, GC42, eStart, eEnd)
          polylineState.vertices.push({
            x: floatAt(dxfText, x10 + GC10.length, eEnd),
            y: floatAt(dxfText, y20 + GC20.length, eEnd),
            bulge: b42 >= 0 ? floatAt(dxfText, b42 + GC42.length, eEnd) : 0,
          })
        }
        sepPos = nextSi >= 0 && nextSi < entEnd ? nextSi : entEnd; continue
      }

      if (type === 'SEQEND' && polylineState) {
        const verts = polylineState.vertices
        if (polylineState.closed && verts.length > 0) verts.push({ ...verts[0], bulge: 0 })
        if (verts.length >= 2) {
          const poly: number[][] = []
          for (let j = 0; j < verts.length - 1; j++) {
            const f = verts[j], t = verts[j + 1]
            poly.push([f.x, f.y])
            if (f.bulge) poly.push(...bulgeArc(f.x, f.y, t.x, t.y, f.bulge))
            if (j === verts.length - 2) poly.push([t.x, t.y])
          }
          if (poly.length >= 2) {
            output.push({ vertices: poly, layer: polylineState.layer, colorNumber: polylineState.colorNum })
          }
        }
        polylineState = null
        sepPos = nextSi >= 0 && nextSi < entEnd ? nextSi : entEnd; continue
      }

      // Finalize any orphaned POLYLINE
      if (polylineState && type !== 'VERTEX') polylineState = null

      // --- Quick layer check via indexOf (padding-aware) ---
      const l8 = idxIn(dxfText, GC8_PAT, eStart, eEnd)
      const entityLayer = l8 >= 0 ? valAt(dxfText, l8 + GC8_PAT.length, eEnd) : '0'

      if (!layerSet.has(entityLayer)) {  // ← THE KEY OPTIMIZATION
        sepPos = nextSi >= 0 && nextSi < entEnd ? nextSi : entEnd; continue
      }

      // Start POLYLINE state
      if (type === 'POLYLINE') {
        const f70 = idxIn(dxfText, GC70, eStart, eEnd)
        const c62 = idxIn(dxfText, GC62, eStart, eEnd)
        polylineState = {
          layer: entityLayer,
          colorNum: c62 >= 0 ? parseInt(valAt(dxfText, c62 + GC62.length, eEnd)) : -1,
          vertices: [],
          closed: f70 >= 0 ? (parseInt(valAt(dxfText, f70 + GC70.length, eEnd)) & 1) !== 0 : false,
        }
        sepPos = nextSi >= 0 && nextSi < entEnd ? nextSi : entEnd; continue
      }

      // ── Fast-path: LINE (가장 흔한 엔티티, parseGroupCodes 건너뛰기) ──
      if (type === 'LINE') {
        const x1i = idxIn(dxfText, GC10, eStart, eEnd)
        const y1i = idxIn(dxfText, GC20, eStart, eEnd)
        const x2i = idxIn(dxfText, GC11, eStart, eEnd)
        const y2i = idxIn(dxfText, GC21, eStart, eEnd)
        if (x1i >= 0 && y1i >= 0 && x2i >= 0 && y2i >= 0) {
          const lx1 = floatAt(dxfText, x1i + GC10.length, eEnd)
          const ly1 = floatAt(dxfText, y1i + GC20.length, eEnd)
          const lx2 = floatAt(dxfText, x2i + GC11.length, eEnd)
          const ly2 = floatAt(dxfText, y2i + GC21.length, eEnd)
          // 길이 0인 LINE 건너뛰기 (점처럼 보임)
          if (Math.abs(lx1 - lx2) > 1e-6 || Math.abs(ly1 - ly2) > 1e-6) {
            const c62 = idxIn(dxfText, GC62, eStart, eEnd)
            output.push({
              vertices: [[lx1, ly1], [lx2, ly2]],
              layer: entityLayer,
              colorNumber: c62 >= 0 ? parseInt(valAt(dxfText, c62 + GC62.length, eEnd)) : -1,
            })
          }
        }
        sepPos = nextSi >= 0 && nextSi < entEnd ? nextSi : entEnd; continue
      }

      // ── Fast-path: ARC ──
      if (type === 'ARC') {
        const cxi = idxIn(dxfText, GC10, eStart, eEnd)
        const cyi = idxIn(dxfText, GC20, eStart, eEnd)
        const ri  = idxIn(dxfText, GC40, eStart, eEnd)
        if (cxi >= 0 && cyi >= 0 && ri >= 0) {
          const cx = floatAt(dxfText, cxi + GC10.length, eEnd)
          const cy = floatAt(dxfText, cyi + GC20.length, eEnd)
          const r  = floatAt(dxfText, ri + GC40.length, eEnd)
          if (r > 0.01) {  // 극소 반지름 ARC 건너뛰기 (점처럼 보임)
            const sai = idxIn(dxfText, GC50, eStart, eEnd)
            const eai = idxIn(dxfText, GC51, eStart, eEnd)
            const sa = (sai >= 0 ? floatAt(dxfText, sai + GC50.length, eEnd) : 0) * Math.PI / 180
            const ea = (eai >= 0 ? floatAt(dxfText, eai + GC51.length, eEnd) : 360) * Math.PI / 180
            const poly = interpEllipse(cx, cy, r, r, sa, ea)
            const ezi = idxIn(dxfText, GC230, eStart, eEnd)
            if (ezi >= 0 && floatAt(dxfText, ezi + GC230.length, eEnd) === -1) {
              for (const p of poly) p[0] = -p[0]
            }
            const c62 = idxIn(dxfText, GC62, eStart, eEnd)
            output.push({
              vertices: poly, layer: entityLayer,
              colorNumber: c62 >= 0 ? parseInt(valAt(dxfText, c62 + GC62.length, eEnd)) : -1,
            })
          }
        }
        sepPos = nextSi >= 0 && nextSi < entEnd ? nextSi : entEnd; continue
      }

      // ── Fast-path: CIRCLE ──
      if (type === 'CIRCLE') {
        const cxi = idxIn(dxfText, GC10, eStart, eEnd)
        const cyi = idxIn(dxfText, GC20, eStart, eEnd)
        const ri  = idxIn(dxfText, GC40, eStart, eEnd)
        if (cxi >= 0 && cyi >= 0 && ri >= 0) {
          const cx = floatAt(dxfText, cxi + GC10.length, eEnd)
          const cy = floatAt(dxfText, cyi + GC20.length, eEnd)
          const r  = floatAt(dxfText, ri + GC40.length, eEnd)
          if (r > 0.01) {  // 극소 반지름 CIRCLE 건너뛰기 (점처럼 보임)
            const poly = interpEllipse(cx, cy, r, r, 0, Math.PI * 2)
            const ezi = idxIn(dxfText, GC230, eStart, eEnd)
            if (ezi >= 0 && floatAt(dxfText, ezi + GC230.length, eEnd) === -1) {
              for (const p of poly) p[0] = -p[0]
            }
            const c62 = idxIn(dxfText, GC62, eStart, eEnd)
            output.push({
              vertices: poly, layer: entityLayer,
              colorNumber: c62 >= 0 ? parseInt(valAt(dxfText, c62 + GC62.length, eEnd)) : -1,
            })
          }
        }
        sepPos = nextSi >= 0 && nextSi < entEnd ? nextSi : entEnd; continue
      }

      // ── Fast-path: TEXT / ATTRIB ──
      if (type === 'TEXT' || type === 'ATTRIB') {
        if (texts.length < MAX_TEXTS) {
          const xi = idxIn(dxfText, GC10, eStart, eEnd)
          const yi = idxIn(dxfText, GC20, eStart, eEnd)
          const ti = idxIn(dxfText, GC1, eStart, eEnd)
          if (xi >= 0 && yi >= 0 && ti >= 0) {
            const text = decodeDxfSpecialChars(valAt(dxfText, ti + GC1.length, eEnd))
            if (text) {
              const hi = idxIn(dxfText, GC40, eStart, eEnd)
              const ri = idxIn(dxfText, GC50, eStart, eEnd)
              const c62i = idxIn(dxfText, GC62, eStart, eEnd)
              texts.push({
                x: floatAt(dxfText, xi + GC10.length, eEnd),
                y: floatAt(dxfText, yi + GC20.length, eEnd),
                text,
                height: hi >= 0 ? floatAt(dxfText, hi + GC40.length, eEnd) : 2.5,
                rotation: ri >= 0 ? (floatAt(dxfText, ri + GC50.length, eEnd) || undefined) : undefined,
                layer: entityLayer,
                colorNumber: c62i >= 0 ? parseInt(valAt(dxfText, c62i + GC62.length, eEnd)) : -1,
              })
            }
          }
        }
        sepPos = nextSi >= 0 && nextSi < entEnd ? nextSi : entEnd; continue
      }

      // ── HATCH: sequential group-code parsing (complex nested boundary structure) ──
      if (type === 'HATCH') {
        if (hatches.length < MAX_HATCHES) {
          const chunk = dxfText.substring(eStart, eEnd)
          const hd = parseHatchEntity(chunk, entityLayer)
          if (hd) hatches.push(hd)
        }
        sepPos = nextSi >= 0 && nextSi < entEnd ? nextSi : entEnd; continue
      }

      // ── Generic path: substring + parseGroupCodes (LWPOLYLINE, SPLINE, ELLIPSE, INSERT, DIMENSION, etc.) ──
      const chunk = dxfText.substring(eStart, eEnd)
      const { codes } = parseGroupCodes(chunk)

      // MTEXT → texts array
      if (type === 'MTEXT') {
        if (texts.length < MAX_TEXTS) {
          const colorNum = codes.get(62)?.[0] ? parseInt(codes.get(62)![0]) : -1
          const td = extractTextEntity(type, codes, entityLayer, colorNum, [])
          if (td) texts.push(td)
        }
      } else {
        entityToPolyline(type, codes, blocks, '', [], 0, layerSet, output, texts)
      }

    } catch (err) {
      errCount++
      if (errCount <= 5) console.warn(`[fast-worker] 엔티티 #${entityIdx} 파싱 에러:`, err)
    }

    sepPos = nextSi >= 0 && nextSi < entEnd ? nextSi : entEnd
  }

  progress('완료', 95)
  const elapsed = (performance.now() - t0).toFixed(0)
  console.log(`[fast-worker] 파싱 완료: ${output.length}개 폴리라인, ${texts.length}개 텍스트, ${hatches.length}개 해치, ${errCount}개 에러 (${elapsed}ms)`)

  return { polylines: output, insUnits, texts, hatches }
}

// ===== Worker message handler =====

self.onmessage = (e: MessageEvent<ParseRequest>) => {
  if (e.data.type !== 'parse') return

  const post = (msg: WorkerOut) => (self as unknown as Worker).postMessage(msg)
  const progress = (phase: string, percent: number) => post({ type: 'progress', phase, percent })

  try {
    const result = parseDxfFast(e.data.dxfText, e.data.selectedLayers, progress)
    post({ type: 'result', polylines: result.polylines, insUnits: result.insUnits, texts: result.texts, hatches: result.hatches })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
