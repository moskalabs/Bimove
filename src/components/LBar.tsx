import { useState, useEffect } from 'react'
import { LayersPanel } from './panels/LayersPanel'
import { BlocksPanel } from './panels/BlocksPanel'
import { BOQPanel } from './panels/BOQPanel'
import { MaterialsPanel } from './panels/MaterialsPanel'
import { LayoutPanel } from './panels/LayoutPanel'
import { TracePanel } from './panels/TracePanel'
import { AIPanel } from './panels/AIPanel'
import { useEditor } from '../context/EditorContext'
import { uploadImage } from '../lib/project'
import { importDxf } from '../lib/dxf'

const DRAW_TOOLS = [
  { id: 'select', icon: '↖', label: '선택' },
  { id: 'hand', icon: '✋', label: '이동' },
  { id: 'wall', icon: '▬', label: '벽' },
  { id: 'door', icon: '🚪', label: '문' },
  { id: 'window', icon: '🪟', label: '창문' },
  { id: 'text', icon: '𝖳', label: '텍스트' },
  { id: 'comment', icon: '💬', label: '코멘트' },
  { id: 'dimension', icon: '↔', label: '치수' },
] as const

const PANELS = [
  { id: 'layers', icon: '⊞', label: '도면층' },
  { id: 'blocks', icon: '⬜', label: '블록' },
  { id: 'materials', icon: '◨', label: '재질' },
  { id: 'layout', icon: '⊡', label: '배치' },
  { id: 'table', icon: '≡', label: '테이블' },
  { id: 'trace', icon: '✎', label: '트레이스' },
  { id: 'ai', icon: '✦', label: 'AI' },
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
              {t.icon}
            </button>
          ))}
        </div>

        <div className="lbar-divider" />

        {/* 도면 가져오기 */}
        <div className="lbar-section">
          <button
            className="lbar-icon"
            title="DXF 도면 불러오기 (벽으로 변환)"
            onClick={() => editor && importDxf(editor)}
          >
            📐
          </button>
          <button
            className="lbar-icon"
            title="이미지 업로드 (트레이싱용 배경)"
            onClick={() => editor && uploadImage(editor)}
          >
            🖼
          </button>
        </div>

        <div className="lbar-divider" />

        {/* 뷰 유틸리티 */}
        <div className="lbar-section">
          <button
            className="lbar-icon"
            title="도면에 맞게 보기"
            onClick={() => editor?.zoomToFit({ animation: { duration: 200 } })}
          >
            ⊡
          </button>
          <button
            className="lbar-icon"
            title="100% 보기"
            onClick={() => editor?.resetZoom()}
          >
            ⊘
          </button>
        </div>

        <div className="lbar-divider" />

        <div className="lbar-section">
          {PANELS.map(p => (
            <button
              key={p.id}
              className={`lbar-icon${activePanel === p.id ? ' active' : ''}`}
              title={p.label}
              onClick={() => togglePanel(p.id)}
            >
              {p.icon}
            </button>
          ))}
        </div>
      </aside>

      {activePanel === 'layers' && <LayersPanel />}
      {activePanel === 'blocks' && <BlocksPanel />}
      {activePanel === 'table' && <BOQPanel />}
      {activePanel === 'materials' && <MaterialsPanel />}
      {activePanel === 'layout' && <LayoutPanel />}
      {activePanel === 'trace' && <TracePanel />}
      {activePanel === 'ai' && <AIPanel />}
    </>
  )
}
