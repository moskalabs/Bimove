/**
 * CAD(DXF/DWG) 임포트 시 레이어 선택 다이얼로그
 * parseCadFile 결과를 받아서 레이어별 체크박스를 보여주고,
 * 선택된 레이어만 commitCadImport로 전달.
 */
import { useState, useMemo } from 'react'
import type { CadParseResult } from '../lib/dxf'

interface Props {
  result: CadParseResult
  onConfirm: (selectedLayers: Set<string>) => void
  onCancel: () => void
}

export function CadLayerDialog({ result, onConfirm, onCancel }: Props) {
  // 초기 선택: 구조 관련 레이어만, 없으면 전체
  const hasStructural = result.layers.some((l) => l.likelyStructural)
  const [selected, setSelected] = useState<Set<string>>(() => {
    if (hasStructural) {
      return new Set(result.layers.filter((l) => l.likelyStructural).map((l) => l.name))
    }
    return new Set(result.layers.map((l) => l.name))
  })

  const selectedCount = useMemo(
    () => result.layers.filter((l) => selected.has(l.name)).reduce((sum, l) => sum + l.segCount, 0),
    [selected, result.layers],
  )

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const selectAll = () => setSelected(new Set(result.layers.map((l) => l.name)))
  const selectNone = () => setSelected(new Set())
  const selectStructural = () =>
    setSelected(new Set(result.layers.filter((l) => l.likelyStructural).map((l) => l.name)))

  return (
    <div className="cad-layer-overlay" onClick={onCancel}>
      <div className="cad-layer-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="cad-layer-header">
          <strong>레이어 선택</strong>
          <span style={{ fontSize: 12, color: '#888', marginLeft: 8 }}>
            {result.fileName} ({result.layers.length}개 레이어)
          </span>
        </div>

        {/* 빠른 선택 버튼 */}
        <div className="cad-layer-actions">
          <button className="cad-layer-action-btn" onClick={selectAll}>전체 선택</button>
          <button className="cad-layer-action-btn" onClick={selectNone}>전체 해제</button>
          {hasStructural && (
            <button className="cad-layer-action-btn cad-layer-action-primary" onClick={selectStructural}>
              구조 레이어만
            </button>
          )}
          <span className="cad-layer-seg-count">
            {selectedCount.toLocaleString()} / {result.totalSegments.toLocaleString()} 세그먼트
          </span>
        </div>

        {/* 레이어 목록 */}
        <div className="cad-layer-list">
          {result.layers.map((layer) => (
            <label
              key={layer.name}
              className={`cad-layer-row ${selected.has(layer.name) ? 'selected' : ''}`}
            >
              <input
                type="checkbox"
                checked={selected.has(layer.name)}
                onChange={() => toggle(layer.name)}
              />
              <span
                className="cad-layer-dot"
                style={{ background: layer.color || '#888' }}
              />
              <span className="cad-layer-name">
                {layer.name}
                {layer.likelyStructural && <span className="cad-layer-tag">구조</span>}
              </span>
              <span className="cad-layer-seg">{layer.segCount}</span>
            </label>
          ))}
        </div>

        {/* 확인/취소 */}
        <div className="cad-layer-footer">
          <button className="cad-layer-cancel" onClick={onCancel}>취소</button>
          <button
            className="cad-layer-confirm"
            onClick={() => onConfirm(selected)}
            disabled={selected.size === 0}
          >
            {selected.size > 0
              ? `${selected.size}개 레이어 가져오기`
              : '레이어를 선택하세요'}
          </button>
        </div>
      </div>
    </div>
  )
}
