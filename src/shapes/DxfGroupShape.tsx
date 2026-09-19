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
import { getGrayscaleMode, getDarkMode } from '../lib/settings'

/** 색상의 상대 밝기 (0~1) */
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return 0.5
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/** #ffffff 등 배경과 구분 안 되는 밝은 색 감지 */
function isNearWhite(hex: string): boolean {
  return luminance(hex) > 0.85
}

/** #000000 등 어두운 배경에서 안 보이는 색 감지 */
function isNearBlack(hex: string): boolean {
  return luminance(hex) < 0.15
}

export type DxfGroupShapeProps = {
  w: number       // bounding width
  h: number       // bounding height
  pathData: string // pre-computed SVG path: "M0,0L100,0 M0,50L100,50 ..."
  thickness: number
  segCount: number // 세그먼트 수 (정보용)
  textsJson: string // JSON: Array<{ x, y, t, h, r?, c? }>
  hatchesJson: string // JSON: Array<{ d, p, s, a, c? }> (pathData, pattern, scale, angle, color)
}

type DxfTextEntry = { x: number; y: number; t: string; h: number; r?: number; c?: string }
type DxfHatchEntry = { d: string; p: string; s: number; a: number; c?: string }

/** DXF 패턴명 → SVG pattern 생성 */
function dxfHatchPatternDef(
  id: string, patternName: string, scale: number, angle: number, color: string,
): React.ReactElement | null {
  const sz = Math.max(4, 8 * scale) // 패턴 셀 크기
  const upper = patternName.toUpperCase()

  // SOLID: 패턴 없이 단색 fill
  if (upper === 'SOLID') return null

  const rotate = angle !== 0 ? `rotate(${angle})` : undefined

  if (upper === 'ANSI31' || upper === 'ANSI32') {
    // 사선 해칭 (45도)
    const gap = upper === 'ANSI32' ? sz * 0.5 : sz
    return (
      <pattern id={id} width={gap} height={gap} patternUnits="userSpaceOnUse"
        patternTransform={rotate ?? 'rotate(45)'}>
        <line x1={0} y1={0} x2={gap} y2={0} stroke={color} strokeWidth={0.6} opacity={0.7} />
      </pattern>
    )
  }

  if (upper === 'ANSI37' || upper === 'ANSI38') {
    // 역방향 사선
    return (
      <pattern id={id} width={sz} height={sz} patternUnits="userSpaceOnUse"
        patternTransform={rotate ?? 'rotate(-45)'}>
        <line x1={0} y1={0} x2={sz} y2={0} stroke={color} strokeWidth={0.6} opacity={0.7} />
      </pattern>
    )
  }

  if (upper.startsWith('AR-CONC') || upper === 'CONCRETE') {
    // 콘크리트 점 패턴
    const d = sz * 1.5
    return (
      <pattern id={id} width={d} height={d} patternUnits="userSpaceOnUse"
        patternTransform={rotate}>
        <circle cx={d * 0.2} cy={d * 0.2} r={1} fill={color} opacity={0.55} />
        <circle cx={d * 0.7} cy={d * 0.6} r={0.7} fill={color} opacity={0.45} />
        <circle cx={d * 0.4} cy={d * 0.9} r={0.5} fill={color} opacity={0.4} />
      </pattern>
    )
  }

  if (upper.startsWith('AR-BRST') || upper === 'BRICK') {
    // 벽돌 패턴
    const w = sz * 1.75, h2 = sz
    return (
      <pattern id={id} width={w} height={h2} patternUnits="userSpaceOnUse"
        patternTransform={rotate}>
        <line x1={0} y1={0} x2={w} y2={0} stroke={color} strokeWidth={0.6} opacity={0.6} />
        <line x1={0} y1={h2 / 2} x2={w} y2={h2 / 2} stroke={color} strokeWidth={0.6} opacity={0.6} />
        <line x1={w / 2} y1={0} x2={w / 2} y2={h2 / 2} stroke={color} strokeWidth={0.6} opacity={0.6} />
        <line x1={0} y1={h2 / 2} x2={0} y2={h2} stroke={color} strokeWidth={0.6} opacity={0.6} />
      </pattern>
    )
  }

  if (upper === 'LINE' || upper === 'HATCH') {
    // 단순 수평선 패턴
    return (
      <pattern id={id} width={sz} height={sz} patternUnits="userSpaceOnUse"
        patternTransform={rotate}>
        <line x1={0} y1={0} x2={sz} y2={0} stroke={color} strokeWidth={0.5} opacity={0.6} />
      </pattern>
    )
  }

  if (upper === 'CROSS' || upper === 'GRID') {
    // 격자 패턴
    return (
      <pattern id={id} width={sz} height={sz} patternUnits="userSpaceOnUse"
        patternTransform={rotate}>
        <line x1={0} y1={0} x2={sz} y2={0} stroke={color} strokeWidth={0.5} opacity={0.6} />
        <line x1={0} y1={0} x2={0} y2={sz} stroke={color} strokeWidth={0.5} opacity={0.6} />
      </pattern>
    )
  }

  if (upper === 'DOTS' || upper === 'DOT') {
    // 점 패턴 (불규칙 점)
    const d = sz * 1.2
    return (
      <pattern id={id} width={d} height={d} patternUnits="userSpaceOnUse"
        patternTransform={rotate}>
        <circle cx={d * 0.2} cy={d * 0.2} r={0.8} fill={color} opacity={0.6} />
        <circle cx={d * 0.7} cy={d * 0.6} r={0.6} fill={color} opacity={0.5} />
        <circle cx={d * 0.4} cy={d * 0.85} r={0.7} fill={color} opacity={0.55} />
      </pattern>
    )
  }

  if (upper.startsWith('AR-SAND') || upper === 'SAND') {
    // 모래/샌드 패턴 (밀집 점)
    const d = sz * 0.9
    return (
      <pattern id={id} width={d} height={d} patternUnits="userSpaceOnUse"
        patternTransform={rotate}>
        <circle cx={d * 0.15} cy={d * 0.15} r={0.5} fill={color} opacity={0.5} />
        <circle cx={d * 0.55} cy={d * 0.1} r={0.4} fill={color} opacity={0.4} />
        <circle cx={d * 0.85} cy={d * 0.35} r={0.5} fill={color} opacity={0.45} />
        <circle cx={d * 0.3} cy={d * 0.5} r={0.4} fill={color} opacity={0.4} />
        <circle cx={d * 0.7} cy={d * 0.65} r={0.5} fill={color} opacity={0.5} />
        <circle cx={d * 0.1} cy={d * 0.8} r={0.4} fill={color} opacity={0.35} />
        <circle cx={d * 0.5} cy={d * 0.9} r={0.45} fill={color} opacity={0.45} />
        <circle cx={d * 0.9} cy={d * 0.85} r={0.4} fill={color} opacity={0.4} />
      </pattern>
    )
  }

  if (upper.startsWith('AR-RROOF') || upper === 'AR-RSHKE') {
    // 지붕/루핑 패턴 (불규칙 수평선)
    const d = sz * 1.4
    return (
      <pattern id={id} width={d} height={d} patternUnits="userSpaceOnUse"
        patternTransform={rotate}>
        <line x1={0} y1={d * 0.2} x2={d * 0.45} y2={d * 0.2} stroke={color} strokeWidth={0.5} opacity={0.6} />
        <line x1={d * 0.55} y1={d * 0.2} x2={d} y2={d * 0.2} stroke={color} strokeWidth={0.4} opacity={0.5} />
        <line x1={d * 0.2} y1={d * 0.5} x2={d * 0.8} y2={d * 0.5} stroke={color} strokeWidth={0.5} opacity={0.55} />
        <line x1={0} y1={d * 0.8} x2={d * 0.35} y2={d * 0.8} stroke={color} strokeWidth={0.4} opacity={0.5} />
        <line x1={d * 0.5} y1={d * 0.8} x2={d} y2={d * 0.8} stroke={color} strokeWidth={0.5} opacity={0.6} />
      </pattern>
    )
  }

  if (upper === 'NET' || upper === 'HONEY') {
    // 그물/네트 패턴 (60도 격자)
    return (
      <pattern id={id} width={sz} height={sz} patternUnits="userSpaceOnUse"
        patternTransform={rotate}>
        <line x1={0} y1={0} x2={sz} y2={0} stroke={color} strokeWidth={0.4} opacity={0.5} />
        <line x1={0} y1={0} x2={sz * 0.5} y2={sz} stroke={color} strokeWidth={0.4} opacity={0.5} />
        <line x1={sz} y1={0} x2={sz * 0.5} y2={sz} stroke={color} strokeWidth={0.4} opacity={0.5} />
      </pattern>
    )
  }

  if (upper === 'GRATE') {
    // 그레이트/격자 (정사각형 격자, CROSS보다 촘촘)
    const g = sz * 0.6
    return (
      <pattern id={id} width={g} height={g} patternUnits="userSpaceOnUse"
        patternTransform={rotate}>
        <line x1={0} y1={0} x2={g} y2={0} stroke={color} strokeWidth={0.6} opacity={0.6} />
        <line x1={0} y1={0} x2={0} y2={g} stroke={color} strokeWidth={0.6} opacity={0.6} />
      </pattern>
    )
  }

  if (upper.includes('WOOD') || upper === 'DOLMIT') {
    // 나무결/돌 패턴 (곡선 느낌의 수평선)
    const d = sz * 1.6
    return (
      <pattern id={id} width={d} height={d} patternUnits="userSpaceOnUse"
        patternTransform={rotate}>
        <path d={`M0,${d * 0.15} Q${d * 0.25},${d * 0.1} ${d * 0.5},${d * 0.18} T${d},${d * 0.15}`}
          stroke={color} fill="none" strokeWidth={0.5} opacity={0.55} />
        <path d={`M0,${d * 0.4} Q${d * 0.3},${d * 0.35} ${d * 0.6},${d * 0.42} T${d},${d * 0.38}`}
          stroke={color} fill="none" strokeWidth={0.4} opacity={0.45} />
        <path d={`M0,${d * 0.62} Q${d * 0.2},${d * 0.58} ${d * 0.45},${d * 0.65} T${d},${d * 0.6}`}
          stroke={color} fill="none" strokeWidth={0.5} opacity={0.5} />
        <path d={`M0,${d * 0.85} Q${d * 0.35},${d * 0.82} ${d * 0.55},${d * 0.88} T${d},${d * 0.84}`}
          stroke={color} fill="none" strokeWidth={0.4} opacity={0.45} />
      </pattern>
    )
  }

  // 기본 fallback: 45도 사선
  return (
    <pattern id={id} width={sz} height={sz} patternUnits="userSpaceOnUse"
      patternTransform={rotate ?? 'rotate(45)'}>
      <line x1={0} y1={0} x2={sz} y2={0} stroke={color} strokeWidth={0.5} opacity={0.5} />
    </pattern>
  )
}

