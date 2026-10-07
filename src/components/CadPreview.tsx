/**
 * CadPreview: CAD(DXF/DWG) 레이어 선택 다이얼로그
 * DXF 텍스트에서 경량으로 레이어 목록을 추출 (전체 파싱 없이).
 * 선택된 레이어만 tldraw 캔버스에 임포트.
 * 기존 bimove UI 스타일(cad-layer-*)에 맞춤.
 */
import { useEffect, useState, useMemo, useCallback } from 'react'
import { aciToHex as aciToHexFull, detectPadding, isModelSpaceLayout, makeGcFormatter, STRUCTURAL_KEYWORDS, type DxfLayout, type DxfViewport, type ViewportClip } from '../lib/dxf-shared'

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

/** Multi-layout import info (passed when DXF has multiple AutoCAD tabs) */
export interface LayoutImportInfo {
  layouts: DxfLayout[]
  viewportsByLayout: Map<string, DxfViewport[]>
}

export interface CadPreviewProps {
  dxfText: string
  fileName: string
  fileSize: number
  isDwg: boolean
  onImport: (selectedLayers: Set<string>, dxfText: string, viewportClip?: ViewportClip | null, layoutInfo?: LayoutImportInfo | null) => void
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
    if (layouts.length > 1) {
      // Multi-layout: pass all layout info → ImportPanel creates separate pages
      console.log(`[CadPreview] Multi-layout import: ${layouts.map(l => l.name).join(', ')}`)
      onImport(selected, dxfText, null, { layouts, viewportsByLayout })
    } else {
      // Single layout (Model only): no viewport clip
      onImport(selected, dxfText, null)
    }
  }, [selected, dxfText, layouts, viewportsByLayout, onImport])

  // ESC 키로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const sizeMB = (fileSize / 1e6).toFixed(1)
  const fmt = isDwg ? 'DWG' : 'DXF'

  // 복사해서 정렬한다. 전엔 JSX 안에서 layouts.sort() 를 바로 불렀는데,
  // layouts 는 useState 배열이라 렌더 중에 state 를 제자리에서 뒤엎는 꼴이었다.
  // (extractLayoutsAndViewports 가 이미 정렬해서 주지만 그걸 믿고 쓰진 않는다)
  const layoutNames = [...layouts]
    .sort((a, b) => a.tabOrder - b.tabOrder)
    .map(l => l.name)
    .join(', ')

  return (
    <div className="cad-layer-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cad-layer-dialog">
        <div className="cad-layer-header">
          <strong>{fileName}</strong>{' '}
          <span style={{ fontSize: 12, color: '#888' }}>({fmt}, {sizeMB}MB)</span>
        </div>

        {layouts.length > 1 && (
          <div className="cad-layout-selector" style={{ fontSize: 12, color: '#888', padding: '4px 8px' }}>
            📑 {layouts.length}개 레이아웃 감지 ({layoutNames})
            → 각각 별도 페이지로 가져옵니다
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
// 진짜 집은 lib/dxf-shared.ts 다. 멀티 레이아웃 작업이 정리되면 옮긴다.
// eslint-disable-next-line react-refresh/only-export-components
export function extractLayoutsAndViewports(rawDxfText: string): {
  layouts: DxfLayout[]
  viewportsByLayout: Map<string, DxfViewport[]>
} {
  const dxfText = rawDxfText.indexOf('\r') >= 0
    ? rawDxfText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    : rawDxfText
  const padded = detectPadding(dxfText)
  const gc = makeGcFormatter(padded)

  // ── 1. OBJECTS 섹션에서 LAYOUT 파싱 ──
  const layouts: DxfLayout[] = []
  const SEC_OBJECTS = `\n${gc(0)}\nSECTION\n${gc(2)}\nOBJECTS\n`
  const ENDSEC = `\n${gc(0)}\nENDSEC`
  const objIdx = dxfText.indexOf(SEC_OBJECTS)
  if (objIdx >= 0) {
    const objBody = objIdx + SEC_OBJECTS.length
    const objEnd = dxfText.indexOf(ENDSEC, objBody)
    if (objEnd > objBody) {
      const objLines = dxfText.substring(objBody, objEnd).split('\n')

      // (그룹코드, 값) 쌍 단위로 걷는다.
      //
      // 전엔 줄바꿈+"0"+줄바꿈 을 indexOf 해서 엔티티 경계를 찾았다. 그런데
      // 그룹코드의 **값** 이 0 이면 거기서 끊긴다. LAYOUT 은 code 70(flag)
      // 이 0 인 게 흔해서, 그 뒤의 71(탭 순서) / 44,45(종이 크기) 를 통째로
      // 놓쳤다. 탭 순서가 전부 0 이 되면 *Paper_Space ↔ 레이아웃 매핑이
      // 어긋나서 엉뚱한 페이지에 clip 이 붙는다.
      let i = 0
      while (i + 1 < objLines.length) {
        if (objLines[i].trim() !== '0' || objLines[i + 1].trim() !== 'LAYOUT') { i += 2; continue }

        // AcDbLayout 서브클래스 안의 코드만 읽는다. 앞의 AcDbPlotSettings
        // 에도 같은 번호(44/45 등)가 있어서 섞으면 엉뚱한 값이 들어온다.
        const vals = new Map<number, string>()
        let inAcDbLayout = false
        let j = i + 2
        while (j + 1 < objLines.length && objLines[j].trim() !== '0') {
          const code = parseInt(objLines[j].trim())
          const value = objLines[j + 1]
          if (code === 100) inAcDbLayout = value.trim() === 'AcDbLayout'
          else if (inAcDbLayout && !Number.isNaN(code) && !vals.has(code)) vals.set(code, value)
          j += 2
        }
        i = j

        const name = vals.get(1)?.trim()
        if (!name) continue

        const num = (code: number): number | undefined => {
          const raw = vals.get(code)
          if (raw === undefined) return undefined
          const v = parseFloat(raw)
          return isFinite(v) ? v : undefined
        }

        layouts.push({
          name,
          isModelSpace: isModelSpaceLayout(name),
          tabOrder: num(71) ?? 0,
          paperWidth: num(44) ?? 0,
          paperHeight: num(45) ?? 0,
          extMinX: num(14), extMinY: num(24), extMaxX: num(15), extMaxY: num(25),
        })
      }
    }
  }

  // 레이아웃이 없으면 빈 결과 반환
  if (layouts.length <= 1) {
    return { layouts: [], viewportsByLayout: new Map() }
  }
  layouts.sort((a, b) => a.tabOrder - b.tabOrder)

  // 이름으로 모형 탭을 못 찾았으면 탭 순서가 가장 앞인 걸 모형으로 본다.
  // 하나도 모형이 아니면 모형 페이지가 아예 안 만들어지는데, 그건 전체를
  // 복사하는 것보다 나쁘다 (도면이 통째로 사라진다).
  if (!layouts.some(l => l.isModelSpace)) {
    console.warn(`[CadPreview] 이름으로 모형 탭을 못 찾음 → "${layouts[0].name}" 을 모형으로 본다`)
    layouts[0].isModelSpace = true
  }

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
        for (let n = 1; n < paperLayouts.length; n++) {
          blockToLayout.set(`*Paper_Space${n - 1}`, paperLayouts[n].name)
        }
      }

      // 여기도 쌍 단위로 걷는다. VIEWPORT 는 code 68(status) 이 0 인 경우가
      // 흔해서, 줄바꿈+"0"+줄바꿈 으로 자르면 엔티티가 중간에 끊기고 그 뒤의
      // 45(view height) / 69(뷰포트 ID) 를 못 읽는다.
      const blkLines = dxfText.substring(blkBody, blkEnd).split('\n')
      let currentLayoutName = ''
      let k = 0
      while (k + 1 < blkLines.length) {
        if (blkLines[k].trim() !== '0') { k += 2; continue }
        const type = blkLines[k + 1].trim()

        const vals = new Map<number, string>()
        let m = k + 2
        while (m + 1 < blkLines.length && blkLines[m].trim() !== '0') {
          const code = parseInt(blkLines[m].trim())
          if (!Number.isNaN(code) && !vals.has(code)) vals.set(code, blkLines[m + 1])
          m += 2
        }
        k = m

        if (type === 'BLOCK') {
          currentLayoutName = blockToLayout.get(vals.get(2)?.trim() ?? '') || ''
          continue
        }
        if (type === 'ENDBLK') { currentLayoutName = ''; continue }
        if (type !== 'VIEWPORT' || !currentLayoutName) continue

        const num = (code: number): number => {
          const v = parseFloat(vals.get(code) ?? '')
          return isFinite(v) ? v : 0
        }

        // group code 69 = 뷰포트 ID. 오토캐드는 모든 레이아웃에 ID 1 인
        // "종이공간 의사 뷰포트"를 자동으로 넣는다. 이건 도면을 비추는 창이
        // 아니라 종이 자신을 가리키므로, 여기의 12/22/45 를 모델공간 clip 으로
        // 쓰면 걸리는 도형이 없어 페이지가 통째로 빈다.
        if (num(69) === 1) continue

        const vpWidth = num(40)      // paper space 폭
        const vpHeight = num(41)     // paper space 높이
        const viewHeight = num(45)   // model space view height
        if (viewHeight <= 0 || vpHeight <= 0) continue

        // 12/22 는 **DCS**(디스플레이 좌표계) 기준 뷰 중심이지 WCS 가 아니다.
        // DCS 의 원점은 17/27 의 view target 이므로, 모델공간 중심은 둘을 더해야
        // 나온다. 평면 뷰에서 target 이 0 인 파일은 12/22 가 곧 모델 좌표라
        // 여태 맞아떨어졌지만, 원점에서 멀리 떨어진 곳에 그린 도면은 오토캐드가
        // target 에 그 위치를 넣고 12/22 에는 작은 오프셋만 남긴다. 그런 파일에서
        // target 을 빼먹으면 clip 상자가 원점 근처에 생겨 **도형이 하나도 안 걸리고
        // 페이지가 통째로 빈다** (실제로 "천정도" 가 44212 → 0 이 됐다).
        const centerX = num(17) + num(12)
        const centerY = num(27) + num(22)

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

        console.log(`[CadPreview] VIEWPORT "${currentLayoutName}": ` +
          `id=${num(69)} paper=(${num(10).toFixed(0)},${num(20).toFixed(0)}) ${vpWidth.toFixed(0)}x${vpHeight.toFixed(0)} ` +
          `view=(${num(12).toFixed(0)},${num(22).toFixed(0)}) target=(${num(17).toFixed(0)},${num(27).toFixed(0)}) h=${viewHeight.toFixed(0)} ` +
          `→ clip (${vp.clipMinX.toFixed(0)},${vp.clipMinY.toFixed(0)})~(${vp.clipMaxX.toFixed(0)},${vp.clipMaxY.toFixed(0)})`)

        let arr = viewportsByLayout.get(currentLayoutName)
        if (!arr) { arr = []; viewportsByLayout.set(currentLayoutName, arr) }
        arr.push(vp)
      }

      // 예전엔 여기서 "paper border 뷰포트" 랍시고 viewHeight 가 가장 큰 것을
      // 떨어냈다 (`filter(v => v.viewHeight < maxVH * 0.99)`). 두 가지가 틀렸다.
      //
      //  1. 같은 크기 뷰포트가 여럿이면 **전부** 날아간다. 실제로 "평면도" 가
      //     뷰포트 0개가 되어 페이지 자체가 안 만들어졌다.
      //  2. 레이아웃에서 제일 큰 뷰포트는 보통 **메인 뷰** 다. 그걸 떨어내면
      //     남는 건 자잘한 것뿐이라 clip 이 도면에서 통째로 빗나간다 —
      //     "천정도" 가 clip (-277,-192)~(1242,432) 로 44415 → 0 이 됐다.
      //
      // 종이 자신을 가리키는 의사 뷰포트는 위에서 group code 69 == 1 로 이미
      // 걸러낸다. 69 가 없는 파일이면 clip 이 넓어져 모델공간이 통째로 들어오는데,
      // 그건 페이지가 사라지는 것보다 낫다.
    }
  }

  // VIEWPORT 를 한 개도 찾지 못한 레이아웃은 clip 없이 남긴다.
  //
  // 전엔 LAYOUT 의 EXTMIN/EXTMAX (group code 14/24/15/25) 로 clip 을 합성했는데,
  // 이 네 개는 **종이공간 limits** 다 — 모델공간 범위가 아니다. A3 레이아웃이면
  // (0,0)~(420,297) 짜리 상자가 나오고, 원점에서 먼 좌표에 그려진 도면은 거기
  // 하나도 걸리지 않아 페이지가 통째로 빈다.

  return { layouts, viewportsByLayout }
}
