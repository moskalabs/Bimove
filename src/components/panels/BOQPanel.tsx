import { useEffect, useState } from 'react'
import { useEditor } from '../../context/EditorContext'
import { getScaleConfig } from '../../lib/scaleConfig'
import { detectRooms } from '../../lib/roomDetection'
import { getBlock } from '../../lib/blockLibrary'
import { computeRelations, type RoomRelation } from '../../lib/relations'
import { loadPriceConfig, savePriceConfig, resetPriceConfig, computeQuote, fmtKRW, type PriceConfig } from '../../lib/priceConfig'
import { printQuotePdf } from '../../lib/quoteExport'
import { useProjectId } from '../../context/ProjectContext'
import { getProjects } from '../../lib/projectStore'
import { loadMaterialPresets, findMaterialByFill } from '../../lib/materialPresets'
import { POTablesTab } from './boq/POTablesTab'

type BOQ = {
  wallTotalLenMm: number
  wallCount: number
  doorCount: number
  windowCount: number
  rooms: { area: number; unit: string }[]
  blockCounts: { name: string; count: number; blockId?: string }[]
  wallsByMaterial?: { materialId: string; materialLabel: string; lenMm: number; pricePerM?: number }[]
}

function calcBOQ(editor: ReturnType<typeof useEditor>, useSelection = false): BOQ | null {
  if (!editor) return null

  const shapes = useSelection ? editor.getSelectedShapes() : editor.getCurrentPageShapes()
  const scale = getScaleConfig(editor)

  const walls = shapes.filter(s => s.type === 'wall')
  const doors = shapes.filter(s => s.type === 'door')
  const windows = shapes.filter(s => s.type === 'window')
  const blocks = shapes.filter(s => s.type === 'block')

  let wallTotalPx = 0
  const wallData: { x1: number; y1: number; x2: number; y2: number }[] = []
  // 자재별 벽 길이 집계
  const matBuckets = new Map<string, { label: string; lenPx: number; pricePerM?: number }>()
  loadMaterialPresets()  // ensure load (no-op)
  for (const w of walls) {
    const p = w.props as { x2: number; y2: number }
    const len = Math.sqrt(p.x2 ** 2 + p.y2 ** 2)
    wallTotalPx += len
    wallData.push({ x1: w.x, y1: w.y, x2: w.x + p.x2, y2: w.y + p.y2 })
    // 자재 lookup (meta.fill 기준)
    const meta = (w.meta ?? {}) as { fill?: string; materialId?: string }
    const material = meta.materialId ? loadMaterialPresets().find(m => m.id === meta.materialId) : findMaterialByFill(meta.fill)
    const key = material?.id ?? '_default'
    const label = material?.label ?? '기본'
    const cur = matBuckets.get(key) ?? { label, lenPx: 0, pricePerM: material?.pricePerM }
    cur.lenPx += len
    matBuckets.set(key, cur)
  }
  const wallTotalMm = wallTotalPx / scale.pxPerMm
  const wallsByMaterial = Array.from(matBuckets.entries()).map(([id, b]) => ({
    materialId: id,
    materialLabel: b.label,
    lenMm: b.lenPx / scale.pxPerMm,
    pricePerM: b.pricePerM,
  }))

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
    name: getBlock(id)?.name ?? id, count, blockId: id,
  }))

  return { wallTotalLenMm: wallTotalMm, wallCount: walls.length, doorCount: doors.length, windowCount: windows.length, rooms, blockCounts, wallsByMaterial }
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
  const [tab, setTab] = useState<'boq' | 'quote' | 'rel' | 'po'>('boq')
  const [priceConfig, setPriceConfig] = useState<PriceConfig>(() => loadPriceConfig())
  const [showPriceEdit, setShowPriceEdit] = useState(false)
  const [scope, setScope] = useState<'all' | 'selection'>('all')
  const [selectedCount, setSelectedCount] = useState(0)
  const quote = boq ? computeQuote(boq, priceConfig) : null
  const projectId = useProjectId()
  const projectName = projectId ? (getProjects().find(p => p.id === projectId)?.name ?? '프로젝트') : '프로젝트'

  useEffect(() => {
    if (!editor) return
    const update = () => {
      setBoq(calcBOQ(editor, scope === 'selection'))
      setRelations(computeRelations(editor))
      setSelectedCount(editor.getSelectedShapes().length)
    }
    update()
    const unsub = editor.store.listen(update)
    return unsub
  }, [editor, scope])

  return (
    <div className="lbar-panel">
      <div className="lbar-panel-header">물량표 / 관계</div>

      {/* tab switcher */}
      <div style={{ display: 'flex', borderBottom: '1px solid #eee' }}>
        {(['boq', 'quote', 'rel', 'po'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '6px 0', fontSize: 11, border: 'none', cursor: 'pointer',
            background: tab === t ? '#f0f4ff' : 'transparent',
            color: tab === t ? '#1a73e8' : '#666',
            borderBottom: tab === t ? '2px solid #1a73e8' : '2px solid transparent',
          }}>
            {t === 'boq' ? '물량' : t === 'quote' ? '견적' : t === 'rel' ? '관계' : '발주서'}
          </button>
        ))}
      </div>

      {/* scope toggle (BOQ/Quote 탭에서만) */}
      {(tab === 'boq' || tab === 'quote') && (
        <div style={{ display: 'flex', gap: 4, padding: '6px 16px', borderBottom: '1px solid #f0f0f0', fontSize: 11 }}>
          <button onClick={() => setScope('all')} style={{
            padding: '3px 10px', borderRadius: 12, fontSize: 11, cursor: 'pointer',
            background: scope === 'all' ? '#1a73e8' : '#f5f5f5',
            color: scope === 'all' ? '#fff' : '#666',
            border: 'none',
          }}>전체</button>
          <button onClick={() => setScope('selection')} disabled={selectedCount === 0} style={{
            padding: '3px 10px', borderRadius: 12, fontSize: 11,
            cursor: selectedCount > 0 ? 'pointer' : 'not-allowed',
            background: scope === 'selection' ? '#1a73e8' : '#f5f5f5',
            color: scope === 'selection' ? '#fff' : '#888',
            border: 'none',
            opacity: selectedCount === 0 ? 0.5 : 1,
          }}>선택 ({selectedCount})</button>
        </div>
      )}

      <div className="lbar-panel-body" style={{ fontSize: 13 }}>
        {tab === 'po' ? (
          <POTablesTab />
        ) : tab === 'boq' ? (
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
        ) : tab === 'quote' ? (
          !quote || quote.lines.length === 0 ? (
            <div style={{ color: '#999', padding: 16 }}>도면을 그리면 견적이 자동 계산됩니다.</div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 16px', gap: 6 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>견적 자동 산출</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => setShowPriceEdit(true)} style={{
                    padding: '4px 10px', border: '1px solid #ccc', borderRadius: 6,
                    background: '#f5f5f5', cursor: 'pointer', fontSize: 11,
                  }}>단가 편집</button>
                  <button onClick={() => {
                    if (!quote) return
                    const includeVat = confirm('부가세(10%) 포함할까?')
                    printQuotePdf(quote.lines, {
                      projectName,
                      overheadRate: 0.05,
                      vatRate: includeVat ? 0.10 : 0,
                    })
                  }} style={{
                    padding: '4px 10px', border: 'none', borderRadius: 6,
                    background: '#1a73e8', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                  }}>📄 PDF</button>
                </div>
              </div>
              <div style={{ padding: '0 12px' }}>
                {quote.lines.map((l, i) => (
                  <div key={i} style={{
                    padding: '8px 0',
                    borderBottom: '1px solid #f0f0f0',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
                      <span style={{ fontWeight: 500, color: '#333', fontSize: 12 }}>{l.name}</span>
                      <span style={{ fontWeight: 600, color: '#333', fontSize: 12, whiteSpace: 'nowrap' }}>{fmtKRW(l.amount)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888' }}>
                      <span>{l.qty.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} {l.unit}</span>
                      <span>@{fmtKRW(l.unitPrice)}</span>
                    </div>
                  </div>
                ))}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 0', borderTop: '2px solid #1a73e8', marginTop: 4,
                  fontWeight: 700, fontSize: 13,
                }}>
                  <span style={{ color: '#333' }}>합계</span>
                  <span style={{ color: '#1a73e8' }}>{fmtKRW(quote.total)}</span>
                </div>
              </div>
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

      {showPriceEdit && (
        <PriceEditModal
          config={priceConfig}
          onSave={(next) => { setPriceConfig(next); savePriceConfig(next); setShowPriceEdit(false) }}
          onReset={() => setPriceConfig(resetPriceConfig())}
          onClose={() => setShowPriceEdit(false)}
        />
      )}
    </div>
  )
}

