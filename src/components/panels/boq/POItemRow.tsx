// 품목 한 행 (인라인 편집, 도면 치수 연동, 자재 프리셋, 산출방식 전환, 복사/삭제)
import { useState } from 'react'
import { Copy, Trash2, MapPin, X, ChevronDown, Crosshair } from 'lucide-react'
import type { BOQItem, CalcMethod } from '../../../lib/purchaseOrder'
import {
  grossArea, exclusionArea, netArea, calcQuantity, calcAmount,
  fmtKRW, fmtArea, uid,
} from '../../../lib/purchaseOrder'
import { loadMaterialPresets } from '../../../lib/materialPresets'
import { enterPickMode } from '../../../lib/drawingState'
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

const CALC_METHODS: { key: CalcMethod; label: string; unit: string }[] = [
  { key: 'area', label: '면적', unit: 'm²' },
  { key: 'length', label: '길이', unit: 'm' },
  { key: 'quantity', label: '수량', unit: 'EA' },
]

export function POItemRow({
  item, onChange, onDuplicate, onDelete,
  wallLengths, roomPerimeters, doors, windows,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const [showDimPicker, setShowDimPicker] = useState(false)
  const [showExclusion, setShowExclusion] = useState(false)
  const [showPresets, setShowPresets] = useState(false)

  const method: CalcMethod = item.calcMethod ?? 'area'

  const set = (patch: Partial<BOQItem>) => onChange({ ...item, ...patch })
  const setNum = (key: keyof BOQItem, val: string) => {
    const n = parseFloat(val)
    if (!isNaN(n) && n >= 0) set({ [key]: n } as Partial<BOQItem>)
  }

  const qty = calcQuantity(item)
  const amount = calcAmount(item)
  const net = netArea(item)

  /** 산출방식 변경 시 unit도 맞춤 */
  const handleMethodChange = (m: CalcMethod) => {
    const meta = CALC_METHODS.find(c => c.key === m)!
    // unit이 기존 단위(장/롤 등)면 m²/m/EA 기본값으로 전환
    const currentIsDefault = ['m²', 'm', 'EA'].includes(item.unit)
    set({
      calcMethod: m,
      unit: currentIsDefault ? meta.unit : item.unit,
    })
  }

  /** 요약 행에 보여줄 계산 결과 텍스트 */
  const summaryCalc = () => {
    if (method === 'length') return item.lengthM ? `${item.lengthM} m` : '-'
    if (method === 'quantity') return item.manualQty ? `${item.manualQty} EA` : '-'
    return fmtArea(net)
  }

  return (
    <div className="po-item">
      {/* 요약 행 */}
      <div className="po-item-summary" onClick={() => setExpanded(!expanded)}>
        <span className="po-item-name">{item.name || '(미입력)'}</span>
        <span className="po-item-area">{summaryCalc()}</span>
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

          {/* ── 산출방식 선택 ── */}
          <div className="po-field-row">
            <label>산출방식</label>
            <div className="po-calc-method-selector">
              {CALC_METHODS.map(m => (
                <button
                  key={m.key}
                  className={`po-calc-method-btn ${method === m.key ? 'active' : ''}`}
                  onClick={e => { e.stopPropagation(); handleMethodChange(m.key) }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── 면적 산출 필드 ── */}
          {method === 'area' && (
            <>
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
                  <button
                    className="po-dim-btn po-pick-btn"
                    title="도면에서 직접 클릭"
                    onClick={e => {
                      e.stopPropagation()
                      enterPickMode('wall', (result) => {
                        if (result.type === 'wall') set({ widthMm: result.lengthMm })
                      })
                    }}
                  >
                    <Crosshair size={12} strokeWidth={2} />
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
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    className="po-add-exclusion-btn"
                    onClick={e => { e.stopPropagation(); setShowExclusion(true) }}
                  >
                    + 제외 추가
                  </button>
                  <button
                    className="po-dim-btn po-pick-btn"
                    title="도면에서 문/창문 직접 클릭"
                    onClick={e => {
                      e.stopPropagation()
                      enterPickMode('door-window', (result) => {
                        if (result.type === 'door' || result.type === 'window') {
                          set({
                            exclusions: [...item.exclusions, {
                              id: uid(),
                              type: result.type,
                              label: result.label,
                              shapeId: result.shapeId,
                              widthMm: result.widthMm,
                              heightMm: result.heightMm,
                            }],
                          })
                        }
                      })
                    }}
                  >
                    <Crosshair size={12} strokeWidth={2} />
                  </button>
                </div>
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
            </>
          )}

          {/* ── 길이 산출 필드 ── */}
          {method === 'length' && (
            <div className="po-field-row">
              <label>길이</label>
              <div className="po-field-with-btn">
                <input
                  type="number"
                  value={item.lengthM ?? ''}
                  onChange={e => {
                    const v = parseFloat(e.target.value)
                    set({ lengthM: isNaN(v) ? 0 : v })
                  }}
                  placeholder="m"
                  step="0.1"
                />
                <span className="po-field-unit">m</span>
                <button
                  className="po-dim-btn"
                  title="도면에서 가져오기"
                  onClick={e => { e.stopPropagation(); setShowDimPicker(!showDimPicker) }}
                >
                  <MapPin size={12} strokeWidth={2} />
                </button>
                <button
                  className="po-dim-btn po-pick-btn"
                  title="도면에서 직접 클릭"
                  onClick={e => {
                    e.stopPropagation()
                    enterPickMode('wall', (result) => {
                      if (result.type === 'wall') set({ lengthM: +(result.lengthMm / 1000).toFixed(2) })
                    })
                  }}
                >
                  <Crosshair size={12} strokeWidth={2} />
                </button>
              </div>
            </div>
          )}

          {/* 길이 방식 도면 치수 드롭다운 */}
          {method === 'length' && showDimPicker && (
            <div className="po-dim-picker">
              {wallLengths.length > 0 && (
                <>
                  <div className="po-dim-section-label">벽 길이</div>
                  {wallLengths.map((w, i) => (
                    <button
                      key={`w${i}`}
                      className="po-dim-option"
                      onClick={() => { set({ lengthM: +(w.mm / 1000).toFixed(2) }); setShowDimPicker(false) }}
                    >
                      {w.label} — {(w.mm / 1000).toFixed(2)} m
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
                      onClick={() => { set({ lengthM: +(r.mm / 1000).toFixed(2) }); setShowDimPicker(false) }}
                    >
                      {r.label} — {(r.mm / 1000).toFixed(2)} m
                    </button>
                  ))}
                </>
              )}
              {wallLengths.length === 0 && roomPerimeters.length === 0 && (
                <div className="po-dim-empty">도면에 벽을 그리면 치수를 가져올 수 있어요</div>
              )}
            </div>
          )}

          {/* ── 수량 산출 필드 ── */}
          {method === 'quantity' && (
            <div className="po-field-row">
              <label>수량</label>
              <div className="po-field-with-btn">
                <input
                  type="number"
                  value={item.manualQty ?? ''}
                  onChange={e => {
                    const v = parseFloat(e.target.value)
                    set({ manualQty: isNaN(v) ? 0 : v })
                  }}
                  placeholder="EA"
                  step="1"
                  min="0"
                />
                <span className="po-field-unit">EA</span>
              </div>
            </div>
          )}

          {/* 마감재 규격 (면적/길이 방식에서만, 수량은 불필요) */}
          {method !== 'quantity' && (
            <>
              <div className="po-field-group-title">마감재 규격</div>
              {method === 'area' && (
                <>
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
                </>
              )}
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
            </>
          )}

          {/* 단가 + 단위 */}
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
          <div className="po-field-row">
            <label>단위</label>
            <input
              value={item.unit}
              onChange={e => set({ unit: e.target.value })}
              placeholder="장, 롤, m², m, EA"
              style={{ maxWidth: 80 }}
            />
          </div>

          {/* 산출 결과 */}
          <div className="po-calc-summary">
            {method === 'area' && (
              <>
                <div><span>총면적</span><span>{fmtArea(grossArea(item))}</span></div>
                <div><span>제외면적</span><span>{fmtArea(exclusionArea(item))}</span></div>
                <div><span>순면적</span><span className="po-calc-highlight">{fmtArea(net)}</span></div>
              </>
            )}
            {method === 'length' && (
              <div><span>길이</span><span className="po-calc-highlight">{item.lengthM ? `${item.lengthM} m` : '-'}</span></div>
            )}
            {method === 'quantity' && (
              <div><span>수량</span><span className="po-calc-highlight">{item.manualQty ? `${item.manualQty} EA` : '-'}</span></div>
            )}
            <div><span>산출수량</span><span className="po-calc-highlight">{qty > 0 ? `${qty} ${item.unit}` : '-'}</span></div>
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
