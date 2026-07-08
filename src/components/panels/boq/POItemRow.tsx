// 품목 한 행 (인라인 편집, 도면 치수 연동, 자재 프리셋, 복사/삭제)
import { useState } from 'react'
import { Copy, Trash2, MapPin, X, ChevronDown } from 'lucide-react'
import type { BOQItem, Exclusion } from '../../../lib/purchaseOrder'
import {
  grossArea, exclusionArea, netArea, calcQuantity, calcAmount,
  fmtKRW, fmtArea, uid,
} from '../../../lib/purchaseOrder'
import { loadMaterialPresets, type MaterialPreset } from '../../../lib/materialPresets'
import { POExclusionPicker } from './POExclusionPicker'

type Props = {
  item: BOQItem
  onChange: (updated: BOQItem) => void
  onDuplicate: () => void
  onDelete: () => void
  wallLengths: { label: string; mm: number }[]
  roomPerimeters: { label: string; mm: number }[]
  doors: { id: string; label: string; widthMm: number; heightMm: number }[]
  windows: { id: string; label: string; widthMm: number; heightMm: number }[]
}

export function POItemRow({
  item, onChange, onDuplicate, onDelete,
  wallLengths, roomPerimeters, doors, windows,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const [showDimPicker, setShowDimPicker] = useState(false)
  const [showExclusion, setShowExclusion] = useState(false)
  const [showPresets, setShowPresets] = useState(false)

  const set = (patch: Partial<BOQItem>) => onChange({ ...item, ...patch })
  const setNum = (key: keyof BOQItem, val: string) => {
    const n = parseFloat(val)
    if (!isNaN(n) && n >= 0) set({ [key]: n } as Partial<BOQItem>)
  }

  const qty = calcQuantity(item)
  const amount = calcAmount(item)
  const net = netArea(item)

  return (
    <div className="po-item">
      {/* 요약 행 */}
      <div className="po-item-summary" onClick={() => setExpanded(!expanded)}>
        <span className="po-item-name">{item.name || '(미입력)'}</span>
        <span className="po-item-area">{fmtArea(net)}</span>
        <span className="po-item-qty">{qty > 0 ? `${qty} ${item.unit}` : '-'}</span>
        <span className="po-item-amount">{amount > 0 ? fmtKRW(amount) : '-'}</span>
        <span className="po-item-chevron">{expanded ? '▲' : '▼'}</span>
      </div>

      {/* 상세 편집 */}
      {expanded && (
        <div className="po-item-detail">
          {/* 품목명 + 마감재 */}
          <div className="po-field-row">
            <label>품목명</label>
            <input
              value={item.name}
              onChange={e => set({ name: e.target.value })}
              placeholder="품목명"
            />
          </div>
          <div className="po-field-row">
            <label>마감재</label>
            <div className="po-field-with-btn" style={{ position: 'relative' }}>
              <input
                value={item.material}
                onChange={e => set({ material: e.target.value })}
                placeholder="마감재명 / 규격"
              />
              <button
                className="po-preset-trigger"
                title="자재 프리셋"
                onClick={e => { e.stopPropagation(); setShowPresets(!showPresets) }}
              >
                <ChevronDown size={12} />
              </button>
              {showPresets && (
                <div className="po-preset-dropdown">
                  <div className="po-preset-dropdown-title">자재 프리셋</div>
                  {loadMaterialPresets().map(p => (
                    <button
                      key={p.id}
                      className="po-preset-option"
                      onClick={e => {
                        e.stopPropagation()
                        const patch: Partial<BOQItem> = { material: p.label }
                        if (p.pricePerM2 && item.unit === 'm²') patch.unitPrice = p.pricePerM2
                        else if (p.pricePerM2) patch.unitPrice = p.pricePerM2
                        else if (p.pricePerM) patch.unitPrice = p.pricePerM
                        set(patch)
                        setShowPresets(false)
                      }}
                    >
                      <span className="po-preset-swatch" style={{ background: p.fill, borderColor: p.stroke }} />
                      <span className="po-preset-label">{p.label}</span>
                      <span className="po-preset-price">
                        {p.pricePerM2 ? `₩${(p.pricePerM2/1000).toFixed(0)}k/m²` :
                         p.pricePerM ? `₩${(p.pricePerM/1000).toFixed(0)}k/m` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 너비 (도면 연동) */}
          <div className="po-field-row">
            <label>너비</label>
            <div className="po-field-with-btn">
              <input
                type="number"
                value={item.widthMm || ''}
                onChange={e => setNum('widthMm', e.target.value)}
                placeholder="mm"
              />
              <span className="po-field-unit">mm</span>
              <button
                className="po-dim-btn"
                title="도면에서 가져오기"
                onClick={e => { e.stopPropagation(); setShowDimPicker(!showDimPicker) }}
              >
                <MapPin size={12} strokeWidth={2} />
              </button>
            </div>
          </div>

          {/* 도면 치수 선택 드롭다운 */}
          {showDimPicker && (
            <div className="po-dim-picker">
              {wallLengths.length > 0 && (
                <>
                  <div className="po-dim-section-label">벽 길이</div>
                  {wallLengths.map((w, i) => (
                    <button
                      key={`w${i}`}
                      className="po-dim-option"
                      onClick={() => { set({ widthMm: Math.round(w.mm) }); setShowDimPicker(false) }}
                    >
                      {w.label} — {Math.round(w.mm)} mm
                    </button>
                  ))}
                </>
              )}
              {roomPerimeters.length > 0 && (
                <>
                  <div className="po-dim-section-label">방 둘레</div>
                  {roomPerimeters.map((r, i) => (
                    <button
                      key={`r${i}`}
                      className="po-dim-option"
                      onClick={() => { set({ widthMm: Math.round(r.mm) }); setShowDimPicker(false) }}
                    >
                      {r.label} — {Math.round(r.mm)} mm
                    </button>
                  ))}
                </>
              )}
              {wallLengths.length === 0 && roomPerimeters.length === 0 && (
                <div className="po-dim-empty">도면에 벽을 그리면 치수를 가져올 수 있어요</div>
              )}
            </div>
          )}

          {/* 높이 */}
          <div className="po-field-row">
            <label>높이</label>
            <div className="po-field-with-btn">
              <input
                type="number"
                value={item.heightMm || ''}
                onChange={e => setNum('heightMm', e.target.value)}
                placeholder="mm"
              />
              <span className="po-field-unit">mm</span>
            </div>
          </div>

          {/* 제외 항목 */}
          <div className="po-field-row">
            <label>제외</label>
            <button
              className="po-add-exclusion-btn"
              onClick={e => { e.stopPropagation(); setShowExclusion(true) }}
            >
              + 제외 추가
            </button>
          </div>
          {item.exclusions.length > 0 && (
            <div className="po-exclusion-list">
              {item.exclusions.map(ex => (
                <div key={ex.id} className="po-exclusion-tag">
                  <span>{ex.label} ({ex.widthMm}×{ex.heightMm})</span>
                  <button onClick={() => set({
                    exclusions: item.exclusions.filter(e => e.id !== ex.id),
                  })}><X size={10} /></button>
                </div>
              ))}
              <div className="po-exclusion-total">
                제외면적: {fmtArea(exclusionArea(item))}
              </div>
            </div>
          )}

          {showExclusion && (
            <POExclusionPicker
              doors={doors}
              windows={windows}
              existing={item.exclusions}
              onAdd={(ex) => {
                set({ exclusions: [...item.exclusions, ex] })
              }}
              onClose={() => setShowExclusion(false)}
            />
          )}

          {/* 마감재 규격 */}
          <div className="po-field-group-title">마감재 규격</div>
          <div className="po-field-row">
            <label>폭</label>
            <div className="po-field-with-btn">
              <input
                type="number"
                value={item.itemWidthMm || ''}
                onChange={e => setNum('itemWidthMm', e.target.value)}
                placeholder="mm"
              />
              <span className="po-field-unit">mm</span>
            </div>
          </div>
          <div className="po-field-row">
            <label>길이</label>
            <div className="po-field-with-btn">
              <input
                type="number"
                value={item.itemLengthMm || ''}
                onChange={e => setNum('itemLengthMm', e.target.value)}
                placeholder="mm"
              />
              <span className="po-field-unit">mm</span>
            </div>
          </div>
          <div className="po-field-row">
            <label>로스율</label>
            <div className="po-field-with-btn">
              <input
                type="number"
                value={+(item.lossRate * 100).toFixed(1)}
                onChange={e => {
                  const v = parseFloat(e.target.value)
                  if (!isNaN(v) && v >= 0 && v <= 100) set({ lossRate: v / 100 })
                }}
                step="0.5"
              />
              <span className="po-field-unit">%</span>
            </div>
          </div>
          <div className="po-field-row">
            <label>단가</label>
            <div className="po-field-with-btn">
              <input
                type="number"
                value={item.unitPrice || ''}
                onChange={e => setNum('unitPrice', e.target.value)}
                placeholder="₩"
              />
              <span className="po-field-unit">₩/{item.unit}</span>
            </div>
          </div>

          {/* 산출 결과 */}
          <div className="po-calc-summary">
            <div><span>총면적</span><span>{fmtArea(grossArea(item))}</span></div>
            <div><span>제외면적</span><span>{fmtArea(exclusionArea(item))}</span></div>
            <div><span>순면적</span><span className="po-calc-highlight">{fmtArea(net)}</span></div>
            <div><span>수량</span><span className="po-calc-highlight">{qty > 0 ? `${qty} ${item.unit}` : '-'}</span></div>
            <div><span>금액</span><span className="po-calc-highlight">{fmtKRW(amount)}</span></div>
          </div>

          {/* 액션 버튼 */}
          <div className="po-item-actions">
            <button onClick={onDuplicate} title="복사">
              <Copy size={13} strokeWidth={1.75} /> 복사
            </button>
            <button onClick={onDelete} className="po-delete-btn" title="삭제">
              <Trash2 size={13} strokeWidth={1.75} /> 삭제
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
