import { useEffect, useRef, useState } from 'react'
import { useEditor } from '../context/EditorContext'
import { detectRooms, type Room } from '../lib/roomDetection'
import { getScaleConfig } from '../lib/scaleConfig'
import { getShowRoomAreas, getRoomNames, setRoomName } from '../lib/settings'

type Pt = { x: number; y: number }

type ViewRoom = Room & {
  cx: number
  cy: number
  idx: number
  vpVerts: Pt[]
  key: string
}

function roomKey(r: Room): string {
  return `${Math.round(r.centroid.x / 50) * 50},${Math.round(r.centroid.y / 50) * 50}`
}

const FILL_COLORS = [
  'rgba(26,115,232,0.07)',
  'rgba(52,168,83,0.07)',
  'rgba(251,188,5,0.07)',
  'rgba(234,67,53,0.07)',
  'rgba(103,58,183,0.07)',
  'rgba(0,172,193,0.07)',
]
const STROKE_COLORS = [
  'rgba(26,115,232,0.35)',
  'rgba(52,168,83,0.35)',
  'rgba(251,188,5,0.5)',
  'rgba(234,67,53,0.35)',
  'rgba(103,58,183,0.35)',
  'rgba(0,172,193,0.35)',
]
const LABEL_COLORS = [
  '#1a73e8', '#34a853', '#b5850b', '#ea4335', '#673ab7', '#00acc1',
]

export function RoomOverlay() {
  const editor = useEditor()
  const [rooms, setRooms] = useState<ViewRoom[]>([])
  const [visible, setVisible] = useState(getShowRoomAreas)
  const [names, setNames] = useState(getRoomNames)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onSettings = () => { setVisible(getShowRoomAreas()); setNames(getRoomNames()) }
    window.addEventListener('bimove:settings', onSettings)
    return () => window.removeEventListener('bimove:settings', onSettings)
  }, [])

  useEffect(() => {
    if (!editor) return
    const update = () => {
      const walls = editor.getCurrentPageShapes()
        .filter(s => s.type === 'wall')
        .map(s => {
          const p = s.props as { x2: number; y2: number }
          return { x1: s.x, y1: s.y, x2: s.x + p.x2, y2: s.y + p.y2 }
        })

      const detected = detectRooms(walls)
      const scale = getScaleConfig(editor)

      setRooms(detected.map((r, i) => {
        const vp = editor.pageToViewport(r.centroid)
        const vpVerts = r.vertices.map(v => editor.pageToViewport(v))
        return {
          ...r,
          idx: i + 1,
          cx: vp.x,
          cy: vp.y,
          vpVerts,
          area: r.area / (scale.pxPerMm * scale.pxPerMm),
          key: roomKey(r),
        }
      }))
    }
    update()
    const unsub = editor.store.listen(update)
    return unsub
  }, [editor])

  const startEdit = (key: string) => {
    setEditing(key)
    setDraft(names[key] ?? '')
    setTimeout(() => inputRef.current?.focus(), 30)
  }

  const commitEdit = () => {
    if (editing === null) return
    setRoomName(editing, draft)
    setNames(getRoomNames())
    setEditing(null)
  }

  if (!visible || rooms.length === 0) return null

  return (
    <>
      {/* SVG polygon fills — behind labels */}
      <svg
        style={{
          position: 'fixed', inset: 0, width: '100%', height: '100%',
          pointerEvents: 'none', zIndex: 298,
        }}
      >
        {rooms.map((r, i) => {
          const pts = r.vpVerts.map(v => `${v.x},${v.y}`).join(' ')
          return (
            <polygon
              key={r.key}
              points={pts}
              fill={FILL_COLORS[i % FILL_COLORS.length]}
              stroke={STROKE_COLORS[i % STROKE_COLORS.length]}
              strokeWidth={1.5}
              strokeDasharray="6,3"
            />
          )
        })}
      </svg>

      {/* Labels (double-click to rename) */}
      {rooms.map((r, i) => {
        if (!editor) return null
        const scale = getScaleConfig(editor)
        const color = LABEL_COLORS[i % LABEL_COLORS.length]
        const displayName = names[r.key]

        return (
          <div
            key={r.key}
            style={{
              position: 'fixed',
              left: r.cx,
              top: r.cy,
              zIndex: 299,
              transform: 'translate(-50%, -50%)',
              background: 'rgba(255,255,255,0.88)',
              border: `1.5px solid ${color}55`,
              borderRadius: 5,
              padding: '3px 8px',
              fontSize: 11,
              color,
              fontFamily: 'monospace',
              pointerEvents: 'auto',
              whiteSpace: 'nowrap',
              textAlign: 'center',
              lineHeight: 1.6,
              cursor: 'pointer',
              boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
              userSelect: 'none',
            }}
            onDoubleClick={() => startEdit(r.key)}
            title="더블클릭으로 이름 편집"
          >
            {editing === r.key ? (
              <input
                ref={inputRef}
                value={draft}
                placeholder={`방 ${r.idx}`}
                onChange={e => setDraft(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitEdit()
                  if (e.key === 'Escape') setEditing(null)
                  e.stopPropagation()
                }}
                style={{
                  width: 80, fontSize: 11, border: 'none', outline: 'none',
                  background: 'transparent', fontFamily: 'monospace',
                  textAlign: 'center', color,
                }}
              />
            ) : (
              <>
                <div style={{ fontWeight: 600, fontSize: 10, opacity: 0.75 }}>
                  {displayName ?? `방 ${r.idx}`}
                </div>
                <div>{formatArea(r.area, scale.unit)}</div>
              </>
            )}
          </div>
        )
      })}
    </>
  )
}

export function formatArea(areaMm2: number, unit: string): string {
  if (unit === 'mm') return `${Math.round(areaMm2).toLocaleString()} mm²`
  if (unit === 'cm') return `${(areaMm2 / 100).toFixed(1)} cm²`
  return `${(areaMm2 / 1_000_000).toFixed(2)} m²`
}
