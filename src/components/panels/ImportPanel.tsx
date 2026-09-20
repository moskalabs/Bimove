import { useState, Suspense, lazy } from 'react'
import { useEditor } from '../../context/EditorContext'
import { useToast } from '../../context/ToastContext'
import { uploadImage } from '../../lib/project'
import { pickCadFile, dwgToDxfBytes, decodeDxfBytes, commitCadImportV2 } from '../../lib/dxf'
import { importPdf } from '../../lib/pdfImport'

const CadPreview = lazy(() => import('../CadPreview'))

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
        dxfText = decodeDxfBytes(dxfBytes)
        if (!dxfText || (!dxfText.includes('SECTION') && !dxfText.includes('ENTITIES'))) {
          toast('DWG 변환 실패: 유효하지 않은 DXF입니다.', 'error')
          setLoading(null)
          return
        }
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

  const handlePreviewImport = async (selectedLayers: Set<string>, dxfText: string) => {
    if (!editor || !previewData) return

    const prev = previewData
    setPreviewData(null)
    setLoading('도면 파싱 준비 중...')

    // requestAnimationFrame으로 로딩 UI가 먼저 보이도록
    await new Promise(r => requestAnimationFrame(r))

    try {
      const count = await commitCadImportV2(
        editor,
        dxfText,
        selectedLayers,
        prev.fileName,
        prev.fileSize,
        prev.isDwg,
        (progress: string) => setLoading(progress),
      )

      const fmt = prev.isDwg ? 'DWG' : 'DXF'
      if (count === 0) {
        toast('선택한 레이어에 표시할 도형이 없습니다.', 'info')
      } else {
        toast(`"${prev.fileName}" ${fmt} 가져옴 (${count.toLocaleString()}개 선분, ${selectedLayers.size}개 레이어)`, 'success')
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
