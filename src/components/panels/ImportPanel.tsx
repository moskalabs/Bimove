import { useState, Suspense } from 'react'
import { PageRecordType } from 'tldraw'
import { useEditor } from '../../context/EditorContext'
import { useProjectName } from '../../context/ProjectContext'
import { useToast } from '../../context/ToastContext'
import { uploadImage } from '../../lib/project'
import { pickCadFile, dwgToDxfBytes, decodeDxfBytes, commitCadImportV2, getLastImportReport, ViewportClipMissedError } from '../../lib/dxf'
import type { ViewportClip } from '../../lib/dxf-shared'
import { buildLayoutTargets, type ParseSpace } from '../../lib/dxf-shared'
import type { LayoutImportInfo } from '../CadPreview'
import { lazyWithReload } from '../../lib/lazyWithReload'
import { importPdf } from '../../lib/pdfImport'

const CadPreview = lazyWithReload(() => import('../CadPreview'))

/**
 * 임포트에서 못 가져온 것들을 한 줄로 요약한다.
 *
 * 전부 무음으로 버리면 쓰는 사람은 "원래 이런 도면인가" 하고 넘어가고, 고치는
 * 쪽은 어디서 샜는지 찾느라 시간을 버린다. 그래서 가장 큰 사유 두 개를 토스트로
 * 띄우고, 전체 목록은 콘솔에 남긴다.
 *
 * @returns 알릴 게 없으면 null
 */
function summarizeImportReport(): string | null {
  const entries = Object.entries(getLastImportReport())
    // 정상 동작으로 늘 나오는 것들은 알림까지 띄울 필요가 없다 (콘솔에는 남는다).
    .filter(([reason]) => !reason.startsWith('세그먼트 정제') && !reason.startsWith('도면 범위 밖'))
    .sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return null
  const total = entries.reduce((sum, [, n]) => sum + n, 0)
  const top = entries.slice(0, 2).map(([reason, n]) => `${reason} ${n}건`).join(', ')
  const rest = entries.length > 2 ? ` 외 ${entries.length - 2}가지` : ''
  return `못 가져온 것 ${total}건 — ${top}${rest}. 자세한 내용은 콘솔(F12)에 있어요.`
}

interface PreviewData {
  dxfText: string
  fileName: string
  fileSize: number
  isDwg: boolean
}

