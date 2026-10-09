import DxfParser from 'dxf-parser'
// dxf npm package no longer used — replaced by custom dxf-fast-worker
import { convertDwgToDxf, CDN_WASM_BASE } from 'dwgdxf'
import { createShapeId, type Editor } from 'tldraw'
import { getScaleConfig } from './scaleConfig'
import { reloadForStaleChunk } from './lazyWithReload'
import { getDefaultWallThicknessMm } from './settings'
import { ACI_TO_HEX as ACI_TABLE, trueColorToHex as trueColorToHexShared, decodeDxfSpecialChars as decodeSpecialCharsShared, STRUCTURAL_KEYWORDS, defLineSpacing, type ViewportClip, type HatchPatternLine } from './dxf-shared'

const MAX_SEGMENTS = 100_000

type Seg = { x1: number; y1: number; x2: number; y2: number }

// ACI 색상 테이블, trueColorToHex → dxf-shared.ts에서 import (ACI_TABLE, trueColorToHexShared)
const ACI_TO_HEX = ACI_TABLE

// ── textsJson 압축: 폰트/색상 테이블로 중복 제거 ──
// 기존: [{"x":1,"y":2,"t":"A","h":3,"f":"Arial","c":"#FF0000"}, ...]
// 신규: {"F":["Arial"],"C":["#FF0000"],"T":[{"x":1,"y":2,"t":"A","h":3,"fi":0,"ci":0}, ...]}
// 역호환: 파서가 배열이면 구형, 객체+T키면 신형으로 자동 판별
type LocalTextEntry = { x: number; y: number; t: string; h: number; r?: number; c?: string; ap?: number; mw?: number; f?: string }

/** textsJson 직렬화 — 폰트/색상을 테이블로 빼서 중복을 없앤다.
 *  unpackTextsJson 과 왕복이 맞아야 한다 (dxfTextsJson.test.ts 가 지킨다). */
export function packTextsJson(texts: LocalTextEntry[]): string {
  if (texts.length === 0) return ''
  // 폰트/색상 고유값 수집
  const fontSet = new Map<string, number>()
  const colorSet = new Map<string, number>()
  for (const t of texts) {
    if (t.f && !fontSet.has(t.f)) fontSet.set(t.f, fontSet.size)
    if (t.c && !colorSet.has(t.c)) colorSet.set(t.c, colorSet.size)
  }
  // 테이블이 없으면 (폰트/색상 전부 undefined) 구형 포맷이 더 작음
  if (fontSet.size === 0 && colorSet.size === 0) return JSON.stringify(texts)

  const fonts = Array.from(fontSet.keys())
  const colors = Array.from(colorSet.keys())
  const packed = texts.map(t => {
    const entry: Record<string, unknown> = { x: t.x, y: t.y, t: t.t, h: t.h }
    if (t.r !== undefined) entry.r = t.r
    if (t.ap !== undefined) entry.ap = t.ap
    if (t.mw !== undefined) entry.mw = t.mw
    if (t.f) entry.fi = fontSet.get(t.f)
    if (t.c) entry.ci = colorSet.get(t.c)
    return entry
  })
  return JSON.stringify({ F: fonts, C: colors, T: packed })
}

/** textsJson 파싱 — 신형(테이블) / 구형(배열) 자동 판별 */
export function unpackTextsJson(json: string): Array<{ x: number; y: number; t: string; h: number; r?: number; c?: string; ap?: number; mw?: number; f?: string }> {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    // 구형: 배열 그대로
    if (Array.isArray(parsed)) return parsed
    // 신형: 테이블에서 복원
    if (parsed && Array.isArray(parsed.T)) {
      const fonts: string[] = parsed.F || []
      const colors: string[] = parsed.C || []
      return parsed.T.map((t: Record<string, unknown>) => ({
        x: t.x as number,
        y: t.y as number,
        t: t.t as string,
        h: t.h as number,
        r: t.r as number | undefined,
        c: t.ci !== undefined ? colors[t.ci as number] : undefined,
        ap: t.ap as number | undefined,
        mw: t.mw as number | undefined,
        f: t.fi !== undefined ? fonts[t.fi as number] : undefined,
      }))
    }
    return []
  } catch { return [] }
}

function aciToHex(index: number): string | undefined {
  return ACI_TO_HEX[index]
}

function trueColorToHex(c: number): string {
  return trueColorToHexShared(c)
}

// ---------------------------------------------------------------- export ----

const TEXT_SIZE_PX: Record<string, number> = { s: 18, m: 24, l: 36, xl: 56 }

// DXF layer definitions: [name, color-code, linetype]
const LAYERS = [
  ['WALL',      7, 'Continuous'],
  ['WALL_OUTLINE', 2, 'Continuous'],
  ['DOOR',      3, 'Continuous'],
  ['WINDOW',    4, 'Continuous'],
  ['TEXT',      7, 'Continuous'],
  ['DIMENSION', 5, 'Continuous'],
] as const

/**
 * Export the current page to a DXF 2000 (AC1015) file.
 * Walls → closed LWPOLYLINE with actual thickness (4 corners).
 * Doors → opening LINE + swing ARC on DOOR layer.
 * Windows → opening LINE + end tick marks on WINDOW layer.
 * Text → TEXT entities. Dimensions → LINE + TEXT.
 * Canvas px → drawing mm, Y axis flipped for CAD orientation.
 */
export function exportDxf(editor: Editor, filename = 'untitled') {
  const k = getScaleConfig(editor).pxPerMm || 1
  const toMm = (px: number) => px / k
  const xc = (px: number) => toMm(px).toFixed(3)
  const yc = (px: number) => (-toMm(px)).toFixed(3) // Y flip: canvas Y-down → DXF Y-up
  const lines: string[] = []
  const put = (...pairs: [number | string, number | string][]) => {
    for (const [code, val] of pairs) { lines.push(String(code)); lines.push(String(val)) }
  }

  // Handle counter for AC1015 compliance (every table/entity needs a unique handle)
  let handleCounter = 0x100
  const nextHandle = () => (handleCounter++).toString(16).toUpperCase()

  const lineEntity = (layer: string, x1: number, y1: number, x2: number, y2: number) =>
    put(['0', 'LINE'], ['5', nextHandle()], ['100', 'AcDbEntity'], ['8', layer],
      ['100', 'AcDbLine'],
      ['10', xc(x1)], ['20', yc(y1)], ['30', '0.0'],
      ['11', xc(x2)], ['21', yc(y2)], ['31', '0.0'])

  // Closed LWPOLYLINE (AC1015+)
  const lwPolyline = (layer: string, pts: [number, number][]) => {
    put(['0', 'LWPOLYLINE'], ['5', nextHandle()], ['100', 'AcDbEntity'], ['8', layer],
      ['100', 'AcDbPolyline'], ['90', String(pts.length)], ['70', '1'])
    for (const [px, py] of pts) put(['10', xc(px)], ['20', yc(py)])
  }

  // ARC entity
  const arcEntity = (layer: string, cx: number, cy: number, r: number, startDeg: number, endDeg: number) =>
    put(['0', 'ARC'], ['5', nextHandle()], ['100', 'AcDbEntity'], ['8', layer],
      ['100', 'AcDbCircle'],
      ['10', xc(cx)], ['20', yc(cy)], ['30', '0.0'],
      ['40', toMm(r).toFixed(3)],
      ['100', 'AcDbArc'],
      ['50', startDeg.toFixed(2)], ['51', endDeg.toFixed(2)])

  // ---- Compute drawing extents for HEADER ----
  let extMinX = Infinity, extMinY = Infinity, extMaxX = -Infinity, extMaxY = -Infinity
  for (const s of editor.getCurrentPageShapes()) {
    const mx = toMm(s.x), my = -toMm(s.y)
    extMinX = Math.min(extMinX, mx); extMinY = Math.min(extMinY, my)
    extMaxX = Math.max(extMaxX, mx); extMaxY = Math.max(extMaxY, my)
  }
  if (!isFinite(extMinX)) { extMinX = 0; extMinY = 0; extMaxX = 1000; extMaxY = 1000 }

  // ---- HEADER ----
  put(['0', 'SECTION'], ['2', 'HEADER'],
    ['9', '$ACADVER'], ['1', 'AC1015'],
    ['9', '$HANDSEED'], ['5', 'FFFF'],
    ['9', '$INSUNITS'], ['70', '4'],
    ['9', '$EXTMIN'], ['10', extMinX.toFixed(3)], ['20', extMinY.toFixed(3)], ['30', '0.0'],
    ['9', '$EXTMAX'], ['10', extMaxX.toFixed(3)], ['20', extMaxY.toFixed(3)], ['30', '0.0'],
    ['0', 'ENDSEC'])

  // ---- CLASSES (empty but required for AC1015) ----
  put(['0', 'SECTION'], ['2', 'CLASSES'], ['0', 'ENDSEC'])

  // ---- TABLES ----
  put(['0', 'SECTION'], ['2', 'TABLES'])

  // VPORT table
  put(['0', 'TABLE'], ['2', 'VPORT'], ['5', nextHandle()], ['100', 'AcDbSymbolTable'], ['70', '1'])
  put(['0', 'VPORT'], ['5', nextHandle()], ['100', 'AcDbSymbolTableRecord'], ['100', 'AcDbViewportTableRecord'],
    ['2', '*Active'], ['70', '0'],
    ['10', '0.0'], ['20', '0.0'],
    ['11', '1.0'], ['21', '1.0'],
    ['12', ((extMinX + extMaxX) / 2).toFixed(3)], ['22', ((extMinY + extMaxY) / 2).toFixed(3)],
    ['40', (extMaxY - extMinY).toFixed(3)],
    ['41', '1.0'], ['42', '50.0'], ['43', '0.0'])
  put(['0', 'ENDTAB'])

  // LTYPE table
  put(['0', 'TABLE'], ['2', 'LTYPE'], ['5', nextHandle()], ['100', 'AcDbSymbolTable'], ['70', '1'])
  put(['0', 'LTYPE'], ['5', nextHandle()], ['100', 'AcDbSymbolTableRecord'], ['100', 'AcDbLinetypeTableRecord'],
    ['2', 'Continuous'], ['70', '0'], ['3', 'Solid line'], ['72', '65'], ['73', '0'], ['40', '0.0'])
  put(['0', 'ENDTAB'])

  // LAYER table
  put(['0', 'TABLE'], ['2', 'LAYER'], ['5', nextHandle()], ['100', 'AcDbSymbolTable'], ['70', String(LAYERS.length + 1)])
  // Default layer 0
  put(['0', 'LAYER'], ['5', nextHandle()], ['100', 'AcDbSymbolTableRecord'], ['100', 'AcDbLayerTableRecord'],
    ['2', '0'], ['70', '0'], ['62', '7'], ['6', 'Continuous'])
  for (const [name, color, ltype] of LAYERS) {
    put(['0', 'LAYER'], ['5', nextHandle()], ['100', 'AcDbSymbolTableRecord'], ['100', 'AcDbLayerTableRecord'],
      ['2', name], ['70', '0'], ['62', String(color)], ['6', ltype])
  }
  put(['0', 'ENDTAB'])

  // STYLE table
  put(['0', 'TABLE'], ['2', 'STYLE'], ['5', nextHandle()], ['100', 'AcDbSymbolTable'], ['70', '1'])
  put(['0', 'STYLE'], ['5', nextHandle()], ['100', 'AcDbSymbolTableRecord'], ['100', 'AcDbTextStyleTableRecord'],
    ['2', 'Standard'], ['70', '0'], ['40', '0.0'], ['41', '1.0'], ['50', '0.0'],
    ['71', '0'], ['42', '2.5'], ['3', 'txt'], ['4', ''])
  put(['0', 'ENDTAB'])

  // APPID table
  put(['0', 'TABLE'], ['2', 'APPID'], ['5', nextHandle()], ['100', 'AcDbSymbolTable'], ['70', '1'])
  put(['0', 'APPID'], ['5', nextHandle()], ['100', 'AcDbSymbolTableRecord'], ['100', 'AcDbRegAppTableRecord'],
    ['2', 'ACAD'], ['70', '0'])
  put(['0', 'ENDTAB'])

  put(['0', 'ENDSEC'])

  // ---- BLOCKS (required: *MODEL_SPACE and *PAPER_SPACE) ----
  put(['0', 'SECTION'], ['2', 'BLOCKS'])
  // *Model_Space
  put(['0', 'BLOCK'], ['5', nextHandle()], ['100', 'AcDbEntity'], ['8', '0'],
    ['100', 'AcDbBlockBegin'], ['2', '*Model_Space'], ['70', '0'],
    ['10', '0.0'], ['20', '0.0'], ['30', '0.0'], ['3', '*Model_Space'], ['1', ''])
  put(['0', 'ENDBLK'], ['5', nextHandle()], ['100', 'AcDbEntity'], ['8', '0'], ['100', 'AcDbBlockEnd'])
  // *Paper_Space
  put(['0', 'BLOCK'], ['5', nextHandle()], ['100', 'AcDbEntity'], ['8', '0'],
    ['100', 'AcDbBlockBegin'], ['2', '*Paper_Space'], ['70', '0'],
    ['10', '0.0'], ['20', '0.0'], ['30', '0.0'], ['3', '*Paper_Space'], ['1', ''])
  put(['0', 'ENDBLK'], ['5', nextHandle()], ['100', 'AcDbEntity'], ['8', '0'], ['100', 'AcDbBlockEnd'])
  put(['0', 'ENDSEC'])

  // ---- ENTITIES ----
  put(['0', 'SECTION'], ['2', 'ENTITIES'])

  for (const s of editor.getCurrentPageShapes()) {
    if (s.type === 'wall') {
      const p = s.props as { x2: number; y2: number; thickness: number }
      const len = Math.hypot(p.x2, p.y2)
      if (len < 1) continue
      const nx = -p.y2 / len, ny = p.x2 / len
      const h = p.thickness / 2
      lwPolyline('WALL', [
        [s.x + nx * h,          s.y + ny * h],
        [s.x + p.x2 + nx * h,  s.y + p.y2 + ny * h],
        [s.x + p.x2 - nx * h,  s.y + p.y2 - ny * h],
        [s.x - nx * h,          s.y - ny * h],
      ])
    } else if (s.type === 'door') {
      const p = s.props as { width: number; swing?: number; flipped?: boolean }
      const a = (s as { rotation?: number }).rotation ?? 0
      const cos = Math.cos(a), sin = Math.sin(a)
      const hw = p.width / 2

      lineEntity('DOOR', s.x - hw * cos, s.y - hw * sin, s.x + hw * cos, s.y + hw * sin)

      const [hx, hy] = p.flipped
        ? [s.x + hw * cos, s.y + hw * sin]
        : [s.x - hw * cos, s.y - hw * sin]

      const doorAngleDXF = Math.atan2(-sin, cos) * 180 / Math.PI
      const baseDeg = ((p.flipped ? doorAngleDXF + 180 : doorAngleDXF) + 360) % 360
      const swing = p.swing ?? 1
      const sweepDeg = swing * (p.flipped ? -90 : 90)
      const endDeg = (baseDeg + sweepDeg + 360) % 360
      arcEntity('DOOR', hx, hy, p.width, baseDeg, endDeg)
    } else if (s.type === 'window') {
      const p = s.props as { width: number; thickness: number }
      const a = (s as { rotation?: number }).rotation ?? 0
      const cos = Math.cos(a), sin = Math.sin(a)
      const hw = p.width / 2
      const hn = -sin, hny = cos
      const ht = p.thickness / 2

      lineEntity('WINDOW', s.x - hw * cos, s.y - hw * sin, s.x + hw * cos, s.y + hw * sin)
      lineEntity('WINDOW',
        s.x - hw * cos + hn * ht, s.y - hw * sin + hny * ht,
        s.x - hw * cos - hn * ht, s.y - hw * sin - hny * ht)
      lineEntity('WINDOW',
        s.x + hw * cos + hn * ht, s.y + hw * sin + hny * ht,
        s.x + hw * cos - hn * ht, s.y + hw * sin - hny * ht)
    } else if (s.type === 'text') {
      const p = s.props as { text?: string; size?: string }
      const txt = (p.text ?? '').replace(/\n/g, ' ').trim()
      if (!txt) continue
      const h = toMm(TEXT_SIZE_PX[p.size ?? 'm'] ?? 24)
      put(['0', 'TEXT'], ['5', nextHandle()], ['100', 'AcDbEntity'], ['8', 'TEXT'],
        ['100', 'AcDbText'],
        ['10', xc(s.x)], ['20', yc(s.y)], ['30', '0.0'],
        ['40', h.toFixed(3)], ['1', txt],
        ['100', 'AcDbText'])
    } else if (s.type === 'dimension') {
      const p = s.props as { x2: number; y2: number; offset: number }
      const len = Math.hypot(p.x2, p.y2)
      if (len < 1) continue
      const nx = -p.y2 / len, ny = p.x2 / len
      const off = p.offset
      const d1x = s.x + nx * off, d1y = s.y + ny * off
      const d2x = s.x + p.x2 + nx * off, d2y = s.y + p.y2 + ny * off
      lineEntity('DIMENSION', d1x, d1y, d2x, d2y)
      lineEntity('DIMENSION', s.x, s.y, d1x, d1y)
      lineEntity('DIMENSION', s.x + p.x2, s.y + p.y2, d2x, d2y)
      const lenMm = len / k
      const label = lenMm >= 1000 ? `${(lenMm / 1000).toFixed(2)}m`
        : lenMm >= 100 ? `${(lenMm / 10).toFixed(1)}cm`
        : `${Math.round(lenMm)}mm`
      put(['0', 'TEXT'], ['5', nextHandle()], ['100', 'AcDbEntity'], ['8', 'DIMENSION'],
        ['100', 'AcDbText'],
        ['10', xc((d1x + d2x) / 2)], ['20', yc((d1y + d2y) / 2)], ['30', '0.0'],
        ['40', toMm(10).toFixed(3)], ['1', label],
        ['100', 'AcDbText'])
    }
  }

  put(['0', 'ENDSEC'])

  // ---- OBJECTS (minimal root dictionary, required for AC1015) ----
  const dictHandle = nextHandle()
  put(['0', 'SECTION'], ['2', 'OBJECTS'])
  put(['0', 'DICTIONARY'], ['5', dictHandle], ['100', 'AcDbDictionary'], ['281', '1'])
  put(['0', 'ENDSEC'])

  put(['0', 'EOF'])

  // $HANDSEED를 실제 사용된 핸들 다음 값으로 갱신
  const finalHandSeed = handleCounter.toString(16).toUpperCase()
  const seedIdx = lines.indexOf('FFFF')
  if (seedIdx !== -1) lines[seedIdx] = finalHandSeed

  // Use CRLF line endings for AutoCAD compatibility (trailing CRLF 포함)
  const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/plain' })
  const a = document.createElement('a')
  a.download = `${filename}.dxf`
  a.href = URL.createObjectURL(blob)
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

// ---------------------------------------------------------------- import ----

/**
 * Import a DXF file and turn its LINE / POLYLINE geometry into editable wall
 * shapes. DXF coordinates are real-world units (mm by default); we convert via
 * the current drawing scale, flip the Y axis (DXF Y is up, canvas Y is down),
 * then zoom to fit the result.
 */
/** DXF 파일 해시: 파일명 + 크기 + 엔티티 수 조합으로 중복 감지 */
export function dxfFingerprint(fileName: string, fileSize: number, entityCount: number): string {
  return `dxf:${fileName}:${fileSize}:${entityCount}`
}

/** DXF 엔티티 배열에서 선분(segment) 추출 (테스트 가능) */
export type DxfSeg = Seg & { layer?: string; lineweight?: number; color?: string; transparency?: number }

/** DXF TEXT/MTEXT 엔티티 데이터 */
export type DxfText = {
  x: number; y: number
  text: string
  height: number
  rotation?: number
  layer?: string
  color?: string
}

/** DXF HATCH 패턴 채움 데이터 */
export type DxfHatch = {
  pathData: string       // closed SVG path (boundary)
  patternName: string    // "SOLID", "ANSI31", "AR-CONC" 등
  patternScale: number   // 패턴 축척 (기본 1)
  patternSpacing: number // 패턴 정의선 간격 (도면 단위). 0 = 정의선 없음
  patternDefAngle: number// 첫 패턴 정의선 각도 (deg, CCW)
  patternDefLines: number// 패턴 정의선 수 (2 이상 = 격자형)
  patternDefs: HatchPatternLine[] // 해석된 정의선. 비어 있으면 패턴명으로 추정해야 한다
  solidFill: boolean     // gc 70: 1 = 단색 채움
  patternAngle: number   // 패턴 회전 (도, 기본 0)
  color?: string
  layer?: string
  cx: number; cy: number // 중심점 (클러스터 할당용)
}

/** De Boor 알고리즘: B-spline 곡선 위의 점 평가 */
function evalBSpline(
  t: number, degree: number,
  ctrlPts: Array<{ x: number; y: number }>,
  knots: number[],
): { x: number; y: number } {
  const n = ctrlPts.length
  // knot span 찾기
  let k = degree
  while (k < n - 1 && knots[k + 1] !== undefined && knots[k + 1] <= t) k++

  // De Boor 재귀
  const d: Array<{ x: number; y: number }> = []
  for (let j = 0; j <= degree; j++) {
    const idx = Math.max(0, Math.min(k - degree + j, n - 1))
    d.push({ x: ctrlPts[idx].x, y: ctrlPts[idx].y })
  }
  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const ki = k - degree + j
      const left = knots[ki] ?? 0
      const right = knots[ki + degree - r + 1] ?? 1
      const denom = right - left
      const alpha = denom > 1e-10 ? (t - left) / denom : 0
      d[j] = {
        x: (1 - alpha) * d[j - 1].x + alpha * d[j].x,
        y: (1 - alpha) * d[j - 1].y + alpha * d[j].y,
      }
    }
  }
  return d[degree]
}

