import { useState } from 'react'
import {
  Menu, Layers, Palette, FileText, Info,
} from 'lucide-react'
import { LayersPanel } from './panels/LayersPanel'
import { BOQPanel } from './panels/BOQPanel'
import { MaterialsPanel } from './panels/MaterialsPanel'
import { LayoutPanel } from './panels/LayoutPanel'
import { ImportPanel } from './panels/ImportPanel'
import { useEditor } from '../context/EditorContext'
import { exportDxf } from '../lib/dxf'
import { exportPng } from '../lib/exportPng'

/* ── 햄버거 메뉴 드롭다운 ── */
function HamburgerMenu({ open, onClose, onImport }: { open: boolean; onClose: () => void; onImport: () => void }) {
  const editor = useEditor()
  const [exportSub, setExportSub] = useState(false)

  if (!open) return null

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1100 }}
      onClick={() => { onClose(); setExportSub(false) }}
    >
      <div className="lbar-menu-dropdown" onClick={(e) => e.stopPropagation()}>
        <div className="lbar-menu-section">
          <div className="lbar-menu-header">홈</div>
          <div className="lbar-menu-item active">● Drawing 1</div>
          <div className="lbar-menu-item">&nbsp;&nbsp;&nbsp;Drawing 2</div>
          <div className="lbar-menu-item lbar-menu-add">+ 새로 만들기</div>
        </div>
        <div className="lbar-menu-divider" />
        <div className="lbar-menu-section">
          <div className="lbar-menu-item lbar-menu-has-sub" onClick={() => { onImport(); onClose(); setExportSub(false) }}>
            가져오기
            <span className="lbar-menu-arrow">›</span>
          </div>
          <div className="lbar-menu-item lbar-menu-has-sub" style={{ position: 'relative' }}
            onClick={() => setExportSub(!exportSub)}
          >
            내보내기
            <span className="lbar-menu-arrow">›</span>
            {exportSub && (
              <div className="lbar-menu-sub" onClick={(e) => e.stopPropagation()}>
                <div className="lbar-menu-item" onClick={() => { editor && exportDxf(editor); onClose(); setExportSub(false) }}>
                  📐 DXF 내보내기
                </div>
                <div className="lbar-menu-item" onClick={() => { editor && exportPng(editor); onClose(); setExportSub(false) }}>
                  🖼 PNG 내보내기
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="lbar-menu-divider" />
        <div className="lbar-menu-section">
          <div className="lbar-menu-item">공유</div>
          <div className="lbar-menu-item" onClick={() => { window.print(); onClose() }}>인쇄</div>
        </div>
        <div className="lbar-menu-divider" />
        <div className="lbar-menu-section">
          <div className="lbar-menu-item">옵션</div>
        </div>
      </div>
    </div>
  )
}

/* ── 테이블(물량) 아이콘 ── */
function TableIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  )
}

/* ── 2D/3D 토글 아이콘 ── */
function View3DIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v18" />
      <ellipse cx="12" cy="12" rx="9" ry="4" />
    </svg>
  )
}

type PanelId = 'layers' | 'materials' | 'table' | 'layout' | 'import' | null

export function LBar() {
  const [activePanel, setActivePanel] = useState<PanelId>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const togglePanel = (id: Exclude<PanelId, null>) =>
    setActivePanel(prev => prev === id ? null : id)

  const openImportPanel = () => {
    setActivePanel('import')
  }

  return (
    <>
      <aside className="lbar">
        {/* ── 섹션 1: 메뉴 ── */}
        <div className="lbar-section">
          <button
            className={`lbar-icon${menuOpen ? ' active' : ''}`}
            title="메뉴"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Menu size={18} strokeWidth={1.75} />
          </button>
        </div>

        <div className="lbar-divider" />

        {/* ── 섹션 2: 모듈 ── */}
        <div className="lbar-section">
          <button
            className={`lbar-icon${activePanel === 'layers' ? ' active' : ''}`}
            title="레이어"
            onClick={() => togglePanel('layers')}
          >
            <Layers size={18} strokeWidth={1.75} />
          </button>
          <button
            className={`lbar-icon${activePanel === 'materials' ? ' active' : ''}`}
            title="재질"
            onClick={() => togglePanel('materials')}
          >
            <Palette size={18} strokeWidth={1.75} />
          </button>
          <button
            className={`lbar-icon${activePanel === 'table' ? ' active' : ''}`}
            title="테이블"
            onClick={() => togglePanel('table')}
          >
            <TableIcon />
          </button>
          <button
            className={`lbar-icon${activePanel === 'layout' ? ' active' : ''}`}
            title="배치"
            onClick={() => togglePanel('layout')}
          >
            <FileText size={18} strokeWidth={1.75} />
          </button>
        </div>

        {/* spacer */}
        <div style={{ flex: 1 }} />

        {/* ── 섹션 3: 정보 ── */}
        <div className="lbar-section">
          <button
            className="lbar-icon"
            title="2D/3D 전환"
          >
            <View3DIcon />
          </button>
          <button
            className="lbar-icon"
            title="정보 · 도움말"
            onClick={() => window.open('https://bimove.vercel.app/help', '_blank')}
          >
            <Info size={18} strokeWidth={1.75} />
          </button>
        </div>
      </aside>

      {/* 햄버거 메뉴 드롭다운 */}
      <HamburgerMenu open={menuOpen} onClose={() => setMenuOpen(false)} onImport={openImportPanel} />

      {/* 패널 */}
      {activePanel === 'layers' && <LayersPanel />}
      {activePanel === 'table' && <BOQPanel />}
      {activePanel === 'materials' && <MaterialsPanel />}
      {activePanel === 'layout' && <LayoutPanel />}
      {activePanel === 'import' && <ImportPanel />}
    </>
  )
}
