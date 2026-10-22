import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Menu, Layers, Palette, FileText, Info, ArrowLeftCircle, MessageSquare,
} from 'lucide-react'
import { LayersPanel } from './panels/LayersPanel'
import { BOQPanel } from './panels/BOQPanel'
import { MaterialsPanel } from './panels/MaterialsPanel'
import { LayoutPanel } from './panels/LayoutPanel'
import { CommentsPanel } from './panels/CommentsPanel'
import { getThreads, rawThreads, unresolvedCount } from '../lib/commentStore'
import { EditLock } from './EditLock'
import { useImportActions, type ImportKind } from './useImportActions'
import { saveProject } from '../lib/project'
import { useEditor } from '../context/EditorContext'
import { useReadonly } from '../context/ReadonlyContext'
import { useProjectId, useProjectName } from '../context/ProjectContext'
import { exportDxf } from '../lib/dxf'
import { exportPng } from '../lib/exportPng'
import { printReport } from '../lib/reportExport'

/* ── 햄버거 메뉴 드롭다운 ── */
// export 는 테스트용이다 — LBar 를 통째로 띄우면 editor 목이 필요하다.
export function HamburgerMenu({ open, onClose, onImport }: {
  open: boolean
  onClose: () => void
  onImport: (kind: ImportKind) => void
}) {
  const editor = useEditor()
  const readonly = useReadonly()
  const projectId = useProjectId()
  // 이름은 ProjectNameContext 가 들고 있다. 여기서 localStorage 목록을 직접
  // 뒤지면 (a) 대시보드(서버)에서 연 프로젝트는 그 목록에 없고 (b) 도면을
  // 막 가져온 직후엔 저장 디바운스(800ms) 전이라, 둘 다 "새 프로젝트" 로
  // 보인다. RBar 의 "파일명" 칸은 진짜 이름을 보여주는데 이 메뉴만 어긋났다.
  const { name: projectName } = useProjectName()
  // 서브창은 한 번에 하나만 — 가져오기와 내보내기가 겹쳐 뜨면 어느 쪽 항목인지
  // 알 수 없다.
  const [openSub, setOpenSub] = useState<'import' | 'export' | null>(null)
  const closeAll = () => { onClose(); setOpenSub(null) }

  if (!open) return null

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1100 }}
      onClick={closeAll}
    >
      <div className="lbar-menu-dropdown" onClick={(e) => e.stopPropagation()}>
        <div className="lbar-menu-section">
          <div className="lbar-menu-header">홈</div>
          <div className="lbar-menu-item active">● {projectName.trim() || '새 프로젝트'}</div>
        </div>
        <div className="lbar-menu-divider" />
        <div className="lbar-menu-section">
          {/* 가져오기는 도면을 바꾸는 일이라 읽기 전용에서 뺀다.
              내보내기는 그대로 둔다 — 현장에서 PDF 로 빼는 건 보기 쪽 일이다. */}
          {!readonly && (
            <div className="lbar-menu-item lbar-menu-has-sub" style={{ position: 'relative' }}
              onClick={() => setOpenSub(openSub === 'import' ? null : 'import')}
            >
              가져오기
              <span className="lbar-menu-arrow">›</span>
              {openSub === 'import' && (
                <div className="lbar-menu-sub" onClick={(e) => e.stopPropagation()}>
                  <div className="lbar-menu-item" onClick={() => { onImport('cad'); closeAll() }}>
                    📐 DXF / DWG 도면
                  </div>
                  <div className="lbar-menu-item" onClick={() => { onImport('pdf'); closeAll() }}>
                    📄 PDF 도면
                  </div>
                  <div className="lbar-menu-item" onClick={() => { onImport('image'); closeAll() }}>
                    🖼 이미지 배경
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="lbar-menu-item lbar-menu-has-sub" style={{ position: 'relative' }}
            onClick={() => setOpenSub(openSub === 'export' ? null : 'export')}
          >
            내보내기
            <span className="lbar-menu-arrow">›</span>
            {openSub === 'export' && (
              <div className="lbar-menu-sub" onClick={(e) => e.stopPropagation()}>
                <div className="lbar-menu-item" onClick={() => { if (editor) exportDxf(editor); closeAll() }}>
                  📐 DXF 내보내기
                </div>
                <div className="lbar-menu-item" onClick={() => { if (editor) exportPng(editor); closeAll() }}>
                  🖼 PNG 내보내기
                </div>
                <div className="lbar-menu-item" onClick={() => { if (editor) printReport(editor, { projectId: projectId || undefined }); closeAll() }}>
                  📋 리포트 내보내기
                </div>
                {/* "저장" 이 아니라 **내보내기**다. 이 앱은 서버가 정본이고 계속
                    자동 저장되므로, "저장" 버튼이 있으면 "그럼 지금까지는 저장이
                    안 된 건가" 로 읽힌다. 이건 계정 밖으로 들고 나가는 파일이다. */}
                <div className="lbar-menu-item" onClick={() => { if (editor) void saveProject(editor, projectName.trim() || '도면'); closeAll() }}>
                  📁 .bimova 파일로 내보내기
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="lbar-menu-divider" />
        <div className="lbar-menu-section">
          {/* '공유' 는 추후. 눌러도 아무 일이 안 나는 항목은 비어 있는 게
              아니라 **고장 난 것처럼** 보여서 일단 가린다. 지우지 않는 건
              곧 붙일 자리이기 때문이다. */}
          {/* <div className="lbar-menu-item">공유</div> */}
          <div className="lbar-menu-item" onClick={() => { window.print(); closeAll() }}>인쇄</div>
        </div>
        {/* '옵션' 도 추후. 이 항목은 **섹션에 혼자** 있어서 항목만 가리면
            구분선과 빈 섹션이 남는다 — 메뉴 바닥에 줄만 하나 그어진 꼴이 된다.
            그래서 껍데기까지 통째로 묶는다. */}
        {/*
        <div className="lbar-menu-divider" />
        <div className="lbar-menu-section">
          <div className="lbar-menu-item">옵션</div>
        </div>
        */}
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

type PanelId = 'layers' | 'materials' | 'table' | 'layout' | 'comments' | null

/** 레일 아이콘에 붙일 "아직 안 본 것" 숫자 — 열려 있는 코멘트 수. */
function useUnresolvedComments(): number {
  const editor = useEditor()
  const [n, setN] = useState(0)
  const rawRef = useRef<unknown>(undefined)

  const resync = useCallback(() => {
    if (editor) setN(unresolvedCount(getThreads(editor)))
  }, [editor])

  useEffect(() => {
    if (!editor) return
    rawRef.current = rawThreads(editor)
    // 초기값 — 아래 구독의 씨딩이다. 에디터에서 한 번 읽어오는 것이지 파생
    // 상태를 다시 계산하는 게 아니라 캐스케이드가 나지 않는다 (RBar 와 같다).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    resync()
    // 코멘트 칸이 바뀔 때만 센다. store 는 카메라만 움직여도 울린다.
    return editor.store.listen(() => {
      const raw = rawThreads(editor)
      if (raw === rawRef.current) return
      rawRef.current = raw
      resync()
    })
  }, [editor, resync])

  return n
}

export function LBar({ onBack, onShow3D }: { onBack?: () => void; onShow3D?: () => void }) {
  const [activePanel, setActivePanel] = useState<PanelId>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const openComments = useUnresolvedComments()
  // 가져오기는 패널이 아니라 동작이다 (useImportActions 주석 참고).
  const importActions = useImportActions()

  const togglePanel = (id: Exclude<PanelId, null>) =>
    setActivePanel(prev => prev === id ? null : id)

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
          <button
            className={`lbar-icon${activePanel === 'comments' ? ' active' : ''}`}
            title="코멘트"
            onClick={() => togglePanel('comments')}
          >
            <MessageSquare size={18} strokeWidth={1.75} />
            {openComments > 0 && (
              <span className="lbar-badge">{openComments > 99 ? '99+' : openComments}</span>
            )}
          </button>
        </div>

        {/* spacer */}
        <div style={{ flex: 1 }} />

        {/* ── 섹션 3: 하단 ── */}
        <div className="lbar-section">
          {onBack && (
            <button
              className="lbar-icon"
              title="프로젝트 목록"
              onClick={onBack}
            >
              <ArrowLeftCircle size={18} strokeWidth={1.75} />
            </button>
          )}
          <button
            className="lbar-icon"
            title="2D/3D 전환"
            onClick={onShow3D}
          >
            <View3DIcon />
          </button>
          <button
            className="lbar-icon"
            title="정보 · 도움말"
            onClick={() => window.open('https://bimova.vercel.app/help', '_blank')}
          >
            <Info size={18} strokeWidth={1.75} />
          </button>
        </div>
      </aside>

      {/* 햄버거 메뉴 드롭다운 */}
      <HamburgerMenu open={menuOpen} onClose={() => setMenuOpen(false)} onImport={importActions.run} />

      {/* 패널 */}
      {/* 읽기 전용에서는 패널 안의 입력을 잠근다. 접기/펼치기와 항목 고르기는
          button 이 아니라 div 라서 그대로 돈다 — 보는 건 다 된다. */}
      {activePanel === 'layers' && <EditLock><LayersPanel /></EditLock>}
      {activePanel === 'table' && <EditLock><BOQPanel /></EditLock>}
      {activePanel === 'materials' && <EditLock><MaterialsPanel /></EditLock>}
      {activePanel === 'layout' && <EditLock><LayoutPanel /></EditLock>}
      {/* 코멘트는 **EditLock 으로 묶지 않는다.** 읽기 전용은 권한이 아니라
          입력기 판정이고(readonlyMode.ts), 현장에서 태블릿으로 보다가 남기는
          게 이 기능의 본래 쓰임이다. CommentOverlay 머리말 참고. */}
      {activePanel === 'comments' && <CommentsPanel />}

      {/* 가져오기 미리보기 모달 · 진행 오버레이 — 메뉴를 닫아도 떠 있어야 한다 */}
      {importActions.overlays}
    </>
  )
}
