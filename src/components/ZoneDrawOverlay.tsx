// 공간지정(Zone) 폴리곤 드로잉 오버레이
// AreaMeasureOverlay 기반 — 동일한 폴리곤 드로잉 UX
import { useState, useEffect, useCallback } from 'react'
import { Vec, type Editor } from 'tldraw'
import { useEditor } from '../context/EditorContext'
import { cancelZoneDraw, completeZoneDraw } from '../lib/drawingState'
import { getScaleConfig } from '../lib/scaleConfig'
import { shoelaceArea, pxAreaToM2, measurePolygon, type Pt } from '../lib/areaMeasure'
import { resolveDrawPointAt, type SnapPoint } from '../lib/snap'
import { normalizeWheelDelta } from '../lib/wheelBehavior'
import { nextZoneName } from '../lib/zoneName'

const SNAP_DIST = 12

/**
 * 지정 중인 공간을 칠하는 색.
 *
 * 한이 Rayon 화면을 보내며 "회색 느낌으로 공간 칠해지면서 여기가 zoning 된다는
 * 게 보여야 한다" 고 했다. 녹색 10% 였는데, 색이 있는 면은 **도면 위에 올린
 * 또 하나의 도형**처럼 보인다. 중성 회색이라야 "이 범위" 라는 표시로 읽힌다.
 *
 * 알파가 낮아야 밑의 벽·가구가 비친다 — 가려 버리면 어디를 집고 있는지 못 본다.
 */
const ZONE_FILL = 'rgba(100,108,120,0.16)'

/**
 * 커서가 가 있을 점. 벽체·치수 도구와 **같은 스냅 체인**을 쓴다.
 *
 * 예전엔 끝점 스냅만 불러서 직교·교차점·수직·연장이 전부 안 먹었고, 스냅
 * 모드 토글(끝점/중간점 끄기)도 무시했다.
 */
function resolvePoint(editor: Editor, e: React.MouseEvent, prev: Pt[]): SnapPoint {
  const rawPt = editor.screenToPage({ x: e.clientX, y: e.clientY })
  const start = prev.length > 0 ? prev[prev.length - 1] : null
  return resolveDrawPointAt(editor, rawPt, start, e.shiftKey)
}

/** 주황 마커를 찍을 스냅인지 — 직교는 '점'이 아니라 각도라 찍지 않는다. */
function isPointSnap(snapType: SnapPoint['snapType']): boolean {
  return !!snapType && snapType !== 'angle'
}

