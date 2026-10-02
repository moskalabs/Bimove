import { useEffect, useState } from 'react'
import { useEditor } from '../context/EditorContext'
import { getScaleConfig } from '../lib/scaleConfig'

function niceStep(mm: number): number {
  if (mm <= 0 || !isFinite(mm)) return 1000
  const mag = Math.pow(10, Math.floor(Math.log10(mm)))
  const n = mm / mag
  if (n < 1.5) return mag
  if (n < 3.5) return 2 * mag
  if (n < 7.5) return 5 * mag
  return 10 * mag
}

function formatMm(mm: number): string {
  if (mm >= 1_000_000) return `${(mm / 1_000_000).toFixed(2)} km`
  if (mm >= 1000) return `${(mm / 1000).toFixed(2)} m`
  if (mm >= 100) return `${(mm / 10).toFixed(1)} cm`
  return `${Math.round(mm)} mm`
}

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

  const screenPxPerMm = pxPerMm * zoom
  if (!isFinite(screenPxPerMm) || screenPxPerMm <= 0) return null
  const targetMm = 180 / screenPxPerMm
  if (!isFinite(targetMm) || targetMm <= 0) return null

  const niceMm = niceStep(targetMm)
  const barPx = Math.max(80, Math.min(280, niceMm * screenPxPerMm))
  const label = formatMm(niceMm)

  const tickH = 8
  const barY = 28
  const pad = 16

  return (
    <div style={{
      position: 'absolute', bottom: 24, left: 20, zIndex: 400,
      background: 'rgba(255,255,255,0.92)', borderRadius: 8,
      padding: `8px ${pad}px 6px`,
      pointerEvents: 'none', userSelect: 'none',
      boxShadow: '0 1px 6px rgba(0,0,0,0.10)',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <svg width={barPx} height={36} style={{ display: 'block', overflow: 'visible' }}>
        {/* centered label */}
        <text
          x={barPx / 2} y={14}
          fontSize={13} fontWeight={500} fill="#333"
          textAnchor="middle" dominantBaseline="auto"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >{label}</text>
        {/* left tick ^ */}
        <line x1={1} y1={barY} x2={1} y2={barY - tickH} stroke="#999" strokeWidth={1} />
        {/* right tick ^ */}
        <line x1={barPx - 1} y1={barY} x2={barPx - 1} y2={barY - tickH} stroke="#999" strokeWidth={1} />
        {/* horizontal bar */}
        <line x1={1} y1={barY} x2={barPx - 1} y2={barY} stroke="#999" strokeWidth={1} />
      </svg>
    </div>
  )
}
