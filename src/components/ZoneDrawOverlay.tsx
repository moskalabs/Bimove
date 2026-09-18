// 공간지정(Zone) 폴리곤 드로잉 오버레이
// AreaMeasureOverlay 기반 — 동일한 폴리곤 드로잉 UX
import { useState, useEffect, useCallback } from 'react'
import { Vec } from 'tldraw'
import { useEditor } from '../context/EditorContext'
import { cancelZoneDraw, completeZoneDraw } from '../lib/drawingState'
import { getScaleConfig } from '../lib/scaleConfig'
import { shoelaceArea, pxAreaToM2, measurePolygon, type Pt } from '../lib/areaMeasure'
import { snapToWallEndpoint } from '../lib/snap'

const SNAP_DIST = 12

export function ZoneDrawOverlay() {
  const editor = useEditor()
  const [active, setActive] = useState(false)
  const [pagePoints, setPagePoints] = useState<Pt[]>([])
  const [vpPoints, setVpPoints] = useState<Pt[]>([])
  const [cursorVp, setCursorVp] = useState<Pt | null>(null)
  const [snapVp, setSnapVp] = useState<Pt | null>(null)

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
    window.addEventListener('bimova:zone-draw', handler)
    return () => window.removeEventListener('bimova:zone-draw', handler)
  }, [])

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

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!editor || !active) return
    e.stopPropagation()
    e.preventDefault()

    const rawPt = editor.screenToPage({ x: e.clientX, y: e.clientY })
    const snapped = snapToWallEndpoint(editor, rawPt)
    const pagePt: Pt = snapped ? { x: snapped.x, y: snapped.y } : { x: rawPt.x, y: rawPt.y }

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
  }, [editor, active, pagePoints])

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (pagePoints.length >= 3) finishDraw(pagePoints)
  }, [pagePoints])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!editor || !active) return
    const rawPt = editor.screenToPage({ x: e.clientX, y: e.clientY })
    const snapped = snapToWallEndpoint(editor, rawPt)
    if (snapped) {
      const snapPage: Pt = { x: snapped.x, y: snapped.y }
      setSnapVp(editor.pageToViewport(snapPage))
      setCursorVp(editor.pageToViewport(snapPage))
    } else {
      setSnapVp(null)
      setCursorVp(editor.pageToViewport(rawPt))
    }
  }, [editor, active])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!editor) return
    e.preventDefault()
    e.stopPropagation()
    const pixelRatio = e.deltaMode === 1 ? 16 : 1
    const delta = new Vec(e.deltaX * pixelRatio, e.deltaY * pixelRatio)
    if (delta.x === 0 && delta.y === 0) return
    editor.dispatch({
      type: 'wheel', name: 'wheel', delta,
      point: new Vec(e.clientX, e.clientY),
      shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.metaKey || e.ctrlKey,
    })
  }, [editor])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (pagePoints.length > 0) setPagePoints(prev => prev.slice(0, -1))
  }, [pagePoints.length])

  const finishDraw = (pts: Pt[]) => {
    if (!editor || pts.length < 3) return
    const scale = getScaleConfig(editor)
    const measured = measurePolygon(pts, scale.pxPerMm)
    completeZoneDraw({ points: pts, ...measured })
  }

  if (!active) return null

  let previewArea = ''
  if (editor && pagePoints.length >= 3) {
    const scale = getScaleConfig(editor)
    previewArea = `${pxAreaToM2(shoelaceArea(pagePoints), scale.pxPerMm).toFixed(2)} m²`
  }

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

        {vpPoints.length >= 3 && (
          <polygon points={vpPoints.map(p => `${p.x},${p.y}`).join(' ')}
            fill="rgba(52,168,83,0.1)" stroke="none" />
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
