import { StateNode, createShapeId, type TLPointerEventInfo } from 'tldraw'

export class CommentTool extends StateNode {
  static override id = 'comment'
  static override isLockable = false

  onPointerDown = (_info: TLPointerEventInfo) => {
    const { x, y } = this.editor.inputs.currentPagePoint
    const id = createShapeId()
    this.editor.createShape({
      id,
      type: 'comment' as never,
      x: x - 16,
      y: y - 42,
      props: { text: '', resolved: false, author: '' },
    })
    this.editor.setSelectedShapes([id])
    this.editor.setCurrentTool('select')
  }

  onCancel = () => this.editor.setCurrentTool('select')

  onKeyDown = (info: { key: string }) => {
    if (info.key === 'Escape') this.onCancel()
  }
}
