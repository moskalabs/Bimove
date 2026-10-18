import { StateNode, createShapeId, type TLPointerEventInfo, type TLShapeId } from 'tldraw'
import { resolveDrawPoint, snapToTurn } from '../lib/snap'
import { drawingState } from '../lib/drawingState'
import { getDefaultWallThicknessMm, getSnapEnabled } from '../lib/settings'
import { getScaleConfig } from '../lib/scaleConfig'

export class WallTool extends StateNode {
  static override id = 'wall'
  static override isLockable = false

  private startPoint: { x: number; y: number } | null = null
  private previewId: TLShapeId | null = null
  /** 바로 앞 구간의 방향. 이어 그릴 때만 차고, 첫 구간이면 null 이다. */
  private prevDir: { x: number; y: number } | null = null

  /**
   * 커서가 갈 자리.
   *
   * 기본 스냅 체인(끝점>교차점>수직>연장>15° 직교)을 먼저 돌린다. 거기서
   * **진짜 geometry** 가 이겼으면 그대로 둔다 — 각을 맞추겠다고 점을 옮기면
   * 벽이 안 붙는다.
   *
   * 아무것도 안 걸렸거나 15° 직교로 떨어졌을 때만 **앞 구간 기준 직각**을
   * 본다. 15° 는 화면 축 기준이라 앞 벽이 비스듬하면 직각이 안 나온다.
   * 그때는 **날것 커서**로 각을 재야 한다 — 이미 15° 로 꺾인 점으로 재면
   * 직각 근처였어도 못 맞춘다.
   */
  private resolvePoint(): { x: number; y: number } {
    const p = resolveDrawPoint(this.editor, this.startPoint, this.previewId ?? undefined)
    if (p.snapType && p.snapType !== 'angle') return p
    if (!this.startPoint || !this.prevDir) return p
    // shift 는 직교 스냅과 같은 규칙으로 뒤집는다
    if (getSnapEnabled() === this.editor.inputs.shiftKey) return p
    return snapToTurn(this.startPoint, this.editor.inputs.currentPagePoint, this.prevDir) ?? p
  }

  private startWallAt(point: { x: number; y: number }) {
    const id = createShapeId()
    this.editor.createShape({
      id,
      type: 'wall' as never,
      x: point.x,
      y: point.y,
      props: { x2: 0, y2: 0, thickness: getDefaultWallThicknessMm() * getScaleConfig(this.editor).pxPerMm },
    })
    this.previewId = id
    this.startPoint = { x: point.x, y: point.y }
    drawingState.drawingId = id
    drawingState.prevDir = this.prevDir
  }

  onPointerDown = (_info: TLPointerEventInfo) => {
    const point = this.resolvePoint()

    if (!this.previewId) {
      this.startWallAt(point)
    } else {
      // Finish current wall, immediately start next from endpoint (continuous mode)
      //
      // 끝낸 구간의 방향을 들고 간다 — 다음 구간이 이걸 기준으로 직각에
      // 당겨지고, 코너에 각이 뜬다.
      const dx = point.x - this.startPoint!.x
      const dy = point.y - this.startPoint!.y
      this.prevDir = Math.hypot(dx, dy) > 1 ? { x: dx, y: dy } : this.prevDir
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
    this.prevDir = null
    drawingState.drawingId = null
    drawingState.prevDir = null
    this.editor.setCurrentTool('select')
  }

  onKeyDown = (info: { key: string }) => {
    if (info.key === 'Escape') this.onCancel()
  }
}
