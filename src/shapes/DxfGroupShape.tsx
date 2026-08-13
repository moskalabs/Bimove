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
  Vec,
  useEditor,
} from 'tldraw'

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

  const stroke = (shape.meta?.dxfColor as string) || '#333'
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
      isFilled: true,
    })
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
}