export function parseDxfSegments(
  entities: Array<Record<string, unknown>>,
  layerDefs: Record<string, { lineweight?: number; colorIndex?: number; color?: number }>,
  maxSegments = MAX_SEGMENTS,
): DxfSeg[] {
  const segs: DxfSeg[] = []
  for (const e of entities) {
    if (segs.length >= maxSegments) break
    const verts = e.vertices as Array<{ x: number; y: number }> | undefined
    const layer = (e.layer as string) || undefined

    let lw = typeof e.lineweight === 'number' ? e.lineweight : -1
    if (lw <= 0 && layer && layerDefs[layer]) {
      const ll = layerDefs[layer]
      if (typeof ll.lineweight === 'number' && ll.lineweight > 0) lw = ll.lineweight
    }
    const lineweight = lw > 0 ? lw : undefined

    let color: string | undefined
    const entTrueColor = typeof e.color === 'number' ? e.color : 0
    const entColorIndex = typeof e.colorIndex === 'number' ? e.colorIndex : 0
    if (entTrueColor > 0) {
      color = trueColorToHex(entTrueColor)
    } else if (entColorIndex > 0) {
      color = aciToHex(entColorIndex)
    } else if (layer && layerDefs[layer]) {
      const lc = layerDefs[layer]
      if (typeof lc.color === 'number' && lc.color > 0) color = trueColorToHex(lc.color)
      else if (typeof lc.colorIndex === 'number' && lc.colorIndex > 0) color = aciToHex(lc.colorIndex)
    }

    if (e.type === 'LINE' && verts && verts.length >= 2) {
      segs.push({ x1: verts[0].x, y1: verts[0].y, x2: verts[1].x, y2: verts[1].y, layer, lineweight, color })
    } else if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && verts && verts.length >= 2) {
      for (let i = 0; i < verts.length - 1; i++) {
        segs.push({ x1: verts[i].x, y1: verts[i].y, x2: verts[i + 1].x, y2: verts[i + 1].y, layer, lineweight, color })
      }
      if (e.shape) {
        const a = verts[verts.length - 1]
        const b = verts[0]
        segs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, layer, lineweight, color })
      }
    } else if (e.type === 'ARC') {
      // ARC: center + radius + startAngle/endAngle (degrees)
      const cx = e.center as { x: number; y: number } | undefined
      const r = e.radius as number | undefined
      const sa = e.startAngle as number | undefined
      const ea = e.endAngle as number | undefined
      if (cx && r && r > 0 && sa != null && ea != null) {
        const ARC_STEP_DEG = 10
        const startRad = (sa * Math.PI) / 180
        let endRad = (ea * Math.PI) / 180
        if (endRad <= startRad) endRad += 2 * Math.PI
        const steps = Math.max(3, Math.ceil(((endRad - startRad) * 180) / (Math.PI * ARC_STEP_DEG)))
        const dt = (endRad - startRad) / steps
        for (let i = 0; i < steps && segs.length < maxSegments; i++) {
          const t0 = startRad + dt * i
          const t1 = startRad + dt * (i + 1)
          segs.push({
            x1: cx.x + r * Math.cos(t0), y1: cx.y + r * Math.sin(t0),
            x2: cx.x + r * Math.cos(t1), y2: cx.y + r * Math.sin(t1),
            layer, lineweight, color,
          })
        }
      }
    } else if (e.type === 'CIRCLE') {
      // CIRCLE: center + radius → 36-gon
      const cx = e.center as { x: number; y: number } | undefined
      const r = e.radius as number | undefined
      if (cx && r && r > 0) {
        const N = 36
        const dt = (2 * Math.PI) / N
        for (let i = 0; i < N && segs.length < maxSegments; i++) {
          const t0 = dt * i
          const t1 = dt * (i + 1)
          segs.push({
            x1: cx.x + r * Math.cos(t0), y1: cx.y + r * Math.sin(t0),
            x2: cx.x + r * Math.cos(t1), y2: cx.y + r * Math.sin(t1),
            layer, lineweight, color,
          })
        }
      }
    } else if (e.type === 'ELLIPSE') {
      // ELLIPSE: center + majorAxisEnd + axisRatio + startAngle/endAngle (radians)
      const cx = e.center as { x: number; y: number } | undefined
      const maj = e.majorAxisEndPoint as { x: number; y: number } | undefined
      const ratio = e.axisRatio as number | undefined
      if (cx && maj && ratio) {
        const sa = (e.startAngle as number) ?? 0
        let ea = (e.endAngle as number) ?? (2 * Math.PI)
        if (ea <= sa) ea += 2 * Math.PI
        const a = Math.hypot(maj.x, maj.y) // semi-major
        const b = a * ratio                 // semi-minor
        const rot = Math.atan2(maj.y, maj.x)
        const cosR = Math.cos(rot), sinR = Math.sin(rot)
        const N = 36
        const dt = (ea - sa) / N
        for (let i = 0; i < N && segs.length < maxSegments; i++) {
          const t0 = sa + dt * i, t1 = sa + dt * (i + 1)
          const lx0 = a * Math.cos(t0), ly0 = b * Math.sin(t0)
          const lx1 = a * Math.cos(t1), ly1 = b * Math.sin(t1)
          segs.push({
            x1: cx.x + lx0 * cosR - ly0 * sinR, y1: cx.y + lx0 * sinR + ly0 * cosR,
            x2: cx.x + lx1 * cosR - ly1 * sinR, y2: cx.y + lx1 * sinR + ly1 * cosR,
            layer, lineweight, color,
          })
        }
      }
    } else if (e.type === 'SPLINE') {
      // SPLINE: fitPoints(곡선 위 점) 또는 controlPoints+knots(B-spline) → 선분 근사
      const fitPts = e.fitPoints as Array<{ x: number; y: number }> | undefined
      const ctrlPts = e.controlPoints as Array<{ x: number; y: number }> | undefined
      const knots = e.knots as number[] | undefined
      const degree = (e.degreeOfSplineCurve as number) ?? 3

      let pts: Array<{ x: number; y: number }> = []

      if (fitPts && fitPts.length >= 2) {
        // fit points는 곡선 위에 있으므로 직접 사용
        pts = fitPts
      } else if (ctrlPts && ctrlPts.length >= 2 && knots && knots.length >= ctrlPts.length + degree + 1) {
        // B-spline: De Boor 알고리즘으로 평가
        const N = Math.max(ctrlPts.length * 4, 20)
        const tMin = knots[degree]
        const tMax = knots[ctrlPts.length]
        if (tMax > tMin) {
          for (let si = 0; si <= N; si++) {
            const t = tMin + (tMax - tMin) * si / N
            pts.push(evalBSpline(t, degree, ctrlPts, knots))
          }
        }
      } else if (ctrlPts && ctrlPts.length >= 2) {
        // knot 없으면 control point 직접 연결
        pts = ctrlPts
      }

      for (let pi = 0; pi < pts.length - 1 && segs.length < maxSegments; pi++) {
        segs.push({ x1: pts[pi].x, y1: pts[pi].y, x2: pts[pi + 1].x, y2: pts[pi + 1].y, layer, lineweight, color })
      }
    } else if (e.type === 'SOLID' || e.type === '3DFACE') {
      // SOLID/3DFACE: 3-4 corner polygon outline
      const pts = (e.points ?? e.corners ?? e.vertices) as Array<{ x: number; y: number }> | undefined
      if (pts && pts.length >= 3) {
        // DXF SOLID vertex order: corners 3&4 are swapped → outline is 0→1→3→2
        const order = pts.length >= 4 ? [0, 1, 3, 2] : [0, 1, 2]
        for (let i = 0; i < order.length && segs.length < maxSegments; i++) {
          const a = pts[order[i]], b = pts[order[(i + 1) % order.length]]
          segs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, layer, lineweight, color })
        }
      }
    } else if (e.type === 'HATCH') {
      // HATCH: boundaryPaths의 edge/polyline → 아웃라인 세그먼트
      const paths = e.boundaryPaths as Array<{
        edges?: Array<{
          type: number
          start?: { x: number; y: number }
          end?: { x: number; y: number }
          center?: { x: number; y: number }
          radius?: number
          startAngle?: number
          endAngle?: number
          isCounterClockwise?: boolean
          majorAxisEndPoint?: { x: number; y: number }
          minorAxisRatio?: number
        }>
        polyline?: { vertices: Array<{ x: number; y: number; bulge?: number }> }
      }> | undefined
      if (paths) {
        for (const bp of paths) {
          if (segs.length >= maxSegments) break
          if (bp.edges) {
            for (const edge of bp.edges) {
              if (segs.length >= maxSegments) break
              if (edge.type === 1 && edge.start && edge.end) {
                // LINE edge
                segs.push({ x1: edge.start.x, y1: edge.start.y, x2: edge.end.x, y2: edge.end.y, layer, lineweight, color })
              } else if (edge.type === 2 && edge.center && edge.radius) {
                // ARC edge
                const cx = edge.center, r = edge.radius
                let sa = (edge.startAngle ?? 0) * Math.PI / 180
                let ea = (edge.endAngle ?? 360) * Math.PI / 180
                if (edge.isCounterClockwise === false) { const tmp = sa; sa = ea; ea = tmp }
                if (ea <= sa) ea += 2 * Math.PI
                const steps = Math.max(3, Math.ceil(((ea - sa) * 180) / (Math.PI * 10)))
                const dt = (ea - sa) / steps
                for (let i = 0; i < steps && segs.length < maxSegments; i++) {
                  const t0 = sa + dt * i, t1 = sa + dt * (i + 1)
                  segs.push({
                    x1: cx.x + r * Math.cos(t0), y1: cx.y + r * Math.sin(t0),
                    x2: cx.x + r * Math.cos(t1), y2: cx.y + r * Math.sin(t1),
                    layer, lineweight, color,
                  })
                }
              } else if (edge.type === 3 && edge.center && edge.majorAxisEndPoint && edge.minorAxisRatio) {
                // ELLIPSE edge
                const cx = edge.center, maj = edge.majorAxisEndPoint, ratio = edge.minorAxisRatio
                const a = Math.hypot(maj.x, maj.y), b = a * ratio
                const rot = Math.atan2(maj.y, maj.x)
                const cosR = Math.cos(rot), sinR = Math.sin(rot)
                const sa = edge.startAngle ?? 0
                let ea = edge.endAngle ?? (2 * Math.PI)
                if (ea <= sa) ea += 2 * Math.PI
                const N = 24, dt = (ea - sa) / N
                for (let i = 0; i < N && segs.length < maxSegments; i++) {
                  const t0 = sa + dt * i, t1 = sa + dt * (i + 1)
                  const lx0 = a * Math.cos(t0), ly0 = b * Math.sin(t0)
                  const lx1 = a * Math.cos(t1), ly1 = b * Math.sin(t1)
                  segs.push({
                    x1: cx.x + lx0 * cosR - ly0 * sinR, y1: cx.y + lx0 * sinR + ly0 * cosR,
                    x2: cx.x + lx1 * cosR - ly1 * sinR, y2: cx.y + lx1 * sinR + ly1 * cosR,
                    layer, lineweight, color,
                  })
                }
              }
            }
          } else if (bp.polyline?.vertices && bp.polyline.vertices.length >= 2) {
            const vts = bp.polyline.vertices
            for (let i = 0; i < vts.length - 1 && segs.length < maxSegments; i++) {
              segs.push({ x1: vts[i].x, y1: vts[i].y, x2: vts[i + 1].x, y2: vts[i + 1].y, layer, lineweight, color })
            }
            // 닫힌 폴리라인이면 마지막→첫 번째 연결
            if (vts.length >= 3) {
              const last = vts[vts.length - 1], first = vts[0]
              if (Math.hypot(last.x - first.x, last.y - first.y) > 0.01) {
                segs.push({ x1: last.x, y1: last.y, x2: first.x, y2: first.y, layer, lineweight, color })
              }
            }
          }
        }
      }
    }
  }
  return segs
}

// ── HATCH 패턴 추출 ──

/** HATCH boundaryPaths 타입 */
type HatchBoundaryPath = {
  edges?: Array<{
    type: number
    start?: { x: number; y: number }
    end?: { x: number; y: number }
    center?: { x: number; y: number }
    radius?: number
    startAngle?: number
    endAngle?: number
    isCounterClockwise?: boolean
    majorAxisEndPoint?: { x: number; y: number }
    minorAxisRatio?: number
  }>
  polyline?: { vertices: Array<{ x: number; y: number; bulge?: number }> }
}

/** boundary edges/polyline → closed SVG path string */
function boundaryToSvgPath(bp: HatchBoundaryPath): string {
  const parts: string[] = []
  if (bp.edges && bp.edges.length > 0) {
    let started = false
    for (const edge of bp.edges) {
      if (edge.type === 1 && edge.start && edge.end) {
        if (!started) { parts.push(`M${edge.start.x},${edge.start.y}`); started = true }
        parts.push(`L${edge.end.x},${edge.end.y}`)
      } else if (edge.type === 2 && edge.center && edge.radius) {
        const cx = edge.center, r = edge.radius
        let sa = (edge.startAngle ?? 0) * Math.PI / 180
        let ea = (edge.endAngle ?? 360) * Math.PI / 180
        if (edge.isCounterClockwise === false) { const tmp = sa; sa = ea; ea = tmp }
        if (ea <= sa) ea += 2 * Math.PI
        const steps = Math.max(3, Math.ceil(((ea - sa) * 180) / (Math.PI * 15)))
        const dt = (ea - sa) / steps
        for (let i = 0; i <= steps; i++) {
          const t = sa + dt * i
          const px = cx.x + r * Math.cos(t), py = cx.y + r * Math.sin(t)
          parts.push(i === 0 && !started ? `M${px},${py}` : `L${px},${py}`)
          if (i === 0) started = true
        }
      } else if (edge.type === 3 && edge.center && edge.majorAxisEndPoint && edge.minorAxisRatio) {
        const cx = edge.center, maj = edge.majorAxisEndPoint, ratio = edge.minorAxisRatio
        const a = Math.hypot(maj.x, maj.y), b = a * ratio
        const rot = Math.atan2(maj.y, maj.x)
        const cosR = Math.cos(rot), sinR = Math.sin(rot)
        const sa = edge.startAngle ?? 0
        let ea = edge.endAngle ?? (2 * Math.PI)
        if (ea <= sa) ea += 2 * Math.PI
        const N = 18, dt = (ea - sa) / N
        for (let i = 0; i <= N; i++) {
          const t = sa + dt * i
          const lx = a * Math.cos(t), ly = b * Math.sin(t)
          const px = cx.x + lx * cosR - ly * sinR, py = cx.y + lx * sinR + ly * cosR
          parts.push(i === 0 && !started ? `M${px},${py}` : `L${px},${py}`)
          if (i === 0) started = true
        }
      }
    }
    if (started) parts.push('Z')
  } else if (bp.polyline?.vertices && bp.polyline.vertices.length >= 2) {
    const vts = bp.polyline.vertices
    parts.push(`M${vts[0].x},${vts[0].y}`)
    for (let i = 1; i < vts.length; i++) {
      parts.push(`L${vts[i].x},${vts[i].y}`)
    }
    parts.push('Z')
  }
  return parts.join('')
}

/** HATCH 엔티티에서 패턴 데이터 추출 (boundary outline은 기존 parseDxfSegments가 처리) */
export function parseDxfHatches(
  entities: Array<Record<string, unknown>>,
  layerDefs: Record<string, { lineweight?: number; colorIndex?: number; color?: number }>,
): DxfHatch[] {
  const hatches: DxfHatch[] = []
  for (const e of entities) {
    if (e.type !== 'HATCH') continue
    const layer = (e.layer as string) || undefined
    const paths = e.boundaryPaths as HatchBoundaryPath[] | undefined
    if (!paths || paths.length === 0) continue

    // 색상 해석
    let color: string | undefined
    const entTrueColor = typeof e.color === 'number' ? e.color : 0
    const entColorIndex = typeof e.colorIndex === 'number' ? e.colorIndex : 0
    if (entTrueColor > 0) {
      color = trueColorToHex(entTrueColor)
    } else if (entColorIndex > 0) {
      color = aciToHex(entColorIndex)
    } else if (layer && layerDefs[layer]) {
      const lc = layerDefs[layer]
      if (typeof lc.color === 'number' && lc.color > 0) color = trueColorToHex(lc.color)
      else if (typeof lc.colorIndex === 'number' && lc.colorIndex > 0) color = aciToHex(lc.colorIndex)
    }

    // 패턴 정보 추출
    const patternName = (e.patternName as string) ?? (e.name as string) ?? 'SOLID'
    const patternScale = (e.patternScale as number) ?? 1
    const patternAngle = (e.patternAngle as number) ?? 0
    const solidFill = (e.solidFill as boolean) ?? ((e.fillType as string) === 'SOLID')
    // dxf-parser 는 패턴 정의선(gc 78/53/45/46)을 노출하지 않는다 → 0 (shape 쪽이 추정값으로 폴백)
    const patternSpacing = 0, patternDefAngle = 0, patternDefLines = 0
    const patternDefs: HatchPatternLine[] = []

    // 각 boundary를 SVG path로 변환
    const svgParts: string[] = []
    let sumX = 0, sumY = 0, ptCount = 0
    for (const bp of paths) {
      const pathStr = boundaryToSvgPath(bp)
      if (pathStr) {
        svgParts.push(pathStr)
        // 중심점 계산용 좌표 수집
        if (bp.edges) {
          for (const edge of bp.edges) {
            if (edge.start) { sumX += edge.start.x; sumY += edge.start.y; ptCount++ }
            if (edge.end) { sumX += edge.end.x; sumY += edge.end.y; ptCount++ }
            if (edge.center) { sumX += edge.center.x; sumY += edge.center.y; ptCount++ }
          }
        } else if (bp.polyline?.vertices) {
          for (const v of bp.polyline.vertices) { sumX += v.x; sumY += v.y; ptCount++ }
        }
      }
    }

    if (svgParts.length > 0 && ptCount > 0) {
      hatches.push({
        pathData: svgParts.join(''),
        patternName: patternName.toUpperCase(),
        patternScale,
        patternAngle,
        patternSpacing,
        patternDefAngle,
        patternDefLines,
        patternDefs,
        solidFill,
        color,
        layer,
        cx: sumX / ptCount,
        cy: sumY / ptCount,
      })
    }
  }
  return hatches
}

