import { useEffect, useState } from 'react'
import { useEditor } from '../../context/EditorContext'
import { getScaleConfig } from '../../lib/scaleConfig'
import { detectRooms } from '../../lib/roomDetection'
import { getBlock } from '../../lib/blockLibrary'
import { computeRelations, type RoomRelation } from '../../lib/relations'

type BOQ = {
  wallTotalLenMm: number
  wallCount: number
  doorCount: number
  windowCount: number
  rooms: { area: number; unit: string }[]
  blockCounts: { name: string; count: number }[]
}

function calcBOQ(editor: ReturnType<typeof useEditor>): BOQ | null {
  if (!editor) return null

  const shapes = editor.getCurrentPageShapes()
  const scale = getScaleConfig(editor)

  const walls = shapes.filter(s => s.type === 'wall')
  const doors = shapes.filter(s => s.type === 'door')
  const windows = shapes.filter(s => s.type === 'window')
  const blocks = shapes.filter(s => s.type === 'block')

  let wallTotalPx = 0
  const wallData: { x1: number; y1: number; x2: number; y2: number }[] = []
  for (const w of walls) {
    const p = w.props as { x2: number; y2: number }
    const len = Math.sqrt(p.x2 ** 2 + p.y2 ** 2)
    wallTotalPx += len
    wallData.push({ x1: w.x, y1: w.y, x2: w.x + p.x2, y2: w.y + p.y2 })
  }
  const wallTotalMm = wallTotalPx / scale.pxPerMm

  const detectedRooms = detectRooms(wallData)
  const rooms = detectedRooms.map(r => {
    const areaM2 = r.area / (scale.pxPerMm ** 2) / 1_000_000
    return { area: areaM2, unit: 'm²' }
  })

  const blockMap: Record<string, number> = {}
  for (const b of blocks) {
    const id = (b.props as { blockId: string }).blockId
    blockMap[id] = (blockMap[id] ?? 0) + 1
  }
  const blockCounts = Object.entries(blockMap).map(([id, count]) => ({
    name: getBlock(id)?.name ?? id, count,
  }))

  return { wallTotalLenMm: wallTotalMm, wallCount: walls.length, doorCount: doors.length, windowCount: windows.length, rooms, blockCounts }
}

function fmtLen(mm: number): string {
  if (mm >= 1000) return `${(mm / 1000).toFixed(2)} m`
  if (mm >= 10) return `${(mm / 10).toFixed(1)} cm`
  return `${Math.round(mm)} mm`
}

export function BOQPanel() {
  const editor = useEditor()
  const [boq, setBoq] = useState<BOQ | null>(null)
  const [relations, setRelations] = useState<RoomRelation[]>([])
  const [tab, setTab] = useState<'boq' | 'rel'>('boq')

  useEffect(() => {
    if (!editor) return
    const update = () => {
      setBoq(calcBOQ(editor))
      setRelations(computeRelations(editor))
    }
    update()
    const unsub = editor.store.listen(update)
    return unsub
  }, [editor])

  return (
    <div className="lbar-panel">
      <div className="lbar-panel-header">물량표 / 관계</div>

      {/* tab switcher */}
      <div style={{ display: 'flex', borderBottom: '1px solid #eee' }}>
        {(['boq', 'rel'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '6px 0', fontSize: 12, border: 'none', cursor: 'pointer',
            background: tab === t ? '#f0f4ff' : 'transparent',
            color: tab === t ? '#1a73e8' : '#666',
            borderBottom: tab === t ? '2px solid #1a73e8' : '2px solid transparent',
          }}>
            {t === 'boq' ? '물량표' : '관계 정의'}
          </button>
        ))}
      </div>

      <div className="lbar-panel-body" style={{ fontSize: 13 }}>
        {tab === 'boq' ? (
          !boq || boq.wallCount === 0 ? (
            <div style={{ color: '#999', padding: 16 }}>도면을 그리면 자동으로 산출됩니다.</div>
          ) : (
            <>
              <div className="boq-section-title">구조체</div>
              <table className="boq-table"><tbody>
                <tr><td>벽</td><td>{boq.wallCount}개</td><td>{fmtLen(boq.wallTotalLenMm)}</td></tr>
                {boq.doorCount > 0 && <tr><td>문</td><td>{boq.doorCount}개</td><td></td></tr>}
                {boq.windowCount > 0 && <tr><td>창문</td><td>{boq.windowCount}개</td><td></td></tr>}
              </tbody></table>

              {boq.rooms.length > 0 && <>
                <div className="boq-section-title">공간</div>
                <table className="boq-table"><tbody>
                  {boq.rooms.map((r, i) => (
                    <tr key={i}><td>공간 {i + 1}</td><td colSpan={2}>{r.area.toFixed(2)} {r.unit}</td></tr>
                  ))}
                  <tr className="boq-total">
                    <td>합계</td>
                    <td colSpan={2}>{boq.rooms.reduce((a, r) => a + r.area, 0).toFixed(2)} m²</td>
                  </tr>
                </tbody></table>
              </>}

              {boq.blockCounts.length > 0 && <>
                <div className="boq-section-title">가구·집기</div>
                <table className="boq-table"><tbody>
                  {boq.blockCounts.map(b => (
                    <tr key={b.name}><td>{b.name}</td><td>{b.count}개</td><td></td></tr>
                  ))}
                </tbody></table>
              </>}
            </>
          )
        ) : (
          relations.length === 0 ? (
            <div style={{ color: '#999', padding: 16 }}>닫힌 공간을 그리면 관계가 표시됩니다.</div>
          ) : (
            relations.map(r => (
              <div key={r.index} style={{ borderBottom: '1px solid #f0f0f0', padding: '10px 16px' }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  공간 {r.index} — {r.areaM2.toFixed(2)} m²
                </div>
                {r.openings.length > 0 && (
                  <div style={{ color: '#555', marginBottom: 2 }}>
                    개구부: {r.openings.map(o => o.name).join(', ')}
                  </div>
                )}
                {r.furniture.length > 0 && (
                  <div style={{ color: '#777' }}>
                    가구: {r.furniture.map(f => f.name).join(', ')}
                  </div>
                )}
                {r.openings.length === 0 && r.furniture.length === 0 && (
                  <div style={{ color: '#bbb', fontSize: 12 }}>개구부·가구 없음</div>
                )}
              </div>
            ))
          )
        )}
      </div>
    </div>
  )
}
