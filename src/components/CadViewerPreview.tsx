/**
 * CadViewerPreview: mlightcad cad-viewer 기반 CAD 프리뷰 + 레이어 선택
 * 기존 CadPreview를 대체 — WebGL 렌더링 프리뷰 + 레이어 체크박스
 */
import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { AcApDocManager } from '@mlightcad/cad-simple-viewer'
import { STRUCTURAL_KEYWORDS, aciToHex as aciToHexFull } from '../lib/dxf-shared'
import type { ViewportClip } from '../lib/dxf-shared'

const EXCLUDE_LAYER_PATTERNS = /^(VIEWPORT|PAPER[-_ ]?SPACE|\*PAPER|\*MODEL)/i

interface LayerInfo {
  name: string
  color: string
  likelyStructural: boolean
  excluded?: boolean
}

export interface CadPreviewProps {
  dxfText: string
  fileName: string
  fileSize: number
  isDwg: boolean
  onImport: (selectedLayers: Set<string>, dxfText: string, viewportClip?: ViewportClip | null) => void
  onClose: () => void
}

export default function CadViewerPreview({
  dxfText,
  fileName,
  fileSize,
  isDwg,
  onImport,
  onClose,
}: CadPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const managerRef = useRef<AcApDocManager | null>(null)
  const [layers, setLayers] = useState<LayerInfo[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 모달 열릴 때 body data attr 추가
  useEffect(() => {
    document.body.dataset.modalOpen = 'true'
    return () => { delete document.body.dataset.modalOpen }
  }, [])

  // cad-viewer 초기화 + 도면 열기
  useEffect(() => {
    if (!containerRef.current) return

    let destroyed = false

    async function init() {
      try {
        // 기존 인스턴스 제거
        try {
          const existing = AcApDocManager.tryGetInstance()
          if (existing) await existing.destroy()
        } catch { /* no instance */ }

        const mgr = AcApDocManager.createInstance({
          container: containerRef.current!,
          autoResize: true,
          baseUrl: 'https://cdn.jsdelivr.net/gh/mlightcad/cad-data@main/',
          webworkerFileUrls: {
            mtextRender: '/mtext-renderer-worker.js',
          },
        })

        if (!mgr || destroyed) return
        managerRef.current = mgr

        // DXF 텍스트 → ArrayBuffer
        const encoder = new TextEncoder()
        const buf = encoder.encode(dxfText).buffer as ArrayBuffer

        // 내용은 항상 DXF 텍스트 (DWG는 ImportPanel에서 이미 변환됨)
        // 확장자를 .dxf로 강제해야 cad-viewer가 DXF 파서를 사용함
        const dxfFileName = fileName.replace(/\.dwg$/i, '.dxf')
        const ok = await mgr.openDocument(dxfFileName, buf, {})
        if (destroyed) return

        if (!ok) {
          // 부분 파싱 성공 시에도 계속 진행
          console.warn('[CadViewer] openDocument returned false, checking partial content...')
        }

        // 레이어 추출
        const doc = mgr.curDocument
        const db = doc.database
        const layerTable = db.tables.layerTable

        const layerList: LayerInfo[] = []
        for (const layer of layerTable.newIterator()) {
          const name = layer.name
          const colorIdx = layer.color?.colorIndex ?? 7
          layerList.push({
            name,
            color: aciToHexFull(colorIdx) ?? rgbFromColor(layer.color) ?? '#666666',
            likelyStructural: STRUCTURAL_KEYWORDS.test(name),
            excluded: EXCLUDE_LAYER_PATTERNS.test(name),
          })
        }

        // entity 수가 없으므로 이름 순 정렬
        layerList.sort((a, b) => a.name.localeCompare(b.name))

        setLayers(layerList)

        // 초기 선택: 구조 레이어 있으면 구조만, 없으면 전체
        const hasStructural = layerList.some(l => l.likelyStructural)
        const initialSelected = hasStructural
          ? new Set(layerList.filter(l => l.likelyStructural && !EXCLUDE_LAYER_PATTERNS.test(l.name)).map(l => l.name))
          : new Set(layerList.filter(l => !EXCLUDE_LAYER_PATTERNS.test(l.name)).map(l => l.name))
        setSelected(initialSelected)
        setLoading(false)
      } catch (err) {
        if (!destroyed) {
          console.error('[CadViewer] init error:', err)
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      }
    }

    init()

    return () => {
      destroyed = true
      const mgr = managerRef.current
      if (mgr) {
        mgr.destroy().catch(() => {})
        managerRef.current = null
      }
    }
  }, [dxfText, fileName])

  // 레이어 on/off 토글 → cad-viewer 뷰에 반영
  const toggleLayer = useCallback((name: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      const isOn = next.has(name)
      if (isOn) next.delete(name)
      else next.add(name)

      // cad-viewer 레이어 가시성 동기화
      try {
        const mgr = managerRef.current
        if (mgr) {
          const doc = mgr.curDocument
          doc.layerService.setLayerOn(name, !isOn)
          mgr.regen()
        }
      } catch { /* ignore */ }

      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    const allNames = new Set(layers.map(l => l.name))
    setSelected(allNames)
    syncAllLayers(allNames)
  }, [layers])

  const selectNone = useCallback(() => {
    setSelected(new Set())
    syncAllLayers(new Set())
  }, [])

  const selectStructural = useCallback(() => {
    const names = new Set(layers.filter(l => l.likelyStructural).map(l => l.name))
    setSelected(names)
    syncAllLayers(names)
  }, [layers])

  // 전체 레이어 가시성 동기화
  const syncAllLayers = useCallback((sel: Set<string>) => {
    try {
      const mgr = managerRef.current
      if (!mgr) return
      const doc = mgr.curDocument
      for (const layer of layers) {
        doc.layerService.setLayerOn(layer.name, sel.has(layer.name))
      }
      mgr.regen()
    } catch { /* ignore */ }
  }, [layers])

  const hasStructural = useMemo(() => layers.some(l => l.likelyStructural), [layers])

  const handleImport = useCallback(() => {
    if (selected.size === 0) return
    // viewport clip은 현재 뷰의 extent에서 추출 (추후 layout 지원)
    onImport(selected, dxfText, null)
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
    <div className="cad-layer-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cad-viewer-dialog">
        {/* 헤더 */}
        <div className="cad-layer-header">
          <strong>{fileName}</strong>{' '}
          <span style={{ fontSize: 12, color: '#888' }}>({fmt}, {sizeMB}MB)</span>
        </div>

        {/* 메인: 프리뷰 + 레이어 리스트 */}
        <div className="cad-viewer-body">
          {/* 왼쪽: WebGL 프리뷰 */}
          <div className="cad-viewer-canvas-wrap">
            <div
              ref={containerRef}
              className="cad-viewer-canvas"
            />
            {loading && (
              <div className="cad-viewer-loading">
                <div className="import-loading-spinner" />
                <div style={{ marginTop: 8, color: '#888' }}>도면 렌더링 중...</div>
              </div>
            )}
            {error && (
              <div className="cad-viewer-loading">
                <div style={{ color: '#e55' }}>렌더링 실패: {error}</div>
              </div>
            )}
          </div>

          {/* 오른쪽: 레이어 선택 */}
          <div className="cad-viewer-sidebar">
            <div className="cad-layer-actions">
              <button className="cad-layer-action-btn" onClick={selectAll}>전체</button>
              <button className="cad-layer-action-btn" onClick={selectNone}>해제</button>
              {hasStructural && (
                <button className="cad-layer-action-btn cad-layer-action-primary" onClick={selectStructural}>
                  구조
                </button>
              )}
            </div>
            <div className="cad-layer-list">
              {layers.map(layer => (
                <label
                  key={layer.name}
                  className={`cad-layer-row${selected.has(layer.name) ? ' selected' : ''}`}
                  onClick={() => toggleLayer(layer.name)}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(layer.name)}
                    onChange={() => {}}
                    onClick={e => e.stopPropagation()}
                  />
                  <span className="cad-layer-dot" style={{ background: layer.color }} />
                  <span className="cad-layer-name">
                    {layer.name}
                    {layer.likelyStructural && <span className="cad-layer-tag">구조</span>}
                    {layer.excluded && <span className="cad-layer-tag" style={{ background: '#666', color: '#ccc' }}>보조</span>}
                  </span>
                </label>
              ))}
              {layers.length === 0 && !loading && (
                <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>
                  레이어를 찾을 수 없습니다.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 푸터 */}
        <div className="cad-layer-footer">
          <span style={{ fontSize: 12, color: '#888' }}>
            {selected.size}개 레이어 선택됨
          </span>
          <div>
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
    </div>
  )
}

/** AcCmColor → hex string 변환 (RGB fallback) */
function rgbFromColor(color: unknown): string | null {
  if (!color || typeof color !== 'object') return null
  const c = color as Record<string, unknown>
  if (typeof c.red === 'number' && typeof c.green === 'number' && typeof c.blue === 'number') {
    const r = (c.red as number).toString(16).padStart(2, '0')
    const g = (c.green as number).toString(16).padStart(2, '0')
    const b = (c.blue as number).toString(16).padStart(2, '0')
    return `#${r}${g}${b}`
  }
  return null
}
