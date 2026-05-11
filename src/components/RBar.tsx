import { useEffect, useState } from 'react'
import { useEditor } from '../context/EditorContext'
import {
  getScaleConfig,
  setScaleConfig,
  SCALE_PRESETS,
  type ScaleUnit,
  type ScaleConfig,
} from '../lib/scaleConfig'

type SelectedInfo = {
  type: string
  x: number
  y: number
  props?: Record<string, unknown>
} | null

export function RBar() {
  const editor = useEditor()
  const [selected, setSelected] = useState<SelectedInfo>(null)
  const [scale, setScaleState] = useState<ScaleConfig>({ unit: 'mm', pxPerMm: 1 })

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
      setScaleState(getScaleConfig(editor))
    })
    return unsub
  }, [editor])

  const handleUnit = (unit: ScaleUnit) => {
    if (!editor) return
    setScaleConfig(editor, { unit })
  }

  const handlePreset = (pxPerMm: number) => {
    if (!editor) return
    setScaleConfig(editor, { pxPerMm })
  }

  return (
    <aside className="rbar">
      {/* 스케일 설정 */}
      <section className="rbar-section">
        <h3>스케일</h3>
        <div className="rbar-row">
          <span>단위</span>
          <div className="rbar-toggle">
            {(['mm', 'cm', 'm'] as ScaleUnit[]).map(u => (
              <button
                key={u}
                className={scale.unit === u ? 'active' : ''}
                onClick={() => handleUnit(u)}
              >{u}</button>
            ))}
          </div>
        </div>
        <div style={{ padding: '4px 0 8px' }}>
          <div style={{ color: '#666', fontSize: 11, marginBottom: 4 }}>배율</div>
          <select
            value={scale.pxPerMm}
            onChange={e => handlePreset(Number(e.target.value))}
            style={{ width: '100%', fontSize: 12, padding: '3px 6px', border: '1px solid #e0e0e0', borderRadius: 4 }}
          >
            {SCALE_PRESETS.map(p => (
              <option key={p.pxPerMm} value={p.pxPerMm}>{p.label}</option>
            ))}
          </select>
        </div>
      </section>

      {/* 선택된 객체 or 프로젝트 */}
      {selected ? (
        <section className="rbar-section">
          <h3>선택된 객체</h3>
          <div className="rbar-row"><span>유형</span><span>{selected.type}</span></div>
          <div className="rbar-row"><span>X</span><span>{selected.x}</span></div>
          <div className="rbar-row"><span>Y</span><span>{selected.y}</span></div>
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
          <div className="rbar-row"><span>파일명</span><span>Drawing 1</span></div>
        </section>
      )}
    </aside>
  )
}
