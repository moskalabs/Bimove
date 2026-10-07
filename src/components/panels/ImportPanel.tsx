import { useState, Suspense } from 'react'
import { PageRecordType } from 'tldraw'
import { useEditor } from '../../context/EditorContext'
import { useToast } from '../../context/ToastContext'
import { uploadImage } from '../../lib/project'
import { pickCadFile, dwgToDxfBytes, decodeDxfBytes, commitCadImportV2 } from '../../lib/dxf'
import type { DxfLayout, ViewportClip } from '../../lib/dxf-shared'
import type { LayoutImportInfo } from '../CadPreview'
import { lazyWithReload } from '../../lib/lazyWithReload'
import { importPdf } from '../../lib/pdfImport'

const CadPreview = lazyWithReload(() => import('../CadPreview'))

interface PreviewData {
  dxfText: string
  fileName: string
  fileSize: number
  isDwg: boolean
}

export function ImportPanel() {
  const editor = useEditor()
  const { toast } = useToast()
  const [loading, setLoading] = useState<string | null>(null)
  const [previewData, setPreviewData] = useState<PreviewData | null>(null)

  const notify = {
    onSuccess: (msg: string) => toast(msg, 'success'),
    onError: (msg: string) => { toast(msg, 'error'); setLoading(null) },
  }

  const handleCadImport = async () => {
    if (!editor) return
    const file = await pickCadFile()
    if (!file) return

    const sizeMB = (file.size / 1024 / 1024).toFixed(1)
    const isDwg = file.name.toLowerCase().endsWith('.dwg')

    try {
      let dxfText: string

      if (isDwg) {
        // DWG → DXF 변환
        setLoading(`DWG → DXF 변환 중... (${sizeMB}MB)`)
        const buffer = await file.arrayBuffer()
        const dxfBytes = await dwgToDxfBytes(buffer)
        if (!dxfBytes || dxfBytes.length < 100) {
          toast('DWG 변환 실패: DXF 데이터가 비어있습니다.', 'error')
          setLoading(null)
          return
        }
        console.log(`[Import] DWG→DXF 변환: ${(buffer.byteLength / 1048576).toFixed(1)}MB DWG → ${(dxfBytes.length / 1048576).toFixed(1)}MB DXF`)
        dxfText = decodeDxfBytes(dxfBytes)
        if (!dxfText || (!dxfText.includes('SECTION') && !dxfText.includes('ENTITIES'))) {
          toast('DWG 변환 실패: 유효하지 않은 DXF입니다.', 'error')
          setLoading(null)
          return
        }
        // Paper Space 디버그 로그
        const hasPaperSpace = /\*Paper_Space/i.test(dxfText)
        const hasEntities = dxfText.includes('ENTITIES')
        console.log(`[Import] DXF 구조: ENTITIES=${hasEntities}, Paper_Space=${hasPaperSpace}, 총 ${(dxfText.length / 1048576).toFixed(1)}MB`)
      } else {
        // DXF 직접 읽기
        setLoading(`도면 파일 읽는 중... (${sizeMB}MB)`)
        const buffer = await file.arrayBuffer()
        dxfText = decodeDxfBytes(new Uint8Array(buffer))
      }

      setLoading(null)

      // CadPreview 모달 열기
      setPreviewData({
        dxfText,
        fileName: file.name,
        fileSize: file.size,
        isDwg,
      })
    } catch (err) {
      console.error('[Import] 파일 로드 에러:', err)
      toast(`파일 로드 실패: ${err instanceof Error ? err.message : String(err)}`, 'error')
      setLoading(null)
    }
  }

  const handlePreviewImport = async (
    selectedLayers: Set<string>,
    dxfText: string,
    viewportClip?: ViewportClip | null,
    layoutInfo?: LayoutImportInfo | null,
  ) => {
    if (!editor || !previewData) return

    const prev = previewData
    setPreviewData(null)
    setLoading('도면 파싱 준비 중...')

    // requestAnimationFrame으로 로딩 UI가 먼저 보이도록
    await new Promise(r => requestAnimationFrame(r))

    try {
      // 페이지를 만들 레이아웃을 먼저 가려낸다.
      //
      // 뷰포트를 못 찾은 paper space 레이아웃은 **페이지를 아예 만들지 않는다.**
      // clip 없이 임포트하면 모델공간 전체가 그대로 복사돼서, 오토캐드에서 탭으로
      // 나뉘어 있던 게 한 페이지에 다 쏟아진다. 빈 페이지보다 나쁘다.
      const targets: { layout: DxfLayout; clip: ViewportClip | null }[] = []
      if (layoutInfo) {
        for (const layout of [...layoutInfo.layouts].sort((a, b) => a.tabOrder - b.tabOrder)) {
          if (layout.isModelSpace) {
            targets.push({ layout, clip: null })
            continue
          }
          const vps = layoutInfo.viewportsByLayout.get(layout.name)
          if (!vps || vps.length === 0) {
            console.warn(`[Import] Layout "${layout.name}": 뷰포트 없음 → 페이지 생성 안 함`)
            continue
          }
          const clip: ViewportClip = {
            minX: Math.min(...vps.map(v => v.clipMinX)),
            minY: Math.min(...vps.map(v => v.clipMinY)),
            maxX: Math.max(...vps.map(v => v.clipMaxX)),
            maxY: Math.max(...vps.map(v => v.clipMaxY)),
          }
          console.log(`[Import] Layout "${layout.name}" viewport clip: (${clip.minX.toFixed(0)},${clip.minY.toFixed(0)})~(${clip.maxX.toFixed(0)},${clip.maxY.toFixed(0)})`)
          targets.push({ layout, clip })
        }
      }

      if (targets.length > 1) {
        // ── Multi-layout import: AutoCAD 탭별 별도 페이지 생성 ──
        let totalCount = 0
        const modelPageId = editor.getCurrentPageId()

        for (let i = 0; i < targets.length; i++) {
          const { layout, clip } = targets[i]
          // AutoCAD "Model" → 한국어 "모형" 매핑
          const displayName = layout.isModelSpace && layout.name === 'Model' ? '모형' : layout.name

          if (i === 0) {
            // 첫 번째 레이아웃 (보통 Model Space) → 현재 페이지 사용, 이름 변경
            //
            // store.put 으로 레코드를 직접 밀어넣고 있었다. 공식 API 를 우회하면
            // 히스토리(run) 를 안 타서 되돌리기에 안 잡히고, 읽기전용 검사도
            // 건너뛴다. renamePage → updatePage 가 둘 다 처리하고 없는 페이지도
            // 알아서 무시한다.
            editor.renamePage(modelPageId, displayName)
          } else {
            // Paper Space 레이아웃 → 새 페이지 생성
            const newPageId = PageRecordType.createId()
            editor.createPage({ name: displayName, id: newPageId })
            editor.setCurrentPage(newPageId)
          }

          setLoading(`"${layout.name}" 임포트 중... (${i + 1}/${targets.length})`)
          const count = await commitCadImportV2(
            editor, dxfText, selectedLayers,
            prev.fileName, prev.fileSize, prev.isDwg,
            (progress: string) => setLoading(`[${layout.name}] ${progress}`),
            clip,
          )
          totalCount += count
          console.log(`[Import] Layout "${layout.name}": ${count}개 요소`)
        }

        // Model Space 페이지로 복귀
        editor.setCurrentPage(modelPageId)
        setTimeout(() => {
          try { editor.zoomToFit({ animation: { duration: 0 } }) } catch { /* ignore */ }
        }, 400)

        const fmt = prev.isDwg ? 'DWG' : 'DXF'
        toast(`"${prev.fileName}" ${fmt} 가져옴 (${targets.length}개 레이아웃, ${totalCount.toLocaleString()}개 요소)`, 'success')
      } else {
        // ── Single-layout import (기존 동작) ──
        const count = await commitCadImportV2(
          editor, dxfText, selectedLayers,
          prev.fileName, prev.fileSize, prev.isDwg,
          (progress: string) => setLoading(progress),
          viewportClip,
        )

        const fmt = prev.isDwg ? 'DWG' : 'DXF'
        if (count === 0) {
          toast('선택한 레이어에 표시할 도형이 없습니다.', 'info')
        } else {
          toast(`"${prev.fileName}" ${fmt} 가져옴 (${count.toLocaleString()}개 요소, ${selectedLayers.size}개 레이어)`, 'success')
        }
      }
    } catch (err) {
      console.error('[Import] commitCadImportV2 에러:', err)
      toast('도면 렌더링 중 오류가 발생했습니다.', 'error')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="lbar-panel">
      <div className="lbar-panel-header">가져오기</div>
      <div className="lbar-panel-body import-panel-body" style={{ display: 'flex', flexDirection: 'column' }}>

        {/* DXF / DWG */}
        <div>
          <div className="import-section-title">CAD 도면</div>
          <button
            className="action-btn"
            style={{ width: '100%', marginBottom: 10 }}
            onClick={handleCadImport}
          >
            📐 DXF / DWG 불러오기
          </button>
          <div className="import-info-box">
            <strong style={{ color: '#3b82f6' }}>DXF</strong> 및 <strong style={{ color: '#3b82f6' }}>DWG</strong> 파일 지원<br />
            (DWG는 브라우저에서 자동 변환)<br />
            <span style={{ color: '#aaa', fontSize: 10 }}>AutoCAD R13~R2018 지원</span>
          </div>
        </div>

        <div style={{ borderTop: '1px solid #eee' }} />

        {/* PDF */}
        <div>
          <div className="import-section-title">PDF 도면</div>
          <button
            className="action-btn"
            style={{ width: '100%', marginBottom: 10 }}
            onClick={() => editor && importPdf(editor, notify)}
          >
            📄 PDF 불러오기
          </button>
          <div className="import-info-box">
            PDF 첫 페이지를 고해상도 이미지로 렌더해서 배경으로 배치.<br />
            위에 벽을 따라 그리세요.<br />
            <span style={{ color: '#aaa' }}>※ 다중 페이지는 첫 페이지만 (추후 옵션 추가)</span>
          </div>
        </div>

        <div style={{ borderTop: '1px solid #eee' }} />

        {/* 이미지 */}
        <div>
          <div className="import-section-title">이미지 배경</div>
          <button
            className="action-btn"
            style={{ width: '100%', marginBottom: 10 }}
            onClick={() => editor && uploadImage(editor)}
          >
            🖼 이미지 업로드
          </button>
          <div className="import-info-box">
            PNG/JPG 도면 이미지를 배경으로 올린 뒤<br />
            위에 벽을 따라 그리세요.<br />
            <strong style={{ color: '#555' }}>AI 자동 인식</strong>은 이미지 선택 후<br />
            우측 패널 → ✦ 벽 자동 인식.
          </div>
        </div>

      </div>

      {/* WebGL CAD 프리뷰 모달 */}
      {previewData && (
        <Suspense fallback={<ImportLoadingOverlay message="CAD 미리보기 로딩 중..." />}>
          <CadPreview
            dxfText={previewData.dxfText}
            fileName={previewData.fileName}
            fileSize={previewData.fileSize}
            isDwg={previewData.isDwg}
            onImport={handlePreviewImport}
            onClose={() => setPreviewData(null)}
          />
        </Suspense>
      )}

      {/* 로딩 오버레이 */}
      {loading && <ImportLoadingOverlay message={loading} />}
    </div>
  )
}

function ImportLoadingOverlay({ message }: { message: string }) {
  return (
    <div className="import-loading-overlay">
      <div className="import-loading-card">
        <div className="import-loading-spinner" />
        <div className="import-loading-msg">{message}</div>
      </div>
    </div>
  )
}
