import { useState } from 'react'
import { useEditor } from '../../context/EditorContext'
import { useToast } from '../../context/ToastContext'
import { uploadImage } from '../../lib/project'
import { pickCadFile, parseCadFile, commitCadImport, type CadParseResult } from '../../lib/dxf'
import { importPdf } from '../../lib/pdfImport'
import { CadLayerDialog } from '../CadLayerDialog'

export function ImportPanel() {
  const editor = useEditor()
  const { toast } = useToast()
  const notify = {
    onSuccess: (msg: string) => toast(msg, 'success'),
    onError: (msg: string) => toast(msg, 'error'),
    onInfo: (msg: string) => toast(msg, 'info'),
  }
  const [cadResult, setCadResult] = useState<CadParseResult | null>(null)
  const [loading, setLoading] = useState<string | null>(null) // 로딩 메시지

  const handleCadImport = async () => {
    if (!editor) return
    const file = await pickCadFile()
    if (!file) return

    setLoading('도면 파일 분석 중...')
    try {
      const result = await parseCadFile(file, notify)
      if (!result) { setLoading(null); return }

      // 중복 체크
      const existingFps = new Set(
        editor.getCurrentPageShapes()
          .map((s) => (s.meta as Record<string, unknown>)?.dxfFingerprint)
          .filter((fp): fp is string => typeof fp === 'string'),
      )
      if (existingFps.has(result.fingerprint)) {
        setLoading(null)
        const proceed = confirm(
          `"${file.name}" 파일이 이미 임포트된 것 같습니다.\n그래도 다시 임포트하시겠습니까?`,
        )
        if (!proceed) return
      }

      // 레이어가 2개 이상이면 선택 다이얼로그, 1개면 바로 임포트
      if (result.layers.length > 1) {
        setCadResult(result)
      } else {
        setLoading(`${result.totalSegments.toLocaleString()}개 세그먼트 변환 중...`)
        // UI 갱신 후 무거운 작업 실행
        await new Promise((r) => setTimeout(r, 50))
        const allLayers = new Set(result.layers.map((l) => l.name))
        const count = commitCadImport(editor, result, allLayers)
        const fmt = result.isDwg ? 'DWG' : 'DXF'
        toast(`"${result.fileName}" ${fmt}를 가져왔습니다. (${count}개 벽)`, 'success')
      }
    } finally {
      setLoading(null)
    }
  }

  const handleLayerConfirm = async (selectedLayers: Set<string>) => {
    if (!editor || !cadResult) return
    const segCount = cadResult.layers
      .filter((l) => selectedLayers.has(l.name))
      .reduce((sum, l) => sum + l.segCount, 0)
    setLoading(`${segCount.toLocaleString()}개 세그먼트 변환 중...`)
    // UI 갱신 후 무거운 작업 실행
    await new Promise((r) => setTimeout(r, 50))
    const count = commitCadImport(editor, cadResult, selectedLayers)
    const fmt = cadResult.isDwg ? 'DWG' : 'DXF'
    toast(`"${cadResult.fileName}" ${fmt}를 가져왔습니다. (${count}개 벽, ${selectedLayers.size}개 레이어)`, 'success')
    setCadResult(null)
    setLoading(null)
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

      {/* 레이어 선택 다이얼로그 */}
      {cadResult && (
        <CadLayerDialog
          result={cadResult}
          onConfirm={handleLayerConfirm}
          onCancel={() => { setCadResult(null); setLoading(null) }}
        />
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
