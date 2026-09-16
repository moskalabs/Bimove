// 리포트(산출물) PDF 내보내기 — 표지 + 평면도
import type { Editor } from 'tldraw'
import { getScaleConfig, SCALE_PRESETS } from './scaleConfig'

export type ReportOptions = {
  projectName?: string
  clientName?: string
  companyName?: string
  address?: string
  date?: string
}

/**
 * 리포트 PDF 출력 (표지 + 평면도)
 * window.print 기반 — 브라우저 PDF 인쇄 사용
 */
export async function printReport(editor: Editor, opts: ReportOptions = {}) {
  const shapes = editor.getCurrentPageShapes()
  const projectName = opts.projectName || '인테리어 공사'
  const dateStr = opts.date || new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
  const companyName = opts.companyName || ''
  const clientName = opts.clientName || ''
  const address = opts.address || ''

  // 도면 SVG
  let drawingSvg = ''
  let scaleLabel = ''
  if (shapes.length > 0) {
    const ids = shapes.map(s => s.id)
    const result = await editor.getSvgString(ids, { padding: 60, background: false })
    if (result) {
      drawingSvg = result.svg
        .replace(/(<svg[^>]*)\s+width="[^"]*"/, '$1')
        .replace(/(<svg[^>]*)\s+height="[^"]*"/, '$1')
    }
    const sc = getScaleConfig(editor)
    scaleLabel = SCALE_PRESETS.find(p => Math.abs(p.pxPerMm - sc.pxPerMm) < 0.0001)?.label ?? 'custom'
  }

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${esc(projectName)} — 리포트</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A3 landscape; margin: 0; }
  body { font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', 'NanumGothic', sans-serif; color: #222; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { page-break-after: always; }
    .page:last-child { page-break-after: auto; }
  }

  /* ── 표지 ── */
  .cover {
    width: 420mm; height: 297mm;
    display: flex; flex-direction: column;
    background: linear-gradient(160deg, #f8fafc 0%, #e2e8f0 100%);
    position: relative; overflow: hidden;
  }
  .cover::before {
    content: '';
    position: absolute; top: 0; right: 0;
    width: 45%; height: 100%;
    background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%);
    clip-path: polygon(20% 0, 100% 0, 100% 100%, 0% 100%);
  }
  .cover-content {
    flex: 1; display: flex; flex-direction: column;
    justify-content: center; padding: 60px 80px;
    position: relative; z-index: 1;
  }
  .cover-label {
    font-size: 11pt; color: #64748b; font-weight: 500;
    letter-spacing: 6px; text-transform: uppercase;
    margin-bottom: 16px;
  }
  .cover-title {
    font-size: 42pt; font-weight: 900; color: #0f172a;
    line-height: 1.2; margin-bottom: 24px;
    max-width: 50%;
  }
  .cover-subtitle {
    font-size: 14pt; color: #475569; font-weight: 400;
    line-height: 1.6; max-width: 50%;
  }
  .cover-bottom {
    display: flex; justify-content: space-between;
    align-items: flex-end; padding: 40px 80px 50px;
    position: relative; z-index: 1;
  }
  .cover-info { display: flex; gap: 48px; }
  .cover-info-block {}
  .cover-info-label {
    font-size: 8pt; color: #94a3b8; font-weight: 600;
    letter-spacing: 2px; margin-bottom: 4px;
  }
  .cover-info-value {
    font-size: 11pt; color: #334155; font-weight: 600;
  }
  .cover-logo {
    font-size: 14pt; font-weight: 800; color: #cbd5e1;
    letter-spacing: 4px;
  }

  /* ── 평면도 페이지 ── */
  .plan-page {
    width: 420mm; height: 297mm;
    display: flex; flex-direction: column;
    background: #fff;
  }
  .plan-header {
    height: 14mm; display: flex; align-items: center;
    padding: 0 20mm; border-bottom: 1px solid #e2e8f0;
    font-size: 9pt; color: #64748b;
    justify-content: space-between;
  }
  .plan-header-title { font-weight: 700; color: #1e293b; }
  .plan-drawing {
    flex: 1; display: flex; align-items: center;
    justify-content: center; padding: 10mm;
    overflow: hidden;
  }
  .plan-drawing svg {
    max-width: 100%; max-height: 100%;
  }
  .plan-title-block {
    height: 24mm; border-top: 1.5px solid #334155;
    display: flex; align-items: stretch; font-size: 9pt;
  }
  .tb-cell {
    border-right: 1px solid #cbd5e1;
    padding: 3mm 5mm; display: flex;
    flex-direction: column; justify-content: center;
  }
  .tb-cell:last-child { border-right: none; }
  .tb-label { font-size: 7pt; color: #94a3b8; margin-bottom: 2px; }
  .tb-value { font-size: 10pt; font-weight: 600; color: #1e293b; }
  .tb-project { flex: 3; }
  .tb-scale, .tb-date, .tb-tool { flex: 1; }
  .tb-tool .tb-value { color: #3b82f6; }

  .no-drawing {
    color: #94a3b8; font-size: 14pt; text-align: center;
  }
</style>
</head>
<body>
  <!-- 표지 -->
  <div class="cover page">
    <div class="cover-content">
      <div class="cover-label">INTERIOR DESIGN REPORT</div>
      <div class="cover-title">${esc(projectName)}</div>
      <div class="cover-subtitle">
        ${clientName ? esc(clientName) + '<br>' : ''}
        ${address ? esc(address) : ''}
      </div>
    </div>
    <div class="cover-bottom">
      <div class="cover-info">
        <div class="cover-info-block">
          <div class="cover-info-label">DATE</div>
          <div class="cover-info-value">${esc(dateStr)}</div>
        </div>
        ${companyName ? `
        <div class="cover-info-block">
          <div class="cover-info-label">COMPANY</div>
          <div class="cover-info-value">${esc(companyName)}</div>
        </div>` : ''}
        <div class="cover-info-block">
          <div class="cover-info-label">SCALE</div>
          <div class="cover-info-value">${scaleLabel || '-'}</div>
        </div>
      </div>
      <div class="cover-logo">bimova</div>
    </div>
  </div>

  <!-- 평면도 -->
  ${drawingSvg ? `
  <div class="plan-page page">
    <div class="plan-header">
      <span class="plan-header-title">${esc(projectName)}</span>
      <span>평면도 · FLOOR PLAN</span>
    </div>
    <div class="plan-drawing">${drawingSvg}</div>
    <div class="plan-title-block">
      <div class="tb-cell tb-project">
        <div class="tb-label">프로젝트</div>
        <div class="tb-value">${esc(projectName)}</div>
      </div>
      <div class="tb-cell tb-scale">
        <div class="tb-label">축척</div>
        <div class="tb-value">${scaleLabel}</div>
      </div>
      <div class="tb-cell tb-date">
        <div class="tb-label">날짜</div>
        <div class="tb-value">${esc(dateStr)}</div>
      </div>
      <div class="tb-cell tb-tool">
        <div class="tb-label">제작</div>
        <div class="tb-value">bimova</div>
      </div>
    </div>
  </div>` : ''}

</body>
</html>`

  const win = window.open('', '_blank')
  if (!win) { alert('팝업 차단을 해제해 주세요.'); return }
  win.document.write(html)
  win.document.close()
  setTimeout(() => win.print(), 600)
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!),
  )
}
