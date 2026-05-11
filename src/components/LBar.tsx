import { useState } from 'react'
import { LayersPanel } from './panels/LayersPanel'
import { BlocksPanel } from './panels/BlocksPanel'

const PANELS = [
  { id: 'menu', icon: '☰', label: '메뉴' },
  { id: 'layers', icon: '⊞', label: '도면층' },
  { id: 'blocks', icon: '⬜', label: '블록' },
  { id: 'materials', icon: '◨', label: '재질' },
  { id: 'layout', icon: '⊡', label: '배치' },
  { id: 'table', icon: '≡', label: '테이블' },
  { id: 'trace', icon: '✎', label: '트레이스' },
  { id: 'ai', icon: '✦', label: 'AI' },
] as const

type PanelId = typeof PANELS[number]['id']

export function LBar() {
  const [activePanel, setActivePanel] = useState<PanelId | null>(null)

  const toggle = (id: PanelId) =>
    setActivePanel(prev => prev === id ? null : id)

  return (
    <>
      <aside className="lbar">
        {PANELS.map(p => (
          <button
            key={p.id}
            className={`lbar-icon${activePanel === p.id ? ' active' : ''}`}
            title={p.label}
            onClick={() => toggle(p.id)}
          >
            {p.icon}
          </button>
        ))}
      </aside>

      {activePanel === 'layers' && <LayersPanel />}
      {activePanel === 'blocks' && <BlocksPanel />}
      {activePanel && !['layers', 'blocks'].includes(activePanel) && (
        <div className="lbar-panel">
          <div className="lbar-panel-header">{PANELS.find(p => p.id === activePanel)?.label}</div>
          <div className="lbar-panel-body" style={{ color: '#999', fontSize: 13, padding: 16 }}>
            준비 중
          </div>
        </div>
      )}
    </>
  )
}
