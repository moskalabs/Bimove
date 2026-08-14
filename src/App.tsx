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
import { initGrayscaleAttr, initDarkAttr } from './lib/settings'
import './App.css'

// body data-grayscale / dark 동기화 (페이지 로드 시)
initGrayscaleAttr()
initDarkAttr()

const SHAPE_UTILS = [WallShapeUtil, DxfGroupShapeUtil, DoorShapeUtil, WindowShapeUtil, BlockShapeUtil, CommentShapeUtil, DimensionShapeUtil]
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
    // 대형 DXF 도면을 위해 최소 zoom을 0.01로 확장
    ed.setCameraOptions({
      ...ed.getCameraOptions(),
      zoomSteps: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8],
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
      // 셰이프가 있으면 전체 보기로 카메라 이동
      requestAnimationFrame(() => {
        const shapes = ed.getCurrentPageShapes()
        if (shapes.length > 0) {
          ed.zoomToFit()
        }
      })
      setEditor(ed)
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
          <LBar onBack={onBack} />
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
            <RoomOverlay />
            <ScaleRuler />
            <ChatPanel />
            <button
              className="canvas-3d-btn"
              onClick={() => setShow3D(true)}
            >🧱 3D</button>
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
          onBack={() => setCurrentProject(null)}
        />
      </>
    )
  }

  if (!currentProject) {
    return <ProjectsPage onOpen={(id, name) => setCurrentProject({ id, name: name ?? '프로젝트' })} />
  }

  return (
    <>
      <EditorView
        projectId={currentProject.id}
        projectName={currentProject.name}
        onBack={() => setCurrentProject(null)}
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
