import {
  Polygon2d,
  ShapeUtil,
  SVGContainer,
  T,
  type TLBaseShape,
  type TLResizeInfo,
  Vec,
} from 'tldraw'

export type WallShapeProps = {
  x2: number
  y2: number
  thickness: number
}

export type WallShape = TLBaseShape<'wall', WallShapeProps>

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    wall: WallShapeProps
  }
}

export class WallShapeUtil extends ShapeUtil<WallShape> {
  static override type = 'wall' as const

  static override props = {
    x2: T.number,
    y2: T.number,
    thickness: T.number,
  }

  override getDefaultProps(): WallShapeProps {
    return { x2: 200, y2: 0, thickness: 20 }
  }

  override canEdit() { return false }
  override canResize() { return false }
  override isAspectRatioLocked() { return false }

  private getCorners(shape: WallShape): Vec[] {
    const { x2, y2, thickness } = shape.props
    const len = Math.sqrt(x2 * x2 + y2 * y2)
    if (len < 1) return [new Vec(0, 0), new Vec(1, 0), new Vec(1, 1), new Vec(0, 1)]
    const nx = -y2 / len
    const ny = x2 / len
    const half = thickness / 2
    return [
      new Vec(nx * half, ny * half),
      new Vec(x2 + nx * half, y2 + ny * half),
      new Vec(x2 - nx * half, y2 - ny * half),
      new Vec(-nx * half, -ny * half),
    ]
  }

  override getGeometry(shape: WallShape) {
    return new Polygon2d({ points: this.getCorners(shape), isFilled: true })
  }

  override getIndicatorPath(shape: WallShape): Path2D | undefined {
    const corners = this.getCorners(shape)
    const path = new Path2D()
    path.moveTo(corners[0].x, corners[0].y)
    for (let i = 1; i < corners.length; i++) {
      path.lineTo(corners[i].x, corners[i].y)
    }
    path.closePath()
    return path
  }

  override component(shape: WallShape) {
    const corners = this.getCorners(shape)
    const d = `M${corners[0].x},${corners[0].y} L${corners[1].x},${corners[1].y} L${corners[2].x},${corners[2].y} L${corners[3].x},${corners[3].y} Z`
    return (
      <SVGContainer>
        <path d={d} fill="#888" stroke="#333" strokeWidth={1} />
      </SVGContainer>
    )
  }

  override onResize(shape: WallShape, _info: TLResizeInfo<WallShape>) {
    return shape
  }
}
