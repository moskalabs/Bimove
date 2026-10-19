/**
 * 고른 벽의 **치수와 코너 각도**.
 *
 * 한이 "클릭하면 각도랑 길이 숫자 보이게" 라고 했다. 치수는 이미 있었는데
 * **안 보였다** — 벽 도형 안에서 `fontSize={10}` 으로 그리고 있었기 때문이다.
 * tldraw 는 줌을 컨테이너 CSS transform 으로 걸므로 그 10 은 shape 단위고,
 * 축소하면 글자도 같이 줄어 점이 된다. 한이 보낸 화면의 가운데 흐릿한 자국이
 * 그 글자였다. (선 두께에서 겪은 것과 같은 사고다 — lib/dxfStroke 주석 참고.)
 *
 * 그래서 측정 표시를 **화면 좌표로 옮겼다.** 여기서는 줌과 무관하게 늘 같은
 * 크기로 그려지고, 그리는 중에 쓰는 것과 같은 함수(`angleArc`,
 * `labelPlacement`)를 쓰므로 **그릴 때와 고른 뒤가 같은 모양**이 된다.
 *
 * 내보내기(SVG/PDF)에는 안 나간다 — 원래도 `toSvg` 는 치수를 안 그렸다.
 * 화면에서 재보는 도구지 도면에 찍히는 치수선이 아니다.
 */
import { useEffect, useState } from 'react'
import { useEditor } from '../context/EditorContext'
import { useValue } from 'tldraw'
import { cornerAngleAt, labelPlacement } from '../lib/snap'
import { angleArc } from '../lib/angleArc'
import { getScaleConfig, formatLength } from '../lib/scaleConfig'
import { getShowWallLengths } from '../lib/settings'
import { shouldShowWallDim } from '../shapes/WallShape'

/** 치수선을 벽에서 띄울 거리(화면 px). 벽 두께 위에 더한다. */
const DIM_GAP_PX = 18
/** 치수선 끝의 짧은 날개. */
const TICK_PX = 5
/** 각도 호 반지름(화면 px). 구간이 짧으면 더 줄인다. */
const ARC_PX = 30

type Pt = { x: number; y: number }

type Corner = { at: Pt; prevAway: Pt; away: Pt; deg: number }

type Item = {
  id: string
  s: Pt
  e: Pt
  label: string
  /** 치수선을 놓을 수직 오프셋(화면 px). 벽이 두꺼우면 더 밀어낸다. */
  off: number
  corners: Corner[]
}