// ── INSERT/BLOCK 재귀 확장 ──

/** Block definitions from DXF */
type DxfBlocks = Record<string, {
  position?: { x: number; y: number }
  entities?: Array<Record<string, unknown>>
}>

const SKIP_BLOCK_NAMES = new Set([
  '*Model_Space', '*MODEL_SPACE',
  '*Paper_Space', '*PAPER_SPACE',
  '*Paper_Space0', '*PAPER_SPACE0',
])

/**
 * parseDxfSegments를 감싸서 INSERT 엔티티를 재귀적으로 블록 내용으로 확장.
 * 블록 좌표계 → 부모 좌표계 변환 포함.
 */
function collectSegmentsWithBlocks(
  entities: Array<Record<string, unknown>>,
  layerDefs: Record<string, { lineweight?: number; colorIndex?: number; color?: number }>,
  blocks: DxfBlocks,
  maxSegments = MAX_SEGMENTS,
  depth = 0,
): DxfSeg[] {
  if (depth > 8 || maxSegments <= 0) return []

  const allSegs: DxfSeg[] = []
  const insertEntities: Array<Record<string, unknown>> = []

  // 1회 순회: INSERT/DIMENSION은 따로 모으고, 나머지는 바로 파싱
  const directEntities: Array<Record<string, unknown>> = []
  for (const e of entities) {
    if (e.type === 'INSERT' || e.type === 'DIMENSION') {
      insertEntities.push(e)
    } else {
      directEntities.push(e)
    }
  }
  if (directEntities.length > 0) {
    const directSegs = parseDxfSegments(directEntities, layerDefs, maxSegments)
    allSegs.push(...directSegs)
  }

  // INSERT / DIMENSION 엔티티 → 블록 내용을 재귀 확장
  for (const e of insertEntities) {
    if (allSegs.length >= maxSegments) break

    let blockName: string | undefined
    let pos: { x: number; y: number } | undefined
    let rot = 0, xs = 1, ys = 1
    let insertLayer: string | undefined

    if (e.type === 'INSERT') {
      blockName = e.name as string
      pos = e.position as { x: number; y: number } | undefined
      rot = ((e.rotation as number) ?? 0) * Math.PI / 180
      xs = (e.xScale as number) ?? 1
      ys = (e.yScale as number) ?? 1
      insertLayer = (e.layer as string) || undefined
    } else {
      // DIMENSION은 *D0, *D1 등 익명 블록에 시각 정보가 들어있음
      blockName = (e.block as string) || (e.blockName as string)
      insertLayer = (e.layer as string) || undefined
    }

    if (!blockName || SKIP_BLOCK_NAMES.has(blockName)) continue
    const block = blocks[blockName]
    if (!block?.entities?.length) continue

    const bpos = block.position
    const cos = Math.cos(rot), sin = Math.sin(rot)
    const tx = pos?.x ?? 0, ty = pos?.y ?? 0
    const bx = bpos?.x ?? 0, by = bpos?.y ?? 0

    // 블록 내 세그먼트 재귀 수집 (블록 로컬 좌표)
    const blockSegs = collectSegmentsWithBlocks(
      block.entities as Array<Record<string, unknown>>,
      layerDefs, blocks, maxSegments - allSegs.length, depth + 1,
    )

    // 블록 로컬 → 부모 좌표계 변환
    for (const s of blockSegs) {
      const px1 = (s.x1 - bx) * xs, py1 = (s.y1 - by) * ys
      const px2 = (s.x2 - bx) * xs, py2 = (s.y2 - by) * ys
      s.x1 = px1 * cos - py1 * sin + tx
      s.y1 = px1 * sin + py1 * cos + ty
      s.x2 = px2 * cos - py2 * sin + tx
      s.y2 = px2 * sin + py2 * cos + ty

      if ((!s.layer || s.layer === '0') && insertLayer) s.layer = insertLayer
    }

    allSegs.push(...blockSegs)
  }

  return allSegs.slice(0, maxSegments)
}

// decodeDxfSpecialChars → dxf-shared.ts에서 import (decodeSpecialCharsShared)
const decodeDxfSpecialChars = decodeSpecialCharsShared

/**
 * TEXT/MTEXT 엔티티를 재귀적으로 수집 (INSERT 블록 내부 포함).
 * collectSegmentsWithBlocks와 동일한 변환 로직 적용.
 */
function collectTextsWithBlocks(
  entities: Array<Record<string, unknown>>,
  layerDefs: Record<string, { lineweight?: number; colorIndex?: number; color?: number }>,
  blocks: DxfBlocks,
  depth = 0,
): DxfText[] {
  if (depth > 8) return []
  const allTexts: DxfText[] = []

  for (const e of entities) {
    const layer = (e.layer as string) || undefined
    // 엔티티 색상 해석
    const resolveColor = (): string | undefined => {
      const ci = typeof e.colorIndex === 'number' ? e.colorIndex : 0
      if (ci > 0) return aciToHex(ci)
      if (layer && layerDefs[layer]?.colorIndex) return aciToHex(layerDefs[layer].colorIndex!)
      return undefined
    }

    if (e.type === 'TEXT') {
      const sp = (e.startPoint ?? e.position) as { x: number; y: number } | undefined
      if (!sp) continue
      const txt = decodeDxfSpecialChars((e.text as string)?.trim() ?? '')
      if (!txt) continue
      allTexts.push({
        x: sp.x, y: sp.y, text: txt,
        height: (e.textHeight as number) ?? 2.5,
        rotation: (e.rotation as number) || undefined,
        layer, color: resolveColor(),
      })
    } else if (e.type === 'MTEXT') {
      const pos = e.position as { x: number; y: number } | undefined
      if (!pos) continue
      let txt = (e.text as string)?.trim()
      if (!txt) continue
      // MTEXT 서식 코드 정리: \P=줄바꿈, {\f...;...}=폰트 등
      txt = txt.replace(/\\P/g, ' ').replace(/\{[^}]*\}/g, '').replace(/\\[a-zA-Z][^;]*;/g, '').trim()
      txt = decodeDxfSpecialChars(txt)
      if (!txt) continue
      allTexts.push({
        x: pos.x, y: pos.y, text: txt,
        height: (e.height as number) ?? 2.5,
        rotation: (e.rotation as number) || undefined,
        layer, color: resolveColor(),
      })
    } else if (e.type === 'INSERT' || e.type === 'DIMENSION') {
      // INSERT: 블록 참조, DIMENSION: 치수선 (익명 블록 *D0, *D1 등에 시각 정보)
      const blockName = e.type === 'INSERT'
        ? (e.name as string)
        : ((e.block as string) || (e.blockName as string))
      if (!blockName || SKIP_BLOCK_NAMES.has(blockName)) continue
      const block = blocks[blockName]
      if (!block?.entities?.length) continue

      const pos = e.type === 'INSERT' ? (e.position as { x: number; y: number } | undefined) : undefined
      const bpos = block.position
      const rot = e.type === 'INSERT' ? (((e.rotation as number) ?? 0) * Math.PI / 180) : 0
      const xs = (e.xScale as number) ?? 1
      const ys = (e.yScale as number) ?? 1
      const cos = Math.cos(rot), sin = Math.sin(rot)
      const tx = pos?.x ?? 0, ty = pos?.y ?? 0
      const bx = bpos?.x ?? 0, by = bpos?.y ?? 0
      const insertLayer = (e.layer as string) || undefined

      const blockTexts = collectTextsWithBlocks(
        block.entities as Array<Record<string, unknown>>,
        layerDefs, blocks, depth + 1,
      )

      for (const t of blockTexts) {
        const px = (t.x - bx) * xs, py = (t.y - by) * ys
        t.x = px * cos - py * sin + tx
        t.y = px * sin + py * cos + ty
        t.height *= Math.abs(ys)
        if (rot !== 0) t.rotation = ((t.rotation ?? 0) + (rot * 180) / Math.PI) % 360
        if ((!t.layer || t.layer === '0') && insertLayer) t.layer = insertLayer
      }
      allTexts.push(...blockTexts)

      // INSERT의 ATTRIB (블록 속성 텍스트) 수집
      if (e.type === 'INSERT') {
        const attribs = e.attributes as Array<Record<string, unknown>> | undefined
        if (attribs) {
          for (const attr of attribs) {
            const attrPos = (attr.startPoint ?? attr.position ?? attr.textPosition) as { x: number; y: number } | undefined
            const attrText = decodeDxfSpecialChars(((attr.text ?? attr.textString) as string)?.trim() ?? '')
            if (!attrPos || !attrText) continue
            allTexts.push({
              x: attrPos.x, y: attrPos.y, text: attrText,
              height: (attr.textHeight as number) ?? 2.5,
              rotation: (attr.rotation as number) || undefined,
              layer: (attr.layer as string) || insertLayer,
              color: typeof attr.colorIndex === 'number' && attr.colorIndex > 0
                ? aciToHex(attr.colorIndex)
                : undefined,
            })
          }
        }
      }
    }
  }
  return allTexts
}

// getImportedFingerprints 제거됨 — importDxf 레거시와 함께 제거

/** DWG 바이너리를 DXF 바이트로 변환 (dwgdxf WASM) */
export async function dwgToDxfBytes(buffer: ArrayBuffer): Promise<Uint8Array> {
  const dwgBytes = new Uint8Array(buffer)
  return await convertDwgToDxf(dwgBytes, { wasmBase: CDN_WASM_BASE })
}

/** raw DXF 바이트를 인코딩 감지 후 텍스트로 디코딩 */
export function decodeDxfBytes(dxfBytes: Uint8Array): string {
  // Uint8Array.buffer가 WASM memory 전체일 수 있으므로 복사
  const buf = (dxfBytes.buffer.byteLength === dxfBytes.byteLength
    ? dxfBytes.buffer
    : dxfBytes.slice().buffer) as ArrayBuffer
  const encoding = detectDxfEncoding(buf)
  let text: string
  try {
    text = new TextDecoder(encoding).decode(dxfBytes)
  } catch {
    text = new TextDecoder('utf-8').decode(dxfBytes)
  }
  // 이중 인코딩 복원: DWG→DXF 변환기가 EUC-KR 바이트를 Latin-1로 해석 후
  // UTF-8로 인코딩하는 경우 ($DWGCODEPAGE=ANSI_1252 but 실제 EUC-KR)
  // → ÇöÀå (Latin chars) 가 되어야 할 텍스트가 현장 (Korean) 으로 복원
  return normalizeNewlines(reverseDoubleEncodingIfNeeded(text))
}

/** CRLF → LF 통일.
 *
 *  DXF 파서 전체가 LF 기준 문자열(줄바꿈 + "0" + 줄바꿈 + "SECTION" 등) 로
 *  indexOf 를 한다. 윈도우 오토캐드가 내보낸 CRLF DXF 는 그 바늘이 하나도
 *  안 맞아서 섹션을 통째로 못 찾고, 에러 없이 빈 도면이 들어온다.
 *  디코딩 직후 한 번만 고친다 — DXF 텍스트가 만들어지는 유일한 입구가 여기다.
 *
 *  캐리지리턴이 없으면 복사도 하지 않는다 (대용량 도면에서 괜한 한 패스 방지). */
function normalizeNewlines(text: string): string {
  return text.indexOf('\r') < 0 ? text : text.replace(/\r\n?/g, '\n')
}

/**
 * 이중 인코딩 감지 및 복원.
 * EUC-KR bytes → Latin-1 해석 → UTF-8 인코딩 된 경우를 역전.
 * 한글이 없으면서 Latin Extended(U+0080-U+00FF) 문자가 많으면 시도.
 */
export function reverseDoubleEncodingIfNeeded(text: string): string {
  // 이미 한글이 있으면 정상 디코딩됨 → 스킵
  if (/[\uAC00-\uD7AF]/.test(text)) return text

  // Latin Extended 문자 (U+0080-U+00FF) 확인
  const sample = text.slice(0, 50000)
  const highCharCount = (sample.match(/[\u0080-\u00FF]/g) || []).length
  if (highCharCount < 5) return text // high chars 거의 없음 → 스킵

  // 전체 텍스트를 Latin-1 바이트로 변환 → EUC-KR 디코딩 시도
  try {
    const bytes = new Uint8Array(text.length)
    for (let i = 0; i < text.length; i++) {
      const cp = text.charCodeAt(i)
      if (cp > 0xFF) return text // Latin-1 범위 초과 → 이중 인코딩 아님
      bytes[i] = cp
    }
    const decoded = new TextDecoder('euc-kr').decode(bytes)
    // 복원 결과에 한글이 있으면 성공
    if (/[\uAC00-\uD7AF]/.test(decoded)) return decoded
  } catch { /* ignore */ }

  return text
}

/**
 * raw bytes에서 DXF 인코딩 감지.
 * UTF-8 디코딩 전에 원본 바이트를 직접 검사하므로 mojibake 패턴에 의존하지 않음.
 *
 * 1. $DWGCODEPAGE 헤더에서 CJK 코드페이지 확인 (ASCII 바이트 직접 검색)
 * 2. EUC-KR(CP949) 한글 바이트 패턴 감지 (0xB0-0xC8 + 0xA1-0xFE)
 * 3. Fallback: UTF-8 디코딩 후 U+FFFD replacement char 확인
 */
export function detectDxfEncoding(buffer: ArrayBuffer): 'utf-8' | 'euc-kr' {
  const bytes = new Uint8Array(buffer)
  const scanLen = Math.min(bytes.length, 100000)

  // 1. $DWGCODEPAGE 헤더 찾기 (raw ASCII 바이트 검색)
  // DXF format: "  9\n$DWGCODEPAGE\n  3\nANSI_949"
  const needle = [0x24, 0x44, 0x57, 0x47, 0x43, 0x4F, 0x44, 0x45, 0x50, 0x41, 0x47, 0x45] // "$DWGCODEPAGE"
  outer: for (let i = 0; i + needle.length < scanLen; i++) {
    if (bytes[i] !== 0x24) continue // '$'
    for (let j = 1; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer
    }
    // $DWGCODEPAGE 발견 → 다음 2줄(group code + value) 읽기
    let pos = i + needle.length
    let nlCount = 0
    while (pos < scanLen && nlCount < 2) {
      if (bytes[pos] === 0x0A) nlCount++
      pos++
    }
    // value 읽기 (ASCII)
    let val = ''
    while (pos < scanLen && bytes[pos] !== 0x0A && bytes[pos] !== 0x0D) {
      if (bytes[pos] >= 0x20 && bytes[pos] < 0x7F) val += String.fromCharCode(bytes[pos])
      pos++
    }
    val = val.trim().toUpperCase()
    if (val.includes('949') || val.includes('936') || val.includes('950') || val.includes('932') ||
        val.includes('KSC') || val.includes('JOHAB') || val.includes('WANSUNG')) {
      return 'euc-kr'
    }
    break
  }

  // 2. UTF-8 유효성 확인: valid UTF-8이면 바이트 패턴 체크 스킵
  // (이중 인코딩 = valid UTF-8이므로 reverseDoubleEncodingIfNeeded에서 처리)
  let fffdCount = 0
  try {
    const utf8Text = new TextDecoder('utf-8').decode(bytes.subarray(0, scanLen))
    fffdCount = (utf8Text.match(/\uFFFD/g) || []).length
  } catch { /* ignore */ }
  if (fffdCount === 0) return 'utf-8' // valid UTF-8 → double encoding은 별도 처리

  // 3. UTF-8 invalid bytes 존재 → EUC-KR 바이트 패턴 감지
  if (fffdCount > 3) return 'euc-kr'

  // 완성형 한글: first byte 0xB0-0xC8, second byte 0xA1-0xFE
  let eucKrCount = 0
  for (let i = 0; i < scanLen - 1; i++) {
    const b1 = bytes[i], b2 = bytes[i + 1]
    if (b1 >= 0xB0 && b1 <= 0xC8 && b2 >= 0xA1 && b2 <= 0xFE) {
      eucKrCount++
      i++
    }
  }
  if (eucKrCount >= 2) return 'euc-kr'

  // CP949 확장 범위 (한자/특수문자 포함)
  let cp949Count = 0
  for (let i = 0; i < scanLen - 1; i++) {
    const b1 = bytes[i], b2 = bytes[i + 1]
    if (b1 >= 0x81 && b1 <= 0xFE) {
      if ((b2 >= 0x41 && b2 <= 0x5A) || (b2 >= 0x61 && b2 <= 0x7A) || (b2 >= 0x81 && b2 <= 0xFE)) {
        cp949Count++
        i++
      }
    }
  }
  if (cp949Count > 5) return 'euc-kr'

  return 'utf-8'
}

// ── Raw DXF HATCH 파서 (dxf-parser가 HATCH를 스킵하므로 직접 파싱) ──

/**
 * 경계 edge 데이터가 끝났음을 알리는 group code.
 * 72/92 = 다음 edge·path, 0 = 다음 엔티티, 97 = source object 목록,
 * 75/76/98 = boundary 뒤의 패턴 정의 블록 시작. 여기서 멈추지 않으면
 * edge 파싱 루프가 패턴 축척(41)/각도(52)까지 먹어버린다.
 */
function isHatchEdgeEnd(c: number): boolean {
  return c === 72 || c === 92 || c === 0 || c === 75 || c === 76 || c === 97 || c === 98
}

/**
 * DXF raw text에서 HATCH 엔티티를 직접 파싱.
 * dxf-parser v1.x는 HATCH 핸들러가 없어서 완전히 스킵하기 때문에
 * group code 기반으로 직접 추출.
 */
