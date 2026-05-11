import { useState, useEffect } from 'react'
import { useEditor } from '../../context/EditorContext'

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

export function LayersPanel() {
  const editor = useEditor()
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!editor) return
    const update = () => {
      const c: Record<string, number> = {}
      for (const s of editor.getCurrentPageShapes()) {
        c[s.type] = (c[s.type] ?? 0) + 1
      }
      setCounts(c)
    }
    update()
    const unsub = editor.store.listen(update)
    return unsub
  }, [editor])

  const toggleVisibility = (type: string) => {
    if (!editor) return
    const shapes = editor.getCurrentPageShapes().filter(s => s.type === type)
    if (hidden.has(type)) {
      // show: restore opacity 1
      for (const s of shapes) editor.updateShape({ id: s.id, type: s.type as never, opacity: 1 })
      setHidden(prev => { const n = new Set(prev); n.delete(type); return n })
    } else {
      // hide: set opacity 0
      for (const s of shapes) editor.updateShape({ id: s.id, type: s.type as never, opacity: 0 })
      setHidden(prev => new Set([...prev, type]))
    }
  }

  const selectLayer = (type: string) => {
    if (!editor) return
    const ids = editor.getCurrentPageShapes().filter(s => s.type === type).map(s => s.id)
    if (ids.length) editor.setSelectedShapes(ids)
  }

  const layers = LAYER_DEFS.filter(l => (counts[l.type] ?? 0) > 0)
  const others = Object.entries(counts).filter(([t]) => !LAYER_DEFS.find(l => l.type === t))

  return (
    <div className="lbar-panel">
      <div className="lbar-panel-header">도면층</div>
      <div className="lbar-panel-body" style={{ padding: '8px 0' }}>
        {layers.length === 0 ? (
          <div style={{ color: '#999', fontSize: 13, padding: '12px 16px' }}>도면을 그리면 표시됩니다.</div>
        ) : (
          layers.map(l => (
            <div key={l.type} className="layer-row" onClick={() => selectLayer(l.type)}>
              <span
                className="layer-dot"
                style={{ background: l.color, opacity: hidden.has(l.type) ? 0.3 : 1 }}
              />
              <span style={{ flex: 1, opacity: hidden.has(l.type) ? 0.4 : 1 }}>{l.label}</span>
              <span style={{ fontSize: 11, color: '#999', marginRight: 8 }}>{counts[l.type]}</span>
              <button
                style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, padding: '0 4px', color: '#aaa' }}
                onClick={e => { e.stopPropagation(); toggleVisibility(l.type) }}
                title={hidden.has(l.type) ? '표시' : '숨기기'}
              >
                {hidden.has(l.type) ? '🙈' : '👁'}
              </button>
            </div>
          ))
        )}
        {others.map(([type, count]) => (
          <div key={type} className="layer-row" onClick={() => selectLayer(type)}>
            <span className="layer-dot" style={{ background: '#999' }} />
            <span style={{ flex: 1 }}>{type}</span>
            <span style={{ fontSize: 11, color: '#999', marginRight: 8 }}>{count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
