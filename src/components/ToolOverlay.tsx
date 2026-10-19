import { useEffect, useState } from 'react'
import type { TLShapeId } from 'tldraw'
import { useEditor } from '../context/EditorContext'
import {
  snapToWallEndpoint, snapToIntersection, snapToPerpendicular, snapToExtension,
  turnMagnitudeDeg,
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
  /**
   * 앞 구간과 이루는 각(도). 이어 그릴 때만 찬다.
   *
   * Rayon 이 코너에 띄우는 "90.0°" 와 같은 것이다. 이게 없으면 직각으로
   * 꺾였는지 눈으로 재야 한다.
   */
  turnDeg: number | null
  /**
   * 그릴 **보조선** (뷰포트 좌표). 화면을 가로지르는 점선이다.
   *
   * 도구가 정해 준 것을 그대로 그린다 — 여기서 스냅을 다시 계산하면 둘이
   * 어긋나서 "그려진 선과 실제로 맞춰진 자리가 다른" 최악이 된다.
   */
  guides: Array<{ axis: 'x' | 'y'; at: number }>
}

const EMPTY: OverlayState = { start: null, snap: null, snapType: null, end: null, mid: null, angleDeg: null, distLabel: null, turnDeg: null, guides: [] }

/** 스냅 타입별 색상 */
const SNAP_COLORS: Record<SnapType, string> = {
  endpoint: '#00b341',
  midpoint: '#1a73e8',
  edge: '#00b341',
  intersection: '#e8a01a',
  perpendicular: '#e84335',
  extension: '#9c27b0',
  angle: '#607d8b',
  turn: '#1a73e8',
}

/** 스냅 타입별 레이블 */
const SNAP_LABELS: Record<SnapType, string> = {
  endpoint: '끝점',
  midpoint: '중간점',
  edge: '엣지',
  intersection: '교차점',
  perpendicular: '수직',
  extension: '연장',
  angle: '',
  turn: '',
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
      /** 그리는 중인 선의 시작점 (page 좌표) — 수직 스냅이 이걸 기준으로 수선을 내린다 */
      let startPage: Pt | null = null
      let end: Pt | null = null
      let mid: Pt | null = null
      let angleDeg: number | null = null
      let distLabel: string | null = null
      let turnDeg: number | null = null

      if (drawingId) {
        const shape = editor.getShape(drawingId as TLShapeId)
        if (shape) {
          startPage = { x: shape.x, y: shape.y }
          start = editor.pageToViewport(startPage)
          const p = shape.props as { x2: number; y2: number }
          const lenPx = Math.hypot(p.x2, p.y2)
          if (lenPx > 5) {
            end = editor.pageToViewport({ x: shape.x + p.x2, y: shape.y + p.y2 })
            mid = editor.pageToViewport({ x: shape.x + p.x2 / 2, y: shape.y + p.y2 / 2 })
            angleDeg = Math.atan2(p.y2, p.x2) * 180 / Math.PI
            const scale = getScaleConfig(editor)
            distLabel = formatLength(lenPx, scale)

            // 앞 구간과 이루는 각. (-180, 180] 로 접은 뒤 **크기**만 띄운다 —
            // 평면도에서는 "몇 도로 꺾였나" 만 알면 되고, 부호(좌/우)는
            // 화면에서 바로 보인다.
            const prev = drawingState.prevDir
            if (prev && Math.hypot(prev.x, prev.y) > 1) {
              turnDeg = turnMagnitudeDeg(prev, { x: p.x2, y: p.y2 })
            }
          }
        }
      }

      // 스냅 감지: endpoint/midpoint > intersection > perpendicular > extension
      // (resolveDrawPointAt 의 우선순위와 같아야 한다 — 표시와 실제가 어긋나면
      //  어느 쪽이 맞는지 알 수 없다)
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
          // 수직은 시작점이 있어야 수선을 내릴 수 있다 (그리는 중일 때만)
          const perpHit = startPage
            ? snapToPerpendicular(editor, startPage, pagePoint, excludeId)
            : null
          if (perpHit) {
            snap = editor.pageToViewport({ x: perpHit.x, y: perpHit.y })
            snapType = 'perpendicular'
          } else {
            const extHit = snapToExtension(editor, pagePoint, excludeId)
            if (extHit) {
              snap = editor.pageToViewport({ x: extHit.x, y: extHit.y })
              snapType = 'extension'
            }
          }
        }
      }

      // 보조선은 page 좌표로 들어오므로 뷰포트로 옮긴다. 세로선(x=at)은
      // 그 x 에 해당하는 화면 x 만 있으면 되고, 가로선은 화면 y 만 있으면 된다.
      const guides = drawingState.alignGuides.map(g => {
        const v = editor.pageToViewport({ x: g.at, y: g.at })
        return { axis: g.axis, at: g.axis === 'x' ? v.x : v.y }
      })

      setState({ start, snap, snapType, end, mid, angleDeg, distLabel, turnDeg, guides })
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
      {/* 보조선 — 화면을 가로지르는 점선. **왜 커서가 끌려갔는지**를
          보여주는 게 전부다. 없으면 CAD 에서 제일 답답한 순간이 된다. */}
      {state.guides.map((g, i) => (
        <div
          key={`${g.axis}${i}`}
          style={g.axis === 'x' ? {
            position: 'absolute', left: g.at, top: 0, width: 0, height: '100%',
            borderLeft: '1px dashed #b0b8c4', pointerEvents: 'none', zIndex: 99,
          } : {
            position: 'absolute', left: 0, top: g.at, width: '100%', height: 0,
            borderTop: '1px dashed #b0b8c4', pointerEvents: 'none', zIndex: 99,
          }}
        />
      ))}
      {/* 코너의 꺾임 각. 직각이면 또렷하게(진한 파랑), 아니면 옅게 —
          "쫙 90도로 붙었다" 가 한눈에 보여야 한다. */}
      {state.start && state.turnDeg !== null && (
        <div style={{
          position: 'absolute', left: state.start.x + 10, top: state.start.y - 26,
          padding: '2px 7px', borderRadius: 10,
          background: Math.abs(state.turnDeg - 90) < 0.05 ? '#1a73e8' : '#1a73e899',
          color: '#fff', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
          pointerEvents: 'none', zIndex: 103,
          fontFamily: 'ui-monospace, Consolas, monospace',
        }}>
          {state.turnDeg.toFixed(1)}°
        </div>
      )}
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
      {/* 절대 방향(0° = 오른쪽). **꺾임 각이 있으면 안 띄운다** — 둘을 나란히
          놓으면 "180.0°" 와 "90.0°" 가 같이 떠서 어느 게 직각인지 알 수 없다.
          평면도에서 알고 싶은 건 앞 벽과 이루는 각이지 화면 축 기준 각이 아니다.
          첫 구간에는 앞 벽이 없으므로 그때만 이게 나온다. */}
      {state.end && state.angleDeg !== null && state.turnDeg === null && (
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
