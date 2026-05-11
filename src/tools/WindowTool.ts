import { StateNode, createShapeId, type TLPointerEventInfo, type TLShapeId } from 'tldraw'
import { snapToWallLine } from '../lib/snap'

const DEFAULT_THICKNESS = 20
const DEFAULT_WIDTH = 1200  // 1200mm standard window

export class WindowTool extends StateNode {
  static override id = 'window'
  static override isLockable = false

  private previewId: TLShapeId | null = null

  override onEnter = () => {
    const pt = this.editor.inputs.currentPagePoint
    const id = createShapeId()
    this.editor.createShape({
      id,
      type: 'window' as never,
      x: pt.x, y: pt.y,
      opacity: 0.45,
      props: { width: DEFAULT_WIDTH, thickness: DEFAULT_THICKNESS },
    })
    this.previewId = id
  }

  onPointerMove = (_info: TLPointerEventInfo) => {
    if (!this.previewId) return
    const pt = this.editor.inputs.currentPagePoint
    const snap = snapToWallLine(this.editor, pt)
    this.editor.updateShape({
      id: this.previewId,
      type: 'window' as never,
      x: snap?.x ?? pt.x,
      y: snap?.y ?? pt.y,
      rotation: snap?.angle ?? 0,
      props: { thickness: snap?.thickness ?? DEFAULT_THICKNESS },
    })
  }

  onPointerDown = (_info: TLPointerEventInfo) => {
    if (!this.previewId) return
    const pt = this.editor.inputs.currentPagePoint
    const snap = snapToWallLine(this.editor, pt)

    this.editor.updateShape({
      id: this.previewId,
      type: 'window' as never,
      x: snap?.x ?? pt.x,
      y: snap?.y ?? pt.y,
      rotation: snap?.angle ?? 0,
      opacity: 1,
      meta: snap ? { wallId: snap.wallId } : {},
      props: { thickness: snap?.thickness ?? DEFAULT_THICKNESS },
    })
    this.editor.setSelectedShapes([this.previewId])
    this.previewId = null
    this.editor.setCurrentTool('select')
  }

  override onExit = () => {
    if (this.previewId) {
      this.editor.deleteShape(this.previewId)
      this.previewId = null
    }
  }

  onCancel = () => this.editor.setCurrentTool('select')

  onKeyDown = (info: { key: string }) => {
    if (info.key === 'Escape') this.onCancel()
  }
}
