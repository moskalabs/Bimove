import DxfParser from 'dxf-parser'
import { convertDwgToDxf, CDN_WASM_BASE } from 'dwgdxf'
import { createShapeId, type Editor } from 'tldraw'
import { getScaleConfig } from './scaleConfig'
import { getDefaultWallThicknessMm } from './settings'

const MAX_SEGMENTS = 10000

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
    ['41', '1.0'], ['42', '50.0'], ['43', '0.0'],
    ['70', '0'])
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
        ['40', h.toFixed(3)], ['1', txt])
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
        ['40', toMm(10).toFixed(3)], ['1', label])
    }
  }

  put(['0', 'ENDSEC'])

  // ---- OBJECTS (minimal root dictionary, required for AC1015) ----
  const dictHandle = nextHandle()
  put(['0', 'SECTION'], ['2', 'OBJECTS'])
  put(['0', 'DICTIONARY'], ['5', dictHandle], ['100', 'AcDbDictionary'], ['281', '1'])
  put(['0', 'ENDSEC'])

  put(['0', 'EOF'])

  // Use CRLF line endings for AutoCAD compatibility
  const blob = new Blob([lines.join('\r\n')], { type: 'text/plain' })
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
    }
  }
  return segs
}

/** 현재 캔버스에 이미 임포트된 DXF 핑거프린트 목록 조회 */
function getImportedFingerprints(editor: Editor): Set<string> {
  const fps = new Set<string>()
  for (const s of editor.getCurrentPageShapes()) {
    const fp = (s.meta as Record<string, unknown>)?.dxfFingerprint
    if (typeof fp === 'string') fps.add(fp)
  }
  return fps
}

