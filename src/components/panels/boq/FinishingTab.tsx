// 마감재 Tables 탭 — 카테고리 트리 + 자재별 상세 물량표
import { useState, useEffect, useCallback } from 'react'
import { ChevronRight, ChevronDown, Plus, Upload, MoreHorizontal, Trash2, Pencil, MapPin, MousePointer } from 'lucide-react'
import { startAreaMeasure } from '../../../lib/drawingState'
import { useProjectId } from '../../../context/ProjectContext'
import { useEditor } from '../../../context/EditorContext'
import { getScaleConfig } from '../../../lib/scaleConfig'
import {
  loadFinishingData, saveFinishingData,
  createVariant, uid,
  wallAreaM2, sumFloorArea, sumWallArea, sumTotalArea,
  calcSheetQty, calcRollQty,
  paintVolumeL, sumPaintVolume, calcPaintContainers,
  type FinishingTablesData, type FinishingCategory, type FinishingItem,
  type MaterialVariant, type ZoneRow, specOf,
  boxAreaM2From, rollAreaM2From, defaultPiecesPerBox, resetFinishingData,
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
  const editor = useEditor()
  const isPaint = item.calcType === 'paint'

  const updateZone = (idx: number, patch: Partial<ZoneRow>) => {
    const next = variant.zones.map((z, i) => i === idx ? { ...z, ...patch } : z)
    onUpdate(next)
  }
  const addZone = () => onUpdate([...variant.zones, { id: uid(), label: '', floorAreaM2: 0, wallLengthM: 0, wallHeightM: 2.4 }])
  const removeZone = (idx: number) => onUpdate(variant.zones.filter((_, i) => i !== idx))

  const handleMeasure = (idx: number) => {
    startAreaMeasure(({ areaM2 }) => {
      updateZone(idx, { floorAreaM2: areaM2 })
    })
  }

  const importZones = () => {
    if (!editor) return
    const zones = editor.getCurrentPageShapes().filter(s => s.type === 'zone')
    if (zones.length === 0) {
      alert('캔버스에 공간(Zone)이 없습니다.\n툴바에서 공간지정 도구로 영역을 먼저 그려주세요.')
      return
    }
    const newZones: ZoneRow[] = zones.map(s => {
      const p = s.props as { label: string; areaM2: number; perimeterM: number; wallHeightMm: number }
      return {
        id: uid(),
        label: p.label || '미지정',
        floorAreaM2: p.areaM2,
        wallLengthM: p.perimeterM,
        wallHeightM: p.wallHeightMm / 1000,
      }
    })
    onUpdate(newZones)
  }

  /** 캔버스에서 선택된 요소(wall/dxfgroup)의 바운딩박스로 면적/둘레 계산 후 테이블에 추가 */
  const importFromSelection = () => {
    if (!editor) return
    const sel = editor.getSelectedShapes().filter(s => s.type === 'wall' || s.type === 'dxfgroup')
    if (sel.length === 0) {
      alert('캔버스에서 요소를 먼저 선택하세요.\n(선택 도구로 벽/DXF 요소를 클릭)')
      return
    }
    const scale = getScaleConfig(editor)
    const pxPerMm = scale.pxPerMm
    const newZones: ZoneRow[] = sel.map(s => {
      const bounds = editor.getShapeGeometry(s).bounds
      const wM = bounds.width / pxPerMm / 1000
      const hM = bounds.height / pxPerMm / 1000
      const areaM2 = +(wM * hM).toFixed(2)
      const perimM = +((wM + hM) * 2).toFixed(2)
      const layerName = (s.meta as Record<string, unknown>)?.dxfLayer as string || ''
      const matId = (s.meta as Record<string, unknown>)?.materialId as string || ''
      return {
        id: uid(),
        label: layerName || matId || '선택 영역',
        floorAreaM2: areaM2,
        wallLengthM: perimM,
        wallHeightM: 2.4,
      }
    })
    onUpdate([...variant.zones, ...newZones])
  }

  return (
    <div className="ft-section">
      <div className="ft-section-title">물량표 평면</div>
      <table className="ft-table">
        <thead>
          <tr>
            <th>구역/공간</th>
            <th>평면(m²)</th>
            {isPaint && <th>도포</th>}
            {isPaint && <th>용량(L)</th>}
            <th style={{ width: 44 }}></th>
          </tr>
        </thead>
        <tbody>
          {variant.zones.map((z, i) => (
            <tr key={z.id}>
              <td>
                <ZoneInput value={z.label} onChange={v => updateZone(i, { label: v })} />
              </td>
              <td>
                <ZoneInput value={z.floorAreaM2 || ''} onChange={v => updateZone(i, { floorAreaM2: parseFloat(v) || 0 })} width={50} />
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
                <td className="ft-num">{paintVolumeL(z, specOf(item, variant).coverageM2PerL ?? 10, 'floor') || '-'}</td>
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
      <div className="ft-row-btns">
        <button className="ft-add-row" onClick={addZone}>+ 행 추가</button>
        <button className="ft-add-row ft-import-zone" onClick={importFromSelection} title="선택된 요소의 면적을 가져옵니다">
          <MousePointer size={12} /> 선택 요소 가져오기
        </button>
        <button className="ft-add-row ft-import-zone" onClick={importZones} title="캔버스 공간(Zone)을 가져옵니다">
          <MapPin size={12} /> 공간 가져오기
        </button>
      </div>
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
            <th>벽면(m²)</th>
            {isPaint && <th>도포</th>}
            {isPaint && <th>용량(L)</th>}
          </tr>
        </thead>
        <tbody>
          {variant.zones.map((z, i) => (
            <tr key={z.id}>
              <td className="ft-zone-label">{z.label || '-'}</td>
              <td>
                <ZoneInput value={z.wallLengthM || ''} onChange={v => updateZone(i, { wallLengthM: parseFloat(v) || 0 })} width={50} />
              </td>
              <td>
                <ZoneInput value={z.wallHeightM || ''} onChange={v => updateZone(i, { wallHeightM: parseFloat(v) || 0 })} width={40} />
              </td>
              <td className="ft-num">{wallAreaM2(z) > 0 ? wallAreaM2(z).toFixed(1) : '-'}</td>
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
                <td className="ft-num">{paintVolumeL(z, specOf(item, variant).coverageM2PerL ?? 10, 'wall') || '-'}</td>
              )}
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
        <span>기본 규격 : {specOf(item, variant).specLabel ?? ''}</span>
      </div>
      <button className="ft-spec-edit-btn" onClick={onSpecEdit}>자재 규격 수정 ⚙</button>
    </div>
  )

  // ── 도장 ──
  if (isPaint) {
    const totalVolume = sumPaintVolume(variant, specOf(item, variant).coverageM2PerL ?? 10)
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

/**
 * 종류(변형)를 하나 골라 그 규격을 고친다.
 *
 * 면적 칸은 **읽기 전용 파생값**이다. 타일이면 가로 × 세로 ÷ 1,000,000 ×
 * 장수, 벽지면 폭 ÷ 1,000 × 길이. 사람이 면적을 직접 적게 두면 규격과
 * 어긋난 값이 남고, 그 어긋남은 발주 수량에서야 드러난다.
 *
 * 가로·세로를 바꾸면 등록된 규격의 BOX 당 장수를 끌어와 채운다. **등록되지
 * 않은 규격이면 장수를 건드리지 않는다** — 포장 수량은 제조사가 정하는 값이라
 * 비슷한 크기로 넘겨짚으면 수량이 조용히 틀어진다.
 */
function SpecEditModal({ item, onSave, onClose }: {
  item: FinishingItem
  onSave: (patch: Partial<FinishingItem>) => void
  onClose: () => void
}) {
  // 변형 여러 개를 연속으로 고치고 한 번에 적용할 수 있게 사본을 들고 있는다.
  const [variants, setVariants] = useState<MaterialVariant[]>(() => structuredClone(item.variants))
  const [sel, setSel] = useState(0)
  const [lossRate, setLossRate] = useState(Math.round(item.lossRate * 100))
  const [unit, setUnit] = useState(item.unit)

  const current = variants[sel] ?? variants[0]
  const isSheet = item.calcType === 'sheet'
  const isRoll = item.calcType === 'roll'
  const isPaint = item.calcType === 'paint'

  /** 선택된 변형만 갈아끼운다. */
  const patchCurrent = (patch: Partial<MaterialVariant>) => {
    setVariants(prev => prev.map((v, i) => i === sel ? { ...v, ...patch } : v))
  }

  /** 가로/세로가 바뀌면 등록된 장수를 따라 채운다 (없으면 그대로 둔다). */
  const setSize = (next: { itemWidthMm?: number; itemLengthMm?: number }) => {
    const w = next.itemWidthMm ?? current.itemWidthMm ?? 0
    const h = next.itemLengthMm ?? current.itemLengthMm ?? 0
    const known = defaultPiecesPerBox(w, h)
    patchCurrent({ ...next, ...(known ? { piecesPerBox: known } : {}) })
  }

  /** 이 변형을 기본값으로 되돌린다. */
  const resetToDefault = () => {
    const defaults = resetFinishingData()
    const defItem = defaults.categories.flatMap(c => c.items).find(i => i.id === item.id)
    const defVariant = defItem?.variants.find(v => v.label === current.label)
    if (!defVariant) return
    patchCurrent({
      itemWidthMm: defVariant.itemWidthMm,
      itemLengthMm: defVariant.itemLengthMm,
      piecesPerBox: defVariant.piecesPerBox,
      rollWidthMm: defVariant.rollWidthMm,
      rollLengthM: defVariant.rollLengthM,
      boxAreaM2: defVariant.boxAreaM2,
      rollAreaM2: defVariant.rollAreaM2,
      coverageM2PerL: defVariant.coverageM2PerL,
      specLabel: defVariant.specLabel,
    })
  }

  // 화면에 보여줄 면적 — 저장값이 아니라 지금 입력된 규격에서 바로 계산한다.
  const derivedBoxArea = boxAreaM2From(
    current.itemWidthMm ?? 0, current.itemLengthMm ?? 0, current.piecesPerBox ?? 0)
  const derivedRollArea = rollAreaM2From(current.rollWidthMm ?? 0, current.rollLengthM ?? 0)

  const handleSave = () => {
    // 계산된 면적을 함께 굳혀둔다. unitAreaM2 는 규격에서 다시 계산하지만,
    // 발주서 연동처럼 변형 없이 자재만 보는 자리도 있다.
    const saved = variants.map(v => {
      const box = boxAreaM2From(v.itemWidthMm ?? 0, v.itemLengthMm ?? 0, v.piecesPerBox ?? 0)
      const roll = rollAreaM2From(v.rollWidthMm ?? 0, v.rollLengthM ?? 0)
      return {
        ...v,
        ...(box > 0 ? { boxAreaM2: box } : {}),
        ...(roll > 0 ? { rollAreaM2: roll } : {}),
      }
    })
    const first = saved[0]
    onSave({
      variants: saved,
      lossRate: lossRate / 100,
      unit,
      // 첫 변형이 "기본 규격" 이다 — 자재 레벨 폴백을 거기에 맞춰둔다.
      ...(first?.boxAreaM2 ? { boxAreaM2: first.boxAreaM2 } : {}),
      ...(first?.rollAreaM2 ? { rollAreaM2: first.rollAreaM2 } : {}),
      ...(first?.coverageM2PerL ? { coverageM2PerL: first.coverageM2PerL } : {}),
    })
    onClose()
  }

  const numInput = (value: number | undefined, onChange: (n: number) => void, step = '1') => (
    <input
      type="number" step={step} value={value || ''}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
    />
  )

  return (
    <div className="ft-spec-overlay" onClick={onClose}>
      <div className="ft-spec-modal ft-spec-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="ft-spec-modal-head">
          <div>
            <div className="ft-spec-modal-title">자재 규격 수정</div>
            <div className="ft-spec-modal-sub">사용할 자재와 규격을 선택하거나, 직접 수정할 수 있습니다.</div>
          </div>
          <button className="ft-spec-close" onClick={onClose} aria-label="닫기">×</button>
        </div>

        <div className="ft-spec-modal-cols">
          {/* 좌: 자재명 + 종류 목록 */}
          <div className="ft-spec-col-left">
            <div className="ft-spec-col-label">자재명</div>
            <div className="ft-spec-material-name">{item.label}</div>
            <ul className="ft-spec-variant-list">
              {variants.map((v, i) => (
                <li
                  key={v.id}
                  className={`ft-spec-variant-item${i === sel ? ' active' : ''}`}
                  onClick={() => setSel(i)}
                >
                  {v.label}
                </li>
              ))}
            </ul>
          </div>

          {/* 우: 규격 입력 */}
          <div className="ft-spec-col-right">
            <div className="ft-spec-col-head">
              <span className="ft-spec-col-label">규격 (단위 : mm)</span>
              <button className="ft-spec-reset" onClick={resetToDefault}>↺ 기본값으로 재설정</button>
            </div>

            {isSheet && (
              <>
                <div className="ft-spec-grid">
                  <label className="ft-spec-cell">
                    <span>가로(mm)</span>
                    {numInput(current.itemWidthMm, n => setSize({ itemWidthMm: n }))}
                  </label>
                  <label className="ft-spec-cell">
                    <span>세로(mm)</span>
                    {numInput(current.itemLengthMm, n => setSize({ itemLengthMm: n }))}
                  </label>
                  <label className="ft-spec-cell">
                    <span>BOX당 수량(장)</span>
                    {numInput(current.piecesPerBox, n => patchCurrent({ piecesPerBox: n }))}
                  </label>
                  <label className="ft-spec-cell">
                    <span>BOX당 면적(m²)</span>
                    <input type="number" readOnly value={derivedBoxArea || current.boxAreaM2 || ''} />
                  </label>
                </div>
                <div className="ft-spec-hint">
                  * 규격을 수정하면 BOX당 수량과 면적이 자동으로 계산됩니다. (BOX당 수량 수정가능)
                </div>
              </>
            )}

            {isRoll && (
              <>
                <div className="ft-spec-grid">
                  <label className="ft-spec-cell">
                    <span>폭(mm)</span>
                    {numInput(current.rollWidthMm, n => patchCurrent({ rollWidthMm: n }))}
                  </label>
                  <label className="ft-spec-cell">
                    <span>길이(m)</span>
                    {numInput(current.rollLengthM, n => patchCurrent({ rollLengthM: n }), '0.01')}
                  </label>
                  <label className="ft-spec-cell">
                    <span>1롤 면적(m²)</span>
                    <input type="number" readOnly value={derivedRollArea || current.rollAreaM2 || ''} />
                  </label>
                </div>
                <div className="ft-spec-hint">* 규격을 수정하면 1롤 면적이 자동으로 계산됩니다.</div>
              </>
            )}

            {isPaint && (
              <>
                <div className="ft-spec-grid">
                  <label className="ft-spec-cell">
                    <span>도포율(m²/L)</span>
                    {numInput(current.coverageM2PerL, n => patchCurrent({ coverageM2PerL: n }), '0.1')}
                  </label>
                </div>
                <div className="ft-spec-hint">* 필요 용량 = 면적 × 도포횟수 ÷ 도포율</div>
              </>
            )}

            <div className="ft-spec-grid ft-spec-grid-common">
              <label className="ft-spec-cell">
                <span>로스율(%)</span>
                {numInput(lossRate, setLossRate)}
              </label>
              <label className="ft-spec-cell">
                <span>단위</span>
                <input type="text" value={unit} onChange={e => setUnit(e.target.value)} />
              </label>
            </div>
          </div>
        </div>

        <div className="ft-spec-modal-actions">
          <button className="ft-spec-cancel" onClick={onClose}>취소</button>
          <button className="ft-spec-save" onClick={handleSave}>적용</button>
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
  const [tableView, setTableView] = useState<'floor' | 'wall'>('floor')
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

      {/* 물량표 (평면 / 벽면 탭 전환) */}
      {!item.floorOnly && (
        <div className="ft-view-tabs">
          <button
            className={`ft-view-tab${tableView === 'floor' ? ' active' : ''}`}
            onClick={() => setTableView('floor')}
          >
            평면
          </button>
          <button
            className={`ft-view-tab${tableView === 'wall' ? ' active' : ''}`}
            onClick={() => setTableView('wall')}
          >
            벽면
          </button>
        </div>
      )}
      <div className="ft-tables-scroll">
        {(tableView === 'floor' || item.floorOnly) && (
          <FloorTable item={item} variant={variant} onUpdate={updateZones} />
        )}
        {tableView === 'wall' && !item.floorOnly && (
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
  const editor = useEditor()
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

  // 재질 적용 이벤트 → 현재 선택된 마감재 아이템에 자동 추가
  useEffect(() => {
    const handler = (e: Event) => {
      if (!editor || !selectedItemId) return
      const { shapeIds } = (e as CustomEvent).detail as { shapeIds: string[]; materialId?: string }
      const scale = getScaleConfig(editor)
      const pxPerMm = scale.pxPerMm

      const newZones: ZoneRow[] = []
      for (const id of shapeIds) {
        const shape = editor.getShape(id as never)
        if (!shape) continue
        const bounds = editor.getShapeGeometry(shape).bounds
        const wM = bounds.width / pxPerMm / 1000
        const hM = bounds.height / pxPerMm / 1000
        const areaM2 = +(wM * hM).toFixed(2)
        const perimM = +((wM + hM) * 2).toFixed(2)
        const layerName = (shape.meta as Record<string, unknown>)?.dxfLayer as string || ''
        newZones.push({
          id: uid(),
          label: layerName || '선택 영역',
          floorAreaM2: areaM2,
          wallLengthM: perimM,
          wallHeightM: 2.4,
        })
      }

      if (newZones.length === 0) return

      setData(prev => ({
        ...prev,
        categories: prev.categories.map(cat => ({
          ...cat,
          items: cat.items.map(item => {
            if (item.id !== selectedItemId) return item
            // 첫 번째 variant의 zones에 추가
            const variants = item.variants.map((v, i) =>
              i === 0 ? { ...v, zones: [...v.zones, ...newZones] } : v
            )
            return { ...item, variants }
          }),
        })),
      }))
    }
    window.addEventListener('bimova:material-applied', handler)
    return () => window.removeEventListener('bimova:material-applied', handler)
  }, [editor, selectedItemId])

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
