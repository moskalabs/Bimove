import { useEffect, useRef, useState, useCallback } from 'react'
import { useEditor } from '../context/EditorContext'
import { detectRooms, type Room } from '../lib/roomDetection'
import { getScaleConfig } from '../lib/scaleConfig'
import { formatArea } from '../lib/formatArea'
import { getShowRoomAreas, getRoomNames, setRoomName } from '../lib/settings'

type Pt = { x: number; y: number }

type ViewRoom = Room & {
  cx: number
  cy: number
  idx: number
  vpVerts: Pt[]
  key: string
  _isLeaf?: boolean
}

function roomKey(r: Room): string {
  return `${Math.round(r.centroid.x / 50) * 50},${Math.round(r.centroid.y / 50) * 50}`
}

/** ray-casting point-in-polygon */
function pointInPoly(pt: Pt, verts: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i].x, yi = verts[i].y
    const xj = verts[j].x, yj = verts[j].y
    if ((yi > pt.y) !== (yj > pt.y) && pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
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

// wall shapes의 fingerprint: shape 변경 시에만 detectRooms 재실행
// 전체 shapes를 필터하지 않고, 저렴한 체크만 수행
let _lastWallCount = -1
let _lastWallFp = ''
function wallsFingerprint(editor: { getCurrentPageShapes: () => Array<{ type: string; x: number; y: number; props: unknown }> }): string {
  const all = editor.getCurrentPageShapes()
  // 전체 shape 수가 같으면 wall도 안 변했을 가능성 높음 (카메라 변경 등)
  if (all.length === _lastWallCount) return _lastWallFp
  _lastWallCount = all.length
  const walls = all.filter(s => s.type === 'wall')
  if (walls.length === 0) { _lastWallFp = ''; return '' }
  const first = walls[0]
  const last = walls[walls.length - 1]
  _lastWallFp = `${walls.length}|${first.x.toFixed(0)},${first.y.toFixed(0)}|${last.x.toFixed(0)},${last.y.toFixed(0)}`
  return _lastWallFp
}

export function RoomOverlay() {
  const editor = useEditor()
  const [rooms, setRooms] = useState<ViewRoom[]>([])
  const [visible, setVisible] = useState(getShowRoomAreas)
  const [names, setNames] = useState(getRoomNames)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // 방 감지 결과 캐시 (page 좌표 기준, 카메라 무관)
  const detectedRef = useRef<Array<Room & { idx: number; key: string; _isLeaf?: boolean }>>([])
  const wallsFpRef = useRef('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const onSettings = () => { setVisible(getShowRoomAreas()); setNames(getRoomNames()) }
    window.addEventListener('bimove:settings', onSettings)
    return () => window.removeEventListener('bimove:settings', onSettings)
  }, [])

  // viewport 좌표 업데이트 (카메라 변경 시 호출 - 가벼운 연산)
  const updateViewport = useCallback(() => {
    if (!editor || detectedRef.current.length === 0) return

    setRooms(detectedRef.current.map((r) => {
      const vp = editor.pageToViewport(r.centroid)
      const vpVerts = r.vertices.map(v => editor.pageToViewport(v))
      return { ...r, cx: vp.x, cy: vp.y, vpVerts }
    }))
  }, [editor])

  // 방 감지 (wall 변경 시에만 - 무거운 연산)
  const redetect = useCallback(() => {
    if (!editor) return

    const walls = editor.getCurrentPageShapes()
      .filter(s => s.type === 'wall')
      .map(s => {
        const p = s.props as { x2: number; y2: number }
        return { x1: s.x, y1: s.y, x2: s.x + p.x2, y2: s.y + p.y2 }
      })

    const detected = detectRooms(walls)
    const scale = getScaleConfig(editor)

    const allRooms = detected.map((r, i) => ({
      ...r,
      idx: i + 1,
      area: r.area / (scale.pxPerMm * scale.pxPerMm),
      key: roomKey(r),
    }))

    // 큰 방이 작은 방을 포함하면 큰 방의 fill을 숨김 (leaf rooms만 fill 표시)
    // 각 방의 centroid가 다른 방 polygon 안에 있는지 체크
    const isLeaf = new Set(allRooms.map(r => r.key))
    for (const big of allRooms) {
      for (const small of allRooms) {
        if (big.key === small.key) continue
        if (big.area <= small.area) continue // big이 더 커야 함
        // small의 centroid가 big의 polygon 안에 있으면 big은 leaf가 아님
        if (pointInPoly(small.centroid, big.vertices)) {
          isLeaf.delete(big.key)
          break
        }
      }
    }
    // isLeaf 정보를 각 방에 저장
    detectedRef.current = allRooms.map(r => ({
      ...r,
      _isLeaf: isLeaf.has(r.key),
    }))

    wallsFpRef.current = wallsFingerprint(editor)
    updateViewport()
  }, [editor, updateViewport])

  useEffect(() => {
    if (!editor) return

    // 초기 실행
    redetect()

    const unsub = editor.store.listen(() => {
      // wall fingerprint가 변했으면 방 감지 재실행 (debounce 300ms)
      const fp = wallsFingerprint(editor)
      if (fp !== wallsFpRef.current) {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(redetect, 300)
      } else {
        // wall 변경 없이 카메라만 변경된 경우: viewport 좌표만 업데이트 (rAF 스로틀)
        if (!rafRef.current) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = 0
            updateViewport()
          })
        }
      }
    })

    return () => {
      unsub()
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [editor, redetect, updateViewport])

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
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 50 }}>
      {/* SVG polygon fills — behind labels */}
      <svg
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          pointerEvents: 'none',
        }}
      >
        {rooms.map((r, i) => {
          const pts = r.vpVerts.map(v => `${v.x},${v.y}`).join(' ')
          return (
            <polygon
              key={r.key}
              points={pts}
              fill={r._isLeaf ? FILL_COLORS[i % FILL_COLORS.length] : 'none'}
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
              position: 'absolute',
              left: r.cx,
              top: r.cy,
              zIndex: 2,
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
    </div>
  )
}
