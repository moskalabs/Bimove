/**
 * CadPreview: CAD(DXF/DWG) 레이어 선택 다이얼로그
 * DXF 텍스트에서 경량으로 레이어 목록을 추출 (전체 파싱 없이).
 * 선택된 레이어만 tldraw 캔버스에 임포트.
 * 기존 bimove UI 스타일(cad-layer-*)에 맞춤.
 */
import { useEffect, useState, useMemo, useCallback } from 'react'
import { aciToHex as aciToHexFull, detectPadding, makeGcFormatter, STRUCTURAL_KEYWORDS, type DxfLayout, type DxfViewport, type ViewportClip } from '../lib/dxf-shared'

/** 기본 제외 레이어: viewport/paperspace 계열만 제외.
 * DEFPOINTS, TB-* 등은 실무에서 유용한 내용(라벨, 격자선)이
 * 있는 경우가 많아 기본 포함. 안 보려면 사용자가 직접 체크 해제. */
const EXCLUDE_LAYER_PATTERNS = /^(VIEWPORT|PAPER[-_ ]?SPACE|\*PAPER|\*MODEL)/i

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
  onImport: (selectedLayers: Set<string>, dxfText: string, viewportClip?: ViewportClip | null) => void
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
  const [layouts, setLayouts] = useState<DxfLayout[]>([])
  const [viewportsByLayout, setViewportsByLayout] = useState<Map<string, DxfViewport[]>>(new Map())
  const [selectedLayout, setSelectedLayout] = useState<string>('Model')

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

        // 레이아웃/뷰포트 파싱
        const { layouts: parsedLayouts, viewportsByLayout: parsedVP } = extractLayoutsAndViewports(dxfText)
        setLayouts(parsedLayouts)
        setViewportsByLayout(parsedVP)
        if (parsedLayouts.length > 1) {
          console.log(`[CadPreview] ${parsedLayouts.length}개 레이아웃: ${parsedLayouts.map(l => l.name).join(', ')}`)
        }

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
    let clip: ViewportClip | null = null
    if (selectedLayout !== 'Model') {
      const vps = viewportsByLayout.get(selectedLayout)
      if (vps && vps.length > 0) {
        clip = {
          minX: Math.min(...vps.map(v => v.clipMinX)),
          minY: Math.min(...vps.map(v => v.clipMinY)),
          maxX: Math.max(...vps.map(v => v.clipMaxX)),
          maxY: Math.max(...vps.map(v => v.clipMaxY)),
        }
        console.log(`[CadPreview] Layout "${selectedLayout}" viewport clip: (${clip.minX.toFixed(0)},${clip.minY.toFixed(0)})~(${clip.maxX.toFixed(0)},${clip.maxY.toFixed(0)})`)
      }
    }
    onImport(selected, dxfText, clip)
  }, [selected, dxfText, selectedLayout, viewportsByLayout, onImport])

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

        {layouts.length > 1 && (
          <div className="cad-layout-selector">
            <label>레이아웃:</label>
            <select value={selectedLayout} onChange={e => setSelectedLayout(e.target.value)}>
              {layouts
                .sort((a, b) => a.tabOrder - b.tabOrder)
                .map(l => (
                  <option key={l.name} value={l.name}>
                    {l.name}{l.isModelSpace ? ' (전체)' : ''}
                  </option>
                ))}
            </select>
          </div>
        )}

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

  // 0-1. 패딩 감지 → 패턴 동적 생성
  const padded = detectPadding(dxfText)
  const gc = makeGcFormatter(padded)

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
  // 비기하학 엔티티(OLE2FRAME 등)가 20MB+ 차지할 수 있으므로 엔티티 수 기반 제한 사용.
  // 기존 20MB 바이트 샘플링은 거대 OLE2FRAME 하나에 전부 잡혀서 나머지 엔티티를 놓침.
  const layerCounts = new Map<string, number>()
  const entIdx = dxfText.indexOf(SEC_ENTITIES)
  let extrapolated = false
  if (entIdx >= 0) {
    const bodyStart = entIdx + SEC_ENTITIES.length
    const entEnd = dxfText.indexOf(ENDSEC, bodyStart)
    if (entEnd > bodyStart) {
      const sectionLen = entEnd - bodyStart
      const MAX_ENTITIES_SCAN = 50_000  // 엔티티 수 기반 제한 (바이트 제한 대신)
      let entityScanned = 0

      let sepPos = bodyStart - 1

      while (entityScanned < MAX_ENTITIES_SCAN) {
        const si = dxfText.indexOf(SEP, sepPos)
        if (si < 0 || si >= entEnd) break

        const eStart = si + SEP.length
        const nextSi = dxfText.indexOf(SEP, eStart)
        const eEnd = (nextSi >= 0 && nextSi < entEnd) ? nextSi : entEnd

        entityScanned++

        const l8 = dxfText.indexOf(GC8, eStart)
        if (l8 >= 0 && l8 < eEnd) {
          const ns = l8 + GC8.length
          const nn = dxfText.indexOf('\n', ns)
          const name = dxfText.substring(ns, (nn >= 0 && nn <= eEnd) ? nn : eEnd).trim()
          layerCounts.set(name, (layerCounts.get(name) || 0) + 1)
        }

        if (nextSi < 0 || nextSi >= entEnd) break
        sepPos = nextSi
      }

      // 엔티티 수 제한에 걸렸으면 비율 추정
      if (entityScanned >= MAX_ENTITIES_SCAN) {
        extrapolated = true
        // 스캔한 바이트 범위 대비 전체 섹션 비율로 추정
        const scannedBytes = (sepPos > bodyStart) ? sepPos - bodyStart : sectionLen
        const ratio = sectionLen / Math.max(1, scannedBytes)
        if (ratio > 1.05) {
          for (const [k, v] of layerCounts) {
            layerCounts.set(k, Math.round(v * ratio))
          }
        }
      }
    }
  }

  // --- 2b. ENTITIES가 비어있으면 *Paper_Space 블록에서 레이어 스캔 ---
  if (layerCounts.size === 0) {
    const SEC_BLOCKS = `\n${gc(0)}\nSECTION\n${gc(2)}\nBLOCKS\n`
    const blkIdx = dxfText.indexOf(SEC_BLOCKS)
    if (blkIdx >= 0) {
      const blkBody = blkIdx + SEC_BLOCKS.length
      const blkEnd = dxfText.indexOf(ENDSEC, blkBody)
      if (blkEnd > blkBody) {
        // *Paper_Space 블록 찾기
        const BLOCK_HDR = `\n${gc(0)}\nBLOCK\n`
        const ENDBLK = `\n${gc(0)}\nENDBLK`
        let bpos = blkBody
        while (true) {
          const bi = dxfText.indexOf(BLOCK_HDR, bpos)
          if (bi < 0 || bi >= blkEnd) break
          const bStart = bi + BLOCK_HDR.length
          // 블록 이름 추출
          const n2i = dxfText.indexOf(GC2, bi)
          const nextEnd = dxfText.indexOf(ENDBLK, bStart)
          const blockEnd = (nextEnd >= 0 && nextEnd < blkEnd) ? nextEnd : blkEnd
          if (n2i >= 0 && n2i < blockEnd) {
            const nvs = n2i + GC2.length
            const nvn = dxfText.indexOf('\n', nvs)
            const blockName = dxfText.substring(nvs, (nvn >= 0 && nvn <= blockEnd) ? nvn : blockEnd).trim()
            if (/^\*Paper_Space/i.test(blockName)) {
              console.log(`[CadPreview] Paper Space 블록 "${blockName}"에서 레이어 스캔`)
              // 블록 내 엔티티 스캔
              let sepPos2 = bStart
              while (true) {
                const si2 = dxfText.indexOf(SEP, sepPos2)
                if (si2 < 0 || si2 >= blockEnd) break
                const eStart2 = si2 + SEP.length
                const nextSi2 = dxfText.indexOf(SEP, eStart2)
                const eEnd2 = (nextSi2 >= 0 && nextSi2 < blockEnd) ? nextSi2 : blockEnd
                const l8 = dxfText.indexOf(GC8, eStart2)
                if (l8 >= 0 && l8 < eEnd2) {
                  const ns = l8 + GC8.length
                  const nn = dxfText.indexOf('\n', ns)
                  const name = dxfText.substring(ns, (nn >= 0 && nn <= eEnd2) ? nn : eEnd2).trim()
                  layerCounts.set(name, (layerCounts.get(name) || 0) + 1)
                }
                if (nextSi2 < 0 || nextSi2 >= blockEnd) break
                sepPos2 = nextSi2
              }
            }
          }
          bpos = blockEnd
        }
        if (layerCounts.size > 0) {
          console.log(`[CadPreview] Paper Space fallback: ${layerCounts.size}개 레이어 발견`)
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

// ACI 색상 → dxf-shared.ts의 aciToHexFull (256색 테이블)
function aciToHex(aci: number): string {
  return aciToHexFull(aci) ?? '#666666'
}

/**
 * DXF에서 Layout + Viewport 정보 경량 추출.
 * OBJECTS 섹션의 LAYOUT 엔티티 + BLOCKS 섹션의 *Paper_Space 내 VIEWPORT 엔티티.
 */
function extractLayoutsAndViewports(rawDxfText: string): {
  layouts: DxfLayout[]
  viewportsByLayout: Map<string, DxfViewport[]>
} {
  const dxfText = rawDxfText.indexOf('\r') >= 0
    ? rawDxfText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    : rawDxfText
  const padded = detectPadding(dxfText)
  const gc = makeGcFormatter(padded)
  const SEP = `\n${gc(0)}\n`

  // ── 1. OBJECTS 섹션에서 LAYOUT 파싱 ──
  const layouts: DxfLayout[] = []
  const SEC_OBJECTS = `\n${gc(0)}\nSECTION\n${gc(2)}\nOBJECTS\n`
  const ENDSEC = `\n${gc(0)}\nENDSEC`
  const objIdx = dxfText.indexOf(SEC_OBJECTS)
  if (objIdx >= 0) {
    const objBody = objIdx + SEC_OBJECTS.length
    const objEnd = dxfText.indexOf(ENDSEC, objBody)
    if (objEnd > objBody) {
      const GC1 = `\n${gc(1)}\n`
      const GC14 = `\n${gc(14)}\n`
      const GC15 = `\n${gc(15)}\n`
      const GC24 = `\n${gc(24)}\n`
      const GC25 = `\n${gc(25)}\n`
      const GC70 = `\n${gc(70)}\n`
      const GC71 = `\n${gc(71)}\n`
      const GC44 = `\n${gc(44)}\n`
      const GC45 = `\n${gc(45)}\n`
      const LAYOUT_MARKER = `${SEP.slice(0, -1)}\nLAYOUT\n`

      // AcDbLayout 서브클래스 뒤의 코드만 읽어야 안전
      let pos = objBody
      while (true) {
        pos = dxfText.indexOf(LAYOUT_MARKER, pos)
        if (pos < 0 || pos >= objEnd) break
        const lStart = pos
        const nextEntity = dxfText.indexOf(SEP, pos + LAYOUT_MARKER.length)
        const lEnd = (nextEntity >= 0 && nextEntity < objEnd) ? nextEntity : objEnd

        // AcDbLayout 서브클래스 확인
        const acDbIdx = dxfText.indexOf('AcDbLayout', lStart)
        if (acDbIdx < 0 || acDbIdx >= lEnd) { pos = lStart + 10; continue }

        // AcDbLayout 뒤에서 group code 파싱
        const afterAcDb = acDbIdx
        const nameIdx = dxfText.indexOf(GC1, afterAcDb)
        if (nameIdx < 0 || nameIdx >= lEnd) { pos = lStart + 10; continue }
        const name = dxfText.substring(nameIdx + GC1.length).split('\n', 1)[0].trim()

        const flagIdx = dxfText.indexOf(GC70, afterAcDb)
        const flags = (flagIdx >= 0 && flagIdx < lEnd)
          ? parseInt(dxfText.substring(flagIdx + GC70.length).split('\n', 1)[0]) || 0
          : 0

        const tabIdx = dxfText.indexOf(GC71, afterAcDb)
        const tabOrder = (tabIdx >= 0 && tabIdx < lEnd)
          ? parseInt(dxfText.substring(tabIdx + GC71.length).split('\n', 1)[0]) || 0
          : 0

        const pwIdx = dxfText.indexOf(GC44, afterAcDb)
        const paperW = (pwIdx >= 0 && pwIdx < lEnd)
          ? parseFloat(dxfText.substring(pwIdx + GC44.length).split('\n', 1)[0]) || 0
          : 0

        const phIdx = dxfText.indexOf(GC45, afterAcDb)
        const paperH = (phIdx >= 0 && phIdx < lEnd)
          ? parseFloat(dxfText.substring(phIdx + GC45.length).split('\n', 1)[0]) || 0
          : 0

        // EXTMIN/EXTMAX (Model Space 범위): code 14/24, 15/25
        const readGC = (pat: string): number | undefined => {
          const idx = dxfText.indexOf(pat, afterAcDb)
          if (idx < 0 || idx >= lEnd) return undefined
          const val = parseFloat(dxfText.substring(idx + pat.length).split('\n', 1)[0])
          return isFinite(val) ? val : undefined
        }
        const extMinX = readGC(GC14)
        const extMinY = readGC(GC24)
        const extMaxX = readGC(GC15)
        const extMaxY = readGC(GC25)

        layouts.push({
          name,
          isModelSpace: (flags & 1) !== 0,
          tabOrder,
          paperWidth: paperW,
          paperHeight: paperH,
          extMinX, extMinY, extMaxX, extMaxY,
        })

        pos = lEnd
      }
    }
  }

  // 레이아웃이 없으면 빈 결과 반환
  if (layouts.length <= 1) {
    return { layouts: [], viewportsByLayout: new Map() }
  }
  layouts.sort((a, b) => a.tabOrder - b.tabOrder)

  // ── 2. BLOCKS 섹션에서 *Paper_Space 블록 내 VIEWPORT 파싱 ──
  const viewportsByLayout = new Map<string, DxfViewport[]>()
  const SEC_BLOCKS = `\n${gc(0)}\nSECTION\n${gc(2)}\nBLOCKS\n`
  const blkIdx = dxfText.indexOf(SEC_BLOCKS)
  if (blkIdx >= 0) {
    const blkBody = blkIdx + SEC_BLOCKS.length
    const blkEnd = dxfText.indexOf(ENDSEC, blkBody)
    if (blkEnd > blkBody) {
      // *Paper_Space → 첫 번째 paper layout, *Paper_Space0 → 두 번째... (DXF 표준)
      const paperLayouts = layouts.filter(l => !l.isModelSpace).sort((a, b) => a.tabOrder - b.tabOrder)
      const blockToLayout = new Map<string, string>()
      if (paperLayouts.length > 0) {
        blockToLayout.set('*Paper_Space', paperLayouts[0].name)
        for (let i = 1; i < paperLayouts.length; i++) {
          blockToLayout.set(`*Paper_Space${i - 1}`, paperLayouts[i].name)
        }
      }

      const GC2 = `\n${gc(2)}\n`
      // GC10, GC20 reserved for future entity position parsing
      const GC12 = `\n${gc(12)}\n`
      const GC22 = `\n${gc(22)}\n`
      const GC40 = `\n${gc(40)}\n`
      const GC41 = `\n${gc(41)}\n`
      const GC45 = `\n${gc(45)}\n`

      const chunks = ('\n' + dxfText.substring(blkBody, blkEnd)).split(SEP)
      let currentLayoutName = ''

      for (const chunk of chunks) {
        const type = chunk.split('\n', 1)[0].trim()

        if (type === 'BLOCK') {
          const ni = chunk.indexOf(GC2)
          const blockName = ni >= 0 ? chunk.substring(ni + GC2.length).split('\n', 1)[0].trim() : ''
          currentLayoutName = blockToLayout.get(blockName) || ''
        } else if (type === 'ENDBLK') {
          currentLayoutName = ''
        } else if (type === 'VIEWPORT' && currentLayoutName) {
          // VIEWPORT 파싱: model space view window
          const floatVal = (pat: string): number => {
            const i = chunk.indexOf(pat)
            return i >= 0 ? parseFloat(chunk.substring(i + pat.length).split('\n', 1)[0]) || 0 : 0
          }

          const vpWidth = floatVal(GC40)
          const vpHeight = floatVal(GC41)
          const centerX = floatVal(GC12)   // model space center
          const centerY = floatVal(GC22)   // model space center
          const viewHeight = floatVal(GC45)  // model space view height

          // 유효한 뷰포트만 (viewHeight > 0, paper border 뷰포트 제외)
          if (viewHeight > 0 && vpHeight > 0) {
            const viewWidth = viewHeight * (vpWidth / vpHeight)
            const vp: DxfViewport = {
              layoutName: currentLayoutName,
              centerX, centerY,
              viewWidth, viewHeight,
              clipMinX: centerX - viewWidth / 2,
              clipMinY: centerY - viewHeight / 2,
              clipMaxX: centerX + viewWidth / 2,
              clipMaxY: centerY + viewHeight / 2,
            }

            let arr = viewportsByLayout.get(currentLayoutName)
            if (!arr) { arr = []; viewportsByLayout.set(currentLayoutName, arr) }
            arr.push(vp)
          }
        }
      }

      // 각 레이아웃에서 paper border 뷰포트 제거 (가장 큰 viewHeight)
      for (const [name, vps] of viewportsByLayout) {
        if (vps.length > 1) {
          const maxVH = Math.max(...vps.map(v => v.viewHeight))
          viewportsByLayout.set(name, vps.filter(v => v.viewHeight < maxVH * 0.99))
        }
      }
    }
  }

  // ── 3. Fallback: VIEWPORT 없는 레이아웃 → LAYOUT EXTMIN/EXTMAX로 합성 ──
  for (const layout of layouts) {
    if (layout.isModelSpace) continue
    if (viewportsByLayout.has(layout.name) && viewportsByLayout.get(layout.name)!.length > 0) continue

    const extW = (layout.extMaxX ?? 0) - (layout.extMinX ?? 0)
    const extH = (layout.extMaxY ?? 0) - (layout.extMinY ?? 0)
    if (extW > 1 && extH > 1) {
      const minX = layout.extMinX ?? 0
      const minY = layout.extMinY ?? 0
      const maxX = layout.extMaxX ?? 0
      const maxY = layout.extMaxY ?? 0
      viewportsByLayout.set(layout.name, [{
        layoutName: layout.name,
        centerX: (minX + maxX) / 2,
        centerY: (minY + maxY) / 2,
        viewWidth: extW,
        viewHeight: extH,
        clipMinX: minX,
        clipMinY: minY,
        clipMaxX: maxX,
        clipMaxY: maxY,
      }])
    }
  }

  return { layouts, viewportsByLayout }
}
