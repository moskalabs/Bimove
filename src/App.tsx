import { useState, useEffect, lazy, Suspense } from 'react'
import { Tldraw } from 'tldraw'
import type { Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import { LBar } from './components/LBar'
import { RBar } from './components/RBar'
import { ToolOverlay } from './components/ToolOverlay'
import { RoomOverlay } from './components/RoomOverlay'
import { ChatPanel } from './components/ChatPanel'
const Viewer3D = lazy(() => import('./components/Viewer3D').then(m => ({ default: m.Viewer3D })))
import { WallShapeUtil } from './shapes/WallShape'
import { DoorShapeUtil } from './shapes/DoorShape'
import { WindowShapeUtil } from './shapes/WindowShape'
import { BlockShapeUtil } from './shapes/BlockShape'
import { CommentShapeUtil } from './shapes/CommentShape'
import { WallTool } from './tools/WallTool'
import { DoorTool } from './tools/DoorTool'
import { WindowTool } from './tools/WindowTool'
import { BlockTool } from './tools/BlockTool'
import { CommentTool } from './tools/CommentTool'
import { EditorContext } from './context/EditorContext'
import './App.css'

const STORAGE_KEY = 'bimove_snapshot_v1'

const SHAPE_UTILS = [WallShapeUtil, DoorShapeUtil, WindowShapeUtil, BlockShapeUtil, CommentShapeUtil]
const TOOLS = [WallTool, DoorTool, WindowTool, BlockTool, CommentTool]

function App() {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [show3D, setShow3D] = useState(false)

  const handleMount = (ed: Editor) => {
    ed.updateInstanceState({ isGridMode: true })
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try { ed.loadSnapshot(JSON.parse(saved)) } catch { /* ignore corrupt saves */ }
    }
    setEditor(ed)
  }

  useEffect(() => {
    if (!editor) return
    let timer = 0
    const unsub = editor.store.listen(() => {
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(editor.getSnapshot())) } catch { /* storage full */ }
      }, 1500)
    })
    return () => { unsub(); clearTimeout(timer) }
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
        e.preventDefault()
        editor.selectAll()
      } else if (e.key === 'Escape') {
        editor.setCurrentTool('select')
        editor.selectNone()
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
            shapeUtils={SHAPE_UTILS}
            tools={TOOLS}
            onMount={handleMount}
            hideUi
          />
          <RoomOverlay />
        </main>
        <RBar />
        <ChatPanel />
        <button
          onClick={() => setShow3D(true)}
          style={{
            position: 'fixed', bottom: 20, right: 76, zIndex: 500,
            height: 46, padding: '0 16px', borderRadius: 23,
            background: '#fff', border: '1.5px solid #e0e0e0',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)', cursor: 'pointer',
            fontSize: 14, fontWeight: 600, color: '#444',
          }}
          title="3D 미리보기"
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

export default App
