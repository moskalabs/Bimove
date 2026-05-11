import { Tldraw } from 'tldraw'
import type { Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import { LBar } from './components/LBar'
import { RBar } from './components/RBar'
import { WallShapeUtil } from './shapes/WallShape'
import { WallTool } from './tools/WallTool'
import './App.css'

const SHAPE_UTILS = [WallShapeUtil]
const TOOLS = [WallTool]

function App() {
  const handleMount = (editor: Editor) => {
    editor.updateInstanceState({ isGridMode: true })
  }

  return (
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
  )
}

export default App
