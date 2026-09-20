/**
 * CadPreview: WebGL 기반 CAD(DXF/DWG) 전체화면 프리뷰 + 레이어 선택
 * dxf-viewer(Three.js WebGL)를 사용하여 대형 도면도 60fps로 렌더링.
 * 레이어를 선택한 뒤 "가져오기"를 누르면 tldraw로 임포트.
 */
import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { DxfViewer } from 'dxf-viewer'
import * as THREE from 'three'

const STRUCTURAL_KEYWORDS = /wall|window|win(?!ter)|door|stair|column|beam|slab|elev|건축|벽|창문|문/i

interface LayerInfo {
  name: string
  color: number
  visible: boolean
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
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<DxfViewer | null>(null)
  const blobUrlRef = useRef<string | null>(null)

  const [layers, setLayers] = useState<LayerInfo[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)

  // 모달 열릴 때 body data attr 추가
  useEffect(() => {
    document.body.dataset.modalOpen = 'true'
    return () => { delete document.body.dataset.modalOpen }
  }, [])

  // dxf-viewer 초기화 + 로드
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let destroyed = false

    const init = async () => {
      try {
        // Blob URL 생성
        const blob = new Blob([dxfText], { type: 'text/plain;charset=utf-8' })
        const blobUrl = URL.createObjectURL(blob)
        blobUrlRef.current = blobUrl

        // DxfViewer 생성
        const viewer = new DxfViewer(container, {
          clearColor: new THREE.Color('#f8f9fa'),
          autoResize: true,
          colorCorrection: true,
          blackWhiteInversion: true,
          antialias: true,
          retainParsedDxf: false,
        })
        viewerRef.current = viewer

        // 로드 (Worker 로드 실패 시 메인스레드 fallback)
        setProgress('도면 파싱 중...')
        const progressCbk = (phase: string, processedSize: number, totalSize: number) => {
          if (destroyed) return
          const pct = totalSize > 0 ? Math.round((processedSize / totalSize) * 100) : 0
          if (phase === 'fetch') {
            setProgress(`다운로드 ${pct}%`)
          } else if (phase === 'parse') {
            setProgress(`파싱 ${pct}%`)
          } else {
            setProgress(`렌더 준비 ${pct}%`)
          }
        }

        try {
          await viewer.Load({
            url: blobUrl,
            progressCbk,
            workerFactory: () =>
              new Worker(
                new URL('../lib/dxf-viewer.worker.ts', import.meta.url),
                { type: 'module' },
              ),
          })
        } catch (workerErr) {
          console.warn('[CadPreview] Worker 로드 실패, 메인스레드 fallback:', workerErr)
          // Worker 없이 재시도 (메인 스레드 파싱)
          await viewer.Load({ url: blobUrl, progressCbk })
        }

        if (destroyed) return

        // 레이어 추출
        const rawLayers = [...(viewer.GetLayers() as Iterable<{ name: string; color: number }>)]
        const layerInfos: LayerInfo[] = rawLayers.map((l) => ({
          name: l.name,
          color: l.color,
          visible: true,
          likelyStructural: STRUCTURAL_KEYWORDS.test(l.name),
        }))
        setLayers(layerInfos)

        // 초기 선택: 구조 레이어가 있으면 구조만, 없으면 전체
        const hasStructural = layerInfos.some((l) => l.likelyStructural)
        const initialSelected = hasStructural
          ? new Set(layerInfos.filter((l) => l.likelyStructural).map((l) => l.name))
          : new Set(layerInfos.map((l) => l.name))
        setSelected(initialSelected)

        setLoading(false)
        setProgress('')
      } catch (err) {
        if (destroyed) return
        console.error('[CadPreview] Load 에러:', err)
        setError(`도면 로드 실패: ${err instanceof Error ? err.message : String(err)}`)
        setLoading(false)
      }
    }

    init()

