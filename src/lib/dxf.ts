import DxfParser from 'dxf-parser'
import { createShapeId, type Editor } from 'tldraw'
import { getScaleConfig } from './scaleConfig'
import { getDefaultWallThicknessMm } from './settings'

const MAX_SEGMENTS = 3000

type Seg = { x1: number; y1: number; x2: number; y2: number }

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
  const x = (px: number) => toMm(px).toFixed(3)
  const y = (px: number) => (-toMm(px)).toFixed(3) // Y flip: canvas Y-down → DXF Y-up
  const lines: string[] = []
  const put = (...pairs: [number | string, number | string][]) => {
    for (const [code, val] of pairs) { lines.push(String(code)); lines.push(String(val)) }
  }

  const lineEntity = (layer: string, x1: number, y1: number, x2: number, y2: number) =>
    put(['0', 'LINE'], ['8', layer],
      ['10', x(x1)], ['20', y(y1)], ['30', '0.0'],
      ['11', x(x2)], ['21', y(y2)], ['31', '0.0'])

  // Closed LWPOLYLINE (AC1015+)
  const lwPolyline = (layer: string, pts: [number, number][]) => {
    put(['0', 'LWPOLYLINE'], ['8', layer], ['90', String(pts.length)], ['70', '1'])
    for (const [px, py] of pts) put(['10', x(px)], ['20', y(py)])
  }

  // ARC entity — angles in DXF are CCW from positive X (Y-up), so negate canvas angles
  const arcEntity = (layer: string, cx: number, cy: number, r: number, startDeg: number, endDeg: number) =>
    put(['0', 'ARC'], ['8', layer],
      ['10', x(cx)], ['20', y(cy)], ['30', '0.0'],
      ['40', toMm(r).toFixed(3)],
      ['50', startDeg.toFixed(2)], ['51', endDeg.toFixed(2)])

  // ---- HEADER ----
  put(['0', 'SECTION'], ['2', 'HEADER'],
    ['9', '$ACADVER'], ['1', 'AC1015'],
    ['9', '$INSUNITS'], ['70', '4'],
    ['0', 'ENDSEC'])

  // ---- TABLES (layer definitions) ----
  put(['0', 'SECTION'], ['2', 'TABLES'],
    ['0', 'TABLE'], ['2', 'LAYER'], ['70', String(LAYERS.length)])
  for (const [name, color, ltype] of LAYERS) {
    put(['0', 'LAYER'], ['2', name], ['70', '0'], ['62', String(color)], ['6', ltype])
  }
  put(['0', 'ENDTAB'], ['0', 'ENDSEC'])

  // ---- ENTITIES ----
  put(['0', 'SECTION'], ['2', 'ENTITIES'])

  for (const s of editor.getCurrentPageShapes()) {
    if (s.type === 'wall') {
      const p = s.props as { x2: number; y2: number; thickness: number }
      const len = Math.hypot(p.x2, p.y2)
      if (len < 1) continue
      const nx = -p.y2 / len, ny = p.x2 / len
      const h = p.thickness / 2
      // 4 corners of the wall outline in page px
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

      // Opening LINE (full width)
      lineEntity('DOOR', s.x - hw * cos, s.y - hw * sin, s.x + hw * cos, s.y + hw * sin)

      // Swing ARC: hinge at one end, radius = door width, 90° sweep
      // flipped → hinge at +end; otherwise at −end
      const [hx, hy] = p.flipped
        ? [s.x + hw * cos, s.y + hw * sin]
        : [s.x - hw * cos, s.y - hw * sin]

      // Door direction angle in DXF coords (Y flipped → negate sin)
      const doorAngleDXF = Math.atan2(-sin, cos) * 180 / Math.PI
      const baseDeg = ((p.flipped ? doorAngleDXF + 180 : doorAngleDXF) + 360) % 360
      const swing = p.swing ?? 1
      // In DXF (Y-up), canvas "up" swing (neg Y) maps to CCW
      const sweepDeg = swing * (p.flipped ? -90 : 90)
      const endDeg = (baseDeg + sweepDeg + 360) % 360
      arcEntity('DOOR', hx, hy, p.width, baseDeg, endDeg)
    } else if (s.type === 'window') {
      const p = s.props as { width: number; thickness: number }
      const a = (s as { rotation?: number }).rotation ?? 0
      const cos = Math.cos(a), sin = Math.sin(a)
      const hw = p.width / 2
      const hn = -sin, hny = cos // normal to window direction (perpendicular)
      const ht = p.thickness / 2

      // Centre span
      lineEntity('WINDOW', s.x - hw * cos, s.y - hw * sin, s.x + hw * cos, s.y + hw * sin)
      // Tick marks at each end showing thickness
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
      put(['0', 'TEXT'], ['8', 'TEXT'],
        ['10', x(s.x)], ['20', y(s.y)], ['30', '0.0'],
        ['40', h.toFixed(3)], ['1', txt])
    } else if (s.type === 'dimension') {
      const p = s.props as { x2: number; y2: number; offset: number }
      const len = Math.hypot(p.x2, p.y2)
      if (len < 1) continue
      const nx = -p.y2 / len, ny = p.x2 / len
      const off = p.offset
      const d1x = s.x + nx * off, d1y = s.y + ny * off
      const d2x = s.x + p.x2 + nx * off, d2y = s.y + p.y2 + ny * off
      // dimension bar line
      lineEntity('DIMENSION', d1x, d1y, d2x, d2y)
      // extension lines
      lineEntity('DIMENSION', s.x, s.y, d1x, d1y)
      lineEntity('DIMENSION', s.x + p.x2, s.y + p.y2, d2x, d2y)
      // label at midpoint
      const lenMm = len / k
      const label = lenMm >= 1000 ? `${(lenMm / 1000).toFixed(2)}m`
        : lenMm >= 100 ? `${(lenMm / 10).toFixed(1)}cm`
        : `${Math.round(lenMm)}mm`
      put(['0', 'TEXT'], ['8', 'DIMENSION'],
        ['10', x((d1x + d2x) / 2)], ['20', y((d1y + d2y) / 2)], ['30', '0.0'],
        ['40', toMm(10).toFixed(3)], ['1', label])
    }
  }

  put(['0', 'ENDSEC'], ['0', 'EOF'])

  const blob = new Blob([lines.join('\n')], { type: 'application/dxf' })
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
export function importDxf(editor: Editor) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.dxf'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    const text = await file.text()

    let dxf: ReturnType<DxfParser['parseSync']>
    try {
      dxf = new DxfParser().parseSync(text)
    } catch {
      alert('DXF 파일을 읽을 수 없습니다.')
      return
    }
    if (!dxf || !dxf.entities?.length) {
      alert('DXF에 도면 데이터가 없습니다.')
      return
    }

    // unit code → millimetres (1=in, 2=ft, 4=mm, 5=cm, 6=m)
    const unit = (dxf.header?.['$INSUNITS'] as number | undefined) ?? 4
    const toMm = unit === 1 ? 25.4 : unit === 2 ? 304.8 : unit === 5 ? 10 : unit === 6 ? 1000 : 1
    const k = getScaleConfig(editor).pxPerMm * toMm
    const thickness = getDefaultWallThicknessMm() * getScaleConfig(editor).pxPerMm

    const segs: Seg[] = []
    for (const ent of dxf.entities) {
      if (segs.length >= MAX_SEGMENTS) break
      const e = ent as unknown as Record<string, unknown>
      const verts = e.vertices as Array<{ x: number; y: number }> | undefined
      if (e.type === 'LINE' && verts && verts.length >= 2) {
        segs.push({ x1: verts[0].x, y1: verts[0].y, x2: verts[1].x, y2: verts[1].y })
      } else if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && verts && verts.length >= 2) {
        for (let i = 0; i < verts.length - 1; i++) {
          segs.push({ x1: verts[i].x, y1: verts[i].y, x2: verts[i + 1].x, y2: verts[i + 1].y })
        }
        if (e.shape) {
          const a = verts[verts.length - 1]
          const b = verts[0]
          segs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })
        }
      }
    }
    if (!segs.length) {
      alert('DXF에서 선분(LINE/POLYLINE)을 찾지 못했습니다.')
      return
    }

    const shapes = segs
      .map((s) => {
        const x1 = s.x1 * k
        const y1 = -s.y1 * k
        const dx = (s.x2 - s.x1) * k
        const dy = -(s.y2 - s.y1) * k
        return { x1, y1, dx, dy }
      })
      .filter((s) => Math.hypot(s.dx, s.dy) >= 1)
      .map((s) => ({
        id: createShapeId(),
        type: 'wall' as const,
        x: s.x1,
        y: s.y1,
        props: { x2: s.dx, y2: s.dy, thickness },
      }))

    editor.createShapes(shapes as never)
    editor.setSelectedShapes(shapes.map((s) => s.id))
    editor.zoomToFit()
  }
  input.click()
}
