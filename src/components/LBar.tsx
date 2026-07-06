import { useState } from 'react'
import {
  ClipboardList, Layers, Square, Settings, MessageSquare,
  Palette, LayoutGrid, Upload, Pencil, Sparkles,
} from 'lucide-react'
import { LayersPanel } from './panels/LayersPanel'
import { BlocksPanel } from './panels/BlocksPanel'
import { BOQPanel } from './panels/BOQPanel'
import { MaterialsPanel } from './panels/MaterialsPanel'
import { PropertiesPanel } from './panels/PropertiesPanel'
import { CommentsPanel } from './panels/CommentsPanel'
import { LayoutPanel } from './panels/LayoutPanel'
import { TracePanel } from './panels/TracePanel'
import { AIPanel } from './panels/AIPanel'
import { ImportPanel } from './panels/ImportPanel'

// 물량 산출(BOQ) 자동화가 MVP 메인 기능 — 맨 앞에 배치
const PANELS = [
  { id: 'table', icon: ClipboardList, label: '물량산출' },
  { id: 'layers', icon: Layers, label: '도면층' },
  { id: 'blocks', icon: Square, label: '블록' },
  { id: 'properties', icon: Settings, label: '속성' },
  { id: 'comments', icon: MessageSquare, label: '코멘트' },
  { id: 'materials', icon: Palette, label: '재질' },
  { id: 'layout', icon: LayoutGrid, label: '배치' },
  { id: 'import', icon: Upload, label: '가져오기' },
  { id: 'trace', icon: Pencil, label: '트레이스' },
  { id: 'ai', icon: Sparkles, label: 'AI' },
] as const

type PanelId = typeof PANELS[number]['id']

export function LBar() {
  const [activePanel, setActivePanel] = useState<PanelId | null>(null)

  const togglePanel = (id: PanelId) =>
    setActivePanel(prev => prev === id ? null : id)

  return (
    <>
      <aside className="lbar">
        <div className="lbar-section">
          {PANELS.map(p => (
            <button
              key={p.id}
              className={`lbar-icon${activePanel === p.id ? ' active' : ''}${p.id === 'table' ? ' lbar-icon-primary' : ''}`}
              title={p.label}
              onClick={() => togglePanel(p.id)}
            >
              <p.icon size={18} strokeWidth={1.75} />
            </button>
          ))}
        </div>
      </aside>

      {activePanel === 'layers' && <LayersPanel />}
      {activePanel === 'blocks' && <BlocksPanel />}
      {activePanel === 'table' && <BOQPanel />}
      {activePanel === 'materials' && <MaterialsPanel />}
      {activePanel === 'properties' && <PropertiesPanel />}
      {activePanel === 'comments' && <CommentsPanel />}
      {activePanel === 'layout' && <LayoutPanel />}
      {activePanel === 'import' && <ImportPanel />}
      {activePanel === 'trace' && <TracePanel />}
      {activePanel === 'ai' && <AIPanel />}
    </>
  )
}
