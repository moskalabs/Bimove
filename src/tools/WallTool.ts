import { StateNode, createShapeId, type TLPointerEventInfo, type TLShapeId } from 'tldraw'

export class WallTool extends StateNode {
  static override id = 'wall'
  static override isLockable = false

  private startPoint: { x: number; y: number } | null = null
  private previewId: TLShapeId | null = null

  override onPointerDown(_info: TLPointerEventInfo) {
    const point = this.editor.inputs.currentPagePoint

    if (!this.previewId) {
      // 첫 클릭: 빈 wall shape 생성 (미리보기 시작)
      const id = createShapeId()
      this.editor.createShape({
        id,
        type: 'wall' as never,
        x: point.x,
        y: point.y,
        props: { x2: 0, y2: 0, thickness: 20 },
      })
      this.previewId = id
      this.startPoint = { x: point.x, y: point.y }
    } else {
      // 두 번째 클릭: 확정
      this.previewId = null
      this.startPoint = null
      this.editor.setCurrentTool('select')
    }
  }

  override onPointerMove(_info: TLPointerEventInfo) {
    if (!this.previewId || !this.startPoint) return
    const point = this.editor.inputs.currentPagePoint
    this.editor.updateShape({
      id: this.previewId,
      type: 'wall' as never,
      props: {
        x2: point.x - this.startPoint.x,
        y2: point.y - this.startPoint.y,
      },
    })
  }

  override onCancel() {
    if (this.previewId) {
      this.editor.deleteShape(this.previewId)
      this.previewId = null
    }
    this.startPoint = null
    this.editor.setCurrentTool('select')
  }

  override onKeyDown(info: { key: string }) {
    if (info.key === 'Escape') this.onCancel()
  }
}
