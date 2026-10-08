/**
 * DxfGroupShape: DXF 레이어의 모든 라인 세그먼트를 하나의 shape로 묶어
 * 단일 SVG <path>로 렌더링. 500개 개별 wall → 5-10개 그룹으로 축소.
 */
import { useEffect, useMemo, useState, memo } from 'react'
import {
  Edge2d,
  Group2d,
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
import { unpackTextsJson } from '../lib/dxf'

/** 색상의 상대 밝기 (0~1) */
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return 0.5
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/** #ffffff 등 배경과 구분 안 되는 밝은 색 감지 */
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

/** DXF 텍스트 폰트 → CSS font-family 리스트.
 *  이름에 따옴표가 섞이면 리스트 전체가 무효가 되어 한글 폴백까지 날아가므로
 *  리스트를 깨는 문자는 제거한다. (worker 쪽 isFontNameLike 와 이중 방어) */
const DXF_FALLBACK_FONTS = "'Noto Sans KR', 'Malgun Gothic', sans-serif"
function dxfFontFamily(f?: string): string {
  const safe = f?.replace(/['"\\;,]/g, '').trim()
  return safe ? `'${safe}', ${DXF_FALLBACK_FONTS}` : DXF_FALLBACK_FONTS
}

export type DxfGroupShapeProps = {
  w: number       // bounding width
  h: number       // bounding height
  pathData: string // pre-computed SVG path: "M0,0L100,0 M0,50L100,50 ..."
  thickness: number
  segCount: number // 세그먼트 수 (정보용)
  textsJson: string // JSON: Array<{ x, y, t, h, r?, c? }>
  hatchesJson: string // JSON: Array<{ d, p, s, a, sp?, n?, dl?, c?, f? }> (path, pattern, scale, angle, 간격, 정의선수, 정의선, color, solidFill)
}

type DxfTextEntry = { x: number; y: number; t: string; h: number; r?: number; c?: string; ap?: number; mw?: number; f?: string }
/** hatchesJson 의 패턴 정의선 한 줄 — a=각도(deg, CCW), s=줄 간격(px), d=dash 길이(px) */
type DxfDefLine = { a: number; s: number; d?: number[] }

type DxfHatchEntry = {
  d: string; p: string; s: number; a: number
  sp?: number   // DXF 패턴 정의선에서 해석한 실제 간격 (px). 없으면 shape 크기로 추정.
  n?: number    // 패턴 정의선 수. 2 이상이면 격자형 해치.
  dl?: DxfDefLine[] // 해석된 정의선. 있으면 패턴명 추측 없이 이걸 그대로 그린다.
  c?: string; f?: number; dim?: number
}

/** 단색 채움인지: DXF gc 70 이 1 이거나 패턴명이 SOLID 계열 (예: "SOLID,_O"). */
function isSolidHatch(h: DxfHatchEntry): boolean {
  return h.f === 1 || h.p.toUpperCase().split(',')[0] === 'SOLID'
}

/** 해치 한 칸을 가로지르는 패턴 반복 횟수 한계.
 *  너무 촘촘하면 통짜 회색으로 뭉개지고, 너무 넓으면 선이 한 줄도 안 보인다. */
const HATCH_MIN_REPEAT = 4
const HATCH_MAX_REPEAT = 60

/**
 * DXF 패턴 정의선 → SVG pattern 들.
 *
 * 정의선 하나가 "평행선 한 가족"이라서 정의선마다 pattern 을 하나씩 만들고
 * 같은 경로에 겹쳐 깐다. 타일은 (dash 한 주기 × 줄 간격) 크기에 y 중앙을
 * 가로지르는 선 하나 — 회전시키면 정확히 맞물려 반복된다.
 *
 * 간격 보정은 **가장 촘촘한 선 기준으로 한 번만** 구해서 전부에 똑같이 곱한다.
 * 선마다 따로 clamp 하면 정의선 사이의 비율이 깨져서 원본과 다른 그림이 된다.
 */
function dxfDefLinePatterns(
  idBase: string, dl: DxfDefLine[], color: string, dim: number,
): { ids: string[]; defs: React.ReactElement[] } {
  const lines = dl.filter(d => d.s > 0 && isFinite(d.s))
  if (lines.length === 0) return { ids: [], defs: [] }

  const finest = Math.min(...lines.map(d => d.s))
  const lo = dim / HATCH_MAX_REPEAT, hi = dim / HATCH_MIN_REPEAT
  const k = finest < lo ? lo / finest : finest > hi ? hi / finest : 1

  const ids: string[] = []
  const defs: React.ReactElement[] = []
  lines.forEach((d, li) => {
    const sp = d.s * k
    const sw = Math.max(0.4, Math.min(sp * 0.12, 1.5))
    // DXF dash: 양수=실선, 음수=공백, 0=점. SVG strokeDasharray 는 실선부터
    // 번갈아 읽으므로 실선으로 시작하게 회전시킨다 (타일 반복이라 위상만 밀림).
    const src = d.d ?? []
    const head = src.findIndex(v => v >= 0)
    const seq = head > 0 ? [...src.slice(head), ...src.slice(0, head)] : src
    const hasDot = seq.some(v => v === 0)
    const dashes = head < 0 ? [] : seq.map(v => (v === 0 ? sw * 0.01 : Math.abs(v) * k))
    const cycle = dashes.reduce((a, b) => a + b, 0)
    const dashed = cycle > 0.01
    // 홀수 개면 SVG 가 실선/공백을 뒤집어 가며 두 바퀴 돌려야 한 주기가 된다.
    const w = dashed ? (dashes.length % 2 === 1 ? cycle * 2 : cycle) : sp * 2
    const id = `${idBase}-d${li}`
    ids.push(id)
    defs.push(
      <pattern key={id} id={id} width={w} height={sp} patternUnits="userSpaceOnUse"
        patternTransform={d.a !== 0 ? `rotate(${-d.a})` : undefined}>
        <line x1={0} y1={sp / 2} x2={w} y2={sp / 2}
          stroke={color} strokeWidth={sw} opacity={0.85}
          {...(hasDot ? { strokeLinecap: 'round' as const } : {})}
          {...(dashed ? { strokeDasharray: dashes.map(v => +v.toFixed(2)).join(' ') } : {})} />
      </pattern>
    )
  })
  return { ids, defs }
}

/** 해치 하나의 채움 준비 결과. 정의선이 여러 개면 패턴도 여러 개 겹쳐 그린다. */
type HatchFill = { ids: string[]; defs: React.ReactElement[]; isSolid: boolean; color: string }

/** 해치 하나 → 채움. DXF 정의선이 있으면 그걸 쓰고, 없으면 패턴명으로 추정한다. */
function buildHatchFill(
  h: DxfHatchEntry, idBase: string, color: string, shapeMaxDim: number,
): HatchFill {
  if (isSolidHatch(h)) return { ids: [], defs: [], isSolid: true, color }
  const dim = h.dim ?? shapeMaxDim
  if (h.dl && h.dl.length > 0) {
    const r = dxfDefLinePatterns(idBase, h.dl, color, dim)
    if (r.defs.length > 0) return { ...r, isSolid: false, color }
  }
  const def = dxfHatchPatternDef(idBase, h.p, h.s, h.a, color, dim, h.sp, h.n)
  return { ids: def ? [idBase] : [], defs: def ? [def] : [], isSolid: false, color }
}

/** DXF 패턴명 → SVG pattern 생성 */
function dxfHatchPatternDef(
  id: string, patternName: string, scale: number, angle: number, color: string,
  shapeMaxDim?: number, spacing?: number, defLines?: number,
): React.ReactElement | null {
  const dim = shapeMaxDim ?? 400
  // 셀 크기: DXF 패턴 정의선 간격(sp)이 있으면 그걸 쓴다. 없으면 shape 크기로 추정.
  // 다만 실제 간격이 도면 전체 축척에서 1px 수준으로 깔리면 패턴이 통짜 회색으로
  // 뭉개지므로, 해치 크기 기준으로 반복 횟수를 [4, 60] 회로 제한한다.
  const estimated = Math.max(10, dim / 40) * Math.max(0.5, scale)
  const sz = spacing && spacing > 0
    ? Math.min(Math.max(spacing, dim / 60), dim / 4)
    : estimated
  const sw = Math.max(0.8, sz * 0.10) // 선 두께 비례 (더 굵게)
  const upper = patternName.toUpperCase()

  // SOLID: 패턴 없이 단색 fill
  if (upper === 'SOLID') return null

  // DXF 각도는 CCW, shape 좌표는 Y-flip 되어 있으므로 부호를 뒤집는다.
  const rotate = angle !== 0 ? `rotate(${-angle})` : undefined
  // 정의선이 2개 이상이면 교차 해치 — 한 방향만 그리면 원본과 다르게 보인다.
  const isCross = (defLines ?? 0) >= 2

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

  // --- _USER / 사용자 정의 패턴 ---
  // 간격·각도·격자 여부가 모두 DXF 정의선에서 오므로 그대로 따른다.
  if (upper.startsWith('_USER') || upper.startsWith('*')) {
    const g = spacing && spacing > 0 ? sz : sz * 0.8
    return (
      <pattern id={id} width={g} height={g} patternUnits="userSpaceOnUse"
        patternTransform={rotate ?? (spacing ? undefined : 'rotate(45)')}>
        <line x1={0} y1={0} x2={g} y2={0} stroke={color} strokeWidth={sw} opacity={0.75} />
        {isCross && (
          <line x1={0} y1={0} x2={0} y2={g} stroke={color} strokeWidth={sw} opacity={0.75} />
        )}
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

// ── DOM 기반 텍스트 컬링 (React 재렌더 없이 SVG visibility 직접 조작) ──
// 줌/팬 중 React 재렌더 = 0. 텍스트 표시/숨김만 DOM API로 처리.

/** 화면상 이 높이(CSS px) 미만의 텍스트를 숨긴다.
 *
 *  1px 미만은 서브픽셀이라 어차피 글자로 안 보이므로 걷어내도 잃는 게 없다.
 *  예전엔 3px 이었는데, 그건 "읽을 수 없다" 기준이지 "안 보인다" 기준이 아니다.
 *  CAD 뷰어에서 축소했을 때 주석이 흐릿한 얼룩으로라도 보이는 건 정상이고
 *  (AutoCAD 도 그렇게 보여준다), 거기까지 지워버리면 글자가 있다는 사실
 *  자체를 알 수 없다. 이 도면들은 autoScale 때문에 텍스트가 대부분 4px 라서
 *  3px 기준이면 z<0.75 구간 전체에서 글자가 하나도 안 보였다. */
/** DXF 텍스트 전용 색.
 *
 *  원래는 엔티티 색을 그대로 썼다 (밝은 배경이면 어둡게 보정해서). 그런데
 *  도면 선들도 똑같은 보정을 거쳐 전부 비슷한 어두운 색이 되는 바람에, 글씨가
 *  선 뭉치에 묻혀 안 읽혔다. 오토캐드가 검은 배경에서 글씨만 시안으로 또렷한
 *  것과 같은 이유로, 여기서도 텍스트는 선과 겹치지 않는 한 가지 색으로 통일한다.
 *
 *  앰버를 고른 건 도면에 흔한 빨강/파랑/초록/시안/보라 어디와도 안 겹치면서
 *  흰 배경과 검은 배경 양쪽에서 대비가 충분해서다. */
const DXF_TEXT_COLOR_LIGHT = '#b45309'
const DXF_TEXT_COLOR_DARK = '#fbbf24'

/** 글자 뒤에 깔아 선을 가리는 마스크 색 — AutoCAD 의 DIMTFILL "배경" 과 같은 역할.
 *  치수선은 글자 한가운데를 지나가게 그려져 있어서, 마스크 없이는 획 사이로
 *  선이 비쳐 숫자가 뭉개진다. 라이트는 흰색(캔버스 #f9fafc 와 사실상 동색이고
 *  흑백 모드의 #ffffff 와도 맞는다), 다크는 캔버스색 그대로. */
const DXF_TEXT_HALO_LIGHT = '#ffffff'
const DXF_TEXT_HALO_DARK = '#1e1e22'
/** 글자 높이 대비 마스크 두께. 획 사이 틈은 메우면서 글자가 뚱뚱해 보이진 않는 선. */
const DXF_TEXT_HALO_RATIO = 0.22

const MIN_TEXT_SCREEN_PX = 1

/** `[data-dxf-h]` 텍스트들의 visibility 를 현재 줌에 맞춰 갱신. 숨긴/보인 개수 반환. */
export function cullTextElements(root: ParentNode, zoom: number): { hidden: number; shown: number } {
  const minH = MIN_TEXT_SCREEN_PX / Math.max(zoom, 1e-6)
  let hidden = 0, shown = 0
  root.querySelectorAll<SVGTextElement>('[data-dxf-h]').forEach(el => {
    if (+(el.getAttribute('data-dxf-h') || '0') < minH) {
      el.setAttribute('visibility', 'hidden'); hidden++
    } else {
      el.removeAttribute('visibility'); shown++
    }
  })
  return { hidden, shown }
}

let _cullEditor: ReturnType<typeof useEditor> | null = null
let _cullUnsub: (() => void) | null = null
let _cullRaf = 0

function _ensureTextCulling(editor: ReturnType<typeof useEditor>) {
  if (_cullEditor === editor) return
  _cullUnsub?.()   // 에디터가 바뀌면 죽은 store 의 리스너를 떼어낸다
  _cullEditor = editor
  let culledAtZ = editor.getZoomLevel()

  // scope: 'all' — 카메라 레코드는 session scope 다. 예전처럼 'document' 로
  // 받으면 줌 변화가 아예 들어오지 않아서, 축소한 상태에서 도형을 하나
  // 건드린 순간 그 줌 기준으로 전 텍스트가 hidden 으로 박히고 다시 확대해도
  // 풀리지 않았다 (래치). 컬링은 줌에 따라가야 의미가 있다.
  _cullUnsub = editor.store.listen(() => {
    if (_cullRaf) return
    _cullRaf = requestAnimationFrame(() => {
      _cullRaf = 0
      const z = editor.getZoomLevel()
      // 20% 이상 줌 변화 시에만 텍스트 컬링 업데이트
      if (Math.abs(culledAtZ - z) / Math.max(culledAtZ, 0.001) < 0.2) return
      culledAtZ = z
      cullTextElements(document, z)
    })
  }, { source: 'user', scope: 'all' })
}

/** DXF 그룹 렌더링 컴포넌트 — 줌/팬 시 React 재렌더 0회 */
const DxfGroupComponent = memo(function DxfGroupComponent({ shape }: { shape: DxfGroupShape }) {
  const editor = useEditor()
  const [grayscale, setGrayscale] = useState(getGrayscaleMode)
  const [darkMode, setDarkModeState] = useState(getDarkMode)
  const meta = shape.meta as Record<string, unknown>

  // 텍스트 컬링 셋업: editor당 1회 (store.listen 1개)
  useEffect(() => { _ensureTextCulling(editor) }, [editor])

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

  // 배경 대비 색상 보정
  const rawColor = matStroke || (meta.dxfColor as string) || (darkMode ? '#ccc' : '#333')
  const stroke = grayscale
    ? (darkMode ? '#ccc' : '#333')
    : darkMode
      ? (isNearBlack(rawColor) ? '#ccc' : rawColor)
      : darkenForLightBg(rawColor)
  const dxfLw = (meta.dxfLineweight as number) ?? 0
  // non-scaling-stroke: 화면 px 단위. dxfLw는 0.01mm 단위.
  // ×0.04 스케일: 0.25mm→1px, 0.50mm→2px, 1.00mm→4px (두께 차이가 시각적으로 구분됨)
  const strokeW = dxfLw > 0 ? Math.max(0.5, Math.min(dxfLw * 0.04, 6)) : 1.0
  // Transparency: 0-100 (percent transparent) → CSS opacity 0-1
  const dxfTr = (meta.dxfTransparency as number) ?? 0
  const opacity = dxfTr > 0 ? Math.max(0.05, 1 - dxfTr / 100) : 1
  // Linetype dash pattern (from DXF LTYPE table)
  const dxfDash = (meta.dxfDashArray as string) || ''

  // 텍스트/HATCH 데이터: useMemo로 캐싱 (리렌더 시 JSON.parse 재실행 방지)
  const texts: DxfTextEntry[] = useMemo(() => {
    return unpackTextsJson(shape.props.textsJson)
  }, [shape.props.textsJson])

  const hatches: DxfHatchEntry[] = useMemo(() => {
    try { return shape.props.hatchesJson ? JSON.parse(shape.props.hatchesJson) : [] }
    catch { return [] }
  }, [shape.props.hatchesJson])

  // HATCH SVG 패턴 defs + fill 준비 (캐싱)
  const hatchDefs = useMemo(() => hatches.map((h, i) => {
    const hColor = grayscale
      ? (darkMode ? '#aaa' : '#666')
      : h.c
        ? (darkMode ? (isNearBlack(h.c) ? '#aaa' : h.c) : darkenForLightBg(h.c))
        : (darkMode ? '#aaa' : '#666')
    return buildHatchFill(h, `hatch-${shape.id}-${i}`, hColor, Math.max(shape.props.w, shape.props.h))
  }), [hatches, grayscale, darkMode, shape.id, shape.props.w, shape.props.h])

  return (
    <SVGContainer style={{ overflow: 'visible' }}>
      {hatchDefs.some(d => d.defs.length > 0) && (
        <defs>
          {hatchDefs.flatMap(d => d.defs)}
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
        // 패턴 해치: 패턴만 (단색 배경을 깔면 큰 해치가 회색 덩어리로 보인다).
        // 정의선이 여러 개면 패턴마다 path 를 하나씩 겹쳐서 교차 해치를 만든다.
        return hd.ids.map(pid => (
          <path key={pid} d={h.d} fill={`url(#${pid})`} stroke="none"
            opacity={0.85} pointerEvents="none" />
        ))
      })}
      {shape.props.pathData && (
        <path
          d={shape.props.pathData}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeW}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          {...(opacity < 1 ? { opacity } : {})}
          {...(dxfDash ? { strokeDasharray: dxfDash } : {})}
        />
      )}
      {texts.map((t, i) => {
        // 흑백 모드에서는 색을 쓰지 않기로 한 약속을 지킨다.
        const textColor = grayscale
          ? (darkMode ? '#bbb' : '#555')
          : (darkMode ? DXF_TEXT_COLOR_DARK : DXF_TEXT_COLOR_LIGHT)
        const haloColor = darkMode ? DXF_TEXT_HALO_DARK : DXF_TEXT_HALO_LIGHT
        // MTEXT attachment point → SVG textAnchor + dominantBaseline
        // 1=TL 2=TC 3=TR 4=ML 5=MC 6=MR 7=BL 8=BC 9=BR
        const ap = t.ap || 1
        const textAnchor = (ap % 3 === 0) ? 'end' : (ap % 3 === 2) ? 'middle' : 'start'
        const baseline = ap <= 3 ? 'hanging' : ap <= 6 ? 'central' : 'alphabetic'
        const fontFamily = dxfFontFamily(t.f)
        const lines = t.t.split('\n')
        return (
          <text
            key={i}
            x={t.x}
            y={t.y}
            fontSize={t.h}
            data-dxf-h={t.h}
            fill={textColor}
            stroke={haloColor}
            strokeWidth={t.h * DXF_TEXT_HALO_RATIO}
            strokeLinejoin="round"
            style={{ paintOrder: 'stroke' }}
            fontFamily={fontFamily}
            textAnchor={textAnchor}
            dominantBaseline={baseline}
            transform={t.r ? `rotate(${-t.r},${t.x},${t.y})` : undefined}
          >
            {lines.length <= 1
              ? t.t
              : lines.map((line, li) => (
                  <tspan key={li} x={t.x} dy={li === 0 ? 0 : t.h * 1.2}>
                    {line}
                  </tspan>
                ))}
          </text>
        )
      })}
    </SVGContainer>
  )
})

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

/** pathData 를 세그먼트 배열로 되돌린다.
 *
 * 생성 쪽(dxf.ts)이 `M x,y L x,y` 를 세그먼트마다 하나씩 이어 붙인 형태로만
 * 쓰기 때문에 정규식 한 줄로 충분하다. 곡선·상대좌표는 나오지 않는다. */
function parseSegPath(d: string): [number, number, number, number][] {
  if (!d) return []
  const out: [number, number, number, number][] = []
  const re = /M(-?[\d.]+),(-?[\d.]+)L(-?[\d.]+),(-?[\d.]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(d)) !== null) {
    out.push([+m[1], +m[2], +m[3], +m[4]])
  }
  return out
}

/** hatchesJson 을 안전하게 푼다 (깨진 JSON 은 조용히 버린다 — 렌더 쪽과 같은 취급). */
function parseHatchesJson(json: string): DxfHatchEntry[] {
  if (!json) return []
  try {
    const v: unknown = JSON.parse(json)
    return Array.isArray(v) ? (v as DxfHatchEntry[]) : []
  } catch { return [] }
}

/** 해치 경계 path 를 닫힌 링(점 배열)들로 쪼갠다.
 *
 * 생성 쪽이 `M`/`L`/`Z` 만 쓴다. `Z` 또는 다음 `M` 에서 링이 끊긴다. */
function parseHatchRings(d: string): Vec[][] {
  if (!d) return []
  const rings: Vec[][] = []
  let cur: Vec[] = []
  const re = /([MLZ])(-?[\d.]+)?,?(-?[\d.]+)?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(d)) !== null) {
    const cmd = m[1]
    if (cmd === 'Z') {
      if (cur.length) { rings.push(cur); cur = [] }
      continue
    }
    if (m[2] === undefined || m[3] === undefined) continue
    if (cmd === 'M' && cur.length) { rings.push(cur); cur = [] }
    cur.push(new Vec(+m[2], +m[3]))
  }
  if (cur.length) rings.push(cur)
  return rings
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

  /** 클릭 판정은 **실제 선** 으로 한다.
   *
   * 예전엔 바운딩박스를 채운 Polygon2d 였다. 그러면 (1) 도형이 없는 빈 속을
   * 눌러도 잡히고 (2) 큰 그룹의 박스가 그 안에 있는 작은 가구를 덮어서 위에
   * 있는 걸 못 고른다. 쪼개기를 고쳐도 "엉뚱한 게 잡힌다" 는 체감이 남는
   * 이유가 이쪽이었다.
   *
   * 해치(채움)는 속까지 눌러야 하므로 채워진 폴리곤으로 넣는다.
   * 세그먼트도 해치도 없는 그룹(텍스트만 있는 라벨)은 박스를 그대로 쓴다 —
   * 글자를 누를 면적이 그것밖에 없다. */
  getGeometry(shape: DxfGroupShape) {
    const parts: (Edge2d | Polygon2d)[] = []

    for (const [x1, y1, x2, y2] of parseSegPath(shape.props.pathData)) {
      parts.push(new Edge2d({ start: new Vec(x1, y1), end: new Vec(x2, y2) }))
    }

    for (const h of parseHatchesJson(shape.props.hatchesJson)) {
      for (const ring of parseHatchRings(h.d)) {
        if (ring.length >= 3) parts.push(new Polygon2d({ points: ring, isFilled: true }))
      }
    }

    if (parts.length === 0) {
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
    return new Group2d({ children: parts })
  }

  component(shape: DxfGroupShape) {
    return <DxfGroupComponent shape={shape} />
  }

  /** 선택 표시도 실제 선 위에 올린다.
   *
   * 박스를 그리면 선 하나를 골랐을 때도 "도면 한 덩어리가 잡혔다" 로 보인다.
   * 실제로 잡힌 게 무엇인지 보여주는 게 맞다. 텍스트만 있는 라벨은 그릴 선이
   * 없으니 박스를 쓴다. */
  indicator(shape: DxfGroupShape) {
    if (!shape.props.pathData) {
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
    return (
      <path
        d={shape.props.pathData}
        fill="none"
        stroke="var(--color-selected)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    )
  }

  override toSvg(shape: DxfGroupShape) {
    const rawColor = (shape.meta?.dxfColor as string) || '#333'
    const stroke = darkenForLightBg(rawColor)
    const dxfLw = (shape.meta?.dxfLineweight as number) ?? 0
    const strokeW = dxfLw > 0 ? Math.max(0.4, Math.min(dxfLw * 0.03, 4)) : 0.6
    const dxfTr = (shape.meta?.dxfTransparency as number) ?? 0
    const opacity = dxfTr > 0 ? Math.max(0.05, 1 - dxfTr / 100) : 1

    const texts: DxfTextEntry[] = unpackTextsJson(shape.props.textsJson)

    let hatches: DxfHatchEntry[] = []
    try {
      if (shape.props.hatchesJson) hatches = JSON.parse(shape.props.hatchesJson)
    } catch { /* ignore */ }

    const svgHatchDefs = hatches.map((h, i) => buildHatchFill(
      h, `hatch-svg-${shape.id}-${i}`,
      h.c ? darkenForLightBg(h.c) : '#666',
      Math.max(shape.props.w, shape.props.h),
    ))

    return (
      <g>
        {svgHatchDefs.some(d => d.defs.length > 0) && (
          <defs>
            {svgHatchDefs.flatMap(d => d.defs)}
          </defs>
        )}
        {hatches.map((h, i) => {
          const hd = svgHatchDefs[i]
          if (hd.isSolid) {
            return <path key={`h${i}`} d={h.d} fill={hd.color} stroke="none" opacity={0.85} />
          }
          return hd.ids.map(pid => (
            <path key={pid} d={h.d} fill={`url(#${pid})`} stroke="none" opacity={0.85} />
          ))
        })}
        {shape.props.pathData && (
          <path
            d={shape.props.pathData}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeW}
            strokeLinecap="round"
            {...(opacity < 1 ? { opacity } : {})}
          />
        )}
        {texts.map((t, i) => {
          const ap = t.ap || 1
          const textAnchor = (ap % 3 === 0) ? 'end' : (ap % 3 === 2) ? 'middle' : 'start'
          const baseline = ap <= 3 ? 'hanging' : ap <= 6 ? 'central' : 'alphabetic'
          const fontFamily = dxfFontFamily(t.f)
          const lines = t.t.split('\n')
          return (
            <text
              key={i}
              x={t.x}
              y={t.y}
              fontSize={t.h}
              fill={DXF_TEXT_COLOR_LIGHT}
              stroke={DXF_TEXT_HALO_LIGHT}
              strokeWidth={t.h * DXF_TEXT_HALO_RATIO}
              strokeLinejoin="round"
              style={{ paintOrder: 'stroke' }}
              fontFamily={fontFamily}
              textAnchor={textAnchor}
              dominantBaseline={baseline}
              transform={t.r ? `rotate(${-t.r},${t.x},${t.y})` : undefined}
            >
              {lines.length <= 1
                ? t.t
                : lines.map((line, li) => (
                    <tspan key={li} x={t.x} dy={li === 0 ? 0 : t.h * 1.2}>
                      {line}
                    </tspan>
                  ))}
            </text>
          )
        })}
      </g>
    )
  }
}