export function ImportPanel() {
  const editor = useEditor()
  const { toast } = useToast()
  const { setName: setProjectName } = useProjectName()
  const [loading, setLoading] = useState<string | null>(null)
  const [previewData, setPreviewData] = useState<PreviewData | null>(null)

  /**
   * 가져온 도면 파일명을 프로젝트 이름으로 올린다.
   *
   * 오른쪽 패널의 칸 이름이 그냥 "파일명" 이다. 도면을 불러왔는데 거기 "새
   * 프로젝트" 라고 적혀 있으면 어느 도면인지 알 길이 없다. 사용자가 지어둔
   * 이름을 덮어쓰게 되지만, 그 칸은 그대로 고칠 수 있다.
   *
   * **임포트가 실제로 성공했을 때만** 부른다 — 취소하거나 0개 가져온 경우까지
   * 이름을 바꾸면 화면에 없는 도면 이름이 남는다.
   */
  const adoptFileName = (fileName: string) => {
    const base = fileName.replace(/\.(dxf|dwg)$/i, '').trim()
    if (base) setProjectName(base)
  }

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
      // 어떤 레이아웃을 어떻게 페이지로 만들지는 buildLayoutTargets 가 정한다
      // (뷰포트 없는 탭도 빈 페이지로 남기는 이유는 거기 주석에).
      const targets = layoutInfo
        ? buildLayoutTargets(layoutInfo.layouts, layoutInfo.viewportsByLayout)
        : []
      for (const t of targets) {
        if (!t.geometry) console.warn(`[Import] Layout "${t.layout.name}": 뷰포트 없음 → 빈 페이지만 만든다`)
        else if (t.clip) console.log(`[Import] Layout "${t.layout.name}" viewport clip: ` +
          `(${t.clip.minX.toFixed(0)},${t.clip.minY.toFixed(0)})~(${t.clip.maxX.toFixed(0)},${t.clip.maxY.toFixed(0)})`)
      }

      if (targets.length > 1) {
        // ── Multi-layout import: AutoCAD 탭별 별도 페이지 생성 ──
        let totalCount = 0
        let importedLayouts = 0
        // 페이지는 만들었지만 도형이 하나도 안 들어간 레이아웃. 조용히 넘기지 않는다.
        const empty: string[] = []
        const modelPageId = editor.getCurrentPageId()

        for (let i = 0; i < targets.length; i++) {
          const { layout, clip, geometry } = targets[i]
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

          // 뷰포트를 못 찾은 레이아웃 — 탭 자리만 잡아두고 도형은 비운다.
          if (!geometry) {
            empty.push(layout.name)
            continue
          }

          setLoading(`"${layout.name}" 임포트 중... (${i + 1}/${targets.length})`)
          const commit = (c: ViewportClip | null, space: ParseSpace) => commitCadImportV2(
            editor, dxfText, selectedLayers,
            prev.fileName, prev.fileSize, prev.isDwg,
            (progress: string) => setLoading(`[${layout.name}] ${progress}`),
            c, space,
          )

          // 종이 탭은 **종이공간** 을 먼저 읽는다. 도면틀·표제란·시트 캡션
          // ("COVER", "평 면 (1/50)" 같은 것)은 모델공간이 아니라 거기 있고,
          // 뷰포트가 하나도 없어도 존재한다. 그래서 뷰포트 유무와 무관하게
          // 시도한다 — geometry 플래그는 아래 모델공간 폴백에서만 본다.
          let count = 0
          if (!layout.isModelSpace) {
            count = await commit(null, {
              kind: 'paper', layoutName: layout.name, blockName: layout.blockName,
            })
            console.log(`[Import] Layout "${layout.name}": 종이공간 ${count}개 요소`)
          }

          if (count === 0) {
            // 모형 탭이거나, 종이공간이 비었다 (DWG→DXF 변환에서 종이 엔티티가
            // 날아간 파일이 그렇다). 기존 경로 — 모델공간을 뷰포트 clip 으로
            // 잘라 넣는다.
            if (!geometry) { empty.push(layout.name); continue }
            if (!layout.isModelSpace) {
              console.warn(`[Import] Layout "${layout.name}": 종이공간이 비었다 → 모델공간 clip 으로 재시도`)
            }
            try {
              count = await commit(clip, { kind: 'model', excludePaper: targets.length > 1 })
            } catch (err) {
              // clip 이 도형을 하나도 못 잡았다 = clip 이 틀렸다. 모델공간 전체를
              // 복사하면 "모형" 페이지의 복제본이 생기니 도형은 넣지 않는다.
              // 그래도 **페이지는 남긴다** — 탭 개수가 원본과 맞아야 뭐가 비었는지
              // 보인다. 전엔 여기서 지워버려서 탭이 조용히 사라졌다.
              if (!(err instanceof ViewportClipMissedError)) throw err
              console.warn(`[Import] Layout "${layout.name}": ${err.message} → 빈 페이지로 둔다`)
              empty.push(layout.name)
              continue
            }
          }
          totalCount += count
          importedLayouts++
          console.log(`[Import] Layout "${layout.name}": ${count}개 요소`)
        }

        // Model Space 페이지로 복귀
        editor.setCurrentPage(modelPageId)
        setTimeout(() => {
          try { editor.zoomToFit({ animation: { duration: 0 } }) } catch { /* ignore */ }
        }, 400)

        const fmt = prev.isDwg ? 'DWG' : 'DXF'
        adoptFileName(prev.fileName)
        toast(`"${prev.fileName}" ${fmt} 가져옴 (${importedLayouts}개 레이아웃, ${totalCount.toLocaleString()}개 요소)`, 'success')
        if (empty.length > 0) {
          toast(
            `레이아웃 ${empty.map(n => `"${n}"`).join(', ')} 은(는) 도형을 못 찾아 빈 페이지로 들어왔습니다. ` +
            `원본 DWG 의 종이공간/뷰포트 정보가 변환 과정에서 손실된 경우입니다.`,
            'info',
          )
        }
        const missed = summarizeImportReport()
        if (missed) toast(missed, 'info')
      } else {
        // ── Single-layout import (기존 동작) ──
        let count: number
        try {
          count = await commitCadImportV2(
            editor, dxfText, selectedLayers,
            prev.fileName, prev.fileSize, prev.isDwg,
            (progress: string) => setLoading(progress),
            viewportClip,
          )
        } catch (err) {
          if (!(err instanceof ViewportClipMissedError)) throw err
          // 레이아웃이 하나뿐이라 지울 페이지가 없다. 뭐가 잘못됐는지만 알린다.
          console.warn(`[Import] ${err.message}`)
          toast(
            '레이아웃 뷰포트가 도형을 하나도 못 잡아 가져오지 못했습니다. ' +
            '원본 DWG 의 뷰포트 정보가 변환 과정에서 손실된 경우입니다.',
            'error',
          )
          return
        }

        const fmt = prev.isDwg ? 'DWG' : 'DXF'
        if (count === 0) {
          toast('선택한 레이어에 표시할 도형이 없습니다.', 'info')
        } else {
          adoptFileName(prev.fileName)
          toast(`"${prev.fileName}" ${fmt} 가져옴 (${count.toLocaleString()}개 요소, ${selectedLayers.size}개 레이어)`, 'success')
        }
        const missed = summarizeImportReport()
        if (missed) toast(missed, 'info')
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
