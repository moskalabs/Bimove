import DxfParser from 'dxf-parser'
import { createShapeId, type Editor } from 'tldraw'
import { getScaleConfig } from './scaleConfig'
import { getDefaultWallThickness } from './settings'

const MAX_SEGMENTS = 3000

type Seg = { x1: number; y1: number; x2: number; y2: number }

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
    const thickness = getDefaultWallThickness()

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
