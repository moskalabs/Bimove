/**
 * CadPreview: CAD(DXF/DWG) 레이어 선택 다이얼로그
 * DXF 텍스트에서 경량으로 레이어 목록을 추출 (전체 파싱 없이).
 * 선택된 레이어만 tldraw 캔버스에 임포트.
 * 기존 bimove UI 스타일(cad-layer-*)에 맞춤.
 */
import { useEffect, useState, useMemo, useCallback } from 'react'

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

  // 모달 열릴 때 body data attr 추가
  useEffect(() => {
    document.body.dataset.modalOpen = 'true'
    return () => { delete document.body.dataset.modalOpen }
  }, [])

  // 경량 레이어 추출 (전체 파싱 없이 DXF 텍스트에서 직접)
  useEffect(() => {
    // setTimeout으로 UI 렌더 후 실행 (다이얼로그가 먼저 보이도록)
    const timer = setTimeout(() => {
      const t0 = performance.now()
      try {
        const result = extractLayersLightweight(dxfText)
        setLayers(result)

        const hasStructural = result.some((l) => l.likelyStructural)
        const initialSelected = hasStructural
          ? new Set(result.filter((l) => l.likelyStructural).map((l) => l.name))
          : new Set(result.map((l) => l.name))
        setSelected(initialSelected)

        console.log(`[CadPreview] ${result.length}개 레이어 추출 (${(performance.now() - t0).toFixed(0)}ms)`)
      } catch (err) {
        console.error('[CadPreview] 레이어 추출 에러:', err)
      } finally {
        setParsing(false)
      }
    }, 50)

    return () => clearTimeout(timer)
  }, [dxfText])

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
        <div className="cad-layer-header">
          <strong>{fileName}</strong>{' '}
          <span style={{ fontSize: 12, color: '#888' }}>({fmt}, {sizeMB}MB)</span>
        </div>

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

        <div className="cad-layer-list">
          {parsing && (
            <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>
              레이어 추출 중...
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

/**
 * DXF 텍스트에서 경량으로 레이어 정보 추출.
 * dxf 패키지의 parseString/denormalise를 호출하지 않음 (수백MB 파일에서 메인스레드 블로킹 방지).
 *
 * 1단계: TABLES 섹션에서 LAYER 정의 추출 (색상 포함)
 * 2단계: ENTITIES 섹션에서 그룹코드 8 (레이어명) 스캔하여 엔티티 수 집계
 */
function extractLayersLightweight(dxfText: string): LayerInfo[] {
  // --- 1. LAYER 테이블에서 정의된 레이어 + 색상 ---
  const layerDefs = new Map<string, number>() // name → ACI color
  const tablesMatch = dxfText.match(/\n0\nSECTION\n2\nTABLES\n([\s\S]*?)\n0\nENDSEC/i)
  if (tablesMatch) {
    const tablesText = tablesMatch[1]
    // LAYER 엔티티 파싱: 그룹코드 2=이름, 62=색상
    const layerBlocks = tablesText.split(/\n0\nLAYER\n/)
    for (let i = 1; i < layerBlocks.length; i++) {
      const block = layerBlocks[i]
      const nameMatch = block.match(/\n2\n([^\n]+)/)
      const colorMatch = block.match(/\n62\n(-?\d+)/)
      if (nameMatch) {
        const name = nameMatch[1].trim()
        const color = colorMatch ? Math.abs(parseInt(colorMatch[1])) : 7
        layerDefs.set(name, color)
      }
    }
  }

  // --- 2. ENTITIES 섹션에서 레이어별 엔티티 수 ---
  // DXF 그룹코드 패턴: "줄바꿈 + 그룹코드(정수) + 줄바꿈 + 값"
  // 엔티티 시작은 항상 "0\n엔티티타입". 그 뒤에 "8\n레이어명"이 나옴.
  // 엔티티 단위로 끊어서 첫 번째 그룹코드 8만 레이어로 인식.
  const layerCounts = new Map<string, number>()
  const entStart = dxfText.indexOf('\n0\nSECTION\n2\nENTITIES\n')
  const entEnd = dxfText.indexOf('\n0\nENDSEC', entStart > 0 ? entStart + 20 : 0)
  if (entStart > 0 && entEnd > entStart) {
    const entText = dxfText.substring(entStart, entEnd)
    // 엔티티 경계: "\n0\n" 으로 split
    const entities = entText.split('\n0\n')
    for (let i = 1; i < entities.length; i++) {
      const ent = entities[i]
      // 각 엔티티에서 첫 번째 그룹코드 8 찾기
      const layerMatch = ent.match(/\n8\n([^\n]+)/)
      if (layerMatch) {
        const name = layerMatch[1].trim()
        layerCounts.set(name, (layerCounts.get(name) || 0) + 1)
      }
    }
  }

  // --- 3. 합치기 ---
  const allNames = new Set([...layerDefs.keys(), ...layerCounts.keys()])
  const result: LayerInfo[] = []

  for (const name of allNames) {
    const count = layerCounts.get(name) || 0
    if (count === 0) continue // 엔티티 없는 레이어 스킵

    const aci = layerDefs.get(name) ?? 7
    result.push({
      name,
      color: aciToHex(aci),
      segCount: count,
      likelyStructural: STRUCTURAL_KEYWORDS.test(name),
    })
  }

  return result.sort((a, b) => b.segCount - a.segCount)
}

/** AutoCAD Color Index → hex 색상 */
function aciToHex(aci: number): string {
  const map: Record<number, string> = {
    0: '#000000', 1: '#ff0000', 2: '#ffff00', 3: '#00ff00',
    4: '#00ffff', 5: '#0000ff', 6: '#ff00ff', 7: '#ffffff',
    8: '#808080', 9: '#c0c0c0',
  }
  return map[aci] ?? `hsl(${(aci * 37) % 360}, 70%, 50%)`
}
