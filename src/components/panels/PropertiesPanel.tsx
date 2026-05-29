import { useEffect, useState } from 'react'
import type { TLShape } from 'tldraw'
import { useEditor } from '../../context/EditorContext'
import { loadMaterialPresets } from '../../lib/materialPresets'

type Phase = '' | '구조' | '건축' | '마감' | '설비' | '가구·집기'

const PHASES: Phase[] = ['', '구조', '건축', '마감', '설비', '가구·집기']

function getMeta(s: TLShape): { fill?: string; stroke?: string; phase?: Phase; note?: string; materialId?: string; pattern?: string } {
  return (s.meta ?? {}) as { fill?: string; stroke?: string; phase?: Phase; note?: string; materialId?: string; pattern?: string }
}

export function PropertiesPanel() {
  const editor = useEditor()
  const [selected, setSelected] = useState<TLShape[]>([])
  const [materials] = useState(() => loadMaterialPresets())

  useEffect(() => {
    if (!editor) return
    const update = () => setSelected(editor.getSelectedShapes())
    update()
    const unsub = editor.store.listen(update)
    return unsub
  }, [editor])

  if (!editor || selected.length === 0) {
    return (
      <div className="lbar-panel">
        <div className="lbar-panel-header">속성</div>
        <div className="lbar-panel-body" style={{ color: '#bbb', fontSize: 12, textAlign: 'center', padding: 24 }}>
          객체를 선택하면 속성이 표시됩니다.
        </div>
      </div>
    )
  }

  const types = Array.from(new Set(selected.map(s => s.type)))
  const isSingleType = types.length === 1
  const type = isSingleType ? types[0] : null

  const meta = isSingleType ? getMeta(selected[0]) : {}
  const allSamePhase = selected.every(s => getMeta(s).phase === meta.phase)
  const allSameNote = selected.every(s => getMeta(s).note === meta.note)

  const updateMeta = (changes: Partial<ReturnType<typeof getMeta>>) => {
    selected.forEach(s => {
      editor.updateShape({ id: s.id, type: s.type, meta: { ...s.meta, ...changes } } as never)
    })
  }

  const updateProps = (propsChanges: Record<string, unknown>) => {
    selected.forEach(s => {
      editor.updateShape({ id: s.id, type: s.type, props: { ...s.props, ...propsChanges } } as never)
    })
  }

  return (
    <div className="lbar-panel">
      <div className="lbar-panel-header">속성 ({selected.length}개 선택)</div>
      <div className="lbar-panel-body" style={{ fontSize: 12 }}>
        <PropRow label="타입">
          <span style={{ color: '#666' }}>{isSingleType ? type : `복합 (${types.join(', ')})`}</span>
        </PropRow>

        {isSingleType && (type === 'wall' || type === 'door' || type === 'window') && (
          <PropRow label="두께 (mm)">
            <input
              type="number" min={1}
              value={(selected[0].props as { thickness?: number }).thickness ?? 20}
              onChange={e => updateProps({ thickness: Number(e.target.value) || 20 })}
              style={inputStyle}
            />
          </PropRow>
        )}

        {/* 공종 */}
        <PropRow label="공종">
          <select
            value={allSamePhase ? (meta.phase ?? '') : ''}
            onChange={e => updateMeta({ phase: e.target.value as Phase })}
            style={inputStyle}
          >
            {!allSamePhase && <option value="">(여러 값)</option>}
            {PHASES.map(p => <option key={p} value={p}>{p || '— 미지정 —'}</option>)}
          </select>
        </PropRow>

        {/* 메모 */}
        <PropRow label="메모">
          <input
            type="text"
            value={allSameNote ? (meta.note ?? '') : ''}
            placeholder={allSameNote ? '메모 입력' : '(여러 값)'}
            onChange={e => updateMeta({ note: e.target.value })}
            style={inputStyle}
          />
        </PropRow>

        {/* 재질 (wall/door/window 만) */}
        {isSingleType && (type === 'wall' || type === 'door' || type === 'window') && (
          <>
            <div style={{ marginTop: 12, marginBottom: 6, fontWeight: 600, color: '#666' }}>재질</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {materials.map(c => (
                <button
                  key={c.id ?? c.label}
                  onClick={() => updateMeta({ fill: c.fill, stroke: c.stroke, materialId: c.id, pattern: c.pattern })}
                  style={{
                    padding: '6px 4px', borderRadius: 6, border: `2px solid ${c.stroke}`,
                    background: c.fill, cursor: 'pointer',
                    fontSize: 10, color: '#fff', fontWeight: 600, textShadow: '0 1px 2px rgba(0,0,0,0.4)',
                  }}
                >{c.label}</button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: 4, fontSize: 12, border: '1px solid #ddd', borderRadius: 4,
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
      <span style={{ color: '#888', fontSize: 11 }}>{label}</span>
      <div>{children}</div>
    </div>
  )
}
