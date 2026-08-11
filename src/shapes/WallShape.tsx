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
import { getShowWallLengths, getGrayscaleMode } from '../lib/settings'
import { renderPatternDef } from '../lib/wallPatterns'
import type { PatternId } from '../lib/materialPresets'

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

// ── Wall snapshot cache: avoid calling getCurrentPageShapes() per-wall ──
type WallSnapshot = { id: string; x: number; y: number; props: WallShapeProps }
let _wallsCache: WallSnapshot[] = []
let _wallsCacheTime = -1

function getWallsSnapshot(editor: Editor): WallSnapshot[] {
  const now = performance.now()
  // 같은 렌더 프레임(16ms) 내에서는 캐시 재사용
  if (now - _wallsCacheTime < 16) return _wallsCache
  _wallsCacheTime = now
  _wallsCache = editor.getCurrentPageShapes()
    .filter(s => s.type === 'wall')
    .map(s => ({ id: s.id, x: s.x, y: s.y, props: s.props as WallShapeProps }))
  return _wallsCache
}

// ── Per-shape corner cache ──
const _cornersCache = new Map<string, { key: string; corners: Vec[] }>()

function shapeHashKey(shape: WallShape): string {
  return `${shape.x}|${shape.y}|${shape.props.x2}|${shape.props.y2}|${shape.props.thickness}`
}

