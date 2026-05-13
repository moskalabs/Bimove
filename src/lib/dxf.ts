import DxfParser from 'dxf-parser'
import { createShapeId, type Editor } from 'tldraw'
import { getScaleConfig } from './scaleConfig'
import { getDefaultWallThicknessMm } from './settings'

const MAX_SEGMENTS = 3000

type Seg = { x1: number; y1: number; x2: number; y2: number }

// ---------------------------------------------------------------- export ----

const TEXT_SIZE_PX: Record<string, number> = { s: 18, m: 24, l: 36, xl: 56 }

/**
 * Export the current page to a minimal DXF R12 (AutoCAD 2000-compatible) file.
 * Walls/doors/windows become LINE entities (centre-line for walls, the opening
 * span for doors/windows) on dedicated layers; text shapes become TEXT
 * entities. Canvas px are converted back to drawing mm and the Y axis is
 * flipped so the file opens upright in CAD software.
 */
export function exportDxf(editor: Editor, filename = 'untitled') {
  const k = getScaleConfig(editor).pxPerMm || 1
  const mm = (px: number) => px / k
  const lines: string[] = []
  const put = (...pairs: [number | string, number | string][]) => {
    for (const [code, val] of pairs) { lines.push(String(code)); lines.push(String(val)) }
  }
  const lineEntity = (layer: string, x1: number, y1: number, x2: number, y2: number) => {
    put(['0', 'LINE'], ['8', layer],
      ['10', mm(x1).toFixed(3)], ['20', (-mm(y1)).toFixed(3)], ['30', '0.0'],
      ['11', mm(x2).toFixed(3)], ['21', (-mm(y2)).toFixed(3)], ['31', '0.0'])
  }

  put(['0', 'SECTION'], ['2', 'HEADER'], ['9', '$ACADVER'], ['1', 'AC1009'],
    ['9', '$INSUNITS'], ['70', '4'], ['0', 'ENDSEC'])
  put(['0', 'SECTION'], ['2', 'ENTITIES'])

  for (const s of editor.getCurrentPageShapes()) {
    if (s.type === 'wall') {
      const p = s.props as { x2: number; y2: number }
      lineEntity('WALL', s.x, s.y, s.x + p.x2, s.y + p.y2)
    } else if (s.type === 'door' || s.type === 'window') {
      const p = s.props as { width: number }
      const hw = p.width / 2
      const a = (s as { rotation?: number }).rotation ?? 0
      const cos = Math.cos(a), sin = Math.sin(a)
      lineEntity(s.type === 'door' ? 'DOOR' : 'WINDOW',
        s.x - hw * cos, s.y - hw * sin, s.x + hw * cos, s.y + hw * sin)
    } else if (s.type === 'text') {
      const p = s.props as { text?: string; size?: string }
      const txt = (p.text ?? '').replace(/\n/g, ' ').trim()
      if (!txt) continue
      const h = mm(TEXT_SIZE_PX[p.size ?? 'm'] ?? 24)
      put(['0', 'TEXT'], ['8', 'TEXT'],
        ['10', mm(s.x).toFixed(3)], ['20', (-mm(s.y)).toFixed(3)], ['30', '0.0'],
        ['40', h.toFixed(3)], ['1', txt])
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
