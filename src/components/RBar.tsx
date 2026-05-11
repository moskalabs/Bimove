import { useEffect, useState } from 'react'
import { useEditor } from '../context/EditorContext'

type SelectedInfo = {
  type: string
  x: number
  y: number
  props?: Record<string, unknown>
} | null

export function RBar() {
  const editor = useEditor()
  const [selected, setSelected] = useState<SelectedInfo>(null)

  useEffect(() => {
    if (!editor) return
    const unsub = editor.store.listen(() => {
      const shapes = editor.getSelectedShapes()
      if (shapes.length === 1) {
        const s = shapes[0]
        setSelected({
          type: s.type,
          x: Math.round(s.x),
          y: Math.round(s.y),
          props: s.props as Record<string, unknown>,
        })
      } else {
        setSelected(null)
      }
    })
    return unsub
  }, [editor])

  return (
    <aside className="rbar">
      {selected ? (
        <section className="rbar-section">
          <h3>선택된 객체</h3>
          <div className="rbar-row">
            <span>유형</span>
            <span>{selected.type}</span>
          </div>
          <div className="rbar-row">
            <span>X</span>
            <span>{selected.x}</span>
          </div>
          <div className="rbar-row">
            <span>Y</span>
            <span>{selected.y}</span>
          </div>
          {selected.type === 'wall' && selected.props && (
            <>
              <div className="rbar-row">
                <span>길이</span>
                <span>{Math.round(Math.sqrt(
                  (selected.props.x2 as number) ** 2 +
                  (selected.props.y2 as number) ** 2
                ))} px</span>
              </div>
              <div className="rbar-row">
                <span>두께</span>
                <span>{selected.props.thickness as number} px</span>
              </div>
            </>
          )}
        </section>
      ) : (
        <section className="rbar-section">
          <h3>프로젝트</h3>
          <div className="rbar-row">
            <span>파일명</span>
            <span>Drawing 1</span>
          </div>
          <div className="rbar-row">
            <span>단위</span>
            <span>Millimeters</span>
          </div>
          <div className="rbar-row">
            <span>스케일</span>
            <span>1:1</span>
          </div>
        </section>
      )}
    </aside>
  )
}
