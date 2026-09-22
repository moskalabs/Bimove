/**
 * CadPreview: CAD(DXF/DWG) 레이어 선택 다이얼로그
 * DXF 텍스트에서 경량으로 레이어 목록을 추출 (전체 파싱 없이).
 * 선택된 레이어만 tldraw 캔버스에 임포트.
 * 기존 bimove UI 스타일(cad-layer-*)에 맞춤.
 */
import { useEffect, useState, useMemo, useCallback } from 'react'

const STRUCTURAL_KEYWORDS = /wall|window|win(?!ter)|door|stair|column|beam|slab|elev|건축|벽|창문|문/i

/** 기본 제외 레이어: 비출력/보조/타이틀블록 레이어
 * NOTE: DEFPOINTS는 치수 보조 레이어지만, 실무에서 섹션 라벨 등
 * 유용한 TEXT를 올리는 경우가 많아 제외 목록에서 뺌. */
const EXCLUDE_LAYER_PATTERNS = /^(TB[-_]|TITLE[-_ ]?BLOCK|VIEWPORT|PAPER[-_ ]?SPACE|\*PAPER|\*MODEL)/i

interface LayerInfo {
  name: string
  color: string
  segCount: number
  likelyStructural: boolean
  excluded?: boolean   // 비출력/보조 레이어 (DEFPOINTS, TB-* 등)
  approx?: boolean  // 대용량 파일 샘플링 시 true
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
          ? new Set(result.filter((l) => l.likelyStructural && !EXCLUDE_LAYER_PATTERNS.test(l.name)).map((l) => l.name))
          : new Set(result.filter((l) => !EXCLUDE_LAYER_PATTERNS.test(l.name)).map((l) => l.name))
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
                {layer.excluded && <span className="cad-layer-tag" style={{ background: '#666', color: '#ccc' }}>보조</span>}
              </span>
              <span className="cad-layer-seg">{layer.approx ? '~' : ''}{layer.segCount.toLocaleString()}</span>
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
function extractLayersLightweight(rawDxfText: string): LayerInfo[] {
  // 0. \r\n → \n 정규화 (필수 — 패턴 매칭에 \n 통일 필요)
  const hadCR = rawDxfText.indexOf('\r') >= 0
  const dxfText = hadCR
    ? rawDxfText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    : rawDxfText

  // 0-1. 패딩 감지 → 패턴 동적 생성 (186MB에서 regex 정규화 대신 메모리 0 복사)
  // DXF 스펙: 그룹 코드 3자리 우측 정렬 ("  0", "  2", " 10", " 62", "100" 등)
  const padded = dxfText.charCodeAt(0) === 32  // 첫 줄이 "  0\n" 이면 패딩
  const gc = padded ? (c: number) => String(c).padStart(3) : (c: number) => String(c)

  // 핵심 패턴들 (패딩 유무에 따라 자동 변환)
  const SEP = `\n${gc(0)}\n`                          // 엔티티/섹션 경계
  const GC8 = `\n${gc(8)}\n`                          // 레이어 그룹 코드
  const GC2 = `\n${gc(2)}\n`                          // 이름 그룹 코드
  const GC62 = `\n${gc(62)}\n`                        // 색상 그룹 코드
  const ENDSEC = `\n${gc(0)}\nENDSEC`
  const SEC_TABLES = `\n${gc(0)}\nSECTION\n${gc(2)}\nTABLES\n`
  const SEC_ENTITIES = `\n${gc(0)}\nSECTION\n${gc(2)}\nENTITIES\n`
  const LAYER_HDR = `\n${gc(0)}\nLAYER\n`

  console.log(`[CadPreview] 길이: ${dxfText.length}, 패딩: ${padded}`)

  // --- 1. TABLES → LAYER 정의 (이름 + 색상) ---
  const layerDefs = new Map<string, number>()
  const tablesIdx = dxfText.indexOf(SEC_TABLES)
  if (tablesIdx >= 0) {
    const tablesBody = tablesIdx + SEC_TABLES.length
    const tablesEnd = dxfText.indexOf(ENDSEC, tablesBody)
    if (tablesEnd > tablesBody) {
      let pos = tablesBody
      while (true) {
        pos = dxfText.indexOf(LAYER_HDR, pos)
        if (pos < 0 || pos >= tablesEnd) break
        const lStart = pos + LAYER_HDR.length
        const nextBound = dxfText.indexOf(SEP, lStart)
        const lEnd = (nextBound >= 0 && nextBound < tablesEnd) ? nextBound : tablesEnd

        const ni = dxfText.indexOf(GC2, pos)
        if (ni >= 0 && ni < lEnd) {
          const nvs = ni + GC2.length
          const nvn = dxfText.indexOf('\n', nvs)
          const name = dxfText.substring(nvs, (nvn >= 0 && nvn <= lEnd) ? nvn : lEnd).trim()

          const ci = dxfText.indexOf(GC62, pos)
          let color = 7
          if (ci >= 0 && ci < lEnd) {
            const cvs = ci + GC62.length
            const cvn = dxfText.indexOf('\n', cvs)
            color = Math.abs(parseInt(dxfText.substring(cvs, (cvn >= 0 && cvn <= lEnd) ? cvn : lEnd)))
            if (isNaN(color)) color = 7
          }
          layerDefs.set(name, color)
        }
        pos = lStart
      }
    }
  }
  // (debug removed)

  // --- 2. ENTITIES → 레이어별 엔티티 수 (indexOf 스캐닝) ---
  // 대용량 파일(>20MB)은 앞부분만 샘플링 후 비율 추정 — 3.7초→<1초
  const layerCounts = new Map<string, number>()
  const entIdx = dxfText.indexOf(SEC_ENTITIES)
  let extrapolated = false
  if (entIdx >= 0) {
    const bodyStart = entIdx + SEC_ENTITIES.length
    const entEnd = dxfText.indexOf(ENDSEC, bodyStart)
    if (entEnd > bodyStart) {
      const sectionLen = entEnd - bodyStart
      const SAMPLE_LIMIT = 20_000_000  // 20MB까지만 스캔
      const scanEnd = sectionLen > SAMPLE_LIMIT ? bodyStart + SAMPLE_LIMIT : entEnd
      extrapolated = sectionLen > SAMPLE_LIMIT
      const ratio = sectionLen > SAMPLE_LIMIT ? sectionLen / SAMPLE_LIMIT : 1

      let sepPos = bodyStart - 1

      while (true) {
        const si = dxfText.indexOf(SEP, sepPos)
        if (si < 0 || si >= scanEnd) break

        const eStart = si + SEP.length
        const nextSi = dxfText.indexOf(SEP, eStart)
        const eEnd = (nextSi >= 0 && nextSi < scanEnd) ? nextSi : scanEnd

        const l8 = dxfText.indexOf(GC8, eStart)
        if (l8 >= 0 && l8 < eEnd) {
          const ns = l8 + GC8.length
          const nn = dxfText.indexOf('\n', ns)
          const name = dxfText.substring(ns, (nn >= 0 && nn <= eEnd) ? nn : eEnd).trim()
          layerCounts.set(name, (layerCounts.get(name) || 0) + 1)
        }

        if (nextSi < 0 || nextSi >= scanEnd) break
        sepPos = nextSi
      }

      // 샘플링 비율에 따라 엔티티 수 추정
      if (extrapolated) {
        for (const [k, v] of layerCounts) {
          layerCounts.set(k, Math.round(v * ratio))
        }
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
      excluded: EXCLUDE_LAYER_PATTERNS.test(name),
      approx: extrapolated,
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
