import React, { useState, useEffect } from 'react'
import {
  MousePointer2, Undo2, Redo2, ChevronDown,
  Minus, Spline, Square, Circle,
  Copy, Move, RotateCw,
  Ruler, Type,
} from 'lucide-react'
import { PageRecordType } from 'tldraw'
import { useEditor } from '../context/EditorContext'

/* ── 커스텀 SVG 아이콘 (건축 특화, 모노톤) ── */
function WallIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="18" height="12" rx="1" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="9" y1="6" x2="9" y2="12" />
      <line x1="15" y1="12" x2="15" y2="18" />
    </svg>
  )
}

function OpeningIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h4" />
      <path d="M17 12h4" />
      <rect x="7" y="7" width="10" height="10" rx="1" strokeDasharray="3 2" />
      <path d="M10 7v10" />
    </svg>
  )
}

function SpaceDivideIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="12" y1="3" x2="12" y2="21" />
    </svg>
  )
}

function ZoneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="4 2" />
      <text x="12" y="14" textAnchor="middle" fontSize="7" fill="currentColor" stroke="none" fontWeight="600">A</text>
    </svg>
  )
}

function LeaderIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 18L12 10h6" />
      <circle cx="6" cy="18" r="1.5" fill="currentColor" />
      <line x1="18" y1="8" x2="18" y2="12" />
    </svg>
  )
}

/* ── 도구 그룹 정의 ── */
type ToolDef = {
  id: string
  label: string
  render: () => React.JSX.Element
}

function lucideBtn(Icon: typeof MousePointer2) {
  return () => <Icon size={18} strokeWidth={1.75} />
}

const GROUP_BASIC: ToolDef[] = [
  { id: 'select', label: '선택', render: lucideBtn(MousePointer2) },
]

const GROUP_SPACE: ToolDef[] = [
  { id: 'space-divide', label: '공간나누기', render: SpaceDivideIcon },
  { id: 'wall', label: '벽체', render: WallIcon },
  { id: 'opening', label: '개구부', render: OpeningIcon },
  { id: 'zone', label: '공간지정', render: ZoneIcon },
]

const GROUP_DRAW: ToolDef[] = [
  { id: 'line', label: '선', render: lucideBtn(Minus) },
  { id: 'polyline', label: '폴리라인', render: lucideBtn(Spline) },
  { id: 'rect', label: '사각형', render: lucideBtn(Square) },
  { id: 'circle', label: '원형', render: lucideBtn(Circle) },
]

const GROUP_EDIT: ToolDef[] = [
  { id: 'copy-tool', label: '복사', render: lucideBtn(Copy) },
  { id: 'move-tool', label: '이동', render: lucideBtn(Move) },
  { id: 'rotate-tool', label: '회전', render: lucideBtn(RotateCw) },
]

const GROUP_ANNOTATE: ToolDef[] = [
  { id: 'dimension', label: '치수', render: lucideBtn(Ruler) },
  { id: 'text', label: '문자', render: lucideBtn(Type) },
  { id: 'leader', label: '지시선', render: LeaderIcon },
]

/* tldraw 도구 ID 매핑 (기존 커스텀 도구와 연결) */
const TOOL_MAP: Record<string, string> = {
  'select': 'select',
  'wall': 'wall',
  'opening': 'door',
  'text': 'text',
  'dimension': 'dimension',
}

function ToolButton({ tool, active, onClick }: { tool: ToolDef; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`topbar-btn${active ? ' active' : ''}`}
      title={tool.label}
      data-tool={tool.id}
      onClick={onClick}
    >
      {tool.render()}
    </button>
  )
}

function ToolGroup({ tools, activeTool, onSelect }: { tools: ToolDef[]; activeTool: string; onSelect: (id: string) => void }) {
  return (
    <>
      {tools.map(t => (
        <ToolButton key={t.id} tool={t} active={activeTool === t.id} onClick={() => onSelect(t.id)} />
      ))}
    </>
  )
}

