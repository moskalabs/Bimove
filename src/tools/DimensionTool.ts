import { StateNode, createShapeId, type TLPointerEventInfo, type TLShapeId } from 'tldraw'
import { snapAngle, snapToWallEndpoint } from '../lib/snap'
import { drawingState } from '../lib/drawingState'

export class DimensionTool extends StateNode {
  static override id = 'dimension'
  static override isLockable = false

  private startPoint: { x: number; y: number } | null = null
  private previewId: TLShapeId | null = null

  private resolvePoint(): { x: number; y: number } {
    const point = this.editor.inputs.currentPagePoint
    const snapped = snapToWallEndpoint(this.editor, point, this.previewId ?? undefined)
    if (snapped) return { x: snapped.x, y: snapped.y }
    if (this.startPoint && this.editor.inputs.shiftKey) {
      const v = snapAngle(point.x - this.startPoint.x, point.y - this.startPoint.y)
      return { x: this.startPoint.x + v.x, y: this.startPoint.y + v.y }
    }
    return { x: point.x, y: point.y }
  }

  onPointerDown = (_info: TLPointerEventInfo) => {
    const point = this.resolvePoint()

    if (!this.startPoint) {
      this.startPoint = { x: point.x, y: point.y }
      const id = createShapeId()
      this.editor.createShape({
        id,
        type: 'dimension' as never,
        x: point.x,
        y: point.y,
        props: { x2: 0, y2: 0, offset: 60 },
      })
      this.previewId = id
      drawingState.drawingId = id
    } else {
      this.startPoint = null
      drawingState.drawingId = null
      this.previewId = null
      this.editor.setCurrentTool('select')
    }
  }

  onPointerMove = (_info: TLPointerEventInfo) => {
    if (!this.previewId || !this.startPoint) return
    const point = this.resolvePoint()
    this.editor.updateShape({
      id: this.previewId,
      type: 'dimension' as never,
      props: {
        x2: point.x - this.startPoint.x,
        y2: point.y - this.startPoint.y,
      },
    })
  }

  onCancel = () => {
    if (this.previewId) {
      this.editor.deleteShape(this.previewId)
      this.previewId = null
    }
    this.startPoint = null
    drawingState.drawingId = null
    this.editor.setCurrentTool('select')
  }

  onKeyDown = (info: { key: string }) => {
    if (info.key === 'Escape') this.onCancel()
  }
}
