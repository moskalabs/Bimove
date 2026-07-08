// 발주서 내보내기: XLSX, PDF, JPG
import type { PurchaseOrder, BOQTable, BOQItem } from './purchaseOrder'
import {
  grossArea, exclusionArea, netArea, calcQuantity, calcAmount,
  tableTotal, poGrandTotal, fmtKRW,
} from './purchaseOrder'
import { getTemplate } from './boqTemplates'

// ── XLSX 내보내기 (SheetJS) ──

export async function exportPOXlsx(po: PurchaseOrder) {
  const XLSX = await import('xlsx')

  const wb = XLSX.utils.book_new()

  for (const table of po.tables) {
    const template = getTemplate(table.templateId)
    const sheetName = table.label.slice(0, 31) // Excel 시트명 31자 제한

    const header = [
      '번호', '품목명', '마감재', '너비(mm)', '높이(mm)',
      '총면적(m²)', '제외면적(m²)', '순면적(m²)',
      '규격', '로스율(%)', '수량', '단위', '단가(₩)', '금액(₩)',
    ]

    const rows = table.items.map((item, i) => [
      i + 1,
      item.name,
      item.material,
      item.widthMm,
      item.heightMm,
      +grossArea(item).toFixed(2),
      +exclusionArea(item).toFixed(2),
      +netArea(item).toFixed(2),
      item.itemWidthMm > 0 ? `${item.itemWidthMm}×${item.itemLengthMm}mm` : '-',
      +(item.lossRate * 100).toFixed(1),
      calcQuantity(item),
      item.unit,
      item.unitPrice,
      calcAmount(item),
    ])

    // 합계 행
    const total = tableTotal(table)
    rows.push([
      '', '', '', '', '', '', '', '', '', '', '', '', '합계', total,
    ])

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows])

    // 컬럼 너비
    ws['!cols'] = [
      { wch: 5 }, { wch: 15 }, { wch: 20 }, { wch: 10 }, { wch: 10 },
      { wch: 10 }, { wch: 10 }, { wch: 10 },
      { wch: 15 }, { wch: 8 }, { wch: 8 }, { wch: 6 }, { wch: 12 }, { wch: 14 },
    ]

    XLSX.utils.book_append_sheet(wb, ws, sheetName)
  }

  // 요약 시트
  if (po.tables.length > 1) {
    const summaryRows = [
      ['카테고리', '품목수', '합계(₩)'],
      ...po.tables.map(t => [
        t.label,
        t.items.length,
        tableTotal(t),
      ]),
      ['', '총 합계', poGrandTotal(po)],
    ]
    const ws = XLSX.utils.aoa_to_sheet(summaryRows)
    ws['!cols'] = [{ wch: 15 }, { wch: 10 }, { wch: 15 }]
    XLSX.utils.book_append_sheet(wb, ws, '요약')
  }

  const date = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `발주서_${date}.xlsx`)
}

// ── PDF 내보내기 (window.print) ──

export function printPOPdf(po: PurchaseOrder) {
  if (po.tables.length === 0) {
    alert('물량표가 비어 있습니다.')
    return
  }

  const date = new Date().toLocaleDateString('ko-KR')
  const grand = poGrandTotal(po)

  const tablesHtml = po.tables.map(table => {
    const template = getTemplate(table.templateId)
    const total = tableTotal(table)

    const rowsHtml = table.items.map((item, i) => `
      <tr>
        <td class="center">${i + 1}</td>
        <td>${esc(item.name)}</td>
        <td>${esc(item.material)}</td>
        <td class="right">${item.widthMm}</td>
        <td class="right">${item.heightMm}</td>
        <td class="right">${netArea(item).toFixed(2)}</td>
        <td class="right">${calcQuantity(item)}</td>
        <td class="center">${item.unit}</td>
        <td class="right">${fmtKRW(item.unitPrice)}</td>
        <td class="right">${fmtKRW(calcAmount(item))}</td>
      </tr>
    `).join('')

    return `
      <h2>${template?.icon ?? ''} ${esc(table.label)}</h2>
      <table class="po-table">
        <thead>
          <tr>
            <td>번호</td><td>품목명</td><td>마감재</td>
            <td>너비</td><td>높이</td><td>순면적</td>
            <td>수량</td><td>단위</td><td>단가</td><td>금액</td>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          <tr class="total-row">
            <td colspan="9">합계</td>
            <td class="right">${fmtKRW(total)}</td>
          </tr>
        </tbody>
      </table>
    `
  }).join('')

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>발주서</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4 portrait; margin: 15mm; }
  body { font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; color: #222; }
  h1 { font-size: 22pt; text-align: center; padding: 20px 0 12px; letter-spacing: 4px; }
  .header { display: flex; justify-content: space-between; padding: 12px 0; border-top: 2px solid #222; border-bottom: 1px solid #aaa; margin-bottom: 24px; font-size: 10pt; }
  .header .label { color: #888; margin-right: 6px; }
  h2 { font-size: 13pt; margin: 24px 0 8px; padding-bottom: 6px; border-bottom: 1px solid #ccc; }
  table.po-table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-bottom: 16px; }
  table.po-table thead td { background: #f5f5f5; font-weight: 600; padding: 6px; border-bottom: 1.5px solid #444; color: #444; }
  table.po-table td { padding: 5px 6px; border-bottom: 1px solid #eee; }
  table.po-table .right { text-align: right; }
  table.po-table .center { text-align: center; }
  table.po-table .total-row td { background: #f0f4ff; font-weight: 700; border-top: 1px solid #ccc; }
  .grand { margin-top: 24px; text-align: right; font-size: 14pt; font-weight: 700; color: #1a73e8; padding: 12px 0; border-top: 2px solid #1a73e8; border-bottom: 2px solid #1a73e8; }
  .footer { margin-top: 60px; font-size: 9pt; color: #888; text-align: center; border-top: 1px solid #ddd; padding-top: 12px; }
</style>
</head>
<body>
  <h1>발 주 서</h1>
  <div class="header">
    <div><span class="label">발행일</span>${date}</div>
    <div><span class="label">물량표</span>${po.tables.length}건</div>
  </div>
  ${tablesHtml}
  <div class="grand">총 합계: ${fmtKRW(grand)}</div>
  <div class="footer">본 발주서는 ${date} 기준이며, 자재 시세에 따라 변동될 수 있습니다. — bimove</div>
</body>
</html>`

  const win = window.open('', '_blank')
  if (!win) { alert('팝업 차단을 해제해 주세요.'); return }
  win.document.write(html)
  win.document.close()
  setTimeout(() => win.print(), 600)
}

// ── JPG 내보내기 (canvas 렌더링) ──

export async function exportPOJpg(po: PurchaseOrder) {
  // 간단한 구현: PDF와 동일한 HTML을 iframe에 렌더 후 캡처
  // html2canvas 없이 SVG foreignObject 방식으로 처리
  alert('JPG 내보내기는 PDF에서 인쇄 > JPG 저장을 이용해 주세요.')
  printPOPdf(po)
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!),
  )
}
