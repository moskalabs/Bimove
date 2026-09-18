import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { Tldraw } from 'tldraw'
import type { Editor, TLEditorSnapshot } from 'tldraw'
import 'tldraw/tldraw.css'
import { TopBar } from './components/TopBar'
import { LBar } from './components/LBar'
import { RBar } from './components/RBar'
import { ToolOverlay } from './components/ToolOverlay'
import { RoomOverlay } from './components/RoomOverlay'
import { CanvasPickOverlay } from './components/CanvasPickOverlay'
import { AreaMeasureOverlay } from './components/AreaMeasureOverlay'
import { ZoneDrawOverlay } from './components/ZoneDrawOverlay'
import { ZoneNamePopup } from './components/ZoneNamePopup'
import { ScaleRuler } from './components/ScaleRuler'
import { ChatPanel } from './components/ChatPanel'
import { ProjectsPage } from './components/ProjectsPage'
import { AuthPage } from './components/AuthPage'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider, useToast } from './context/ToastContext'
const Viewer3D = lazy(() => import('./components/Viewer3D').then(m => ({ default: m.Viewer3D })))
import { WallShapeUtil } from './shapes/WallShape'
import { DxfGroupShapeUtil } from './shapes/DxfGroupShape'
import { DoorShapeUtil } from './shapes/DoorShape'
import { WindowShapeUtil } from './shapes/WindowShape'
import { BlockShapeUtil } from './shapes/BlockShape'
import { CommentShapeUtil } from './shapes/CommentShape'
import { DimensionShapeUtil } from './shapes/DimensionShape'
import { ZoneShapeUtil } from './shapes/ZoneShape'
import { WallTool } from './tools/WallTool'
import { DoorTool } from './tools/DoorTool'
import { WindowTool } from './tools/WindowTool'
import { BlockTool } from './tools/BlockTool'
import { CommentTool } from './tools/CommentTool'
import { DimensionTool } from './tools/DimensionTool'
import { EditorContext } from './context/EditorContext'
import { ProjectContext } from './context/ProjectContext'
import { loadSnapshot, saveSnapshot, saveThumbnail, touchProject } from './lib/projectStore'
import { saveProjectSnapshot as saveSnapshotToSupabase, loadProjectSnapshot as loadSnapshotFromSupabase } from './lib/supabaseSync'
import { saveVersion } from './lib/versions'
import { parseCadFile, commitCadImport } from './lib/dxf'
import { initGrayscaleAttr, initDarkAttr } from './lib/settings'
import './App.css'

// body data-grayscale / dark 동기화 (페이지 로드 시)
initGrayscaleAttr()
initDarkAttr()

const SHAPE_UTILS = [WallShapeUtil, DxfGroupShapeUtil, DoorShapeUtil, WindowShapeUtil, BlockShapeUtil, CommentShapeUtil, DimensionShapeUtil, ZoneShapeUtil]
const TOOLS = [WallTool, DoorTool, WindowTool, BlockTool, CommentTool, DimensionTool]

function EmptyCanvasHint({ editor }: { editor: Editor | null }) {
  const [hasShapes, setHasShapes] = useState(false)
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!editor) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const check = () => setHasShapes(editor.getCurrentPageShapes().length > 0)
    check()
    unsubRef.current = editor.store.listen(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(check, 300)
    })
    return () => { unsubRef.current?.(); if (timer) clearTimeout(timer) }
  }, [editor])

  if (!editor || hasShapes) return null

  return (
    <div className="empty-canvas-hint" style={{
      position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none', zIndex: 10,
    }}>
      <div style={{
        background: 'rgba(255,255,255,0.93)', borderRadius: 16,
        padding: '28px 36px', textAlign: 'center',
        border: '1.5px dashed #d0d0d0', boxShadow: '0 2px 16px rgba(0,0,0,0.07)',
      }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🏗️</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#222', marginBottom: 8 }}>
          도면을 시작해보세요
        </div>
        <div style={{ fontSize: 12, color: '#888', lineHeight: 1.8 }}>
          왼쪽 패널에서 <strong style={{ color: '#3b82f6' }}>벽</strong>을 선택하고<br />
          캔버스를 클릭·드래그해 그려보세요
        </div>
      </div>
    </div>
  )
}

