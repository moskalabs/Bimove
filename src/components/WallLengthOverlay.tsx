import { useEffect, useState } from 'react'
import { useEditor } from '../context/EditorContext'
import { getScaleConfig } from '../lib/scaleConfig'
import { getShowWallLengths } from '../lib/settings'

type WallLabel = { id: string; cx: number; cy: number; len: string; angle: number }

export function WallLengthOverlay() {
  const editor = useEditor()
  const [labels, setLabels] = useState<WallLabel[]>([])
  const [visible, setVisible] = useState(getShowWallLengths)

  useEffect(() => {
    const onStorage = () => setVisible(getShowWallLengths())
    window.addEventListener('storage', onStorage)
    window.addEventListener('bimove:settings', onStorage)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('bimove:settings', onStorage)
    }
  }, [])

  useEffect(() => {
    if (!editor) return
    const update = () => {
      const scale = getScaleConfig(editor)
      const walls = editor.getCurrentPageShapes().filter(s => s.type === 'wall')
      const result: WallLabel[] = walls.map(s => {
        const p = s.props as { x2: number; y2: number }
        const lenPx = Math.hypot(p.x2, p.y2)
        const lenMm = lenPx / scale.pxPerMm
        const midPage = { x: s.x + p.x2 / 2, y: s.y + p.y2 / 2 }
        const midVp = editor.pageToViewport(midPage)
        const angle = Math.atan2(p.y2, p.x2) * (180 / Math.PI)
        return {
          id: s.id,
          cx: midVp.x,
          cy: midVp.y,
          len: formatLength(lenMm, scale.unit),
          angle: normalizeAngle(angle),
        }
      })
      setLabels(result)
    }
    update()
    const unsub = editor.store.listen(update)
    return unsub
  }, [editor])

  if (!visible || labels.length === 0) return null

  return (
    <>
      {labels.map(l => (
        <div
          key={l.id}
          style={{
            position: 'absolute',
            left: l.cx,
            top: l.cy,
            transform: `translate(-50%, -50%) rotate(${l.angle}deg)`,
            background: 'rgba(255,255,255,0.92)',
            border: '1px solid #ccc',
            borderRadius: 3,
            padding: '1px 5px',
            fontSize: 10,
            color: '#333',
            fontFamily: 'monospace',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            zIndex: 300,
          }}
        >
          {l.len}
        </div>
      ))}
    </>
  )
}

function formatLength(mm: number, unit: string): string {
  if (unit === 'm') return `${(mm / 1000).toFixed(2)}m`
  if (unit === 'cm') return `${(mm / 10).toFixed(1)}cm`
  return `${Math.round(mm)}mm`
}

/** Keep label readable — flip if it'd be upside-down. */
function normalizeAngle(deg: number): number {
  let a = deg % 360
  if (a > 90) a -= 180
  if (a < -90) a += 180
  return a
}
