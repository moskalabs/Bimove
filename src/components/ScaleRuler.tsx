import { useEffect, useRef, useState } from 'react'
import { useEditor } from '../context/EditorContext'
import { getScaleConfig } from '../lib/scaleConfig'
import {
  type SnapMode,
  getSnapEnabled, setSnapEnabled,
  getSnapMode, setSnapMode,
} from '../lib/settings'

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

/* ── 스냅 아이콘 (SVG) ── */
function SnapIcon({ mode, color, size = 14 }: { mode: string; color: string; size?: number }) {
  const c = color
  switch (mode) {
    case 'endpoint':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <line x1="3" y1="13" x2="13" y2="3" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="13" cy="3" r="2.5" fill={c} />
        </svg>
      )
    case 'midpoint':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <line x1="2" y1="14" x2="14" y2="2" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
          <polygon points="8,5 5.5,10 10.5,10" fill={c} />
        </svg>
      )
    case 'intersection':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <line x1="2" y1="14" x2="14" y2="2" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="2" y1="2" x2="14" y2="14" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="8" cy="8" r="2" fill={c} />
        </svg>
      )
    case 'perpendicular':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <line x1="3" y1="13" x2="3" y2="3" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="3" y1="13" x2="13" y2="13" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
          <rect x="3" y="9" width="4" height="4" fill="none" stroke={c} strokeWidth="1" />
          <circle cx="8" cy="6" r="2" fill={c} />
        </svg>
      )
    case 'extension':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <line x1="2" y1="8" x2="8" y2="8" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="9" y1="8" x2="14" y2="8" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 2" />
          <circle cx="8" cy="8" r="2" fill={c} />
        </svg>
      )
    case 'ortho':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <line x1="3" y1="13" x2="13" y2="13" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="3" y1="13" x2="8" y2="3" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M6 13 A4 4 0 0 1 5 9.5" stroke={c} strokeWidth="1" fill="none" />
          <circle cx="3" cy="13" r="1.5" fill={c} />
        </svg>
      )
    default:
      return null
  }
}

