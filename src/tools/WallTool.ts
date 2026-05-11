import { StateNode, createShapeId, type TLPointerEventInfo } from 'tldraw'

export class WallTool extends StateNode {
  static override id = 'wall'
  static override isLockable = false

  private startPoint: { x: number; y: number } | null = null

  override onPointerDown(_info: TLPointerEventInfo) {
    const point = this.editor.inputs.currentPagePoint

    if (!this.startPoint) {
      this.startPoint = { x: point.x, y: point.y }
    } else {
      const start = this.startPoint
      const dx = point.x - start.x
      const dy = point.y - start.y

      const id = createShapeId()
      this.editor.createShape({
        id,
        type: 'wall' as never,
        x: start.x,
        y: start.y,
        props: { x2: dx, y2: dy, thickness: 20 },
      })

      this.startPoint = null
      this.editor.setCurrentTool('select')
    }
  }

  override onCancel() {
    this.startPoint = null
    this.editor.setCurrentTool('select')
  }
}