function EditorView({ projectId, onBack }: { projectId: string; projectName?: string; onBack: () => void }) {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [show3D, setShow3D] = useState(false)
  const { toast } = useToast()

  // Supabase에서 로드 시 받아온 서버 타임스탬프 (충돌 방지용)
  const serverUpdatedAtRef = useRef<string | undefined>(undefined)

  const handleMount = (ed: Editor) => {
    ed.updateInstanceState({ isGridMode: false })
    // 대형 DXF 도면을 위해 최소 zoom을 0.0001로 확장 (10,000m 축소 지원)
    ed.setCameraOptions({
      ...ed.getCameraOptions(),
      zoomSteps: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8],
      wheelBehavior: 'zoom',
    })
    // Supabase에서 먼저 로드, 실패하면 localStorage 폴백
    ;(async () => {
      let saved: object | null = null
      try {
        const result = await loadSnapshotFromSupabase(projectId)
        if (result) {
          saved = result.snapshot as object
          serverUpdatedAtRef.current = result.updatedAt
        }
      } catch { /* Supabase 실패 */ }
      if (!saved) saved = loadSnapshot(projectId)
      if (saved) {
        try { ed.loadSnapshot(saved as TLEditorSnapshot) } catch { /* ignore corrupt */ }
      }
      // 빈 페이지 자동 정리: 셰이프가 없는 여분 페이지 삭제 (최소 1페이지 유지)
      const allPages = ed.getPages()
      if (allPages.length > 1) {
        const emptyPages = allPages.filter(p => ed.getPageShapeIds(p.id).size === 0)
        // 전부 빈 페이지면 첫 번째는 남김
        const toDelete = emptyPages.length === allPages.length
          ? emptyPages.slice(1)
          : emptyPages
        for (const p of toDelete) {
          ed.deletePage(p.id)
        }
      }
      // 셰이프가 있으면 전체 보기로 카메라 이동
      requestAnimationFrame(() => {
        const shapes = ed.getCurrentPageShapes()
        if (shapes.length > 0) {
          ed.zoomToFit()
        }
      })
      setEditor(ed)

      // 대시보드에서 "DWG 불러오기"로 생성된 경우: 자동 임포트
      const win = window as unknown as Record<string, unknown>
      const pendingFile = win.__pendingCadFile as File | undefined
      if (pendingFile) {
        delete win.__pendingCadFile
        parseCadFile(pendingFile).then(result => {
          if (!result) return
          const allLayers = new Set(result.layers.map(l => l.name))
          commitCadImport(ed, result, allLayers)
          requestAnimationFrame(() => ed.zoomToFit())
        })
      }
    })()
  }

  useEffect(() => {
    if (!editor) return
    let timer = 0
    let supabaseTimer = 0
    let dirtySinceAuto = false
    let latestSnapshot: object | null = null

    const unsub = editor.store.listen(() => {
      dirtySinceAuto = true
      clearTimeout(timer)
      timer = window.setTimeout(async () => {
        const snapshot = editor.getSnapshot()
        latestSnapshot = snapshot
        // localStorage 즉시 저장
        saveSnapshot(projectId, snapshot)
        touchProject(projectId)
        // 썸네일 (200+ shapes일 때 스킵 — getSvgString이 너무 무거움)
        const shapes = editor.getCurrentPageShapes()
        if (shapes.length > 0 && shapes.length <= 200) {
          try {
            const result = await (editor as unknown as { getSvgString: (shapes: unknown[], opts: unknown) => Promise<{ svg: string; width: number; height: number } | undefined> })
              .getSvgString(shapes, { padding: 16, background: true })
            if (result?.svg) {
              const dataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(result.svg)))
              saveThumbnail(projectId, dataUrl)
            }
          } catch { /* ignore thumbnail errors */ }
        }
      }, 1500)
    })

    // Supabase 동기화 (5초 디바운스, optimistic locking)
    let lastServerUpdatedAt: string | undefined = serverUpdatedAtRef.current
    let syncFailed = false
    supabaseTimer = window.setInterval(async () => {
      if (!latestSnapshot) return
      const snap = latestSnapshot
      latestSnapshot = null
      try {
        const result = await saveSnapshotToSupabase(projectId, snap, undefined, lastServerUpdatedAt)
        if (result.conflict) {
          // 충돌 시 조용히 현재 내용으로 덮어쓰기 (confirm 대신)
          console.warn('[supabase-sync] conflict detected, auto-overwriting')
          const retry = await saveSnapshotToSupabase(projectId, snap)
          lastServerUpdatedAt = retry.serverUpdatedAt
        } else {
          lastServerUpdatedAt = result.serverUpdatedAt
          if (syncFailed) {
            toast('서버 동기화가 복구되었습니다.', 'success')
            syncFailed = false
          }
        }
      } catch (err) {
        console.warn('[supabase-sync] snapshot save failed', err)
        if (!syncFailed) {
          toast('서버 동기화에 실패했습니다. 로컬에 저장됩니다.', 'error')
          syncFailed = true
        }
      }
    }, 5000)

    // 5분마다 자동 버전 저장 (변경 있을 때만)
    const AUTO_VERSION_MS = 5 * 60 * 1000
    const autoVersionTimer = window.setInterval(() => {
      if (!dirtySinceAuto) return
      try {
        saveVersion(projectId, editor.store.getStoreSnapshot(), '자동저장')
        dirtySinceAuto = false
      } catch (err) {
        console.warn('[auto-version] failed', err)
        toast('자동 버전 저장에 실패했습니다.', 'error')
      }
    }, AUTO_VERSION_MS)

    return () => {
      unsub()
      clearTimeout(timer)
      clearInterval(supabaseTimer)
      clearInterval(autoVersionTimer)
    }
  }, [editor, projectId])

  // 휠(중간) 버튼 더블클릭 → 화면 맞춤(zoomToFit)
  useEffect(() => {
    if (!editor) return
    let lastMiddleDown = 0
    const handleMiddleDown = (e: MouseEvent) => {
      if (e.button !== 1) return          // 중간 버튼만
      // 캔버스 영역 내에서만 동작
      if (!(e.target as HTMLElement)?.closest('.tl-container')) return
      const now = Date.now()
      if (now - lastMiddleDown < 400) {   // 400ms 이내 = 더블클릭
        e.preventDefault()
        e.stopPropagation()
        editor.zoomToFit({ animation: { duration: 250 } })
        lastMiddleDown = 0
      } else {
        lastMiddleDown = now
      }
    }
    // auxclick 방지 (중간 버튼 기본 동작 차단)
    const handleAuxClick = (e: MouseEvent) => {
      if (e.button !== 1) return
      if ((e.target as HTMLElement)?.closest('.tl-container')) {
        e.preventDefault()
      }
    }
    document.addEventListener('mousedown', handleMiddleDown, true)
    document.addEventListener('auxclick', handleAuxClick, true)
    return () => {
      document.removeEventListener('mousedown', handleMiddleDown, true)
      document.removeEventListener('auxclick', handleAuxClick, true)
    }
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (e.key === 'z' && mod) {
        e.preventDefault()
        if (e.shiftKey) editor.redo(); else editor.undo()
      } else if (e.key === 'y' && mod) {
        e.preventDefault(); editor.redo()
      } else if (e.key === 'd' && mod) {
        e.preventDefault()
        const ids = editor.getSelectedShapeIds()
        if (ids.length) editor.duplicateShapes(ids, { x: 20, y: 20 })
      } else if (e.key === 'a' && mod) {
        e.preventDefault(); editor.selectAll()
      } else if (e.key === 'Escape') {
        editor.setCurrentTool('select'); editor.selectNone()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const ids = editor.getSelectedShapeIds()
        if (ids.length) { e.preventDefault(); editor.deleteShapes(ids) }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [editor])

  return (
    <ProjectContext.Provider value={projectId}>
    <EditorContext.Provider value={editor}>
      <div className="bimova-layout">
        <TopBar />
        <div className="bimova-body">
          <LBar onBack={onBack} onShow3D={() => setShow3D(true)} />
          <main className="canvas-area">
            <ToolOverlay />
            <Tldraw
              key={projectId}
              shapeUtils={SHAPE_UTILS}
              tools={TOOLS}
              onMount={handleMount}
              hideUi
            />
            <EmptyCanvasHint editor={editor} />
            <CanvasPickOverlay />
            <AreaMeasureOverlay />
            <ZoneDrawOverlay />
            <ZoneNamePopup />
            <RoomOverlay />
            <ScaleRuler />
            <ChatPanel />
          </main>
          <RBar />
        </div>

        {show3D && (
          <Suspense fallback={
            <div style={{ position: 'fixed', inset: 0, zIndex: 600, background: '#1e2228',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 15 }}>
              3D 엔진 로딩 중…
            </div>
          }>
            <Viewer3D onClose={() => setShow3D(false)} />
          </Suspense>
        )}
      </div>
    </EditorContext.Provider>
    </ProjectContext.Provider>
  )
}

function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  if (online) return null
  return <div className="offline-banner">⚠ 오프라인 상태입니다. 변경사항은 로컬에 저장됩니다.</div>
}

