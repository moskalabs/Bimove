import { useState } from 'react'
import { useEditor } from '../../context/EditorContext'
import { loadMaterialPresets } from '../../lib/materialPresets'
import { exportLibrary, downloadLibrary, pickAndImportLibrary, applyLibrary } from '../../lib/library'

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
        <div style={{ fontSize: 11, color: '#888', marginBottom: 10, lineHeight: 1.6 }}>
          벽을 선택한 후 재질을 클릭하세요.
        </div>

        {walls.length === 0 && (
          <div style={{ color: '#bbb', fontSize: 12, textAlign: 'center', padding: '12px 0' }}>
            벽을 선택하면 재질을 변경할 수 있어요
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {presets.map(c => (
            <button
              key={c.id ?? c.label}
              onClick={() => applyColor(c.fill, c.stroke, c.id, c.pattern)}
              disabled={walls.length === 0}
              style={{
                padding: '8px 6px', borderRadius: 8, border: `2px solid ${c.stroke}`,
                background: c.fill, cursor: walls.length > 0 ? 'pointer' : 'not-allowed',
                fontSize: 10, color: '#fff', fontWeight: 600, textShadow: '0 1px 2px rgba(0,0,0,0.4)',
                opacity: walls.length === 0 ? 0.4 : 1,
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div style={{ borderTop: '1px solid #eee', marginTop: 16, paddingTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#555', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>📦 라이브러리</div>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 8, lineHeight: 1.6 }}>
            단가 + 재질을 JSON으로 export/import. 회사별 표준 공유에 활용.
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="export-btn" style={{ flex: 1 }} onClick={handleExport}>⬇ Export</button>
            <button className="export-btn" style={{ flex: 1 }} onClick={handleImport}>⬆ Import</button>
          </div>
        </div>

      </div>
    </div>
  )
}
