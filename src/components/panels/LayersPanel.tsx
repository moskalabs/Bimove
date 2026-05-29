import { useState, useEffect } from 'react'
import { useEditor } from '../../context/EditorContext'
import { loadMaterialPresets } from '../../lib/materialPresets'

type LayerDef = {
  type: string
  label: string
  color: string
}

const LAYER_DEFS: LayerDef[] = [
  { type: 'wall',   label: '벽',   color: '#555' },
  { type: 'door',   label: '문',   color: '#1a73e8' },
  { type: 'window', label: '창문', color: '#0097a7' },
  { type: 'block',  label: '블록', color: '#7b1fa2' },
  { type: 'text',   label: '텍스트', color: '#e65100' },
  { type: 'image',  label: '이미지', color: '#388e3c' },
]

const PHASE_COLORS: Record<string, string> = {
  '구조': '#c0392b',
  '건축': '#2980b9',
  '마감': '#16a085',
  '설비': '#f39c12',
  '가구·집기': '#8e44ad',
}

type Tab = 'type' | 'phase' | 'material'

export function LayersPanel() {
  const editor = useEditor()
  const [tab, setTab] = useState<Tab>('type')
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [phaseCounts, setPhaseCounts] = useState<Record<string, number>>({})
  const [materialCounts, setMaterialCounts] = useState<Record<string, number>>({})
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const presets = loadMaterialPresets()

  useEffect(() => {
    if (!editor) return
    const update = () => {
      const c: Record<string, number> = {}
      const pc: Record<string, number> = {}
      const mc: Record<string, number> = {}
      for (const s of editor.getCurrentPageShapes()) {
        c[s.type] = (c[s.type] ?? 0) + 1
        const meta = s.meta as { phase?: string; materialId?: string }
        if (meta.phase) pc[meta.phase] = (pc[meta.phase] ?? 0) + 1
        if (meta.materialId) mc[meta.materialId] = (mc[meta.materialId] ?? 0) + 1
      }
      setCounts(c)
      setPhaseCounts(pc)
      setMaterialCounts(mc)
    }
    update()
    const unsub = editor.store.listen(update)
    return unsub
  }, [editor])

  // ---- 공통 visibility helper ----
  const toggleHide = (key: string, filter: (s: { type: string; meta: unknown }) => boolean) => {
    if (!editor) return
    const shapes = editor.getCurrentPageShapes().filter(filter)
    if (hidden.has(key)) {
      for (const s of shapes) editor.updateShape({ id: s.id, type: s.type as never, opacity: 1 })
      setHidden(prev => { const n = new Set(prev); n.delete(key); return n })
    } else {
      for (const s of shapes) editor.updateShape({ id: s.id, type: s.type as never, opacity: 0 })
      setHidden(prev => new Set([...prev, key]))
    }
  }

  const selectFilter = (filter: (s: { type: string; meta: unknown }) => boolean) => {
    if (!editor) return
    const ids = editor.getCurrentPageShapes().filter(filter).map(s => s.id)
    if (ids.length) editor.setSelectedShapes(ids)
  }

  // ---- 데이터 ----
  const typeLayers = LAYER_DEFS.filter(l => (counts[l.type] ?? 0) > 0)
  const phaseLayers = Object.entries(phaseCounts).map(([phase, count]) => ({
    key: 'phase:' + phase, label: phase, color: PHASE_COLORS[phase] ?? '#888', count,
  }))
  const materialLayers = Object.entries(materialCounts).map(([id, count]) => {
    const m = presets.find(p => p.id === id)
    return { key: 'mat:' + id, label: m?.label ?? id, color: m?.fill ?? '#888', count, materialId: id }
  })

  return (
    <div className="lbar-panel">
      <div className="lbar-panel-header">도면층 / 시각화</div>

      <div style={{ display: 'flex', borderBottom: '1px solid #eee' }}>
        {(['type', 'phase', 'material'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '6px 0', fontSize: 11, border: 'none', cursor: 'pointer',
            background: tab === t ? '#f0f4ff' : 'transparent',
            color: tab === t ? '#1a73e8' : '#666',
            borderBottom: tab === t ? '2px solid #1a73e8' : '2px solid transparent',
          }}>
            {t === 'type' ? '도면층' : t === 'phase' ? '공종' : '자재'}
          </button>
        ))}
      </div>

      <div className="lbar-panel-body" style={{ padding: '8px 0' }}>
        {tab === 'type' && (
          typeLayers.length === 0 ? (
            <Empty msg="도면을 그리면 표시됩니다." />
          ) : (
            typeLayers.map(l => (
              <LayerRow
                key={l.type} label={l.label} color={l.color} count={counts[l.type]}
                hidden={hidden.has(l.type)}
                onSelect={() => selectFilter(s => s.type === l.type)}
                onToggle={() => toggleHide(l.type, s => s.type === l.type)}
              />
            ))
          )
        )}
        {tab === 'phase' && (
          phaseLayers.length === 0 ? (
            <Empty msg="공종 미지정 — 속성 패널에서 객체에 공종을 설정해보세요." />
          ) : (
            phaseLayers.map(l => (
              <LayerRow
                key={l.key} label={l.label} color={l.color} count={l.count}
                hidden={hidden.has(l.key)}
                onSelect={() => selectFilter(s => (s.meta as { phase?: string })?.phase === l.label)}
                onToggle={() => toggleHide(l.key, s => (s.meta as { phase?: string })?.phase === l.label)}
              />
            ))
          )
        )}
        {tab === 'material' && (
          materialLayers.length === 0 ? (
            <Empty msg="자재 미지정 — 재질 패널에서 자재를 적용해보세요." />
          ) : (
            materialLayers.map(l => (
              <LayerRow
                key={l.key} label={l.label} color={l.color} count={l.count}
                hidden={hidden.has(l.key)}
                onSelect={() => selectFilter(s => (s.meta as { materialId?: string })?.materialId === l.materialId)}
                onToggle={() => toggleHide(l.key, s => (s.meta as { materialId?: string })?.materialId === l.materialId)}
              />
            ))
          )
        )}
      </div>
    </div>
  )
}

function LayerRow({ label, color, count, hidden, onSelect, onToggle }: {
  label: string; color: string; count: number; hidden: boolean
  onSelect: () => void; onToggle: () => void
}) {
  return (
    <div className="layer-row" onClick={onSelect}>
      <span className="layer-dot" style={{ background: color, opacity: hidden ? 0.3 : 1 }} />
      <span style={{ flex: 1, opacity: hidden ? 0.4 : 1 }}>{label}</span>
      <span style={{ fontSize: 11, color: '#999', marginRight: 8 }}>{count}</span>
      <button
        style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, padding: '0 4px', color: '#aaa' }}
        onClick={e => { e.stopPropagation(); onToggle() }}
        title={hidden ? '표시' : '숨기기'}
      >
        {hidden ? '🙈' : '👁'}
      </button>
    </div>
  )
}

function Empty({ msg }: { msg: string }) {
  return <div style={{ color: '#999', fontSize: 13, padding: '12px 16px', lineHeight: 1.6 }}>{msg}</div>
}
