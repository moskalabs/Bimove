// 문/창문 제외 항목 선택 + 커스텀 제외 추가
import { useState } from 'react'
import type { Exclusion } from '../../../lib/purchaseOrder'
import { uid } from '../../../lib/purchaseOrder'

type Props = {
  doors: { id: string; label: string; widthMm: number; heightMm: number }[]
  windows: { id: string; label: string; widthMm: number; heightMm: number }[]
  existing: Exclusion[]
  onAdd: (exclusion: Exclusion) => void
  onClose: () => void
}

export function POExclusionPicker({ doors, windows, existing, onAdd, onClose }: Props) {
  const [customW, setCustomW] = useState('')
  const [customH, setCustomH] = useState('')
  const [customLabel, setCustomLabel] = useState('')

  const existingIds = new Set(existing.map(e => e.shapeId).filter(Boolean))

  const addShape = (
    type: 'door' | 'window',
    shape: { id: string; label: string; widthMm: number; heightMm: number },
  ) => {
    onAdd({
      id: uid(),
      type,
      label: shape.label,
      shapeId: shape.id,
      widthMm: shape.widthMm,
      heightMm: shape.heightMm,
    })
  }

  const addCustom = () => {
    const w = parseFloat(customW)
    const h = parseFloat(customH)
    if (isNaN(w) || isNaN(h) || w <= 0 || h <= 0) return
    onAdd({
      id: uid(),
      type: 'custom',
      label: customLabel || '커스텀',
      widthMm: w,
      heightMm: h,
    })
    setCustomW('')
    setCustomH('')
    setCustomLabel('')
  }

  return (
    <div className="po-exclusion-picker">
      <div className="po-exclusion-picker-header">
        <span>제외 항목 선택</span>
        <button onClick={onClose}>×</button>
      </div>

      {/* 문 목록 */}
      {doors.length > 0 && (
        <>
          <div className="po-dim-section-label">문</div>
          {doors.map(d => (
            <button
              key={d.id}
              className="po-dim-option"
              disabled={existingIds.has(d.id)}
              onClick={() => addShape('door', d)}
            >
              {d.label} ({d.widthMm}×{d.heightMm} mm)
              {existingIds.has(d.id) && <span className="po-already-tag">추가됨</span>}
            </button>
          ))}
        </>
      )}

      {/* 창문 목록 */}
      {windows.length > 0 && (
        <>
          <div className="po-dim-section-label">창문</div>
          {windows.map(w => (
            <button
              key={w.id}
              className="po-dim-option"
              disabled={existingIds.has(w.id)}
              onClick={() => addShape('window', w)}
            >
              {w.label} ({w.widthMm}×{w.heightMm} mm)
              {existingIds.has(w.id) && <span className="po-already-tag">추가됨</span>}
            </button>
          ))}
        </>
      )}

      {doors.length === 0 && windows.length === 0 && (
        <div className="po-dim-empty">도면에 문/창문이 없습니다</div>
      )}

      {/* 커스텀 제외 */}
      <div className="po-dim-section-label">커스텀 제외</div>
      <div className="po-custom-exclusion">
        <input
          placeholder="이름"
          value={customLabel}
          onChange={e => setCustomLabel(e.target.value)}
          style={{ flex: 2 }}
        />
        <input
          type="number"
          placeholder="너비mm"
          value={customW}
          onChange={e => setCustomW(e.target.value)}
          style={{ flex: 1 }}
        />
        <span>×</span>
        <input
          type="number"
          placeholder="높이mm"
          value={customH}
          onChange={e => setCustomH(e.target.value)}
          style={{ flex: 1 }}
        />
        <button className="po-custom-add-btn" onClick={addCustom}>+</button>
      </div>
    </div>
  )
}