export function ZoneDrawOverlay() {
  const editor = useEditor()
  const [active, setActive] = useState(false)
  const [pagePoints, setPagePoints] = useState<Pt[]>([])
  const [vpPoints, setVpPoints] = useState<Pt[]>([])
  const [cursorVp, setCursorVp] = useState<Pt | null>(null)
  /** 커서의 page 좌표. **면적을 커서까지 포함해 재려면** 필요하다. */
  const [cursorPage, setCursorPage] = useState<Pt | null>(null)
  const [snapVp, setSnapVp] = useState<Pt | null>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      setActive(detail.active)
      if (detail.active) {
        setPagePoints([])
        setVpPoints([])
        setCursorVp(null)
        setCursorPage(null)
      }
    }
    window.addEventListener('bimova:zone-draw', handler)
    return () => window.removeEventListener('bimova:zone-draw', handler)
  }, [])

  const updateViewport = useCallback(() => {
    if (!editor || pagePoints.length === 0) return
    setVpPoints(pagePoints.map(p => editor.pageToViewport(p)))
  }, [editor, pagePoints])

  useEffect(() => {
    if (!editor || !active) return
    // 카메라가 움직여도 리렌더는 안 나니까 스토어를 구독해서 좌표를 다시 계산한다.
    // 이 첫 호출은 그 구독의 초기값 씨딩이다 — 룰이 말하는 "외부 시스템 구독" 쪽이고,
    // 빼면 구독 후 첫 카메라 이동까지 오버레이 좌표가 비어 있다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    updateViewport()
    let raf = 0
    const unsub = editor.store.listen(() => {
      if (raf) return
      raf = requestAnimationFrame(() => { raf = 0; updateViewport() })
    })
    return () => { unsub(); if (raf) cancelAnimationFrame(raf) }
  }, [editor, active, updateViewport])

  useEffect(() => {
    if (!active) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        cancelZoneDraw()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && pagePoints.length > 0) {
        e.stopPropagation()
        e.preventDefault()
        setPagePoints(prev => prev.slice(0, -1))
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [active, pagePoints.length])

  // handleClick/handleDoubleClick 보다 **위에** 있어야 한다 (AreaMeasureOverlay 와 동일)
  const finishDraw = useCallback((pts: Pt[]) => {
    if (!editor || pts.length < 3) return
    const scale = getScaleConfig(editor)
    const measured = measurePolygon(pts, scale.pxPerMm)
    completeZoneDraw({ points: pts, ...measured })
  }, [editor])

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!editor || !active) return
    e.stopPropagation()
    e.preventDefault()

    const resolved = resolvePoint(editor, e, pagePoints)
    const pagePt: Pt = { x: resolved.x, y: resolved.y }

    if (pagePoints.length >= 3) {
      const first = pagePoints[0]
      const firstVp = editor.pageToViewport(first)
      const clickVp = editor.pageToViewport(pagePt)
      if (Math.hypot(clickVp.x - firstVp.x, clickVp.y - firstVp.y) < SNAP_DIST) {
        finishDraw(pagePoints)
        return
      }
    }

    setPagePoints(prev => [...prev, pagePt])
  }, [editor, active, pagePoints, finishDraw])

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (pagePoints.length >= 3) finishDraw(pagePoints)
  }, [pagePoints, finishDraw])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!editor || !active) return
    const resolved = resolvePoint(editor, e, pagePoints)
    const vp = editor.pageToViewport({ x: resolved.x, y: resolved.y })
    setCursorVp(vp)
    setCursorPage({ x: resolved.x, y: resolved.y })
    setSnapVp(isPointSnap(resolved.snapType) ? vp : null)
  }, [editor, active, pagePoints])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!editor) return
    e.preventDefault()
    e.stopPropagation()
    // 부호를 뒤집어 넘긴다 — tldraw 가 자기 리스너에서 그렇게 하기 때문이다.
    // 날것을 넘기면 확대·축소가 통째로 반대로 돈다 (normalizeWheelDelta 주석).
    const d = normalizeWheelDelta(e)
    if (d.x === 0 && d.y === 0) return
    editor.dispatch({
      type: 'wheel', name: 'wheel', delta: new Vec(d.x, d.y, d.z),
      point: new Vec(e.clientX, e.clientY),
      shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.metaKey || e.ctrlKey,
    })
  }, [editor])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (pagePoints.length > 0) setPagePoints(prev => prev.slice(0, -1))
  }, [pagePoints.length])

  if (!active) return null

  // ── 미리보기는 **커서까지 포함한다** ──
  //
  // 전엔 찍은 점으로만 면을 만들어서, 마우스를 움직이는 동안 커서 쪽 모서리가
  // 비어 있었다. 지금 어디를 집고 있는지가 안 보이면 "칠해진다" 는 느낌이
  // 안 난다 — Rayon 은 끄는 내내 통째로 칠해져 있다.
  const previewVp = cursorVp ? [...vpPoints, cursorVp] : vpPoints
  const previewPage = cursorPage ? [...pagePoints, cursorPage] : pagePoints

  let previewArea = ''
  if (editor && previewPage.length >= 3) {
    const scale = getScaleConfig(editor)
    previewArea = `${pxAreaToM2(shoelaceArea(previewPage), scale.pxPerMm).toFixed(2)} m²`
  }

  // 라벨은 면 한가운데. 어느 면이 지정되는지와 그 넓이를 **거기서** 읽는다 —
  // 아래 배너까지 눈을 내렸다 올리면 어디를 보고 있었는지 놓친다.
  const centroid = previewVp.length >= 3
    ? {
        x: previewVp.reduce((a, p) => a + p.x, 0) / previewVp.length,
        y: previewVp.reduce((a, p) => a + p.y, 0) / previewVp.length,
      }
    : null

  // 그리는 동안 보여주는 이름 = 팝업에 채워질 이름 (lib/zoneName 주석 참고).
  const zoneName = editor
    ? nextZoneName(
        editor.getCurrentPageShapes()
          .filter(sh => sh.type === 'zone')
          .map(sh => String((sh.props as { label?: string }).label ?? '')),
      )
    : '공간 1'

  const lastVp = vpPoints.length > 0 ? vpPoints[vpPoints.length - 1] : null
  const zoneColor = '#34a853'

  return (
    <>
      <div
        className="area-measure-capture"
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseMove={handleMouseMove}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
      />

      <svg className="area-measure-svg">
        {vpPoints.map((p, i) => {
          if (i === 0) return null
          const prev = vpPoints[i - 1]
          return (
            <line key={`zl-${i}`} x1={prev.x} y1={prev.y} x2={p.x} y2={p.y}
              stroke={zoneColor} strokeWidth={2} />
          )
        })}

        {lastVp && cursorVp && (
          <line x1={lastVp.x} y1={lastVp.y} x2={cursorVp.x} y2={cursorVp.y}
            stroke={zoneColor} strokeWidth={1.5} strokeDasharray="6,4" opacity={0.6} />
        )}

        {vpPoints.length >= 3 && cursorVp && (
          <line x1={vpPoints[0].x} y1={vpPoints[0].y} x2={cursorVp.x} y2={cursorVp.y}
            stroke={zoneColor} strokeWidth={1} strokeDasharray="4,4" opacity={0.3} />
        )}

        {previewVp.length >= 3 && (
          <polygon points={previewVp.map(p => `${p.x},${p.y}`).join(' ')}
            fill={ZONE_FILL} stroke="none" />
        )}

        {centroid && previewArea && (
          <g pointerEvents="none">
            <text x={centroid.x} y={centroid.y - 7} textAnchor="middle"
              fontSize={13} fontWeight={600} fill="#3c4250"
              style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 }}>
              {zoneName}
            </text>
            <text x={centroid.x} y={centroid.y + 11} textAnchor="middle"
              fontSize={12} fill="#5a6270"
              style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3, fontFamily: 'ui-monospace, Consolas, monospace' }}>
              {previewArea}
            </text>
          </g>
        )}

        {vpPoints.map((p, i) => (
          <circle key={`zp-${i}`} cx={p.x} cy={p.y} r={5}
            fill={i === 0 ? zoneColor : '#fff'} stroke={zoneColor} strokeWidth={2} />
        ))}

        {snapVp && (
          <g>
            <circle cx={snapVp.x} cy={snapVp.y} r={10} fill="none"
              stroke="#f59e0b" strokeWidth={2} opacity={0.8} />
            <circle cx={snapVp.x} cy={snapVp.y} r={4} fill="#f59e0b" opacity={0.9} />
          </g>
        )}
      </svg>

      <div className="area-measure-banner" style={{ borderColor: zoneColor }}>
        <span className="area-measure-message">
          📍 공간 영역을 지정하세요
          {previewArea && ` · ${previewArea}`}
        </span>
        <span className="area-measure-hint">
          {pagePoints.length >= 3
            ? '첫 점 클릭 또는 더블클릭으로 완료 · 우클릭 되돌리기'
            : 'ESC 취소 · 우클릭 되돌리기'}
        </span>
        <button className="area-measure-cancel" onClick={cancelZoneDraw}>취소</button>
      </div>
    </>
  )
}
