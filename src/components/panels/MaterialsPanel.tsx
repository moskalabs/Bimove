import { useEditor } from '../../context/EditorContext'

const WALL_COLORS: { label: string; fill: string; stroke: string }[] = [
  { label: '기본 (회색)', fill: '#555', stroke: '#222' },
  { label: '콘크리트', fill: '#8a8a8a', stroke: '#555' },
  { label: '벽돌', fill: '#b5651d', stroke: '#7a3e0a' },
  { label: '나무', fill: '#c8a96e', stroke: '#8b6327' },
  { label: '유리', fill: '#a8d8ea', stroke: '#4fa3c8' },
  { label: '흰 벽', fill: '#f0f0f0', stroke: '#999' },
]

export function MaterialsPanel() {
  const editor = useEditor()
  const selected = editor?.getSelectedShapes() ?? []
  const walls = selected.filter(s => s.type === 'wall')

  const applyColor = (fill: string, stroke: string) => {
    if (!editor || walls.length === 0) return
    walls.forEach(s => {
      editor.updateShape({ id: s.id, meta: { fill, stroke } } as never)
    })
    editor.store.mergeRemoteChanges(() => {})
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
          {WALL_COLORS.map(c => (
            <button
              key={c.label}
              onClick={() => applyColor(c.fill, c.stroke)}
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

        <div style={{ fontSize: 10, color: '#bbb', marginTop: 12, lineHeight: 1.5 }}>
          * 재질은 현재 세션에만 적용됩니다. 전체 재질 시스템은 추후 업데이트 예정.
        </div>
      </div>
    </div>
  )
}
