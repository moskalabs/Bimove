import { useState } from 'react'
import { Tldraw } from 'tldraw'
import type { Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import { LBar } from './components/LBar'
import { RBar } from './components/RBar'
import { WallShapeUtil } from './shapes/WallShape'
import { WallTool } from './tools/WallTool'
import { EditorContext } from './context/EditorContext'
import './App.css'

const SHAPE_UTILS = [WallShapeUtil]
const TOOLS = [WallTool]

function App() {
  const [editor, setEditor] = useState<Editor | null>(null)

  const handleMount = (ed: Editor) => {
    ed.updateInstanceState({ isGridMode: true })
    setEditor(ed)
  }

  return (
    <EditorContext.Provider value={editor}>
      <div className="bimove-layout">
        <LBar />
        <main className="canvas-area">
          <Tldraw
            shapeUtils={SHAPE_UTILS}
            tools={TOOLS}
            onMount={handleMount}
            hideUi
          />
        </main>
        <RBar />
      </div>
    </EditorContext.Provider>
  )
}

export default App
