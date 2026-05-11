import { useEffect, useState } from 'react'
import { useEditor } from '../context/EditorContext'

export function ToolOverlay() {
  const editor = useEditor()
  const [dot, setDot] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!editor) return
    const unsub = editor.store.listen(() => {
      const tool = editor.getCurrentToolId()
      if (tool !== 'wall') {
        setDot(null)
        return
      }
      // WallTool이 previewId를 가지고 있으면 첫 클릭 완료 상태
      // store에서 현재 drawing 중인 wall shape 찾기
      const shapes = editor.getCurrentPageShapes()
      const drawing = shapes.find(s => s.type === 'wall' &&
        (s.props as { x2: number; y2: number }).x2 === 0 &&
        (s.props as { x2: number; y2: number }).y2 === 0
      )
      if (drawing) {
        const screen = editor.pageToViewport({ x: drawing.x, y: drawing.y })
        setDot(screen)
      } else {
        setDot(null)
      }
    })
    return unsub
  }, [editor])

  if (!dot) return null

  return (
    <div style={{
      position: 'absolute',
      left: dot.x - 5,
      top: dot.y - 5,
      width: 10,
      height: 10,
      borderRadius: '50%',
      background: '#1a73e8',
      border: '2px solid white',
      boxShadow: '0 0 0 1px #1a73e8',
      pointerEvents: 'none',
      zIndex: 100,
    }} />
  )
}
