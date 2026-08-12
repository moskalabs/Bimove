import { useEffect, useState } from 'react'
import type { TLShapeId } from 'tldraw'
import { useEditor } from '../context/EditorContext'
import { snapToWallEndpoint } from '../lib/snap'
import { drawingState } from '../lib/drawingState'
import { getScaleConfig, formatLength } from '../lib/scaleConfig'

type Pt = { x: number; y: number }

type OverlayState = {
  start: Pt | null
  snap: Pt | null
  end: Pt | null
  mid: Pt | null
  angleDeg: number | null
  distLabel: string | null
}

const EMPTY: OverlayState = { start: null, snap: null, end: null, mid: null, angleDeg: null, distLabel: null }

export function ToolOverlay() {
  const editor = useEditor()
  const [state, setState] = useState<OverlayState>(EMPTY)

  useEffect(() => {
    if (!editor) return

    const update = () => {
      const toolId = editor.getCurrentToolId()
      if (toolId !== 'wall' && toolId !== 'dimension') {
        setState(EMPTY)
        return
      }

      const drawingId = drawingState.drawingId
      let start: Pt | null = null
      let end: Pt | null = null
      let mid: Pt | null = null
      let angleDeg: number | null = null
      let distLabel: string | null = null

      if (drawingId) {
        const shape = editor.getShape(drawingId as TLShapeId)
        if (shape) {
          start = editor.pageToViewport({ x: shape.x, y: shape.y })
          const p = shape.props as { x2: number; y2: number }
          const lenPx = Math.hypot(p.x2, p.y2)
          if (lenPx > 5) {
            end = editor.pageToViewport({ x: shape.x + p.x2, y: shape.y + p.y2 })
            mid = editor.pageToViewport({ x: shape.x + p.x2 / 2, y: shape.y + p.y2 / 2 })
            angleDeg = Math.atan2(p.y2, p.x2) * 180 / Math.PI
            const scale = getScaleConfig(editor)
            distLabel = formatLength(lenPx, scale)
          }
        }
      }

      // 스냅 가능한 끝점 링
      const hit = snapToWallEndpoint(editor, editor.inputs.currentPagePoint, drawingId ?? undefined)
      const snap = hit ? editor.pageToViewport({ x: hit.x, y: hit.y }) : null

      setState({ start, snap, end, mid, angleDeg, distLabel })
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
      {state.start && (
        <div style={{
          position: 'absolute', left: state.start.x - 5, top: state.start.y - 5,
          width: 10, height: 10, borderRadius: '50%',
          background: '#1a73e8', border: '2px solid white',
          boxShadow: '0 0 0 1px #1a73e8', pointerEvents: 'none', zIndex: 100,
        }} />
      )}
      {state.snap && (
        <div style={{
          position: 'absolute', left: state.snap.x - 8, top: state.snap.y - 8,
          width: 16, height: 16, borderRadius: '50%',
          border: '2px solid #00b341', background: 'rgba(0,179,65,0.15)',
          pointerEvents: 'none', zIndex: 101,
        }} />
      )}
      {state.end && state.angleDeg !== null && (
        <div className="tool-angle-badge" style={{
          left: state.end.x + 12, top: state.end.y - 14,
        }}>
          {state.angleDeg.toFixed(1)}°
        </div>
      )}
      {state.mid && state.distLabel && (
        <div className="tool-dist-label" style={{
          left: state.mid.x, top: state.mid.y - 24,
        }}>
          {state.distLabel}
        </div>
      )}
    </>
  )
}
