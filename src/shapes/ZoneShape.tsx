/**
 * ZoneShape: 공간지정 — 사용자가 그린 폴리곤 영역
 * 이름 + 층고 + 면적/둘레 표시, 마감재 물량표 연동용
 */
import {
  Polygon2d,
  ShapeUtil,
  SVGContainer,
  T,
  type TLBaseShape,
  Vec,
} from 'tldraw'

const ZONE_COLORS = ['#1a73e8', '#34a853', '#fbbc05', '#ea4335', '#673ab7', '#00897b']

let colorIdx = 0
export function nextZoneColor(): string {
  return ZONE_COLORS[colorIdx++ % ZONE_COLORS.length]
}

export type ZoneShapeProps = {
  points: { x: number; y: number }[]
  label: string
  wallHeightMm: number
  areaM2: number
  perimeterM: number
  color: string
}

export type ZoneShape = TLBaseShape<'zone', ZoneShapeProps>

// SVG path string from points
function pointsToPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return ''
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join('') + 'Z'
}

// centroid
function centroid(pts: { x: number; y: number }[]): { x: number; y: number } {
  if (pts.length === 0) return { x: 0, y: 0 }
  const sx = pts.reduce((s, p) => s + p.x, 0)
  const sy = pts.reduce((s, p) => s + p.y, 0)
  return { x: sx / pts.length, y: sy / pts.length }
}

export class ZoneShapeUtil extends ShapeUtil<ZoneShape> {
  static override type = 'zone' as const

  static override props = {
    points: T.arrayOf(T.object({ x: T.number, y: T.number })),
    label: T.string,
    wallHeightMm: T.number,
    areaM2: T.number,
    perimeterM: T.number,
    color: T.string,
  }

  getDefaultProps(): ZoneShapeProps {
    return {
      points: [],
      label: '',
      wallHeightMm: 2400,
      areaM2: 0,
      perimeterM: 0,
      color: '#1a73e8',
    }
  }

  getGeometry(shape: ZoneShape) {
    const pts = shape.props.points
    if (pts.length < 3) {
      return new Polygon2d({
        points: [new Vec(0, 0), new Vec(10, 0), new Vec(10, 10), new Vec(0, 10)],
        isFilled: true,
      })
    }
    return new Polygon2d({
      points: pts.map(p => new Vec(p.x, p.y)),
      isFilled: true,
    })
  }

  override canEdit = () => false
  override canResize = () => false

  component(shape: ZoneShape) {
    const { points, label, areaM2, color } = shape.props
    if (points.length < 3) return null
    const path = pointsToPath(points)
    const c = centroid(points)
    const displayLabel = label || '미지정'
    const areaText = areaM2 > 0 ? `${areaM2.toFixed(1)}m²` : ''

    return (
      <SVGContainer>
        <path
          d={path}
          fill={color + '18'}
          stroke={color}
          strokeWidth={2}
          strokeDasharray="8 4"
        />
        <text
          x={c.x}
          y={c.y - 6}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={14}
          fontWeight={600}
          fill={color}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {displayLabel}
        </text>
        {areaText && (
          <text
            x={c.x}
            y={c.y + 12}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={11}
            fill={color}
            opacity={0.7}
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            {areaText}
          </text>
        )}
      </SVGContainer>
    )
  }

  indicator(shape: ZoneShape) {
    const { points, color } = shape.props
    if (points.length < 3) return null
    const path = pointsToPath(points)
    return <path d={path} fill="none" stroke={color} strokeWidth={1.5} />
  }

  override toSvg(shape: ZoneShape) {
    const { points, label, areaM2, color } = shape.props
    if (points.length < 3) return null
    const path = pointsToPath(points)
    const c = centroid(points)
    return (
      <g>
        <path d={path} fill={color + '18'} stroke={color} strokeWidth={2} strokeDasharray="8 4" />
        <text x={c.x} y={c.y - 6} textAnchor="middle" fontSize={14} fontWeight={600} fill={color}>
          {label || '미지정'}
        </text>
        {areaM2 > 0 && (
          <text x={c.x} y={c.y + 12} textAnchor="middle" fontSize={11} fill={color} opacity={0.7}>
            {areaM2.toFixed(1)}m²
          </text>
        )}
      </g>
    )
  }
}
