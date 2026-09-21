import DxfParser from 'dxf-parser'
// dxf npm package no longer used — replaced by custom dxf-fast-worker
import { convertDwgToDxf, CDN_WASM_BASE } from 'dwgdxf'
import { createShapeId, type Editor } from 'tldraw'
import { getScaleConfig } from './scaleConfig'
import { getDefaultWallThicknessMm } from './settings'

const MAX_SEGMENTS = 100_000

type Seg = { x1: number; y1: number; x2: number; y2: number }

// ── ACI (AutoCAD Color Index) → hex  (full 256-color table) ──
// Standard colors 1-9, then 10-249 computed from HSL hue/saturation/lightness bands, 250-255 grays.
// Reference: AutoCAD Color Index (ACI) specification.

const ACI_TO_HEX: Record<number, string> = {
  // ── Standard colors 1-9 ──
  1: '#ff0000', 2: '#ffff00', 3: '#00ff00', 4: '#00ffff',
  5: '#0000ff', 6: '#ff00ff', 7: '#000000', 8: '#808080', 9: '#c0c0c0',
  // ── Main hues (10-249): 24 hue groups × 5 shades each + 2 tint rows ──
  10: '#ff0000', 11: '#ff7f7f', 12: '#cc0000', 13: '#cc6666', 14: '#990000',
  15: '#994c4c', 16: '#7f0000', 17: '#7f3f3f', 18: '#4c0000', 19: '#4c2626',
  20: '#ff3f00', 21: '#ff9f7f', 22: '#cc3200', 23: '#cc7f66', 24: '#992600',
  25: '#995f4c', 26: '#7f1f00', 27: '#7f4f3f', 28: '#4c1300', 29: '#4c2f26',
  30: '#ff7f00', 31: '#ffbf7f', 32: '#cc6500', 33: '#cc9966', 34: '#994c00',
  35: '#99724c', 36: '#7f3f00', 37: '#7f5f3f', 38: '#4c2600', 39: '#4c3926',
  40: '#ffbf00', 41: '#ffdf7f', 42: '#cc9900', 43: '#ccb266', 44: '#997200',
  45: '#99854c', 46: '#7f5f00', 47: '#7f6f3f', 48: '#4c3900', 49: '#4c4226',
  50: '#ffff00', 51: '#ffff7f', 52: '#cccc00', 53: '#cccc66', 54: '#999900',
  55: '#99994c', 56: '#7f7f00', 57: '#7f7f3f', 58: '#4c4c00', 59: '#4c4c26',
  60: '#bfff00', 61: '#dfff7f', 62: '#99cc00', 63: '#b2cc66', 64: '#729900',
  65: '#85994c', 66: '#5f7f00', 67: '#6f7f3f', 68: '#394c00', 69: '#424c26',
  70: '#7fff00', 71: '#bfff7f', 72: '#65cc00', 73: '#99cc66', 74: '#4c9900',
  75: '#72994c', 76: '#3f7f00', 77: '#5f7f3f', 78: '#264c00', 79: '#394c26',
  80: '#3fff00', 81: '#9fff7f', 82: '#32cc00', 83: '#7fcc66', 84: '#269900',
  85: '#5f994c', 86: '#1f7f00', 87: '#4f7f3f', 88: '#134c00', 89: '#2f4c26',
  90: '#00ff00', 91: '#7fff7f', 92: '#00cc00', 93: '#66cc66', 94: '#009900',
  95: '#4c994c', 96: '#007f00', 97: '#3f7f3f', 98: '#004c00', 99: '#264c26',
  100: '#00ff3f', 101: '#7fff9f', 102: '#00cc32', 103: '#66cc7f', 104: '#009926',
  105: '#4c995f', 106: '#007f1f', 107: '#3f7f4f', 108: '#004c13', 109: '#264c2f',
  110: '#00ff7f', 111: '#7fffbf', 112: '#00cc65', 113: '#66cc99', 114: '#00994c',
  115: '#4c9972', 116: '#007f3f', 117: '#3f7f5f', 118: '#004c26', 119: '#264c39',
  120: '#00ffbf', 121: '#7fffdf', 122: '#00cc99', 123: '#66ccb2', 124: '#009972',
  125: '#4c9985', 126: '#007f5f', 127: '#3f7f6f', 128: '#004c39', 129: '#264c42',
  130: '#00ffff', 131: '#7fffff', 132: '#00cccc', 133: '#66cccc', 134: '#009999',
  135: '#4c9999', 136: '#007f7f', 137: '#3f7f7f', 138: '#004c4c', 139: '#264c4c',
  140: '#00bfff', 141: '#7fdfff', 142: '#0099cc', 143: '#66b2cc', 144: '#007299',
  145: '#4c8599', 146: '#005f7f', 147: '#3f6f7f', 148: '#00394c', 149: '#26424c',
  150: '#007fff', 151: '#7fbfff', 152: '#0065cc', 153: '#6699cc', 154: '#004c99',
  155: '#4c7299', 156: '#003f7f', 157: '#3f5f7f', 158: '#00264c', 159: '#26394c',
  160: '#003fff', 161: '#7f9fff', 162: '#0032cc', 163: '#667fcc', 164: '#002699',
  165: '#4c5f99', 166: '#001f7f', 167: '#3f4f7f', 168: '#00134c', 169: '#262f4c',
  170: '#0000ff', 171: '#7f7fff', 172: '#0000cc', 173: '#6666cc', 174: '#000099',
  175: '#4c4c99', 176: '#00007f', 177: '#3f3f7f', 178: '#00004c', 179: '#26264c',
  180: '#3f00ff', 181: '#9f7fff', 182: '#3200cc', 183: '#7f66cc', 184: '#260099',
  185: '#5f4c99', 186: '#1f007f', 187: '#4f3f7f', 188: '#13004c', 189: '#2f264c',
  190: '#7f00ff', 191: '#bf7fff', 192: '#6500cc', 193: '#9966cc', 194: '#4c0099',
  195: '#724c99', 196: '#3f007f', 197: '#5f3f7f', 198: '#26004c', 199: '#39264c',
  200: '#bf00ff', 201: '#df7fff', 202: '#9900cc', 203: '#b266cc', 204: '#720099',
  205: '#854c99', 206: '#5f007f', 207: '#6f3f7f', 208: '#39004c', 209: '#42264c',
  210: '#ff00ff', 211: '#ff7fff', 212: '#cc00cc', 213: '#cc66cc', 214: '#990099',
  215: '#994c99', 216: '#7f007f', 217: '#7f3f7f', 218: '#4c004c', 219: '#4c264c',
  220: '#ff00bf', 221: '#ff7fdf', 222: '#cc0099', 223: '#cc66b2', 224: '#990072',
  225: '#994c85', 226: '#7f005f', 227: '#7f3f6f', 228: '#4c0039', 229: '#4c2642',
  230: '#ff007f', 231: '#ff7fbf', 232: '#cc0065', 233: '#cc6699', 234: '#99004c',
  235: '#994c72', 236: '#7f003f', 237: '#7f3f5f', 238: '#4c0026', 239: '#4c2639',
  240: '#ff003f', 241: '#ff7f9f', 242: '#cc0032', 243: '#cc667f', 244: '#990026',
  245: '#994c5f', 246: '#7f001f', 247: '#7f3f4f', 248: '#4c0013', 249: '#4c262f',
  // ── Grays 250-255 ──
  250: '#333333', 251: '#505050', 252: '#696969', 253: '#808080',
  254: '#bebebe', 255: '#ffffff',
}

