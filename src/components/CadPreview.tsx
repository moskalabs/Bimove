/**
 * CadPreview: CAD(DXF/DWG) 레이어 선택 다이얼로그
 * dxf 패키지로 파싱하여 레이어 목록을 추출하고,
 * 선택된 레이어만 tldraw 캔버스에 임포트.
 * 기존 bimove UI 스타일(cad-layer-*)에 맞춤.
 */
import { useEffect, useState, useMemo, useCallback } from 'react'
// @ts-ignore -- no types for dxf
import { parseString as dxfParseString, denormalise as dxfDenormalise } from 'dxf'

const STRUCTURAL_KEYWORDS = /wall|window|win(?!ter)|door|stair|column|beam|slab|elev|건축|벽|창문|문/i

interface LayerInfo {
  name: string
  color: string
  segCount: number
  likelyStructural: boolean
}

export interface CadPreviewProps {
  dxfText: string
  fileName: string
  fileSize: number
  isDwg: boolean
  onImport: (selectedLayers: Set<string>, dxfText: string) => void
  onClose: () => void
}

export default function CadPreview({
  dxfText,
  fileName,
  fileSize,
  isDwg,
  onImport,
  onClose,
}: CadPreviewProps) {
  const [layers, setLayers] = useState<LayerInfo[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [parsing, setParsing] = useState(true)

  // 모달 열릴 때 body data attr 추가 (온보딩 힌트 숨김)
  useEffect(() => {
    document.body.dataset.modalOpen = 'true'
    return () => { delete document.body.dataset.modalOpen }
  }, [])

  // DXF 파싱 → 레이어 추출
  useEffect(() => {
    const t0 = performance.now()
    try {
      const parsed = dxfParseString(dxfText)

      // denormalise로 블록 확장된 엔티티 가져오기
      const entities = dxfDenormalise(parsed)

      // 레이어별 엔티티 수 집계
      const layerMap = new Map<string, { count: number; color: string }>()

      // 레이어 테이블에서 색상 정보 추출
      const layerTable = (parsed.tables?.layer?.layers ?? {}) as Record<string, { color?: number; colorNumber?: number }>

      for (const ent of entities) {
        const name = (ent as { layer?: string }).layer || '0'
        const existing = layerMap.get(name)
        if (existing) {
          existing.count++
        } else {
          // 레이어 색상 결정
          const lt = layerTable[name]
          const colorNum = lt?.colorNumber ?? lt?.color ?? 7
          const hex = aciToHex(colorNum)
          layerMap.set(name, { count: 1, color: hex })
        }
      }

      const layerInfos: LayerInfo[] = [...layerMap.entries()]
        .map(([name, info]) => ({
          name,
          color: info.color,
          segCount: info.count,
          likelyStructural: STRUCTURAL_KEYWORDS.test(name),
        }))
        .sort((a, b) => b.segCount - a.segCount)

      setLayers(layerInfos)

      // 초기 선택: 구조 레이어가 있으면 구조만, 없으면 전체
      const hasStructural = layerInfos.some((l) => l.likelyStructural)
      const initialSelected = hasStructural
        ? new Set(layerInfos.filter((l) => l.likelyStructural).map((l) => l.name))
        : new Set(layerInfos.map((l) => l.name))
      setSelected(initialSelected)

      console.log(`[CadPreview] ${layerInfos.length}개 레이어, ${entities.length}개 엔티티 (${(performance.now() - t0).toFixed(0)}ms)`)
    } catch (err) {
      console.error('[CadPreview] 파싱 에러:', err)
    } finally {
      setParsing(false)
    }
  }, [dxfText])

  // 레이어 토글
  const toggleLayer = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelected(new Set(layers.map((l) => l.name)))
  }, [layers])

  const selectNone = useCallback(() => {
    setSelected(new Set())
  }, [])

  const selectStructural = useCallback(() => {
    setSelected(new Set(layers.filter((l) => l.likelyStructural).map((l) => l.name)))
  }, [layers])

  const hasStructural = useMemo(() => layers.some((l) => l.likelyStructural), [layers])

  const totalSelected = useMemo(() => {
    let total = 0
    for (const l of layers) {
      if (selected.has(l.name)) total += l.segCount
    }
    return total
  }, [layers, selected])

  // 가져오기
  const handleImport = useCallback(() => {
    if (selected.size === 0) return
    onImport(selected, dxfText)
  }, [selected, dxfText, onImport])

  // ESC 키로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const sizeMB = (fileSize / 1e6).toFixed(1)
  const fmt = isDwg ? 'DWG' : 'DXF'

  return (
    <div className="cad-layer-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cad-layer-dialog">
        {/* 헤더 */}
        <div className="cad-layer-header">
          <strong>{fileName}</strong>{' '}
          <span style={{ fontSize: 12, color: '#888' }}>({fmt}, {sizeMB}MB)</span>
        </div>

        {/* 빠른 선택 */}
        <div className="cad-layer-actions">
          <button className="cad-layer-action-btn" onClick={selectAll}>전체</button>
          <button className="cad-layer-action-btn" onClick={selectNone}>해제</button>
          {hasStructural && (
            <button className="cad-layer-action-btn cad-layer-action-primary" onClick={selectStructural}>
              구조 레이어
            </button>
          )}
          <span className="cad-layer-seg-count">
            {selected.size}개 레이어 / {totalSelected.toLocaleString()}개 요소
          </span>
        </div>

        {/* 레이어 목록 */}
        <div className="cad-layer-list">
          {parsing && (
            <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>
              도면 파싱 중...
            </div>
          )}
          {!parsing && layers.map((layer) => (
            <label
              key={layer.name}
              className={`cad-layer-row${selected.has(layer.name) ? ' selected' : ''}`}
              onClick={() => toggleLayer(layer.name)}
            >
              <input
                type="checkbox"
                checked={selected.has(layer.name)}
                onChange={() => {}}
                onClick={(e) => e.stopPropagation()}
              />
              <span className="cad-layer-dot" style={{ background: layer.color }} />
              <span className="cad-layer-name">
                {layer.name}
                {layer.likelyStructural && <span className="cad-layer-tag">구조</span>}
              </span>
              <span className="cad-layer-seg">{layer.segCount.toLocaleString()}</span>
            </label>
          ))}
          {!parsing && layers.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>
              레이어를 찾을 수 없습니다.
            </div>
          )}
        </div>

        {/* 하단 버튼 */}
        <div className="cad-layer-footer">
          <button className="cad-layer-cancel" onClick={onClose}>취소</button>
          <button
            className="cad-layer-confirm"
            disabled={selected.size === 0}
            onClick={handleImport}
          >
            {selected.size > 0 ? `${selected.size}개 레이어 가져오기` : '레이어를 선택하세요'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** AutoCAD Color Index → hex 색상 (기본 7색 + fallback) */
function aciToHex(aci: number): string {
  const map: Record<number, string> = {
    0: '#000000', 1: '#ff0000', 2: '#ffff00', 3: '#00ff00',
    4: '#00ffff', 5: '#0000ff', 6: '#ff00ff', 7: '#ffffff',
    8: '#808080', 9: '#c0c0c0',
  }
  return map[aci] ?? `hsl(${(aci * 37) % 360}, 70%, 50%)`
}
