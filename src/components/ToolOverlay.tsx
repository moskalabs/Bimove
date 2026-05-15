import { useEffect, useState } from 'react'
import type { TLShapeId } from 'tldraw'
import { useEditor } from '../context/EditorContext'
import { snapToWallEndpoint } from '../lib/snap'
import { drawingState } from '../lib/drawingState'
import { getScaleConfig } from '../lib/scaleConfig'

type Pt = { x: number; y: number }
type LenInfo = { x: number; y: number; text: string }

export function ToolOverlay() {
  const editor = useEditor()
  const [start, setStart] = useState<Pt | null>(null)
  const [snap, setSnap] = useState<Pt | null>(null)
  const [lenInfo, setLenInfo] = useState<LenInfo | null>(null)

  useEffect(() => {
    if (!editor) return

    const update = () => {
      const toolId = editor.getCurrentToolId()
      if (toolId !== 'wall' && toolId !== 'dimension') {
        setStart(null)
        setSnap(null)
        setLenInfo(null)
        return
      }

      const drawingId = drawingState.drawingId
      if (drawingId) {
        const shape = editor.getShape(drawingId as TLShapeId)
        setStart(shape ? editor.pageToViewport({ x: shape.x, y: shape.y }) : null)

        // 길이·각도 툴팁
        if (shape && toolId === 'wall') {
          const p = shape.props as { x2: number; y2: number }
          const lenPx = Math.hypot(p.x2, p.y2)
          if (lenPx > 5) {
            const scale = getScaleConfig(editor)
            const lenMm = lenPx / scale.pxPerMm
            const formatted = scale.unit === 'm'
              ? `${(lenMm / 1000).toFixed(2)}m`
              : scale.unit === 'cm'
              ? `${(lenMm / 10).toFixed(1)}cm`
              : `${Math.round(lenMm)}mm`
            const angleDeg = Math.round(Math.atan2(p.y2, p.x2) * 180 / Math.PI)
            const cursor = editor.pageToViewport(editor.inputs.currentPagePoint)
            setLenInfo({ x: cursor.x, y: cursor.y, text: `${formatted}  ${angleDeg}°` })
          } else {
            setLenInfo(null)
          }
        } else {
          setLenInfo(null)
        }
      } else {
        setStart(null)
        setLenInfo(null)
      }

      // 스냅 가능한 끝점 링
      const hit = snapToWallEndpoint(editor, editor.inputs.currentPagePoint, drawingId ?? undefined)
      setSnap(hit ? editor.pageToViewport({ x: hit.x, y: hit.y }) : null)
    }

    const unsub = editor.store.listen(update)
    return unsub
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
      {lenInfo && (
        <div style={{
          position: 'absolute', left: lenInfo.x + 16, top: lenInfo.y + 16,
          background: 'rgba(0,0,0,0.72)', color: '#fff',
          padding: '3px 8px', borderRadius: 4, fontSize: 11,
          fontFamily: 'monospace', pointerEvents: 'none', zIndex: 200,
          whiteSpace: 'nowrap', letterSpacing: '0.03em',
        }}>
          {lenInfo.text}
        </div>
      )}
    </>
  )
}
