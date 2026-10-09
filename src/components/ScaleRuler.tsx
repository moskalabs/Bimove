import { useEffect, useState } from 'react'
import { useEditor } from '../context/EditorContext'
import { getScaleConfig } from '../lib/scaleConfig'

/** 실제 거리(mm)를 읽기 좋은 단위로 포맷 */
function formatDistance(mm: number): string {
  if (!isFinite(mm) || mm <= 0) return '0 m'
  if (mm >= 1_000_000) return `${(mm / 1_000_000).toFixed(2)} km`
  if (mm >= 1000) return `${(mm / 1000).toFixed(2)} m`
  if (mm >= 10) return `${(mm / 10).toFixed(1)} cm`
  return `${mm.toFixed(1)} mm`
}

/** 바 고정 폭(px). 줌해도 바 길이는 안 변하고 숫자만 바뀜 */
const BAR_PX = 200

export function ScaleRuler() {
  const editor = useEditor()
  const [zoom, setZoom] = useState(1)
  const [pxPerMm, setPxPerMm] = useState(1)

  useEffect(() => {
    if (!editor) return
    let raf = 0
    const unsub = editor.store.listen(() => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        setZoom(editor.getCamera().z)
        setPxPerMm(getScaleConfig(editor).pxPerMm)
      })
    })
    return () => { unsub(); if (raf) cancelAnimationFrame(raf) }
  }, [editor])

  // 화면상 BAR_PX 픽셀이 실제로 몇 mm에 해당하는지 계산
  const screenPxPerMm = pxPerMm * zoom
  if (!isFinite(screenPxPerMm) || screenPxPerMm <= 0) return null
  const realMm = BAR_PX / screenPxPerMm
  if (!isFinite(realMm) || realMm <= 0) return null

  const label = formatDistance(realMm)
  const tickH = 8
  const barY = 28

  return (
    <div style={{
      position: 'absolute', bottom: 24, left: 20, zIndex: 400,
      pointerEvents: 'none', userSelect: 'none',
    }}>
      {/* 축척 바 */}
      <div style={{
        background: 'rgba(255,255,255,0.92)', borderRadius: 8,
        padding: '8px 16px 6px',
        boxShadow: '0 1px 6px rgba(0,0,0,0.10)',
      }}>
        <svg width={BAR_PX} height={36} style={{ display: 'block', overflow: 'visible' }}>
          {/* centered label */}
          <text
            x={BAR_PX / 2} y={14}
            fontSize={13} fontWeight={500} fill="#333"
            textAnchor="middle" dominantBaseline="auto"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >{label}</text>
          {/* left tick */}
          <line x1={1} y1={barY} x2={1} y2={barY - tickH} stroke="#999" strokeWidth={1} />
          {/* right tick */}
          <line x1={BAR_PX - 1} y1={barY} x2={BAR_PX - 1} y2={barY - tickH} stroke="#999" strokeWidth={1} />
          {/* horizontal bar */}
          <line x1={1} y1={barY} x2={BAR_PX - 1} y2={barY} stroke="#999" strokeWidth={1} />
        </svg>
      </div>
    </div>
  )
}