/** 자석 아이콘 */
function MagnetIcon({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path
        d="M4 2v5a4 4 0 0 0 8 0V2"
        stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"
      />
      <line x1="4" y1="2" x2="4" y2="5" stroke={color} strokeWidth="3" strokeLinecap="round" />
      <line x1="12" y1="2" x2="12" y2="5" stroke={color} strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

const SNAP_ITEMS: { mode: SnapMode | 'ortho'; label: string; color: string }[] = [
  { mode: 'endpoint',      label: '끝점',   color: '#f5a623' },
  { mode: 'midpoint',      label: '중간점', color: '#f5a623' },
  { mode: 'intersection',  label: '교차점', color: '#e8a01a' },
  { mode: 'perpendicular', label: '수직',   color: '#e84335' },
  { mode: 'extension',     label: '연장',   color: '#9c27b0' },
  { mode: 'ortho',         label: '직교',   color: '#607d8b' },
]

export function ScaleRuler() {
  const editor = useEditor()
  const [zoom, setZoom] = useState(1)
  const [pxPerMm, setPxPerMm] = useState(1)

  // 스냅 상태
  const [snapEnabled, _setSnapEnabled] = useState(getSnapEnabled)
  const [snapModes, setSnapModes] = useState(() => ({
    endpoint: getSnapMode('endpoint'),
    midpoint: getSnapMode('midpoint'),
    intersection: getSnapMode('intersection'),
    perpendicular: getSnapMode('perpendicular'),
    extension: getSnapMode('extension'),
  }))
  const [snapOpen, setSnapOpen] = useState(false)
  const snapRef = useRef<HTMLDivElement>(null)

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

  // 바깥 클릭 시 스냅 드롭다운 닫기
  useEffect(() => {
    if (!snapOpen) return
    const handler = (e: MouseEvent) => {
      if (snapRef.current && !snapRef.current.contains(e.target as Node)) setSnapOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [snapOpen])

  // 화면상 BAR_PX 픽셀이 실제로 몇 mm에 해당하는지 계산
  const screenPxPerMm = pxPerMm * zoom
  if (!isFinite(screenPxPerMm) || screenPxPerMm <= 0) return null
  const realMm = BAR_PX / screenPxPerMm
  if (!isFinite(realMm) || realMm <= 0) return null

  const label = formatDistance(realMm)
  const tickH = 8
  const barY = 28

  const toggleSnapEnabled = () => {
    const next = !snapEnabled
    _setSnapEnabled(next)
    setSnapEnabled(next)
  }

  const toggleSnapMode = (item: typeof SNAP_ITEMS[number]) => {
    if (item.mode === 'ortho') {
      toggleSnapEnabled()
    } else {
      const mode = item.mode as SnapMode
      const next = !snapModes[mode]
      setSnapModes(prev => ({ ...prev, [mode]: next }))
      setSnapMode(mode, next)
    }
  }

  const anyActive = snapEnabled || Object.values(snapModes).some(Boolean)

  return (
    <div style={{
      position: 'absolute', bottom: 24, left: 20, zIndex: 400,
      display: 'flex', alignItems: 'flex-end', gap: 6,
      pointerEvents: 'none', userSelect: 'none',
    }}>
      {/* 스냅 토글 버튼 */}
      <div ref={snapRef} style={{ pointerEvents: 'auto', position: 'relative' }}>
        <button
          onClick={() => setSnapOpen(prev => !prev)}
          title="스냅 설정"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 36, height: 36,
            background: anyActive ? 'rgba(245,166,35,0.12)' : 'rgba(255,255,255,0.92)',
            border: anyActive ? '1.5px solid #f5a623' : '1px solid #ddd',
            borderRadius: 8, cursor: 'pointer',
            boxShadow: '0 1px 6px rgba(0,0,0,0.10)',
            transition: 'border-color 0.15s, background 0.15s',
          }}
        >
          <MagnetIcon color={anyActive ? '#f5a623' : '#999'} size={18} />
        </button>

        {/* 스냅 옵션 팝업 */}
        {snapOpen && (
          <div style={{
            position: 'absolute', bottom: 42, left: 0,
            background: '#fff', borderRadius: 10,
            boxShadow: '0 4px 16px rgba(0,0,0,0.14)',
            padding: '6px 0', minWidth: 140,
            zIndex: 500,
          }}>
            <div style={{
              padding: '4px 12px 6px', fontSize: 11, fontWeight: 600,
              color: '#888', letterSpacing: '0.03em',
            }}>
              스냅 모드
            </div>
            {SNAP_ITEMS.map(item => {
              const active = item.mode === 'ortho'
                ? snapEnabled
                : snapModes[item.mode as SnapMode]
              return (
                <label
                  key={item.mode}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '5px 12px', cursor: 'pointer',
                    fontSize: 13, color: '#333',
                    background: active ? 'rgba(245,166,35,0.06)' : 'transparent',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = active ? 'rgba(245,166,35,0.10)' : '#f5f5f5')}
                  onMouseLeave={e => (e.currentTarget.style.background = active ? 'rgba(245,166,35,0.06)' : 'transparent')}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggleSnapMode(item)}
                    style={{ display: 'none' }}
                  />
                  <span style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 18, height: 18,
                    opacity: active ? 1 : 0.4,
                  }}>
                    <SnapIcon mode={item.mode} color={active ? item.color : '#999'} size={14} />
                  </span>
                  <span style={{ flex: 1 }}>{item.label}</span>
                  <span style={{
                    width: 16, height: 16, borderRadius: 3,
                    border: active ? `1.5px solid ${item.color}` : '1.5px solid #ccc',
                    background: active ? item.color : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.12s',
                  }}>
                    {active && (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2 5 L4.5 7.5 L8 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                </label>
              )
            })}
          </div>
        )}
      </div>

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
