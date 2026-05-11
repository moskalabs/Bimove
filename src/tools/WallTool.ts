import { StateNode, createShapeId, type TLPointerEventInfo, type TLShapeId } from 'tldraw'
import { snapToWallEndpoint, snapAngle } from '../lib/snap'
import { drawingState } from '../lib/drawingState'
import { getDefaultWallThickness } from '../lib/settings'

export class WallTool extends StateNode {
  static override id = 'wall'
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

  private startWallAt(point: { x: number; y: number }) {
    const id = createShapeId()
    this.editor.createShape({
      id,
      type: 'wall' as never,
      x: point.x,
      y: point.y,
      props: { x2: 0, y2: 0, thickness: getDefaultWallThickness() },
    })
    this.previewId = id
    this.startPoint = { x: point.x, y: point.y }
    drawingState.drawingId = id
  }

  onPointerDown = (_info: TLPointerEventInfo) => {
    const point = this.resolvePoint()

    if (!this.previewId) {
      this.startWallAt(point)
    } else {
      // Finish current wall, immediately start next from endpoint (continuous mode)
      drawingState.drawingId = null
      this.previewId = null
      this.startPoint = null
      this.startWallAt(point)
    }
  }

  onPointerMove = (_info: TLPointerEventInfo) => {
    if (!this.previewId || !this.startPoint) return
    const point = this.resolvePoint()
    this.editor.updateShape({
      id: this.previewId,
      type: 'wall' as never,
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
