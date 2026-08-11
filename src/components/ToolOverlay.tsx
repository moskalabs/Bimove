import { useEffect, useState } from 'react'
import type { TLShapeId } from 'tldraw'
import { useEditor } from '../context/EditorContext'
import { snapToWallEndpoint } from '../lib/snap'
import { drawingState } from '../lib/drawingState'
import { getScaleConfig, formatLength } from '../lib/scaleConfig'

type Pt = { x: number; y: number }

export function ToolOverlay() {
  const editor = useEditor()
  const [start, setStart] = useState<Pt | null>(null)
  const [snap, setSnap] = useState<Pt | null>(null)
  const [end, setEnd] = useState<Pt | null>(null)
  const [mid, setMid] = useState<Pt | null>(null)
  const [angleDeg, setAngleDeg] = useState<number | null>(null)
  const [distLabel, setDistLabel] = useState<string | null>(null)

  useEffect(() => {
    if (!editor) return

    const update = () => {
      const toolId = editor.getCurrentToolId()
      if (toolId !== 'wall' && toolId !== 'dimension') {
        setStart(null)
        setSnap(null)
        setEnd(null)
        setMid(null)
        setAngleDeg(null)
        setDistLabel(null)
        return
      }

      const drawingId = drawingState.drawingId
      if (drawingId) {
        const shape = editor.getShape(drawingId as TLShapeId)
        if (shape) {
          setStart(editor.pageToViewport({ x: shape.x, y: shape.y }))
          const p = shape.props as { x2: number; y2: number }
          const lenPx = Math.hypot(p.x2, p.y2)
          if (lenPx > 5) {
            setEnd(editor.pageToViewport({ x: shape.x + p.x2, y: shape.y + p.y2 }))
            setMid(editor.pageToViewport({ x: shape.x + p.x2 / 2, y: shape.y + p.y2 / 2 }))
            const angle = Math.atan2(p.y2, p.x2) * 180 / Math.PI
            setAngleDeg(angle)
            const scale = getScaleConfig(editor)
            setDistLabel(formatLength(lenPx, scale))
          } else {
            setEnd(null)
            setMid(null)
            setAngleDeg(null)
            setDistLabel(null)
          }
        } else {
          setStart(null)
          setEnd(null)
          setMid(null)
          setAngleDeg(null)
          setDistLabel(null)
        }
      } else {
        setStart(null)
        setEnd(null)
        setMid(null)
        setAngleDeg(null)
        setDistLabel(null)
      }

      // 스냅 가능한 끝점 링
      const hit = snapToWallEndpoint(editor, editor.inputs.currentPagePoint, drawingId ?? undefined)
      setSnap(hit ? editor.pageToViewport({ x: hit.x, y: hit.y }) : null)
    }

    let raf = 0
    const unsub = editor.store.listen(() => {
      if (raf) return
      raf = requestAnimationFrame(() => { raf = 0; update() })
    })
    return () => { unsub(); if (raf) cancelAnimationFrame(raf) }
  }, [editor])

  return (
    <>
      {start && (
        <div style={{
          position: 'absolute', left: start.x - 5, top: start.y - 5,
          width: 10, height: 10, borderRadius: '50%',
          background: '#1a73e8', border: '2px solid white',
          boxShadow: '0 0 0 1px #1a73e8', pointerEvents: 'none', zIndex: 100,
        }} />
      )}
      {snap && (
        <div style={{
          position: 'absolute', left: snap.x - 8, top: snap.y - 8,
          width: 16, height: 16, borderRadius: '50%',
          border: '2px solid #00b341', background: 'rgba(0,179,65,0.15)',
          pointerEvents: 'none', zIndex: 101,
        }} />
      )}
      {end && angleDeg !== null && (
        <div className="tool-angle-badge" style={{
          left: end.x + 12, top: end.y - 14,
        }}>
          {angleDeg.toFixed(1)}°
        </div>
      )}
      {mid && distLabel && (
        <div className="tool-dist-label" style={{
          left: mid.x, top: mid.y - 24,
        }}>
          {distLabel}
        </div>
      )}
    </>
  )
}
