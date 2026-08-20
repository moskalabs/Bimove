import { useEffect, useState } from 'react'
import type { TLShapeId } from 'tldraw'
import { useEditor } from '../context/EditorContext'
import {
  snapToWallEndpoint, snapToIntersection, snapToExtension,
  type SnapType,
} from '../lib/snap'
import { drawingState } from '../lib/drawingState'
import { getScaleConfig, formatLength } from '../lib/scaleConfig'

type Pt = { x: number; y: number }

type OverlayState = {
  start: Pt | null
  snap: Pt | null
  snapType: SnapType | null
  end: Pt | null
  mid: Pt | null
  angleDeg: number | null
  distLabel: string | null
}

const EMPTY: OverlayState = { start: null, snap: null, snapType: null, end: null, mid: null, angleDeg: null, distLabel: null }

/** 스냅 타입별 색상 */
const SNAP_COLORS: Record<SnapType, string> = {
  endpoint: '#00b341',
  midpoint: '#1a73e8',
  intersection: '#e8a01a',
  perpendicular: '#e84335',
  extension: '#9c27b0',
  angle: '#607d8b',
}

/** 스냅 타입별 레이블 */
const SNAP_LABELS: Record<SnapType, string> = {
  endpoint: '끝점',
  midpoint: '중간점',
  intersection: '교차점',
  perpendicular: '수직',
  extension: '연장',
  angle: '',
}

export function ToolOverlay() {
  const editor = useEditor()
  const [state, setState] = useState<OverlayState>(EMPTY)

  useEffect(() => {
    if (!editor) return

    const update = () => {
      const toolId = editor.getCurrentToolId()
      if (toolId !== 'wall' && toolId !== 'dimension') {
        setState(EMPTY)
        return
      }

      const drawingId = drawingState.drawingId
      let start: Pt | null = null
      let end: Pt | null = null
      let mid: Pt | null = null
      let angleDeg: number | null = null
      let distLabel: string | null = null

      if (drawingId) {
        const shape = editor.getShape(drawingId as TLShapeId)
        if (shape) {
          start = editor.pageToViewport({ x: shape.x, y: shape.y })
          const p = shape.props as { x2: number; y2: number }
          const lenPx = Math.hypot(p.x2, p.y2)
          if (lenPx > 5) {
            end = editor.pageToViewport({ x: shape.x + p.x2, y: shape.y + p.y2 })
            mid = editor.pageToViewport({ x: shape.x + p.x2 / 2, y: shape.y + p.y2 / 2 })
            angleDeg = Math.atan2(p.y2, p.x2) * 180 / Math.PI
            const scale = getScaleConfig(editor)
            distLabel = formatLength(lenPx, scale)
          }
        }
      }

      // 스냅 감지: endpoint/midpoint > intersection > extension
      const pagePoint = editor.inputs.currentPagePoint
      const excludeId = drawingId ?? undefined
      let snap: Pt | null = null
      let snapType: SnapType | null = null

      const epHit = snapToWallEndpoint(editor, pagePoint, excludeId)
      if (epHit) {
        snap = editor.pageToViewport({ x: epHit.x, y: epHit.y })
        snapType = epHit.snapType ?? 'endpoint'
      } else {
        const intHit = snapToIntersection(editor, pagePoint, excludeId)
        if (intHit) {
          snap = editor.pageToViewport({ x: intHit.x, y: intHit.y })
          snapType = 'intersection'
        } else {
          const extHit = snapToExtension(editor, pagePoint, excludeId)
          if (extHit) {
            snap = editor.pageToViewport({ x: extHit.x, y: extHit.y })
            snapType = 'extension'
          }
        }
      }

      setState({ start, snap, snapType, end, mid, angleDeg, distLabel })
    }

    let raf = 0
    const unsub = editor.store.listen(() => {
      if (raf) return
      raf = requestAnimationFrame(() => { raf = 0; update() })
    })
    return () => { unsub(); if (raf) cancelAnimationFrame(raf) }
  }, [editor])

  const snapColor = state.snapType ? SNAP_COLORS[state.snapType] : '#00b341'
  const snapLabel = state.snapType ? SNAP_LABELS[state.snapType] : ''

  return (
    <>
      {state.start && (
        <div style={{
          position: 'absolute', left: state.start.x - 5, top: state.start.y - 5,
          width: 10, height: 10, borderRadius: '50%',
          background: '#1a73e8', border: '2px solid white',
          boxShadow: '0 0 0 1px #1a73e8', pointerEvents: 'none', zIndex: 100,
        }} />
      )}
      {state.snap && (
        <>
          {/* 스냅 인디케이터 링 */}
          <div style={{
            position: 'absolute', left: state.snap.x - 8, top: state.snap.y - 8,
            width: 16, height: 16, borderRadius: '50%',
            border: `2px solid ${snapColor}`, background: `${snapColor}22`,
            pointerEvents: 'none', zIndex: 101,
          }} />
          {/* 교차점은 X 마커 추가 */}
          {state.snapType === 'intersection' && (
            <div style={{
              position: 'absolute', left: state.snap.x - 6, top: state.snap.y - 6,
              width: 12, height: 12, pointerEvents: 'none', zIndex: 102,
              color: snapColor, fontSize: 12, fontWeight: 'bold',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>✕</div>
          )}
          {/* 수직은 ⊥ 마커 추가 */}
          {state.snapType === 'perpendicular' && (
            <div style={{
              position: 'absolute', left: state.snap.x - 6, top: state.snap.y - 6,
              width: 12, height: 12, pointerEvents: 'none', zIndex: 102,
              color: snapColor, fontSize: 11, fontWeight: 'bold',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>⊥</div>
          )}
          {/* 연장은 점선 연장 표시 */}
          {state.snapType === 'extension' && (
            <div style={{
              position: 'absolute', left: state.snap.x + 10, top: state.snap.y - 6,
              pointerEvents: 'none', zIndex: 102,
              color: snapColor, fontSize: 9, fontWeight: 600,
              whiteSpace: 'nowrap',
            }}>···</div>
          )}
          {/* 스냅 타입 레이블 */}
          {snapLabel && (
            <div style={{
              position: 'absolute', left: state.snap.x + 12, top: state.snap.y + 4,
              pointerEvents: 'none', zIndex: 102,
              color: snapColor, fontSize: 10, fontWeight: 600,
              whiteSpace: 'nowrap', textShadow: '0 0 3px white, 0 0 3px white',
            }}>{snapLabel}</div>
          )}
        </>
      )}
      {state.end && state.angleDeg !== null && (
        <div className="tool-angle-badge" style={{
          left: state.end.x + 12, top: state.end.y - 14,
        }}>
          {state.angleDeg.toFixed(1)}°
        </div>
      )}
      {state.mid && state.distLabel && (
        <div className="tool-dist-label" style={{
          left: state.mid.x, top: state.mid.y - 24,
        }}>
          {state.distLabel}
        </div>
      )}
    </>
  )
}
