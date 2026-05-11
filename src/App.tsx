import { useState, useEffect } from 'react'
import { Tldraw } from 'tldraw'
import type { Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import { LBar } from './components/LBar'
import { RBar } from './components/RBar'
import { ToolOverlay } from './components/ToolOverlay'
import { RoomOverlay } from './components/RoomOverlay'
import { WallShapeUtil } from './shapes/WallShape'
import { DoorShapeUtil } from './shapes/DoorShape'
import { WindowShapeUtil } from './shapes/WindowShape'
import { BlockShapeUtil } from './shapes/BlockShape'
import { WallTool } from './tools/WallTool'
import { DoorTool } from './tools/DoorTool'
import { WindowTool } from './tools/WindowTool'
import { BlockTool } from './tools/BlockTool'
import { EditorContext } from './context/EditorContext'
import './App.css'

const SHAPE_UTILS = [WallShapeUtil, DoorShapeUtil, WindowShapeUtil, BlockShapeUtil]
const TOOLS = [WallTool, DoorTool, WindowTool, BlockTool]

function App() {
  const [editor, setEditor] = useState<Editor | null>(null)

  const handleMount = (ed: Editor) => {
    ed.updateInstanceState({ isGridMode: true })
    setEditor(ed)
  }

  useEffect(() => {
    if (!editor) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        if (e.shiftKey) editor.redo()
        else editor.undo()
      } else if (e.key === 'y' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        editor.redo()
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
      </div>
    </EditorContext.Provider>
  )
}

export default App
