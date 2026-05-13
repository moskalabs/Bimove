import { useEffect, useState } from 'react'
import type { TLShapeId } from 'tldraw'
import { useEditor } from '../context/EditorContext'
import { snapToWallEndpoint } from '../lib/snap'
import { drawingState } from '../lib/drawingState'

type Pt = { x: number; y: number }

export function ToolOverlay() {
  const editor = useEditor()
  const [start, setStart] = useState<Pt | null>(null)
  const [snap, setSnap] = useState<Pt | null>(null)

  useEffect(() => {
    if (!editor) return

    const update = () => {
      const toolId = editor.getCurrentToolId()
      if (toolId !== 'wall' && toolId !== 'dimension') {
        setStart(null)
        setSnap(null)
        return
      }

      // 시작점 dot: WallTool이 기록한 drawingId로 찾음
      const drawingId = drawingState.drawingId
      if (drawingId) {
        const shape = editor.getShape(drawingId as TLShapeId)
        setStart(shape ? editor.pageToViewport({ x: shape.x, y: shape.y }) : null)
      } else {
        setStart(null)
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
    </>
  )
}
