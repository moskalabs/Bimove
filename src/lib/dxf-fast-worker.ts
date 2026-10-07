/**
 * dxf-fast-worker.ts — Custom DXF parser in a Web Worker
 *
 * Replaces npm `dxf` package (parseString + denormalise + toPolylines).
 * Key advantages:
 * - Only parses selected layers (skips 80–90% of entities)
 * - No lodash.cloneDeep for block expansion
 * - No intermediate JSON object model
 * - Progress reporting to main thread
 * - Zero npm dependencies (dxf-shared is internal)
 */

import { aciToHex, trueColorToHex, detectPadding, makeGcFormatter, decodeDxfSpecialChars, cleanMtextFormatting } from './dxf-shared'

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
  linetypeName?: string    // entity linetype name (gc 6); undefined = ByLayer
  lineweight?: number      // entity lineweight in 0.01mm (gc 370); undefined = ByLayer
  transparency?: number    // 0-100 (percent transparent); undefined = fully opaque
}

export interface TextData {
  x: number
  y: number
  text: string
  height: number
  rotation?: number
  layer: string
  colorNumber: number
  /** MTEXT attachment point (1-9): 1=TL 2=TC 3=TR 4=ML 5=MC 6=MR 7=BL 8=BC 9=BR */
  attachPt?: number
  /** MTEXT defined width (group code 41) for text wrapping */
  width?: number
  /** Font family name from STYLE table (gc 7 → style → font) */
  fontName?: string
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

/** Linetype 패턴 정의 (DXF TABLES → LTYPE) */
export interface LinetypeDef {
  name: string
  pattern: number[]   // 양수=dash, 음수=gap, 0=dot
  totalLen: number    // 패턴 총 길이 (gc 40)
}

/** 레이어 테이블 정보 (lineweight/color/transparency) */
export interface LayerInfo {
  lineweight?: number      // 0.01mm 단위
  colorIndex?: number      // ACI 1-255
  trueColor?: number       // 24-bit RGB
  transparency?: number    // 0-100 (percent transparent)
}

/**
 * 임포트가 **조용히 버린 것들**의 집계 (사유 → 개수).
 *
 * 파서는 성능과 안정성을 위해 여러 곳에서 엔티티를 건너뛴다. 그게 전부
 * 무음이면 "도면 일부가 안 들어왔다" 를 아무도 모른다 — 실제로 레이어 목록이
 * 앞부분만 보고 만들어지는 바람에 건축 도면이 통째로 빠졌는데, 로그 어디에도
 * 그 사실이 없어서 한참을 엉뚱한 데서 찾았다.
 */
export type SkipReport = Record<string, number>

export type WorkerOut =
  | { type: 'progress'; phase: string; percent: number }
  | { type: 'result'; polylines: PolylineData[]; insUnits: number; texts: TextData[]; hatches: HatchData[]; linetypes: LinetypeDef[]; ltscale: number; layers: Record<string, LayerInfo>; skipped: SkipReport }
  | { type: 'error'; message: string }

// ===== Internal types =====

interface Vertex { x: number; y: number; bulge: number }

interface PrecomputedPoly {
  vertices: number[][]     // pre-computed polyline points (entity EZ applied)
  rawLayer: string | null  // null = gc8 absent, inherit from INSERT's layer
  colorNumber: number
  isHatchBoundary?: boolean  // true = old-style POLYLINE in block with SOLID hatch (skip rendering)
}

interface BlockDef {
  name: string
  baseX: number
  baseY: number
  entityChunks: string[]          // raw text chunks for complex entities (INSERT, TEXT, ATTRIB...)
  precomputed: PrecomputedPoly[]  // pre-parsed geometry (LINE, ARC, CIRCLE, ELLIPSE, LWPOLYLINE, SPLINE, SOLID, 3DFACE, POLYLINE)
  hasSolidHatch?: boolean         // block contains HATCH with SOLID pattern
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
const MAX_TEXTS = 20_000       // 텍스트 수 제한 (건축도면 표 포함)
const MAX_HATCHES = 10_000     // 해치 수 제한 (블록 내부 해치 포함)
/** 엔티티 하나의 최대 길이(문자). 넘으면 도형이 아니라고 보고 건너뛴다.
 *  OLE2FRAME 같은 임베디드 바이너리가 20MB 로 들어와 워커를 터뜨린 적이 있다. */
const MAX_ENTITY_CHARS = 1_000_000

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

/** 엔티티 범위 [start, end) 안에서 group code 줄만 골라 needle(`\n<code>\n`) 과
 *  맞춰본다. 반환값은 코드 줄 앞의 개행 위치 — 호출부는 그대로
 *  `valAt(text, i + needle.length, end)` 로 값을 읽는다.
 *
 *  단순 indexOf 로는 두 가지가 깨진다.
 *   1. indexOf 는 end 를 받지 못해, 엔티티에 없는 코드를 찾을 때 파일 끝까지
 *      훑고 나서야 범위를 벗어난 걸 안다. 엔티티 수에 비례해 O(n²) 가 된다.
 *      엔티티 대부분에 없는 6(linetype)/370(lineweight)/7(style)/230(extrusion)
 *      을 찾기 시작하면서 2만 엔티티 도면 파싱이 2배 느려졌다.
 *   2. 값 줄도 매칭 대상이 되어 오탐한다. padding 없는 DXF 에서 `62\n7\n` 의
 *      값 `7` 이 GC7 로 걸리는 식이다. 62 는 DXF 엔티티 순서상 7 보다 먼저
 *      오고 ACI 7 은 기본 색이라, 거의 모든 도면에서 스타일 이름 대신
 *      다음 group code 를 읽게 된다.
 *
 *  start 는 group code 0 의 값(엔티티 타입) 을 가리키므로 거기서부터
 *  코드/값 줄이 번갈아 나온다. 코드 줄 자리에서만 비교하면 둘 다 막힌다. */
function idxIn(text: string, needle: string, start: number, end: number): number {
  // 타입(값) 줄의 끝 = 첫 코드 줄 앞의 개행
  return gcIdxFrom(text, needle, text.indexOf('\n', start), end)
}

/** idxIn 의 일반형. `codeNl` 은 첫 코드 줄 **앞** 개행의 위치.
 *  테이블 엔트리 청크는 `\n0\nLAYER\n...` 로 시작하므로 codeNl = 0 이다. */
function gcIdxFrom(text: string, needle: string, codeNl: number, end: number): number {
  let nl = codeNl
  while (nl >= 0 && nl < end) {
    // 빈 줄은 짝을 못 이뤄 parity 를 영구적으로 끊는다 → 건너뛰어 재동기화.
    // (값이 빈 문자열인 줄은 아래 값 줄 점프가 알아서 맞춘다. 코드 줄은 비어 있을 수 없다)
    if (text.charCodeAt(nl + 1) === 10) { nl += 1; continue }
    if (text.startsWith(needle, nl)) return nl
    const codeEnd = text.indexOf('\n', nl + 1)   // 코드 줄 끝
    if (codeEnd < 0 || codeEnd >= end) return -1
    nl = text.indexOf('\n', codeEnd + 1)         // 값 줄 끝 = 다음 코드 줄 앞
  }
  return -1
}

/** 테이블 엔트리 청크에서 group code 의 값 한 줄을 읽는다. 없으면 ''. */
function gcValIn(chunk: string, needle: string): string {
  const i = gcIdxFrom(chunk, needle, 0, chunk.length)
  return i >= 0 ? chunk.substring(i + needle.length).split('\n', 1)[0].trim() : ''
}

/** group code 0 줄 자리에서만 끊어 엔티티 청크로 나눈다.
 *  `text.split(sep)` 는 패딩 없는 DXF 에서 값이 `0` 인 줄(z=0, flags=0 …) 에서도
 *  끊겨서 엔티티가 두 토막 난다. `text[0]` 은 sep 의 첫 개행이어야 한다. */
function splitAtGc0(text: string, sep: string): string[] {
  const out: string[] = []
  let start = 0        // 청크 시작(= 타입 값 줄 시작)
  let nl = 0           // 다음 코드 줄 앞 개행
  while (nl >= 0) {
    const i = gcIdxFrom(text, sep, nl, text.length)
    if (i < 0) break
    out.push(text.substring(start, i))
    start = i + sep.length
    nl = text.indexOf('\n', start)   // 타입 값 줄 끝
  }
  out.push(text.substring(start))
  return out
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

/** needle 을 "줄 시작" 에서만 찾는다. 파일 맨 앞(인덱스 0)도 줄 시작이다.
 *
 *  전엔 호출부에서 바늘 앞에 줄바꿈을 붙여 indexOf 했다. 그래서 byte 0 에 있는
 *  건 영원히 못 찾았다 — 표준 DXF 는 HEADER 가 바로 맨 앞에 오므로 $INSUNITS 를
 *  한 번도 못 읽고 늘 mm 로 가정했다. inch 도면이 조용히 틀린 축척으로 들어왔다. */
function indexOfLineStart(text: string, needle: string, from = 0): number {
  if (from <= 0 && text.startsWith(needle)) return 0
  const i = text.indexOf(`\n${needle}`, Math.max(0, from - 1))
  return i < 0 ? -1 : i + 1
}

/** Extract a named section's inner text (padding-aware) */
export function extractSection(dxf: string, name: string, gc: (c: number) => string): string | null {
  const hdr = `${gc(0)}\nSECTION\n${gc(2)}\n${name}\n`
  const idx = indexOfLineStart(dxf, hdr)
  if (idx < 0) return null
  const start = idx + hdr.length
  const end = indexOfLineStart(dxf, `${gc(0)}\nENDSEC`, start)
  return end >= start ? dxf.substring(start, end) : null
}

/** Parse $INSUNITS from HEADER section */
function parseInsUnits(dxf: string, gc: (c: number) => string): number {
  const hdr = extractSection(dxf, 'HEADER', gc)
  if (!hdr) return 4  // default mm
  const m = hdr.match(/\$INSUNITS\n\s*70\n\s*(\d+)/)
  return m ? parseInt(m[1]) : 4
}

/** Parse $LTSCALE from HEADER section (global linetype scale) */
function parseLtscale(dxf: string, gc: (c: number) => string): number {
  const hdr = extractSection(dxf, 'HEADER', gc)
  if (!hdr) return 1
  const m = hdr.match(/\$LTSCALE\n\s*40\n\s*([\d.eE+-]+)/)
  return m ? parseFloat(m[1]) || 1 : 1
}

/** Parse LTYPE table → Map<name, LinetypeDef> */
function parseLinetypes(dxf: string, gc: (c: number) => string): Map<string, LinetypeDef> {
  const result = new Map<string, LinetypeDef>()
  const tables = extractSection(dxf, 'TABLES', gc)
  if (!tables) return result

  const sep = `\n${gc(0)}\n`
  const gc2 = `\n${gc(2)}\n`
  const gc40 = `\n${gc(40)}\n`
  const gc49 = `\n${gc(49)}\n`
  const gc73 = `\n${gc(73)}\n`

  // find LTYPE entries
  const ltypeMarker = `${sep.slice(0, -1)}\nLTYPE\n`
  let pos = 0
  while (true) {
    pos = tables.indexOf(ltypeMarker, pos)
    if (pos < 0) break
    const lStart = pos + ltypeMarker.length
    // 패딩 없는 DXF 는 `70\n0` 같은 값 줄이 sep(`\n0\n`) 과 같은 모양이라
    // 단순 indexOf 로는 엔트리가 이름 바로 뒤에서 잘린다 → 코드 줄 자리에서만 끊는다.
    const nextEntity = gcIdxFrom(tables, sep, lStart - 1, tables.length)
    const lEnd = nextEntity >= 0 ? nextEntity : tables.length

    const chunk = tables.substring(pos, lEnd)

    // name (gc 2)
    const name = gcValIn(chunk, gc2)
    if (!name) { pos = lStart; continue }

    // number of elements (gc 73)
    const numElements = parseInt(gcValIn(chunk, gc73)) || 0

    // total pattern length (gc 40)
    const totalLen = parseFloat(gcValIn(chunk, gc40)) || 0

    if (numElements > 0 && totalLen > 0) {
      // extract all gc 49 values (pattern elements)
      const pattern: number[] = []
      let searchPos = 0
      while (pattern.length < numElements) {
        const p49i = gcIdxFrom(chunk, gc49, searchPos, chunk.length)
        if (p49i < 0) break
        const val = parseFloat(chunk.substring(p49i + gc49.length).split('\n', 1)[0])
        if (isFinite(val)) pattern.push(val)
        // 다음 코드 줄 앞 개행으로 이동 (값 줄 중간에서 재개하면 parity 가 깨진다)
        searchPos = chunk.indexOf('\n', p49i + gc49.length)
        if (searchPos < 0) break
      }

      if (pattern.length > 0) {
        result.set(name.toUpperCase(), { name, pattern, totalLen })
      }
    }

    pos = lEnd
  }

  return result
}

/** LAYER 테이블 정보: linetype + lineweight + color + transparency */
interface LayerDef {
  linetype?: string        // linetype name (gc 6), CONTINUOUS 이면 생략
  lineweight?: number      // gc 370 (0.01mm 단위). -1/undefined = ByDefault
  colorIndex?: number      // gc 62 (ACI 0-255). 0 이면 생략
  trueColor?: number       // gc 420 (24-bit true color)
  transparency?: number    // 0-100 (percent transparent). gc 440
}

/** Parse LAYER table → Map<layerName, LayerDef> */
function parseLayerDefs(dxf: string, gc: (c: number) => string): Map<string, LayerDef> {
  const result = new Map<string, LayerDef>()
  const tables = extractSection(dxf, 'TABLES', gc)
  if (!tables) return result

  const sep = `\n${gc(0)}\n`
  const gc2 = `\n${gc(2)}\n`
  const gc6 = `\n${gc(6)}\n`
  const gc62 = `\n${gc(62)}\n`
  const gc370 = `\n${gc(370)}\n`
  const gc420 = `\n${gc(420)}\n`
  const gc440 = `\n${gc(440)}\n`

  const layerMarker = `${sep.slice(0, -1)}\nLAYER\n`
  let pos = 0
  while (true) {
    pos = tables.indexOf(layerMarker, pos)
    if (pos < 0) break
    const lStart = pos + layerMarker.length
    const nextEntity = gcIdxFrom(tables, sep, lStart - 1, tables.length)
    const lEnd = nextEntity >= 0 ? nextEntity : tables.length

    const chunk = tables.substring(pos, lEnd)

    const name = gcValIn(chunk, gc2)
    if (!name) { pos = lStart; continue }

    const def: LayerDef = {}

    // linetype (gc 6) -- LAYER 는 62(색) 가 6(linetype) 보다 먼저 온다.
    // 마젠타(62=6) 레이어에서 `\n62\n6\n` 이 먼저 걸린다 → gcValIn 사용.
    const ltName = gcValIn(chunk, gc6)
    if (ltName && ltName.toUpperCase() !== 'CONTINUOUS') {
      def.linetype = ltName.toUpperCase()
    }

    // lineweight (gc 370) -- 0.01mm 단위. -1 = ByDefault, -3 = ByBlock
    const lwVal = gcValIn(chunk, gc370)
    if (lwVal !== undefined) {
      const lw = parseInt(lwVal)
      if (lw > 0) def.lineweight = lw
    }

    // color index (gc 62)
    const ciVal = gcValIn(chunk, gc62)
    if (ciVal !== undefined) {
      const ci = parseInt(ciVal)
      // 음수 = 레이어 OFF (abs 값이 실제 색)
      if (ci !== 0) def.colorIndex = Math.abs(ci)
    }

    // true color (gc 420) -- 24-bit RGB
    const tcVal = gcValIn(chunk, gc420)
    if (tcVal !== undefined) {
      const tc = parseInt(tcVal)
      if (tc > 0) def.trueColor = tc
    }

    // transparency (gc 440) -- 0x020000TT, TT: 0=opaque, 255=fully transparent
    const trVal = gcValIn(chunk, gc440)
    if (trVal !== undefined) {
      const raw = parseInt(trVal)
      const tt = raw & 0xFF
      if (tt > 0) def.transparency = Math.round(tt / 255 * 100)
    }

    result.set(name, def)
    pos = lEnd
  }
  return result
}

/** 레거시 호환: linetype Map 추출 */
function layerDefsToLinetypeMap(defs: Map<string, LayerDef>): Map<string, string> {
  const m = new Map<string, string>()
  for (const [name, d] of defs) {
    if (d.linetype) m.set(name, d.linetype)
  }
  return m
}

/** Parse STYLE table → Map<styleName, fontFamilyName> */
function parseTextStyles(dxf: string, gc: (c: number) => string): Map<string, string> {
  const result = new Map<string, string>()
  const tables = extractSection(dxf, 'TABLES', gc)
  if (!tables) return result

  const sep = `\n${gc(0)}\n`
  const gc2 = `\n${gc(2)}\n`
  const gc3 = `\n${gc(3)}\n`  // primary font file name
  const gc4 = `\n${gc(4)}\n`  // bigfont file name (Korean/CJK SHX)

  const styleMarker = `${sep.slice(0, -1)}\nSTYLE\n`
  let pos = 0
  while (true) {
    pos = tables.indexOf(styleMarker, pos)
    if (pos < 0) break
    const lStart = pos + styleMarker.length
    const nextEntity = gcIdxFrom(tables, sep, lStart - 1, tables.length)
    const lEnd = nextEntity >= 0 ? nextEntity : tables.length

    const chunk = tables.substring(pos, lEnd)

    // style name (gc 2)
    const name = gcValIn(chunk, gc2)
    if (!name) { pos = lStart; continue }

    // primary font file (gc 3) / bigfont file (gc 4): "whgtxt.shx", "kssm.shx" 등
    // 70=4(vertical)·71=4(upside down) 가 실존해서 문자열 매칭이면 오탐한다.
    const fontFile = gcValIn(chunk, gc3)
    const bigfontFile = gcValIn(chunk, gc4)

    // Try primary font first, then bigfont for Korean detection
    let fontFamily: string | undefined
    if (fontFile) fontFamily = fontFileToFamily(fontFile)
    if (!fontFamily && bigfontFile) fontFamily = fontFileToFamily(bigfontFile)

    if (fontFamily) {
      result.set(name.toUpperCase(), fontFamily)
    }

    pos = lEnd
  }
  return result
}

/** Common DXF font file names → CSS font-family.
 *  Unknown TTF/OTF → cleaned basename 반환 (브라우저가 시스템에서 시도).
 *  Unknown SHX → undefined (기본 fallback 폰트 사용). */
function fontFileToFamily(fontFile: string): string | undefined {
  // Strip path prefix (e.g. "C:\Windows\Fonts\gulim.ttc" → "gulim")
  const basename = fontFile.replace(/^.*[/\\]/, '')
  const lower = basename.toLowerCase().replace(/\.(ttf|ttc|otf|shx)$/i, '')
  if (!lower) return undefined

  // ── Korean system fonts ──
  if (lower === 'gulim' || lower === 'gulimche') return 'Gulim'
  if (lower === 'dotum' || lower === 'dotumche') return 'Dotum'
  if (lower === 'batang' || lower === 'batangche') return 'Batang'
  if (lower === 'gungsuh' || lower === 'gungsuhche') return 'Gungsuh'
  if (lower === 'malgun' || lower === 'malgunbd' || lower === 'malgunsl') return 'Malgun Gothic'

  // ── Korean design fonts (Nanum, HY, Expo, etc.) ──
  if (lower.startsWith('nanum')) return 'Nanum Gothic'
  if (lower.startsWith('expo')) return 'Noto Sans KR'  // Expo 계열은 웹에 없음 → fallback
  // HY중고딕, HYGothic 등 한양 계열 한국어 폰트 → fallback
  // hybrid, hydra, hyper 등 영문 단어와 구분하기 위해 알려진 HY 폰트 접두사 매칭
  if (/^hy(go|po|he|sh|my|gr|sm|rg|gu|ba|do|ro|pi|ta|ls|pm|kp|ye|bw|견|중|신|울|그)/i.test(lower)) return 'Noto Sans KR'

  // ── Korean bigfont SHX (gc 4 bigfont용) ──
  if (lower === 'whgtxt' || lower === 'whgdtxt' || lower === 'whtgtxt' ||
      lower === 'whgano' || lower === 'whgstxt') return 'Noto Sans KR'
  if (lower === 'kssm' || lower === 'kssb' || lower === 'kstl') return 'Noto Sans KR'
  if (lower === 'hstyle' || lower === 'hstyleb') return 'Noto Sans KR'
  if (lower === 'chineset' || lower === 'extfont' || lower === 'bigfont') return 'Noto Sans KR'

  // ── CJK system fonts ──
  if (lower === 'simsun' || lower === 'nsimsun') return 'SimSun'
  if (lower === 'simhei') return 'SimHei'
  if (lower === 'simkai') return 'KaiTi'
  if (lower === 'msgothic' || lower === 'mspgothic') return 'MS Gothic'
  if (lower === 'msmincho' || lower === 'mspmincho') return 'MS Mincho'

  // ── Western system fonts ──
  if (lower === 'arial' || lower === 'arialbd' || lower === 'ariali') return 'Arial'
  if (lower === 'times' || lower === 'timesbd' || lower === 'timesnr') return 'Times New Roman'
  if (lower === 'verdana' || lower === 'tahoma' || lower === 'calibri') return lower.charAt(0).toUpperCase() + lower.slice(1)
  if (lower === 'cour' || lower === 'courbd' || lower === 'courier') return 'Courier New'

  // ── SHX (AutoCAD shape fonts) → use default fallback ──
  if (basename.toLowerCase().endsWith('.shx')) return undefined
  if (lower === 'romans' || lower === 'simplex' || lower === 'txt' || lower === 'monotxt' ||
      lower === 'isocp' || lower === 'isocpeur' || lower === 'isoct' || lower === 'gothic' ||
      lower === 'syastro' || lower === 'symath' || lower === 'symap') return undefined

  // ── Unknown TTF/OTF → pass through as font-family name ──
  // 브라우저가 시스템에 설치된 폰트를 찾아봄. 없으면 CSS fallback chain으로 내려감.
  // 단 폰트 이름처럼 보이지 않으면 버린다. group code 오탐이나 깨진 인코딩으로
  // "40", "?????" 같은 값이 들어오면 그대로 CSS font-family 에 박혀서
  // 한글 폴백 체인까지 무효가 된다 → undefined 로 기본 폴백에 맡기는 게 낫다.
  const passthrough = basename.replace(/\.(ttf|ttc|otf)$/i, '').trim()
  return isFontNameLike(passthrough) ? passthrough : undefined
}

/** CSS font-family 로 내보내도 안전한 이름인지.
 *  따옴표/세미콜론 등 리스트를 깨는 문자를 막고, 글자가 하나도 없는 값
 *  (예: group code 오탐으로 들어온 "40")은 거부한다. */
function isFontNameLike(name: string): boolean {
  if (name.length < 2 || name.length > 64) return false
  if (!/^[\w\s\u3131-\uD79D\u4E00-\u9FFF&.-]+$/.test(name)) return false
  return /[A-Za-z\u3131-\uD79D\u4E00-\u9FFF]/.test(name)
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
  const chunks = splitAtGc0('\n' + sec, sep)
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
                cur.precomputed.push({ vertices: poly, rawLayer: polyState.rawLayer, colorNumber: polyState.colorNumber, isHatchBoundary: false })
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

        // ── Phase 3: SOLID HATCH 감지 → Phase 1 old-style POLYLINE만 hatch boundary 마킹 ──
        // SOLID HATCH가 있을 때만 old-style POLYLINE을 경계 구성용으로 판단하여 렌더링 제외
        // Phase 2 엔티티(LWPOLYLINE/LINE/ARC 등)는 isHatchBoundary 속성이 없으므로 영향 없음
        cur.hasSolidHatch = cur.entityChunks.some(ec => {
          const t = ec.split('\n', 1)[0].trim()
          if (t !== 'HATCH') return false
          const idx = ec.indexOf(`\n${gc(2)}\n`)
          if (idx < 0) return false
          const valEnd = ec.indexOf('\n', idx + gc(2).length + 2)
          const val = ec.substring(idx + gc(2).length + 2, valEnd > 0 ? valEnd : undefined).trim()
          return val.toUpperCase() === 'SOLID'
        })
        if (cur.hasSolidHatch) {
          for (const pe of cur.precomputed) {
            if ('isHatchBoundary' in pe) pe.isHatchBoundary = true
          }
        }

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

// ACI color + trueColor → dxf-shared.ts에서 import
// aciToHex/trueColorToHex → aciToHex/trueColorToHex로 통합

// ===== MULTILEADER entity parser =====

/**
 * MULTILEADER(MLEADER) 의 지시선들을 꺼낸다.
 *
 * MLEADER 는 group code 를 Map 으로 모아서는 못 읽는다. 지시선 꼭짓점도 10/20,
 * 텍스트 기준점도 10/20, 랜딩 포인트도 10/20 이라 Map 에 담는 순간 셋이 한
 * 배열에 섞인다. 예전 구현은 그 배열을 통째로 이어 붙였다 — 화살표가 하나뿐인
 * 단순한 MLEADER 는 우연히 맞았지만, 여러 개면 서로 다른 지시선이 한 줄로
 * 연결되면서 엉뚱한 선이 생기고 일부는 아예 못 그렸다.
 *
 * 그래서 chunk 를 순서대로 걸으며 CONTEXT_DATA{ / LEADER{ / LEADER_LINE{ 의
 * 중괄호 구조를 그대로 따라간다. 경계 판정은 group code 가 아니라 **값**
 * ("LEADER{" 같은 리터럴)으로 한다 — 304 처럼 한 코드가 두 용도로 쓰이는
 * 자리가 있어서 코드만 보면 틀린다.
 *
 * @returns 지시선 하나당 폴리라인 하나
 */
export function parseMultiLeaderLines(chunk: string): number[][][] {
  const lines = chunk.split('\n')
  const pairs: Array<{ code: number; value: string }> = []
  for (let i = 1; i < lines.length - 1; i += 2) {
    const code = parseInt(lines[i].trim())
    if (isNaN(code)) continue
    pairs.push({ code, value: lines[i + 1]?.trim() ?? '' })
  }

  const out: number[][][] = []
  let inLeader = false
  let inLine = false
  let verts: number[][] = []
  // 아래 셋은 LEADER{ 안에서 LEADER_LINE{ **앞에** 나오므로, 선을 닫을 때쯤이면
  // 이미 채워져 있다. 한 LEADER 의 모든 지시선이 같은 랜딩을 공유한다.
  let landing: number[] | null = null
  let dogX = 0, dogY = 0, dogLen = 0

  const flushLine = () => {
    const pts = verts
    verts = []
    if (pts.length === 0) return
    if (landing) {
      const last = pts[pts.length - 1]
      if (Math.abs(last[0] - landing[0]) + Math.abs(last[1] - landing[1]) > 1e-9) {
        pts.push([landing[0], landing[1]])
      }
      // 랜딩에서 글씨 쪽으로 뻗는 가로 꺾임(dogleg). 이게 빠지면 지시선이
      // 글씨에 닿지 않고 허공에서 끝나 보인다.
      if (dogLen > 0 && (dogX !== 0 || dogY !== 0)) {
        const tip = pts[pts.length - 1]
        pts.push([tip[0] + dogX * dogLen, tip[1] + dogY * dogLen])
      }
    }
    if (pts.length >= 2) out.push(pts)
  }

  for (let i = 0; i < pairs.length; i++) {
    const { code, value } = pairs[i]

    if (value === 'LEADER{') {
      inLeader = true; inLine = false
      landing = null; dogX = 0; dogY = 0; dogLen = 0
      continue
    }
    if (value === 'LEADER_LINE{') { inLine = true; verts = []; continue }
    if (value === '}') {
      if (inLine) { flushLine(); inLine = false }
      else if (inLeader) { inLeader = false }
      continue
    }
    if (!inLeader) continue

    // x 는 이 쌍, y 는 바로 다음 쌍(코드 +10)에 들어 있다.
    const nextVal = (want: number): number | null => {
      const nx = pairs[i + 1]
      if (!nx || nx.code !== want) return null
      const v = parseFloat(nx.value)
      return isFinite(v) ? v : null
    }

    if (inLine) {
      if (code === 10) {
        const x = parseFloat(value)
        const y = nextVal(20)
        if (isFinite(x) && y !== null) verts.push([x, y])
      }
    } else if (code === 10) {
      const x = parseFloat(value)
      const y = nextVal(20)
      if (isFinite(x) && y !== null) landing = [x, y]
    } else if (code === 11) {
      const x = parseFloat(value)
      const y = nextVal(21)
      if (isFinite(x) && y !== null) { dogX = x; dogY = y }
    } else if (code === 41) {
      // LEADER{ 안의 41 은 dogleg 길이다 (CONTEXT_DATA 바로 밑의 41 은 글자
      // 높이라서, inLeader 안에서만 읽는 게 중요하다).
      const v = parseFloat(value)
      if (isFinite(v)) dogLen = v
    }
  }

  return out
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
  if (trueColor > 0) color = trueColorToHex(trueColor)
  else if (colorIndex > 0) color = aciToHex(colorIndex)

  // Parse boundary paths → SVG path data
  const svgParts: string[] = []
  let sumX = 0, sumY = 0, ptCount = 0

  for (let bp = 0; bp < numBoundaryPaths && pi < pairs.length; bp++) {
    if (pairs[pi].code !== 92) break
    const pathTypeFlag = parseInt(pairs[pi].value) || 0
    pi++
    const isPolyline = (pathTypeFlag & 2) !== 0

    if (isPolyline) {
      // Polyline boundary (with bulge → arc interpolation)
      const hasBulge = (pi < pairs.length && pairs[pi].code === 72) ? (parseInt(pairs[pi++].value) || 0) : 0
      const isClosed = (pi < pairs.length && pairs[pi].code === 73) ? (parseInt(pairs[pi++].value) || 0) : 1
      const numVerts = (pi < pairs.length && pairs[pi].code === 93) ? (parseInt(pairs[pi++].value) || 0) : 0

      const verts: Array<{ x: number; y: number; bulge: number }> = []
      for (let v = 0; v < numVerts && pi < pairs.length; v++) {
        let vx = 0, vy = 0, bulge = 0
        if (pairs[pi].code === 10) { vx = parseFloat(pairs[pi].value) || 0; pi++ }
        if (pi < pairs.length && pairs[pi].code === 20) { vy = parseFloat(pairs[pi].value) || 0; pi++ }
        if (hasBulge && pi < pairs.length && pairs[pi].code === 42) { bulge = parseFloat(pairs[pi].value) || 0; pi++ }
        verts.push({ x: vx, y: vy, bulge })
        sumX += vx; sumY += vy; ptCount++
      }
      if (verts.length >= 2) {
        const pts = [`M${verts[0].x},${verts[0].y}`]
        const count = isClosed ? verts.length : verts.length - 1
        for (let v = 0; v < count; v++) {
          const p1 = verts[v], p2 = verts[(v + 1) % verts.length]
          if (Math.abs(p1.bulge) > 1e-6) {
            // Bulge → arc: bulge = tan(θ/4), θ = included arc angle
            const dx = p2.x - p1.x, dy = p2.y - p1.y
            const chord = Math.hypot(dx, dy)
            if (chord < 1e-9) { pts.push(`L${p2.x},${p2.y}`); continue }
            const sagitta = Math.abs(p1.bulge) * chord / 2
            const r = (chord * chord / 4 + sagitta * sagitta) / (2 * sagitta)
            // Center of arc
            const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2
            const d = Math.sqrt(Math.max(0, r * r - chord * chord / 4))
            const sign = p1.bulge > 0 ? 1 : -1
            const cx = mx - sign * d * dy / chord
            const cy = my + sign * d * dx / chord
            // Generate arc points
            let sa = Math.atan2(p1.y - cy, p1.x - cx)
            let ea = Math.atan2(p2.y - cy, p2.x - cx)
            if (p1.bulge > 0) { if (ea <= sa) ea += 2 * Math.PI }
            else { if (sa <= ea) sa += 2 * Math.PI }
            const steps = Math.max(4, Math.ceil(Math.abs(ea - sa) * r / 5))
            const dt = (ea - sa) / steps
            for (let s = 1; s <= steps; s++) {
              const t = sa + dt * s
              pts.push(`L${(cx + r * Math.cos(t))},${(cy + r * Math.sin(t))}`)
            }
          } else if (v < verts.length - 1 || isClosed) {
            pts.push(`L${p2.x},${p2.y}`)
          }
        }
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

/** 공통 geometry 변환: group codes → polyline vertices
 *  LINE, ARC, CIRCLE, ELLIPSE, LWPOLYLINE, SPLINE, SOLID, 3DFACE 지원.
 *  INSERT, TEXT 등 지원 안 되는 타입은 null 반환. */
function codesToPolyline(type: string, codes: Map<number, string[]>, ez: number): number[][] | null {
  switch (type) {
    case 'LINE': {
      const x1 = parseFloat(codes.get(10)?.[0] ?? '0')
      const y1 = parseFloat(codes.get(20)?.[0] ?? '0')
      const x2 = parseFloat(codes.get(11)?.[0] ?? '0')
      const y2 = parseFloat(codes.get(21)?.[0] ?? '0')
      if (Math.abs(x1 - x2) < 1e-6 && Math.abs(y1 - y2) < 1e-6) return null
      return [[x1, y1], [x2, y2]]
    }
    case 'ARC': {
      const cx = parseFloat(codes.get(10)?.[0] ?? '0')
      const cy = parseFloat(codes.get(20)?.[0] ?? '0')
      const r = parseFloat(codes.get(40)?.[0] ?? '0')
      if (r <= 0.01) return null
      const sa = parseFloat(codes.get(50)?.[0] ?? '0') * Math.PI / 180
      const ea = parseFloat(codes.get(51)?.[0] ?? '360') * Math.PI / 180
      const poly = interpEllipse(cx, cy, r, r, sa, ea)
      if (ez === -1) for (const p of poly) p[0] = -p[0]
      return poly
    }
    case 'CIRCLE': {
      const cx = parseFloat(codes.get(10)?.[0] ?? '0')
      const cy = parseFloat(codes.get(20)?.[0] ?? '0')
      const r = parseFloat(codes.get(40)?.[0] ?? '0')
      if (r <= 0.01) return null
      const poly = interpEllipse(cx, cy, r, r, 0, Math.PI * 2)
      if (ez === -1) for (const p of poly) p[0] = -p[0]
      return poly
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
      const poly = interpEllipse(cx, cy, rx, ry, sp, ep, rot)
      if (ez === -1) for (const p of poly) p[0] = -p[0]
      return poly
    }
    case 'LWPOLYLINE': {
      const xs = codes.get(10) || []
      const ys = codes.get(20) || []
      const bulges = codes.get(42) || []
      const flag = parseInt(codes.get(70)?.[0] ?? '0')
      const closed = (flag & 1) !== 0
      const n = Math.min(xs.length, ys.length)
      if (n < 2) return null
      const verts: Vertex[] = []
      for (let i = 0; i < n; i++) {
        verts.push({ x: parseFloat(xs[i]), y: parseFloat(ys[i]), bulge: parseFloat(bulges[i] || '0') })
      }
      if (closed) verts.push({ ...verts[0], bulge: 0 })
      const poly: number[][] = []
      for (let i = 0; i < verts.length - 1; i++) {
        const f = verts[i], t = verts[i + 1]
        poly.push([f.x, f.y])
        if (f.bulge) poly.push(...bulgeArc(f.x, f.y, t.x, t.y, f.bulge))
        if (i === verts.length - 2) poly.push([t.x, t.y])
      }
      return poly.length >= 2 ? poly : null
    }
    case 'SPLINE': {
      const degree = parseInt(codes.get(71)?.[0] ?? '3')
      const xs = codes.get(10) || []
      const ys = codes.get(20) || []
      const knotVals = codes.get(40) || []
      const weightVals = codes.get(41) || []
      const n = Math.min(xs.length, ys.length)
      if (n < 2) return null
      const cps = []
      for (let i = 0; i < n; i++) cps.push({ x: parseFloat(xs[i]), y: parseFloat(ys[i]) })
      const knots = knotVals.map(v => parseFloat(v))
      const weights = weightVals.length ? weightVals.map(v => parseFloat(v)) : undefined
      if (knots.length >= n + degree + 1) {
        return interpBSpline(cps, degree, knots, weights)
      }
      return cps.map(p => [p.x, p.y])
    }
    case 'SOLID':
    case 'TRACE':
    case '3DFACE': {
      const x0 = parseFloat(codes.get(10)?.[0] ?? '0'), y0 = parseFloat(codes.get(20)?.[0] ?? '0')
      const x1 = parseFloat(codes.get(11)?.[0] ?? '0'), y1 = parseFloat(codes.get(21)?.[0] ?? '0')
      const x2 = parseFloat(codes.get(12)?.[0] ?? '0'), y2 = parseFloat(codes.get(22)?.[0] ?? '0')
      const x3 = parseFloat(codes.get(13)?.[0] ?? `${x2}`), y3 = parseFloat(codes.get(23)?.[0] ?? `${y2}`)
      if (Math.abs(x0 - x1) + Math.abs(y0 - y1) < 1e-6 && Math.abs(x0 - x2) + Math.abs(y0 - y2) < 1e-6) return null
      if (type === 'SOLID' || type === 'TRACE') return [[x0, y0], [x1, y1], [x3, y3], [x2, y2], [x0, y0]]
      return [[x0, y0], [x1, y1], [x2, y2], [x3, y3], [x0, y0]]
    }
    case 'LEADER': {
      // LEADER: 다중 꼭짓점 폴리라인 (치수/주석 화살표)
      const xs = codes.get(10) || []
      const ys = codes.get(20) || []
      const n = Math.min(xs.length, ys.length)
      if (n < 2) return null
      const poly: number[][] = []
      for (let i = 0; i < n; i++) {
        poly.push([parseFloat(xs[i]), parseFloat(ys[i])])
      }
      return poly
    }
    // MULTILEADER 는 여기서 처리하지 않는다. 꼭짓점/기준점/랜딩이 전부 10/20 이라
    // Map 으로는 구분이 안 된다 — parseMultiLeaderLines() 가 chunk 를 순서대로 읽는다.
    case 'IMAGE': {
      // IMAGE: 바운딩박스 사각형 (래스터 이미지 위치 표시)
      const ix = parseFloat(codes.get(10)?.[0] ?? '0')
      const iy = parseFloat(codes.get(20)?.[0] ?? '0')
      const ux = parseFloat(codes.get(11)?.[0] ?? '0') // U-vector (width direction per pixel)
      const uy = parseFloat(codes.get(21)?.[0] ?? '0')
      const vx = parseFloat(codes.get(12)?.[0] ?? '0') // V-vector (height direction per pixel)
      const vy = parseFloat(codes.get(22)?.[0] ?? '0')
      const pw = parseFloat(codes.get(13)?.[0] ?? '1') // pixel width
      const ph = parseFloat(codes.get(23)?.[0] ?? '1') // pixel height
      const w_x = ux * pw, w_y = uy * pw  // width vector
      const h_x = vx * ph, h_y = vy * ph  // height vector
      return [
        [ix, iy], [ix + w_x, iy + w_y],
        [ix + w_x + h_x, iy + w_y + h_y], [ix + h_x, iy + h_y],
        [ix, iy]
      ]
    }
    default:
      return null
  }
}

/** Pre-compute block entity into polyline. Delegates to codesToPolyline(). */
function precomputeEntity(chunk: string): PrecomputedPoly | null {
  const { type, codes } = parseGroupCodes(chunk)
  const rawLayer = codes.get(8)?.[0]?.trim() ?? null
  const colorNumber = codes.get(62)?.[0] ? parseInt(codes.get(62)![0]) : -1
  const ez = codes.get(230)?.[0] ? parseFloat(codes.get(230)![0]) : 1
  const poly = codesToPolyline(type, codes, ez)
  if (!poly || poly.length < 2) return null
  return { vertices: poly, rawLayer, colorNumber }
}

/** 글로벌 엔티티 평가 카운터 (INSERT 재귀 폭발 방지) */
/** 이번 파싱에서 건너뛴 것들. parseDxfFast() 시작 때 비운다. */
let skipTally: SkipReport = {}
function noteSkip(reason: string, n = 1): void {
  skipTally[reason] = (skipTally[reason] ?? 0) + n
}

let globalEntityEvals = 0
const MAX_ENTITY_EVALS = 500_000

/** Transform HatchData SVG path coordinates: subtract base point, apply transforms */
function transformHatchForInsert(
  hd: HatchData, baseX: number, baseY: number, transforms: Transform[],
): HatchData {
  // Transform SVG path coordinates
  const transformedPath = hd.pathData.replace(
    /([MLZ])([\d.e+-]+),([\d.e+-]+)/g,
    (_, cmd: string, xStr: string, yStr: string) => {
      const pt = [[parseFloat(xStr) - baseX, parseFloat(yStr) - baseY]]
      for (const tr of transforms) applyTransform(pt, tr)
      return `${cmd}${pt[0][0]},${pt[0][1]}`
    },
  )
  // Transform centroid
  const cPt = [[hd.cx - baseX, hd.cy - baseY]]
  for (const tr of transforms) applyTransform(cPt, tr)
  return { ...hd, pathData: transformedPath, cx: cPt[0][0], cy: cPt[0][1] }
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
  hatchesOutput?: HatchData[],
  styleMap?: Map<string, string>,
): void {
  if (++globalEntityEvals > MAX_ENTITY_EVALS) return  // 총 평가 횟수 초과 → bail
  // DXF layer "0" inheritance: 블록 내부 엔티티가 layer "0"이면 INSERT 레이어 상속
  const entityOwnLayer = codes.get(8)?.[0]?.trim() || '0'
  const layer = (entityOwnLayer === '0' && layerOverride) ? layerOverride : entityOwnLayer
  const colorNum = codes.get(62)?.[0] ? parseInt(codes.get(62)![0]) : -1

  // TEXT/MTEXT → texts output (if provided)
  if ((type === 'TEXT' || type === 'MTEXT') && textsOutput) {
    const td = extractTextEntity(type, codes, layer, colorNum, transforms, styleMap)
    if (td) textsOutput.push(td)
    return
  }
  const ez = codes.get(230)?.[0] ? parseFloat(codes.get(230)![0]) : 1

  // 기하 엔티티 → codesToPolyline() 통합 함수 사용
  const poly = codesToPolyline(type, codes, ez)

  // DIMENSION: 치수 블록 확장 (블록 내 좌표가 WCS, base point = 0,0)
  if (type === 'DIMENSION') {
    if (depth >= MAX_DEPTH) { noteSkip('블록 중첩 한도 초과'); return }
    const dimBlockName = codes.get(2)?.[0]?.trim() ?? ''
    const dimBlock = blocks.get(dimBlockName)
    if (!dimBlock) { noteSkip(`치수 블록 정의 없음: ${dimBlockName}`); return }

    // precomputed entities (LINE, ARC 등 — 치수선/연장선)
    for (const pe of dimBlock.precomputed) {
      if (output.length >= MAX_POLYLINES) break
      globalEntityEvals++
      if (globalEntityEvals > MAX_ENTITY_EVALS) break
      if (pe.isHatchBoundary && dimBlock.hasSolidHatch) continue
      const entityLayer = (!pe.rawLayer || pe.rawLayer === '0') ? layer : pe.rawLayer
      if (selectedLayers.size > 0 && !selectedLayers.has(entityLayer)) continue
      const verts: number[][] = pe.vertices.map(v => [v[0], v[1]])
      for (const tr of transforms) applyTransform(verts, tr)
      output.push({ vertices: verts, layer: entityLayer, colorNumber: pe.colorNumber })
    }

    // entity chunks (MTEXT 치수텍스트, INSERT 화살표 등)
    for (const chunk of dimBlock.entityChunks) {
      if (output.length >= MAX_POLYLINES) break
      if (textsOutput && textsOutput.length >= MAX_TEXTS) break
      const { type: eType, codes: eCodes } = parseGroupCodes(chunk)
      const eOwnLayer = eCodes.get(8)?.[0]?.trim() || '0'
      const eLayer = (eOwnLayer === '0' && layer) ? layer : eOwnLayer
      if (selectedLayers.size > 0 && !selectedLayers.has(eLayer)) continue
      entityToPolyline(eType, eCodes, blocks, eLayer, transforms, depth + 1, selectedLayers, output, textsOutput, hatchesOutput, styleMap)
    }
    return
  }

  if (type === 'INSERT') {
      if (depth >= MAX_DEPTH) { noteSkip('블록 중첩 한도 초과'); return }
      const blockName = codes.get(2)?.[0]?.trim() ?? ''
      const block = blocks.get(blockName)
      // 정의가 없는 블록 = 외부 참조(XREF)가 안 딸려왔거나 변환에서 빠진 것.
      // 도면이 통째로 비는 가장 흔한 원인인데 여태 무음이었다.
      if (!block) { noteSkip(`블록 정의 없음(XREF 가능): ${blockName}`); return }
      const totalEnts = block.entityChunks.length + block.precomputed.length
      if (totalEnts > 2000) { noteSkip(`거대 블록 건너뜀(>2000 엔티티): ${blockName}`); return }

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

            // SOLID HATCH 경계용 POLYLINE 건너뛰기 (채움이 이미 렌더링됨)
            if (pe.isHatchBoundary && block.hasSolidHatch) continue

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
              const subHatches: HatchData[] = []
              const subTexts: TextData[] = []
              entityToPolyline(eType, eCodes, blocks, layer, [], depth + 1, selectedLayers, subOutput, textsOutput ? subTexts : undefined, hatchesOutput ? subHatches : undefined, styleMap)
              for (const pl of subOutput) {
                if (selectedLayers.size > 0 && !selectedLayers.has(pl.layer)) continue
                for (const p of pl.vertices) { p[0] -= block.baseX; p[1] -= block.baseY }
                for (const tr of nextTransforms) applyTransform(pl.vertices, tr)
                output.push(pl)
              }
              // Transform nested hatches: subtract base + apply outer transforms
              if (hatchesOutput) {
                for (const sh of subHatches) {
                  if (hatchesOutput.length >= MAX_HATCHES) break
                  hatchesOutput.push(transformHatchForInsert(sh, block.baseX, block.baseY, nextTransforms))
                }
              }
              // Transform nested texts: subtract base + apply outer transforms + scale height/rotation
              if (textsOutput) {
                for (const td of subTexts) {
                  const pt = [[td.x - block.baseX, td.y - block.baseY]]
                  for (const tr of nextTransforms) applyTransform(pt, tr)
                  td.x = pt[0][0]; td.y = pt[0][1]
                  for (const tr of nextTransforms) {
                    const avgScale = (Math.abs(tr.sx) + Math.abs(tr.sy)) / 2
                    td.height *= avgScale
                    if (tr.rot) td.rotation = (td.rotation || 0) + tr.rot
                  }
                  textsOutput.push(td)
                }
              }
            } else if (eType === 'HATCH' && hatchesOutput) {
              // HATCH inside block → parse and transform
              if (selectedLayers.size > 0 && !selectedLayers.has(eLayer)) continue
              if (hatchesOutput.length < MAX_HATCHES) {
                const hd = parseHatchEntity(chunk, eLayer)
                if (hd) {
                  hatchesOutput.push(transformHatchForInsert(hd, block.baseX, block.baseY, nextTransforms))
                }
              }
            } else if ((eType === 'TEXT' || eType === 'MTEXT' || eType === 'ATTRIB') && textsOutput) {
              // ATTRIB: INSERT에 부착된 속성 텍스트 (이름표, 번호 등)
              // ATTRIB invisible flag (code 70, bit 1): AutoCAD에서 숨김 처리된 속성 건너뛰기
              if (eType === 'ATTRIB') {
                const attrFlags = parseInt(eCodes.get(70)?.[0] ?? '0') || 0
                if (attrFlags & 1) continue  // invisible ATTRIB
              }
              if (selectedLayers.size > 0 && !selectedLayers.has(eLayer)) continue
              const blockColor = eCodes.get(62)?.[0] ? parseInt(eCodes.get(62)![0]) : -1
              const td = extractTextEntity(eType === 'ATTRIB' ? 'TEXT' : eType, eCodes, eLayer, blockColor, nextTransforms, styleMap)
              if (td) {
                const rawX = parseFloat(eCodes.get(10)?.[0] ?? '0') - block.baseX
                const rawY = parseFloat(eCodes.get(20)?.[0] ?? '0') - block.baseY
                const pt = [[rawX, rawY]]
                for (const tr of nextTransforms) applyTransform(pt, tr)
                td.x = pt[0][0]; td.y = pt[0][1]
                // INSERT 스케일/회전을 텍스트 height/rotation에 반영
                for (const tr of nextTransforms) {
                  const avgScale = (Math.abs(tr.sx) + Math.abs(tr.sy)) / 2
                  td.height *= avgScale
                  if (tr.rot) td.rotation = (td.rotation || 0) + tr.rot
                }
                textsOutput.push(td)
              }
            } else {
              if (selectedLayers.size > 0 && !selectedLayers.has(eLayer)) continue
              const subOutput: PolylineData[] = []
              const subHatches2: HatchData[] = []
              const subTexts2: TextData[] = []
              entityToPolyline(eType, eCodes, blocks, layer, [], depth + 1, selectedLayers, subOutput, textsOutput ? subTexts2 : undefined, hatchesOutput ? subHatches2 : undefined, styleMap)
              for (const pl of subOutput) {
                for (const p of pl.vertices) { p[0] -= block.baseX; p[1] -= block.baseY }
                for (const tr of nextTransforms) applyTransform(pl.vertices, tr)
                output.push(pl)
              }
              if (hatchesOutput) {
                for (const sh of subHatches2) {
                  if (hatchesOutput.length >= MAX_HATCHES) break
                  hatchesOutput.push(transformHatchForInsert(sh, block.baseX, block.baseY, nextTransforms))
                }
              }
              if (textsOutput) {
                for (const td of subTexts2) {
                  const pt = [[td.x - block.baseX, td.y - block.baseY]]
                  for (const tr of nextTransforms) applyTransform(pt, tr)
                  td.x = pt[0][0]; td.y = pt[0][1]
                  for (const tr of nextTransforms) {
                    const avgScale = (Math.abs(tr.sx) + Math.abs(tr.sy)) / 2
                    td.height *= avgScale
                    if (tr.rot) td.rotation = (td.rotation || 0) + tr.rot
                  }
                  textsOutput.push(td)
                }
              }
            }
          }
        }
      }
      return  // INSERT handled, don't add poly
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

// decodeDxfSpecialChars, cleanMtextFormatting → dxf-shared.ts에서 import

/** Extract TEXT/MTEXT data from parsed group codes */
function extractTextEntity(
  type: string,
  codes: Map<number, string[]>,
  layer: string,
  colorNum: number,
  transforms: Transform[],
  styleMap?: Map<string, string>,
): TextData | null {
  if (type !== 'TEXT' && type !== 'MTEXT') return null

  let x = parseFloat(codes.get(10)?.[0] ?? '0')
  let y = parseFloat(codes.get(20)?.[0] ?? '0')
  const height = parseFloat(codes.get(40)?.[0] ?? '2.5')
  const rotation = parseFloat(codes.get(50)?.[0] ?? '0') || undefined

  let text: string
  let attachPt: number | undefined
  let mtextWidth: number | undefined
  let mtextFont: string | undefined
  if (type === 'TEXT') {
    text = decodeDxfSpecialChars((codes.get(1)?.[0] ?? '').trim())
    // TEXT alignment: group 72 (horizontal) + 73 (vertical)
    const hAlign = parseInt(codes.get(72)?.[0] ?? '0') || 0
    const vAlign = parseInt(codes.get(73)?.[0] ?? '0') || 0
    if (hAlign === 1) attachPt = 8       // Center → BC
    else if (hAlign === 2) attachPt = 9  // Right → BR
    else if (hAlign === 4) attachPt = 5  // Middle → MC
    // TEXT with alignment uses group 11/21 as actual position
    if ((hAlign > 0 || vAlign > 0) && codes.get(11) && codes.get(21)) {
      x = parseFloat(codes.get(11)![0])
      y = parseFloat(codes.get(21)![0])
    }
  } else {
    // MTEXT: group code 3 (앞쪽 250자 단위 청크들) + group code 1 (마지막 청크)
    const parts = [...(codes.get(3) || []), codes.get(1)?.[0] ?? '']
    const raw = decodeDxfSpecialChars(parts.join('').trim())
    // 인라인 폰트 지정 `\f굴림|b0|i0|c129|p50;` 은 cleanMtextFormatting 이
    // 서식 코드로 싸잡아 지우므로 **지우기 전에** 뽑아둬야 한다.
    const fMatch = raw.match(/\\[fF]([^;|]+)/)
    if (fMatch) mtextFont = fMatch[1].trim()
    text = cleanMtextFormatting(raw)
    // MTEXT attachment point (group 71): 1=TL 2=TC 3=TR 4=ML 5=MC 6=MR 7=BL 8=BC 9=BR
    attachPt = parseInt(codes.get(71)?.[0] ?? '0') || undefined
    // MTEXT defined width (group 41)
    const w = parseFloat(codes.get(41)?.[0] ?? '0')
    if (w > 0) mtextWidth = w
  }
  if (!text) return null

  // Apply transforms (from parent INSERTs)
  if (transforms.length) {
    const pt = [[x, y]]
    for (const tr of transforms) applyTransform(pt, tr)
    x = pt[0][0]; y = pt[0][1]
  }

  // Resolve font name from style (gc 7 → STYLE table → font family)
  let fontName: string | undefined
  if (styleMap) {
    const styleName = (codes.get(7)?.[0] ?? '').trim().toUpperCase()
    if (styleName) fontName = styleMap.get(styleName)
  }
  // MTEXT 인라인 폰트는 STYLE 이 못 풀었을 때만 쓴다. AutoCAD 는 인라인을
  // 우선하지만 그건 **구간별** 폰트이고 여기 모델은 엔티티당 하나뿐이라,
  // 일부 구간의 지정이 문장 전체 폰트를 갈아치우는 쪽이 더 나쁘다.
  // fontFileToFamily 를 거쳐 한글 폰트 매핑과 이름 위생 검사를 같이 받는다.
  if (!fontName && mtextFont) fontName = fontFileToFamily(mtextFont)

  return { x, y, text, height, rotation, layer, colorNumber: colorNum, attachPt, width: mtextWidth, fontName }
}

function parseDxfFast(rawText: string, selectedLayers: string[], progress: (phase: string, pct: number) => void): { polylines: PolylineData[]; insUnits: number; texts: TextData[]; hatches: HatchData[]; linetypes: LinetypeDef[]; ltscale: number; layers: Record<string, LayerInfo>; skipped: SkipReport } {
  const t0 = performance.now()
  globalEntityEvals = 0  // 글로벌 카운터 리셋
  skipTally = {}
  const layerSet = new Set(selectedLayers)

  // 0. \r\n → \n 정규화 (Windows DXF 파일 호환)
  progress('줄바꿈 정규화', 2)
  const dxfText = rawText.indexOf('\r') >= 0 ? rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n') : rawText

  // 0-1. 패딩 감지 → 패턴 동적 생성
  const padded = detectPadding(dxfText)
  const gc = makeGcFormatter(padded)
  const SEP_PAT = `\n${gc(0)}\n`   // entity/section boundary pattern
  const GC8_PAT = `\n${gc(8)}\n`   // layer group code
  console.log(`[fast-worker] 텍스트 길이: ${dxfText.length} chars, 패딩: ${padded}, SEP=${JSON.stringify(SEP_PAT)}`)

  // 1. Header → units + ltscale
  progress('헤더 분석', 5)
  const insUnits = parseInsUnits(dxfText, gc)
  const ltscale = parseLtscale(dxfText, gc)

  // 1-1. LTYPE table → linetype 패턴 정의
  const linetypeMap = parseLinetypes(dxfText, gc)
  const layerDefs = parseLayerDefs(dxfText, gc)
  const layerLtMap = layerDefsToLinetypeMap(layerDefs)
  const textStyleMap = parseTextStyles(dxfText, gc)
  console.log(`[fast-worker] ${linetypeMap.size}개 LTYPE, ${layerDefs.size}개 LAYER, ${textStyleMap.size}개 STYLE, $LTSCALE=${ltscale}`)

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
  // ENTITIES 섹션이 없거나 비어있는 경우 → Paper Space 블록만으로 시도
  let entStart = -1, entEnd = -1
  if (entIdx < 0) {
    console.warn('[fast-worker] ENTITIES 섹션 없음 → Paper Space fallback 시도')
  } else {
    entStart = entIdx + entHdr.length
    entEnd = dxfText.indexOf(ENDSEC_PAT, entStart)
    if (entEnd <= entStart) {
      console.warn('[fast-worker] ENTITIES 섹션 비어있음 → Paper Space fallback 시도')
      entStart = -1
      entEnd = -1
    }
  }

  // 4. indexOf-based entity scanning (padding-aware SEP_PAT / GC8_PAT)
  //    Peak memory: O(selected entities) instead of O(all entities)

  // Additional padded group code patterns for entity parsing
  const GC1  = `\n${gc(1)}\n`
  const GC6  = `\n${gc(6)}\n`   // linetype name
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
  // GC71 reserved for ATTRIB generation number
  const GC7  = `\n${gc(7)}\n`   // text style name
  const GC370 = `\n${gc(370)}\n` // lineweight
  const GC440 = `\n${gc(440)}\n` // transparency
  const GC72 = `\n${gc(72)}\n`
  const GC73 = `\n${gc(73)}\n`
  const GC230 = `\n${gc(230)}\n`

  progress('도면 요소 변환', 30)
  const output: PolylineData[] = []
  const texts: TextData[] = []
  const hatches: HatchData[] = []

  // Handle POLYLINE (old-style): accumulate VERTEX entities
  let polylineState: { layer: string; colorNum: number; vertices: Vertex[]; closed: boolean } | null = null

  let errCount = 0

  // Estimate total entities from section size (skip expensive pre-count scan)
  const entSectionLen = entStart >= 0 ? entEnd - entStart : 0
  if (entStart >= 0) {
    const estEntities = Math.max(1, Math.round(entSectionLen / 300))  // ~300 bytes per entity avg
    console.log(`[fast-worker] ENTITIES 섹션: ${(entSectionLen / 1048576).toFixed(1)}MB, 추정 ${estEntities}개 (${(performance.now() - t0).toFixed(0)}ms)`)
  }
  let entityIdx = 0

  // First SEP is at entStart - 1 (the \n from ENTITIES header + gc(0) + \n)
  let sepPos = entStart >= 0 ? entStart - 1 : -1

  while (entStart >= 0) {
    if (output.length >= MAX_POLYLINES && texts.length >= MAX_TEXTS) {
      console.warn(`[fast-worker] 폴리라인 ${MAX_POLYLINES}개 + 텍스트 ${MAX_TEXTS}개 제한 도달, 나머지 건너뜀`)
      break
    }

    // sepPos 는 항상 코드 줄 앞 개행이므로 parity 를 지키며 다음 gc0 을 찾는다.
    // 단순 indexOf 면 패딩 없는 DXF 의 `30\n0`(z=0) 같은 값 줄에서 끊기고,
    // 그 토막이 `30` 타입의 가짜 엔티티로 잡힌다.
    const si = gcIdxFrom(dxfText, SEP_PAT, sepPos, entEnd)
    if (si < 0) break

    const eStart = si + SEP_PAT.length             // entity content start (TYPE\n...)
    const nextSi = idxIn(dxfText, SEP_PAT, eStart, entEnd)
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
        noteSkip(`선택 안 된 레이어: ${entityLayer}`)
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

      // ── Helper: per-entity linetype + lineweight + transparency 추출 (ByLayer → 레이어 기본값 resolve) ──
      const extractLtLwTr = (eS: number, eE: number, layer: string): { lt?: string; lw?: number; tr?: number } => {
        const lt6 = idxIn(dxfText, GC6, eS, eE)
        const lw370 = idxIn(dxfText, GC370, eS, eE)
        const tr440 = idxIn(dxfText, GC440, eS, eE)
        const lt = lt6 >= 0 ? valAt(dxfText, lt6 + GC6.length, eE).toUpperCase() : undefined
        const rawLw = lw370 >= 0 ? parseInt(valAt(dxfText, lw370 + GC370.length, eE)) : undefined

        // lineweight resolve: entity > ByLayer(레이어 기본값) > undefined
        let lw: number | undefined
        if (rawLw !== undefined && rawLw > 0) {
          lw = rawLw
        } else {
          const ld = layerDefs.get(layer)
          if (ld?.lineweight && ld.lineweight > 0) lw = ld.lineweight
        }

        // transparency resolve: entity gc 440 > ByLayer > undefined (opaque)
        // gc 440 format: 0x020000TT, TT: 0=opaque, 255=fully transparent
        let tr: number | undefined
        if (tr440 >= 0) {
          const raw = parseInt(valAt(dxfText, tr440 + GC440.length, eE))
          const tt = raw & 0xFF
          if (tt > 0) tr = Math.round(tt / 255 * 100)
        }
        if (tr === undefined) {
          const ld = layerDefs.get(layer)
          if (ld?.transparency && ld.transparency > 0) tr = ld.transparency
        }

        return {
          lt: lt && lt !== 'BYLAYER' && lt !== 'CONTINUOUS' ? lt : undefined,
          lw,
          tr,
        }
      }
      /** Resolve entity color: entity gc62 → ByLayer(레이어 색상) → -1 */
      const resolveColor = (c62idx: number, _eS: number, eE: number, layer: string): number => {
        if (c62idx >= 0) {
          const ci = parseInt(valAt(dxfText, c62idx + GC62.length, eE))
          // 256 = ByLayer, 0 = ByBlock → 레이어 색 사용
          if (ci > 0 && ci < 256) return ci
        }
        // ByLayer: 레이어 테이블에서 색상 가져오기
        const ld = layerDefs.get(layer)
        if (ld?.trueColor && ld.trueColor > 0) return -1  // trueColor는 별도 처리
        if (ld?.colorIndex && ld.colorIndex > 0) return ld.colorIndex
        return -1
      }
      /** Resolve entity linetype: entity gc6 → ByLayer → layer's linetype → undefined */
      const resolveLinetype = (entityLt: string | undefined, layer: string): string | undefined => {
        if (entityLt) return entityLt
        return layerLtMap.get(layer) || undefined
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
            const { lt, lw, tr } = extractLtLwTr(eStart, eEnd, entityLayer)
            output.push({
              vertices: [[lx1, ly1], [lx2, ly2]],
              layer: entityLayer,
              colorNumber: resolveColor(c62, eStart, eEnd, entityLayer),
              linetypeName: resolveLinetype(lt, entityLayer),
              lineweight: lw,
              transparency: tr,
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
          if (r > 0.01) {
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
            const { lt, lw, tr } = extractLtLwTr(eStart, eEnd, entityLayer)
            output.push({
              vertices: poly, layer: entityLayer,
              colorNumber: resolveColor(c62, eStart, eEnd, entityLayer),
              linetypeName: resolveLinetype(lt, entityLayer),
              lineweight: lw,
              transparency: tr,
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
          if (r > 0.01) {
            const poly = interpEllipse(cx, cy, r, r, 0, Math.PI * 2)
            const ezi = idxIn(dxfText, GC230, eStart, eEnd)
            if (ezi >= 0 && floatAt(dxfText, ezi + GC230.length, eEnd) === -1) {
              for (const p of poly) p[0] = -p[0]
            }
            const c62 = idxIn(dxfText, GC62, eStart, eEnd)
            const { lt, lw, tr } = extractLtLwTr(eStart, eEnd, entityLayer)
            output.push({
              vertices: poly, layer: entityLayer,
              colorNumber: resolveColor(c62, eStart, eEnd, entityLayer),
              linetypeName: resolveLinetype(lt, entityLayer),
              lineweight: lw,
              transparency: tr,
            })
          }
        }
        sepPos = nextSi >= 0 && nextSi < entEnd ? nextSi : entEnd; continue
      }

      // ── Fast-path: TEXT / ATTRIB ──
      if (type === 'TEXT' || type === 'ATTRIB') {
        // ATTRIB invisible flag (code 70, bit 1): AutoCAD에서 숨김 처리된 속성 건너뛰기
        if (type === 'ATTRIB') {
          const f70i = idxIn(dxfText, GC70, eStart, eEnd)
          if (f70i >= 0 && (parseInt(valAt(dxfText, f70i + GC70.length, eEnd)) & 1)) {
            sepPos = nextSi >= 0 && nextSi < entEnd ? nextSi : entEnd; continue
          }
        }
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
              // TEXT alignment: code 72 (horizontal) + 73 (vertical)
              // When aligned, actual position is in 11/21 (not 10/20)
              const h72i = idxIn(dxfText, GC72, eStart, eEnd)
              const v73i = idxIn(dxfText, GC73, eStart, eEnd)
              const hAlign = h72i >= 0 ? parseInt(valAt(dxfText, h72i + GC72.length, eEnd)) || 0 : 0
              const vAlign = v73i >= 0 ? parseInt(valAt(dxfText, v73i + GC73.length, eEnd)) || 0 : 0
              let tx = floatAt(dxfText, xi + GC10.length, eEnd)
              let ty = floatAt(dxfText, yi + GC20.length, eEnd)
              let attachPt: number | undefined
              // Use alignment point (11/21) when any alignment is set
              if (hAlign > 0 || vAlign > 0) {
                const x11i = idxIn(dxfText, GC11, eStart, eEnd)
                const y21i = idxIn(dxfText, GC21, eStart, eEnd)
                if (x11i >= 0 && y21i >= 0) {
                  tx = floatAt(dxfText, x11i + GC11.length, eEnd)
                  ty = floatAt(dxfText, y21i + GC21.length, eEnd)
                }
                if (hAlign === 1) attachPt = 8       // Center → BC
                else if (hAlign === 2) attachPt = 9  // Right → BR
                else if (hAlign === 4) attachPt = 5  // Middle → MC
              }
              // Resolve font from style (gc 7)
              const s7i = idxIn(dxfText, GC7, eStart, eEnd)
              const styleName = s7i >= 0 ? valAt(dxfText, s7i + GC7.length, eEnd).toUpperCase() : ''
              const fontName = styleName ? textStyleMap.get(styleName) : undefined
              texts.push({
                x: tx, y: ty, text,
                height: hi >= 0 ? floatAt(dxfText, hi + GC40.length, eEnd) : 2.5,
                rotation: ri >= 0 ? (floatAt(dxfText, ri + GC50.length, eEnd) || undefined) : undefined,
                layer: entityLayer,
                colorNumber: c62i >= 0 ? parseInt(valAt(dxfText, c62i + GC62.length, eEnd)) : -1,
                attachPt,
                fontName,
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

      // ── Skip non-geometry entities that never produce polylines ──
      // OLE2FRAME/OLEFRAME can be 10-20MB+ of hex binary data; parsing them
      // via parseGroupCodes causes 300K+ array entries and potential OOM in web workers.
      //
      // LEADER/MULTILEADER 는 여기 있으면 안 된다. 지시선은 **기하 도형이고**
      // entityToPolyline 이 이미 처리할 줄 안다 (case 'LEADER' / 'MULTILEADER').
      // OLE2FRAME OOM 을 막는 커밋에서 "비기하 엔티티" 로 같이 묶여 들어가는
      // 바람에, 주석 글씨는 나오는데 그게 어디를 가리키는지 알려주는 선이
      // 통째로 사라졌다. 도면에서 지시선이 없으면 주석이 무의미하다.
      if (type === 'OLE2FRAME' || type === 'OLEFRAME' || type === 'IMAGE' ||
          type === 'WIPEOUT' || type === 'VIEWPORT' || type === 'ATTDEF' ||
          type === 'TOLERANCE' ||
          type === 'ACAD_PROXY_ENTITY' || type === 'BODY' || type === 'REGION' ||
          type === '3DSOLID' || type === 'SURFACE' || type === 'HELIX' ||
          type === 'LIGHT' || type === 'MESH' || type === 'MLINE') {
        // VIEWPORT 는 종이공간 창이라 도형이 아니다 — 리포트에 넣지 않는다.
        if (type !== 'VIEWPORT') noteSkip(`지원 안 하는 타입: ${type}`)
        sepPos = nextSi >= 0 && nextSi < entEnd ? nextSi : entEnd; continue
      }

      // 위 목록은 "이런 타입이 크더라" 는 경험칙이라, 모르는 타입이 거대한
      // 바이너리를 들고 오면 그대로 뚫린다 (OLE2FRAME 때 당한 게 그거다).
      // 타입과 무관하게 덩치로 한 번 더 막는다 — 정상 엔티티는 수 KB 를 넘지
      // 않으므로 1MB 는 "이건 도형이 아니다" 로 봐도 된다.
      if (eEnd - eStart > MAX_ENTITY_CHARS) {
        noteSkip(`너무 큰 엔티티(>1MB): ${type}`)
        sepPos = nextSi >= 0 && nextSi < entEnd ? nextSi : entEnd; continue
      }

      // ── MULTILEADER: 중괄호 구조를 순서대로 읽어야 해서 전용 경로 ──
      // 지시선 하나당 폴리라인 하나가 나오므로 generic path(엔티티당 하나)로는 안 된다.
      if (type === 'MULTILEADER' || type === 'MLEADER') {
        const leaderLines = parseMultiLeaderLines(dxfText.substring(eStart, eEnd))
        if (leaderLines.length > 0) {
          const { lt, lw, tr } = extractLtLwTr(eStart, eEnd, entityLayer)
          const entityLt = resolveLinetype(lt, entityLayer)
          const c62 = idxIn(dxfText, GC62, eStart, eEnd)
          const resolvedColor = resolveColor(c62, eStart, eEnd, entityLayer)
          for (const vertices of leaderLines) {
            if (output.length >= MAX_POLYLINES) break
            output.push({
              vertices,
              layer: entityLayer,
              colorNumber: resolvedColor,
              linetypeName: entityLt || undefined,
              lineweight: lw,
              transparency: tr,
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
        if (texts.length < MAX_TEXTS) {
          const colorNum = codes.get(62)?.[0] ? parseInt(codes.get(62)![0]) : -1
          const td = extractTextEntity(type, codes, entityLayer, colorNum, [], textStyleMap)
          if (td) texts.push(td)
        }
      } else {
        // Extract entity-level linetype + lineweight + transparency for non-fast-path entities
        const { lt, lw, tr } = extractLtLwTr(eStart, eEnd, entityLayer)
        const entityLt = resolveLinetype(lt, entityLayer)
        const c62 = idxIn(dxfText, GC62, eStart, eEnd)
        const resolvedColor = resolveColor(c62, eStart, eEnd, entityLayer)
        const prevLen = output.length
        entityToPolyline(type, codes, blocks, '', [], 0, layerSet, output, texts, hatches, textStyleMap)
        // Tag newly added polylines with linetype/lineweight/color/transparency
        for (let pi = prevLen; pi < output.length; pi++) {
          if (entityLt && !output[pi].linetypeName) output[pi].linetypeName = entityLt
          if (lw !== undefined && output[pi].lineweight === undefined) output[pi].lineweight = lw
          if (resolvedColor >= 0 && output[pi].colorNumber < 0) output[pi].colorNumber = resolvedColor
          if (tr !== undefined && output[pi].transparency === undefined) output[pi].transparency = tr
        }
      }

    } catch (err) {
      errCount++
      if (errCount <= 5) console.warn(`[fast-worker] 엔티티 #${entityIdx} 파싱 에러:`, err)
    }

    sepPos = nextSi >= 0 && nextSi < entEnd ? nextSi : entEnd
  }

  // ── Paper Space fallback ──
  // ENTITIES 섹션(= Model Space)에 도형이 없고, *Paper_Space* 블록에 엔티티가 있으면
  // 해당 블록의 엔티티를 직접 펼쳐서 사용한다.
  // DWG→DXF 변환 시 Paper Space 전용 도면이 이 패턴을 보인다.
  if (output.length === 0 && texts.length === 0 && hatches.length === 0) {
    const psBlockNames = [...blocks.keys()].filter(n =>
      /^\*Paper_Space/i.test(n)
    )
    if (psBlockNames.length > 0) {
      console.log(`[fast-worker] Model Space 비어있음 → Paper Space 블록 ${psBlockNames.join(', ')} 에서 엔티티 추출`)
      progress('Paper Space 엔티티 추출', 85)

      for (const psName of psBlockNames) {
        const psBlock = blocks.get(psName)
        if (!psBlock) continue

        // 1) precomputed (LINE/ARC/CIRCLE/LWPOLYLINE/SPLINE/SOLID/3DFACE)
        for (const pe of psBlock.precomputed) {
          if (output.length >= MAX_POLYLINES) break
          if (pe.isHatchBoundary && psBlock.hasSolidHatch) continue
          const entityLayer = pe.rawLayer || '0'
          if (layerSet.size > 0 && !layerSet.has(entityLayer)) continue
          const verts: number[][] = pe.vertices.map(v => [v[0], v[1]])
          output.push({ vertices: verts, layer: entityLayer, colorNumber: pe.colorNumber })
        }

        // 2) entityChunks (INSERT, TEXT, MTEXT, HATCH, etc.)
        for (const chunk of psBlock.entityChunks) {
          if (output.length >= MAX_POLYLINES) break
          const { type: eType, codes: eCodes } = parseGroupCodes(chunk)
          const eLayer = eCodes.get(8)?.[0]?.trim() || '0'
          if (layerSet.size > 0 && !layerSet.has(eLayer)) continue

          if ((eType === 'TEXT' || eType === 'MTEXT') && texts.length < MAX_TEXTS) {
            const colorNum = eCodes.get(62)?.[0] ? parseInt(eCodes.get(62)![0]) : -1
            const td = extractTextEntity(eType, eCodes, eLayer, colorNum, [], textStyleMap)
            if (td) texts.push(td)
          } else if (eType === 'HATCH' && hatches.length < MAX_HATCHES) {
            const hd = parseHatchEntity(chunk, eLayer)
            if (hd) hatches.push(hd)
          } else {
            entityToPolyline(eType, eCodes, blocks, eLayer, [], 0, layerSet, output, texts, hatches, textStyleMap)
          }
        }
      }
      console.log(`[fast-worker] Paper Space fallback: ${output.length}개 폴리라인, ${texts.length}개 텍스트, ${hatches.length}개 해치`)
    }
  }

  progress('완료', 95)
  const elapsed = (performance.now() - t0).toFixed(0)
  console.log(`[fast-worker] 파싱 완료: ${output.length}개 폴리라인, ${texts.length}개 텍스트, ${hatches.length}개 해치, ${errCount}개 에러 (${elapsed}ms)`)

  if (errCount > 0) noteSkip('파싱 에러로 버린 엔티티', errCount)
  if (output.length >= MAX_POLYLINES) noteSkip(`폴리라인 상한(${MAX_POLYLINES}) 도달 — 이후 도형 버림`)
  if (texts.length >= MAX_TEXTS) noteSkip(`텍스트 상한(${MAX_TEXTS}) 도달 — 이후 글자 버림`)
  if (hatches.length >= MAX_HATCHES) noteSkip(`해치 상한(${MAX_HATCHES}) 도달 — 이후 해치 버림`)
  if (globalEntityEvals > MAX_ENTITY_EVALS) noteSkip(`블록 전개 상한(${MAX_ENTITY_EVALS}) 도달 — 이후 블록 내용 버림`)

  const skipEntries = Object.entries(skipTally).sort((a, b) => b[1] - a[1])
  if (skipEntries.length > 0) {
    const total = skipEntries.reduce((sum, [, n]) => sum + n, 0)
    console.warn(`[fast-worker] 건너뛴 엔티티 ${total}개 (${skipEntries.length}가지 사유):`)
    for (const [reason, n] of skipEntries.slice(0, 20)) console.warn(`    ${n}개 — ${reason}`)
    if (skipEntries.length > 20) console.warn(`    ...외 ${skipEntries.length - 20}가지`)
  } else {
    console.log('[fast-worker] 건너뛴 엔티티 없음')
  }

  // layerDefs → LayerInfo (worker 결과로 전달)
  const layersOut: Record<string, LayerInfo> = {}
  for (const [name, d] of layerDefs) {
    const info: LayerInfo = {}
    if (d.lineweight && d.lineweight > 0) info.lineweight = d.lineweight
    if (d.colorIndex && d.colorIndex > 0) info.colorIndex = d.colorIndex
    if (d.trueColor && d.trueColor > 0) info.trueColor = d.trueColor
    if (d.transparency && d.transparency > 0) info.transparency = d.transparency
    if (Object.keys(info).length > 0) layersOut[name] = info
  }

  return { polylines: output, insUnits, texts, hatches, linetypes: [...linetypeMap.values()], ltscale, layers: layersOut, skipped: skipTally }
}

// ===== Worker message handler =====

self.onmessage = (e: MessageEvent<ParseRequest>) => {
  if (e.data.type !== 'parse') return

  const post = (msg: WorkerOut) => (self as unknown as Worker).postMessage(msg)
  const progress = (phase: string, percent: number) => post({ type: 'progress', phase, percent })

  try {
    const result = parseDxfFast(e.data.dxfText, e.data.selectedLayers, progress)
    post({
      type: 'result',
      polylines: result.polylines,
      insUnits: result.insUnits,
      texts: result.texts,
      hatches: result.hatches,
      linetypes: result.linetypes,
      ltscale: result.ltscale,
      layers: result.layers,
      skipped: result.skipped,
    })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