function aciToHex(index: number): string | undefined {
  return ACI_TO_HEX[index]
}

function trueColorToHex(c: number): string {
  const r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
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
export type DxfSeg = Seg & { layer?: string; lineweight?: number; color?: string }

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
                let sa = edge.startAngle ?? 0, ea = edge.endAngle ?? (2 * Math.PI)
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
        let sa = edge.startAngle ?? 0, ea = edge.endAngle ?? (2 * Math.PI)
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

/** DXF 특수문자 코드(%%X) → 유니코드 변환 */
function decodeDxfSpecialChars(text: string): string {
  return text
    .replace(/%%[Pp]/g, '±')    // plus-minus
    .replace(/%%[Dd]/g, '°')    // degree
    .replace(/%%[Cc]/g, '∅')    // diameter
    .replace(/%%[Uu]/g, '')     // underline toggle (삭제)
    .replace(/%%[Oo]/g, '')     // overline toggle (삭제)
    .replace(/%%%/g, '%')       // literal percent
    .replace(/%%(\d{3})/g, (_, code) => String.fromCharCode(parseInt(code))) // %%nnn → char
}

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
  return reverseDoubleEncodingIfNeeded(text)
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
 * DXF raw text에서 HATCH 엔티티를 직접 파싱.
 * dxf-parser v1.x는 HATCH 핸들러가 없어서 완전히 스킵하기 때문에
 * group code 기반으로 직접 추출.
 */
function parseRawHatches(
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
    let numBoundaryPaths = 0

    // HATCH 헤더 파싱 (91코드 = boundary path 수 전까지)
    while (i < pairs.length && pairs[i].code !== 91 && !(pairs[i].code === 0 && pairs[i].value !== 'HATCH')) {
      const c = pairs[i].code, v = pairs[i].value
      if (c === 8) layer = v
      else if (c === 62) colorIndex = parseInt(v) || 0
      else if (c === 420) trueColor = parseInt(v) || 0
      else if (c === 2) patternName = v
      else if (c === 41) patternScale = parseFloat(v) || 1
      else if (c === 52) patternAngle = parseFloat(v) || 0
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
        // Polyline boundary
        const hasBulge = (i < pairs.length && pairs[i].code === 72) ? (parseInt(pairs[i++].value) || 0) : 0
        const isClosed = (i < pairs.length && pairs[i].code === 73) ? (parseInt(pairs[i++].value) || 0) : 1
        const numVerts = (i < pairs.length && pairs[i].code === 93) ? (parseInt(pairs[i++].value) || 0) : 0

        const verts: Array<{ x: number; y: number }> = []
        for (let v = 0; v < numVerts && i < pairs.length; v++) {
          let vx = 0, vy = 0
          if (pairs[i].code === 10) { vx = parseFloat(pairs[i].value) || 0; i++ }
          if (i < pairs.length && pairs[i].code === 20) { vy = parseFloat(pairs[i].value) || 0; i++ }
          // skip bulge (42) if present
          if (hasBulge && i < pairs.length && pairs[i].code === 42) i++
          verts.push({ x: vx, y: vy })
          sumX += vx; sumY += vy; ptCount++
        }

        if (verts.length >= 2) {
          const parts = [`M${verts[0].x},${verts[0].y}`]
          for (let v = 1; v < verts.length; v++) {
            parts.push(`L${verts[v].x},${verts[v].y}`)
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
            while (i < pairs.length && pairs[i].code !== 72 && pairs[i].code !== 92 && !(pairs[i].code === 0)) {
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
            while (i < pairs.length && pairs[i].code !== 72 && pairs[i].code !== 92 && !(pairs[i].code === 0)) {
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
            while (i < pairs.length && pairs[i].code !== 72 && pairs[i].code !== 92 && !(pairs[i].code === 0)) {
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
            while (i < pairs.length && pairs[i].code !== 72 && pairs[i].code !== 92 && pairs[i].code !== 0) {
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
            while (i < pairs.length && pairs[i].code !== 72 && pairs[i].code !== 92 && pairs[i].code !== 0) {
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

    // HATCH 뒤쪽 나머지 (pattern def lines 등) 스킵: 다음 entity(code=0)까지
    while (i < pairs.length && pairs[i].code !== 0) i++

    if (svgParts.length > 0 && ptCount > 0) {
      hatches.push({
        pathData: svgParts.join(''),
        patternName: patternName.toUpperCase(),
        patternScale,
        patternAngle,
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

const STRUCTURAL_KEYWORDS = /wall|window|win(?!ter)|door|stair|column|beam|slab|elev|건축|벽|창문|문/i

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
  console.log(`[CAD Import] 세그먼트: ${segs.length}`)
  const texts = collectTextsWithBlocks(
    dxf.entities as unknown as Array<Record<string, unknown>>,
    layerDefs, blocks,
  )
  console.log(`[CAD Import] 텍스트: ${texts.length}`)

  ;(notify?.onInfo ?? notify?.onSuccess)?.(
    `해치 패턴 추출 중... (세그먼트 ${segs.length.toLocaleString()}개)`,
  )
  await yieldUI()

  // dxf-parser는 HATCH를 파싱하지 않으므로 raw text에서 직접 추출
  const hatches = parseRawHatches(text, layerDefs)
  console.log(`[CAD Import] 해치: ${hatches.length}`)
  if (!segs.length && !texts.length) {
    console.error('[CAD Import] 세그먼트/텍스트 0개 → 실패')
    notify?.onError?.('DXF에서 도형 데이터를 찾지 못했습니다.')
    return null
  }
  if (segs.length >= MAX_SEGMENTS) {
    notify?.onInfo?.(`세그먼트 ${MAX_SEGMENTS.toLocaleString()}개 제한으로 일부만 로드됩니다.`)
  }

  // 레이어별 세그먼트 수 집계
  const layerMap = new Map<string, number>()
  for (const s of segs) {
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
    totalSegments: segs.length,
    unitToMm,
    _segs: segs,
    _texts: texts,
    _hatches: hatches,
  }
}

/** 연결된 세그먼트끼리 클러스터링 (Union-Find)
 *  endpoint가 SNAP_TOL 이내이면 같은 그룹으로 판정.
 *  방/벽 단위로 개별 선택 가능하도록 분리. */
function clusterConnectedSegs(segs: RawSeg[]): RawSeg[][] {
  if (segs.length <= 1) return [segs]

  const SNAP_TOL = 5 // px 단위 endpoint 근접 허용치
  const MAX_BUCKET = 30 // 버킷당 최대 세그먼트 수 (O(n²) 방지)
  const TIME_BUDGET = 2000 // 최대 2초
  const n = segs.length
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()

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
  let timedOut = false

  for (let i = 0; i < n; i++) {
    // 시간 예산 체크 (매 500개마다)
    if ((i & 511) === 0 && i > 0) {
      const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0
      if (elapsed > TIME_BUDGET) { timedOut = true; break }
    }

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

  if (timedOut) {
    console.warn(`[CAD] clusterConnectedSegs 시간 초과 (${n}개 세그먼트, ${((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0).toFixed(0)}ms) → 단일 그룹 반환`)
    return [segs]
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
type RawSeg = { x1: number; y1: number; dx: number; dy: number; layer?: string; lineweight?: number; color?: string }

function mergeDxfSegments(segs: RawSeg[]): RawSeg[] {
  // 각도(3°) + 수직거리(10px) + 색상 기준으로 버킷팅
  const buckets = new Map<string, RawSeg[]>()
  for (const s of segs) {
    const len = Math.hypot(s.dx, s.dy)
    if (len < 1) continue
    let ang = (Math.atan2(s.dy, s.dx) * 180) / Math.PI
    if (ang < 0) ang += 180
    if (ang >= 180) ang -= 180
    const nx = -s.dy / len, ny = s.dx / len
    const perp = nx * s.x1 + ny * s.y1
    const key = `${Math.round(ang / 3)}|${Math.round(perp / 10)}|${s.color || ''}`
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
      out.push({ x1: sx, y1: sy, dx: ex - sx, dy: ey - sy, layer: first.layer, color: first.color })
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

/** 선택된 레이어의 세그먼트만 에디터에 벽으로 추가 */
export function commitCadImport(
  editor: Editor,
  result: CadParseResult,
  selectedLayers: Set<string>,
): number {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  console.log(`[CAD Commit] 시작: segs=${result._segs.length}, texts=${result._texts.length}, hatches=${result._hatches.length}, unitToMm=${result.unitToMm}, selectedLayers=${[...selectedLayers].join(',')}`)
  const scale = getScaleConfig(editor).pxPerMm * result.unitToMm
  const thickness = getDefaultWallThicknessMm() * getScaleConfig(editor).pxPerMm
  console.log(`[CAD Commit] scale=${scale} (pxPerMm=${getScaleConfig(editor).pxPerMm}, unitToMm=${result.unitToMm})`)

  // 1단계: 스케일 적용 + 좌표 변환
  const rawSegsAll = result._segs
    .filter((s) => selectedLayers.has(s.layer || '0'))
    .map((s) => {
      const x1 = s.x1 * scale
      const y1 = -s.y1 * scale
      const dx = (s.x2 - s.x1) * scale
      const dy = -(s.y2 - s.y1) * scale
      return { x1, y1, dx, dy, layer: s.layer, lineweight: s.lineweight, color: s.color }
    })

  console.log(`[CAD Commit] rawSegsAll (레이어 필터 후): ${rawSegsAll.length}, scale=${scale}`)

  // 좌표 sanity 필터: 블록 변환에서 오버플로우된 극단 좌표(|coord| > 1e8) 제거
  const COORD_LIMIT = 1e8 // 100km in mm — 건축 도면에서 절대 초과 불가
  const saneSegs = rawSegsAll.filter((s) => {
    const x2 = s.x1 + s.dx, y2 = s.y1 + s.dy
    return Math.abs(s.x1) < COORD_LIMIT && Math.abs(s.y1) < COORD_LIMIT &&
           Math.abs(x2) < COORD_LIMIT && Math.abs(y2) < COORD_LIMIT &&
           isFinite(s.x1) && isFinite(s.y1) && isFinite(s.dx) && isFinite(s.dy)
  })
  if (saneSegs.length < rawSegsAll.length) {
    console.warn(`[CAD Commit] 좌표 sanity 필터: ${rawSegsAll.length} → ${saneSegs.length} (${rawSegsAll.length - saneSegs.length}개 극단좌표 제거)`)
  }

  // 1px 이상 필터 (너무 작은 세그먼트 제거) — 단, 전부 제거되면 원본 사용
  let rawSegs = saneSegs.filter((s) => Math.hypot(s.dx, s.dy) >= 1)
  if (!rawSegs.length && saneSegs.length > 0) {
    // 스케일이 너무 작아서 모든 세그먼트가 1px 미만 → 0.1px 기준으로 재시도
    rawSegs = saneSegs.filter((s) => Math.hypot(s.dx, s.dy) >= 0.1)
    if (!rawSegs.length) rawSegs = saneSegs.filter((s) => Math.hypot(s.dx, s.dy) > 1e-6)  // 0-length 제외
    if (!rawSegs.length) rawSegs = saneSegs // 그래도 없으면 전부 사용
    console.warn(`[CAD Commit] Scale too small: all ${saneSegs.length} segs < 1px, relaxed filter → ${rawSegs.length} segs`)
  }
  console.log(`[CAD Commit] rawSegs (sanity+1px 필터 후): ${rawSegs.length}`)

  if (!rawSegs.length) { console.warn('[CAD Commit] 세그먼트 0개 → return 0'); return 0 }

  // 2단계: 동일선상 세그먼트 병합 (shape 수 30-60% 감소)
  const tMerge = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const merged = mergeDxfSegments(rawSegs)
  console.log(`[CAD Commit] mergeDxfSegments: ${rawSegs.length} → ${merged.length} (${((typeof performance !== 'undefined' ? performance.now() : Date.now()) - tMerge).toFixed(0)}ms)`)

  // merged가 비어있으면 rawSegs를 직접 사용 (병합 실패 방어)
  const finalSegs = merged.length > 0 ? merged : rawSegs

  // 3단계: 바운딩박스 중심을 캔버스 원점(0,0)으로 정규화
  // DXF 좌표계가 원점에서 멀면 shapes가 캔버스 밖에 생성되는 문제 방지
  // 아웃라이어(극단값) 제거를 위해 퍼센타일 기반 바운딩박스 사용
  const allXCoords: number[] = []
  const allYCoords: number[] = []
  for (const s of finalSegs) {
    allXCoords.push(s.x1, s.x1 + s.dx)
    allYCoords.push(s.y1, s.y1 + s.dy)
  }
  allXCoords.sort((a, b) => a - b)
  allYCoords.sort((a, b) => a - b)

  const n = allXCoords.length
  if (n === 0) { console.warn('[CAD Commit] 좌표 없음'); return 0 }

  // P2~P98 퍼센타일로 아웃라이어 제거 (좌표가 1000개 이상일 때)
  const pLo = n > 1000 ? Math.floor(n * 0.02) : 0
  const pHi = n > 1000 ? Math.ceil(n * 0.98) - 1 : n - 1
  let minX = allXCoords[pLo]
  let maxX = allXCoords[pHi]
  let minY = allYCoords[pLo]
  let maxY = allYCoords[pHi]

  console.log(`[CAD Commit] bbox (P2~P98): x=${minX.toFixed(0)}~${maxX.toFixed(0)}, y=${minY.toFixed(0)}~${maxY.toFixed(0)}, total coords=${n}`)
  if (n > 1000) {
    console.log(`[CAD Commit] raw bbox: x=${allXCoords[0].toFixed(0)}~${allXCoords[n-1].toFixed(0)}, y=${allYCoords[0].toFixed(0)}~${allYCoords[n-1].toFixed(0)}`)
  }

  // NaN/Infinity 방어
  if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) {
    console.error('[CAD Commit] Invalid bounding box:', { minX, maxX, minY, maxY })
    return 0
  }

  // 4단계: 도면이 캔버스에 보이도록 자동 스케일 적용
  // tldraw 최소 줌(10%)에서 뷰포트에 맞으려면 shapes가 ~15000px 이내여야 함
  const MAX_CANVAS_SPAN = 12000
  const spanX = maxX - minX
  const spanY = maxY - minY
  const maxSpan = Math.max(spanX, spanY)
  let autoScale = 1
  if (maxSpan > MAX_CANVAS_SPAN) {
    autoScale = MAX_CANVAS_SPAN / maxSpan
    console.log(`[CAD Commit] 자동 축소: span=${maxSpan.toFixed(0)}px > ${MAX_CANVAS_SPAN} → autoScale=${autoScale.toFixed(4)}`)
    // 모든 세그먼트 좌표에 autoScale 적용
    for (const s of finalSegs) {
      s.x1 *= autoScale
      s.y1 *= autoScale
      s.dx *= autoScale
      s.dy *= autoScale
    }
    minX *= autoScale
    maxX *= autoScale
    minY *= autoScale
    maxY *= autoScale
  }

  // 현재 뷰포트 중심의 page 좌표를 구해서, shapes를 거기에 배치
  const cam = editor.getCamera()
  const vp = editor.getViewportScreenBounds()
  const vpCenterX = (vp.width / 2) / cam.z - cam.x
  const vpCenterY = (vp.height / 2) / cam.z - cam.y

  // 바운딩박스 중심 → 뷰포트 중심으로 오프셋
  const offsetX = (minX + maxX) / 2 - vpCenterX
  const offsetY = (minY + maxY) / 2 - vpCenterY

  // ── 텍스트 좌표 변환 (DXF → px, Y flip) + 자동 스케일 ──
  const textScale = scale * autoScale
  type PxText = { x: number; y: number; text: string; height: number; rotation?: number; color?: string; layer?: string }
  const pxTexts: PxText[] = result._texts
    .filter(t => selectedLayers.has(t.layer || '0') &&
      Math.abs(t.x) < COORD_LIMIT && Math.abs(t.y) < COORD_LIMIT &&
      isFinite(t.x) && isFinite(t.y))
    .map(t => ({
      x: t.x * textScale,
      y: -t.y * textScale,
      text: t.text,
      height: Math.max(t.height * textScale, 4),
      rotation: t.rotation,
      color: t.color,
      layer: t.layer,
    }))

  // 텍스트도 바운딩박스에 포함 (단, 기존 bbox 범위 ×2 내의 텍스트만)
  const bboxRangeX = (maxX - minX) || 1
  const bboxRangeY = (maxY - minY) || 1
  for (const t of pxTexts) {
    // 아웃라이어 텍스트는 bbox에 포함하지 않음
    if (t.x < minX - bboxRangeX || t.x > maxX + bboxRangeX) continue
    if (t.y < minY - bboxRangeY || t.y > maxY + bboxRangeY) continue
    minX = Math.min(minX, t.x)
    minY = Math.min(minY, t.y - t.height)
    maxX = Math.max(maxX, t.x + t.text.length * t.height * 0.6)
    maxY = Math.max(maxY, t.y)
  }

  // ── HATCH 좌표 변환 (DXF → px, Y flip, SVG path 좌표 변환) ──
  type PxHatch = { pathData: string; patternName: string; patternScale: number; patternAngle: number; color?: string; layer?: string; cx: number; cy: number }
  const pxHatches: PxHatch[] = (result._hatches ?? [])
    .filter(h => selectedLayers.has(h.layer || '0') &&
      Math.abs(h.cx) < COORD_LIMIT && Math.abs(h.cy) < COORD_LIMIT &&
      isFinite(h.cx) && isFinite(h.cy))
    .map(h => {
      // SVG path 좌표 변환: scale + Y flip + autoScale (toFixed로 scientific notation 방지)
      const transformedPath = h.pathData.replace(
        /([ML])([\d.e+-]+),([\d.e+-]+)/g,
        (_, cmd, xStr, yStr) => {
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
        color: h.color,
        layer: h.layer,
        cx: h.cx * textScale,
        cy: -h.cy * textScale,
      }
    })

  // ── 100+ segments: 레이어별 DxfGroup shape로 묶기 (React 컴포넌트 수 대폭 감소) ──
  if (finalSegs.length >= 100) {
    console.log(`[CAD Commit] DxfGroup 모드: ${finalSegs.length}개 세그먼트, autoScale=${autoScale.toFixed(6)}, offset=(${offsetX.toFixed(1)}, ${offsetY.toFixed(1)})`)
    // 좌표 샘플 출력 (첫 3개)
    for (let si = 0; si < Math.min(3, finalSegs.length); si++) {
      const s = finalSegs[si]
      console.log(`[CAD Commit] seg[${si}]: (${s.x1.toFixed(1)},${s.y1.toFixed(1)}) → (${(s.x1+s.dx).toFixed(1)},${(s.y1+s.dy).toFixed(1)}) layer=${s.layer}`)
    }
    // 레이어별 그루핑
    const layerGroups = new Map<string, RawSeg[]>()
    for (const s of finalSegs) {
      const key = s.layer || '0'
      let g = layerGroups.get(key)
      if (!g) { g = []; layerGroups.set(key, g) }
      g.push(s)
    }
    console.log(`[CAD Commit] 레이어 그룹: ${layerGroups.size}개 레이어`)

    // 배정 추적용 Set
    const assignedTextIdx = new Set<number>()
    const assignedHatchIdx = new Set<number>()

    const groupShapes: unknown[] = []
    let totalClusters = 0
    // MAX_SHAPES = 500 — tldraw 렌더 성능 보호 (현재 미사용, 추후 활용)
    const tCluster = typeof performance !== 'undefined' ? performance.now() : Date.now()
    for (const [layer, segs] of layerGroups) {
      // 세그먼트가 너무 많으면 클러스터링 생략 (전체를 하나의 shape로)
      const clusters = segs.length > 3000
        ? [segs] // 레이어 전체를 하나의 클러스터로
        : clusterConnectedSegs(segs)
      totalClusters += clusters.length

      for (const cluster of clusters) {
        // 그룹 바운딩박스 계산
        let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity
        for (const s of cluster) {
          gMinX = Math.min(gMinX, s.x1, s.x1 + s.dx)
          gMinY = Math.min(gMinY, s.y1, s.y1 + s.dy)
          gMaxX = Math.max(gMaxX, s.x1, s.x1 + s.dx)
          gMaxY = Math.max(gMaxY, s.y1, s.y1 + s.dy)
        }

        // 이 클러스터 바운딩박스 내의 텍스트 수집 (여유 margin 포함)
        const margin = 20
        const localTexts: Array<{ x: number; y: number; t: string; h: number; r?: number; c?: string }> = []
        pxTexts.forEach((t, idx) => {
          if (assignedTextIdx.has(idx)) return
          if ((t.layer || '0') !== layer) return
          if (t.x >= gMinX - margin && t.x <= gMaxX + margin &&
              t.y >= gMinY - margin && t.y <= gMaxY + margin) {
            localTexts.push({
              x: +(t.x - gMinX).toFixed(1),
              y: +(t.y - gMinY).toFixed(1),
              t: t.text,
              h: +t.height.toFixed(1),
              r: t.rotation,
              c: t.color,
            })
            assignedTextIdx.add(idx)
          }
        })

        // 이 클러스터 바운딩박스 내의 HATCH 수집
        const localHatches: Array<{ d: string; p: string; s: number; a: number; c?: string }> = []
        pxHatches.forEach((h, idx) => {
          if (assignedHatchIdx.has(idx)) return
          if (h.cx >= gMinX - margin && h.cx <= gMaxX + margin &&
              h.cy >= gMinY - margin && h.cy <= gMaxY + margin) {
            // pathData를 shape-local 좌표로 변환
            const localPath = h.pathData.replace(
              /([ML])([\d.e+-]+),([\d.e+-]+)/g,
              (_, cmd, xStr, yStr) => {
                const lx = parseFloat(xStr) - gMinX
                const ly = parseFloat(yStr) - gMinY
                return `${cmd}${lx.toFixed(1)},${ly.toFixed(1)}`
              }
            )
            localHatches.push({
              d: localPath,
              p: h.patternName,
              s: h.patternScale,
              a: h.patternAngle,
              c: h.color,
            })
            assignedHatchIdx.add(idx)
          }
        })

        const gx = gMinX - offsetX
        const gy = gMinY - offsetY
        const w = Math.max(gMaxX - gMinX, 1)
        const h = Math.max(gMaxY - gMinY, 1)

        // 세그먼트를 shape-local 좌표로 변환 후 SVG path 생성
        const pathData = cluster.map(s => {
          const x1 = s.x1 - gMinX
          const y1 = s.y1 - gMinY
          const x2 = x1 + s.dx
          const y2 = y1 + s.dy
          return `M${x1.toFixed(1)},${y1.toFixed(1)}L${x2.toFixed(1)},${y2.toFixed(1)}`
        }).join('')

        const firstSeg = cluster[0]

        groupShapes.push({
          id: createShapeId(),
          type: 'dxfgroup',
          x: gx,
          y: gy,
          props: {
            w, h, pathData, thickness: thickness * autoScale * 0.3, segCount: cluster.length,
            textsJson: localTexts.length ? JSON.stringify(localTexts) : '',
            hatchesJson: localHatches.length ? JSON.stringify(localHatches) : '',
          },
          meta: {
            dxfFingerprint: result.fingerprint,
            dxfLayer: layer,
            ...(firstSeg.lineweight ? { dxfLineweight: firstSeg.lineweight } : {}),
            ...(firstSeg.color ? { dxfColor: firstSeg.color } : {}),
          },
        })
      }
    }

    // 미배정 텍스트 → 레이어별 텍스트 전용 shape 생성
    const orphanTexts = pxTexts.filter((_, i) => !assignedTextIdx.has(i))
    if (orphanTexts.length > 0) {
      const textsByLayer = new Map<string, PxText[]>()
      for (const t of orphanTexts) {
        const key = t.layer || '0'
        let arr = textsByLayer.get(key)
        if (!arr) { arr = []; textsByLayer.set(key, arr) }
        arr.push(t)
      }
      for (const [layer, texts] of textsByLayer) {
        let tMinX = Infinity, tMinY = Infinity, tMaxX = -Infinity, tMaxY = -Infinity
        for (const t of texts) {
          tMinX = Math.min(tMinX, t.x)
          tMinY = Math.min(tMinY, t.y - t.height)
          tMaxX = Math.max(tMaxX, t.x + t.text.length * t.height * 0.6)
          tMaxY = Math.max(tMaxY, t.y + t.height)
        }
        const w = Math.max(tMaxX - tMinX, 1)
        const h = Math.max(tMaxY - tMinY, 1)
        const localTexts = texts.map(t => ({
          x: +(t.x - tMinX).toFixed(1),
          y: +(t.y - tMinY).toFixed(1),
          t: t.text,
          h: +t.height.toFixed(1),
          r: t.rotation,
          c: t.color,
        }))
        groupShapes.push({
          id: createShapeId(),
          type: 'dxfgroup',
          x: tMinX - offsetX,
          y: tMinY - offsetY,
          props: { w, h, pathData: '', thickness: 0, segCount: 0, textsJson: JSON.stringify(localTexts), hatchesJson: '' },
          meta: { dxfFingerprint: result.fingerprint, dxfLayer: layer },
        })
      }
    }

    const clusterMs = ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - tCluster).toFixed(0)
    console.log(`[CAD Commit] 클러스터링 완료: ${totalClusters}개 클러스터 → ${groupShapes.length}개 DxfGroup (${clusterMs}ms)`)
    // 좌표 범위 검증
    let invalidShapes = 0
    for (const s of groupShapes) {
      const sh = s as { x: number; y: number; props?: { w?: number; h?: number; pathData?: string } }
      if (!isFinite(sh.x) || !isFinite(sh.y)) invalidShapes++
    }
    if (invalidShapes > 0) console.error(`[CAD Commit] ⚠️ ${invalidShapes}개 shapes에 NaN/Infinity 좌표!`)
    // 첫 3개 shape 샘플
    for (let si = 0; si < Math.min(3, groupShapes.length); si++) {
      const sh = groupShapes[si] as { x: number; y: number; props?: { w?: number; h?: number; pathData?: string; segCount?: number } }
      const pathLen = sh.props?.pathData?.length ?? 0
      console.log(`[CAD Commit] shape[${si}]: x=${sh.x?.toFixed(1)}, y=${sh.y?.toFixed(1)}, w=${sh.props?.w?.toFixed(1)}, h=${sh.props?.h?.toFixed(1)}, pathLen=${pathLen}, segs=${sh.props?.segCount}`)
    }

    const tCreate = typeof performance !== 'undefined' ? performance.now() : Date.now()
    try {
      // 한 번에 1000개씩 분할 생성 (tldraw 렌더 부하 방지)
      const BATCH = 1000
      for (let i = 0; i < groupShapes.length; i += BATCH) {
        const batch = groupShapes.slice(i, i + BATCH)
        editor.createShapes(batch as never)
      }
      const createMs = ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - tCreate).toFixed(0)
      const pageShapes = editor.getCurrentPageShapes().length
      console.log(`[CAD Commit] ✅ createShapes 완료: ${groupShapes.length}개 shape (${createMs}ms), page에 ${pageShapes}개 shape 존재`)
    } catch (err) {
      console.error('[CAD Commit] ❌ createShapes 에러:', err)
      throw err
    }

    // shapes 생성 직후 zoomToFit (tldraw 렌더 완료 대기)
    setTimeout(() => {
      try {
        editor.selectAll()
        editor.zoomToFit({ animation: { duration: 0 } })
        editor.selectNone()
        console.log('[CAD Commit] zoomToFit 완료')
      } catch (e) { console.warn('[CAD Commit] zoomToFit 에러:', e) }
    }, 300)

    const totalMs = ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0).toFixed(0)
    console.log(`[CAD Commit] ✅ 전체 완료: ${finalSegs.length}개 seg → ${groupShapes.length}개 shape (${totalMs}ms)`)
    return finalSegs.length
  }

  // ── 100개 미만: 기존 방식 (개별 wall shape) ──
  const scaledThickness = thickness * autoScale
  const shapes = finalSegs.map((s) => ({
    id: createShapeId(),
    type: 'wall' as const,
    x: s.x1 - offsetX,
    y: s.y1 - offsetY,
    props: { x2: s.dx, y2: s.dy, thickness: scaledThickness },
    meta: {
      dxfFingerprint: result.fingerprint,
      ...(s.layer ? { dxfLayer: s.layer } : {}),
      ...(s.lineweight ? { dxfLineweight: s.lineweight } : {}),
      ...(s.color ? { dxfColor: s.color } : {}),
    },
  }))

  if (shapes.length) {
    editor.createShapes(shapes as never)

    setTimeout(() => {
      try {
        editor.selectAll()
        editor.zoomToFit({ animation: { duration: 0 } })
        editor.selectNone()
      } catch { /* ignore */ }
    }, 300)
  }
  return shapes.length
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
import type { PolylineData, TextData, HatchData, WorkerOut } from './dxf-fast-worker'

function runFastWorker(
  dxfText: string,
  selectedLayers: string[],
  onProgress?: (msg: string) => void,
): Promise<{ polylines: PolylineData[]; insUnits: number; texts: TextData[]; hatches: HatchData[] }> {
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

    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const msg = e.data
      if (msg.type === 'progress') {
        onProgress?.(`${msg.phase} (${msg.percent}%)`)
      } else if (msg.type === 'result') {
        clearTimeout(timeout)
        worker.terminate()
        resolve({ polylines: msg.polylines, insUnits: msg.insUnits, texts: msg.texts || [], hatches: msg.hatches || [] })
      } else if (msg.type === 'error') {
        clearTimeout(timeout)
        worker.terminate()
        reject(new Error(msg.message))
      }
    }
    worker.onerror = (err) => {
      clearTimeout(timeout)
      worker.terminate()
      reject(new Error(`Worker 에러: ${err.message}`))
    }

    worker.postMessage({ type: 'parse', dxfText, selectedLayers })
  })
}

export async function commitCadImportV2(
  editor: Editor,
  dxfText: string,
  selectedLayers: Set<string>,
  fileName: string,
  fileSize: number,
  _isDwg: boolean,
  onProgress?: (msg: string) => void,
): Promise<number> {
  const t0 = performance.now()
  const layerArr = [...selectedLayers]
  console.log(`[CAD V2] 시작: selectedLayers=${layerArr.join(',')}`)

  // 1. Worker에서 DXF 파싱 (메인스레드 블로킹 없음, 실패 시 동기 fallback)
  onProgress?.('도면 파싱 중...')
  let polylines: PolylineData[]
  let insUnits: number
  let workerTexts: TextData[] = []
  let workerHatches: HatchData[] = []
  try {
    const result = await runFastWorker(dxfText, layerArr, onProgress)
    polylines = result.polylines
    insUnits = result.insUnits
    workerTexts = result.texts || []
    workerHatches = result.hatches || []
  } catch (workerErr) {
    console.error(`[CAD V2] Worker 실패:`, workerErr)
    // 동기 fallback 제거 — 메인 스레드에서 100MB+ 파일 파싱 시 브라우저 완전 멈춤
    // 대신 에러 알림 후 빈 결과 반환
    onProgress?.('파싱 실패 — 다시 시도해주세요')
    polylines = []
    insUnits = 4
    return 0
  }
  const parseMs = (performance.now() - t0).toFixed(0)
  console.log(`[CAD V2] 파싱 완료: ${polylines.length}개 폴리라인, ${workerHatches.length}개 해치 (${parseMs}ms)`)

  // 2. 유닛 스케일
  const unit = insUnits
  const unitToMm = unit === 1 ? 25.4 : unit === 2 ? 304.8 : unit === 5 ? 10 : unit === 6 ? 1000 : 1
  const scale = getScaleConfig(editor).pxPerMm * unitToMm
  const thickness = getDefaultWallThicknessMm() * getScaleConfig(editor).pxPerMm
  console.log(`[CAD V2] scale=${scale}, unitToMm=${unitToMm}`)

  // 3. 폴리라인 → RawSeg 변환 (Y flip + 스케일, 레이어 필터는 Worker에서 이미 적용됨)
  onProgress?.('좌표 변환 중...')
  const rawSegsAll: RawSeg[] = []
  for (const pl of polylines) {
    const verts = pl.vertices
    if (!verts || verts.length < 2) continue

    // ACI colorNumber → hex
    const color = pl.colorNumber >= 0 ? aciToHex(pl.colorNumber) : undefined

    for (let i = 0; i < verts.length - 1; i++) {
      const x1 = verts[i][0] * scale
      const y1 = -verts[i][1] * scale // Y flip
      const x2 = verts[i + 1][0] * scale
      const y2 = -verts[i + 1][1] * scale
      rawSegsAll.push({
        x1, y1,
        dx: x2 - x1,
        dy: y2 - y1,
        layer: pl.layer,
        color,
      })
    }
  }
  console.log(`[CAD V2] rawSegsAll: ${rawSegsAll.length}개 세그먼트`)

  if (rawSegsAll.length === 0) {
    console.warn('[CAD V2] 세그먼트 0개 → 종료')
    return 0
  }

  // 4. 좌표 sanity 필터
  const COORD_LIMIT = 1e8
  const saneSegs = rawSegsAll.filter((s) => {
    const x2 = s.x1 + s.dx, y2 = s.y1 + s.dy
    return Math.abs(s.x1) < COORD_LIMIT && Math.abs(s.y1) < COORD_LIMIT &&
           Math.abs(x2) < COORD_LIMIT && Math.abs(y2) < COORD_LIMIT &&
           isFinite(s.x1) && isFinite(s.y1) && isFinite(s.dx) && isFinite(s.dy)
  })

  // 5. 1px 필터 (0.1px fallback)
  let rawSegs = saneSegs.filter((s) => Math.hypot(s.dx, s.dy) >= 1)
  if (!rawSegs.length && saneSegs.length > 0) {
    rawSegs = saneSegs.filter((s) => Math.hypot(s.dx, s.dy) >= 0.1)
    if (!rawSegs.length) rawSegs = saneSegs.filter((s) => Math.hypot(s.dx, s.dy) > 1e-6)  // 0-length 제외
    if (!rawSegs.length) rawSegs = saneSegs  // 최후 수단
  }
  console.log(`[CAD V2] 필터 후: ${rawSegs.length}개 (sanity: ${saneSegs.length}, 1px: ${rawSegs.length})`)

  // 6. 동일선상 병합
  onProgress?.('세그먼트 병합 중...')
  const merged = mergeDxfSegments(rawSegs)
  let finalSegs = merged.length > 0 ? merged : rawSegs
  console.log(`[CAD V2] 병합: ${rawSegs.length} → ${finalSegs.length}`)

  // 6-1. 좌표 반올림 + 중복 세그먼트 제거 (메모리 절감)
  const dedupSet = new Set<string>()
  const dedupSegs: RawSeg[] = []
  for (const s of finalSegs) {
    const rx1 = Math.round(s.x1), ry1 = Math.round(s.y1)
    const rx2 = Math.round(s.x1 + s.dx), ry2 = Math.round(s.y1 + s.dy)
    if (rx1 === rx2 && ry1 === ry2) continue // 반올림 후 점
    const key = `${rx1},${ry1},${rx2},${ry2}`
    if (dedupSet.has(key)) continue
    dedupSet.add(key)
    dedupSegs.push({ x1: rx1, y1: ry1, dx: rx2 - rx1, dy: ry2 - ry1, layer: s.layer, color: s.color })
  }
  console.log(`[CAD V2] 중복제거: ${finalSegs.length} → ${dedupSegs.length}`)
  finalSegs = dedupSegs

  // 6-2. 하드 캡: 최대 50,000 세그먼트 (메모리 보호)
  const MAX_FINAL_SEGS = 50_000
  if (finalSegs.length > MAX_FINAL_SEGS) {
    // 균등 샘플링으로 줄이기
    const step = finalSegs.length / MAX_FINAL_SEGS
    const sampled: RawSeg[] = []
    for (let i = 0; i < MAX_FINAL_SEGS; i++) {
      sampled.push(finalSegs[Math.floor(i * step)])
    }
    console.log(`[CAD V2] 세그먼트 캡: ${finalSegs.length} → ${MAX_FINAL_SEGS}`)
    finalSegs = sampled
  }

  // 7. 아웃라이어(점) 제거 — O(N) quickselect 기반
  function nthElement(arr: Float64Array, k: number): number {
    // Floyd-Rivest quickselect — O(N) average
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

  function computeBBox(segs: RawSeg[], pLoPct: number, pHiPct: number) {
    const cnt = segs.length * 2
    const xs = new Float64Array(cnt), ys = new Float64Array(cnt)
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]
      xs[i * 2] = s.x1; xs[i * 2 + 1] = s.x1 + s.dx
      ys[i * 2] = s.y1; ys[i * 2 + 1] = s.y1 + s.dy
    }
    if (cnt <= 500 || (pLoPct === 0 && pHiPct === 1)) {
      // 전체 범위: min/max로 충분 (O(N))
      let mnX = xs[0], mxX = xs[0], mnY = ys[0], mxY = ys[0]
      for (let i = 1; i < cnt; i++) {
        if (xs[i] < mnX) mnX = xs[i]; if (xs[i] > mxX) mxX = xs[i]
        if (ys[i] < mnY) mnY = ys[i]; if (ys[i] > mxY) mxY = ys[i]
      }
      return { minX: mnX, maxX: mxX, minY: mnY, maxY: mxY, n: cnt }
    }
    const lo = Math.floor(cnt * pLoPct), hi = Math.min(Math.ceil(cnt * pHiPct) - 1, cnt - 1)
    // quickselect로 O(N)에 퍼센타일 찾기
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

  function filterOutliers(segs: RawSeg[], pLo: number, pHi: number, padMul: number): RawSeg[] {
    const { minX, maxX, minY, maxY, n } = computeBBox(segs, pLo, pHi)
    if (n < 200) return segs
    const padX = (maxX - minX || 1) * padMul, padY = (maxY - minY || 1) * padMul
    const filtered = segs.filter((s) => {
      const sx1 = s.x1, sy1 = s.y1, sx2 = s.x1 + s.dx, sy2 = s.y1 + s.dy
      return sx1 >= minX - padX && sx1 <= maxX + padX &&
             sy1 >= minY - padY && sy1 <= maxY + padY &&
             sx2 >= minX - padX && sx2 <= maxX + padX &&
             sy2 >= minY - padY && sy2 <= maxY + padY
    })
    return filtered.length >= segs.length * 0.5 ? filtered : segs
  }

  // 1차 + 2차 아웃라이어 제거
  const before1 = finalSegs.length
  finalSegs = filterOutliers(finalSegs, 0.05, 0.95, 0.5)
  if (finalSegs.length < before1) console.log(`[CAD V2] 아웃라이어 1차: ${before1} → ${finalSegs.length}개`)
  const before2 = finalSegs.length
  finalSegs = filterOutliers(finalSegs, 0.05, 0.95, 0.3)
  if (finalSegs.length < before2) console.log(`[CAD V2] 아웃라이어 2차: ${before2} → ${finalSegs.length}개`)

  // 최종 bbox (O(N) min/max)
  const { minX: _minX, maxX: _maxX, minY: _minY, maxY: _maxY } = computeBBox(finalSegs, 0, 1)
  let minX = _minX, maxX = _maxX, minY = _minY, maxY = _maxY

  // 8. autoScale
  const MAX_CANVAS_SPAN = 12000
  const spanX = maxX - minX || 1
  const spanY = maxY - minY || 1
  const maxSpan = Math.max(spanX, spanY)
  let autoScale = 1
  if (maxSpan > MAX_CANVAS_SPAN) {
    autoScale = MAX_CANVAS_SPAN / maxSpan
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

  // 10-1. Worker 텍스트 → px 좌표 변환 (Y flip + scale + autoScale)
  const textScale = scale * autoScale
  type PxText = { x: number; y: number; text: string; height: number; rotation?: number; color?: string; layer?: string }
  const pxTexts: PxText[] = workerTexts
    .filter(t => Math.abs(t.x) < COORD_LIMIT && Math.abs(t.y) < COORD_LIMIT && isFinite(t.x) && isFinite(t.y))
    .map(t => ({
      x: t.x * textScale,
      y: -t.y * textScale,
      text: t.text,
      height: Math.max(t.height * textScale, 4),
      rotation: t.rotation,
      color: t.colorNumber >= 0 ? aciToHex(t.colorNumber) : undefined,
      layer: t.layer,
    }))
  console.log(`[CAD V2] ${pxTexts.length}개 텍스트 변환`)

  // ── HATCH 좌표 변환 (DXF → px, Y flip, SVG path 좌표 변환) ──
  type PxHatch = { pathData: string; patternName: string; patternScale: number; patternAngle: number; color?: string; layer: string; cx: number; cy: number }
  const pxHatches: PxHatch[] = workerHatches
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
        color: h.color,
        layer: h.layer,
        cx: h.cx * textScale,
        cy: -h.cy * textScale,
      }
    })
  console.log(`[CAD V2] ${pxHatches.length}개 해치 변환`)

  // ── 100+ segs: DxfGroup 모드 ──
  if (finalSegs.length >= 100) {
    // 레이어+색상별 그루핑 (같은 색상끼리 묶어야 렌더링 시 색 적용 가능)
    const layerGroups = new Map<string, { layer: string; color?: string; segs: RawSeg[] }>()
    for (const s of finalSegs) {
      const layer = s.layer || '0'
      const key = `${layer}\0${s.color || ''}`
      let g = layerGroups.get(key)
      if (!g) { g = { layer, color: s.color, segs: [] }; layerGroups.set(key, g) }
      g.segs.push(s)
    }

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

    // 점 필터에 사용할 전체 도면 스팬 (autoScale 적용 후 px 기준)
    const drawingSpan = Math.max(maxX - minX, maxY - minY) || 1

    const groupShapes: unknown[] = []
    for (const [, { layer, color: groupColor, segs }] of layerGroups) {
      // 대형 레이어는 클러스터링 생략 (O(n²) 방지)
      const clusters = segs.length > 800 ? [segs] : clusterConnectedSegs(segs)

      for (const cluster of clusters) {
        let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity
        for (const s of cluster) {
          gMinX = Math.min(gMinX, s.x1, s.x1 + s.dx)
          gMinY = Math.min(gMinY, s.y1, s.y1 + s.dy)
          gMaxX = Math.max(gMaxX, s.x1, s.x1 + s.dx)
          gMaxY = Math.max(gMaxY, s.y1, s.y1 + s.dy)
        }

        // 점/잔해 방지: 공격적 필터링
        const clusterW = gMaxX - gMinX
        const clusterH = gMaxY - gMinY
        const clusterMaxDim = Math.max(clusterW, clusterH)
        const clusterMinDim = Math.min(clusterW, clusterH)
        const clusterArea = clusterW * clusterH

        // 1) 양쪽 25px 미만 → 무조건 점/기호
        if (clusterW < 25 && clusterH < 25) continue

        // 2) 최대 치수가 전체 도면의 0.5% 미만 → 기호/마커/제목블록 잔해
        if (clusterMaxDim < drawingSpan * 0.005) continue

        // 3) 총 경로 길이 계산 — 너무 짧으면 시각적 노이즈
        let totalPathLen = 0
        for (const s of cluster) totalPathLen += Math.hypot(s.dx, s.dy)
        if (totalPathLen < 50) continue

        // 4) 세그먼트 적고 작은 클러스터 → 기호 잔해
        if (cluster.length <= 5 && clusterMaxDim < 80) continue
        if (cluster.length <= 10 && clusterMaxDim < 60) continue
        if (cluster.length <= 20 && clusterMaxDim < 40) continue
        if (cluster.length <= 30 && clusterMaxDim < 30) continue

        // 5) 한쪽이 극단적으로 얇은 클러스터 (점선/작은 틱 마크)
        if (clusterMinDim < 5 && cluster.length <= 10) continue

        // 6) 면적 기반: 전체 도면 면적의 0.01% 미만 + 세그먼트 50개 이하 → 잔해
        const drawingArea = (maxX - minX) * (maxY - minY) || 1
        if (clusterArea < drawingArea * 0.0001 && cluster.length <= 50) continue

        // 7) 경로 길이 대비 면적이 너무 작은 고립 기호 (작은 테이블 셀, 마커 등)
        if (clusterArea < 5000 && totalPathLen < 200 && cluster.length <= 30) continue

        // 그리드 기반 텍스트 수집 (O(1) 셀 조회, O(n²) → O(k))
        const margin = 20
        const localTexts: Array<{ x: number; y: number; t: string; h: number; r?: number; c?: string }> = []
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
                })
                assignedTextIdx.add(idx)
              }
            }
          }
        }

        // 해치 수집: 이 클러스터 바운딩박스 내의 HATCH
        const hatchMargin = 50
        const localHatches: Array<{ d: string; p: string; s: number; a: number; c?: string }> = []
        for (let hi = 0; hi < pxHatches.length; hi++) {
          if (assignedHatchIdx.has(hi)) continue
          const hh = pxHatches[hi]
          if (hh.cx >= gMinX - hatchMargin && hh.cx <= gMaxX + hatchMargin &&
              hh.cy >= gMinY - hatchMargin && hh.cy <= gMaxY + hatchMargin) {
            const localPath = hh.pathData.replace(
              /([MLZ])([\d.e+-]+),([\d.e+-]+)/g,
              (_, cmd: string, xStr: string, yStr: string) => {
                const lx = parseFloat(xStr) - gMinX
                const ly = parseFloat(yStr) - gMinY
                return `${cmd}${lx.toFixed(1)},${ly.toFixed(1)}`
              }
            )
            localHatches.push({
              d: localPath, p: hh.patternName, s: hh.patternScale, a: hh.patternAngle, c: hh.color,
            })
            assignedHatchIdx.add(hi)
          }
        }

        const gx = gMinX - offsetX
        const gy = gMinY - offsetY
        const w = Math.max(gMaxX - gMinX, 1)
        const h = Math.max(gMaxY - gMinY, 1)

        // shape당 최대 3000 세그먼트 (pathData 크기 제한 → 메모리 절감)
        const maxSegsPerShape = 3000
        const clusterSlice = cluster.length > maxSegsPerShape ? cluster.slice(0, maxSegsPerShape) : cluster

        const pathData = clusterSlice.map((s) => {
          const x1 = (s.x1 - gMinX) | 0
          const y1 = (s.y1 - gMinY) | 0
          const x2 = (x1 + s.dx) | 0
          const y2 = (y1 + s.dy) | 0
          return `M${x1},${y1}L${x2},${y2}`
        }).join('')

        groupShapes.push({
          id: createShapeId(),
          type: 'dxfgroup',
          x: gx, y: gy,
          props: {
            w, h, pathData, thickness: thickness * autoScale * 0.3, segCount: clusterSlice.length,
            textsJson: localTexts.length > 0 ? JSON.stringify(localTexts) : '',
            hatchesJson: localHatches.length > 0 ? JSON.stringify(localHatches) : '',
          },
          meta: {
            dxfFingerprint: fingerprint,
            dxfLayer: layer,
            ...(groupColor ? { dxfColor: groupColor } : {}),
          },
        })
      }
    }

    console.log(`[CAD V2] ${groupShapes.length}개 DxfGroup 생성 (텍스트 ${assignedTextIdx.size}/${pxTexts.length}, 해치 ${assignedHatchIdx.size}/${pxHatches.length}개 할당)`)

    // 배치 생성 (배치 간 yield로 UI 멈춤 방지)
    const BATCH = 200
    for (let i = 0; i < groupShapes.length; i += BATCH) {
      editor.createShapes(groupShapes.slice(i, i + BATCH) as never)
      if (i + BATCH < groupShapes.length) {
        await new Promise(r => setTimeout(r, 0)) // yield to event loop
      }
    }

    // zoomToFit (select spread 대신 zoomToFit 사용 — spread 5000개는 V8 성능 문제)
    setTimeout(() => {
      try {
        editor.zoomToFit({ animation: { duration: 0 } })
      } catch { /* ignore */ }
    }, 300)

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

  if (shapes.length) {
    editor.createShapes(shapes as never)
    setTimeout(() => {
      try {
        editor.selectAll()
        editor.zoomToFit({ animation: { duration: 0 } })
        editor.selectNone()
      } catch { /* ignore */ }
    }, 300)
  }

  const totalMs = ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0).toFixed(0)
  console.log(`[CAD V2] ✅ 완료: ${shapes.length}개 wall shape (${totalMs}ms)`)
  return shapes.length
}

// importDxf() 레거시 함수 제거됨 — ImportPanel + CadPreview(V2) 플로우로 대체