/** @internal 테스트에서 직접 호출한다 (패턴 정의 데이터 파싱 검증). */
export function parseRawHatches(
  dxfText: string,
  layerDefs: Record<string, { lineweight?: number; colorIndex?: number; color?: number }>,
): DxfHatch[] {
  const hatches: DxfHatch[] = []

  // DXF를 group code/value 쌍으로 분리
  const lines = dxfText.split(/\r?\n/)
  const pairs: Array<{ code: number; value: string }> = []
  for (let i = 0; i < lines.length - 1; i += 2) {
    const code = parseInt(lines[i].trim(), 10)
    const value = lines[i + 1]?.trim() ?? ''
    if (!isNaN(code)) pairs.push({ code, value })
  }

  // ENTITIES 섹션 내 HATCH 엔티티 찾기
  let inEntities = false
  let i = 0
  while (i < pairs.length) {
    const p = pairs[i]

    // ENTITIES 섹션 시작/끝
    if (p.code === 2 && p.value === 'ENTITIES') { inEntities = true; i++; continue }
    if (p.code === 0 && p.value === 'ENDSEC') { if (inEntities) break; i++; continue }

    if (!inEntities || p.code !== 0 || p.value !== 'HATCH') { i++; continue }

    // HATCH 엔티티 시작 - 다음 0코드까지 파싱
    i++
    let layer = '0'
    let colorIndex = 0
    let trueColor = 0
    let patternName = 'SOLID'
    let patternScale = 1
    let patternAngle = 0
    let solidFill = false
    let patternSpacing = 0
    let patternDefAngle = 0
    let patternDefLines = 0
    const patternDefs: HatchPatternLine[] = []
    let numBoundaryPaths = 0

    // HATCH 헤더 파싱 (91코드 = boundary path 수 전까지)
    while (i < pairs.length && pairs[i].code !== 91 && !(pairs[i].code === 0 && pairs[i].value !== 'HATCH')) {
      const c = pairs[i].code, v = pairs[i].value
      if (c === 8) layer = v
      else if (c === 62) colorIndex = parseInt(v) || 0
      else if (c === 420) trueColor = parseInt(v) || 0
      else if (c === 2) patternName = v
      else if (c === 70) solidFill = (parseInt(v) || 0) === 1
      // gc 41/52/78 은 boundary path 뒤에 온다 — 아래에서 따로 읽는다.
      i++
    }

    if (i < pairs.length && pairs[i].code === 91) {
      numBoundaryPaths = parseInt(pairs[i].value) || 0
      i++
    }

    // 색상 해석
    let color: string | undefined
    if (trueColor > 0) {
      color = trueColorToHex(trueColor)
    } else if (colorIndex > 0) {
      color = aciToHex(colorIndex)
    } else if (layerDefs[layer]) {
      const lc = layerDefs[layer]
      if (typeof lc.color === 'number' && lc.color > 0) color = trueColorToHex(lc.color)
      else if (typeof lc.colorIndex === 'number' && lc.colorIndex > 0) color = aciToHex(lc.colorIndex)
    }

    // boundary paths 파싱
    const svgParts: string[] = []
    let sumX = 0, sumY = 0, ptCount = 0

    for (let bp = 0; bp < numBoundaryPaths && i < pairs.length; bp++) {
      // 92: boundary path type flag
      if (pairs[i].code !== 92) break
      const pathTypeFlag = parseInt(pairs[i].value) || 0
      i++
      const isPolyline = (pathTypeFlag & 2) !== 0

      if (isPolyline) {
        // Polyline boundary (with bulge → arc interpolation)
        const hasBulge = (i < pairs.length && pairs[i].code === 72) ? (parseInt(pairs[i++].value) || 0) : 0
        const isClosed = (i < pairs.length && pairs[i].code === 73) ? (parseInt(pairs[i++].value) || 0) : 1
        const numVerts = (i < pairs.length && pairs[i].code === 93) ? (parseInt(pairs[i++].value) || 0) : 0

        const verts: Array<{ x: number; y: number; bulge: number }> = []
        for (let v = 0; v < numVerts && i < pairs.length; v++) {
          let vx = 0, vy = 0, bulge = 0
          if (pairs[i].code === 10) { vx = parseFloat(pairs[i].value) || 0; i++ }
          if (i < pairs.length && pairs[i].code === 20) { vy = parseFloat(pairs[i].value) || 0; i++ }
          if (hasBulge && i < pairs.length && pairs[i].code === 42) { bulge = parseFloat(pairs[i].value) || 0; i++ }
          verts.push({ x: vx, y: vy, bulge })
          sumX += vx; sumY += vy; ptCount++
        }

        if (verts.length >= 2) {
          const parts = [`M${verts[0].x},${verts[0].y}`]
          const count = isClosed ? verts.length : verts.length - 1
          for (let v = 0; v < count; v++) {
            const p1 = verts[v], p2 = verts[(v + 1) % verts.length]
            if (Math.abs(p1.bulge) > 1e-6) {
              const dx = p2.x - p1.x, dy = p2.y - p1.y
              const chord = Math.hypot(dx, dy)
              if (chord < 1e-9) { parts.push(`L${p2.x},${p2.y}`); continue }
              const sagitta = Math.abs(p1.bulge) * chord / 2
              const r = (chord * chord / 4 + sagitta * sagitta) / (2 * sagitta)
              const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2
              const d = Math.sqrt(Math.max(0, r * r - chord * chord / 4))
              const sign = p1.bulge > 0 ? 1 : -1
              const cx = mx - sign * d * dy / chord
              const cy = my + sign * d * dx / chord
              let sa = Math.atan2(p1.y - cy, p1.x - cx)
              let ea = Math.atan2(p2.y - cy, p2.x - cx)
              if (p1.bulge > 0) { if (ea <= sa) ea += 2 * Math.PI }
              else { if (sa <= ea) sa += 2 * Math.PI }
              const steps = Math.max(4, Math.ceil(Math.abs(ea - sa) * r / 5))
              const dt = (ea - sa) / steps
              for (let s = 1; s <= steps; s++) {
                const t = sa + dt * s
                parts.push(`L${(cx + r * Math.cos(t))},${(cy + r * Math.sin(t))}`)
              }
            } else if (v < verts.length - 1 || isClosed) {
              parts.push(`L${p2.x},${p2.y}`)
            }
          }
          if (isClosed) parts.push('Z')
          svgParts.push(parts.join(''))
        }
      } else {
        // Edge boundary
        const numEdges = (i < pairs.length && pairs[i].code === 93) ? (parseInt(pairs[i++].value) || 0) : 0
        const edgeParts: string[] = []
        let started = false

        for (let e = 0; e < numEdges && i < pairs.length; e++) {
          // 72: edge type
          if (pairs[i].code !== 72) break
          const edgeType = parseInt(pairs[i].value) || 0
          i++

          if (edgeType === 1) {
            // Line: 10/20=start, 11/21=end
            let x1 = 0, y1 = 0, x2 = 0, y2 = 0
            while (i < pairs.length && !isHatchEdgeEnd(pairs[i].code)) {
              const c = pairs[i].code, v = parseFloat(pairs[i].value) || 0
              if (c === 10) x1 = v; else if (c === 20) y1 = v
              else if (c === 11) x2 = v; else if (c === 21) y2 = v
              else if (c === 97) break // source boundary count
              i++
            }
            if (!started) { edgeParts.push(`M${x1},${y1}`); started = true }
            edgeParts.push(`L${x2},${y2}`)
            sumX += x1 + x2; sumY += y1 + y2; ptCount += 2
          } else if (edgeType === 2) {
            // Arc: 10/20=center, 40=radius, 50=start angle, 51=end angle, 73=ccw
            let cx = 0, cy = 0, r = 0, sa = 0, ea = 360, ccw = 1
            while (i < pairs.length && !isHatchEdgeEnd(pairs[i].code)) {
              const c = pairs[i].code, v = parseFloat(pairs[i].value) || 0
              if (c === 10) cx = v; else if (c === 20) cy = v
              else if (c === 40) r = v; else if (c === 50) sa = v
              else if (c === 51) ea = v; else if (c === 73) ccw = v
              else if (c === 97) break
              i++
            }
            // Arc → line approximation
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
            // Ellipse: 10/20=center, 11/21=major endpoint, 40=minor/major ratio, 50/51=start/end
            let cx = 0, cy = 0, mx = 0, my = 0, ratio = 1, esa = 0, eea = 2 * Math.PI
            while (i < pairs.length && !isHatchEdgeEnd(pairs[i].code)) {
              const c = pairs[i].code, v = parseFloat(pairs[i].value) || 0
              if (c === 10) cx = v; else if (c === 20) cy = v
              else if (c === 11) mx = v; else if (c === 21) my = v
              else if (c === 40) ratio = v
              else if (c === 50) esa = v; else if (c === 51) eea = v
              else if (c === 97) break
              i++
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
            // Spline edge: degree(94), rational(73), periodic(74), numKnots(95), numCtrl(96)
            let spDegree = 3, numKnots = 0, numCtrl = 0
            while (i < pairs.length && !isHatchEdgeEnd(pairs[i].code)) {
              const c = pairs[i].code
              if (c === 94) spDegree = parseInt(pairs[i].value) || 3
              else if (c === 95) numKnots = parseInt(pairs[i].value) || 0
              else if (c === 96) { numCtrl = parseInt(pairs[i].value) || 0; i++; break }
              else if (c === 97) break
              i++
            }
            // knots (group code 40)
            const spKnots: number[] = []
            for (let kk = 0; kk < numKnots && i < pairs.length; kk++) {
              if (pairs[i].code === 40) { spKnots.push(parseFloat(pairs[i].value) || 0); i++ }
            }
            // control points (group codes 10/20)
            const spCtrl: Array<{ x: number; y: number }> = []
            for (let cp = 0; cp < numCtrl && i < pairs.length; ) {
              if (pairs[i].code === 10) {
                const cx2 = parseFloat(pairs[i].value) || 0; i++
                const cy2 = (i < pairs.length && pairs[i].code === 20) ? (parseFloat(pairs[i++].value) || 0) : 0
                spCtrl.push({ x: cx2, y: cy2 }); cp++
              } else if (pairs[i].code === 72 || pairs[i].code === 92 || pairs[i].code === 0 || pairs[i].code === 97) {
                break
              } else { i++ }
            }
            // fit points (42 group codes) - skip
            while (i < pairs.length && pairs[i].code === 42) i++
            while (i < pairs.length && (pairs[i].code === 11 || pairs[i].code === 21)) i++

            // B-spline 평가 → SVG path
            if (spCtrl.length >= 2 && spKnots.length >= spCtrl.length + spDegree + 1) {
              const N = Math.max(spCtrl.length * 4, 16)
              const tMin = spKnots[spDegree], tMax = spKnots[spCtrl.length]
              if (tMax > tMin) {
                for (let s = 0; s <= N; s++) {
                  const t = tMin + (tMax - tMin) * s / N
                  const pt = evalBSpline(t, spDegree, spCtrl, spKnots)
                  edgeParts.push(s === 0 && !started ? `M${pt.x},${pt.y}` : `L${pt.x},${pt.y}`)
                  if (s === 0) started = true
                  sumX += pt.x; sumY += pt.y; ptCount++
                }
              }
            } else if (spCtrl.length >= 2) {
              // knot 부족 → control point 직접 연결
              for (let s = 0; s < spCtrl.length; s++) {
                edgeParts.push(s === 0 && !started ? `M${spCtrl[s].x},${spCtrl[s].y}` : `L${spCtrl[s].x},${spCtrl[s].y}`)
                if (s === 0) started = true
                sumX += spCtrl[s].x; sumY += spCtrl[s].y; ptCount++
              }
            }
          } else {
            // Unknown edge type - skip until next edge/boundary
            while (i < pairs.length && !isHatchEdgeEnd(pairs[i].code)) {
              if (pairs[i].code === 97) break
              i++
            }
          }
        }

        if (started) {
          edgeParts.push('Z')
          svgParts.push(edgeParts.join(''))
        }
      }

      // skip source boundary objects count (97) and handles
      while (i < pairs.length && (pairs[i].code === 97 || pairs[i].code === 330)) {
        if (pairs[i].code === 97) {
          const cnt = parseInt(pairs[i].value) || 0
          i++
          for (let s = 0; s < cnt && i < pairs.length; s++) {
            if (pairs[i].code === 330) i++
          }
        } else {
          i++
        }
      }
    }

    // --- 패턴 정의 데이터 (boundary path 뒤): gc 52 각도, 41 축척, 78 정의선 수,
    // 정의선마다 53 angle / 43,44 base / 45,46 offset / 49 dash. 47 또는 98 에서 끝난다.
    // 정의선은 축척·각도가 이미 반영된 최종값이라, 있으면 패턴명을 볼 필요가 없다. ---
    let dAngle = 0, dOffX = 0, dOffY = 0, dDashes: number[] = []
    let inDef = false
    const flushDef = () => {
      if (!inDef) return
      const sp = defLineSpacing(dAngle, dOffX, dOffY)
      if (sp > 1e-9) patternDefs.push({ angle: dAngle, spacing: sp, dashes: dDashes })
      inDef = false; dOffX = 0; dOffY = 0; dDashes = []
    }
    while (i < pairs.length) {
      const c = pairs[i].code, v = pairs[i].value
      if (c === 0 || c === 47 || c === 98 || c === 450) break
      if (c === 52) patternAngle = parseFloat(v) || 0
      else if (c === 41) patternScale = parseFloat(v) || 1
      else if (c === 78) patternDefLines = parseInt(v) || 0
      else if (c === 53) { flushDef(); inDef = true; dAngle = parseFloat(v) || 0 }
      else if (inDef) {
        if (c === 45) dOffX = parseFloat(v) || 0
        else if (c === 46) dOffY = parseFloat(v) || 0
        else if (c === 49) dDashes.push(parseFloat(v) || 0)
      }
      i++
    }
    flushDef()
    if (patternDefs.length > 0) {
      patternSpacing = Math.min(...patternDefs.map(d => d.spacing))
      patternDefAngle = patternDefs[0].angle
    }
    // 남은 꼬리(seed point 등) 스킵: 다음 entity(code=0)까지
    while (i < pairs.length && pairs[i].code !== 0) i++

    if (svgParts.length > 0 && ptCount > 0) {
      hatches.push({
        pathData: svgParts.join(''),
        patternName: patternName.toUpperCase(),
        patternScale,
        patternAngle,
        patternSpacing,
        patternDefAngle,
        patternDefLines,
        patternDefs,
        solidFill,
        color,
        layer,
        cx: sumX / ptCount,
        cy: sumY / ptCount,
      })
    }
  }

  return hatches
}

// ── 레이어 선택 지원 CAD 임포트 (2-phase) ──

/** 레이어별 세그먼트 요약 */
export interface CadLayerInfo {
  name: string
  segCount: number
  colorIndex?: number
  color?: string
  /** WALL/WIN/DOOR 등 키워드 포함 시 true */
  likelyStructural: boolean
}

/** parseCadFile 결과 */
export interface CadParseResult {
  fileName: string
  fileSize: number
  isDwg: boolean
  fingerprint: string
  layers: CadLayerInfo[]
  totalSegments: number
  /** DXF $INSUNITS → mm 변환 계수 */
  unitToMm: number
  /** 내부 데이터 (commitCadImport에서 사용) */
  _segs: DxfSeg[]
  _texts: DxfText[]
  _hatches: DxfHatch[]
}

// STRUCTURAL_KEYWORDS → dxf-shared.ts에서 import

/** 파일 선택 다이얼로그 열기 (취소 시 null 반환) */
export function pickCadFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.dxf,.dwg'
    let resolved = false
    input.onchange = () => {
      resolved = true
      resolve(input.files?.[0] ?? null)
    }
    // 파일 다이얼로그 취소 시 focus 이벤트로 감지
    // 큰 파일(10MB+)은 onchange가 늦을 수 있으므로 충분한 대기시간 필요
    const onFocus = () => {
      setTimeout(() => {
        if (!resolved) resolve(null)
        window.removeEventListener('focus', onFocus)
      }, 2000)
    }
    window.addEventListener('focus', onFocus)
    input.click()
  })
}

