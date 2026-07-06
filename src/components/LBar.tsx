import { useState, useEffect } from 'react'
import {
  MousePointer2, Hand, Rows3, DoorOpen, PanelTop, Type, MessageSquare, Ruler,
  Undo2, Redo2, Trash2, Maximize, RotateCcw,
  ClipboardList, Layers, Square, Settings, Palette, LayoutGrid, Upload, Pencil, Sparkles,
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
import { useEditor } from '../context/EditorContext'

const DRAW_TOOLS = [
  { id: 'select', icon: MousePointer2, label: '선택' },
  { id: 'hand', icon: Hand, label: '이동' },
  { id: 'wall', icon: Rows3, label: '벽' },
  { id: 'door', icon: DoorOpen, label: '문' },
  { id: 'window', icon: PanelTop, label: '창문' },
  { id: 'text', icon: Type, label: '텍스트' },
  { id: 'comment', icon: MessageSquare, label: '코멘트' },
  { id: 'dimension', icon: Ruler, label: '치수' },
] as const

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
type ToolId = typeof DRAW_TOOLS[number]['id']

export function LBar() {
  const editor = useEditor()
  const [activePanel, setActivePanel] = useState<PanelId | null>(null)
  const [activeTool, setActiveTool] = useState<ToolId>('select')

  useEffect(() => {
    if (!editor) return
    const unsub = editor.store.listen(() => {
      const current = editor.getCurrentToolId()
      const match = DRAW_TOOLS.find(t => t.id === current)
      if (match) setActiveTool(match.id)
    })
    return unsub
  }, [editor])

  const selectTool = (id: ToolId) => {
    editor?.setCurrentTool(id)
    setActiveTool(id)
  }

  const togglePanel = (id: PanelId) =>
    setActivePanel(prev => prev === id ? null : id)

  return (
    <>
      <aside className="lbar">
        <div className="lbar-section">
          {DRAW_TOOLS.map(t => (
            <button
              key={t.id}
              className={`lbar-icon${activeTool === t.id ? ' active' : ''}`}
              title={t.label}
              onClick={() => selectTool(t.id)}
            >
              <t.icon size={18} strokeWidth={1.75} />
            </button>
          ))}
        </div>

        <div className="lbar-divider" />

        {/* 편집 액션 */}
        <div className="lbar-section">
          <button className="lbar-icon" title="실행 취소 (Ctrl+Z)" onClick={() => editor?.undo()}><Undo2 size={18} strokeWidth={1.75} /></button>
          <button className="lbar-icon" title="다시 실행 (Ctrl+Y)" onClick={() => editor?.redo()}><Redo2 size={18} strokeWidth={1.75} /></button>
          <button
            className="lbar-icon"
            title="선택 삭제 (Delete)"
            onClick={() => { const ids = editor?.getSelectedShapeIds() ?? []; if (ids.length) editor?.deleteShapes(ids) }}
          ><Trash2 size={18} strokeWidth={1.75} /></button>
        </div>

        <div className="lbar-divider" />

        {/* 뷰 유틸리티 */}
        <div className="lbar-section">
          <button
            className="lbar-icon"
            title="도면에 맞게 보기"
            onClick={() => editor?.zoomToFit({ animation: { duration: 200 } })}
          >
            <Maximize size={18} strokeWidth={1.75} />
          </button>
          <button
            className="lbar-icon"
            title="100% 보기"
            onClick={() => editor?.resetZoom()}
          >
            <RotateCcw size={18} strokeWidth={1.75} />
          </button>
        </div>

        <div className="lbar-divider" />

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