export type DxfGroupShape = TLBaseShape<'dxfgroup', DxfGroupShapeProps>

/** 줌 변화에 반응하여 strokeWidth를 조정하는 컴포넌트 */
function DxfGroupComponent({ shape }: { shape: DxfGroupShape }) {
  const editor = useEditor()
  const [zoom, setZoom] = useState(() => editor.getZoomLevel())
  const [grayscale, setGrayscale] = useState(getGrayscaleMode)
  const [darkMode, setDarkModeState] = useState(getDarkMode)
  // meta 변경 감지용 (재질 적용 시 re-render 트리거)
  const [meta, setMeta] = useState(() => shape.meta as Record<string, unknown>)

  useEffect(() => {
    let raf = 0
    const unsub = editor.store.listen(() => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const z = editor.getZoomLevel()
        setZoom(prev => {
          if (Math.abs(prev - z) / Math.max(prev, 0.001) > 0.1) return z
          return prev
        })
        // shape meta 변경 감지
        const latest = editor.getShape(shape.id)
        if (latest) {
          const lm = latest.meta as Record<string, unknown>
          setMeta(prev => {
            if (prev.fill !== lm.fill || prev.stroke !== lm.stroke) return lm
            return prev
          })
        }
      })
    })
    return () => { unsub(); if (raf) cancelAnimationFrame(raf) }
  }, [editor, shape.id])

  useEffect(() => {
    const onSettings = () => {
      setGrayscale(getGrayscaleMode())
      setDarkModeState(getDarkMode())
    }
    window.addEventListener('bimova:settings', onSettings)
    return () => window.removeEventListener('bimova:settings', onSettings)
  }, [])

  // 재질 적용 색상 (MaterialsPanel에서 meta에 설정)
  const matFill = (meta.fill as string) || ''
  const matStroke = (meta.stroke as string) || ''

  // 배경 대비 색상 보정: 라이트 배경에서 밝은 색, 다크 배경에서 어두운 색 보정
  const rawColor = matStroke || (meta.dxfColor as string) || (darkMode ? '#ccc' : '#333')
  const stroke = grayscale
    ? (darkMode ? '#ccc' : '#333')
    : darkMode
      ? (isNearBlack(rawColor) ? '#ccc' : rawColor)
      : (isNearWhite(rawColor) ? '#333' : rawColor)
  const dxfLw = (meta.dxfLineweight as number) ?? 0
  const baseStrokeW = dxfLw > 0 ? Math.max(0.3, Math.min(dxfLw / 100, 2)) : 0.5
  const minStroke = 0.5 / Math.max(zoom, 0.001)
  const strokeW = Math.max(baseStrokeW, minStroke)

  // 텍스트 데이터 파싱
  let texts: DxfTextEntry[] = []
  try {
    if (shape.props.textsJson) texts = JSON.parse(shape.props.textsJson)
  } catch { /* ignore */ }

  // HATCH 데이터 파싱
  let hatches: DxfHatchEntry[] = []
  try {
    if (shape.props.hatchesJson) hatches = JSON.parse(shape.props.hatchesJson)
  } catch { /* ignore */ }

  // HATCH SVG 패턴 defs + fill 준비
  const hatchDefs: Array<{ id: string; def: React.ReactElement | null; isSolid: boolean; color: string }> = hatches.map((h, i) => {
    const hColor = grayscale
      ? (darkMode ? '#aaa' : '#666')
      : h.c
        ? (darkMode ? (isNearBlack(h.c) ? '#aaa' : h.c) : (isNearWhite(h.c) ? '#666' : h.c))
        : (darkMode ? '#aaa' : '#666')
    const patId = `hatch-${shape.id}-${i}`
    const isSolid = h.p.toUpperCase() === 'SOLID'
    return {
      id: patId,
      def: isSolid ? null : dxfHatchPatternDef(patId, h.p, h.s, h.a, hColor),
      isSolid,
      color: hColor,
    }
  })

  return (
    <SVGContainer>
      {hatchDefs.some(d => d.def) && (
        <defs>
          {hatchDefs.map(d => d.def)}
        </defs>
      )}
      {matFill && (
        <rect
          x={0} y={0}
          width={shape.props.w}
          height={shape.props.h}
          fill={matFill}
          opacity={0.35}
        />
      )}
      {/* HATCH fills (아웃라인 뒤, 텍스트 앞) */}
      {hatches.map((h, i) => {
        const hd = hatchDefs[i]
        if (hd.isSolid) {
          return (
            <path key={`h${i}`} d={h.d}
              fill={hd.color} stroke="none" opacity={0.85} pointerEvents="none" />
          )
        }
        // 패턴 해치: 배경색 + 패턴 오버레이
        return (
          <g key={`h${i}`} pointerEvents="none">
            <path d={h.d} fill={hd.color} stroke="none" opacity={0.4} />
            <path d={h.d} fill={`url(#${hd.id})`} stroke="none" opacity={0.85} />
          </g>
        )
      })}
      {shape.props.pathData && (
        <path
          d={shape.props.pathData}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeW}
          strokeLinecap="round"
        />
      )}
      {texts.map((t, i) => {
        const fontSize = Math.max(t.h, 2 / Math.max(zoom, 0.001))
        const defaultTextColor = darkMode ? '#bbb' : '#555'
        const textColor = grayscale
          ? defaultTextColor
          : t.c
            ? (darkMode ? (isNearBlack(t.c) ? '#bbb' : t.c) : (isNearWhite(t.c) ? '#555' : t.c))
            : defaultTextColor
        return (
          <text
            key={i}
            x={t.x}
            y={t.y}
            fontSize={fontSize}
            fill={textColor}
            fontFamily="sans-serif"
            dominantBaseline="auto"
            transform={t.r ? `rotate(${-t.r},${t.x},${t.y})` : undefined}
          >
            {t.t}
          </text>
        )
      })}
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
    textsJson: T.string,
    hatchesJson: T.string,
  }

  getDefaultProps(): DxfGroupShapeProps {
    return { w: 100, h: 100, pathData: '', thickness: 2, segCount: 0, textsJson: '', hatchesJson: '' }
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

  override toSvg(shape: DxfGroupShape) {
    const rawColor = (shape.meta?.dxfColor as string) || '#333'
    const stroke = isNearWhite(rawColor) ? '#333' : rawColor
    const dxfLw = (shape.meta?.dxfLineweight as number) ?? 0
    const strokeW = dxfLw > 0 ? Math.max(0.3, Math.min(dxfLw / 100, 2)) : 0.5

    let texts: DxfTextEntry[] = []
    try {
      if (shape.props.textsJson) texts = JSON.parse(shape.props.textsJson)
    } catch { /* ignore */ }

    let hatches: DxfHatchEntry[] = []
    try {
      if (shape.props.hatchesJson) hatches = JSON.parse(shape.props.hatchesJson)
    } catch { /* ignore */ }

    const svgHatchDefs = hatches.map((h, i) => {
      const hColor = h.c && !isNearWhite(h.c) ? h.c : '#666'
      const patId = `hatch-svg-${shape.id}-${i}`
      const isSolid = h.p.toUpperCase() === 'SOLID'
      return { id: patId, def: isSolid ? null : dxfHatchPatternDef(patId, h.p, h.s, h.a, hColor), isSolid, color: hColor }
    })

    return (
      <g>
        {svgHatchDefs.some(d => d.def) && (
          <defs>
            {svgHatchDefs.map(d => d.def)}
          </defs>
        )}
        {hatches.map((h, i) => {
          const hd = svgHatchDefs[i]
          if (hd.isSolid) {
            return <path key={`h${i}`} d={h.d} fill={hd.color} stroke="none" opacity={0.85} />
          }
          return (
            <g key={`h${i}`}>
              <path d={h.d} fill={hd.color} stroke="none" opacity={0.4} />
              <path d={h.d} fill={`url(#${hd.id})`} stroke="none" opacity={0.85} />
            </g>
          )
        })}
        {shape.props.pathData && (
          <path
            d={shape.props.pathData}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeW}
            strokeLinecap="round"
          />
        )}
        {texts.map((t, i) => (
          <text
            key={i}
            x={t.x}
            y={t.y}
            fontSize={t.h}
            fill={t.c && !isNearWhite(t.c) ? t.c : '#555'}
            fontFamily="sans-serif"
            dominantBaseline="auto"
            transform={t.r ? `rotate(${-t.r},${t.x},${t.y})` : undefined}
          >
            {t.t}
          </text>
        ))}
      </g>
    )
  }
}
