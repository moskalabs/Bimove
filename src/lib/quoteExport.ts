// 견적서 PDF 출력 — window.print로 PDF/인쇄
import type { CostLine } from './priceConfig'
import { fmtKRW } from './priceConfig'

export type QuoteOptions = {
  projectName: string
  clientName?: string
  overheadRate?: number  // 잡관리비율 (0.05 = 5%)
  vatRate?: number       // 부가세율 (0.10 = 10%)
}

export function printQuotePdf(lines: CostLine[], opts: QuoteOptions) {
  if (lines.length === 0) {
    alert('견적할 항목이 없어 — 도면을 먼저 그려줘.')
    return
  }
  const date = new Date().toLocaleDateString('ko-KR')
  const subtotal = lines.reduce((a, l) => a + l.amount, 0)
  const overheadRate = opts.overheadRate ?? 0
  const vatRate = opts.vatRate ?? 0
  const overhead = Math.round(subtotal * overheadRate)
  const beforeVat = subtotal + overhead
  const vat = Math.round(beforeVat * vatRate)
  const total = beforeVat + vat

  // 카테고리별 그룹
  const groups = new Map<string, CostLine[]>()
  for (const l of lines) {
    const arr = groups.get(l.category) ?? []
    arr.push(l)
    groups.set(l.category, arr)
  }

  const rowsHtml = Array.from(groups.entries()).map(([cat, items]) => `
    <tr class="cat-row"><td colspan="4">${cat}</td></tr>
    ${items.map(l => `
      <tr>
        <td class="name">${escapeHtml(l.name)}</td>
        <td class="qty">${l.qty.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} ${l.unit}</td>
        <td class="unit-price">${fmtKRW(l.unitPrice)}</td>
        <td class="amount">${fmtKRW(l.amount)}</td>
      </tr>
    `).join('')}
  `).join('')

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(opts.projectName)} 견적서</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4 portrait; margin: 15mm; }
  body { font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; color: #222; padding: 0; }
  h1 { font-size: 22pt; text-align: center; padding: 20px 0 12px; letter-spacing: 4px; }
  .header { display: flex; justify-content: space-between; padding: 12px 0; border-top: 2px solid #222; border-bottom: 1px solid #aaa; margin-bottom: 24px; }
  .header div { font-size: 10pt; }
  .header .label { color: #888; margin-right: 6px; }
  table.quote { width: 100%; border-collapse: collapse; font-size: 10pt; }
  table.quote thead td { background: #f5f5f5; font-weight: 600; padding: 8px; border-bottom: 1.5px solid #444; color: #444; }
  table.quote td { padding: 6px 8px; border-bottom: 1px solid #eee; }
  table.quote .cat-row td { background: #fafafa; font-weight: 600; padding: 8px; border-top: 1px solid #ccc; color: #555; }
  table.quote .name { width: 40%; }
  table.quote .qty { width: 20%; }
  table.quote .unit-price { width: 20%; text-align: right; color: #777; }
  table.quote .amount { width: 20%; text-align: right; }
  .totals { margin-top: 24px; margin-left: auto; width: 50%; }
  .totals table { width: 100%; font-size: 10pt; }
  .totals td { padding: 6px 8px; border-bottom: 1px solid #eee; }
  .totals .label { color: #666; }
  .totals .value { text-align: right; }
  .totals .grand { font-size: 14pt; font-weight: 700; color: #1a73e8; border-top: 2px solid #1a73e8; border-bottom: 2px solid #1a73e8; padding: 10px 8px; }
  .footer { margin-top: 60px; padding-top: 16px; border-top: 1px solid #ddd; font-size: 9pt; color: #888; text-align: center; }
</style>
</head>
<body>
  <h1>견 적 서</h1>
  <div class="header">
    <div><span class="label">프로젝트</span><strong>${escapeHtml(opts.projectName)}</strong></div>
    ${opts.clientName ? `<div><span class="label">고객</span>${escapeHtml(opts.clientName)}</div>` : ''}
    <div><span class="label">발행일</span>${date}</div>
  </div>

  <table class="quote">
    <thead><tr><td>품목</td><td>수량</td><td style="text-align:right">단가</td><td style="text-align:right">금액</td></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>

  <div class="totals"><table>
    <tr><td class="label">소계</td><td class="value">${fmtKRW(subtotal)}</td></tr>
    ${overheadRate > 0 ? `<tr><td class="label">잡관리비 (${(overheadRate*100).toFixed(0)}%)</td><td class="value">${fmtKRW(overhead)}</td></tr>` : ''}
    ${vatRate > 0 ? `<tr><td class="label">부가세 (${(vatRate*100).toFixed(0)}%)</td><td class="value">${fmtKRW(vat)}</td></tr>` : ''}
    <tr class="grand"><td>총 견적 금액</td><td class="value">${fmtKRW(total)}</td></tr>
  </table></div>

  <div class="footer">본 견적은 ${date} 기준이며, 시공 조건/자재 변동에 따라 조정될 수 있습니다. — bimova</div>
</body>
</html>`

  const win = window.open('', '_blank')
  if (!win) { alert('팝업 차단 해제 후 다시 시도해줘.'); return }
  win.document.write(html)
  win.document.close()
  setTimeout(() => win.print(), 600)
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
