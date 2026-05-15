import {
  Polygon2d,
  ShapeUtil,
  SVGContainer,
  T,
  type TLBaseShape,
  type TLHandle,
  type TLOnHandleDragHandler,
  type TLResizeInfo,
  type TLShapePartial,
  Vec,
  useEditor,
} from 'tldraw'
import type { IndexKey } from '@tldraw/editor'
import { useEffect, useState } from 'react'
import { getScaleConfig, formatLength } from '../lib/scaleConfig'
import { getShowWallLengths } from '../lib/settings'

export type WallShapeProps = {
  x2: number
  y2: number
  thickness: number
}

export type WallShape = TLBaseShape<'wall', WallShapeProps>

function getCorners(shape: WallShape): Vec[] {
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

function WallComponent({ shape }: { shape: WallShape }) {
  const editor = useEditor()
  const [showDim, setShowDim] = useState(getShowWallLengths)

  useEffect(() => {
    const onSettings = () => setShowDim(getShowWallLengths())
    window.addEventListener('bimove:settings', onSettings)
    return () => window.removeEventListener('bimove:settings', onSettings)
  }, [])

  const { x2, y2, thickness } = shape.props
  const corners = getCorners(shape)
  const d = `M${corners[0].x},${corners[0].y} L${corners[1].x},${corners[1].y} L${corners[2].x},${corners[2].y} L${corners[3].x},${corners[3].y} Z`
  const len = Math.sqrt(x2 * x2 + y2 * y2)

  if (len < 4) {
    return <SVGContainer><path d={d} fill="#555" stroke="#222" strokeWidth={1} /></SVGContainer>
  }

  const nx = -y2 / len, ny = x2 / len
  const off = thickness / 2 + 14
  const ex = 6

  const d1 = { x: nx * off, y: ny * off }
  const d2 = { x: x2 + nx * off, y: y2 + ny * off }
  const angle = Math.atan2(y2, x2) * 180 / Math.PI
  const mid = { x: (d1.x + d2.x) / 2, y: (d1.y + d2.y) / 2 }

  const arrowSize = 5
  const ux = x2 / len, uy = y2 / len
  const arrow1 = `M${d1.x + ux * arrowSize},${d1.y + uy * arrowSize} L${d1.x},${d1.y} L${d1.x + nx * arrowSize / 2},${d1.y + ny * arrowSize / 2}`
  const arrow2 = `M${d2.x - ux * arrowSize},${d2.y - uy * arrowSize} L${d2.x},${d2.y} L${d2.x + nx * arrowSize / 2},${d2.y + ny * arrowSize / 2}`

  return (
    <SVGContainer>
      <path d={d} fill={(shape.meta?.fill as string) ?? '#555'} stroke={(shape.meta?.stroke as string) ?? '#222'} strokeWidth={1} />

      {showDim && (
        <>
          <line x1={d1.x} y1={d1.y} x2={d2.x} y2={d2.y} stroke="#1a73e8" strokeWidth={0.8} />
          <line x1={nx * (thickness / 2)} y1={ny * (thickness / 2)} x2={d1.x + nx * ex} y2={d1.y + ny * ex} stroke="#1a73e8" strokeWidth={0.8} />
          <line x1={x2 + nx * (thickness / 2)} y1={y2 + ny * (thickness / 2)} x2={d2.x + nx * ex} y2={d2.y + ny * ex} stroke="#1a73e8" strokeWidth={0.8} />
          <path d={arrow1} stroke="#1a73e8" strokeWidth={0.8} fill="none" />
          <path d={arrow2} stroke="#1a73e8" strokeWidth={0.8} fill="none" />
          <text
            x={mid.x}
            y={mid.y}
            fontSize={10}
            fill="#1a73e8"
            textAnchor="middle"
            dominantBaseline="middle"
            transform={`rotate(${angle > 90 || angle < -90 ? angle + 180 : angle}, ${mid.x}, ${mid.y})`}
            style={{ userSelect: 'none', pointerEvents: 'none', fontFamily: 'monospace' }}
          >
            {formatLength(len, getScaleConfig(editor))}
          </text>
        </>
      )}
    </SVGContainer>
  )
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

  canEdit = () => false
  canResize = () => false
  isAspectRatioLocked = () => false

  override getHandles(shape: WallShape): TLHandle[] {
    return [
      { id: 'start', type: 'vertex', index: 'a1' as IndexKey, x: 0, y: 0, canSnap: true },
      { id: 'end', type: 'vertex', index: 'a2' as IndexKey, x: shape.props.x2, y: shape.props.y2, canSnap: true },
    ]
  }

  onHandleDrag: TLOnHandleDragHandler<WallShape> = (shape, { handle }) => {
    if (handle.id === 'end') {
      return { id: shape.id, type: 'wall', props: { x2: handle.x, y2: handle.y } } as TLShapePartial<WallShape>
    }
    if (handle.id === 'start') {
      return {
        id: shape.id, type: 'wall',
        x: shape.x + handle.x,
        y: shape.y + handle.y,
        props: { x2: shape.props.x2 - handle.x, y2: shape.props.y2 - handle.y },
      } as TLShapePartial<WallShape>
    }
  }

  override getGeometry(shape: WallShape) {
    return new Polygon2d({ points: getCorners(shape), isFilled: true })
  }

  indicator(shape: WallShape) {
    const corners = getCorners(shape)
    const d = `M${corners[0].x},${corners[0].y} L${corners[1].x},${corners[1].y} L${corners[2].x},${corners[2].y} L${corners[3].x},${corners[3].y} Z`
    return <path d={d} />
  }

  override component(shape: WallShape) {
    return <WallComponent shape={shape} />
  }

  onResize = (shape: WallShape, _info: TLResizeInfo<WallShape>) => shape
}