/** DWG 바이너리를 DXF 텍스트로 변환 (dwgdxf WASM) */
async function dwgToDxfText(buffer: ArrayBuffer): Promise<string> {
  const dwgBytes = new Uint8Array(buffer)
  const dxfBytes = await convertDwgToDxf(dwgBytes, { wasmBase: CDN_WASM_BASE })
  return new TextDecoder().decode(dxfBytes)
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
    const onFocus = () => {
      setTimeout(() => {
        if (!resolved) resolve(null)
        window.removeEventListener('focus', onFocus)
      }, 300)
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
      text = await dwgToDxfText(buffer)
    } catch (err) {
      notify?.onError?.(`DWG 변환 실패: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  } else {
    text = await file.text()
  }

  let dxf: ReturnType<DxfParser['parseSync']>
  try {
    dxf = new DxfParser().parseSync(text)
  } catch {
    notify?.onError?.(`${isDwg ? 'DWG에서 변환된 ' : ''}DXF 파일을 읽을 수 없습니다.`)
    return null
  }
  if (!dxf || !dxf.entities?.length) {
    notify?.onError?.('DXF에 도면 데이터가 없습니다.')
    return null
  }

  const layerTable = (dxf.tables as unknown as Record<string, unknown>)?.layer as
    { layers?: Record<string, { colorIndex?: number; color?: number; lineweight?: number }> } | undefined
  const layerDefs = layerTable?.layers ?? {}

  const segs = parseDxfSegments(
    dxf.entities as unknown as Array<Record<string, unknown>>,
    layerDefs,
  )
  if (!segs.length) {
    notify?.onError?.('DXF에서 선분(LINE/POLYLINE)을 찾지 못했습니다.')
    return null
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
  }
}

/** 동일선상(collinear) 세그먼트를 병합하여 shape 수를 줄임 */
type RawSeg = { x1: number; y1: number; dx: number; dy: number; layer?: string; lineweight?: number; color?: string }

function mergeDxfSegments(segs: RawSeg[]): RawSeg[] {
  // 각도(3°) + 수직거리(10px) 기준으로 버킷팅
  const buckets = new Map<string, RawSeg[]>()
  for (const s of segs) {
    const len = Math.hypot(s.dx, s.dy)
    if (len < 1) continue
    let ang = (Math.atan2(s.dy, s.dx) * 180) / Math.PI
    if (ang < 0) ang += 180
    if (ang >= 180) ang -= 180
    const nx = -s.dy / len, ny = s.dx / len
    const perp = nx * s.x1 + ny * s.y1
    const key = `${Math.round(ang / 3)}|${Math.round(perp / 10)}`
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

    // 모든 endpoint를 투영
    type Proj = { t: number; seg: RawSeg }
    const projs: Proj[] = []
    for (const s of group) {
      const t1 = (s.x1 - first.x1) * ux + (s.y1 - first.y1) * uy
      const t2 = t1 + s.dx * ux + s.dy * uy
      projs.push({ t: Math.min(t1, t2), seg: s })
      projs.push({ t: Math.max(t1, t2), seg: s })
    }

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
      out.push({ x1: sx, y1: sy, dx: ex - sx, dy: ey - sy, layer: first.layer })
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
  const scale = getScaleConfig(editor).pxPerMm * result.unitToMm
  const thickness = getDefaultWallThicknessMm() * getScaleConfig(editor).pxPerMm

  // 1단계: 스케일 적용 + 좌표 변환
  const rawSegs = result._segs
    .filter((s) => selectedLayers.has(s.layer || '0'))
    .map((s) => {
      const x1 = s.x1 * scale
      const y1 = -s.y1 * scale
      const dx = (s.x2 - s.x1) * scale
      const dy = -(s.y2 - s.y1) * scale
      return { x1, y1, dx, dy, layer: s.layer, lineweight: s.lineweight, color: s.color }
    })
    .filter((s) => Math.hypot(s.dx, s.dy) >= 1)

  if (!rawSegs.length) return 0

  // 2단계: 동일선상 세그먼트 병합 (shape 수 30-60% 감소)
  const merged = mergeDxfSegments(rawSegs)

  // 3단계: 바운딩박스 중심을 캔버스 원점(0,0)으로 정규화
  // DXF 좌표계가 원점에서 멀면 shapes가 캔버스 밖에 생성되는 문제 방지
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const s of merged) {
    minX = Math.min(minX, s.x1, s.x1 + s.dx)
    minY = Math.min(minY, s.y1, s.y1 + s.dy)
    maxX = Math.max(maxX, s.x1, s.x1 + s.dx)
    maxY = Math.max(maxY, s.y1, s.y1 + s.dy)
  }
  // 현재 뷰포트 중심의 page 좌표를 구해서, shapes를 거기에 배치
  // tldraw: screenX = (pageX + cam.x) * cam.z
  //       → pageX = screenX / cam.z - cam.x
  const cam = editor.getCamera()
  const vp = editor.getViewportScreenBounds()
  const vpCenterX = (vp.width / 2) / cam.z - cam.x
  const vpCenterY = (vp.height / 2) / cam.z - cam.y

  // 바운딩박스 중심 → 뷰포트 중심으로 오프셋
  const offsetX = (minX + maxX) / 2 - vpCenterX
  const offsetY = (minY + maxY) / 2 - vpCenterY

  // ── 100+ segments: 레이어별 DxfGroup shape로 묶기 (React 컴포넌트 수 대폭 감소) ──
  if (merged.length >= 100) {
    // 레이어별 그루핑
    const layerGroups = new Map<string, RawSeg[]>()
    for (const s of merged) {
      const key = s.layer || '0'
      let g = layerGroups.get(key)
      if (!g) { g = []; layerGroups.set(key, g) }
      g.push(s)
    }

    const groupShapes: unknown[] = []
    for (const [layer, segs] of layerGroups) {
      // 그룹 바운딩박스 계산
      let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity
      for (const s of segs) {
        gMinX = Math.min(gMinX, s.x1, s.x1 + s.dx)
        gMinY = Math.min(gMinY, s.y1, s.y1 + s.dy)
        gMaxX = Math.max(gMaxX, s.x1, s.x1 + s.dx)
        gMaxY = Math.max(gMaxY, s.y1, s.y1 + s.dy)
      }

      const gx = gMinX - offsetX
      const gy = gMinY - offsetY
      const w = gMaxX - gMinX
      const h = gMaxY - gMinY

      // 세그먼트를 shape-local 좌표로 변환 후 SVG path 생성
      const pathData = segs.map(s => {
        const x1 = s.x1 - gMinX
        const y1 = s.y1 - gMinY
        const x2 = x1 + s.dx
        const y2 = y1 + s.dy
        return `M${x1.toFixed(1)},${y1.toFixed(1)}L${x2.toFixed(1)},${y2.toFixed(1)}`
      }).join('')

      // 첫 세그먼트의 색상/두께를 그룹 대표로 사용
      const firstSeg = segs[0]

      groupShapes.push({
        id: createShapeId(),
        type: 'dxfgroup',
        x: gx,
        y: gy,
        props: { w, h, pathData, thickness: thickness * 0.3, segCount: segs.length },
        meta: {
          dxfFingerprint: result.fingerprint,
          dxfLayer: layer,
          ...(firstSeg.lineweight ? { dxfLineweight: firstSeg.lineweight } : {}),
          ...(firstSeg.color ? { dxfColor: firstSeg.color } : {}),
        },
      })
    }

    editor.createShapes(groupShapes as never)

    setTimeout(() => {
      try {
        editor.selectAll()
        editor.zoomToFit({ animation: { duration: 0 } })
        editor.selectNone()
      } catch { /* ignore */ }
    }, 200)

    return merged.length
  }

  // ── 100개 미만: 기존 방식 (개별 wall shape) ──
  const shapes = merged.map((s) => ({
    id: createShapeId(),
    type: 'wall' as const,
    x: s.x1 - offsetX,
    y: s.y1 - offsetY,
    props: { x2: s.dx, y2: s.dy, thickness },
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
    }, 200)
  }
  return shapes.length
}

/** 레거시: 레이어 선택 없이 전체 임포트 (이전 호환) */
export function importDxf(
  editor: Editor,
  notify?: { onSuccess?: (msg: string) => void; onError?: (msg: string) => void },
) {
  pickCadFile().then(async (file) => {
    if (!file) return
    const result = await parseCadFile(file, notify)
    if (!result) return

    // 중복 체크
    const existing = getImportedFingerprints(editor)
    if (existing.has(result.fingerprint)) {
      const proceed = confirm(
        `"${file.name}" 파일이 이미 임포트된 것 같습니다.\n그래도 다시 임포트하시겠습니까?`
      )
      if (!proceed) return
    }

    // 모든 레이어 선택
    const allLayers = new Set(result.layers.map((l) => l.name))
    const count = commitCadImport(editor, result, allLayers)
    const fmt = result.isDwg ? 'DWG' : 'DXF'
    notify?.onSuccess?.(`"${file.name}" ${fmt}를 가져왔습니다. (${count}개 벽)`)
  })
}
