import {
  Rectangle2d,
  ShapeUtil,
  SVGContainer,
  T,
  resizeBox,
  type TLBaseShape,
  type TLResizeInfo,
} from 'tldraw'
import { getBlock } from '../lib/blockLibrary'

export type BlockShapeProps = {
  w: number
  h: number
  blockId: string
}

export type BlockShape = TLBaseShape<'block', BlockShapeProps>

export class BlockShapeUtil extends ShapeUtil<BlockShape> {
  static override type = 'block' as const
  static override props = {
    w: T.number,
    h: T.number,
    blockId: T.string,
  }

  override getDefaultProps(): BlockShapeProps {
    return { w: 120, h: 120, blockId: 'chair' }
  }

  canEdit = () => false
  canResize = () => true
  isAspectRatioLocked = () => false

  override getGeometry(shape: BlockShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }

  indicator(shape: BlockShape) {
    return <rect width={shape.props.w} height={shape.props.h} />
  }

  override component(shape: BlockShape) {
    const { w, h, blockId } = shape.props
    const def = getBlock(blockId)
    if (!def) {
      return (
        <SVGContainer>
          <rect width={w} height={h} fill="none" stroke="#999" strokeWidth={1} strokeDasharray="4,3" />
        </SVGContainer>
      )
    }
    return (
      <SVGContainer>
        <g transform={`scale(${w / def.wmm}, ${h / def.hmm})`}>{def.draw()}</g>
      </SVGContainer>
    )
  }

  onResize = (shape: BlockShape, info: TLResizeInfo<BlockShape>) => resizeBox(shape, info)
}