function computeJoinedCorners(editor: Editor, shape: WallShape): Vec[] {
  const { x2, y2, thickness } = shape.props
  const len = Math.sqrt(x2 * x2 + y2 * y2)
  if (len < 1) return getCorners(shape)

  // 캐시 확인: 자신의 geometry + 이웃 wall들의 hash가 같으면 재사용
  const walls = getWallsSnapshot(editor)
  const myKey = shapeHashKey(shape)

  // 이웃 wall의 변경도 감지하기 위해 근접 wall들의 hash 포함
  const ux = x2 / len, uy = y2 / len
  const nx = -uy, ny = ux
  const half = thickness / 2
  const snapR = Math.max(JOIN_SNAP_R, half * 0.5)
  const sx = shape.x, sy = shape.y
  const ex = shape.x + x2, ey = shape.y + y2

  // 근접 wall만 추려서 해시에 포함 (O(n) 1회만, 전체 shapes 순회가 아님)
  let neighborHash = ''
  const neighbors: WallSnapshot[] = []
  for (const w of walls) {
    if (w.id === shape.id) continue
    const wp = w.props
    const wlen = Math.hypot(wp.x2, wp.y2)
    if (wlen < 1) continue

    // 빠른 거리 체크: 두 endpoint와의 거리가 snapR 이내인 wall만 이웃
    const dSS = Math.hypot(w.x - sx, w.y - sy)
    const dSE = Math.hypot(w.x + wp.x2 - sx, w.y + wp.y2 - sy)
    const dES = Math.hypot(w.x - ex, w.y - ey)
    const dEE = Math.hypot(w.x + wp.x2 - ex, w.y + wp.y2 - ey)
    const nearEnd = dSS < snapR || dSE < snapR || dES < snapR || dEE < snapR

    // T-junction 체크도 포함
    let nearBody = false
    if (!nearEnd) {
      const wux = wp.x2 / wlen, wuy = wp.y2 / wlen
      const checkProj = (px: number, py: number) => {
        const t = (px - w.x) * wux + (py - w.y) * wuy
        if (t <= snapR || t >= wlen - snapR) return false
        const projX = w.x + t * wux, projY = w.y + t * wuy
        return Math.hypot(px - projX, py - projY) < snapR
      }
      nearBody = checkProj(sx, sy) || checkProj(ex, ey)
    }

    if (nearEnd || nearBody) {
      neighbors.push(w)
      neighborHash += `${w.id}:${w.x}|${w.y}|${wp.x2}|${wp.y2}|${wp.thickness};`
    }
  }

  const fullKey = `${myKey}#${neighborHash}`
  const cached = _cornersCache.get(shape.id)
  if (cached && cached.key === fullKey) return cached.corners

  // ── 실제 계산 (이웃만 순회) ──
  let startExt = 0
  let endExt = 0

  for (const w of neighbors) {
    const wp = w.props
    const wlen = Math.hypot(wp.x2, wp.y2)
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

  const corners = [
    new Vec(nx * half - ux * startExt, ny * half - uy * startExt),
    new Vec(x2 + nx * half + ux * endExt, y2 + ny * half + uy * endExt),
    new Vec(x2 - nx * half + ux * endExt, y2 - ny * half + uy * endExt),
    new Vec(-nx * half - ux * startExt, -ny * half - uy * startExt),
  ]

  _cornersCache.set(shape.id, { key: fullKey, corners })
  return corners
}

// eslint-disable-next-line react-refresh/only-export-components
function WallComponent({ shape }: { shape: WallShape }) {
  const editor = useEditor()
  const [showDim, setShowDim] = useState(getShowWallLengths)
  const [grayscale, setGrayscale] = useState(getGrayscaleMode)

  useEffect(() => {
    const onSettings = () => {
      setShowDim(getShowWallLengths())
      setGrayscale(getGrayscaleMode())
    }
    window.addEventListener('bimove:settings', onSettings)
    return () => window.removeEventListener('bimove:settings', onSettings)
  }, [])

  const { x2, y2, thickness } = shape.props
  const len = Math.sqrt(x2 * x2 + y2 * y2)

  // 대량 shapes(200+)일 때 치수 라벨 자동 비활성화 (SVG 노드 3500+ 절감)
  const shapeCount = _wallsCache.length // 이미 캐시된 wall 수 활용
  const effectiveShowDim = showDim && shapeCount < 200

  // DXF 임포트 shapes는 miter join 불필요 → 비싼 이웃 탐색 스킵
  const isDxf = !!shape.meta?.dxfFingerprint
  const corners = isDxf ? getCorners(shape) : computeJoinedCorners(editor, shape)
  const d = `M${corners[0].x},${corners[0].y} L${corners[1].x},${corners[1].y} L${corners[2].x},${corners[2].y} L${corners[3].x},${corners[3].y} Z`

  // DXF lineweight → strokeWidth (hundredths of mm → px)
  const dxfLw = (shape.meta?.dxfLineweight as number) ?? 0
  const strokeW = dxfLw > 0 ? Math.max(0.3, Math.min(dxfLw / 25, 4)) : 1

  // Grayscale 모드: 패턴 OFF, 흑백 선
  // DXF 색상이 있으면 fill/stroke 대신 사용 (BUG 8)
  const dxfColor = shape.meta?.dxfColor as string | undefined
  const rawFill = (shape.meta?.fill as string) ?? dxfColor ?? '#555'
  const rawStroke = (shape.meta?.stroke as string) ?? dxfColor ?? '#222'
  const fill = grayscale ? '#f5f5f5' : rawFill
  const stroke = grayscale ? '#333' : rawStroke
  const pattern = grayscale ? undefined : (shape.meta?.pattern as string | undefined)
  // 패턴 ID를 패턴 이름+색상으로 공유 (벽마다 <defs> 중복 방지)
  const patKey = pattern && pattern !== 'none' ? `pat-${pattern}-${stroke.replace('#', '')}` : null
  const patternDef = patKey ? renderPatternDef(pattern as PatternId, patKey, stroke) : null
  const fillAttr = patKey ? `url(#${patKey})` : fill

  if (len < 4 || !effectiveShowDim) {
    return <SVGContainer>{patternDef}<path d={d} fill={fillAttr} stroke={stroke} strokeWidth={strokeW} /></SVGContainer>
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
      {patternDef}
      <path d={d} fill={fillAttr} stroke={stroke} strokeWidth={strokeW} />

      {effectiveShowDim && (
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
