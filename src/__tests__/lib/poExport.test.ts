import { describe, it, expect, vi } from 'vitest'
import type { PurchaseOrder, BOQItem, BOQTable } from '../../lib/purchaseOrder'
import { uid } from '../../lib/purchaseOrder'

// amountToKorean is internal, test it indirectly via printPOPdf HTML output
// We test the logic that we can import directly

function makeItem(overrides: Partial<BOQItem> = {}): BOQItem {
  return {
    id: uid(), name: '벽지', material: '실크',
    widthMm: 5000, heightMm: 2400, exclusions: [],
    itemWidthMm: 530, itemLengthMm: 15600,
    lossRate: 0.10, unitPrice: 35000, unit: '롤',
    ...overrides,
  }
}

function makeTable(items: BOQItem[] = [makeItem()]): BOQTable {
  return { id: uid(), templateId: 'wallpaper', label: '벽지', items, createdAt: Date.now() }
}

function makePO(tables: BOQTable[] = [makeTable()]): PurchaseOrder {
  return { projectId: 'proj-1', tables, updatedAt: Date.now() }
}

describe('poExport (XLSX)', () => {
  it('exportPOXlsx is a function', async () => {
    const mod = await import('../../lib/poExport')
    expect(typeof mod.exportPOXlsx).toBe('function')
  })
})

describe('poExport (PDF)', () => {
  it('printPOPdf is a function', async () => {
    const mod = await import('../../lib/poExport')
    expect(typeof mod.printPOPdf).toBe('function')
  })

  it('printPOPdf alerts on empty tables', async () => {
    const alertSpy = vi.spyOn(globalThis, 'alert').mockImplementation(() => {})
    const { printPOPdf } = await import('../../lib/poExport')
    printPOPdf(makePO([]))
    expect(alertSpy).toHaveBeenCalledWith('물량표가 비어 있습니다.')
    alertSpy.mockRestore()
  })
})

describe('poExport (JPG)', () => {
  it('exportPOJpg is a function', async () => {
    const mod = await import('../../lib/poExport')
    expect(typeof mod.exportPOJpg).toBe('function')
  })
})

describe('HTML 이스케이프 (XSS)', () => {
  /** window.open 을 가짜로 바꿔 document.write 로 넘어간 HTML 을 잡아낸다. */
  function captureHtml(run: () => void): string {
    let captured = ''
    const fakeWin = {
      document: { write: (s: string) => { captured += s }, close: () => {} },
      print: () => {},
    }
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWin as unknown as Window)
    try { run() } finally { openSpy.mockRestore() }
    return captured
  }

  const PAYLOAD = '<script>alert(1)</script>'

  it('발주서: 단위 칸의 태그를 이스케이프한다', async () => {
    const { printPOPdf } = await import('../../lib/poExport')
    const po = makePO([makeTable([makeItem({ unit: PAYLOAD })])])
    vi.useFakeTimers()
    const html = captureHtml(() => printPOPdf(po))
    vi.useRealTimers()
    expect(html).not.toContain(PAYLOAD)
    expect(html).toContain('&lt;script&gt;')
  })

  it('발주서: 품명·마감재도 이스케이프한다', async () => {
    const { printPOPdf } = await import('../../lib/poExport')
    const po = makePO([makeTable([makeItem({ name: PAYLOAD, material: PAYLOAD })])])
    vi.useFakeTimers()
    const html = captureHtml(() => printPOPdf(po))
    vi.useRealTimers()
    expect(html).not.toContain(PAYLOAD)
  })

  it('견적서: 카테고리·단위를 이스케이프한다', async () => {
    const { printQuotePdf } = await import('../../lib/quoteExport')
    const html = captureHtml(() => printQuotePdf(
      [{ category: PAYLOAD, name: '벽체', qty: 1, unit: PAYLOAD, unitPrice: 1000, amount: 1000 }],
      { projectName: PAYLOAD },
    ))
    expect(html).not.toContain(PAYLOAD)
    expect(html).toContain('&lt;script&gt;')
  })
})