function SessionExpiredBanner() {
  const { sessionExpired, dismissSessionExpired } = useAuth()
  if (!sessionExpired) return null
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10000,
      background: '#fef3c7', borderBottom: '2px solid #f59e0b',
      padding: '12px 20px', display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', gap: 16,
    }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#92400e' }}>
        ⚠ 세션이 만료되었습니다. 작업 내용은 로컬에 저장되어 있습니다. 다시 로그인해주세요.
      </span>
      <button
        onClick={dismissSessionExpired}
        style={{
          padding: '6px 16px', borderRadius: 8, border: 'none',
          background: '#f59e0b', color: '#fff', fontSize: 12, fontWeight: 700,
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        로그인하기
      </button>
    </div>
  )
}

function AppContent() {
  const { user, loading, sessionExpired } = useAuth()
  const [currentProject, setCurrentProject] = useState<{ id: string; name: string } | null>(null)

  // 유저 인증 후 body 속성 동기화 (모듈 레벨 init은 userId 없어서 실패할 수 있음)
  useEffect(() => {
    if (user) {
      initGrayscaleAttr()
      initDarkAttr()
    }
  }, [user])

  // 프로젝트 열기/닫기 시 브라우저 히스토리 동기화
  const openProject = (id: string, name: string) => {
    setCurrentProject({ id, name })
    history.pushState({ view: 'editor', id }, '', `#project=${id}`)
  }

  const closeProject = () => {
    setCurrentProject(null)
    // 히스토리에 대시보드 상태 추가 (뒤로가기 시 또 나가지 않도록)
    if (history.state?.view === 'editor') {
      history.pushState({ view: 'dashboard' }, '', window.location.pathname + window.location.search)
    }
  }

  // 브라우저 뒤로가기 → 대시보드로 복귀
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (!e.state || e.state.view !== 'editor') {
        setCurrentProject(null)
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f8f8f8', color: '#999', fontSize: 14,
      }}>
        로딩 중...
      </div>
    )
  }

  if (!user) {
    return (
      <>
        <SessionExpiredBanner />
        <AuthPage />
      </>
    )
  }

  // 세션 만료 상태이면 에디터 유지하면서 배너만 표시 (작업 보존)
  if (sessionExpired && currentProject) {
    return (
      <>
        <SessionExpiredBanner />
        <EditorView
          projectId={currentProject.id}
          projectName={currentProject.name}
          onBack={closeProject}
        />
      </>
    )
  }

  if (!currentProject) {
    return <ProjectsPage onOpen={(id, name) => openProject(id, name ?? '프로젝트')} />
  }

  return (
    <>
      <EditorView
        projectId={currentProject.id}
        projectName={currentProject.name}
        onBack={closeProject}
      />
      <OfflineBanner />
    </>
  )
}

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </AuthProvider>
  )
}

export default App
