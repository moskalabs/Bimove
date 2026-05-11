import { useEffect, useState } from 'react'
import { useEditor } from '../context/EditorContext'
import { detectRooms, type Room } from '../lib/roomDetection'
import { getScaleConfig } from '../lib/scaleConfig'

type ViewRoom = Room & { cx: number; cy: number }

export function RoomOverlay() {
  const editor = useEditor()
  const [rooms, setRooms] = useState<ViewRoom[]>([])

  useEffect(() => {
    if (!editor) return

    const update = () => {
      const walls = editor.getCurrentPageShapes()
        .filter(s => s.type === 'wall')
        .map(s => {
          const p = s.props as { x2: number; y2: number }
          return { x1: s.x, y1: s.y, x2: s.x + p.x2, y2: s.y + p.y2 }
        })

      const detected = detectRooms(walls)
      const scale = getScaleConfig(editor)

      setRooms(detected.map(r => {
        const vp = editor.pageToViewport(r.centroid)
        return {
          ...r,
          cx: vp.x,
          cy: vp.y,
          // Override area with scaled value stored as display string
          area: r.area / (scale.pxPerMm * scale.pxPerMm),  // area in mm²
        }
      }))
    }

    update()
    const unsub = editor.store.listen(update)
    return unsub
  }, [editor])

  if (rooms.length === 0) return null

  return (
    <>
      {rooms.map((r, i) => {
        const editor2 = editor
        if (!editor2) return null
        const scale = getScaleConfig(editor2)
        const areaLabel = formatArea(r.area, scale.unit)
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: r.cx,
              top: r.cy,
              zIndex: 300,
              transform: 'translate(-50%, -50%)',
              background: 'rgba(26,115,232,0.08)',
              border: '1px dashed rgba(26,115,232,0.4)',
              borderRadius: 4,
              padding: '2px 6px',
              fontSize: 11,
              color: '#1a73e8',
              fontFamily: 'monospace',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {areaLabel}
          </div>
        )
      })}
    </>
  )
}

function formatArea(areaMm2: number, unit: string): string {
  if (unit === 'mm') return `${Math.round(areaMm2)} mm²`
  if (unit === 'cm') return `${(areaMm2 / 100).toFixed(1)} cm²`
  return `${(areaMm2 / 1_000_000).toFixed(2)} m²`
}
