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
