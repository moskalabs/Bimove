// 마감재 Tables 탭 — 카테고리 트리 + 자재별 상세 물량표
import { useState, useEffect, useCallback } from 'react'
import { ChevronRight, ChevronDown, Plus, Upload, MoreHorizontal, Trash2, Pencil } from 'lucide-react'
import { useProjectId } from '../../../context/ProjectContext'
import {
  loadFinishingData, saveFinishingData,
  createVariant, uid,
  wallAreaM2, sumFloorArea, sumWallArea, sumTotalArea,
  calcSheetQty, calcRollQty,
  paintVolumeL, sumPaintVolume, calcPaintContainers, sheetAreaM2,
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
            <th style={{ width: 28 }}></th>
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
              <td>
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

function TotalSection({ item, variant }: { item: FinishingItem; variant: MaterialVariant }) {
  const isPaint = item.calcType === 'paint'
  const [containerSize, setContainerSize] = useState(item.containerSizes?.[item.containerSizes.length - 1] ?? 18)

  if (isPaint) {
    const totalVolume = sumPaintVolume(variant, item.coverageM2PerL ?? 8)
    const totalArea = sumTotalArea(variant)
    const containers = calcPaintContainers(totalVolume, containerSize)

    return (
      <div className="ft-total">
        <div className="ft-section-title">합계</div>
        <table className="ft-table ft-total-table">
          <thead>
            <tr>
              <th>총 면적(m²)</th>
              <th>총 필요 용량(L)</th>
              <th>발주 용량 선택</th>
              <th>발주 수량</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="ft-num">{totalArea.toFixed(2)}</td>
              <td className="ft-num">{totalVolume.toFixed(2)}</td>
              <td>
                <select className="ft-zone-select" value={containerSize} onChange={e => setContainerSize(parseInt(e.target.value))}>
                  {(item.containerSizes ?? [1, 4, 18]).map(s => (
                    <option key={s} value={s}>{s} L</option>
                  ))}
                </select>
              </td>
              <td className="ft-num ft-bold">{containers}</td>
            </tr>
          </tbody>
        </table>
        <div className="ft-spec-note">
          <span className="ft-spec-icon">ℹ</span>
          기본 규격 : 수성 페인트 기준 {item.coverageM2PerL ?? 8}m²/L (면적 x 도포횟수 / 도포율)
        </div>
      </div>
    )
  }

  // sheet / roll 타입
  const floorA = sumFloorArea(variant)
  const wallA = sumWallArea(variant)
  const totalA = floorA + wallA
  const qty = item.calcType === 'roll' ? calcRollQty(item, variant) : calcSheetQty(item, variant)
  const spec = sheetAreaM2(item)

  return (
    <div className="ft-total">
      <div className="ft-section-title">합계</div>
      <table className="ft-table ft-total-table">
        <thead>
          <tr>
            <th>평면 면적(m²)</th>
            <th>벽면 면적(m²)</th>
            <th>총 시공면적(m²)</th>
            <th>로스(%)</th>
            <th>발주 수량({item.unit})</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="ft-num">{floorA.toFixed(1)}</td>
            <td className="ft-num">{wallA.toFixed(2)}</td>
            <td className="ft-num">{totalA.toFixed(2)}</td>
            <td className="ft-num">{Math.round(item.lossRate * 100)}</td>
            <td className="ft-num ft-bold">{qty}</td>
          </tr>
        </tbody>
      </table>
      {spec > 0 && (
        <div className="ft-spec-note">
          <span className="ft-spec-icon">ℹ</span>
          기본 규격 : {item.itemWidthMm} x {item.itemLengthMm} ({spec.toFixed(2)} m²/{item.unit})
        </div>
      )}
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
        <WallTable item={item} variant={variant} onUpdate={updateZones} />
        <TotalSection item={item} variant={variant} />
      </div>
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
