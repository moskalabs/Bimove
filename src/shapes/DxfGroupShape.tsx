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

/** 라이트 배경에서 밝은 색(cyan, yellow 등)을 어둡게 보정 */
function darkenForLightBg(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return hex
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  if (lum <= 0.5) return hex // 충분히 어두움
  const factor = 0.45 / lum
  const nr = Math.round(Math.min(255, r * factor))
  const ng = Math.round(Math.min(255, g * factor))
  const nb = Math.round(Math.min(255, b * factor))
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`
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
  shapeMaxDim?: number,
): React.ReactElement | null {
  // shape 크기에 비례해서 패턴 셀 크기 결정 (약 30~50회 반복 목표)
  const dim = shapeMaxDim ?? 400
  const baseSz = Math.max(10, dim / 40)
  const sz = baseSz * Math.max(0.5, scale) // 패턴 셀 크기
  const sw = Math.max(0.8, sz * 0.10) // 선 두께 비례 (더 굵게)
  const upper = patternName.toUpperCase()

  // SOLID: 패턴 없이 단색 fill
  if (upper === 'SOLID') return null

  const rotate = angle !== 0 ? `rotate(${angle})` : undefined

  // --- 사선 해칭 (ANSI) ---
  if (upper === 'ANSI31' || upper === 'ANSI32') {
    const gap = upper === 'ANSI32' ? sz * 0.5 : sz
    return (
      <pattern id={id} width={gap} height={gap} patternUnits="userSpaceOnUse"
        patternTransform={rotate ?? 'rotate(45)'}>
        <line x1={0} y1={0} x2={gap} y2={0} stroke={color} strokeWidth={sw} opacity={0.85} />
      </pattern>
    )
  }

  if (upper === 'ANSI37' || upper === 'ANSI38') {
    return (
      <pattern id={id} width={sz} height={sz} patternUnits="userSpaceOnUse"
        patternTransform={rotate ?? 'rotate(-45)'}>
        <line x1={0} y1={0} x2={sz} y2={0} stroke={color} strokeWidth={sw} opacity={0.85} />
      </pattern>
    )
  }

  // --- 콘크리트 ---
  if (upper.startsWith('AR-CONC') || upper === 'CONCRETE') {
    const d = sz * 1.5
    const r1 = Math.max(0.8, sz * 0.12)
    return (
      <pattern id={id} width={d} height={d} patternUnits="userSpaceOnUse"
        patternTransform={rotate}>
        <circle cx={d * 0.2} cy={d * 0.2} r={r1} fill={color} opacity={0.7} />
        <circle cx={d * 0.7} cy={d * 0.6} r={r1 * 0.7} fill={color} opacity={0.6} />
        <circle cx={d * 0.4} cy={d * 0.9} r={r1 * 0.5} fill={color} opacity={0.55} />
      </pattern>
    )
  }

  // --- 벽돌 ---
  if (upper.startsWith('AR-BRST') || upper === 'BRICK' || upper === 'AR-BRSTD') {
    const bw = sz * 1.75, bh = sz
    return (
      <pattern id={id} width={bw} height={bh} patternUnits="userSpaceOnUse"
        patternTransform={rotate}>
        <line x1={0} y1={0} x2={bw} y2={0} stroke={color} strokeWidth={sw} opacity={0.8} />
        <line x1={0} y1={bh / 2} x2={bw} y2={bh / 2} stroke={color} strokeWidth={sw} opacity={0.8} />
        <line x1={bw / 2} y1={0} x2={bw / 2} y2={bh / 2} stroke={color} strokeWidth={sw} opacity={0.8} />
        <line x1={0} y1={bh / 2} x2={0} y2={bh} stroke={color} strokeWidth={sw} opacity={0.8} />
      </pattern>
    )
  }

  // --- 단순 수평선 ---
  if (upper === 'LINE' || upper === 'HATCH') {
    return (
      <pattern id={id} width={sz} height={sz} patternUnits="userSpaceOnUse"
        patternTransform={rotate}>
        <line x1={0} y1={0} x2={sz} y2={0} stroke={color} strokeWidth={sw} opacity={0.8} />
      </pattern>
    )
  }

  // --- 격자 ---
  if (upper === 'CROSS' || upper === 'GRID') {
    return (
      <pattern id={id} width={sz} height={sz} patternUnits="userSpaceOnUse"
        patternTransform={rotate}>
        <line x1={0} y1={0} x2={sz} y2={0} stroke={color} strokeWidth={sw} opacity={0.8} />
        <line x1={0} y1={0} x2={0} y2={sz} stroke={color} strokeWidth={sw} opacity={0.8} />
      </pattern>
    )
  }

  // --- 점 패턴 ---
  if (upper === 'DOTS' || upper === 'DOT') {
    const d = sz * 1.2
    const r1 = Math.max(0.8, sz * 0.10)
    return (
      <pattern id={id} width={d} height={d} patternUnits="userSpaceOnUse"
        patternTransform={rotate}>
        <circle cx={d * 0.2} cy={d * 0.2} r={r1} fill={color} opacity={0.75} />
        <circle cx={d * 0.7} cy={d * 0.6} r={r1 * 0.75} fill={color} opacity={0.65} />
        <circle cx={d * 0.4} cy={d * 0.85} r={r1 * 0.85} fill={color} opacity={0.7} />
      </pattern>
    )
  }

  // --- 모래/자갈 ---
  if (upper.startsWith('AR-SAND') || upper === 'SAND' || upper === 'GRAVEL') {
    const d = sz * 0.9
    const r1 = Math.max(0.5, sz * 0.07)
    return (
      <pattern id={id} width={d} height={d} patternUnits="userSpaceOnUse"
        patternTransform={rotate}>
        <circle cx={d * 0.15} cy={d * 0.15} r={r1} fill={color} opacity={0.65} />
        <circle cx={d * 0.55} cy={d * 0.1} r={r1 * 0.8} fill={color} opacity={0.55} />
        <circle cx={d * 0.85} cy={d * 0.35} r={r1} fill={color} opacity={0.6} />
        <circle cx={d * 0.3} cy={d * 0.5} r={r1 * 0.8} fill={color} opacity={0.55} />
        <circle cx={d * 0.7} cy={d * 0.65} r={r1} fill={color} opacity={0.65} />
        <circle cx={d * 0.1} cy={d * 0.8} r={r1 * 0.8} fill={color} opacity={0.5} />
        <circle cx={d * 0.5} cy={d * 0.9} r={r1 * 0.9} fill={color} opacity={0.6} />
        <circle cx={d * 0.9} cy={d * 0.85} r={r1 * 0.8} fill={color} opacity={0.55} />
      </pattern>
    )
  }

  // --- 지붕/루핑 ---
  if (upper.startsWith('AR-RROOF') || upper === 'AR-RSHKE') {
    const d = sz * 1.4
    return (
      <pattern id={id} width={d} height={d} patternUnits="userSpaceOnUse"
        patternTransform={rotate}>
        <line x1={0} y1={d * 0.2} x2={d * 0.45} y2={d * 0.2} stroke={color} strokeWidth={sw} opacity={0.75} />
        <line x1={d * 0.55} y1={d * 0.2} x2={d} y2={d * 0.2} stroke={color} strokeWidth={sw * 0.8} opacity={0.65} />
        <line x1={d * 0.2} y1={d * 0.5} x2={d * 0.8} y2={d * 0.5} stroke={color} strokeWidth={sw} opacity={0.7} />
        <line x1={0} y1={d * 0.8} x2={d * 0.35} y2={d * 0.8} stroke={color} strokeWidth={sw * 0.8} opacity={0.65} />
        <line x1={d * 0.5} y1={d * 0.8} x2={d} y2={d * 0.8} stroke={color} strokeWidth={sw} opacity={0.75} />
      </pattern>
    )
  }

  // --- 그물/네트 (직교 격자, GRID SHEET 등에서 사용) ---
  if (upper === 'NET' || upper === 'HONEY') {
    return (
      <pattern id={id} width={sz} height={sz} patternUnits="userSpaceOnUse"
        patternTransform={rotate}>
        <line x1={0} y1={0} x2={sz} y2={0} stroke={color} strokeWidth={sw * 0.7} opacity={0.7} />
        <line x1={0} y1={0} x2={0} y2={sz} stroke={color} strokeWidth={sw * 0.7} opacity={0.7} />
      </pattern>
    )
  }

  // --- 그레이트 ---
  if (upper === 'GRATE') {
    const g = sz * 0.6
    return (
      <pattern id={id} width={g} height={g} patternUnits="userSpaceOnUse"
        patternTransform={rotate}>
        <line x1={0} y1={0} x2={g} y2={0} stroke={color} strokeWidth={sw} opacity={0.8} />
        <line x1={0} y1={0} x2={0} y2={g} stroke={color} strokeWidth={sw} opacity={0.8} />
      </pattern>
    )
  }

  // --- 나무결 ---
  if (upper.includes('WOOD') || upper === 'DOLMIT') {
    const d = sz * 1.6
    return (
      <pattern id={id} width={d} height={d} patternUnits="userSpaceOnUse"
        patternTransform={rotate}>
        <path d={`M0,${d * 0.12} Q${d * 0.25},${d * 0.06} ${d * 0.5},${d * 0.15} T${d},${d * 0.12}`}
          stroke={color} fill="none" strokeWidth={sw * 1.2} opacity={0.7} />
        <path d={`M0,${d * 0.35} Q${d * 0.3},${d * 0.28} ${d * 0.6},${d * 0.37} T${d},${d * 0.33}`}
          stroke={color} fill="none" strokeWidth={sw} opacity={0.6} />
        <path d={`M0,${d * 0.55} Q${d * 0.2},${d * 0.50} ${d * 0.45},${d * 0.58} T${d},${d * 0.54}`}
          stroke={color} fill="none" strokeWidth={sw * 1.1} opacity={0.65} />
        <path d={`M0,${d * 0.78} Q${d * 0.35},${d * 0.72} ${d * 0.55},${d * 0.80} T${d},${d * 0.76}`}
          stroke={color} fill="none" strokeWidth={sw} opacity={0.6} />
        <path d={`M0,${d * 0.95} Q${d * 0.15},${d * 0.92} ${d * 0.4},${d * 0.97} T${d},${d * 0.94}`}
          stroke={color} fill="none" strokeWidth={sw * 0.8} opacity={0.55} />
      </pattern>
    )
  }

  // --- 페인트 (밀집 점/stipple) ---
  if (upper === 'PAINT') {
    const d = sz * 0.5
    const r1 = Math.max(0.3, sz * 0.03)
    return (
      <pattern id={id} width={d} height={d} patternUnits="userSpaceOnUse"
        patternTransform={rotate}>
        <circle cx={d * 0.1} cy={d * 0.15} r={r1} fill={color} opacity={0.6} />
        <circle cx={d * 0.5} cy={d * 0.05} r={r1 * 0.8} fill={color} opacity={0.5} />
        <circle cx={d * 0.85} cy={d * 0.25} r={r1} fill={color} opacity={0.55} />
        <circle cx={d * 0.3} cy={d * 0.45} r={r1 * 0.9} fill={color} opacity={0.5} />
        <circle cx={d * 0.7} cy={d * 0.55} r={r1} fill={color} opacity={0.6} />
        <circle cx={d * 0.15} cy={d * 0.75} r={r1 * 0.8} fill={color} opacity={0.5} />
        <circle cx={d * 0.55} cy={d * 0.85} r={r1} fill={color} opacity={0.55} />
        <circle cx={d * 0.9} cy={d * 0.7} r={r1 * 0.8} fill={color} opacity={0.5} />
        <circle cx={d * 0.4} cy={d * 0.65} r={r1 * 0.7} fill={color} opacity={0.45} />
        <circle cx={d * 0.75} cy={d * 0.9} r={r1 * 0.9} fill={color} opacity={0.55} />
      </pattern>
    )
  }

  // --- 유리 (대각선 3개, 넓은 간격) ---
  if (upper === 'GLASS' || upper === 'GLAZE') {
    const d = sz * 3
    return (
      <pattern id={id} width={d} height={d} patternUnits="userSpaceOnUse"
        patternTransform={rotate}>
        <line x1={d * 0.15} y1={0} x2={d * 0.85} y2={d} stroke={color} strokeWidth={sw * 0.7} opacity={0.6} />
        <line x1={d * 0.4} y1={0} x2={d * 1.1} y2={d} stroke={color} strokeWidth={sw * 0.5} opacity={0.45} />
        <line x1={-d * 0.1} y1={0} x2={d * 0.6} y2={d} stroke={color} strokeWidth={sw * 0.6} opacity={0.5} />
      </pattern>
    )
  }

  // --- 거울 (촘촘한 대각선 여러개) ---
  if (upper === 'MIRROR') {
    const d = sz * 1.8
    return (
      <pattern id={id} width={d} height={d} patternUnits="userSpaceOnUse"
        patternTransform={rotate}>
        <line x1={0} y1={0} x2={d} y2={d} stroke={color} strokeWidth={sw * 0.6} opacity={0.6} />
        <line x1={d * 0.3} y1={0} x2={d * 1.3} y2={d} stroke={color} strokeWidth={sw * 0.5} opacity={0.5} />
        <line x1={d * 0.6} y1={0} x2={d * 1.6} y2={d} stroke={color} strokeWidth={sw * 0.6} opacity={0.55} />
        <line x1={-d * 0.3} y1={0} x2={d * 0.7} y2={d} stroke={color} strokeWidth={sw * 0.5} opacity={0.5} />
        <line x1={-d * 0.6} y1={0} x2={d * 0.4} y2={d} stroke={color} strokeWidth={sw * 0.4} opacity={0.45} />
      </pattern>
    )
  }

  // --- 단열재 (지그재그) ---
  if (upper === 'INSUL' || upper === 'INSULATION' || upper === 'BATT' || upper === 'AR-BATT'
    || upper === 'INSUL_FILL' || upper === 'T27') {
    const d = sz * 1.2
    const h = d * 0.8
    return (
      <pattern id={id} width={d} height={d} patternUnits="userSpaceOnUse"
        patternTransform={rotate}>
        <path d={`M0,${h} L${d * 0.25},${d * 0.1} L${d * 0.5},${h} L${d * 0.75},${d * 0.1} L${d},${h}`}
          stroke={color} fill="none" strokeWidth={sw} opacity={0.75} />
      </pattern>
    )
  }

  // --- 석재/인조석 (스펙클/점 패턴) ---
  if (upper === 'STONE' || upper.startsWith('AR-STONE') || upper === 'MUDST'
    || upper === 'T41' || upper === 'EARTH') {
    const d = sz * 0.8
    const r1 = Math.max(0.4, sz * 0.04)
    return (
      <pattern id={id} width={d} height={d} patternUnits="userSpaceOnUse"
        patternTransform={rotate}>
        <circle cx={d * 0.1} cy={d * 0.1} r={r1} fill={color} opacity={0.6} />
        <circle cx={d * 0.45} cy={d * 0.05} r={r1 * 1.2} fill={color} opacity={0.5} />
        <circle cx={d * 0.8} cy={d * 0.15} r={r1 * 0.7} fill={color} opacity={0.55} />
        <circle cx={d * 0.25} cy={d * 0.35} r={r1} fill={color} opacity={0.5} />
        <circle cx={d * 0.65} cy={d * 0.4} r={r1 * 0.9} fill={color} opacity={0.6} />
        <circle cx={d * 0.9} cy={d * 0.55} r={r1 * 1.1} fill={color} opacity={0.5} />
        <circle cx={d * 0.15} cy={d * 0.6} r={r1 * 0.8} fill={color} opacity={0.55} />
        <circle cx={d * 0.5} cy={d * 0.7} r={r1} fill={color} opacity={0.5} />
        <circle cx={d * 0.35} cy={d * 0.9} r={r1 * 1.1} fill={color} opacity={0.55} />
        <circle cx={d * 0.75} cy={d * 0.85} r={r1 * 0.8} fill={color} opacity={0.5} />
      </pattern>
    )
  }

  // --- 코킹 (촘촘한 교차 해칭, X자 크로스) ---
  if (upper === 'CAULK' || upper === 'CAULKING' || upper === 'Q4') {
    const g = sz * 0.6
    return (
      <pattern id={id} width={g} height={g} patternUnits="userSpaceOnUse"
        patternTransform={rotate}>
        <line x1={0} y1={0} x2={g} y2={g} stroke={color} strokeWidth={sw * 0.8} opacity={0.8} />
        <line x1={g} y1={0} x2={0} y2={g} stroke={color} strokeWidth={sw * 0.8} opacity={0.8} />
      </pattern>
    )
  }

  // --- 금속/철 (이중 대각선) ---
  if (upper === 'STEEL' || upper === 'METAL' || upper === 'G28') {
    const d = sz * 1.2
    return (
      <pattern id={id} width={d} height={d} patternUnits="userSpaceOnUse"
        patternTransform={rotate ?? 'rotate(45)'}>
        <line x1={0} y1={0} x2={d} y2={0} stroke={color} strokeWidth={sw} opacity={0.8} />
        <line x1={0} y1={d * 0.4} x2={d} y2={d * 0.4} stroke={color} strokeWidth={sw * 0.6} opacity={0.6} />
      </pattern>
    )
  }

  // --- _USER / 사용자 정의 패턴: 촘촘한 사선 ---
  if (upper.startsWith('_USER') || upper.startsWith('*')) {
    const g = sz * 0.8
    return (
      <pattern id={id} width={g} height={g} patternUnits="userSpaceOnUse"
        patternTransform={rotate ?? 'rotate(45)'}>
        <line x1={0} y1={0} x2={g} y2={0} stroke={color} strokeWidth={sw} opacity={0.75} />
      </pattern>
    )
  }

  // 기본 fallback: 45도 사선 (잘 보이도록)
  return (
    <pattern id={id} width={sz} height={sz} patternUnits="userSpaceOnUse"
      patternTransform={rotate ?? 'rotate(45)'}>
      <line x1={0} y1={0} x2={sz} y2={0} stroke={color} strokeWidth={sw} opacity={0.75} />
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
      : darkenForLightBg(rawColor)
  const dxfLw = (meta.dxfLineweight as number) ?? 0
  const baseStrokeW = dxfLw > 0 ? Math.max(0.5, Math.min(dxfLw / 100, 2)) : 0.8
  const minStroke = 0.8 / Math.max(zoom, 0.001)
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
        ? (darkMode ? (isNearBlack(h.c) ? '#aaa' : h.c) : darkenForLightBg(h.c))
        : (darkMode ? '#aaa' : '#666')
    const patId = `hatch-${shape.id}-${i}`
    const isSolid = h.p.toUpperCase() === 'SOLID'
    return {
      id: patId,
      def: isSolid ? null : dxfHatchPatternDef(patId, h.p, h.s, h.a, hColor, Math.max(shape.props.w, shape.props.h)),
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
            ? (darkMode ? (isNearBlack(t.c) ? '#bbb' : t.c) : darkenForLightBg(t.c))
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
    const stroke = darkenForLightBg(rawColor)
    const dxfLw = (shape.meta?.dxfLineweight as number) ?? 0
    const strokeW = dxfLw > 0 ? Math.max(0.5, Math.min(dxfLw / 100, 2)) : 0.8

    let texts: DxfTextEntry[] = []
    try {
      if (shape.props.textsJson) texts = JSON.parse(shape.props.textsJson)
    } catch { /* ignore */ }

    let hatches: DxfHatchEntry[] = []
    try {
      if (shape.props.hatchesJson) hatches = JSON.parse(shape.props.hatchesJson)
    } catch { /* ignore */ }

    const svgHatchDefs = hatches.map((h, i) => {
      const hColor = h.c ? darkenForLightBg(h.c) : '#666'
      const patId = `hatch-svg-${shape.id}-${i}`
      const isSolid = h.p.toUpperCase() === 'SOLID'
      return { id: patId, def: isSolid ? null : dxfHatchPatternDef(patId, h.p, h.s, h.a, hColor, Math.max(shape.props.w, shape.props.h)), isSolid, color: hColor }
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
            fill={t.c ? darkenForLightBg(t.c) : '#555'}
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
