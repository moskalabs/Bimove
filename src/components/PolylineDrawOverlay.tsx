// 폴리라인(연속선) 드로잉 오버레이
//
// 공간지정(ZoneDrawOverlay) 과 같은 방식인데 **닫지 않는다** — 둘러싸는 영역이
// 아니라 꺾이며 이어지는 한 줄이다. 곡선이 아니라 직선 구간의 연속이다.
//
// tldraw 의 line 도구를 그냥 쓰지 않는 이유는 그쪽이 드래그 한 번에 두 점이고,
// 점을 더 붙이려면 기존 선을 shift 로 집어야 하기 때문이다. CAD 에서 쓰는
// "클릭 클릭 클릭 → 더블클릭으로 끝" 이 안 된다.
import { useState, useEffect, useCallback } from 'react'
import { Vec, type Editor } from 'tldraw'
import { useEditor } from '../context/EditorContext'
import { cancelPolylineDraw, completePolylineDraw } from '../lib/drawingState'
import { getScaleConfig, formatLength } from '../lib/scaleConfig'
import type { Pt } from '../lib/areaMeasure'
import { resolveDrawPointAt, type SnapPoint } from '../lib/snap'
import { normalizeWheelDelta } from '../lib/wheelBehavior'

/** 커서가 가 있을 점. 벽체·치수 도구와 **같은 스냅 체인**을 쓴다. */
function resolvePoint(editor: Editor, e: React.MouseEvent, prev: Pt[]): SnapPoint {
  const rawPt = editor.screenToPage({ x: e.clientX, y: e.clientY })
  const start = prev.length > 0 ? prev[prev.length - 1] : null
  return resolveDrawPointAt(editor, rawPt, start, e.shiftKey)
}

/** 주황 마커를 찍을 스냅인지 — 직교는 '점'이 아니라 각도라 찍지 않는다. */
function isPointSnap(snapType: SnapPoint['snapType']): boolean {
  return !!snapType && snapType !== 'angle'
}

const LINE_COLOR = '#2f6fed'

