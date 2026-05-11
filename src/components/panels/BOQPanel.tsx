import { useEffect, useState } from 'react'
import { useEditor } from '../../context/EditorContext'
import { getScaleConfig } from '../../lib/scaleConfig'
import { detectRooms } from '../../lib/roomDetection'
import { getBlock } from '../../lib/blockLibrary'

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

  // Wall total length
  let wallTotalPx = 0
  const wallData: { x1: number; y1: number; x2: number; y2: number }[] = []
  for (const w of walls) {
    const p = w.props as { x2: number; y2: number }
    const len = Math.sqrt(p.x2 ** 2 + p.y2 ** 2)
    wallTotalPx += len
    wallData.push({ x1: w.x, y1: w.y, x2: w.x + p.x2, y2: w.y + p.y2 })
  }
  const wallTotalMm = wallTotalPx / scale.pxPerMm

  // Room areas
  const detectedRooms = detectRooms(wallData)
  const rooms = detectedRooms.map(r => {
    const areaMm2 = r.area / (scale.pxPerMm ** 2)
    const areaM2 = areaMm2 / 1_000_000
    return { area: areaM2, unit: 'm²' }
  })

  // Block counts
  const blockMap: Record<string, number> = {}
  for (const b of blocks) {
    const id = (b.props as { blockId: string }).blockId
    blockMap[id] = (blockMap[id] ?? 0) + 1
  }
  const blockCounts = Object.entries(blockMap).map(([id, count]) => ({
    name: getBlock(id)?.name ?? id,
    count,
  }))

  return {
    wallTotalLenMm: wallTotalMm,
    wallCount: walls.length,
    doorCount: doors.length,
    windowCount: windows.length,
    rooms,
    blockCounts,
  }
}

function fmtLen(mm: number): string {
  if (mm >= 1000) return `${(mm / 1000).toFixed(2)} m`
  if (mm >= 10) return `${(mm / 10).toFixed(1)} cm`
  return `${Math.round(mm)} mm`
}

export function BOQPanel() {
  const editor = useEditor()
  const [boq, setBoq] = useState<BOQ | null>(null)

  useEffect(() => {
    if (!editor) return
    const update = () => setBoq(calcBOQ(editor))
    update()
    const unsub = editor.store.listen(update)
    return unsub
  }, [editor])

  return (
    <div className="lbar-panel">
      <div className="lbar-panel-header">물량표 (BOQ)</div>
      <div className="lbar-panel-body" style={{ fontSize: 13 }}>
        {!boq || (boq.wallCount === 0) ? (
          <div style={{ color: '#999', padding: 16 }}>도면을 그리면 자동으로 산출됩니다.</div>
        ) : (
          <>
            {/* 구조체 */}
            <div className="boq-section-title">구조체</div>
            <table className="boq-table">
              <tbody>
                <tr><td>벽</td><td>{boq.wallCount}개</td><td>{fmtLen(boq.wallTotalLenMm)}</td></tr>
                {boq.doorCount > 0 && <tr><td>문</td><td>{boq.doorCount}개</td><td></td></tr>}
                {boq.windowCount > 0 && <tr><td>창문</td><td>{boq.windowCount}개</td><td></td></tr>}
              </tbody>
            </table>

            {/* 공간 */}
            {boq.rooms.length > 0 && (
              <>
                <div className="boq-section-title">공간</div>
                <table className="boq-table">
                  <tbody>
                    {boq.rooms.map((r, i) => (
                      <tr key={i}>
                        <td>공간 {i + 1}</td>
                        <td colSpan={2}>{r.area.toFixed(2)} {r.unit}</td>
                      </tr>
                    ))}
                    <tr className="boq-total">
                      <td>합계</td>
                      <td colSpan={2}>{boq.rooms.reduce((a, r) => a + r.area, 0).toFixed(2)} m²</td>
                    </tr>
                  </tbody>
                </table>
              </>
            )}

            {/* 블록 */}
            {boq.blockCounts.length > 0 && (
              <>
                <div className="boq-section-title">가구·집기</div>
                <table className="boq-table">
                  <tbody>
                    {boq.blockCounts.map(b => (
                      <tr key={b.name}><td>{b.name}</td><td>{b.count}개</td><td></td></tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