// ───── 단가 편집 모달 ─────

function PriceEditModal({ config, onSave, onReset, onClose }: {
  config: PriceConfig
  onSave: (next: PriceConfig) => void
  onReset: () => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<PriceConfig>(() => ({ ...config, blocks: { ...config.blocks } }))

  const setField = (key: keyof Omit<PriceConfig, 'blocks'>, value: number) => {
    setDraft(d => ({ ...d, [key]: value }))
  }
  const setBlock = (id: string, value: number) => {
    setDraft(d => ({ ...d, blocks: { ...d.blocks, [id]: value } }))
  }

  const rows: { label: string; key: keyof Omit<PriceConfig, 'blocks'>; unit: string }[] = [
    { label: '벽체', key: 'wallPerM', unit: '₩/m' },
    { label: '문', key: 'doorPerEa', unit: '₩/개' },
    { label: '창문', key: 'windowPerEa', unit: '₩/개' },
    { label: '바닥 마감', key: 'floorPerM2', unit: '₩/m²' },
    { label: '천장 마감', key: 'ceilingPerM2', unit: '₩/m²' },
  ]

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: 20, minWidth: 420, maxHeight: '80vh',
        overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, flex: 1 }}>💰 단가 편집</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>

        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}><tbody>
          {rows.map(r => (
            <tr key={r.key}>
              <td style={{ padding: '6px 0' }}>{r.label}</td>
              <td style={{ padding: 6 }}>
                <input
                  type="number" min={0}
                  value={draft[r.key]}
                  onChange={e => setField(r.key, Number(e.target.value) || 0)}
                  style={{ width: '100%', padding: 4, fontSize: 13, textAlign: 'right' }}
                />
              </td>
              <td style={{ padding: 6, color: '#888', fontSize: 11 }}>{r.unit}</td>
            </tr>
          ))}
        </tbody></table>

        {Object.keys(draft.blocks).length > 0 && (
          <>
            <h4 style={{ marginTop: 16, marginBottom: 8, fontSize: 13 }}>가구·집기</h4>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}><tbody>
              {Object.entries(draft.blocks).map(([id, price]) => (
                <tr key={id}>
                  <td style={{ padding: '6px 0' }}>{id}</td>
                  <td style={{ padding: 6 }}>
                    <input
                      type="number" min={0}
                      value={price}
                      onChange={e => setBlock(id, Number(e.target.value) || 0)}
                      style={{ width: '100%', padding: 4, fontSize: 13, textAlign: 'right' }}
                    />
                  </td>
                  <td style={{ padding: 6, color: '#888', fontSize: 11 }}>₩/개</td>
                </tr>
              ))}
            </tbody></table>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button onClick={onReset} style={{ padding: '6px 12px', border: '1px solid #ccc', borderRadius: 6, background: '#f5f5f5', cursor: 'pointer' }}>기본값</button>
          <button onClick={onClose} style={{ padding: '6px 12px', border: '1px solid #ccc', borderRadius: 6, background: '#f5f5f5', cursor: 'pointer' }}>취소</button>
          <button onClick={() => onSave(draft)} style={{ padding: '6px 12px', border: 'none', borderRadius: 6, background: '#1a73e8', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>저장</button>
        </div>
      </div>
    </div>
  )
}