export function TopBar() {
  const editor = useEditor()
  const [activeTool, setActiveTool] = useState('select')
  const [showDropdown, setShowDropdown] = useState(false)

  // ── 페이지(Drawing) 목록 + 현재 페이지 추적 ──
  const [pages, setPages] = useState<Array<{ id: string; name: string }>>([])
  const [currentPageId, setCurrentPageId] = useState<string>('')

  useEffect(() => {
    if (!editor) return
    // 초기값
    const syncPages = () => {
      const ps = editor.getPages().map(p => ({ id: p.id, name: p.name }))
      setPages(ps)
      setCurrentPageId(editor.getCurrentPageId())
    }
    syncPages()

    let prevTool = ''
    let prevPageId = editor.getCurrentPageId()
    let prevPageCount = editor.getPages().length
    const unsub = editor.store.listen(() => {
      // 도구 변경 추적
      const current = editor.getCurrentToolId()
      if (current !== prevTool) {
        prevTool = current
        const reverseMap = Object.entries(TOOL_MAP).find(([, v]) => v === current)
        if (reverseMap) setActiveTool(reverseMap[0])
      }
      // 페이지 변경만 추적 (매번 sync 방지)
      const curPageId = editor.getCurrentPageId()
      const curPageCount = editor.getPages().length
      if (curPageId !== prevPageId || curPageCount !== prevPageCount) {
        prevPageId = curPageId
        prevPageCount = curPageCount
        syncPages()
      }
    })
    return unsub
  }, [editor])

  const switchPage = (pageId: string) => {
    if (!editor) return
    editor.setCurrentPage(pageId as never)
    setShowDropdown(false)
  }

  const addPage = () => {
    if (!editor) return
    const num = editor.getPages().length + 1
    const newPageId = PageRecordType.createId()
    editor.createPage({ name: `Drawing ${num}`, id: newPageId })
    editor.setCurrentPage(newPageId)
    setShowDropdown(false)
  }

  const selectTool = (id: string) => {
    setActiveTool(id)

    const mapped = TOOL_MAP[id]
    if (mapped && editor) {
      editor.setCurrentTool(mapped)
    }

    if (id === 'copy-tool' && editor) {
      const ids = editor.getSelectedShapeIds()
      if (ids.length) editor.duplicateShapes(ids, { x: 20, y: 20 })
    }
    if (id === 'move-tool' && editor) {
      editor.setCurrentTool('select')
    }
  }

  const currentPageName = pages.find(p => p.id === currentPageId)?.name || 'Drawing 1'

  return (
    <div className="topbar">
      {/* 기본 */}
      <div className="topbar-group">
        <div className="topbar-project-tab" onClick={() => setShowDropdown(!showDropdown)}>
          <span className="topbar-project-name">{currentPageName}</span>
          <ChevronDown size={14} strokeWidth={2} />
          {showDropdown && (
            <div className="topbar-dropdown">
              {pages.map(p => (
                <div
                  key={p.id}
                  className={`topbar-dropdown-item${p.id === currentPageId ? ' active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); switchPage(p.id) }}
                >
                  {p.name}
                </div>
              ))}
              <div
                className="topbar-dropdown-item topbar-dropdown-add"
                onClick={(e) => { e.stopPropagation(); addPage() }}
              >
                + 새 도면
              </div>
            </div>
          )}
        </div>
        <ToolGroup tools={GROUP_BASIC} activeTool={activeTool} onSelect={selectTool} />
        <button className="topbar-btn" title="명령 취소 (Ctrl+Z)" onClick={() => editor?.undo()}>
          <Undo2 size={18} strokeWidth={1.75} />
        </button>
        <button className="topbar-btn" title="명령 복구 (Ctrl+Y)" onClick={() => editor?.redo()}>
          <Redo2 size={18} strokeWidth={1.75} />
        </button>
      </div>

      {/* 공간 설정 */}
      <div className="topbar-group">
        <ToolGroup tools={GROUP_SPACE} activeTool={activeTool} onSelect={selectTool} />
      </div>

      {/* 그리기 */}
      <div className="topbar-group">
        <ToolGroup tools={GROUP_DRAW} activeTool={activeTool} onSelect={selectTool} />
      </div>

      {/* 편집(수정) */}
      <div className="topbar-group">
        <ToolGroup tools={GROUP_EDIT} activeTool={activeTool} onSelect={selectTool} />
      </div>

      {/* 주석 */}
      <div className="topbar-group">
        <ToolGroup tools={GROUP_ANNOTATE} activeTool={activeTool} onSelect={selectTool} />
      </div>
    </div>
  )
}
