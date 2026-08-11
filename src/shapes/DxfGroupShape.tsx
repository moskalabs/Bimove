/**
 * DxfGroupShape: DXF 레이어의 모든 라인 세그먼트를 하나의 shape로 묶어
 * 단일 SVG <path>로 렌더링. 500개 개별 wall → 5-10개 그룹으로 축소.
 */
import {
  Polygon2d,
  ShapeUtil,
  SVGContainer,
  T,
  type TLBaseShape,
  Vec,
} from 'tldraw'

export type DxfGroupShapeProps = {
  w: number       // bounding width
  h: number       // bounding height
  pathData: string // pre-computed SVG path: "M0,0L100,0 M0,50L100,50 ..."
  thickness: number
  segCount: number // 세그먼트 수 (정보용)
}

export type DxfGroupShape = TLBaseShape<'dxfgroup', DxfGroupShapeProps>

export class DxfGroupShapeUtil extends ShapeUtil<DxfGroupShape> {
  static override type = 'dxfgroup' as const

  static override props = {
    w: T.number,
    h: T.number,
    pathData: T.string,
    thickness: T.number,
    segCount: T.number,
  }

  getDefaultProps(): DxfGroupShapeProps {
    return { w: 100, h: 100, pathData: '', thickness: 2, segCount: 0 }
  }

  getGeometry(shape: DxfGroupShape) {
    return new Polygon2d({
      points: [
        new Vec(0, 0),
        new Vec(shape.props.w, 0),
        new Vec(shape.props.w, shape.props.h),
        new Vec(0, shape.props.h),
      ],
      isFilled: false,
    })
  }

  component(shape: DxfGroupShape) {
    const stroke = (shape.meta?.dxfColor as string) || '#555'
    const dxfLw = (shape.meta?.dxfLineweight as number) ?? 0
    const strokeW = dxfLw > 0 ? Math.max(0.3, Math.min(dxfLw / 25, 4)) : Math.max(0.5, shape.props.thickness)

    return (
      <SVGContainer>
        <path
          d={shape.props.pathData}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeW}
          strokeLinecap="round"
        />
      </SVGContainer>
    )
  }

  indicator(shape: DxfGroupShape) {
    return (
      <rect
        width={shape.props.w}
        height={shape.props.h}
        fill="none"
        stroke="var(--color-selected)"
        strokeWidth={1}
      />
    )
  }
}
