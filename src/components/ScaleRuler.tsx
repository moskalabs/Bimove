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
  if (mm >= 1000) return `${mm / 1000}m`
  if (mm >= 100) return `${mm / 10}cm`
  return `${mm}mm`
}

export function ScaleRuler() {
  const editor = useEditor()
  const [zoom, setZoom] = useState(1)
  const [pxPerMm, setPxPerMm] = useState(1)

  useEffect(() => {
    if (!editor) return
    const unsub = editor.store.listen(() => {
      setZoom(editor.getCamera().z)
      setPxPerMm(getScaleConfig(editor).pxPerMm)
    })
    return unsub
  }, [editor])

  const screenPxPerMm = pxPerMm * zoom
  if (!isFinite(screenPxPerMm) || screenPxPerMm <= 0) return null
  const targetMm = 180 / screenPxPerMm
  if (!isFinite(targetMm) || targetMm <= 0) return null

  const niceMm = niceStep(targetMm)
  const barPx = Math.max(40, Math.min(320, niceMm * screenPxPerMm))
  const label = formatMm(niceMm)

  return (
    <div style={{
      position: 'absolute', bottom: 20, left: 20, zIndex: 400,
      background: 'rgba(255,255,255,0.88)', borderRadius: 6,
      padding: '6px 8px 4px',
      pointerEvents: 'none', userSelect: 'none',
      boxShadow: '0 1px 5px rgba(0,0,0,0.13)',
    }}>
      <svg width={barPx} height={22} style={{ display: 'block', overflow: 'visible' }}>
        {/* left tick */}
        <line x1={1} y1={2} x2={1} y2={18} stroke="#333" strokeWidth={1.5} />
        {/* mid tick */}
        <line x1={barPx / 2} y1={6} x2={barPx / 2} y2={18} stroke="#555" strokeWidth={1} />
        {/* right tick */}
        <line x1={barPx - 1} y1={2} x2={barPx - 1} y2={18} stroke="#333" strokeWidth={1.5} />
        {/* bar left half black */}
        <rect x={1} y={9} width={(barPx - 2) / 2} height={6} fill="#444" />
        {/* bar right half white */}
        <rect x={1 + (barPx - 2) / 2} y={9} width={(barPx - 2) / 2} height={6} fill="#fff" stroke="#444" strokeWidth={0.5} />
        {/* outer border */}
        <rect x={1} y={9} width={barPx - 2} height={6} fill="none" stroke="#444" strokeWidth={1} />
        {/* labels */}
        <text x={1} y={8} fontSize={9} fill="#555" textAnchor="middle" dominantBaseline="auto">0</text>
        <text x={barPx - 1} y={8} fontSize={9} fill="#555" textAnchor="middle" dominantBaseline="auto">{label}</text>
      </svg>
    </div>
  )
}