export function WallDimOverlay() {
  const editor = useEditor()
  const [settingOn, setSettingOn] = useState(getShowWallLengths)

  useEffect(() => {
    const onSettings = () => setSettingOn(getShowWallLengths())
    window.addEventListener('bimova:settings', onSettings)
    return () => window.removeEventListener('bimova:settings', onSettings)
  }, [])

  // `useValue` 안이라 여기서 읽은 신호가 전부 의존성이 된다 — 고른 벽이
  // 바뀌거나, 이웃이 움직이거나, 카메라가 움직이면 같이 다시 그린다.
  const items = useValue<Item[]>(
    'wall-dims',
    () => {
      if (!editor) return []
      const ids = editor.getSelectedShapeIds()
      if (!shouldShowWallDim(settingOn, ids.length)) return []

      const scale = getScaleConfig(editor)
      const zoom = editor.getZoomLevel()
      const out: Item[] = []

      for (const id of ids) {
        const shape = editor.getShape(id)
        if (!shape || shape.type !== 'wall') continue
        // DXF 에서 온 벽은 중심선만 그리는 주석이라 치수를 안 붙인다.
        if (shape.meta?.dxfFingerprint) continue
        const p = shape.props as { x2: number; y2: number; thickness: number }
        const lenPage = Math.hypot(p.x2, p.y2)
        if (lenPage < 1) continue

        const mat = editor.getShapePageTransform(shape)
        const sPage = mat.applyToPoint({ x: 0, y: 0 })
        const ePage = mat.applyToPoint({ x: p.x2, y: p.y2 })
        const s = editor.pageToViewport(sPage)
        const e = editor.pageToViewport(ePage)
        if (Math.hypot(e.x - s.x, e.y - s.y) < 12) continue   // 화면에서 너무 짧다

        // 코너 각도는 **그릴 때와 같은 규칙**으로 센다: 접점에서 서로
        // 멀어지는 두 방향 사이 각(내각).
        const corners: Corner[] = []
        const addCorner = (atPage: Pt, at: Pt, awayPage: Pt) => {
          const c = cornerAngleAt(editor, atPage, awayPage, shape.id)
          if (!c) return
          if (c.deg < 3 || c.deg > 177) return      // 안 꺾였거나 되접혔다
          corners.push({ at, prevAway: c.prevAway, away: awayPage, deg: c.deg })
        }
        // 방향도 **page 기준**이어야 한다. 끝점은 변환을 거쳤는데 방향만
        // 로컬 x2/y2 를 넣으면, 90° 돌려 놓은 벽은 실제로 세로인데 가로로
        // 계산된다 — 90° 코너가 180° 로 나와 표시가 아예 사라진다.
        const awayFromStart = { x: ePage.x - sPage.x, y: ePage.y - sPage.y }
        addCorner(sPage, s, awayFromStart)
        addCorner(ePage, e, { x: -awayFromStart.x, y: -awayFromStart.y })

        out.push({
          id: shape.id,
          s, e,
          label: formatLength(lenPage, scale),
          off: (p.thickness / 2) * zoom + DIM_GAP_PX,
          corners,
        })
      }
      return out
    },
    [editor, settingOn],
  )

  if (items.length === 0) return null

  return (
    <svg
      style={{
        position: 'absolute', left: 0, top: 0, width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: 102, overflow: 'visible',
      }}
    >
      {items.map(it => {
        const dx = it.e.x - it.s.x, dy = it.e.y - it.s.y
        const len = Math.hypot(dx, dy)
        // 화면 좌표는 y 가 아래로 간다 — 진행 방향의 왼쪽이 (dy, -dx) 다.
        const nx = dy / len, ny = -dx / len
        const a = { x: it.s.x + nx * it.off, y: it.s.y + ny * it.off }
        const b = { x: it.e.x + nx * it.off, y: it.e.y + ny * it.off }
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const lab = labelPlacement(mid, it.s, it.e, 0)
        const ux = dx / len, uy = dy / len

        return (
          <g key={it.id} stroke="#1a73e8" fill="none" strokeWidth={1}>
            {/* 치수선 + 양 끝 보조선 */}
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
            <line x1={it.s.x} y1={it.s.y} x2={a.x + nx * TICK_PX} y2={a.y + ny * TICK_PX} opacity={0.5} />
            <line x1={it.e.x} y1={it.e.y} x2={b.x + nx * TICK_PX} y2={b.y + ny * TICK_PX} opacity={0.5} />
            {/* 화살촉 */}
            <path d={`M${a.x + ux * 7 + nx * 3} ${a.y + uy * 7 + ny * 3} L${a.x} ${a.y} L${a.x + ux * 7 - nx * 3} ${a.y + uy * 7 - ny * 3}`} />
            <path d={`M${b.x - ux * 7 + nx * 3} ${b.y - uy * 7 + ny * 3} L${b.x} ${b.y} L${b.x - ux * 7 - nx * 3} ${b.y - uy * 7 - ny * 3}`} />
            <text
              x={lab.x} y={lab.y}
              transform={`rotate(${lab.deg} ${lab.x} ${lab.y})`}
              fill="#1a73e8" stroke="none"
              fontSize={12} fontWeight={600} textAnchor="middle" dominantBaseline="middle"
              style={{ fontFamily: 'ui-monospace, Consolas, monospace', paintOrder: 'stroke' }}
            >
              {it.label}
            </text>

            {/* 코너 각도 — 그릴 때와 같은 쐐기 */}
            {it.corners.map((c, i) => {
              const r = Math.min(ARC_PX, len * 0.4)
              const arc = angleArc(c.at.x, c.at.y, c.prevAway.x, c.prevAway.y, c.away.x, c.away.y, r)
              if (!arc) return null
              return (
                <g key={i}>
                  <path d={arc.d} fill="#1a73e8" fillOpacity={0.14} stroke="none" />
                  <text
                    x={arc.labelX} y={arc.labelY}
                    fill="#1a73e8" stroke="none"
                    fontSize={11} fontWeight={600} textAnchor="middle" dominantBaseline="middle"
                    style={{ fontFamily: 'ui-monospace, Consolas, monospace' }}
                  >
                    {c.deg.toFixed(1)}°
                  </text>
                </g>
              )
            })}
          </g>
        )
      })}
    </svg>
  )
}