export function PolylineDrawOverlay() {
  const editor = useEditor()
  const [active, setActive] = useState(false)
  const [pagePoints, setPagePoints] = useState<Pt[]>([])
  const [vpPoints, setVpPoints] = useState<Pt[]>([])
  const [cursorVp, setCursorVp] = useState<Pt | null>(null)
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
    window.addEventListener('bimova:polyline-draw', handler)
    return () => window.removeEventListener('bimova:polyline-draw', handler)
  }, [])

  const updateViewport = useCallback(() => {
    if (!editor || pagePoints.length === 0) return
    setVpPoints(pagePoints.map(p => editor.pageToViewport(p)))
  }, [editor, pagePoints])

  useEffect(() => {
    if (!editor || !active) return
    // 카메라가 움직여도 리렌더는 안 나니까 스토어를 구독해서 좌표를 다시 계산한다.
    // 이 첫 호출은 그 구독의 초기값 씨딩이다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    updateViewport()
    let raf = 0
    const unsub = editor.store.listen(() => {
      if (raf) return
      raf = requestAnimationFrame(() => { raf = 0; updateViewport() })
    })
    return () => { unsub(); if (raf) cancelAnimationFrame(raf) }
  }, [editor, active, updateViewport])

  const finishDraw = useCallback((pts: Pt[]) => {
    // 더블클릭은 onClick 을 **두 번** 흘린 뒤에 온다. 그래서 거의 같은 자리에
    // 점이 하나 더 붙은 채로 들어온다 — 길이 0 짜리 꼬리 구간이 생긴다.
    const cleaned = [...pts]
    while (cleaned.length >= 2) {
      const a = cleaned[cleaned.length - 1], b = cleaned[cleaned.length - 2]
      if (Math.hypot(a.x - b.x, a.y - b.y) > 1) break
      cleaned.pop()
    }
    // 점이 하나면 선이 아니다 — 그냥 버린다.
    if (cleaned.length < 2) { cancelPolylineDraw(); return }
    completePolylineDraw(cleaned)
  }, [])

  useEffect(() => {
    if (!active) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation(); e.preventDefault()
        cancelPolylineDraw()
      }
      if (e.key === 'Enter') {
        e.stopPropagation(); e.preventDefault()
        finishDraw(pagePoints)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && pagePoints.length > 0) {
        e.stopPropagation(); e.preventDefault()
        setPagePoints(prev => prev.slice(0, -1))
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [active, pagePoints, finishDraw])

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!editor || !active) return
    e.stopPropagation(); e.preventDefault()
    const resolved = resolvePoint(editor, e, pagePoints)
    setPagePoints(prev => [...prev, { x: resolved.x, y: resolved.y }])
  }, [editor, active, pagePoints])

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault()
    // 여기 오기 전에 onClick 이 두 번 돌아 점이 더 붙어 있다 — finishDraw 가
    // 겹친 꼬리를 걷어낸다.
    finishDraw(pagePoints)
  }, [pagePoints, finishDraw])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!editor || !active) return
    const resolved = resolvePoint(editor, e, pagePoints)
    const page = { x: resolved.x, y: resolved.y }
    const vp = editor.pageToViewport(page)
    setCursorPage(page)
    setCursorVp(vp)
    setSnapVp(isPointSnap(resolved.snapType) ? vp : null)
  }, [editor, active, pagePoints])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!editor) return
    e.preventDefault(); e.stopPropagation()
    // 부호를 뒤집어 넘긴다 — tldraw 가 자기 리스너에서 그렇게 하기 때문이다.
    const d = normalizeWheelDelta(e)
    if (d.x === 0 && d.y === 0) return
    editor.dispatch({
      type: 'wheel', name: 'wheel', delta: new Vec(d.x, d.y, d.z),
      point: new Vec(e.clientX, e.clientY),
      shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.metaKey || e.ctrlKey,
    })
  }, [editor])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    if (pagePoints.length > 0) setPagePoints(prev => prev.slice(0, -1))
  }, [pagePoints.length])

  if (!active) return null

  const lastVp = vpPoints.length > 0 ? vpPoints[vpPoints.length - 1] : null

  // 지금 그리고 있는 구간의 길이 — 벽체 도구와 같은 단위로 보여준다.
  let segLabel: string | null = null
  if (editor && cursorPage && pagePoints.length > 0) {
    const prev = pagePoints[pagePoints.length - 1]
    const lenPx = Math.hypot(cursorPage.x - prev.x, cursorPage.y - prev.y)
    if (lenPx > 1) segLabel = formatLength(lenPx, getScaleConfig(editor))
  }

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
            <line key={`pl-${i}`} x1={prev.x} y1={prev.y} x2={p.x} y2={p.y}
              stroke={LINE_COLOR} strokeWidth={2} />
          )
        })}

        {lastVp && cursorVp && (
          <line x1={lastVp.x} y1={lastVp.y} x2={cursorVp.x} y2={cursorVp.y}
            stroke={LINE_COLOR} strokeWidth={1.5} strokeDasharray="6,4" opacity={0.6} />
        )}

        {vpPoints.map((p, i) => (
          <circle key={`pp-${i}`} cx={p.x} cy={p.y} r={5}
            fill={i === 0 ? LINE_COLOR : '#fff'} stroke={LINE_COLOR} strokeWidth={2} />
        ))}

        {snapVp && (
          <g>
            <circle cx={snapVp.x} cy={snapVp.y} r={10} fill="none"
              stroke="#f59e0b" strokeWidth={2} opacity={0.8} />
            <circle cx={snapVp.x} cy={snapVp.y} r={4} fill="#f59e0b" opacity={0.9} />
          </g>
        )}
      </svg>

      <div className="area-measure-banner" style={{ borderColor: LINE_COLOR }}>
        <span className="area-measure-message">
          📐 이어서 클릭하세요
          {segLabel && ` · ${segLabel}`}
        </span>
        <span className="area-measure-hint">
          {pagePoints.length >= 2
            ? '더블클릭 또는 Enter 로 완료 · 우클릭 되돌리기'
            : 'ESC 취소 · 우클릭 되돌리기'}
        </span>
        <button className="area-measure-cancel" onClick={cancelPolylineDraw}>취소</button>
      </div>
    </>
  )
}