    return () => {
      destroyed = true
      viewerRef.current?.Destroy()
      viewerRef.current = null
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
    }
  }, [dxfText])

  // 레이어 토글
  const toggleLayer = useCallback((name: string) => {
    const viewer = viewerRef.current
    setSelected((prev) => {
      const next = new Set(prev)
      const nowSelected = !next.has(name)
      if (nowSelected) next.add(name)
      else next.delete(name)

      // WebGL 프리뷰 실시간 반영
      if (viewer) {
        try { viewer.ShowLayer(name, nowSelected) } catch { /* layer might not exist */ }
      }

      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    const viewer = viewerRef.current
    const all = new Set(layers.map((l) => l.name))
    setSelected(all)
    if (viewer) layers.forEach((l) => { try { viewer.ShowLayer(l.name, true) } catch {} })
  }, [layers])

  const selectNone = useCallback(() => {
    const viewer = viewerRef.current
    setSelected(new Set())
    if (viewer) layers.forEach((l) => { try { viewer.ShowLayer(l.name, false) } catch {} })
  }, [layers])

  const selectStructural = useCallback(() => {
    const viewer = viewerRef.current
    const structural = new Set(layers.filter((l) => l.likelyStructural).map((l) => l.name))
    setSelected(structural)
    if (viewer) {
      layers.forEach((l) => {
        try { viewer.ShowLayer(l.name, structural.has(l.name)) } catch {}
      })
    }
  }, [layers])

  const hasStructural = useMemo(() => layers.some((l) => l.likelyStructural), [layers])

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

  // 파일 크기 포맷
  const sizeMB = (fileSize / 1e6).toFixed(1)
  const fmt = isDwg ? 'DWG' : 'DXF'

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 600,
      background: '#1e2228', display: 'flex', flexDirection: 'column',
    }}>
      {/* 상단바 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 16px', background: '#2a2e35', borderBottom: '1px solid #3a3f47',
        zIndex: 601,
      }}>
        <span style={{ color: '#ddd', fontSize: 14, flex: 1 }}>
          {fileName} <span style={{ color: '#888', fontSize: 12 }}>({fmt}, {sizeMB}MB)</span>
        </span>
        <button
          onClick={onClose}
          style={{
            background: '#444', color: '#fff', border: 'none', borderRadius: 6,
            padding: '4px 12px', cursor: 'pointer', fontSize: 13,
          }}
        >
          닫기
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 레이어 사이드바 */}
        <div style={{
          width: 240, background: '#262a31', borderRight: '1px solid #3a3f47',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {/* 빠른 선택 */}
          <div style={{
            padding: '8px 10px', borderBottom: '1px solid #3a3f47',
            display: 'flex', gap: 4, flexWrap: 'wrap',
          }}>
            <button onClick={selectAll} style={quickBtnStyle}>전체</button>
            <button onClick={selectNone} style={quickBtnStyle}>해제</button>
            {hasStructural && (
              <button onClick={selectStructural} style={{ ...quickBtnStyle, background: '#3b6fd4', color: '#fff' }}>
                구조
              </button>
            )}
          </div>

          {/* 레이어 목록 */}
          <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
            {layers.map((layer) => (
              <label
                key={layer.name}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 10px', cursor: 'pointer', fontSize: 12,
                  background: selected.has(layer.name) ? 'rgba(59,111,212,0.15)' : 'transparent',
                  color: '#ccc',
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(layer.name)}
                  onChange={() => toggleLayer(layer.name)}
                  style={{ accentColor: '#3b6fd4' }}
                />
                <span style={{
                  width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                  background: `#${(layer.color & 0xFFFFFF).toString(16).padStart(6, '0')}`,
                }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {layer.name}
                  {layer.likelyStructural && (
                    <span style={{
                      marginLeft: 4, fontSize: 10, padding: '1px 4px',
                      background: '#3b6fd4', borderRadius: 3, color: '#fff',
                    }}>
                      구조
                    </span>
                  )}
                </span>
              </label>
            ))}
            {layers.length === 0 && !loading && (
              <div style={{ padding: 16, color: '#888', fontSize: 12 }}>레이어 없음</div>
            )}
          </div>

          {/* 선택 요약 + 가져오기 버튼 */}
          <div style={{
            padding: '10px', borderTop: '1px solid #3a3f47',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <span style={{ fontSize: 11, color: '#888' }}>
              {selected.size} / {layers.length} 레이어 선택
            </span>
            <button
              onClick={handleImport}
              disabled={selected.size === 0}
              style={{
                padding: '8px 0', border: 'none', borderRadius: 6,
                background: selected.size > 0 ? '#3b6fd4' : '#444',
                color: '#fff', fontSize: 13, cursor: selected.size > 0 ? 'pointer' : 'default',
                opacity: selected.size > 0 ? 1 : 0.5,
              }}
            >
              {selected.size > 0 ? `${selected.size}개 레이어 가져오기` : '레이어를 선택하세요'}
            </button>
          </div>
        </div>

        {/* WebGL 캔버스 영역 */}
        <div
          ref={containerRef}
          style={{ flex: 1, position: 'relative', background: '#f8f9fa' }}
        >
          {/* 로딩 오버레이 */}
          {loading && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex',
              flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(30,34,40,0.85)', zIndex: 1,
            }}>
              <div style={{ color: '#fff', fontSize: 16, marginBottom: 8 }}>
                도면 로딩 중...
              </div>
              <div style={{ color: '#aaa', fontSize: 13 }}>{progress}</div>
            </div>
          )}
          {/* 에러 */}
          {error && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              background: 'rgba(30,34,40,0.95)', zIndex: 1,
            }}>
              <div style={{ color: '#f66', fontSize: 14, textAlign: 'center', padding: 24 }}>
                {error}
                <br />
                <button
                  onClick={onClose}
                  style={{ marginTop: 12, padding: '6px 16px', border: '1px solid #666', borderRadius: 6, background: 'transparent', color: '#ccc', cursor: 'pointer' }}
                >
                  닫기
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const quickBtnStyle: React.CSSProperties = {
  padding: '3px 8px', fontSize: 11, border: '1px solid #555',
  borderRadius: 4, background: '#333', color: '#ccc', cursor: 'pointer',
}
