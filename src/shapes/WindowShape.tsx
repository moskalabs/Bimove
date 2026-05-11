import { Polygon2d, ShapeUtil, SVGContainer, T, type TLBaseShape, Vec } from 'tldraw'

export type WindowShapeProps = {
  width: number
  thickness: number
}

export type WindowShape = TLBaseShape<'window', WindowShapeProps>

export class WindowShapeUtil extends ShapeUtil<WindowShape> {
  static override type = 'window' as const
  static override props = {
    width: T.number,
    thickness: T.number,
  }

  override getDefaultProps(): WindowShapeProps {
    return { width: 60, thickness: 20 }
  }

  canEdit = () => false
  canResize = () => false
  isAspectRatioLocked = () => false

  override getGeometry(shape: WindowShape) {
    const { width, thickness } = shape.props
    const hw = width / 2, ht = thickness / 2
    return new Polygon2d({
      points: [new Vec(-hw, -ht), new Vec(hw, -ht), new Vec(hw, ht), new Vec(-hw, ht)],
      isFilled: true,
    })
  }

  indicator(shape: WindowShape) {
    const { width, thickness } = shape.props
    const hw = width / 2, ht = thickness / 2
    return <rect x={-hw} y={-ht} width={width} height={thickness} />
  }

  override component(shape: WindowShape) {
    const { width, thickness } = shape.props
    const hw = width / 2, ht = thickness / 2
    const gap = ht * 0.4  // 유리 선 간격

    return (
      <SVGContainer>
        {/* 벽 갭 */}
        <rect x={-hw} y={-ht} width={width} height={thickness} fill="white" stroke="none" />

        {/* 창틀 */}
        <line x1={-hw} y1={-ht} x2={-hw} y2={ht} stroke="#222" strokeWidth={2} />
        <line x1={hw} y1={-ht} x2={hw} y2={ht} stroke="#222" strokeWidth={2} />

        {/* 유리 (평행선 2개) */}
        <line x1={-hw} y1={-gap} x2={hw} y2={-gap} stroke="#55aaff" strokeWidth={1.5} />
        <line x1={-hw} y1={gap} x2={hw} y2={gap} stroke="#55aaff" strokeWidth={1.5} />
      </SVGContainer>
    )
  }
}