/** CAD 파일(DXF/DWG) 파싱 → 레이어 정보 반환 (UI에서 선택 후 commit) */
export async function parseCadFile(
  file: File,
  notify?: { onSuccess?: (msg: string) => void; onError?: (msg: string) => void; onInfo?: (msg: string) => void },
): Promise<CadParseResult | null> {
  const isDwg = file.name.toLowerCase().endsWith('.dwg')

  let text: string
  if (isDwg) {
    try {
      ;(notify?.onInfo ?? notify?.onSuccess)?.('DWG → DXF 변환 중…')
      const buffer = await file.arrayBuffer()
      console.log(`[CAD Import] DWG 파일 읽기 완료: ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB`)
      const dxfBytes = await dwgToDxfBytes(buffer)
      console.log(`[CAD Import] DWG→DXF 변환 완료: ${dxfBytes?.length ?? 0} bytes`)
      // DWG→DXF 변환 결과 검증
      if (!dxfBytes || dxfBytes.length < 100) {
        console.error('[CAD Import] DWG 변환 결과가 비어있음:', dxfBytes?.length)
        notify?.onError?.('DWG 변환 실패: 변환된 데이터가 비어있습니다.')
        return null
      }
      text = decodeDxfBytes(dxfBytes)
      console.log(`[CAD Import] DXF 텍스트 디코딩 완료: ${text.length} chars, SECTION:${text.includes('SECTION')}, ENTITIES:${text.includes('ENTITIES')}`)
      // 변환된 텍스트가 DXF 형식인지 기본 검증
      if (!text || (!text.includes('SECTION') && !text.includes('ENTITIES'))) {
        notify?.onError?.('DWG 변환 실패: 유효한 DXF 데이터가 아닙니다.')
        return null
      }
    } catch (err) {
      console.error('[CAD Import] DWG 변환 예외:', err)
      notify?.onError?.(`DWG 변환 실패: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  } else {
    // DXF/DWG 모두 인코딩 감지: 한국 AutoCAD는 EUC-KR(CP949) 사용
    const buffer = await file.arrayBuffer()
    console.log(`[CAD Import] DXF 파일 읽기 완료: ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB`)
    text = decodeDxfBytes(new Uint8Array(buffer))
  }

  // UI 업데이트를 위한 micro-yield (메인스레드 차단 방지)
  const yieldUI = () => new Promise<void>(r => setTimeout(r, 0))

  ;(notify?.onInfo ?? notify?.onSuccess)?.('도면 구조 분석 중...')
  await yieldUI()

  let dxf: ReturnType<DxfParser['parseSync']>
  try {
    console.log(`[CAD Import] DXF 파싱 시작 (${text.length} chars)...`)
    dxf = new DxfParser().parseSync(text)
    console.log(`[CAD Import] DXF 파싱 완료: entities=${dxf?.entities?.length ?? 0}`)
  } catch (parseErr) {
    console.error('[CAD Import] DXF 파싱 실패:', parseErr)
    notify?.onError?.(`${isDwg ? 'DWG에서 변환된 ' : ''}DXF 파일을 읽을 수 없습니다.`)
    return null
  }
  if (!dxf || !dxf.entities?.length) {
    console.error('[CAD Import] entities 없음:', { dxf: !!dxf, entities: dxf?.entities?.length })
    notify?.onError?.('DXF에 도면 데이터가 없습니다.')
    return null
  }

  const layerTable = (dxf.tables as unknown as Record<string, unknown>)?.layer as
    { layers?: Record<string, { colorIndex?: number; color?: number; lineweight?: number }> } | undefined
  const layerDefs = layerTable?.layers ?? {}

  // 블록 정의 추출
  const rawBlocks = (dxf as unknown as Record<string, unknown>).blocks as
    Record<string, { position?: { x: number; y: number }; entities?: Array<Record<string, unknown>> }> | undefined
  const blocks: DxfBlocks = {}
  if (rawBlocks) {
    for (const [name, block] of Object.entries(rawBlocks)) {
      if (block && typeof block === 'object') {
        blocks[name] = { position: block.position, entities: block.entities }
      }
    }
  }

  // INSERT/BLOCK 재귀 확장 포함 세그먼트 + 텍스트 + 해치 수집
  const entityCount = dxf.entities?.length ?? 0
  const blockCount = Object.keys(blocks).length
  ;(notify?.onInfo ?? notify?.onSuccess)?.(
    `${entityCount.toLocaleString()}개 엔티티 처리 중... (블록 ${blockCount.toLocaleString()}개)`,
  )
  await yieldUI()

  console.log(`[CAD Import] 세그먼트 수집 시작 (blocks: ${blockCount})...`)
  const segs = collectSegmentsWithBlocks(
    dxf.entities as unknown as Array<Record<string, unknown>>,
    layerDefs, blocks,
  )
  // DEFPOINTS 레이어: AutoCAD 비인쇄 특수 레이어 → 지오메트리 제외 (TEXT는 유지)
  const segsFiltered = segs.filter(s => s.layer?.toUpperCase() !== 'DEFPOINTS')
  console.log(`[CAD Import] 세그먼트: ${segs.length} (DEFPOINTS 제외: ${segsFiltered.length})`)
  const texts = collectTextsWithBlocks(
    dxf.entities as unknown as Array<Record<string, unknown>>,
    layerDefs, blocks,
  )
  console.log(`[CAD Import] 텍스트: ${texts.length}`)

  ;(notify?.onInfo ?? notify?.onSuccess)?.(
    `해치 패턴 추출 중... (세그먼트 ${segsFiltered.length.toLocaleString()}개)`,
  )
  await yieldUI()

  // dxf-parser는 HATCH를 파싱하지 않으므로 raw text에서 직접 추출
  const hatches = parseRawHatches(text, layerDefs)
  console.log(`[CAD Import] 해치: ${hatches.length}`)
  if (!segsFiltered.length && !texts.length) {
    console.error('[CAD Import] 세그먼트/텍스트 0개 → 실패')
    notify?.onError?.('DXF에서 도형 데이터를 찾지 못했습니다.')
    return null
  }
  if (segsFiltered.length >= MAX_SEGMENTS) {
    notify?.onInfo?.(`세그먼트 ${MAX_SEGMENTS.toLocaleString()}개 제한으로 일부만 로드됩니다.`)
  }

  // 레이어별 세그먼트 수 집계
  const layerMap = new Map<string, number>()
  for (const s of segsFiltered) {
    const ln = s.layer || '0'
    layerMap.set(ln, (layerMap.get(ln) || 0) + 1)
  }

  const layers: CadLayerInfo[] = [...layerMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, segCount]) => {
      const ld = layerDefs[name]
      const ci = ld?.colorIndex
      return {
        name,
        segCount,
        colorIndex: ci,
        color: ci ? aciToHex(ci) : undefined,
        likelyStructural: STRUCTURAL_KEYWORDS.test(name),
      }
    })

  // unit code → millimetres (1=in, 2=ft, 4=mm, 5=cm, 6=m)
  const unit = (dxf.header?.['$INSUNITS'] as number | undefined) ?? 4
  const unitToMm = unit === 1 ? 25.4 : unit === 2 ? 304.8 : unit === 5 ? 10 : unit === 6 ? 1000 : 1

  return {
    fileName: file.name,
    fileSize: file.size,
    isDwg,
    fingerprint: dxfFingerprint(file.name, file.size, dxf.entities.length),
    layers,
    totalSegments: segsFiltered.length,
    unitToMm,
    _segs: segsFiltered,
    _texts: texts,
    _hatches: hatches,
  }
}

/** 세그먼트를 공간 격자로 쪼갠다 — 연결성 클러스터링이 실패했을 때의 폴백.
 *
 * 연결성으로 못 쪼갠 덩어리를 그대로 두면 클릭 한 번에 도면 절반이 잡힌다.
 * 의미 단위는 아니지만, 적어도 화면 한 구석씩은 따로 집히게 만든다.
 * `targetPerCell` 은 셀 하나에 들어갈 세그먼트 수 목표치다.
 *
 * 칸은 세그먼트 **중점**으로 정한다. 시작점으로 정하면 긴 대각선이나 외곽선이
 * 시작점 쪽 칸에만 들어가서, 그 칸의 bbox 가 격자를 가로질러 늘어난다 — 선택은
 * 되지만 선택 박스가 엉뚱하게 커 보인다. 중점이면 적어도 선의 가운데가 있는
 * 칸에 속한다. */
function partitionSegsByGrid(segs: RawSeg[], targetPerCell: number): RawSeg[][] {
  const cells = Math.max(2, Math.ceil(Math.sqrt(segs.length / targetPerCell)))
  let sMinX = Infinity, sMinY = Infinity, sMaxX = -Infinity, sMaxY = -Infinity
  for (const s of segs) {
    sMinX = Math.min(sMinX, s.x1, s.x1 + s.dx); sMinY = Math.min(sMinY, s.y1, s.y1 + s.dy)
    sMaxX = Math.max(sMaxX, s.x1, s.x1 + s.dx); sMaxY = Math.max(sMaxY, s.y1, s.y1 + s.dy)
  }
  const cellW = (sMaxX - sMinX || 1) / cells
  const cellH = (sMaxY - sMinY || 1) / cells
  const grid = new Map<string, RawSeg[]>()
  for (const s of segs) {
    // 중점이 정확히 최대 경계에 닿으면 cells 가 나와 칸이 하나 더 생긴다 — 묶는다.
    const cx = Math.min(cells - 1, Math.floor((s.x1 + s.dx / 2 - sMinX) / cellW))
    const cy = Math.min(cells - 1, Math.floor((s.y1 + s.dy / 2 - sMinY) / cellH))
    const key = `${cx},${cy}`
    let cell = grid.get(key)
    if (!cell) { cell = []; grid.set(key, cell) }
    cell.push(s)
  }
  return [...grid.values()]
}

/** 연결된 세그먼트끼리 클러스터링 (Union-Find)
 *  endpoint가 SNAP_TOL 이내이면 같은 그룹으로 판정.
 *  방/벽 단위로 개별 선택 가능하도록 분리.
 *
 *  **시간 예산이 없다.** MAX_BUCKET 이 작업량을 세그먼트당 상수로 묶기 때문이다:
 *  endpoint 2개 x 인접 셀 9개 x 버킷당 최대 30개 = 세그먼트당 거리 비교 540회가
 *  증명 가능한 상한이다 (30 을 넘게 자란 버킷은 통째로 건너뛴다). 즉 전체가
 *  O(n) 이고 상수도 작다 — 실측 1104개 65ms.
 *
 *  예전엔 벽시계 4초 예산이 있었는데, (1) 같은 도면이 PC 성능에 따라 다르게
 *  쪼개지고 (2) 예산이 터지면 레이어를 단일 그룹으로 되돌려 "선 하나가 안
 *  골라지는" 버그를 그대로 재현했다. 결정적이지 않은 안전망은 없는 게 낫다. */
function clusterConnectedSegs(segs: RawSeg[]): RawSeg[][] {
  if (segs.length <= 1) return [segs]

  const SNAP_TOL = 5 // px 단위 endpoint 근접 허용치
  const MAX_BUCKET = 30 // 버킷당 최대 세그먼트 수 (작업량을 세그먼트당 상수로 묶는다)
  const n = segs.length

  // Union-Find
  const parent = new Int32Array(n)
  const rank = new Uint8Array(n)
  for (let i = 0; i < n; i++) parent[i] = i
  function find(x: number): number {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] }
    return x
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b)
    if (ra === rb) return
    if (rank[ra] < rank[rb]) parent[ra] = rb
    else if (rank[ra] > rank[rb]) parent[rb] = ra
    else { parent[rb] = ra; rank[ra]++ }
  }

  // endpoint를 grid cell로 해싱
  const cellSize = SNAP_TOL
  const cellMap = new Map<string, number[]>()

  for (let i = 0; i < n; i++) {
    const s = segs[i]
    const x1 = s.x1, y1 = s.y1, x2 = s.x1 + s.dx, y2 = s.y1 + s.dy

    // 두 endpoint에 대해
    for (let ep = 0; ep < 2; ep++) {
      const px = ep === 0 ? x1 : x2
      const py = ep === 0 ? y1 : y2
      const cx = Math.round(px / cellSize)
      const cy = Math.round(py / cellSize)

      // 인접 셀 검사
      for (let ddx = -1; ddx <= 1; ddx++) {
        for (let ddy = -1; ddy <= 1; ddy++) {
          const bucket = cellMap.get(`${cx + ddx},${cy + ddy}`)
          if (!bucket) continue
          // 버킷이 너무 크면 건너뛰기 (밀집 영역 O(n²) 방지)
          if (bucket.length > MAX_BUCKET) continue
          for (const j of bucket) {
            if (find(i) === find(j)) continue // 이미 같은 그룹
            const sj = segs[j]
            const jx1 = sj.x1, jy1 = sj.y1, jx2 = sj.x1 + sj.dx, jy2 = sj.y1 + sj.dy
            // 빠른 거리 체크 (hypot 대신 제곱 비교)
            const tol2 = SNAP_TOL * SNAP_TOL
            if ((px - jx1) * (px - jx1) + (py - jy1) * (py - jy1) <= tol2 ||
                (px - jx2) * (px - jx2) + (py - jy2) * (py - jy2) <= tol2) {
              union(i, j)
            }
          }
        }
      }

      // 자기 자신 등록
      const ownKey = `${cx},${cy}`
      let ownBucket = cellMap.get(ownKey)
      if (!ownBucket) { ownBucket = []; cellMap.set(ownKey, ownBucket) }
      if (ownBucket.length < MAX_BUCKET * 2) ownBucket.push(i) // 과대 버킷 방지
    }
  }

  // 그룹별로 세그먼트 수집
  const groups = new Map<number, RawSeg[]>()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    let g = groups.get(root)
    if (!g) { g = []; groups.set(root, g) }
    g.push(segs[i])
  }

  return [...groups.values()]
}

/** 동일선상(collinear) 세그먼트를 병합하여 shape 수를 줄임 */
export type RawSeg = { x1: number; y1: number; dx: number; dy: number; layer?: string; lineweight?: number; color?: string; linetypeName?: string; transparency?: number }

export function mergeDxfSegments(segs: RawSeg[]): RawSeg[] {
  // 각도(3°) + 수직거리(10px) + 속성(레이어/색/선종류/선굵기) 기준으로 버킷팅
  const buckets = new Map<string, RawSeg[]>()
  for (const s of segs) {
    const len = Math.hypot(s.dx, s.dy)
    if (len < 1) continue
    let ang = (Math.atan2(s.dy, s.dx) * 180) / Math.PI
    if (ang < 0) ang += 180
    if (ang >= 180) ang -= 180
    const nx = -s.dy / len, ny = s.dx / len
    const perp = nx * s.x1 + ny * s.y1
    // 병합하면 first 의 속성이 구간 전체를 대표하게 된다. 그래서 다른 것으로
    // 보여야 하는 속성(layer/color/linetype/lineweight/transparency)은 모두 키에 들어가야 한다 —
    // 빠지면 파선이 실선으로, 가는 선이 굵은 선으로, 투명도가 뭉개진다.
    const key = `${Math.round(ang / 3)}|${Math.round(perp / 10)}|${s.layer || ''}|${s.color || ''}|${s.linetypeName || ''}|${s.lineweight ?? ''}|${s.transparency ?? ''}`
    let b = buckets.get(key)
    if (!b) { b = []; buckets.set(key, b) }
    b.push(s)
  }

  const out: RawSeg[] = []
  for (const group of buckets.values()) {
    if (group.length === 1) { out.push(group[0]); continue }

    // 첫 세그먼트 방향으로 모든 endpoint 투영 → 연속 구간 찾기
    const first = group[0]
    const len = Math.hypot(first.dx, first.dy)
    const ux = first.dx / len, uy = first.dy / len

    // 연속 구간 탐지: 세그먼트들을 투영 시작점 기준 정렬 후 병합
    const intervals: { lo: number; hi: number; seg: RawSeg }[] = []
    for (const s of group) {
      const t1 = (s.x1 - first.x1) * ux + (s.y1 - first.y1) * uy
      const t2 = t1 + s.dx * ux + s.dy * uy
      intervals.push({ lo: Math.min(t1, t2), hi: Math.max(t1, t2), seg: s })
    }
    intervals.sort((a, b) => a.lo - b.lo)

    // gap이 10px 이내면 연속으로 간주
    const GAP = 10
    let curLo = intervals[0].lo, curHi = intervals[0].hi
    const flush = (lo: number, hi: number) => {
      if (hi - lo < 1) return
      const sx = first.x1 + lo * ux, sy = first.y1 + lo * uy
      const ex = first.x1 + hi * ux, ey = first.y1 + hi * uy
      // 버킷 키가 linetype/lineweight/transparency 포함하므로 group 전체가 같은 값 → first 로 대표
      out.push({
        x1: sx, y1: sy, dx: ex - sx, dy: ey - sy,
        layer: first.layer, color: first.color,
        linetypeName: first.linetypeName, lineweight: first.lineweight,
        transparency: first.transparency,
      })
    }

    for (let i = 1; i < intervals.length; i++) {
      const iv = intervals[i]
      if (iv.lo <= curHi + GAP) {
        curHi = Math.max(curHi, iv.hi)
      } else {
        flush(curLo, curHi)
        curLo = iv.lo
        curHi = iv.hi
      }
    }
    flush(curLo, curHi)
  }
  return out
}

// ════════════════════════════════════════════════════════════════════
// V2: Web Worker 기반 고속 DXF 임포트
// ════════════════════════════════════════════════════════════════════

/**
 * 커스텀 DXF 파서를 Web Worker에서 실행.
 * npm dxf 패키지 대비 개선사항:
 * - 선택된 레이어만 파싱 (80–90% 건너뜀)
 * - lodash.cloneDeep 없이 INSERT 블록 확장
 * - UI 스레드 블로킹 없음 (Worker)
 * - 진행률 콜백 지원
 */
import type { PolylineData, TextData, HatchData, LinetypeDef, LayerInfo, WorkerOut, SkipReport, ParseSpace } from './dxf-fast-worker'

function runFastWorker(
  dxfText: string,
  selectedLayers: string[],
  onProgress?: (msg: string) => void,
  space?: ParseSpace,
): Promise<{ polylines: PolylineData[]; insUnits: number; texts: TextData[]; hatches: HatchData[]; linetypes: LinetypeDef[]; ltscale: number; layers: Record<string, LayerInfo>; skipped: SkipReport }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./dxf-fast-worker.ts', import.meta.url),
      { type: 'module' },
    )
    // 파일 크기에 비례한 타임아웃: 최소 60초, MB당 +3초, 최대 600초(10분)
    const sizeMB = dxfText.length / 1_000_000
    const timeoutMs = Math.min(600_000, Math.max(60_000, sizeMB * 3000 + 60_000))
    console.log(`[CAD V2] Worker 타임아웃: ${(timeoutMs / 1000).toFixed(0)}초 (${sizeMB.toFixed(1)}MB)`)
    const timeout = setTimeout(() => {
      worker.terminate()
      reject(new Error(`DXF 파싱 타임아웃 (${(timeoutMs / 1000).toFixed(0)}초)`))
    }, timeoutMs)

    // 워커 모듈이 평가되어 핸들러가 돌았는지. onerror 가 "청크 로딩 실패" 인지
    // "워커 안의 런타임 에러" 인지 가르는 유일한 확정 신호다.
    let booted = false

    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const msg = e.data
      if (msg.type === 'boot') {
        booted = true
      } else if (msg.type === 'progress') {
        onProgress?.(`${msg.phase} (${msg.percent}%)`)
      } else if (msg.type === 'result') {
        clearTimeout(timeout)
        worker.terminate()
        resolve({
          polylines: msg.polylines, insUnits: msg.insUnits,
          texts: msg.texts || [], hatches: msg.hatches || [],
          linetypes: msg.linetypes || [], ltscale: msg.ltscale ?? 1,
          layers: msg.layers || {},
          skipped: msg.skipped || {},
        })
      } else if (msg.type === 'error') {
        clearTimeout(timeout)
        worker.terminate()
        reject(new Error(msg.message))
      }
    }
    worker.onerror = (err) => {
      clearTimeout(timeout)
      worker.terminate()

      // 모듈 스크립트 **로딩 자체**가 실패한 경우. 배포가 갈려 예전 탭이 사라진
      // 워커 청크를 요청하면 이렇게 된다 — Vercel 이 없는 경로에 index.html 을
      // 돌려주므로 브라우저가 MIME 로 거부한다. 실제 로그:
      // `Failed to load module script: ... "text/html"` 뒤에 `Worker 에러: undefined`.
      // lazyWithReload 는 React.lazy 만 감싸서 워커를 커버하지 못한다.
      //
      // 판별은 `err.message` 가 비었는지가 **아니라** boot ack 수신 여부로 한다.
      // 메시지가 비는 에러는 로딩 실패만이 아니다 (cross-origin 으로 가려진
      // 런타임 에러 등). 그걸 로딩 실패로 오인하면 멀쩡한 작업 중에 페이지를
      // 새로고침해서 저장 안 된 편집을 날린다.
      if (!booted) {
        // 말없이 새로고침하지 않는다 — 임포트 도중이라 날아갈 게 있다.
        const reloading = reloadForStaleChunk({
          confirm: 'DXF 파서를 불러오지 못했습니다 (배포가 갱신된 것 같아요).\n'
            + '새로고침하면 저장되지 않은 변경이 사라질 수 있습니다. 새로고침할까요?',
        })
        if (reloading) return  // 리로드 중 — 일부러 settle 하지 않는다
        reject(new Error('DXF 파서(Worker) 를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.'))
        return
      }
      reject(new Error(`Worker 에러: ${err.message || '(메시지 없음)'}`))
    }

    worker.postMessage({ type: 'parse', dxfText, selectedLayers, space })
  })
}

/**
 * 가장 최근 임포트에서 **못 가져온 것들**의 집계 (사유 → 개수).
 *
 * 파서와 파이프라인은 성능·안정성을 위해 여러 곳에서 도형을 버린다. 그게 전부
 * 무음이면 "도면 일부가 안 들어왔다" 를 쓰는 사람도 고치는 사람도 모른다.
 * 임포트가 끝나면 콘솔에 요약을 찍고, UI 에서도 꺼내 볼 수 있게 여기 둔다.
 */
let lastImportReport: SkipReport = {}

export function getLastImportReport(): SkipReport {
  return { ...lastImportReport }
}

// ── commitCadImportV2 파이프라인 헬퍼 함수들 ──

/** 좌표 변환된 텍스트 */
type PxText = { x: number; y: number; text: string; height: number; rotation?: number; color?: string; layer?: string; attachPt?: number; width?: number; fontName?: string }
/** 좌표 변환된 해치 */
type PxHatch = { pathData: string; patternName: string; patternScale: number; patternAngle: number; patternSpacing: number; patternDefAngle: number; patternDefLines: number; patternDefs: HatchPatternLine[]; solidFill?: boolean; color?: string; layer: string; cx: number; cy: number }

const COORD_LIMIT = 1e8
const MAX_FINAL_SEGS = 100_000

/** Floyd-Rivest quickselect — O(N) average */
function nthElement(arr: Float64Array, k: number): number {
  let lo = 0, hi = arr.length - 1
  while (lo < hi) {
    const pivotIdx = lo + ((Math.random() * (hi - lo + 1)) | 0)
    const pivot = arr[pivotIdx]
    arr[pivotIdx] = arr[hi]; arr[hi] = pivot
    let store = lo
    for (let i = lo; i < hi; i++) {
      if (arr[i] < pivot) { const t = arr[i]; arr[i] = arr[store]; arr[store] = t; store++ }
    }
    arr[hi] = arr[store]; arr[store] = pivot
    if (store === k) break
    else if (store < k) lo = store + 1
    else hi = store - 1
  }
  return arr[k]
}

/**
 * 텍스트/해치 좌표만으로 바운딩박스를 계산한다 (autoScale 적용 전 px).
 *
 * 세그먼트가 하나도 없는 DXF — 범례 시트, 주기(note) 시트, 표제란만 있는
 * 파일 — 는 bbox 를 뽑을 선이 없다. 예전엔 그래서 commitCadImportV2 가
 * 세그먼트 0개를 보고 바로 return 0 했고, 글자가 448개 있어도 캔버스는
 * 비어 있었다.
 *
 * 좌표 변환은 transformWorkerTexts/transformWorkerHatches 와 같아야 한다
 * (x * scale, y 는 Y-flip 해서 -y * scale). 같은 COORD_LIMIT 필터와
 * DEFPOINTS 제외도 그대로 따른다 — 여기서 걸러질 엔티티가 bbox 를 늘려놓으면
 * 쓸데없이 넓은 캔버스가 나온다.
 *
 * 글자는 앵커 점만 쓰면 박스가 글리프를 못 덮으므로 높이/폭만큼 넓힌다.
 * 폭이 DXF 에 없으면 글자 수 x 높이 x 0.6 으로 어림한다.
 *
 * @returns 쓸 만한 좌표가 하나도 없으면 null
 */
function computeTextHatchBBox(
  workerTexts: TextData[], workerHatches: HatchData[], scale: number,
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  let n = 0

  const add = (x: number, y: number) => {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    n++
  }

  for (const t of workerTexts) {
    if (!isFinite(t.x) || !isFinite(t.y)) continue
    if (Math.abs(t.x) >= COORD_LIMIT || Math.abs(t.y) >= COORD_LIMIT) continue
    const x = t.x * scale, y = -t.y * scale
    const h = isFinite(t.height) ? Math.abs(t.height * scale) : 0
    const w = t.width && isFinite(t.width)
      ? Math.abs(t.width * scale)
      : (t.text?.length ?? 0) * h * 0.6
    add(x, y)
    // Y-flip 뒤 baseline 이 y 이므로 글리프는 위쪽(y - h)으로 올라간다
    add(x + w, y - h)
  }

  for (const h of workerHatches) {
    if (h.layer?.toUpperCase() === 'DEFPOINTS') continue
    if (!isFinite(h.cx) || !isFinite(h.cy)) continue
    if (Math.abs(h.cx) >= COORD_LIMIT || Math.abs(h.cy) >= COORD_LIMIT) continue
    add(h.cx * scale, -h.cy * scale)
  }

  if (n === 0) return null
  return { minX, maxX, minY, maxY }
}

/** 퍼센타일 기반 바운딩박스 계산 (O(N) quickselect) */
function computeBBox(segs: RawSeg[], pLoPct: number, pHiPct: number) {
  const cnt = segs.length * 2
  const xs = new Float64Array(cnt), ys = new Float64Array(cnt)
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    xs[i * 2] = s.x1; xs[i * 2 + 1] = s.x1 + s.dx
    ys[i * 2] = s.y1; ys[i * 2 + 1] = s.y1 + s.dy
  }
  if (cnt <= 500 || (pLoPct === 0 && pHiPct === 1)) {
    let mnX = xs[0], mxX = xs[0], mnY = ys[0], mxY = ys[0]
    for (let i = 1; i < cnt; i++) {
      if (xs[i] < mnX) mnX = xs[i]; if (xs[i] > mxX) mxX = xs[i]
      if (ys[i] < mnY) mnY = ys[i]; if (ys[i] > mxY) mxY = ys[i]
    }
    return { minX: mnX, maxX: mxX, minY: mnY, maxY: mxY, n: cnt }
  }
  const lo = Math.floor(cnt * pLoPct), hi = Math.min(Math.ceil(cnt * pHiPct) - 1, cnt - 1)
  const xsCopy = new Float64Array(xs)
  const minX = nthElement(xsCopy, lo)
  const xsCopy2 = new Float64Array(xs)
  const maxX = nthElement(xsCopy2, hi)
  const ysCopy2 = new Float64Array(ys)
  const minY = nthElement(ysCopy2, lo)
  const ysCopy3 = new Float64Array(ys)
  const maxY = nthElement(ysCopy3, hi)
  return { minX, maxX, minY, maxY, n: cnt }
}

/** 폴리라인 → RawSeg 변환 (Y-flip, 스케일, DEFPOINTS 제외, ACI 색상, 선종류) */
function polylinesToSegments(polylines: PolylineData[], scale: number): RawSeg[] {
  const segs: RawSeg[] = []
  for (const pl of polylines) {
    const verts = pl.vertices
    if (!verts || verts.length < 2) continue
    if (pl.layer?.toUpperCase() === 'DEFPOINTS') continue
    const color = pl.colorNumber >= 0 ? aciToHex(pl.colorNumber) : undefined
    for (let i = 0; i < verts.length - 1; i++) {
      const x1 = verts[i][0] * scale
      const y1 = -verts[i][1] * scale
      const x2 = verts[i + 1][0] * scale
      const y2 = -verts[i + 1][1] * scale
      segs.push({
        x1, y1, dx: x2 - x1, dy: y2 - y1,
        layer: pl.layer, color,
        linetypeName: pl.linetypeName,
        lineweight: pl.lineweight,
        transparency: pl.transparency,
      })
    }
  }
  return segs
}

/** 세그먼트 정제: sanity → min length → merge → dedup → hard cap */
function filterAndCleanSegments(rawSegsAll: RawSeg[]): RawSeg[] {
  // 좌표 sanity 필터
  const saneSegs = rawSegsAll.filter((s) => {
    const x2 = s.x1 + s.dx, y2 = s.y1 + s.dy
    return Math.abs(s.x1) < COORD_LIMIT && Math.abs(s.y1) < COORD_LIMIT &&
           Math.abs(x2) < COORD_LIMIT && Math.abs(y2) < COORD_LIMIT &&
           isFinite(s.x1) && isFinite(s.y1) && isFinite(s.dx) && isFinite(s.dy)
  })

  // 1px 필터 (0.1px fallback)
  let rawSegs = saneSegs.filter((s) => Math.hypot(s.dx, s.dy) >= 1)
  if (!rawSegs.length && saneSegs.length > 0) {
    rawSegs = saneSegs.filter((s) => Math.hypot(s.dx, s.dy) >= 0.1)
    if (!rawSegs.length) rawSegs = saneSegs.filter((s) => Math.hypot(s.dx, s.dy) > 1e-6)
    if (!rawSegs.length) rawSegs = saneSegs
  }
  console.log(`[CAD V2] 필터 후: ${rawSegs.length}개 (sanity: ${saneSegs.length}, 1px: ${rawSegs.length})`)

  // 동일선상 병합
  const merged = mergeDxfSegments(rawSegs)
  let finalSegs = merged.length > 0 ? merged : rawSegs
  console.log(`[CAD V2] 병합: ${rawSegs.length} → ${finalSegs.length}`)

  // 중복 세그먼트 제거 (1px 해상도 키, 원본 float 유지)
  const dedupSet = new Set<string>()
  const dedupSegs: RawSeg[] = []
  for (const s of finalSegs) {
    const rx1 = Math.round(s.x1), ry1 = Math.round(s.y1)
    const rx2 = Math.round(s.x1 + s.dx), ry2 = Math.round(s.y1 + s.dy)
    if (rx1 === rx2 && ry1 === ry2) continue
    const key = `${rx1},${ry1},${rx2},${ry2}`
    if (dedupSet.has(key)) continue
    dedupSet.add(key)
    dedupSegs.push(s)
  }
  console.log(`[CAD V2] 중복제거: ${finalSegs.length} → ${dedupSegs.length}`)
  finalSegs = dedupSegs

  // 하드 캡: 레이어별 비례 샘플링 (특정 레이어만 날아가는 것 방지)
  if (finalSegs.length > MAX_FINAL_SEGS) {
    const ratio = MAX_FINAL_SEGS / finalSegs.length
    // 레이어별 그루핑
    const byLayer = new Map<string, RawSeg[]>()
    for (const s of finalSegs) {
      const key = s.layer || '0'
      let arr = byLayer.get(key)
      if (!arr) { arr = []; byLayer.set(key, arr) }
      arr.push(s)
    }
    // 각 레이어에서 비례 개수만큼 균등 샘플링 (최소 1개 보장)
    const sampled: RawSeg[] = []
    for (const [, layerSegs] of byLayer) {
      const keep = Math.max(1, Math.round(layerSegs.length * ratio))
      if (keep >= layerSegs.length) {
        sampled.push(...layerSegs)
      } else {
        const step = layerSegs.length / keep
        for (let i = 0; i < keep; i++) sampled.push(layerSegs[Math.floor(i * step)])
      }
    }
    console.log(`[CAD V2] 세그먼트 캡: ${finalSegs.length} → ${sampled.length} (${byLayer.size}개 레이어 비례)`)
    finalSegs = sampled
  }

  return finalSegs
}

/** 본체와 쓰레기를 가르는 "빈 공간" 의 크기 — 사분위 범위(IQR) 대비 배수.
 *  도면 본체는 좌표가 촘촘해서 내부 간격이 사실상 0 이므로 넉넉히 잡아도 된다. */
const OUTLIER_GAP_RATIO = 0.25
/** 간격 기준으로도 이만큼 넘게 지우겠다면 전제가 틀린 것이다 — 통째로 포기한다. */
const MAX_OUTLIER_DROP_RATIO = 0.5

/**
 * 한 축에서 "도면 본체" 가 차지하는 구간을 찾는다.
 *
 * 예전 방식(5~95 퍼센타일 bbox + 패딩)은 가장자리를 잘라내는 거라 멀쩡한 도형을
 * 먹었다. 모델공간에 시트를 가로로 늘어놓은 도면에선 Y 양끝이 퍼센타일 밖으로
 * 밀려나서, 리비전 구름의 위아래 호가 통째로 사라지고 좌우 호만 남아 "{ }" 모양이
 * 됐다. 반대로 한도를 걸어 막아놓으니 이번엔 멀리 떨어진 쓰레기가 살아남아 bbox 를
 * 부풀렸고, 도면이 시트 한가운데 티끌만 하게 들어갔다.
 *
 * 진짜 쓰레기의 특징은 "가장자리에 있다" 가 아니라 "뚝 떨어져 있다" 다. 그래서
 * 좌표를 정렬해놓고 사분위 범위 바깥으로 걸어나가다가 좌표 사이에 큰 빈 공간이
 * 나오면 거기서 자른다. 본체는 연속이라 안 잘리고, 떨어진 덩어리만 떨어져 나간다.
 */
function coreRange(sorted: Float64Array): [number, number] {
  const n = sorted.length
  const q1i = Math.floor(n * 0.25), q3i = Math.floor(n * 0.75)
  const gapLimit = (sorted[q3i] - sorted[q1i]) * OUTLIER_GAP_RATIO
  if (!(gapLimit > 0)) return [sorted[0], sorted[n - 1]]
  let hi = sorted[n - 1]
  for (let i = q3i; i < n - 1; i++) {
    if (sorted[i + 1] - sorted[i] > gapLimit) { hi = sorted[i]; break }
  }
  let lo = sorted[0]
  for (let i = q1i; i > 0; i--) {
    if (sorted[i] - sorted[i - 1] > gapLimit) { lo = sorted[i]; break }
  }
  return [lo, hi]
}

/** 도면 본체에서 뚝 떨어진 세그먼트를 걷어낸다 (빈 공간 간격 기준) */
export function removeOutlierSegments(segs: RawSeg[]): RawSeg[] {
  const cnt = segs.length * 2
  if (cnt < 400) return segs

  const xs = new Float64Array(cnt), ys = new Float64Array(cnt)
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    xs[i * 2] = s.x1; xs[i * 2 + 1] = s.x1 + s.dx
    ys[i * 2] = s.y1; ys[i * 2 + 1] = s.y1 + s.dy
  }
  xs.sort(); ys.sort()
  const [loX, hiX] = coreRange(xs)
  const [loY, hiY] = coreRange(ys)

  if (loX === xs[0] && hiX === xs[cnt - 1] && loY === ys[0] && hiY === ys[cnt - 1]) {
    console.log(`[CAD V2] 뚝 떨어진 아웃라이어 없음 — 필터 건너뜀 (${segs.length}개 유지)`)
    return segs
  }

  const kept = segs.filter(s => {
    const x2 = s.x1 + s.dx, y2 = s.y1 + s.dy
    return s.x1 >= loX && s.x1 <= hiX && x2 >= loX && x2 <= hiX &&
           s.y1 >= loY && s.y1 <= hiY && y2 >= loY && y2 <= hiY
  })

  if (kept.length < segs.length * (1 - MAX_OUTLIER_DROP_RATIO)) {
    console.warn(`[CAD V2] 아웃라이어 필터 거부: ${segs.length - kept.length}개를 지우려 함 — 전제가 틀린 듯해 건너뜀`)
    return segs
  }

  console.log(`[CAD V2] 아웃라이어 제거(간격 기준): ${segs.length} → ${kept.length}개 ` +
              `(본체 X ${loX.toFixed(0)}~${hiX.toFixed(0)}, Y ${loY.toFixed(0)}~${hiY.toFixed(0)})`)
  return kept
}

/** Worker 텍스트 → px 좌표 변환 (Y-flip + scale)
 *
 *  DEFPOINTS 는 지오메트리만 걸러낸다 (치수 정의점 — 어차피 안 보이는 POINT).
 *  텍스트는 남긴다. AutoCAD 의 DEFPOINTS 는 "출력 안 함" 이지 "숨김" 이 아니라
 *  화면에는 그대로 보이고, 실무에서 도면 제목을 여기에 올려놓는 경우가 흔하다.
 *  (예: '평 면 (1/60)' h=2970, 'COVER' h=1980 — 도면에서 가장 큰 글자들)
 *  예전엔 여기서 통째로 버려서 제목만 쏙 사라졌고 로그도 안 남았다.
 *  (지금은 없어진 레거시 V1 임포트도 처음부터 이 규칙이었다.) */
/**
 * @param minHeight 텍스트 최소 높이(px). 캔버스 span 에 비례한 값을 넘긴다 —
 *   computeMinTextHeight() 참고.
 */
function transformWorkerTexts(workerTexts: TextData[], textScale: number, minHeight: number): PxText[] {
  return workerTexts
    .filter(t => Math.abs(t.x) < COORD_LIMIT && Math.abs(t.y) < COORD_LIMIT && isFinite(t.x) && isFinite(t.y))
    .map(t => ({
      x: t.x * textScale,
      y: -t.y * textScale,
      text: t.text,
      height: Math.max(t.height * textScale, minHeight),
      rotation: t.rotation,
      color: t.colorNumber >= 0 ? aciToHex(t.colorNumber) : undefined,
      layer: t.layer,
      attachPt: t.attachPt,
      width: t.width ? t.width * textScale : undefined,
      fontName: t.fontName,
    }))
}

/** 자동 축소 후 캔버스가 가질 수 있는 최대 span (px) */
const MAX_CANVAS_SPAN_PX = 12000

/**
 * 텍스트 최소 높이(px)를 캔버스 span 에서 계산한다.
 * span 이 MAX_CANVAS_SPAN_PX 일 때 1px, 더 작은 도면이면 그만큼 더 작게.
 *
 * 예전엔 절대값 4px 였다. autoScale 이 작은 대형 도면(autoScale 0.0123 같은)에선
 * 글자 대부분이 4px 미만으로 스케일되므로 448개 중 430개가 **정확히 4px** 로
 * 뭉개졌다 — 도면 제목, 실명, 치수, 주기가 전부 같은 크기가 되어 크기 위계가
 * 통째로 사라졌다. 하한을 캔버스 크기에 비례시키면, 원래 크기 차이가
 * 하한 아래로 깔리지 않는다.
 *
 * 0.1px 절대 하한은 남긴다 — 텍스트 높이를 shape props 에 toFixed(1) 로 넣으므로
 * 그보다 작으면 0 으로 반올림되어 글자가 아예 사라진다.
 */
export function computeMinTextHeight(canvasSpanPx: number): number {
  const span = canvasSpanPx > 0 && isFinite(canvasSpanPx) ? canvasSpanPx : MAX_CANVAS_SPAN_PX
  return Math.max(span / MAX_CANVAS_SPAN_PX, 0.1)
}

/** hatchesJson 에 실어 보낼 정의선 최대 개수. AR-CONC 처럼 13개인 패턴도 있는데
 *  전부 깔면 SVG pattern 이 그만큼 늘어나고 어차피 회색 덩어리로 보인다. */
const MAX_PACKED_DEF_LINES = 4

/**
 * hatchesJson 한 항목의 패턴 정보.
 * 패턴 정의선(gc 78)이 있으면 그 각도/간격이 이미 해석된 최종값이므로
 * gc 52(각도)/41(축척) 대신 정의선 값을 쓴다. dl 이 있으면 렌더 쪽은
 * 패턴명을 아예 보지 않고 정의선만 그린다.
 */
function packHatchPattern(hh: PxHatch) {
  const hasDef = hh.patternDefLines > 0 && hh.patternSpacing > 0
  // 간격 넓은 쪽이 눈에 보이는 선 → 잘릴 땐 촘촘한 쪽을 버린다.
  const dl = hh.patternDefs
    .filter(d => d.spacing > 0 && isFinite(d.spacing))
    .sort((a, b) => b.spacing - a.spacing)
    .slice(0, MAX_PACKED_DEF_LINES)
    .map(d => ({
      a: +d.angle.toFixed(2),
      s: +d.spacing.toFixed(2),
      ...(d.dashes.length > 0 ? { d: d.dashes.map(v => +v.toFixed(2)) } : {}),
    }))
  return {
    p: hh.patternName,
    s: hh.patternScale,
    a: hasDef ? hh.patternDefAngle : hh.patternAngle,
    ...(hasDef ? { sp: +hh.patternSpacing.toFixed(2), n: hh.patternDefLines } : {}),
    ...(dl.length > 0 ? { dl } : {}),
  }
}

/** Worker 해치 → px 좌표 변환 (Y-flip + scale, SVG path 변환) */
function transformWorkerHatches(workerHatches: HatchData[], textScale: number): PxHatch[] {
  return workerHatches
    .filter(h => h.layer?.toUpperCase() !== 'DEFPOINTS')
    .filter(h => Math.abs(h.cx) < COORD_LIMIT && Math.abs(h.cy) < COORD_LIMIT && isFinite(h.cx) && isFinite(h.cy))
    .map(h => {
      const transformedPath = h.pathData.replace(
        /([MLZ])([\d.e+-]+),([\d.e+-]+)/g,
        (_, cmd: string, xStr: string, yStr: string) => {
          const nx = parseFloat(xStr) * textScale
          const ny = -parseFloat(yStr) * textScale
          return `${cmd}${nx.toFixed(1)},${ny.toFixed(1)}`
        }
      )
      return {
        pathData: transformedPath,
        patternName: h.patternName,
        patternScale: h.patternScale,
        patternAngle: h.patternAngle,
        // 간격은 도면 단위 → px (경로와 같은 배율). 각도는 Y-flip 이라 렌더 쪽에서 부호 반전.
        patternSpacing: h.patternSpacing * textScale,
        patternDefAngle: h.patternDefAngle,
        patternDefLines: h.patternDefLines,
        // 정의선의 간격·dash 길이도 같은 배율로 px 로 바꿔 둔다 (각도는 그대로).
        patternDefs: h.patternDefs.map(d => ({
          angle: d.angle,
          spacing: d.spacing * textScale,
          dashes: d.dashes.map(v => v * textScale),
        })),
        solidFill: h.solidFill,
        color: h.color,
        layer: h.layer,
        cx: h.cx * textScale,
        cy: -h.cy * textScale,
      }
    })
}

/** 클러스터 미할당 텍스트 → 독립 DxfGroup shape 생성 */
/** 고립 텍스트가 만들 수 있는 shape 수 상한.
 *  넘으면 텍스트를 버리는 게 아니라 격자로 더 거칠게 묶는다. */
const MAX_ORPHAN_TEXT_SHAPES = 1500

/** 텍스트를 격자 셀로 다시 묶는다. 셀 수가 maxGroups 를 넘지 않도록 셀 크기를
 *  바운딩박스에서 역산하므로, 결과 그룹 수는 항상 maxGroups 이하다. */
function regroupTextsByGrid(texts: PxText[], maxGroups: number): PxText[][] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const t of texts) {
    if (t.x < minX) minX = t.x
    if (t.x > maxX) maxX = t.x
    if (t.y < minY) minY = t.y
    if (t.y > maxY) maxY = t.y
  }
  const w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1)
  // 면적에서 셀 크기를 역산하면 floor 때문에 셀 수가 상한을 살짝 넘는다
  // (cols=ceil(w/cell), rows=ceil(h/cell)) → 들어맞을 때까지 키운다.
  let cell = Math.max(Math.sqrt((w * h) / Math.max(1, maxGroups)), 1)
  for (let i = 0; i < 20; i++) {
    const cells = (Math.floor(w / cell) + 1) * (Math.floor(h / cell) + 1)
    if (cells <= maxGroups) break
    cell *= Math.sqrt(cells / maxGroups) * 1.02
  }
  const buckets = new Map<string, PxText[]>()
  for (const t of texts) {
    const key = `${Math.floor((t.x - minX) / cell)},${Math.floor((t.y - minY) / cell)}`
    let b = buckets.get(key)
    if (!b) { b = []; buckets.set(key, b) }
    b.push(t)
  }
  return [...buckets.values()]
}

/** 어떤 지오메트리 클러스터에도 붙지 못한 텍스트를 텍스트 전용 shape 으로.
 *
 *  텍스트는 **같은 레이어의** 클러스터에만 붙는데, 도면은 보통 문자를 전용
 *  레이어에 몰아넣는다 → 사실상 모든 텍스트가 여기로 온다. 예전엔 2000개를
 *  넘으면 통째로 `return []` 했고, 로그조차 없어서 도면에서 글자가 전부
 *  사라져도 아무 흔적이 안 남았다. 이제는 버리지 않고 더 거칠게 묶는다. */
export function buildOrphanTextShapes(
  pxTexts: PxText[], assignedTextIdx: Set<number>,
  offsetX: number, offsetY: number, fingerprint: string,
): unknown[] {
  const orphanTexts = pxTexts.filter((_, idx) => !assignedTextIdx.has(idx))
  if (orphanTexts.length === 0) return []

  const TEXT_GROUP_GAP = 200
  const sorted = [...orphanTexts].sort((a, b) => a.y - b.y || a.x - b.x)
  const textGroups: typeof orphanTexts[] = []
  let curGroup: typeof orphanTexts = [sorted[0]]

  for (let i = 1; i < sorted.length; i++) {
    const prev = curGroup[curGroup.length - 1]
    const cur = sorted[i]
    if (Math.abs(cur.y - prev.y) < TEXT_GROUP_GAP && Math.abs(cur.x - prev.x) < TEXT_GROUP_GAP * 5) {
      curGroup.push(cur)
    } else {
      textGroups.push(curGroup)
      curGroup = [cur]
    }
  }
  textGroups.push(curGroup)

  // 그룹이 너무 많으면 shape 수가 폭발한다 → 격자로 재묶음. 텍스트는 안 버린다.
  let groups = textGroups
  if (groups.length > MAX_ORPHAN_TEXT_SHAPES) {
    groups = regroupTextsByGrid(orphanTexts, MAX_ORPHAN_TEXT_SHAPES)
    console.warn(`[CAD V2] 고립 텍스트 그룹 ${textGroups.length}개 → 격자 재묶음 ${groups.length}개 (텍스트 ${orphanTexts.length}개 전부 유지)`)
  }

  const shapes: unknown[] = []
  for (const tg of groups) {
    let tMinX = Infinity, tMinY = Infinity, tMaxX = -Infinity, tMaxY = -Infinity
    for (const t of tg) {
      tMinX = Math.min(tMinX, t.x)
      tMinY = Math.min(tMinY, t.y - t.height)
      tMaxX = Math.max(tMaxX, t.x + t.height * t.text.length * 0.6)
      tMaxY = Math.max(tMaxY, t.y + t.height * 0.3)
    }
    const tw = Math.max(tMaxX - tMinX, 10)
    const th = Math.max(tMaxY - tMinY, 10)
    const localTexts = tg.map(t => ({
      x: +(t.x - tMinX).toFixed(1), y: +(t.y - tMinY).toFixed(1),
      t: t.text, h: +t.height.toFixed(1), r: t.rotation, c: t.color,
      ap: t.attachPt, mw: t.width ? +t.width.toFixed(1) : undefined,
      f: t.fontName,
    }))
    shapes.push({
      id: createShapeId(),
      type: 'dxfgroup',
      x: tMinX - offsetX, y: tMinY - offsetY,
      props: { w: tw, h: th, pathData: '', thickness: 0, segCount: 0, textsJson: packTextsJson(localTexts), hatchesJson: '' },
      meta: { dxfFingerprint: fingerprint, dxfLayer: tg[0].layer || '0' },
    })
  }
  console.log(`[CAD V2] 고립 텍스트: ${orphanTexts.length}개 → ${groups.length}개 그룹`)
  return shapes
}

/**
 * 할당되지 않은 해치 → 독립 DxfGroup shape 하나.
 *
 * 세그먼트 100개 미만 도면(개별 wall shape 경로)은 해치를 담을 DxfGroup 이
 * 아예 만들어지지 않는다. 예전엔 여기서 해치가 통째로 사라졌다.
 * 작은 도면이라 개수가 적어서 한 shape 에 모아도 충분하다 —
 * DxfGroupShape 은 overflow:visible 이라 bbox 가 커도 잘리지 않는다.
 */
export function buildOrphanHatchShapes(
  pxHatches: PxHatch[], assignedHatchIdx: Set<number>,
  offsetX: number, offsetY: number, fingerprint: string,
): unknown[] {
  const orphans = pxHatches.filter((_, idx) => !assignedHatchIdx.has(idx))
  if (orphans.length === 0) return []

  let hMinX = Infinity, hMinY = Infinity, hMaxX = -Infinity, hMaxY = -Infinity
  const parsed = orphans.map(hh => {
    let pMinX = Infinity, pMinY = Infinity, pMaxX = -Infinity, pMaxY = -Infinity
    const pts: Array<[string, number, number]> = []
    hh.pathData.replace(
      /([MLZ])([\d.e+-]+),([\d.e+-]+)/g,
      (_m, cmd: string, xStr: string, yStr: string) => {
        const x = parseFloat(xStr), y = parseFloat(yStr)
        pts.push([cmd, x, y])
        pMinX = Math.min(pMinX, x); pMaxX = Math.max(pMaxX, x)
        pMinY = Math.min(pMinY, y); pMaxY = Math.max(pMaxY, y)
        return _m
      }
    )
    if (pts.length === 0) return null
    hMinX = Math.min(hMinX, pMinX); hMaxX = Math.max(hMaxX, pMaxX)
    hMinY = Math.min(hMinY, pMinY); hMaxY = Math.max(hMaxY, pMaxY)
    return { hh, pts, dim: Math.max(pMaxX - pMinX, pMaxY - pMinY, 10) }
  }).filter((v): v is NonNullable<typeof v> => v !== null)

  if (parsed.length === 0) return []

  const localHatches = parsed.map(({ hh, pts, dim }) => ({
    d: pts.map(([cmd, x, y]) => `${cmd}${(x - hMinX).toFixed(1)},${(y - hMinY).toFixed(1)}`).join(''),
    ...packHatchPattern(hh), c: hh.color,
    f: hh.solidFill ? 1 : 0,
    dim: +dim.toFixed(1),
  }))

  console.log(`[CAD V2] 고립 해치: ${localHatches.length}개 → 1개 그룹`)
  return [{
    id: createShapeId(),
    type: 'dxfgroup',
    x: hMinX - offsetX, y: hMinY - offsetY,
    props: {
      w: Math.max(hMaxX - hMinX, 10), h: Math.max(hMaxY - hMinY, 10),
      pathData: '', thickness: 0, segCount: 0,
      textsJson: '', hatchesJson: JSON.stringify(localHatches),
    },
    meta: { dxfFingerprint: fingerprint, dxfLayer: parsed[0].hh.layer || '0' },
  }]
}

/** 레이아웃 뷰포트 clip 이 도형을 **하나도** 못 잡았을 때 던진다.
 *
 * "이 레이아웃은 비었다" 가 아니라 clip 자체가 틀렸다는 뜻이다 — 좌표계
 * (DCS/WCS)나 단위가 어긋나면 늘 이 모양이 나온다. 실제로 DWG→DXF 변환에서
 * 뷰포트 → 모델공간 매핑이 날아가는 파일이 있다 (변환기가 비운
 * ACAD_XREC_ROUNDTRIP XRECORD, 사라진 UCS 원점 코드 110/120/130).
 *
 * 호출자는 이걸 받으면 그 레이아웃의 **페이지를 만들지 말아야 한다.** 예전엔
 * clip 을 버리고 모델공간 전체를 복사했는데, 오토캐드에서 탭으로 나뉘어 있던
 * 게 한 페이지에 다 쏟아져서 "모형" 페이지의 복제본이 생겼다. 틀린 페이지를
 * 만들어 주는 것보다 "이 레이아웃은 못 가져왔다" 를 분명히 말하는 게 낫다.
 *
 * 0 을 돌려주지 않고 던지는 이유: 0 은 "선택한 레이어에 도형이 없음" 과
 * 구분되지 않는다. 그 모호함 때문에 워커 실패가 조용히 빈 페이지로 끝난
 * 전례가 있다.
 */
export class ViewportClipMissedError extends Error {
  readonly clip: ViewportClip
  constructor(clip: ViewportClip) {
    super(
      `레이아웃 뷰포트가 도형을 하나도 못 잡았습니다 ` +
      `(clip=(${clip.minX.toFixed(0)},${clip.minY.toFixed(0)})~` +
      `(${clip.maxX.toFixed(0)},${clip.maxY.toFixed(0)}))`,
    )
    this.name = 'ViewportClipMissedError'
    this.clip = clip
  }
}

export async function commitCadImportV2(
  editor: Editor,
  dxfText: string,
  selectedLayers: Set<string>,
  fileName: string,
  fileSize: number,
  _isDwg: boolean,
  onProgress?: (msg: string) => void,
  viewportClip?: ViewportClip | null,
  space?: ParseSpace,
): Promise<number> {
  const t0 = performance.now()
  const layerArr = [...selectedLayers]
  console.log(`[CAD V2] 시작: selectedLayers=${layerArr.join(',')}`)

  // 1. Worker에서 DXF 파싱 (메인스레드 블로킹 없음, 실패 시 동기 fallback)
  onProgress?.('도면 파싱 중...')
  let polylines: PolylineData[]
  let insUnits: number
  let workerTexts: TextData[]
  let workerHatches: HatchData[]
  let workerLinetypes: LinetypeDef[]
  let workerLtscale: number
  let workerLayers: Record<string, LayerInfo>
  let workerSkipped: SkipReport
  try {
    const result = await runFastWorker(dxfText, layerArr, onProgress, space)
    polylines = result.polylines
    insUnits = result.insUnits
    workerTexts = result.texts || []
    workerHatches = result.hatches || []
    workerLinetypes = result.linetypes || []
    workerLtscale = result.ltscale ?? 1
    workerLayers = result.layers || {}
    workerSkipped = result.skipped || {}
  } catch (workerErr) {
    console.error(`[CAD V2] Worker 실패:`, workerErr)
    onProgress?.('파싱 실패')
    // 동기 fallback 은 없다 — 메인 스레드에서 100MB+ 를 파싱하면 브라우저가 멈춘다.
    //
    // 예전엔 여기서 `return 0` 을 했다. 그러면 호출자는 **실패**와 "선택한
    // 레이어에 도형이 없음"(둘 다 0)을 구분할 수 없다. 실제로 워커 청크가
    // 404 났는데 `[Import] Layout "Model": 0개 요소` 로 조용히 넘어가고
    // 빈 페이지 + 성공 토스트까지 나왔다. 호출자(ImportPanel, App)는 둘 다
    // try/catch 로 에러 토스트를 띄우니, 던지는 쪽이 맞다.
    throw workerErr instanceof Error ? workerErr : new Error(String(workerErr))
  }
  const parseMs = (performance.now() - t0).toFixed(0)
  console.log(`[CAD V2] 파싱 완료: ${polylines.length}개 폴리라인, ${workerHatches.length}개 해치 (${parseMs}ms)`)

  // 레이어 lineweight/color 정보 로그
  const lwLayers = Object.entries(workerLayers).filter(([, v]) => v.lineweight)
  if (lwLayers.length > 0) {
    console.log(`[CAD V2] 레이어 lineweight: ${lwLayers.map(([k, v]) => `${k}=${v.lineweight}`).join(', ')}`)
  }

  // 2. 유닛 스케일
  const unit = insUnits
  const unitToMm = unit === 1 ? 25.4 : unit === 2 ? 304.8 : unit === 5 ? 10 : unit === 6 ? 1000 : 1
  const scale = getScaleConfig(editor).pxPerMm * unitToMm
  const thickness = getDefaultWallThicknessMm() * getScaleConfig(editor).pxPerMm
  console.log(`[CAD V2] scale=${scale}, unitToMm=${unitToMm}`)

  // 3. 폴리라인 → RawSeg 변환 + 필터링 파이프라인
  onProgress?.('좌표 변환 중...')
  const rawSegsAll = polylinesToSegments(polylines, scale)
  // 필터를 하나도 안 거친 전체 범위. 뷰포트 clip 이 도형을 하나도 못 잡을 때
  // "그 영역이 원래 비어 있는가" 와 "우리가 걸러낸 것인가" 를 가르는 기준이다.
  if (rawSegsAll.length > 0) {
    const rb = computeBBox(rawSegsAll, 0, 1)
    console.log(`[CAD V2] rawSegsAll: ${rawSegsAll.length}개 세그먼트, ` +
      `전체 범위 X ${rb.minX.toFixed(0)}~${rb.maxX.toFixed(0)}, Y ${rb.minY.toFixed(0)}~${rb.maxY.toFixed(0)}`)
  } else {
    console.log(`[CAD V2] rawSegsAll: 0개 세그먼트`)
  }

  // 세그먼트가 0개여도 글자나 해치가 있으면 계속 간다.
  // 범례/주기 시트처럼 선이 하나도 없는 DXF 가 실제로 있고,
  // 예전엔 여기서 그냥 돌아가 캔버스가 비어 있었다.
  if (rawSegsAll.length === 0 && workerTexts.length === 0 && workerHatches.length === 0) {
    console.warn('[CAD V2] 세그먼트/텍스트/해치 모두 0개 → 종료')
    return 0
  }

  onProgress?.('세그먼트 병합 중...')
  const report: SkipReport = { ...workerSkipped }
  const noteDrop = (reason: string, n: number) => {
    if (n > 0) report[reason] = (report[reason] ?? 0) + n
  }

  let finalSegs = filterAndCleanSegments(rawSegsAll)
  noteDrop('세그먼트 정제(1px 미만·중복·동일선상 병합)', rawSegsAll.length - finalSegs.length)

  // 4. 아웃라이어 제거: Viewport 클리핑 또는 IQR fallback
  //
  // 텍스트/해치 필터도 같은 clip 을 따라야 하므로 이 아래로는 이걸 쓴다.
  // (clip 이 통째로 빗나간 경우엔 되돌리지 않고 던진다 — 아래 참고.)
  //
  // 종이 모드에선 좌표가 **종이(mm)** 공간이다. viewportClip 은 모델공간
  // 상자라서 그대로 대면 전부 걸러진다 — 무시한다.
  const effectiveClip = space?.kind === 'paper' ? null : viewportClip
  if (effectiveClip) {
    // Viewport AABB 클리핑 (정확한 레이아웃 기반)
    const cMinX = effectiveClip.minX * scale
    const cMinY = -effectiveClip.maxY * scale  // Y-flip (DXF Y+ → screen Y-)
    const cMaxX = effectiveClip.maxX * scale
    const cMaxY = -effectiveClip.minY * scale  // Y-flip
    const beforeVp = finalSegs.length
    const clipped = finalSegs.filter(s => {
      const x2 = s.x1 + s.dx, y2 = s.y1 + s.dy
      // 세그먼트 AABB가 viewport와 교차하면 통과
      return Math.max(s.x1, x2) >= cMinX && Math.min(s.x1, x2) <= cMaxX &&
             Math.max(s.y1, y2) >= cMinY && Math.min(s.y1, y2) <= cMaxY
    })
    console.log(`[CAD V2] Viewport 클리핑: ${beforeVp} → ${clipped.length} (${beforeVp - clipped.length}개 제거)`)

    if (clipped.length === 0 && beforeVp > 0) {
      // clip 상자 안에 도형이 **하나도** 없다 → clip 이 틀렸다. 자세한 사정은
      // ViewportClipMissedError 주석에 있다. 여기서 아무것도 만들지 않고
      // 던지면, 호출자가 이 레이아웃의 페이지를 아예 안 만든다.
      //
      // 아직 editor 에 shape 을 하나도 만들지 않은 지점이라 던져도 안전하다.
      console.warn(
        `[CAD V2] Viewport clip 이 세그먼트를 전부 제거했다 (${beforeVp}개) — ` +
        `이 레이아웃은 가져오지 않는다. ` +
        `clip=(${effectiveClip.minX.toFixed(0)},${effectiveClip.minY.toFixed(0)})~` +
        `(${effectiveClip.maxX.toFixed(0)},${effectiveClip.maxY.toFixed(0)})`,
      )
      noteDrop('레이아웃 뷰포트가 도형을 못 잡음 → 페이지 생성 안 함', beforeVp)
      throw new ViewportClipMissedError(effectiveClip)
    }
    noteDrop('레이아웃 뷰포트 밖 도형', beforeVp - clipped.length)
    finalSegs = clipped
  } else {
    // 폴백: IQR 아웃라이어 필터 (레이아웃 없는 파일)
    const beforeOut = finalSegs.length
    finalSegs = removeOutlierSegments(finalSegs)
    noteDrop('본체에서 뚝 떨어진 도형', beforeOut - finalSegs.length)
  }

  // 5. 최종 bbox.
  // 세그먼트가 남지 않은 경우(애초에 없었거나, viewport 클리핑/IQR 로 다 걸러진
  // 경우)에는 텍스트/해치 좌표에서 뽑는다. computeBBox 는 빈 배열에 NaN 을
  // 돌려주므로 그대로 쓰면 autoScale 과 offset 이 전부 NaN 이 된다.
  let minX: number, maxX: number, minY: number, maxY: number
  if (finalSegs.length > 0) {
    const b = computeBBox(finalSegs, 0, 1)
    minX = b.minX; maxX = b.maxX; minY = b.minY; maxY = b.maxY
  } else {
    const b = computeTextHatchBBox(workerTexts, workerHatches, scale)
    if (!b) {
      console.warn('[CAD V2] 세그먼트도 쓸 만한 텍스트/해치 좌표도 없음 → 종료')
      return 0
    }
    minX = b.minX; maxX = b.maxX; minY = b.minY; maxY = b.maxY
    console.log(`[CAD V2] 세그먼트 0개 — 텍스트/해치 기준 bbox 사용 (${workerTexts.length}개 텍스트, ${workerHatches.length}개 해치)`)
  }

  // 8. autoScale
  const spanX = maxX - minX || 1
  const spanY = maxY - minY || 1
  const maxSpan = Math.max(spanX, spanY)
  let autoScale = 1
  if (maxSpan > MAX_CANVAS_SPAN_PX) {
    autoScale = MAX_CANVAS_SPAN_PX / maxSpan
    for (const s of finalSegs) {
      s.x1 *= autoScale; s.y1 *= autoScale; s.dx *= autoScale; s.dy *= autoScale
    }
    minX *= autoScale; maxX *= autoScale; minY *= autoScale; maxY *= autoScale
  }
  console.log(`[CAD V2] autoScale=${autoScale.toFixed(6)}, bbox=(${minX.toFixed(0)},${minY.toFixed(0)})~(${maxX.toFixed(0)},${maxY.toFixed(0)})`)

  // 9. Viewport centering
  const cam = editor.getCamera()
  const vp = editor.getViewportScreenBounds()
  const vpCenterX = (vp.width / 2) / cam.z - cam.x
  const vpCenterY = (vp.height / 2) / cam.z - cam.y
  const offsetX = (minX + maxX) / 2 - vpCenterX
  const offsetY = (minY + maxY) / 2 - vpCenterY

  // 10. Fingerprint
  const entityCount = polylines.length
  const fingerprint = dxfFingerprint(fileName, fileSize, entityCount)

  // 10-1. 텍스트 + 해치 좌표 변환 (viewport 또는 세그먼트 bbox 기반 필터)
  const textScale = scale * autoScale
  let txLoX: number, txHiX: number, txLoY: number, txHiY: number
  if (effectiveClip) {
    // Viewport 기반 텍스트/해치 필터 경계 (세그먼트와 동일 좌표계)
    txLoX = effectiveClip.minX * scale * autoScale
    txLoY = -effectiveClip.maxY * scale * autoScale  // Y-flip
    txHiX = effectiveClip.maxX * scale * autoScale
    txHiY = -effectiveClip.minY * scale * autoScale  // Y-flip
  } else {
    // 폴백: 세그먼트 bbox + 10% 패딩
    const bboxPad = Math.max(maxX - minX, maxY - minY) * 0.1
    txLoX = minX - bboxPad; txHiX = maxX + bboxPad
    txLoY = minY - bboxPad; txHiY = maxY + bboxPad
  }
  const minTextPx = computeMinTextHeight(Math.max(maxX - minX, maxY - minY))
  const pxTexts = transformWorkerTexts(workerTexts, textScale, minTextPx)
    .filter(t => t.x >= txLoX && t.x <= txHiX && t.y >= txLoY && t.y <= txHiY)
  console.log(`[CAD V2] ${pxTexts.length}개 텍스트 변환 (${effectiveClip ? 'viewport' : 'bbox'} 필터)`)
  noteDrop('도면 범위 밖 텍스트', workerTexts.length - pxTexts.length)
  const pxHatches = transformWorkerHatches(workerHatches, textScale)
    .filter(h => h.cx >= txLoX && h.cx <= txHiX && h.cy >= txLoY && h.cy <= txHiY)
  console.log(`[CAD V2] ${pxHatches.length}개 해치 변환`)
  noteDrop('도면 범위 밖 해치', workerHatches.length - pxHatches.length)

  // 임포트에서 못 가져온 것들을 한 자리에 모아 찍는다.
  lastImportReport = report
  const dropEntries = Object.entries(report).sort((a, b) => b[1] - a[1])
  if (dropEntries.length > 0) {
    const total = dropEntries.reduce((sum, [, n]) => sum + n, 0)
    console.warn(`[CAD V2] ⚠ 못 가져온 것 ${total}건 (${dropEntries.length}가지 사유) — 자세히:`)
    for (const [reason, n] of dropEntries) console.warn(`    ${n}건 — ${reason}`)
  } else {
    console.log('[CAD V2] 못 가져온 것 없음')
  }

  // ── 100+ segs: DxfGroup 모드 ──
  if (finalSegs.length >= 100) {
    // DEFPOINTS 레이어 필터링 (AutoCAD 비출력 시스템 레이어)
    const preFilterCount = finalSegs.length
    finalSegs = finalSegs.filter(s => (s.layer || '0').toUpperCase() !== 'DEFPOINTS')
    if (finalSegs.length < preFilterCount) {
      console.log(`[CAD V2] DEFPOINTS 필터: ${preFilterCount} → ${finalSegs.length} (${preFilterCount - finalSegs.length}개 제거)`)
    }

    // Linetype 패턴 → dasharray 변환 맵 구축
    const linetypeDashMap = new Map<string, string>()
    for (const lt of workerLinetypes) {
      // DXF 패턴: 양수=dash, 음수=gap, 0=dot → SVG stroke-dasharray (절대값, dot→0.5)
      const scaledPattern = lt.pattern.map(v => {
        const abs = Math.abs(v) * workerLtscale * scale
        return abs < 0.1 ? 0.5 * workerLtscale * scale : abs  // dot 최소 크기
      })
      if (scaledPattern.length > 0) {
        linetypeDashMap.set(lt.name.toUpperCase(), scaledPattern.map(v => v.toFixed(1)).join(' '))
      }
    }
    console.log(`[CAD V2] ${linetypeDashMap.size}개 linetype dasharray 맵`)

    // 레이어+색상+선종류별 그루핑
    const layerGroups = new Map<string, { layer: string; color?: string; linetypeName?: string; dashArray?: string; segs: RawSeg[] }>()
    for (const s of finalSegs) {
      const layer = s.layer || '0'
      const ltKey = s.linetypeName || ''
      // lineweight/transparency 도 키에 — shape 는 sliceSegs[0] 값 하나만 쓰므로
      // 섞여 있으면 나머지가 전부 첫 값으로 덮인다.
      const key = `${layer}\0${s.color || ''}\0${ltKey}\0${s.lineweight ?? ''}\0${s.transparency ?? ''}`
      let g = layerGroups.get(key)
      if (!g) {
        g = {
          layer, color: s.color,
          linetypeName: s.linetypeName,
          dashArray: s.linetypeName ? linetypeDashMap.get(s.linetypeName.toUpperCase()) : undefined,
          segs: [],
        }
        layerGroups.set(key, g)
      }
      g.segs.push(s)
    }

    // 레이어별 세그먼트 수 로그
    //
    // **레이어 이름으로 합쳐서** 찍는다. 위 그루핑 키는 색/선종류/굵기/투명도까지
    // 포함하므로 한 레이어가 여러 그룹으로 쪼개진다. 그룹을 그대로 나열하면
    // `-S1:2166, -S1:1542` 처럼 같은 이름이 반복돼 중복 버그처럼 읽힌다.
    const segsByLayer = new Map<string, number>()
    for (const { layer, segs } of layerGroups.values()) {
      segsByLayer.set(layer, (segsByLayer.get(layer) ?? 0) + segs.length)
    }
    const layerCounts = [...segsByLayer].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l}:${n}`)
    console.log(`[CAD V2] 레이어별 세그먼트 (${segsByLayer.size}개 레이어 / ${layerGroups.size}개 스타일 그룹): ` +
      `${layerCounts.slice(0, 15).join(', ')}${layerCounts.length > 15 ? ` (+${layerCounts.length - 15}개)` : ''}`)

    const assignedTextIdx = new Set<number>()
    const assignedHatchIdx = new Set<number>()

    // 텍스트 공간 인덱스 구축 (O(n²) 방지 — 그리드 기반 조회)
    const TEXT_CELL = 100  // 100px 셀
    const textGrid = new Map<string, number[]>()
    pxTexts.forEach((t, idx) => {
      const cx = Math.floor(t.x / TEXT_CELL)
      const cy = Math.floor(t.y / TEXT_CELL)
      const key = `${cx},${cy}`
      let bucket = textGrid.get(key)
      if (!bucket) { bucket = []; textGrid.set(key, bucket) }
      bucket.push(idx)
    })

    const groupShapes: unknown[] = []
    // 한 덩어리가 이것보다 크면 "선택 단위"로 너무 크다고 보고 격자로 더 쪼갠다.
    const MAX_SEGS_PER_CLUSTER = 400
    for (const [, { layer, color: groupColor, dashArray: groupDashArray, segs }] of layerGroups) {
      // 레이어가 커도 연결성으로 쪼갠다.
      //
      // 예전엔 800개 넘으면 통째로 한 클러스터, 2000개 넘으면 4x4 격자였다.
      // clusterConnectedSegs 가 O(n²) 이던 시절의 상한인데, 지금은 격자 해싱 +
      // union-find 라 O(n) 이다. 상한만 남아서 클릭 한 번에 레이어 절반이
      // 통째로 잡히고 있었다 — 도면에서 선 하나를 못 고르는 체감의 원인.
      let clusters = clusterConnectedSegs(segs)
      // 연결성으로도 안 쪼개지는 덩어리(밀집 버킷이 MAX_BUCKET 을 넘어 건너뛰어진
      // 경우 등)는 격자로 한 번 더.
      if (clusters.some(c => c.length > MAX_SEGS_PER_CLUSTER)) {
        clusters = clusters.flatMap(c =>
          c.length > MAX_SEGS_PER_CLUSTER ? partitionSegsByGrid(c, MAX_SEGS_PER_CLUSTER / 4) : [c])
      }

      for (const cluster of clusters) {
        let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity
        for (const s of cluster) {
          gMinX = Math.min(gMinX, s.x1, s.x1 + s.dx)
          gMinY = Math.min(gMinY, s.y1, s.y1 + s.dy)
          gMaxX = Math.max(gMaxX, s.x1, s.x1 + s.dx)
          gMaxY = Math.max(gMaxY, s.y1, s.y1 + s.dy)
        }

        // 점/잔해 필터 (보수적: 멀티페이지 도면에서 정상 요소 보존)
        const clusterW = gMaxX - gMinX
        const clusterH = gMaxY - gMinY
        const clusterMaxDim = Math.max(clusterW, clusterH)

        // 1) 양쪽 10px 미만 → 점/기호
        if (clusterW < 10 && clusterH < 10) continue

        // 2) 총 경로 길이 계산
        let totalPathLen = 0
        for (const s of cluster) totalPathLen += Math.hypot(s.dx, s.dy)
        if (totalPathLen < 20) continue

        // 3) 세그먼트 적고 아주 작은 클러스터만 제거
        if (cluster.length <= 3 && clusterMaxDim < 15) continue
        if (cluster.length <= 5 && clusterMaxDim < 10) continue

        // 그리드 기반 텍스트 수집 (O(1) 셀 조회, O(n²) → O(k))
        const margin = 20
        const localTexts: Array<{ x: number; y: number; t: string; h: number; r?: number; c?: string; ap?: number; mw?: number; f?: string }> = []
        const cxMin = Math.floor((gMinX - margin) / TEXT_CELL)
        const cxMax = Math.floor((gMaxX + margin) / TEXT_CELL)
        const cyMin = Math.floor((gMinY - margin) / TEXT_CELL)
        const cyMax = Math.floor((gMaxY + margin) / TEXT_CELL)
        for (let cx = cxMin; cx <= cxMax; cx++) {
          for (let cy = cyMin; cy <= cyMax; cy++) {
            const bucket = textGrid.get(`${cx},${cy}`)
            if (!bucket) continue
            for (const idx of bucket) {
              if (assignedTextIdx.has(idx)) continue
              const t = pxTexts[idx]
              if ((t.layer || '0') !== layer) continue
              if (t.x >= gMinX - margin && t.x <= gMaxX + margin &&
                  t.y >= gMinY - margin && t.y <= gMaxY + margin) {
                localTexts.push({
                  x: +(t.x - gMinX).toFixed(1),
                  y: +(t.y - gMinY).toFixed(1),
                  t: t.text,
                  h: +t.height.toFixed(1),
                  r: t.rotation,
                  c: t.color,
                  ap: t.attachPt,
                  mw: t.width ? +t.width.toFixed(1) : undefined,
                  f: t.fontName,
                })
                assignedTextIdx.add(idx)
              }
            }
          }
        }

        // 해치 수집: 이 클러스터 바운딩박스 내의 HATCH
        const hatchMargin = 50
        const localHatches: Array<{ d: string; p: string; s: number; a: number; sp?: number; n?: number; dl?: Array<{ a: number; s: number; d?: number[] }>; c?: string; f?: number; dim?: number }> = []
        for (let hi = 0; hi < pxHatches.length; hi++) {
          if (assignedHatchIdx.has(hi)) continue
          const hh = pxHatches[hi]
          if (hh.cx >= gMinX - hatchMargin && hh.cx <= gMaxX + hatchMargin &&
              hh.cy >= gMinY - hatchMargin && hh.cy <= gMaxY + hatchMargin) {
            let hMinX2 = Infinity, hMaxX2 = -Infinity, hMinY2 = Infinity, hMaxY2 = -Infinity
            const localPath = hh.pathData.replace(
              /([MLZ])([\d.e+-]+),([\d.e+-]+)/g,
              (_, cmd: string, xStr: string, yStr: string) => {
                const lx = parseFloat(xStr) - gMinX
                const ly = parseFloat(yStr) - gMinY
                hMinX2 = Math.min(hMinX2, lx); hMaxX2 = Math.max(hMaxX2, lx)
                hMinY2 = Math.min(hMinY2, ly); hMaxY2 = Math.max(hMaxY2, ly)
                return `${cmd}${lx.toFixed(1)},${ly.toFixed(1)}`
              }
            )
            const hDim = Math.max(hMaxX2 - hMinX2, hMaxY2 - hMinY2, 10)
            localHatches.push({
              d: localPath, ...packHatchPattern(hh), c: hh.color,
              f: hh.solidFill ? 1 : 0,
              dim: +hDim.toFixed(1),
            })
            assignedHatchIdx.add(hi)
          }
        }

        // 바운딩박스 패딩: 경계 선 stroke가 잘리지 않도록 2px 여유
        const BBOX_PAD = 2
        gMinX -= BBOX_PAD; gMinY -= BBOX_PAD
        gMaxX += BBOX_PAD; gMaxY += BBOX_PAD

        const gx = gMinX - offsetX
        const gy = gMinY - offsetY
        const w = Math.max(gMaxX - gMinX, 1)
        const h = Math.max(gMaxY - gMinY, 1)

        // shape당 최대 3000 세그먼트 → 초과 시 여러 shape로 분할 (데이터 손실 없음)
        const maxSegsPerShape = 3000
        const sliceCount = Math.ceil(cluster.length / maxSegsPerShape)
        for (let si = 0; si < sliceCount; si++) {
          const sliceSegs = cluster.slice(si * maxSegsPerShape, (si + 1) * maxSegsPerShape)

          const pathData = sliceSegs.map((s) => {
            const x1 = s.x1 - gMinX
            const y1 = s.y1 - gMinY
            const x2 = x1 + s.dx
            const y2 = y1 + s.dy
            return `M${x1.toFixed(1)},${y1.toFixed(1)}L${x2.toFixed(1)},${y2.toFixed(1)}`
          }).join('')

          // Lineweight: per-segment → group 대표값 (첫 번째 세그먼트)
          const segLw = sliceSegs[0]?.lineweight
          groupShapes.push({
            id: createShapeId(),
            type: 'dxfgroup',
            x: gx, y: gy,
            props: {
              w, h, pathData, thickness: thickness * autoScale * 0.3, segCount: sliceSegs.length,
              // 텍스트/해치는 첫 번째 슬라이스에만 포함 (중복 방지)
              textsJson: si === 0 && localTexts.length > 0 ? packTextsJson(localTexts) : '',
              hatchesJson: si === 0 && localHatches.length > 0 ? JSON.stringify(localHatches) : '',
            },
            meta: {
              dxfFingerprint: fingerprint,
              dxfLayer: layer,
              ...(groupColor ? { dxfColor: groupColor } : {}),
              ...(groupDashArray ? { dxfDashArray: groupDashArray } : {}),
              ...(segLw !== undefined && segLw > 0 ? { dxfLineweight: segLw } : {}),
              ...(sliceSegs[0]?.transparency ? { dxfTransparency: sliceSegs[0].transparency } : {}),
            },
          })
        }
      }
    }

    console.log(`[CAD V2] ${groupShapes.length}개 DxfGroup 생성 (텍스트 ${assignedTextIdx.size}/${pxTexts.length}, 해치 ${assignedHatchIdx.size}/${pxHatches.length}개 할당)`)

    // 고립 텍스트 → 독립 DxfGroup shape
    const orphanShapes = buildOrphanTextShapes(pxTexts, assignedTextIdx, offsetX, offsetY, fingerprint)
    groupShapes.push(...orphanShapes)

    // 배치 생성 (배치 간 yield로 UI 멈춤 방지)
    const BATCH = 200
    for (let i = 0; i < groupShapes.length; i += BATCH) {
      editor.createShapes(groupShapes.slice(i, i + BATCH) as never)
      if (i + BATCH < groupShapes.length) {
        await new Promise(r => setTimeout(r, 0)) // yield to event loop
      }
    }

    // zoomToFit (select spread 대신 zoomToFit 사용 — spread 5000개는 V8 성능 문제)
    //
    // 전엔 setTimeout(300ms) 으로 걸어두고 "그때도 같은 페이지인가" 를 검사했다.
    // 멀티 레이아웃 임포트는 그 300ms 안에 다음 페이지를 만들고 넘어가 버려서,
    // 마지막 페이지 말고는 전부 검사에 걸려 건너뛰었다 — 열어보면 카메라가
    // 원점에 있어서 빈 화면처럼 보인다. 이제는 await 라서 루프가 기다린다.
    const zoomPageId1 = editor.getCurrentPageId()
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    try {
      if (editor.getCurrentPageId() === zoomPageId1) {
        editor.zoomToFit({ animation: { duration: 0 } })
      }
    } catch { /* ignore */ }

    const totalMs = ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0).toFixed(0)
    console.log(`[CAD V2] ✅ 완료: ${finalSegs.length}개 seg → ${groupShapes.length}개 shape (${totalMs}ms)`)
    return finalSegs.length
  }

  // ── 100개 미만: 개별 wall shape ──
  const scaledThickness = thickness * autoScale
  const shapes = finalSegs.map((s) => ({
    id: createShapeId(),
    type: 'wall' as const,
    x: s.x1 - offsetX,
    y: s.y1 - offsetY,
    props: { x2: s.dx, y2: s.dy, thickness: scaledThickness },
    meta: {
      dxfFingerprint: fingerprint,
      ...(s.layer ? { dxfLayer: s.layer } : {}),
      ...(s.color ? { dxfColor: s.color } : {}),
    },
  }))

  // 텍스트/해치도 같이 만든다.
  // 예전엔 이 분기가 wall shape 만 만들고 pxTexts/pxHatches 를 쳐다보지도
  // 않았다 — 세그먼트 100개 미만 도면(작은 평면도, 상세도)은 글자와 해치가
  // 통째로 사라졌다. 100개 이상 경로에선 DxfGroup 이 담아주던 것들이다.
  // 여기선 묶어줄 DxfGroup 이 없으니 전부 "고립" 취급해서 독립 shape 로 만든다.
  const extraShapes = [
    ...buildOrphanTextShapes(pxTexts, new Set<number>(), offsetX, offsetY, fingerprint),
    ...buildOrphanHatchShapes(pxHatches, new Set<number>(), offsetX, offsetY, fingerprint),
  ]

  const allShapes = [...shapes, ...extraShapes]
  if (allShapes.length) {
    editor.createShapes(allShapes as never)
    const zoomPageId2 = editor.getCurrentPageId()
    setTimeout(() => {
      try {
        if (editor.getCurrentPageId() === zoomPageId2) {
          editor.selectAll()
          editor.zoomToFit({ animation: { duration: 0 } })
          editor.selectNone()
        }
      } catch { /* ignore */ }
    }, 300)
  }

  const totalMs = ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0).toFixed(0)
  console.log(`[CAD V2] ✅ 완료: ${shapes.length}개 wall shape + ${extraShapes.length}개 텍스트/해치 shape (${totalMs}ms)`)
  // 선이 있으면 선 개수를 돌려준다 (예전과 동일). 선이 하나도 없는
  // 텍스트/해치 전용 도면은 대신 만든 shape 수를 돌려준다 — 0 을 주면
  // 호출한 쪽이 "표시할 도형이 없습니다" 를 띄워서, 글자가 캔버스에
  // 올라갔는데도 실패한 것처럼 보인다.
  return shapes.length || extraShapes.length
}

// importDxf() 레거시 함수 제거됨 — ImportPanel + CadPreview(V2) 플로우로 대체
