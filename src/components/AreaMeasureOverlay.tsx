// 바닥 면적 폴리곤 측정 오버레이
// 1. 펜 클릭으로 활성화 → 2. 도면 위에서 꼭짓점 클릭 → 3. 폴리곤 닫기 → 면적 자동 계산
import { useState, useEffect, useRef, useCallback } from 'react'
import { useEditor } from '../context/EditorContext'
import { cancelAreaMeasure, completeAreaMeasure } from '../lib/drawingState'
import { getScaleConfig } from '../lib/scaleConfig'
import { shoelaceArea, pxAreaToM2, measurePolygon, type Pt } from '../lib/areaMeasure'
import { snapToWallEndpoint } from '../lib/snap'

const SNAP_DIST = 12 // px — 첫 점 근처에서 클릭하면 폴리곤 닫기

export function AreaMeasureOverlay() {
  const editor = useEditor()
  const [active, setActive] = useState(false)
  const [pagePoints, setPagePoints] = useState<Pt[]>([]) // page 좌표 (px)
  const [vpPoints, setVpPoints] = useState<Pt[]>([])      // viewport 좌표 (렌더링용)
  const [cursorVp, setCursorVp] = useState<Pt | null>(null)
  const [snapVp, setSnapVp] = useState<Pt | null>(null) // 스냅 포인트 (viewport 좌표)
  const overlayRef = useRef<HTMLDivElement>(null)

  // 이벤트 수신
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      setActive(detail.active)
      if (detail.active) {
        setPagePoints([])
        setVpPoints([])
        setCursorVp(null)
      }
    }
    window.addEventListener('bimova:area-measure', handler)
    return () => window.removeEventListener('bimova:area-measure', handler)
  }, [])

  // viewport 좌표 갱신 (카메라 이동 시)
  const updateViewport = useCallback(() => {
    if (!editor || pagePoints.length === 0) return
    setVpPoints(pagePoints.map(p => editor.pageToViewport(p)))
  }, [editor, pagePoints])

  useEffect(() => {
    if (!editor || !active) return
    updateViewport()
    let raf = 0
    const unsub = editor.store.listen(() => {
      if (raf) return
      raf = requestAnimationFrame(() => { raf = 0; updateViewport() })
    })
    return () => { unsub(); if (raf) cancelAnimationFrame(raf) }
  }, [editor, active, updateViewport])

  // ESC 키로 취소
  useEffect(() => {
    if (!active) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        cancelAreaMeasure()
      }
      // Ctrl+Z: undo last point
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && pagePoints.length > 0) {
        e.stopPropagation()
        e.preventDefault()
        setPagePoints(prev => prev.slice(0, -1))
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [active, pagePoints.length])

  // 클릭: 꼭짓점 추가
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!editor || !active) return
    e.stopPropagation()
    e.preventDefault()

    const rawPt = editor.screenToPage({ x: e.clientX, y: e.clientY })

    // 객체 스냅: 벽 끝점에 자동 흡착
    const snapped = snapToWallEndpoint(editor, rawPt)
    const pagePt: Pt = snapped ? { x: snapped.x, y: snapped.y } : { x: rawPt.x, y: rawPt.y }

    // 첫 점 근처 클릭 → 폴리곤 닫기
    if (pagePoints.length >= 3) {
      const first = pagePoints[0]
      const firstVp = editor.pageToViewport(first)
      const clickVp = editor.pageToViewport(pagePt)
      const dist = Math.hypot(clickVp.x - firstVp.x, clickVp.y - firstVp.y)
      if (dist < SNAP_DIST) {
        finishMeasure(pagePoints)
        return
      }
    }

    setPagePoints(prev => [...prev, pagePt])
  }, [editor, active, pagePoints])

  // 더블클릭: 폴리곤 닫기
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (pagePoints.length >= 3) {
      finishMeasure(pagePoints)
    }
  }, [pagePoints])

  // 마우스 이동: 커서 위치 표시 + 스냅 감지
  const snapLoggedRef = useRef(false)
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!editor || !active) return
    const rawPt = editor.screenToPage({ x: e.clientX, y: e.clientY })

    // 객체 스냅 감지
    const snapped = snapToWallEndpoint(editor, rawPt)
    if (snapped) {
      if (!snapLoggedRef.current) {
        snapLoggedRef.current = true
        console.debug('[area-snap] hit:', snapped.snapType, 'at', snapped.x.toFixed(1), snapped.y.toFixed(1))
      }
      const snapPage: Pt = { x: snapped.x, y: snapped.y }
      setSnapVp(editor.pageToViewport(snapPage))
      setCursorVp(editor.pageToViewport(snapPage))
    } else {
      setSnapVp(null)
      setCursorVp(editor.pageToViewport(rawPt))
    }
  }, [editor, active])

  // 휠: tldraw 캔버스로 전달 (확대/축소 허용)
  const handleWheel = useCallback((e: React.WheelEvent) => {
    const container = document.querySelector('.tl-container')
    if (container) {
      container.dispatchEvent(new WheelEvent('wheel', {
        deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ,
        deltaMode: e.deltaMode,
        clientX: e.clientX, clientY: e.clientY,
        screenX: e.screenX, screenY: e.screenY,
        ctrlKey: e.ctrlKey, altKey: e.altKey,
        shiftKey: e.shiftKey, metaKey: e.metaKey,
        bubbles: true,
      }))
    }
  }, [])

  // 우클릭: 마지막 점 삭제
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (pagePoints.length > 0) {
      setPagePoints(prev => prev.slice(0, -1))
    }
  }, [pagePoints.length])

  // 측정 완료
  const finishMeasure = (pts: Pt[]) => {
    if (!editor || pts.length < 3) return
    const scale = getScaleConfig(editor)
    completeAreaMeasure(measurePolygon(pts, scale.pxPerMm))
  }

  if (!active) return null

  // 현재 면적 미리보기
  let previewArea = ''
  if (editor && pagePoints.length >= 3) {
    const scale = getScaleConfig(editor)
    const areaM2 = pxAreaToM2(shoelaceArea(pagePoints), scale.pxPerMm)
    previewArea = `${areaM2.toFixed(2)} m²`
  }

  const lastVp = vpPoints.length > 0 ? vpPoints[vpPoints.length - 1] : null

  return (
    <>
      {/* 클릭 캡처 영역 */}
      <div
        ref={overlayRef}
        className="area-measure-capture"
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseMove={handleMouseMove}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
      />

      {/* 폴리곤 렌더링 (SVG) */}
      <svg className="area-measure-svg">
        {/* 완성된 선분들 */}
        {vpPoints.map((p, i) => {
          if (i === 0) return null
          const prev = vpPoints[i - 1]
          return (
            <line
              key={`line-${i}`}
              x1={prev.x} y1={prev.y}
              x2={p.x} y2={p.y}
              stroke="#1a73e8"
              strokeWidth={2}
            />
          )
        })}

        {/* 커서 따라가는 가이드 선 */}
        {lastVp && cursorVp && (
          <line
            x1={lastVp.x} y1={lastVp.y}
            x2={cursorVp.x} y2={cursorVp.y}
            stroke="#1a73e8"
            strokeWidth={1.5}
            strokeDasharray="6,4"
            opacity={0.6}
          />
        )}

        {/* 닫기 가이드 선 (3점 이상일 때) */}
        {vpPoints.length >= 3 && cursorVp && (
          <line
            x1={vpPoints[0].x} y1={vpPoints[0].y}
            x2={cursorVp.x} y2={cursorVp.y}
            stroke="#1a73e8"
            strokeWidth={1}
            strokeDasharray="4,4"
            opacity={0.3}
          />
        )}

        {/* 채우기 (3점 이상일 때) */}
        {vpPoints.length >= 3 && (
          <polygon
            points={vpPoints.map(p => `${p.x},${p.y}`).join(' ')}
            fill="rgba(26,115,232,0.1)"
            stroke="none"
          />
        )}

        {/* 꼭짓점 */}
        {vpPoints.map((p, i) => (
          <circle
            key={`pt-${i}`}
            cx={p.x} cy={p.y} r={5}
            fill={i === 0 ? '#1a73e8' : '#fff'}
            stroke="#1a73e8"
            strokeWidth={2}
          />
        ))}

        {/* 스냅 인디케이터 */}
        {snapVp && (
          <g>
            <circle
              cx={snapVp.x} cy={snapVp.y} r={10}
              fill="none"
              stroke="#f59e0b"
              strokeWidth={2}
              opacity={0.8}
            />
            <circle
              cx={snapVp.x} cy={snapVp.y} r={4}
              fill="#f59e0b"
              opacity={0.9}
            />
          </g>
        )}
      </svg>

      {/* 상단 배너 */}
      <div className="area-measure-banner">
        <span className="area-measure-message">
          📐 도면에서 꼭짓점을 클릭하세요
          {previewArea && ` · ${previewArea}`}
        </span>
        <span className="area-measure-hint">
          {pagePoints.length >= 3
            ? '첫 점 클릭 또는 더블클릭으로 완료 · 우클릭으로 되돌리기'
            : 'ESC로 취소 · 우클릭으로 되돌리기'}
        </span>
        <button className="area-measure-cancel" onClick={cancelAreaMeasure}>취소</button>
      </div>
    </>
  )
}
