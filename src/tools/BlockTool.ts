import { StateNode, createShapeId, type TLShapeId } from 'tldraw'
import { getBlock, BLOCKS } from '../lib/blockLibrary'
import { getScaleConfig } from '../lib/scaleConfig'

export class BlockTool extends StateNode {
  static override id = 'block'
  static override isLockable = false

  private blockId = BLOCKS[0].id
  private previewId: TLShapeId | null = null

  private sizePx() {
    const def = getBlock(this.blockId) ?? BLOCKS[0]
    const { pxPerMm } = getScaleConfig(this.editor)
    return { w: def.wmm * pxPerMm, h: def.hmm * pxPerMm }
  }

  override onEnter = (info: { blockId?: string }) => {
    if (info?.blockId && getBlock(info.blockId)) this.blockId = info.blockId
    const p = this.editor.inputs.currentPagePoint
    const { w, h } = this.sizePx()
    const id = createShapeId()
    this.editor.createShape({
      id,
      type: 'block' as never,
      x: p.x - w / 2,
      y: p.y - h / 2,
      opacity: 0.5,
      props: { w, h, blockId: this.blockId },
    })
    this.previewId = id
  }

  onPointerMove = () => {
    if (!this.previewId) return
    const p = this.editor.inputs.currentPagePoint
    const { w, h } = this.sizePx()
    this.editor.updateShape({ id: this.previewId, type: 'block' as never, x: p.x - w / 2, y: p.y - h / 2 })
  }

  onPointerDown = () => {
    if (!this.previewId) return
    this.editor.updateShape({ id: this.previewId, type: 'block' as never, opacity: 1 })
    this.previewId = null
    // Create next preview immediately for continuous placement
    const p = this.editor.inputs.currentPagePoint
    const { w, h } = this.sizePx()
    const id = createShapeId()
    this.editor.createShape({
      id, type: 'block' as never,
      x: p.x - w / 2, y: p.y - h / 2,
      opacity: 0.5,
      props: { w, h, blockId: this.blockId },
    })
    this.previewId = id
  }

  override onExit = () => {
    if (this.previewId) {
      this.editor.deleteShape(this.previewId)
      this.previewId = null
    }
  }

  onCancel = () => {
    if (this.previewId) {
      this.editor.deleteShape(this.previewId)
      this.previewId = null
    }
    this.editor.setCurrentTool('select')
  }

  onKeyDown = (info: { key: string }) => {
    if (info.key === 'Escape') this.onCancel()
  }
}
