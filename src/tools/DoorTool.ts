import { StateNode, createShapeId, type TLPointerEventInfo } from 'tldraw'
import { snapToWallLine } from '../lib/snap'

export class DoorTool extends StateNode {
  static override id = 'door'
  static override isLockable = false

  onPointerDown = (_info: TLPointerEventInfo) => {
    const snap = snapToWallLine(this.editor, this.editor.inputs.currentPagePoint)
    if (!snap) return

    const id = createShapeId()
    this.editor.createShape({
      id,
      type: 'door' as never,
      x: snap.x,
      y: snap.y,
      rotation: snap.angle,
      props: { width: 80, thickness: snap.thickness, swing: 1 },
    })
  }

  onCancel = () => {
    this.editor.setCurrentTool('select')
  }

  onKeyDown = (info: { key: string }) => {
    if (info.key === 'Escape') this.onCancel()
  }
}
