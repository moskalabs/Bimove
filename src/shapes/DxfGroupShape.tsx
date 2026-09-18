/**
 * DxfGroupShape: DXF 레이어의 모든 라인 세그먼트를 하나의 shape로 묶어
 * 단일 SVG <path>로 렌더링. 500개 개별 wall → 5-10개 그룹으로 축소.
 */
import { useEffect, useState } from 'react'
import {
  Polygon2d,
  ShapeUtil,
  SVGContainer,
  T,
  type TLBaseShape,
  type VecLike,
  Vec,
  useEditor,
} from 'tldraw'
import { getGrayscaleMode } from '../lib/settings'

/** #ffffff 등 배경과 구분 안 되는 밝은 색 감지 */
function isNearWhite(hex: string): boolean {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return false
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16)
  // relative luminance > 0.85 → 배경(흰색)과 구분 어려움
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.85
}

export type DxfGroupShapeProps = {
  w: number       // bounding width
  h: number       // bounding height
  pathData: string // pre-computed SVG path: "M0,0L100,0 M0,50L100,50 ..."
  thickness: number
  segCount: number // 세그먼트 수 (정보용)
}

export type DxfGroupShape = TLBaseShape<'dxfgroup', DxfGroupShapeProps>

/** 줌 변화에 반응하여 strokeWidth를 조정하는 컴포넌트 */
function DxfGroupComponent({ shape }: { shape: DxfGroupShape }) {
  const editor = useEditor()
  const [zoom, setZoom] = useState(() => editor.getZoomLevel())
  const [grayscale, setGrayscale] = useState(getGrayscaleMode)

  useEffect(() => {
    // 카메라 변경 시 줌 레벨 추적 (rAF 스로틀)
    let raf = 0
    const unsub = editor.store.listen(() => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const z = editor.getZoomLevel()
        setZoom(prev => {
          // 10% 이상 변화만 업데이트 (불필요한 re-render 방지)
          if (Math.abs(prev - z) / Math.max(prev, 0.001) > 0.1) return z
          return prev
        })
      })
    })
    return () => { unsub(); if (raf) cancelAnimationFrame(raf) }
  }, [editor])

  useEffect(() => {
    const onSettings = () => setGrayscale(getGrayscaleMode())
    window.addEventListener('bimova:settings', onSettings)
    return () => window.removeEventListener('bimova:settings', onSettings)
  }, [])

  // ACI 7 = #ffffff 등 밝은 색은 라이트 배경에서 안 보이므로 보정
  const rawColor = (shape.meta?.dxfColor as string) || '#333'
  const stroke = grayscale ? '#333' : (isNearWhite(rawColor) ? '#333' : rawColor)
  const dxfLw = (shape.meta?.dxfLineweight as number) ?? 0
  const baseStrokeW = dxfLw > 0 ? Math.max(0.3, Math.min(dxfLw / 100, 2)) : 0.5
  // 줌에 따른 최소 화면 0.5px 보장: zoom 1%에서 strokeW = 50 (50*0.01 = 0.5px 화면)
  const minStroke = 0.5 / Math.max(zoom, 0.001)
  const strokeW = Math.max(baseStrokeW, minStroke)

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

/** pathData("M0,0L100,0 M0,50L100,50 ...")에서 개별 선분 추출 후 point 근접 여부 판단 */
export function isPointNearPath(pathData: string, pt: VecLike, margin: number): boolean {
  // pathData는 "Mx1,y1Lx2,y2 Mx3,y3Lx4,y4 ..." 형태
  const re = /M([\d.e+-]+),([\d.e+-]+)L([\d.e+-]+),([\d.e+-]+)/g
  let m
  while ((m = re.exec(pathData)) !== null) {
    const ax = +m[1], ay = +m[2], bx = +m[3], by = +m[4]
    if (distPointToSeg(pt.x, pt.y, ax, ay, bx, by) <= margin) return true
  }
  return false
}

/** 점 (px,py)에서 선분 (ax,ay)-(bx,by)까지의 최단 거리 */
export function distPointToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

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

  /** 개별 선 위 클릭만 선택되도록 pathData 기반 히트 테스트 */
  override hitTestPoint(shape: DxfGroupShape, point: VecLike): boolean {
    const HIT_MARGIN = 6 // 페이지 단위 허용 오차
    return isPointNearPath(shape.props.pathData, point, HIT_MARGIN)
  }

  component(shape: DxfGroupShape) {
    return <DxfGroupComponent shape={shape} />
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

  override toSvg(shape: DxfGroupShape) {
    const rawColor = (shape.meta?.dxfColor as string) || '#333'
    const stroke = isNearWhite(rawColor) ? '#333' : rawColor
    const dxfLw = (shape.meta?.dxfLineweight as number) ?? 0
    const strokeW = dxfLw > 0 ? Math.max(0.3, Math.min(dxfLw / 100, 2)) : 0.5

    return (
      <g>
        <path
          d={shape.props.pathData}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeW}
          strokeLinecap="round"
        />
      </g>
    )
  }
}
