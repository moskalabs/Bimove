import {
  Rectangle2d,
  ShapeUtil,
  SVGContainer,
  T,
  type TLBaseShape,
  type TLResizeInfo,
} from 'tldraw'
import { getScaleConfig, formatLength } from '../lib/scaleConfig'

export type DimensionShapeProps = {
  x2: number
  y2: number
  offset: number
}

export type DimensionShape = TLBaseShape<'dimension', DimensionShapeProps>

export class DimensionShapeUtil extends ShapeUtil<DimensionShape> {
  static override type = 'dimension' as const

  static override props = {
    x2: T.number,
    y2: T.number,
    offset: T.number,
  }

  override getDefaultProps(): DimensionShapeProps {
    return { x2: 200, y2: 0, offset: 60 }
  }

  canEdit = () => false
  canResize = () => false
  isAspectRatioLocked = () => false

  override getGeometry(shape: DimensionShape) {
    const { x2, y2, offset } = shape.props
    const len = Math.sqrt(x2 * x2 + y2 * y2)
    if (len < 1) return new Rectangle2d({ x: 0, y: 0, width: 1, height: 1, isFilled: false })
    const nx = -y2 / len, ny = x2 / len
    const xs = [0, x2, nx * offset, x2 + nx * offset]
    const ys = [0, y2, ny * offset, y2 + ny * offset]
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    return new Rectangle2d({
      x: minX - 12, y: minY - 12,
      width: maxX - minX + 24,
      height: maxY - minY + 24,
      isFilled: false,
    })
  }

  indicator(shape: DimensionShape) {
    const { x2, y2, offset } = shape.props
    const len = Math.sqrt(x2 * x2 + y2 * y2)
    if (len < 1) return null
    const nx = -y2 / len, ny = x2 / len
    const d1x = nx * offset, d1y = ny * offset
    const d2x = x2 + nx * offset, d2y = y2 + ny * offset
    return <polyline points={`0,0 ${d1x},${d1y} ${d2x},${d2y} ${x2},${y2}`} fill="none" />
  }

  override component(shape: DimensionShape) {
    const { x2, y2, offset } = shape.props
    const len = Math.sqrt(x2 * x2 + y2 * y2)
    if (len < 2) return <SVGContainer />

    const nx = -y2 / len, ny = x2 / len
    const ux = x2 / len, uy = y2 / len

    const d1x = nx * offset, d1y = ny * offset
    const d2x = x2 + nx * offset, d2y = y2 + ny * offset
    const midX = (d1x + d2x) / 2, midY = (d1y + d2y) / 2
    const angle = Math.atan2(y2, x2) * 180 / Math.PI
    const textAngle = angle > 90 || angle < -90 ? angle + 180 : angle

    const arrow = 8, ext = 10
    const color = '#e67e22'
    const sw = 1

    return (
      <SVGContainer>
        {/* 연장선 */}
        <line x1={0} y1={0} x2={d1x + nx * ext} y2={d1y + ny * ext} stroke={color} strokeWidth={sw} />
        <line x1={x2} y1={y2} x2={d2x + nx * ext} y2={d2y + ny * ext} stroke={color} strokeWidth={sw} />
        {/* 치수선 */}
        <line x1={d1x} y1={d1y} x2={d2x} y2={d2y} stroke={color} strokeWidth={sw} />
        {/* 화살표 */}
        <path
          d={`M${d1x + ux * arrow},${d1y + uy * arrow} L${d1x},${d1y} L${d1x + nx * arrow * 0.4},${d1y + ny * arrow * 0.4}`}
          stroke={color} strokeWidth={sw} fill="none"
        />
        <path
          d={`M${d2x - ux * arrow},${d2y - uy * arrow} L${d2x},${d2y} L${d2x + nx * arrow * 0.4},${d2y + ny * arrow * 0.4}`}
          stroke={color} strokeWidth={sw} fill="none"
        />
        {/* 치수 텍스트 */}
        <text
          x={midX}
          y={midY - 6}
          fontSize={11}
          fill={color}
          textAnchor="middle"
          dominantBaseline="auto"
          transform={`rotate(${textAngle}, ${midX}, ${midY - 6})`}
          style={{ userSelect: 'none', pointerEvents: 'none', fontFamily: 'monospace', fontWeight: 600 }}
        >
          {formatLength(len, getScaleConfig(this.editor))}
        </text>
      </SVGContainer>
    )
  }

  onResize = (shape: DimensionShape, _info: TLResizeInfo<DimensionShape>) => shape
}
