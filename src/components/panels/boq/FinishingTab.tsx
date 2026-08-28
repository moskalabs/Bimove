// 마감재 Tables 탭 — 카테고리 트리 + 자재별 상세 물량표
import { useState, useEffect, useCallback } from 'react'
import { ChevronRight, ChevronDown, Plus, Upload, MoreHorizontal, Trash2, Pencil } from 'lucide-react'
import { startAreaMeasure } from '../../../lib/drawingState'
import { useProjectId } from '../../../context/ProjectContext'
import {
  loadFinishingData, saveFinishingData,
  createVariant, uid,
  wallAreaM2, sumFloorArea, sumWallArea, sumTotalArea,
  calcSheetQty, calcRollQty,
  paintVolumeL, sumPaintVolume, calcPaintContainers,
  type FinishingTablesData, type FinishingCategory, type FinishingItem,
  type MaterialVariant, type ZoneRow,
} from '../../../lib/finishingData'

// ── 카테고리 트리 ──

function CategoryTree({
  categories, selectedItemId, onSelect, onToggle,
}: {
  categories: FinishingCategory[]
  selectedItemId: string | null
  onSelect: (itemId: string) => void
  onToggle: (catKey: string) => void
}) {
  return (
    <div className="ft-tree">
      {categories.map(cat => (
        <div key={cat.key}>
          <div
            className="ft-tree-cat"
            onClick={() => onToggle(cat.key)}
          >
            {cat.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>{cat.label}</span>
          </div>
          {cat.expanded && cat.items.map(item => (
            <div
              key={item.id}
              className={`ft-tree-item${selectedItemId === item.id ? ' active' : ''}`}
              onClick={() => onSelect(item.id)}
            >
              {item.label}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ── 구역 행 편집 컴포넌트 ──

function ZoneInput({ value, onChange, width }: {
  value: string | number
  onChange: (v: string) => void
  width?: number
}) {
  return (
    <input
      className="ft-zone-input"
      value={value}
      onChange={e => onChange(e.target.value)}
      style={width ? { width } : undefined}
    />
  )
}

// ── 평면 물량표 ──

function FloorTable({ item, variant, onUpdate }: {
  item: FinishingItem
  variant: MaterialVariant
  onUpdate: (zones: ZoneRow[]) => void
}) {
  const isPaint = item.calcType === 'paint'

  const updateZone = (idx: number, patch: Partial<ZoneRow>) => {
    const next = variant.zones.map((z, i) => i === idx ? { ...z, ...patch } : z)
    onUpdate(next)
  }
  const addZone = () => onUpdate([...variant.zones, { id: uid(), label: '', floorAreaM2: 0, wallLengthM: 0, wallHeightM: 2.4 }])
  const removeZone = (idx: number) => onUpdate(variant.zones.filter((_, i) => i !== idx))

  /** 펜 클릭 → 면적 측정 모드 (면적 + 둘레 자동 계산) */
  const handleMeasure = (idx: number) => {
    startAreaMeasure(({ areaM2, perimeterM }) => {
      updateZone(idx, { floorAreaM2: areaM2, wallLengthM: perimeterM })
    })
  }

  return (
    <div className="ft-section">
      <div className="ft-section-title">물량표 평면</div>
      <table className="ft-table">
        <thead>
          <tr>
            <th>구역/공간</th>
            <th>면적(m²)</th>
            {isPaint && <th>도포 횟수</th>}
            {isPaint && <th>필요 용량(L)</th>}
            <th style={{ width: 52 }}></th>
          </tr>
        </thead>
        <tbody>
          {variant.zones.map((z, i) => (
            <tr key={z.id}>
              <td>
                <ZoneInput value={z.label} onChange={v => updateZone(i, { label: v })} />
              </td>
              <td>
                <ZoneInput value={z.floorAreaM2 || ''} onChange={v => updateZone(i, { floorAreaM2: parseFloat(v) || 0 })} width={60} />
              </td>
              {isPaint && (
                <td>
                  <select
                    className="ft-zone-select"
                    value={z.coatCount ?? 2}
                    onChange={e => updateZone(i, { coatCount: parseInt(e.target.value) })}
                  >
                    {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </td>
              )}
              {isPaint && (
                <td className="ft-num">{paintVolumeL(z, item.coverageM2PerL ?? 8, 'floor')}</td>
              )}
              <td className="ft-row-actions">
                <button
                  className="ft-measure-btn"
                  onClick={() => handleMeasure(i)}
                  title="도면에서 면적 측정"
                >
                  <Pencil size={12} />
                </button>
                <button className="ft-row-del" onClick={() => removeZone(i)}><Trash2 size={12} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="ft-add-row" onClick={addZone}>+ 행 추가</button>
    </div>
  )
}

// ── 벽면 물량표 ──

function WallTable({ item, variant, onUpdate }: {
  item: FinishingItem
  variant: MaterialVariant
  onUpdate: (zones: ZoneRow[]) => void
}) {
  const isPaint = item.calcType === 'paint'

  const updateZone = (idx: number, patch: Partial<ZoneRow>) => {
    const next = variant.zones.map((z, i) => i === idx ? { ...z, ...patch } : z)
    onUpdate(next)
  }

  return (
    <div className="ft-section">
      <div className="ft-section-title">물량표 벽면</div>
      <table className="ft-table">
        <thead>
          <tr>
            <th>구역/공간</th>
            <th>벽 길이(m)</th>
            <th>적용 높이(m)</th>
            {isPaint && <th>도포 횟수</th>}
            <th>{isPaint ? '필요 용량(L)' : '면적(m²)'}</th>
          </tr>
        </thead>
        <tbody>
          {variant.zones.map((z, i) => (
            <tr key={z.id}>
              <td className="ft-zone-label">{z.label || `구역 ${i + 1}`}</td>
              <td>
                <ZoneInput value={z.wallLengthM || ''} onChange={v => updateZone(i, { wallLengthM: parseFloat(v) || 0 })} width={55} />
              </td>
              <td>
                <ZoneInput value={z.wallHeightM || ''} onChange={v => updateZone(i, { wallHeightM: parseFloat(v) || 0 })} width={40} />
              </td>
              {isPaint && (
                <td>
                  <select
                    className="ft-zone-select"
                    value={z.coatCount ?? 2}
                    onChange={e => updateZone(i, { coatCount: parseInt(e.target.value) })}
                  >
                    {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </td>
              )}
              <td className="ft-num">
                {isPaint
                  ? paintVolumeL(z, item.coverageM2PerL ?? 8, 'wall')
                  : wallAreaM2(z).toFixed(2)
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── 합계 섹션 ──

function TotalSection({ item, variant, onSpecEdit }: {
  item: FinishingItem; variant: MaterialVariant; onSpecEdit?: () => void
}) {
  const isPaint = item.calcType === 'paint'
  const [containerSize, setContainerSize] = useState(item.containerSizes?.[item.containerSizes.length - 1] ?? 18)

  const specNote = (
    <div className="ft-spec-row">
      <div className="ft-spec-note">
        <span className="ft-spec-icon">ℹ</span>
        <span>기본 규격 : {item.specLabel ?? ''}</span>
      </div>
      <button className="ft-spec-edit-btn" onClick={onSpecEdit}>자재 규격 수정 ⚙</button>
    </div>
  )

  // ── 도장 ──
  if (isPaint) {
    const totalVolume = sumPaintVolume(variant, item.coverageM2PerL ?? 8)
    const totalArea = sumTotalArea(variant)
    const containers = calcPaintContainers(totalVolume, containerSize)

    return (
      <div className="ft-total">
        <div className="ft-section-title">합계</div>
        <table className="ft-table ft-total-table">
          <thead><tr>
            <th>총 면적(m²)</th><th>총 필요 용량(L)</th><th>발주 용량 선택</th><th>발주 수량</th>
          </tr></thead>
          <tbody><tr>
            <td className="ft-num">{totalArea.toFixed(2)}</td>
            <td className="ft-num">{totalVolume.toFixed(2)}</td>
            <td>
              <select className="ft-zone-select" value={containerSize} onChange={e => setContainerSize(parseInt(e.target.value))}>
                {(item.containerSizes ?? [1, 4, 18]).map(s => <option key={s} value={s}>{s} L</option>)}
              </select>
            </td>
            <td className="ft-num ft-bold">{containers}</td>
          </tr></tbody>
        </table>
        {specNote}
      </div>
    )
  }

  // ── 바닥 전용 (마루 등) ──
  if (item.floorOnly) {
    const floorA = sumFloorArea(variant)
    const lossPercent = Math.round(item.lossRate * 100)
    const lossApplied = +(floorA * (1 + item.lossRate)).toFixed(2)
    const qty = calcSheetQty(item, variant)

    return (
      <div className="ft-total">
        <div className="ft-section-title">합계</div>
        <table className="ft-table ft-total-table">
          <thead><tr>
            <th>총 면적(m²)</th><th>로스(%)</th><th>로스 적용면적(m²)</th><th>발주 수량({item.unit})</th>
          </tr></thead>
          <tbody><tr>
            <td className="ft-num">{floorA.toFixed(1)}</td>
            <td>
              <select className="ft-zone-select" value={lossPercent} disabled>
                <option value={lossPercent}>{lossPercent}</option>
              </select>
            </td>
            <td className="ft-num">{lossApplied.toFixed(2)}</td>
            <td className="ft-num ft-bold">{qty}</td>
          </tr></tbody>
        </table>
        {specNote}
      </div>
    )
  }

  // ── 일반 (석고보드, 타일, 도배 등) ──
  const floorA = sumFloorArea(variant)
  const wallA = sumWallArea(variant)
  const totalA = floorA + wallA
  const qty = item.calcType === 'roll' ? calcRollQty(item, variant) : calcSheetQty(item, variant)

  return (
    <div className="ft-total">
      <div className="ft-section-title">합계</div>
      <table className="ft-table ft-total-table">
        <thead><tr>
          <th>평면 면적(m²)</th><th>벽면 면적(m²)</th><th>총 시공면적(m²)</th><th>로스(%)</th><th>발주 수량({item.unit})</th>
        </tr></thead>
        <tbody><tr>
          <td className="ft-num">{floorA.toFixed(1)}</td>
          <td className="ft-num">{wallA.toFixed(2)}</td>
          <td className="ft-num">{totalA.toFixed(2)}</td>
          <td>
            <select className="ft-zone-select" value={Math.round(item.lossRate * 100)} disabled>
              <option>{Math.round(item.lossRate * 100)}</option>
            </select>
          </td>
          <td className="ft-num ft-bold">{qty}</td>
        </tr></tbody>
      </table>
      {specNote}
    </div>
  )
}

// ── 자재 규격 수정 모달 ──

function SpecEditModal({ item, onSave, onClose }: {
  item: FinishingItem
  onSave: (patch: Partial<FinishingItem>) => void
  onClose: () => void
}) {
  const [boxAreaM2, setBoxAreaM2] = useState(item.boxAreaM2 ?? 0)
  const [rollAreaM2, setRollAreaM2] = useState(item.rollAreaM2 ?? 0)
  const [coverageM2PerL, setCoverageM2PerL] = useState(item.coverageM2PerL ?? 8)
  const [lossRate, setLossRate] = useState(Math.round(item.lossRate * 100))
  const [unit, setUnit] = useState(item.unit)
  const [specLabel, setSpecLabel] = useState(item.specLabel ?? '')
  const [itemWidthMm, setItemWidthMm] = useState(item.itemWidthMm ?? 0)
  const [itemLengthMm, setItemLengthMm] = useState(item.itemLengthMm ?? 0)

  const handleSave = () => {
    const patch: Partial<FinishingItem> = {
      lossRate: lossRate / 100,
      unit,
      specLabel,
    }
    if (item.calcType === 'sheet') {
      patch.boxAreaM2 = boxAreaM2
      patch.itemWidthMm = itemWidthMm
      patch.itemLengthMm = itemLengthMm
    } else if (item.calcType === 'roll') {
      patch.rollAreaM2 = rollAreaM2
    } else if (item.calcType === 'paint') {
      patch.coverageM2PerL = coverageM2PerL
    }
    onSave(patch)
    onClose()
  }

  return (
    <div className="ft-spec-overlay" onClick={onClose}>
      <div className="ft-spec-modal" onClick={e => e.stopPropagation()}>
        <div className="ft-spec-modal-title">자재 규격 수정 - {item.label}</div>

        <div className="ft-spec-modal-body">
          {/* sheet 타입: 박스/매 면적 */}
          {item.calcType === 'sheet' && (
            <>
              <label className="ft-spec-field">
                <span>자재 규격 (가로 mm)</span>
                <input type="number" value={itemWidthMm || ''} onChange={e => setItemWidthMm(parseFloat(e.target.value) || 0)} />
              </label>
              <label className="ft-spec-field">
                <span>자재 규격 (세로 mm)</span>
                <input type="number" value={itemLengthMm || ''} onChange={e => setItemLengthMm(parseFloat(e.target.value) || 0)} />
              </label>
              <label className="ft-spec-field">
                <span>단위 면적 (m²/{unit})</span>
                <input type="number" step="0.01" value={boxAreaM2 || ''} onChange={e => setBoxAreaM2(parseFloat(e.target.value) || 0)} />
              </label>
            </>
          )}

          {/* roll 타입: 롤당 면적 */}
          {item.calcType === 'roll' && (
            <label className="ft-spec-field">
              <span>롤당 면적 (m²/롤)</span>
              <input type="number" step="0.01" value={rollAreaM2 || ''} onChange={e => setRollAreaM2(parseFloat(e.target.value) || 0)} />
            </label>
          )}

          {/* paint 타입: 도포율 */}
          {item.calcType === 'paint' && (
            <label className="ft-spec-field">
              <span>도포율 (m²/L)</span>
              <input type="number" step="0.1" value={coverageM2PerL || ''} onChange={e => setCoverageM2PerL(parseFloat(e.target.value) || 0)} />
            </label>
          )}

          {/* 공통: 로스율, 단위, 규격 설명 */}
          <label className="ft-spec-field">
            <span>로스율 (%)</span>
            <input type="number" step="1" value={lossRate} onChange={e => setLossRate(parseInt(e.target.value) || 0)} />
          </label>
          <label className="ft-spec-field">
            <span>단위</span>
            <input type="text" value={unit} onChange={e => setUnit(e.target.value)} />
          </label>
          <label className="ft-spec-field">
            <span>규격 설명</span>
            <input type="text" value={specLabel} onChange={e => setSpecLabel(e.target.value)} />
          </label>
        </div>

        <div className="ft-spec-modal-actions">
          <button className="ft-spec-cancel" onClick={onClose}>취소</button>
          <button className="ft-spec-save" onClick={handleSave}>저장</button>
        </div>
      </div>
    </div>
  )
}

// ── 자재 상세 뷰 ──

function MaterialDetail({
  item, onUpdate,
}: {
  item: FinishingItem
  onUpdate: (item: FinishingItem) => void
}) {
  const [activeTab, setActiveTab] = useState(0)
  const [showSpecEdit, setShowSpecEdit] = useState(false)
  const variant = item.variants[activeTab] ?? item.variants[0]
  if (!variant) return null

  const updateZones = (zones: ZoneRow[]) => {
    const nextVariants = item.variants.map((v, i) =>
      i === activeTab ? { ...v, zones } : v
    )
    onUpdate({ ...item, variants: nextVariants })
  }

  const addVariant = () => {
    const num = item.variants.length + 1
    const label = item.calcType === 'paint'
      ? `${item.label} ${String.fromCharCode(64 + num)}`
      : `${item.label} ${num}`
    onUpdate({ ...item, variants: [...item.variants, createVariant(label)] })
    setActiveTab(item.variants.length)
  }

  const deleteVariant = (idx: number) => {
    if (item.variants.length <= 1) return
    const next = item.variants.filter((_, i) => i !== idx)
    onUpdate({ ...item, variants: next })
    if (activeTab >= next.length) setActiveTab(next.length - 1)
  }

  return (
    <div className="ft-detail">
      <div className="ft-detail-header">
        <span className="ft-detail-title">마감재</span>
        <div className="ft-detail-actions">
          <button className="ft-icon-btn" title="내보내기"><Upload size={14} /></button>
          <button className="ft-icon-btn" title="더보기"><MoreHorizontal size={14} /></button>
        </div>
      </div>

      {/* 변형 탭 */}
      <div className="ft-variant-tabs">
        {item.variants.map((v, i) => (
          <div
            key={v.id}
            className={`ft-variant-tab${i === activeTab ? ' active' : ''}`}
            onClick={() => setActiveTab(i)}
          >
            {v.label}
            {item.variants.length > 1 && i === activeTab && (
              <button
                className="ft-variant-del"
                onClick={e => { e.stopPropagation(); deleteVariant(i) }}
              >
                <Trash2 size={10} />
              </button>
            )}
          </div>
        ))}
        <button className="ft-variant-add" onClick={addVariant}><Plus size={14} /></button>
      </div>

      {/* 물량표 평면 + 벽면 */}
      <div className="ft-tables-scroll">
        <FloorTable item={item} variant={variant} onUpdate={updateZones} />
        {!item.floorOnly && (
          <WallTable item={item} variant={variant} onUpdate={updateZones} />
        )}
        <TotalSection item={item} variant={variant} onSpecEdit={() => setShowSpecEdit(true)} />
      </div>

      {showSpecEdit && (
        <SpecEditModal
          item={item}
          onSave={patch => onUpdate({ ...item, ...patch })}
          onClose={() => setShowSpecEdit(false)}
        />
      )}
    </div>
  )
}

// ── 메인 탭 ──

export function FinishingTab() {
  const projectId = useProjectId()
  const [data, setData] = useState<FinishingTablesData>(() =>
    loadFinishingData(projectId ?? '')
  )
  const [selectedItemId, setSelectedItemId] = useState<string | null>(
    data.categories[0]?.items[0]?.id ?? null
  )

  // 자동 저장
  useEffect(() => {
    if (projectId) saveFinishingData(projectId, data)
  }, [data, projectId])

  const toggleCategory = useCallback((catKey: string) => {
    setData(prev => ({
      ...prev,
      categories: prev.categories.map(c =>
        c.key === catKey ? { ...c, expanded: !c.expanded } : c
      ),
    }))
  }, [])

  // 선택된 아이템 찾기
  const selectedItem = data.categories
    .flatMap(c => c.items)
    .find(i => i.id === selectedItemId) ?? null

  const updateItem = useCallback((updated: FinishingItem) => {
    setData(prev => ({
      ...prev,
      categories: prev.categories.map(cat => ({
        ...cat,
        items: cat.items.map(i => i.id === updated.id ? updated : i),
      })),
    }))
  }, [])

  return (
    <div className="ft-container">
      <CategoryTree
        categories={data.categories}
        selectedItemId={selectedItemId}
        onSelect={setSelectedItemId}
        onToggle={toggleCategory}
      />

      {selectedItem ? (
        <MaterialDetail item={selectedItem} onUpdate={updateItem} />
      ) : (
        <div className="ft-empty">좌측에서 마감재를 선택하세요</div>
      )}
    </div>
  )
}
