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

export type WorkerOut =
  | { type: 'progress'; phase: string; percent: number }
  | { type: 'result'; polylines: PolylineData[]; insUnits: number; texts: TextData[] }
  | { type: 'error'; message: string }

// ===== Internal types =====

interface Vertex { x: number; y: number; bulge: number }

interface BlockDef {
  name: string
  baseX: number
  baseY: number
  entityChunks: string[]   // raw text chunks for lazy parsing
}

interface Transform {
  x: number; y: number
  sx: number; sy: number
  rot: number             // degrees
  ez: number              // extrusionZ
}

const MAX_DEPTH = 8
const ARC_STEP  = 5       // degrees

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
    // Scale
    let x = p[0] * t.sx, y = p[1] * t.sy
    // Rotate
    if (t.rot) { const nx = x * cosR - y * sinR; y = y * cosR + x * sinR; x = nx }
    // Translate
    x += t.x; y += t.y
    // Extrusion Z flip
    if (t.ez === -1) x = -x
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
  const chunks = sec.split(sep)
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
      }
    } else if (type === 'ENDBLK') {
      if (cur) { blocks.set(cur.name, cur); cur = null }
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
  const layer = layerOverride || (codes.get(8)?.[0]?.trim() ?? '0')
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
      if (type === 'SOLID') {
        // SOLID vertex order is swapped: 0→1→3→2→close
        poly = [[x0, y0], [x1, y1], [x3, y3], [x2, y2], [x0, y0]]
      } else {
        poly = [[x0, y0], [x1, y1], [x2, y2], [x3, y3], [x0, y0]]
      }
      break
    }

    case 'INSERT':
    case 'DIMENSION': {
      if (depth >= MAX_DEPTH) break
      const blockName = codes.get(2)?.[0]?.trim() ?? ''
      const block = blocks.get(blockName)
      if (!block) break

      // DIMENSION uses anonymous blocks (*D0, *D1, etc.) — no position/scale/rotation
      // INSERT has full transform parameters
      const isInsert = type === 'INSERT'
      const ix = isInsert ? parseFloat(codes.get(10)?.[0] ?? '0') : 0
      const iy = isInsert ? parseFloat(codes.get(20)?.[0] ?? '0') : 0
      const sx = isInsert ? parseFloat(codes.get(41)?.[0] ?? '1') : 1
      const sy = isInsert ? parseFloat(codes.get(42)?.[0] ?? '1') : 1
      const rot = isInsert ? parseFloat(codes.get(50)?.[0] ?? '0') : 0
      const rowN = isInsert ? (parseInt(codes.get(71)?.[0] ?? '1') || 1) : 1
      const colN = isInsert ? (parseInt(codes.get(70)?.[0] ?? '1') || 1) : 1
      const rowSp = isInsert ? parseFloat(codes.get(44)?.[0] ?? '0') : 0
      const colSp = isInsert ? parseFloat(codes.get(45)?.[0] ?? '0') : 0
      const iez = codes.get(230)?.[0] ? parseFloat(codes.get(230)![0]) : 1

      const rotRad = rot * Math.PI / 180
      const cosR = Math.cos(rotRad), sinR = Math.sin(rotRad)

      for (let r = 0; r < rowN; r++) {
        for (let c = 0; c < colN; c++) {
          const ox = ix + (-sinR * rowSp * r) + (cosR * colSp * c)
          const oy = iy + (cosR * rowSp * r) + (sinR * colSp * c)

          const t: Transform = { x: ox, y: oy, sx, sy, rot, ez: iez }
          const nextTransforms = [...transforms, t]

          // Process block entities (inheriting layer per DXF convention)
          for (const chunk of block.entityChunks) {
            const { type: eType, codes: eCodes } = parseGroupCodes(chunk)
            if (eType === 'INSERT' || eType === 'DIMENSION') {
              // Nested INSERT/DIMENSION
              entityToPolyline(eType, eCodes, blocks, layer, nextTransforms, depth + 1, selectedLayers, output, textsOutput)
            } else if ((eType === 'TEXT' || eType === 'MTEXT') && textsOutput) {
              // TEXT/MTEXT inside block — extract with base point + transforms
              const blockColor = eCodes.get(62)?.[0] ? parseInt(eCodes.get(62)![0]) : -1
              const td = extractTextEntity(eType, eCodes, layer, blockColor, nextTransforms)
              if (td) {
                // Apply base point offset
                td.x -= block.baseX
                td.y -= block.baseY
                // Re-apply transforms (extractTextEntity already applied nextTransforms,
                // but we need to adjust for base point first — so we reconstruct)
                // Actually, simpler: adjust the raw coords before transform
                // Let's re-extract with adjusted coords:
                const rawX = parseFloat(eCodes.get(10)?.[0] ?? '0') - block.baseX
                const rawY = parseFloat(eCodes.get(20)?.[0] ?? '0') - block.baseY
                const pt = [[rawX, rawY]]
                for (const tr of nextTransforms) applyTransform(pt, tr)
                td.x = pt[0][0]; td.y = pt[0][1]
                textsOutput.push(td)
              }
            } else {
              // Geometry entity — subtract block base point, convert to polyline
              const subOutput: PolylineData[] = []
              entityToPolyline(eType, eCodes, blocks, layer, [], depth + 1, selectedLayers, subOutput, textsOutput)

              // Apply base point offset + all accumulated transforms
              for (const pl of subOutput) {
                // Subtract block base point
                for (const p of pl.vertices) { p[0] -= block.baseX; p[1] -= block.baseY }
                // Apply all transforms in order (innermost first)
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
    // Apply extrusion Z flip if entity-level (non-INSERT)
    // Already handled per entity type above

    // Apply accumulated transforms (from parent INSERTs)
    if (transforms.length) {
      for (const tr of transforms) applyTransform(poly, tr)
    }

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

function parseDxfFast(rawText: string, selectedLayers: string[], progress: (phase: string, pct: number) => void): { polylines: PolylineData[]; insUnits: number; texts: TextData[] } {
  const t0 = performance.now()
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
    return { polylines: [], insUnits, texts: [] }
  }
  const entStart = entIdx + entHdr.length
  const entEnd = dxfText.indexOf(ENDSEC_PAT, entStart)
  if (entEnd <= entStart) return { polylines: [], insUnits, texts: [] }

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

  // Handle POLYLINE (old-style): accumulate VERTEX entities
  let polylineState: { layer: string; colorNum: number; vertices: Vertex[]; closed: boolean } | null = null

  let errCount = 0
  let entityIdx = 0

  // First SEP is at entStart - 1 (the \n from ENTITIES header + gc(0) + \n)
  let sepPos = entStart - 1

  while (true) {
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
          const c62 = idxIn(dxfText, GC62, eStart, eEnd)
          output.push({
            vertices: [
              [floatAt(dxfText, x1i + GC10.length, eEnd), floatAt(dxfText, y1i + GC20.length, eEnd)],
              [floatAt(dxfText, x2i + GC11.length, eEnd), floatAt(dxfText, y2i + GC21.length, eEnd)],
            ],
            layer: entityLayer,
            colorNumber: c62 >= 0 ? parseInt(valAt(dxfText, c62 + GC62.length, eEnd)) : -1,
          })
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
        sepPos = nextSi >= 0 && nextSi < entEnd ? nextSi : entEnd; continue
      }

      // ── Fast-path: TEXT ──
      if (type === 'TEXT') {
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
        sepPos = nextSi >= 0 && nextSi < entEnd ? nextSi : entEnd; continue
      }

      // ── Generic path: substring + parseGroupCodes (LWPOLYLINE, SPLINE, ELLIPSE, INSERT, DIMENSION, etc.) ──
      const chunk = dxfText.substring(eStart, eEnd)
      const { codes } = parseGroupCodes(chunk)

      // MTEXT → texts array
      if (type === 'MTEXT') {
        const colorNum = codes.get(62)?.[0] ? parseInt(codes.get(62)![0]) : -1
        const td = extractTextEntity(type, codes, entityLayer, colorNum, [])
        if (td) texts.push(td)
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
  console.log(`[fast-worker] 파싱 완료: ${output.length}개 폴리라인, ${texts.length}개 텍스트, ${errCount}개 에러 (${elapsed}ms)`)

  return { polylines: output, insUnits, texts }
}

// ===== Worker message handler =====

self.onmessage = (e: MessageEvent<ParseRequest>) => {
  if (e.data.type !== 'parse') return

  const post = (msg: WorkerOut) => (self as unknown as Worker).postMessage(msg)
  const progress = (phase: string, percent: number) => post({ type: 'progress', phase, percent })

  try {
    const result = parseDxfFast(e.data.dxfText, e.data.selectedLayers, progress)
    post({ type: 'result', polylines: result.polylines, insUnits: result.insUnits, texts: result.texts })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
