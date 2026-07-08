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

// ── PDF 내보내기 (정식 발주서 양식) ──

/** 금액을 한글 표기로 변환 (일금 ... 정) */
function amountToKorean(n: number): string {
  if (n <= 0) return '영'
  const units = ['', '만', '억', '조']
  const digits = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']
  const subUnits = ['', '십', '백', '천']

  const str = Math.round(n).toString()
  const groups: string[] = []
  let pos = str.length

  let groupIdx = 0
  while (pos > 0) {
    const start = Math.max(0, pos - 4)
    const chunk = str.slice(start, pos)
    const val = parseInt(chunk, 10)
    if (val > 0) {
      let part = ''
      for (let i = 0; i < chunk.length; i++) {
        const d = parseInt(chunk[i], 10)
        if (d === 0) continue
        const subUnit = subUnits[chunk.length - 1 - i]
        part += (d === 1 && subUnit ? '' : digits[d]) + subUnit
      }
      groups.unshift(part + units[groupIdx])
    }
    pos = start
    groupIdx++
  }

  return '일금 ' + groups.join(' ') + '원정(₩' + Math.round(n).toLocaleString('ko-KR') + ')'
}

export function printPOPdf(po: PurchaseOrder) {
  if (po.tables.length === 0) {
    alert('물량표가 비어 있습니다.')
    return
  }

  const now = new Date()
  const dateStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`
  const docNo = `PO-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
  const grand = poGrandTotal(po)
  const vat = Math.round(grand * 0.1)
  const totalWithVat = grand + vat

  // 물량표별 테이블 HTML
  const tablesHtml = po.tables.map((table, ti) => {
    const template = getTemplate(table.templateId)
    const total = tableTotal(table)

    const rowsHtml = table.items.map((item, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        <td class="l">${esc(item.name)}</td>
        <td class="l">${esc(item.material || '-')}</td>
        <td class="c">${item.itemWidthMm > 0 ? `${item.itemWidthMm}x${item.itemLengthMm}` : '-'}</td>
        <td class="r">${calcQuantity(item)}</td>
        <td class="c">${item.unit}</td>
        <td class="r">${comma(item.unitPrice)}</td>
        <td class="r">${comma(calcAmount(item))}</td>
        <td class="l">${netArea(item) > 0 ? netArea(item).toFixed(1) + 'm²' : ''}</td>
      </tr>
    `).join('')

    return `
      <div class="table-section">
        <div class="table-title">${ti + 1}. ${esc(table.label)} ${template?.icon ?? ''}</div>
        <table class="items">
          <thead>
            <tr>
              <th style="width:30px">NO</th>
              <th style="width:100px">품 명</th>
              <th style="width:100px">마감재</th>
              <th style="width:80px">규 격</th>
              <th style="width:50px">수 량</th>
              <th style="width:35px">단위</th>
              <th style="width:70px">단 가</th>
              <th style="width:80px">공급가액</th>
              <th>비 고</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
          <tfoot>
            <tr class="subtotal">
              <td colspan="7" class="r">소 계</td>
              <td class="r">${comma(total)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    `
  }).join('')

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>발주서 ${docNo}</title>
<style>
  @page { size: A4 portrait; margin: 12mm 15mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', 'NanumGothic', sans-serif; color: #111; font-size: 9pt; line-height: 1.5; }

  /* 제목 */
  .doc-title {
    text-align: center; font-size: 26pt; font-weight: 900;
    letter-spacing: 16px; padding: 18px 0 14px;
    border-bottom: 3px double #111;
  }

  /* 문서번호/날짜 */
  .doc-meta {
    display: flex; justify-content: flex-end; gap: 20px;
    padding: 8px 0; font-size: 8.5pt; color: #555;
  }

  /* 상단 정보 테이블 */
  .info-wrap {
    display: flex; gap: 0; margin: 10px 0 14px;
    border: 1.5px solid #111;
  }
  .info-block { flex: 1; }
  .info-block + .info-block { border-left: 1.5px solid #111; }
  .info-block .block-title {
    background: #f0f0f0; font-weight: 700; font-size: 9pt;
    padding: 5px 10px; border-bottom: 1px solid #ccc;
    text-align: center; letter-spacing: 4px;
  }
  .info-row {
    display: flex; border-bottom: 1px solid #e0e0e0;
    min-height: 26px; align-items: stretch;
  }
  .info-row:last-child { border-bottom: none; }
  .info-label {
    width: 60px; background: #f8f8f8; font-weight: 600;
    display: flex; align-items: center; justify-content: center;
    border-right: 1px solid #e0e0e0; font-size: 8pt; color: #444;
  }
  .info-value {
    flex: 1; padding: 4px 10px; display: flex; align-items: center;
    font-size: 8.5pt;
  }

  /* 금액 요약 */
  .amount-box {
    border: 1.5px solid #111; margin: 0 0 14px;
  }
  .amount-row {
    display: flex; border-bottom: 1px solid #e0e0e0;
    min-height: 30px; align-items: stretch;
  }
  .amount-row:last-child { border-bottom: none; }
  .amount-label {
    width: 80px; background: #f0f0f0; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    border-right: 1px solid #ccc; font-size: 9pt; letter-spacing: 2px;
  }
  .amount-value {
    flex: 1; padding: 4px 12px; display: flex; align-items: center;
    font-size: 10pt; font-weight: 600;
  }
  .amount-value.korean { font-size: 9pt; font-weight: 400; color: #333; }
  .amount-value.highlight { font-size: 12pt; font-weight: 800; color: #1a56db; }

  /* 품목 테이블 */
  .table-section { margin-bottom: 14px; }
  .table-title {
    font-size: 10pt; font-weight: 700; padding: 6px 0 4px;
    border-bottom: 1.5px solid #333; margin-bottom: 0;
  }
  table.items {
    width: 100%; border-collapse: collapse; font-size: 8pt;
  }
  table.items th {
    background: #f5f5f5; font-weight: 600; padding: 5px 4px;
    border: 1px solid #ccc; color: #333; text-align: center;
    font-size: 7.5pt;
  }
  table.items td {
    padding: 4px 5px; border: 1px solid #ddd;
  }
  table.items .c { text-align: center; }
  table.items .r { text-align: right; }
  table.items .l { text-align: left; }
  table.items .subtotal td {
    background: #f0f4ff; font-weight: 700; font-size: 8.5pt;
    border-top: 1.5px solid #555;
  }

  /* 합계 영역 */
  .grand-total {
    border: 2px solid #111; margin: 16px 0;
    display: flex; align-items: stretch; min-height: 38px;
  }
  .grand-total .gt-label {
    width: 120px; background: #1a56db; color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 11pt; letter-spacing: 6px;
  }
  .grand-total .gt-supply {
    flex: 1; display: flex; align-items: center; justify-content: center;
    border-right: 1px solid #ccc; font-size: 8pt;
  }
  .grand-total .gt-vat {
    flex: 1; display: flex; align-items: center; justify-content: center;
    border-right: 1px solid #ccc; font-size: 8pt;
  }
  .grand-total .gt-total {
    flex: 1.5; display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 13pt; color: #1a56db;
  }
  .gt-sub-label { font-size: 7pt; color: #888; margin-right: 6px; }

  /* 특기사항 */
  .notes {
    border: 1px solid #ccc; padding: 10px 14px; margin: 14px 0;
    font-size: 8pt; color: #555; line-height: 1.8;
    background: #fafafa; border-radius: 4px;
  }
  .notes-title { font-weight: 700; color: #333; margin-bottom: 4px; }

  /* 도장란 */
  .stamp-area {
    display: flex; justify-content: flex-end; margin-top: 30px; gap: 0;
  }
  .stamp-box {
    width: 80px; border: 1.5px solid #111; text-align: center;
  }
  .stamp-box + .stamp-box { border-left: none; }
  .stamp-box .stamp-title {
    background: #f0f0f0; font-weight: 700; font-size: 8pt;
    padding: 3px 0; border-bottom: 1px solid #ccc;
  }
  .stamp-content {
    height: 60px; display: flex; align-items: center; justify-content: center;
    color: #ccc; font-size: 7pt;
  }

  /* 푸터 */
  .footer {
    margin-top: 20px; padding-top: 8px; border-top: 1px solid #ddd;
    font-size: 7pt; color: #aaa; text-align: center;
  }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>

  <!-- 제목 -->
  <div class="doc-title">발 주 서</div>

  <!-- 문서번호/날짜 -->
  <div class="doc-meta">
    <span>문서번호: ${docNo}</span>
    <span>발주일자: ${dateStr}</span>
  </div>

  <!-- 수신/발신 정보 -->
  <div class="info-wrap">
    <div class="info-block">
      <div class="block-title">수 신 (공급자)</div>
      <div class="info-row"><div class="info-label">상 호</div><div class="info-value"></div></div>
      <div class="info-row"><div class="info-label">대표자</div><div class="info-value"></div></div>
      <div class="info-row"><div class="info-label">주 소</div><div class="info-value"></div></div>
      <div class="info-row"><div class="info-label">연락처</div><div class="info-value"></div></div>
    </div>
    <div class="info-block">
      <div class="block-title">발 신 (발주처)</div>
      <div class="info-row"><div class="info-label">상 호</div><div class="info-value"></div></div>
      <div class="info-row"><div class="info-label">대표자</div><div class="info-value"></div></div>
      <div class="info-row"><div class="info-label">현장명</div><div class="info-value"></div></div>
      <div class="info-row"><div class="info-label">연락처</div><div class="info-value"></div></div>
    </div>
  </div>

  <!-- 금액 요약 -->
  <div class="amount-box">
    <div class="amount-row">
      <div class="amount-label">합계금액</div>
      <div class="amount-value korean">${amountToKorean(totalWithVat)}</div>
    </div>
    <div class="amount-row">
      <div class="amount-label">공급가액</div>
      <div class="amount-value">${comma(grand)}원</div>
    </div>
    <div class="amount-row">
      <div class="amount-label">부가세</div>
      <div class="amount-value">${comma(vat)}원 (10%)</div>
    </div>
    <div class="amount-row">
      <div class="amount-label" style="background:#e8edf5;font-size:10pt">합 계</div>
      <div class="amount-value highlight">${comma(totalWithVat)}원</div>
    </div>
  </div>

  <!-- 품목 상세 -->
  ${tablesHtml}

  <!-- 총 합계 바 -->
  <div class="grand-total">
    <div class="gt-label">합 계</div>
    <div class="gt-supply"><span class="gt-sub-label">공급가액</span> ${comma(grand)}원</div>
    <div class="gt-vat"><span class="gt-sub-label">부가세</span> ${comma(vat)}원</div>
    <div class="gt-total">${comma(totalWithVat)}원</div>
  </div>

  <!-- 특기사항 -->
  <div class="notes">
    <div class="notes-title">특기사항</div>
    1. 상기 금액은 부가가치세 포함 금액입니다.<br>
    2. 납품기한: 발주일로부터 ( )일 이내<br>
    3. 납품장소: <br>
    4. 결제조건: <br>
    5. 자재 시세에 따라 단가가 변동될 수 있습니다.
  </div>

  <!-- 도장란 -->
  <div class="stamp-area">
    <div class="stamp-box">
      <div class="stamp-title">작 성</div>
      <div class="stamp-content">(인)</div>
    </div>
    <div class="stamp-box">
      <div class="stamp-title">검 토</div>
      <div class="stamp-content">(인)</div>
    </div>
    <div class="stamp-box">
      <div class="stamp-title">승 인</div>
      <div class="stamp-content">(인)</div>
    </div>
  </div>

  <!-- 푸터 -->
  <div class="footer">
    본 발주서는 ${dateStr} 기준 작성되었습니다. | bimove
  </div>

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
  alert('JPG 내보내기는 PDF에서 인쇄 > JPG 저장을 이용해 주세요.')
  printPOPdf(po)
}

// ── 유틸 ──

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!),
  )
}

function comma(n: number): string {
  return Math.round(n).toLocaleString('ko-KR')
}
