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
  type Editor,
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

/**
 * For two walls meeting at a point, compute how far to extend wall-1's end
 * so the outer corner gap is filled. Uses miter-join geometry:
 * extension = half_thickness_2 / tan(angle/2)
 */
function miterExtension(
  d1x: number, d1y: number, // wall-1 dir pointing AWAY from junction (unit)
  d2x: number, d2y: number, // wall-2 dir pointing AWAY from junction (unit)
  h2: number,               // half-thickness of wall-2
): number {
  const sinT = Math.abs(d1x * d2y - d1y * d2x)
  if (sinT < 0.05) return 0 // nearly parallel — no gap to fill
  const cosT = d1x * d2x + d1y * d2y
  const tanHalf = sinT / (1 + Math.max(cosT, -0.9))
  return Math.min(h2 / Math.max(tanHalf, 0.05), h2 * 8) // cap extreme angles
}

const JOIN_SNAP_R = 8 // page-unit radius for endpoint matching

function computeJoinedCorners(editor: Editor, shape: WallShape): Vec[] {
  const { x2, y2, thickness } = shape.props
  const len = Math.sqrt(x2 * x2 + y2 * y2)
  if (len < 1) return getCorners(shape)

  const ux = x2 / len, uy = y2 / len
  const nx = -uy, ny = ux
  const half = thickness / 2
  const snapR = Math.max(JOIN_SNAP_R, half * 0.5)

  const sx = shape.x, sy = shape.y
  const ex = shape.x + x2, ey = shape.y + y2

  let startExt = 0
  let endExt = 0

  for (const w of editor.getCurrentPageShapes()) {
    if (w.type !== 'wall' || w.id === shape.id) continue
    const wp = w.props as WallShapeProps
    const wlen = Math.hypot(wp.x2, wp.y2)
    if (wlen < 1) continue
    const wux = wp.x2 / wlen, wuy = wp.y2 / wlen
    const wh = wp.thickness / 2

    const dSS = Math.hypot(w.x - sx, w.y - sy)
    const dSE = Math.hypot(w.x + wp.x2 - sx, w.y + wp.y2 - sy)
    const dES = Math.hypot(w.x - ex, w.y - ey)
    const dEE = Math.hypot(w.x + wp.x2 - ex, w.y + wp.y2 - ey)

    // Corner miter: connection at our START — extend backward (−dir)
    if (dSS < snapR)
      startExt = Math.max(startExt, miterExtension(ux, uy, wux, wuy, wh))
    else if (dSE < snapR)
      startExt = Math.max(startExt, miterExtension(ux, uy, -wux, -wuy, wh))

    // Corner miter: connection at our END — extend forward (+dir)
    if (dES < snapR)
      endExt = Math.max(endExt, miterExtension(-ux, -uy, wux, wuy, wh))
    else if (dEE < snapR)
      endExt = Math.max(endExt, miterExtension(-ux, -uy, -wux, -wuy, wh))

    // T-junction: our endpoint near their BODY (not their endpoint)
    const sinAngle = Math.abs(ux * wuy - uy * wux)
    if (sinAngle > 0.05) {
      const tExt = Math.min(wh / sinAngle, wh * 8)
      const projectOntoW = (px: number, py: number) => {
        const t = (px - w.x) * wux + (py - w.y) * wuy
        const projX = w.x + t * wux, projY = w.y + t * wuy
        return { t, perpDist: Math.hypot(px - projX, py - projY), onBody: t > snapR && t < wlen - snapR }
      }
      const sp = projectOntoW(sx, sy)
      if (sp.onBody && sp.perpDist < snapR && dSS >= snapR && dSE >= snapR)
        startExt = Math.max(startExt, tExt)
      const ep = projectOntoW(ex, ey)
      if (ep.onBody && ep.perpDist < snapR && dES >= snapR && dEE >= snapR)
        endExt = Math.max(endExt, tExt)
    }
  }

  return [
    new Vec(nx * half - ux * startExt, ny * half - uy * startExt),
    new Vec(x2 + nx * half + ux * endExt, y2 + ny * half + uy * endExt),
    new Vec(x2 - nx * half + ux * endExt, y2 - ny * half + uy * endExt),
    new Vec(-nx * half - ux * startExt, -ny * half - uy * startExt),
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
  const len = Math.sqrt(x2 * x2 + y2 * y2)

  // tldraw wraps shape components in a reactive context, so reading
  // editor.getCurrentPageShapes() here auto-subscribes to shape changes.
  const corners = computeJoinedCorners(editor, shape)
  const d = `M${corners[0].x},${corners[0].y} L${corners[1].x},${corners[1].y} L${corners[2].x},${corners[2].y} L${corners[3].x},${corners[3].y} Z`

  const fill = (shape.meta?.fill as string) ?? '#555'
  const stroke = (shape.meta?.stroke as string) ?? '#222'

  if (len < 4) {
    return <SVGContainer><path d={d} fill={fill} stroke={stroke} strokeWidth={1} /></SVGContainer>
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
      <path d={d} fill={fill} stroke={stroke} strokeWidth={1} />

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
