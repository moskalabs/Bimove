import { useEffect, useState } from 'react'
import { useEditor } from '../../context/EditorContext'
import { getScaleConfig, setScaleConfig, SCALE_PRESETS, type ScaleUnit } from '../../lib/scaleConfig'

export function LayoutPanel() {
  const editor = useEditor()
  const [grid, setGrid] = useState(false)
  const [scale, setScale] = useState(() => editor ? getScaleConfig(editor) : null)

  useEffect(() => {
    if (!editor) return
    setGrid(editor.getInstanceState().isGridMode)
    setScale(getScaleConfig(editor))
  }, [editor])

  const toggleGrid = () => {
    if (!editor) return
    const next = !grid
    editor.updateInstanceState({ isGridMode: next })
    setGrid(next)
  }

  const applyPreset = (pxPerMm: number) => {
    if (!editor) return
    const unit: ScaleUnit = pxPerMm >= 0.1 ? 'mm' : pxPerMm >= 0.001 ? 'cm' : 'm'
    setScaleConfig(editor, { pxPerMm, unit })
    setScale(getScaleConfig(editor))
  }

  const zoomFit = () => editor?.zoomToFit()
  const zoomReset = () => editor?.resetZoom()

  return (
    <div className="lbar-panel">
      <div className="lbar-panel-header">배치 설정</div>
      <div className="lbar-panel-body">

        <div className="panel-section-title">뷰</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          <button className="export-btn" style={{ flex: 1 }} onClick={zoomFit}>맞춤</button>
          <button className="export-btn" style={{ flex: 1 }} onClick={zoomReset}>100%</button>
        </div>

        <div className="panel-section-title">그리드</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 12 }}>그리드 표시</span>
          <button
            onClick={toggleGrid}
            style={{
              width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
              background: grid ? '#3b82f6' : '#ccc', position: 'relative', transition: 'background 0.2s',
            }}
          >
            <span style={{
              position: 'absolute', top: 2, left: grid ? 18 : 2, width: 16, height: 16,
              borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
            }} />
          </button>
        </div>

        <div className="panel-section-title">축척</div>
        {SCALE_PRESETS.map(p => (
          <button
            key={p.label}
            className="export-btn"
            style={{
              width: '100%', marginBottom: 4, textAlign: 'left',
              background: scale?.pxPerMm === p.pxPerMm ? '#eff6ff' : undefined,
              borderColor: scale?.pxPerMm === p.pxPerMm ? '#3b82f6' : undefined,
              color: scale?.pxPerMm === p.pxPerMm ? '#1d4ed8' : undefined,
            }}
            onClick={() => applyPreset(p.pxPerMm)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}
