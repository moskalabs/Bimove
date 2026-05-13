import { useState, useEffect, lazy, Suspense } from 'react'
import { Tldraw } from 'tldraw'
import type { Editor, TLEditorSnapshot } from 'tldraw'
import 'tldraw/tldraw.css'
import { LBar } from './components/LBar'
import { RBar } from './components/RBar'
import { ToolOverlay } from './components/ToolOverlay'
import { RoomOverlay } from './components/RoomOverlay'
import { ScaleRuler } from './components/ScaleRuler'
import { ChatPanel } from './components/ChatPanel'
import { ProjectsPage } from './components/ProjectsPage'
const Viewer3D = lazy(() => import('./components/Viewer3D').then(m => ({ default: m.Viewer3D })))
import { WallShapeUtil } from './shapes/WallShape'
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
import { loadSnapshot, saveSnapshot, touchProject, getProjects } from './lib/projectStore'
import './App.css'

const SHAPE_UTILS = [WallShapeUtil, DoorShapeUtil, WindowShapeUtil, BlockShapeUtil, CommentShapeUtil, DimensionShapeUtil]
const TOOLS = [WallTool, DoorTool, WindowTool, BlockTool, CommentTool, DimensionTool]

function EditorView({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [show3D, setShow3D] = useState(false)

  const projectName = getProjects().find(p => p.id === projectId)?.name ?? '프로젝트'

  const handleMount = (ed: Editor) => {
    ed.updateInstanceState({ isGridMode: true })
    const saved = loadSnapshot(projectId)
    if (saved) {
      try { ed.loadSnapshot(saved as TLEditorSnapshot) } catch { /* ignore corrupt */ }
    }
    setEditor(ed)
  }

  useEffect(() => {
    if (!editor) return
    let timer = 0
    const unsub = editor.store.listen(() => {
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        saveSnapshot(projectId, editor.getSnapshot())
        touchProject(projectId)
      }, 1500)
    })
    return () => { unsub(); clearTimeout(timer) }
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
    <EditorContext.Provider value={editor}>
      <div className="bimove-layout">
        <LBar />
        <main className="canvas-area">
          <ToolOverlay />
          <Tldraw
            key={projectId}
            shapeUtils={SHAPE_UTILS}
            tools={TOOLS}
            onMount={handleMount}
            hideUi
          />
          <RoomOverlay />
          <ScaleRuler />
        </main>
        <RBar />
        <ChatPanel />

        {/* back to projects */}
        <button
          onClick={onBack}
          style={{
            position: 'fixed', top: 12, left: 52, zIndex: 500,
            height: 32, padding: '0 12px', borderRadius: 16,
            background: '#fff', border: '1px solid #e0e0e0',
            boxShadow: '0 1px 4px rgba(0,0,0,0.1)', cursor: 'pointer',
            fontSize: 12, fontWeight: 600, color: '#555',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          ← <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{projectName}</span>
        </button>

        {/* 3D button */}
        <button
          onClick={() => setShow3D(true)}
          style={{
            position: 'fixed', bottom: 20, right: 76, zIndex: 500,
            height: 46, padding: '0 16px', borderRadius: 23,
            background: '#fff', border: '1.5px solid #e0e0e0',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)', cursor: 'pointer',
            fontSize: 14, fontWeight: 600, color: '#444',
          }}
        >🧱 3D</button>

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
  )
}

function App() {
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null)

  if (!currentProjectId) {
    return <ProjectsPage onOpen={setCurrentProjectId} />
  }

  return <EditorView projectId={currentProjectId} onBack={() => setCurrentProjectId(null)} />
}

export default App
