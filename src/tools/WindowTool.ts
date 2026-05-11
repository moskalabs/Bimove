import { StateNode, createShapeId, type TLPointerEventInfo } from 'tldraw'
import { snapToWallLine } from '../lib/snap'

export class WindowTool extends StateNode {
  static override id = 'window'
  static override isLockable = false

  onPointerDown = (_info: TLPointerEventInfo) => {
    const snap = snapToWallLine(this.editor, this.editor.inputs.currentPagePoint)
    if (!snap) return

    const id = createShapeId()
    this.editor.createShape({
      id,
      type: 'window' as never,
      x: snap.x,
      y: snap.y,
      rotation: snap.angle,
      props: { width: 60, thickness: snap.thickness },
    })
  }

  onCancel = () => {
    this.editor.setCurrentTool('select')
  }

  onKeyDown = (info: { key: string }) => {
    if (info.key === 'Escape') this.onCancel()
  }
}
