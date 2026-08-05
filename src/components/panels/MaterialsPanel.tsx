import { useState, useEffect } from 'react'
import { useEditor } from '../../context/EditorContext'
import { loadMaterialPresets } from '../../lib/materialPresets'
import { exportLibrary, downloadLibrary, pickAndImportLibrary, applyLibrary } from '../../lib/library'

/* ── 벽 선택 가이드 ── */
function WallSelectGuide({ onClickSelect }: { onClickSelect: () => void }) {
  const [step, setStep] = useState(1)

  useEffect(() => {
    const timer = setInterval(() => setStep(s => s === 1 ? 2 : 1), 3000)
    return () => clearInterval(timer)
  }, [])

  // TopBar 선택 버튼에 펄스 힌트 표시
  useEffect(() => {
    document.body.setAttribute('data-material-guide', 'true')
    return () => document.body.removeAttribute('data-material-guide')
  }, [])

  return (
    <div className="material-guide">
      {/* 위를 가리키는 화살표 */}
      <div className="material-guide-arrow">↑</div>

      <div className="material-guide-steps">
        <div
          className={`material-guide-step${step === 1 ? ' active' : ''}`}
          onClick={onClickSelect}
          style={{ cursor: 'pointer' }}
        >
          <div className="material-guide-step-num">1</div>
          <div className="material-guide-step-text">
            <strong>상단 도구바</strong>에서<br />
            <span className="material-guide-highlight">선택 도구(↖)</span>를 클릭
          </div>
        </div>
        <div className={`material-guide-step${step === 2 ? ' active' : ''}`}>
          <div className="material-guide-step-num">2</div>
          <div className="material-guide-step-text">
            캔버스에서<br />
            <strong>벽을 클릭</strong>하여 선택
          </div>
        </div>
      </div>

      <div className="material-guide-hint">
        💡 Tip: 여러 벽을 선택하려면 Shift+클릭
      </div>
    </div>
  )
}

export function MaterialsPanel() {
  const editor = useEditor()
  const selected = editor?.getSelectedShapes() ?? []
  const walls = selected.filter(s => s.type === 'wall')
  const [presets, setPresets] = useState(() => loadMaterialPresets())

  const applyColor = (fill: string, stroke: string, materialId?: string, pattern?: string) => {
    if (!editor || walls.length === 0) return
    walls.forEach(s => {
      editor.updateShape({ id: s.id, meta: { ...s.meta, fill, stroke, materialId, pattern } } as never)
    })
  }

  const activateSelectTool = () => {
    if (editor) editor.setCurrentTool('select')
  }

  const handleExport = () => {
    const name = prompt('라이브러리 이름?', '회사 표준 자재') ?? '라이브러리'
    const company = prompt('회사명? (선택)', '') ?? undefined
    const note = prompt('메모? (선택)', '') ?? undefined
    downloadLibrary(exportLibrary(name, { company: company || undefined, note: note || undefined }))
  }
  const handleImport = () => {
    pickAndImportLibrary(file => {
      if (!confirm(`'${file.name}' 라이브러리를 적용할까요? (현재 단가/재질 덮어쓰기)\n회사: ${file.company ?? '-'}`)) return
      applyLibrary(file)
      setPresets(loadMaterialPresets())
      alert('라이브러리가 적용됐어. 다른 패널은 새로고침 후 반영.')
    })
  }

  return (
    <div className="lbar-panel">
      <div className="lbar-panel-header">재질</div>
      <div className="lbar-panel-body">

        {/* 상태 메시지 */}
        <div className={`mat-status${walls.length > 0 ? ' mat-status-active' : ''}`}>
          {walls.length > 0
            ? `✓ 벽 ${walls.length}개 선택됨 — 재질을 클릭하세요`
            : '벽을 선택한 후 재질을 클릭하세요.'}
        </div>

        {/* 가이드 */}
        {walls.length === 0 && (
          <WallSelectGuide onClickSelect={activateSelectTool} />
        )}

        {/* 재질 버튼 그리드 */}
        <div className="mat-section-title">재질 프리셋</div>
        <div className="mat-grid">
          {presets.map(c => (
            <button
              key={c.id ?? c.label}
              className="mat-btn"
              onClick={() => applyColor(c.fill, c.stroke, c.id, c.pattern)}
              disabled={walls.length === 0}
              style={{
                background: c.fill,
                borderColor: c.stroke,
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* 라이브러리 섹션 */}
        <div className="mat-library">
          <div className="mat-library-title">📦 라이브러리</div>
          <div className="mat-library-desc">
            단가 + 재질을 JSON으로 export/import.<br />
            회사별 표준 공유에 활용.
          </div>
          <div className="mat-library-actions">
            <button className="action-btn" onClick={handleExport}>⬇ Export</button>
            <button className="action-btn" onClick={handleImport}>⬆ Import</button>
          </div>
        </div>

      </div>
    </div>
  )
}
