import { Polygon2d, ShapeUtil, SVGContainer, T, type TLBaseShape, Vec } from 'tldraw'

export type DoorShapeProps = {
  width: number
  thickness: number
  swing: number   // 1 = +y side, -1 = -y side
  flipped: boolean  // mirrors hinge side left↔right
}

export type DoorShape = TLBaseShape<'door', DoorShapeProps>

export class DoorShapeUtil extends ShapeUtil<DoorShape> {
  static override type = 'door' as const
  static override props = {
    width: T.number,
    thickness: T.number,
    swing: T.number,
    flipped: T.boolean,
  }

  override getDefaultProps(): DoorShapeProps {
    return { width: 80, thickness: 20, swing: 1, flipped: false }
  }

  canEdit = () => false
  canResize = () => false
  isAspectRatioLocked = () => false

  override getGeometry(shape: DoorShape) {
    const { width, thickness } = shape.props
    const hw = width / 2, ht = thickness / 2
    return new Polygon2d({
      points: [new Vec(-hw, -ht), new Vec(hw, -ht), new Vec(hw, ht), new Vec(-hw, ht)],
      isFilled: true,
    })
  }

  indicator(shape: DoorShape) {
    const { width, thickness } = shape.props
    const hw = width / 2, ht = thickness / 2
    return <rect x={-hw} y={-ht} width={width} height={thickness} />
  }

  override component(shape: DoorShape) {
    const { width, thickness, swing, flipped } = shape.props
    const hw = width / 2, ht = thickness / 2
    const sw = swing  // 1 or -1
    const f = flipped ? -1 : 1  // horizontal mirror factor
    const hingeX = -hw * f
    const freeX = hw * f
    const sweepFlag = (sw > 0 ? 1 : 0) ^ (flipped ? 1 : 0)

    return (
      <SVGContainer>
        {/* 벽 위 흰색 갭 */}
        <rect x={-hw} y={-ht} width={width} height={thickness} fill="white" stroke="none" />

        {/* 문 프레임 (양쪽 잼브) */}
        <line x1={-hw} y1={-ht} x2={-hw} y2={ht} stroke="#222" strokeWidth={2} />
        <line x1={hw} y1={-ht} x2={hw} y2={ht} stroke="#222" strokeWidth={2} />

        {/* 문짝 (경첩쪽 고정) */}
        <line x1={hingeX} y1={0} x2={hingeX} y2={sw * width} stroke="#444" strokeWidth={1} />

        {/* 스윙 호 (점선) */}
        <path
          d={`M${hingeX},${sw * width} A${width},${width} 0 0,${sweepFlag} ${freeX},0`}
          stroke="#666"
          strokeWidth={0.8}
          strokeDasharray="3,2"
          fill="none"
        />
      </SVGContainer>
    )
  }
}
