import { describe, it, expect } from 'vitest'
import {
  grossArea, exclusionArea, netArea,
  calcQuantity, calcAmount,
  tableTotal, poGrandTotal,
  loadPurchaseOrder, savePurchaseOrder,
  addTable, removeTable, updateTableItems, duplicateItem,
  uid, fmtKRW, fmtArea,
  type BOQItem, type BOQTable, type PurchaseOrder, type Exclusion,
} from '../../lib/purchaseOrder'

// ── 헬퍼 ──

function makeItem(overrides: Partial<BOQItem> = {}): BOQItem {
  return {
    id: uid(),
    name: '벽지',
    material: '실크',
    widthMm: 5000,
    heightMm: 2400,
    exclusions: [],
    itemWidthMm: 530,
    itemLengthMm: 15600,
    lossRate: 0.10,
    unitPrice: 35000,
    unit: '롤',
    ...overrides,
  }
}

function makeTable(items: BOQItem[] = [makeItem()]): BOQTable {
  return { id: uid(), templateId: 'wallpaper', label: '벽지', items, createdAt: Date.now() }
}

function makePO(tables: BOQTable[] = [makeTable()]): PurchaseOrder {
  return { projectId: 'proj-1', tables, updatedAt: Date.now() }
}

// ── 계산 함수 ──

describe('grossArea', () => {
  it('returns width * height in m²', () => {
    const item = makeItem({ widthMm: 5000, heightMm: 2400 })
    expect(grossArea(item)).toBeCloseTo(12.0) // 5m * 2.4m = 12m²
  })

  it('returns 0 for zero dimensions', () => {
    expect(grossArea(makeItem({ widthMm: 0, heightMm: 2400 }))).toBe(0)
    expect(grossArea(makeItem({ widthMm: 5000, heightMm: 0 }))).toBe(0)
  })
})

describe('exclusionArea', () => {
  it('sums exclusion areas', () => {
    const exclusions: Exclusion[] = [
      { id: '1', type: 'door', label: '문1', widthMm: 900, heightMm: 2100 },
      { id: '2', type: 'window', label: '창1', widthMm: 1200, heightMm: 1000 },
    ]
    const item = makeItem({ exclusions })
    // 0.9*2.1 + 1.2*1.0 = 1.89 + 1.2 = 3.09
    expect(exclusionArea(item)).toBeCloseTo(3.09)
  })

  it('returns 0 with no exclusions', () => {
    expect(exclusionArea(makeItem())).toBe(0)
  })
})

describe('netArea', () => {
  it('equals gross - exclusion', () => {
    const exclusions: Exclusion[] = [
      { id: '1', type: 'door', label: '문', widthMm: 900, heightMm: 2100 },
    ]
    const item = makeItem({ widthMm: 5000, heightMm: 2400, exclusions })
    // 12.0 - 1.89 = 10.11
    expect(netArea(item)).toBeCloseTo(10.11)
  })

  it('never goes below 0', () => {
    const exclusions: Exclusion[] = [
      { id: '1', type: 'custom', label: '큰 구멍', widthMm: 10000, heightMm: 10000 },
    ]
    const item = makeItem({ widthMm: 1000, heightMm: 1000, exclusions })
    expect(netArea(item)).toBe(0)
  })
})

describe('calcQuantity', () => {
  it('calculates roll quantity with loss rate', () => {
    // 12m² net, item: 0.53m * 15.6m = 8.268m², lossRate 10%
    // ceil(12 / 8.268 * 1.1) = ceil(1.597) = 2
    const item = makeItem({ widthMm: 5000, heightMm: 2400 })
    expect(calcQuantity(item)).toBe(2)
  })

  it('returns 0 when net area is 0', () => {
    const item = makeItem({ widthMm: 0, heightMm: 0 })
    expect(calcQuantity(item)).toBe(0)
  })

  it('returns 0 when item dimensions are 0', () => {
    const item = makeItem({ itemWidthMm: 0, itemLengthMm: 0 })
    expect(calcQuantity(item)).toBe(0)
  })

  it('handles m² unit (no item dimensions needed)', () => {
    const item = makeItem({ widthMm: 3000, heightMm: 4000, unit: 'm²', lossRate: 0.05 })
    // 12m² * 1.05 = 12.6
    expect(calcQuantity(item)).toBeCloseTo(12.6)
  })
})

describe('calcAmount', () => {
  it('equals quantity * unitPrice', () => {
    const item = makeItem({ widthMm: 5000, heightMm: 2400, unitPrice: 35000 })
    const qty = calcQuantity(item) // 2
    expect(calcAmount(item)).toBe(qty * 35000)
  })
})

describe('tableTotal', () => {
  it('sums all item amounts', () => {
    const items = [
      makeItem({ widthMm: 5000, heightMm: 2400, unitPrice: 35000 }),
      makeItem({ widthMm: 3000, heightMm: 2400, unitPrice: 20000 }),
    ]
    const table = makeTable(items)
    expect(tableTotal(table)).toBe(calcAmount(items[0]) + calcAmount(items[1]))
  })

  it('returns 0 for empty table', () => {
    expect(tableTotal(makeTable([]))).toBe(0)
  })
})

describe('poGrandTotal', () => {
  it('sums all table totals', () => {
    const t1 = makeTable([makeItem({ unitPrice: 35000 })])
    const t2 = makeTable([makeItem({ unitPrice: 50000 })])
    const po = makePO([t1, t2])
    expect(poGrandTotal(po)).toBe(tableTotal(t1) + tableTotal(t2))
  })

  it('returns 0 for empty PO', () => {
    expect(poGrandTotal(makePO([]))).toBe(0)
  })
})

// ── localStorage CRUD ──

describe('loadPurchaseOrder / savePurchaseOrder', () => {
  it('returns empty PO if nothing saved', () => {
    const po = loadPurchaseOrder('proj-new')
    expect(po.projectId).toBe('proj-new')
    expect(po.tables).toEqual([])
  })

  it('round-trips save/load', () => {
    const po = makePO()
    savePurchaseOrder(po)
    const loaded = loadPurchaseOrder(po.projectId)
    expect(loaded.tables.length).toBe(1)
    expect(loaded.tables[0].label).toBe('벽지')
  })

  it('handles corrupted localStorage', () => {
    localStorage.setItem('bimova_po_bad', 'NOT_JSON')
    const po = loadPurchaseOrder('bad')
    expect(po.tables).toEqual([])
  })
})

// ── 헬퍼 함수 ──

describe('addTable', () => {
  it('appends table to PO', () => {
    const po = makePO([])
    const table = makeTable()
    const updated = addTable(po, table)
    expect(updated.tables.length).toBe(1)
    expect(updated.tables[0].id).toBe(table.id)
  })
})

describe('removeTable', () => {
  it('removes table by id', () => {
    const t1 = makeTable()
    const t2 = makeTable()
    const po = makePO([t1, t2])
    const updated = removeTable(po, t1.id)
    expect(updated.tables.length).toBe(1)
    expect(updated.tables[0].id).toBe(t2.id)
  })

  it('no-op if id not found', () => {
    const po = makePO([makeTable()])
    const updated = removeTable(po, 'nonexistent')
    expect(updated.tables.length).toBe(1)
  })
})

describe('updateTableItems', () => {
  it('replaces items in specific table', () => {
    const table = makeTable([makeItem({ name: '기존' })])
    const po = makePO([table])
    const newItems = [makeItem({ name: '새것' })]
    const updated = updateTableItems(po, table.id, newItems)
    expect(updated.tables[0].items[0].name).toBe('새것')
  })
})

describe('duplicateItem', () => {
  it('creates copy with new id and (복사) suffix', () => {
    const original = makeItem({ name: '벽지 A' })
    const copy = duplicateItem(original)
    expect(copy.id).not.toBe(original.id)
    expect(copy.name).toBe('벽지 A (복사)')
  })

  it('gives new ids to exclusions', () => {
    const original = makeItem({
      exclusions: [{ id: 'ex-1', type: 'door', label: '문', widthMm: 900, heightMm: 2100 }],
    })
    const copy = duplicateItem(original)
    expect(copy.exclusions[0].id).not.toBe('ex-1')
    expect(copy.exclusions[0].label).toBe('문')
  })
})

// ── 포맷 ──

describe('fmtKRW', () => {
  it('formats 0', () => expect(fmtKRW(0)).toBe('₩0'))
  it('formats positive', () => expect(fmtKRW(1500000)).toContain('1,500,000'))
  it('rounds to integer', () => expect(fmtKRW(1234.56)).toContain('1,235'))
})

describe('fmtArea', () => {
  it('formats area with 2 decimals', () => expect(fmtArea(12.345)).toBe('12.35 m²'))
  it('returns dash for 0', () => expect(fmtArea(0)).toBe('-'))
  it('returns dash for negative', () => expect(fmtArea(-1)).toBe('-'))
})

describe('uid', () => {
  it('returns unique strings', () => {
    const ids = new Set(Array.from({ length: 50 }, () => uid()))
    expect(ids.size).toBe(50)
  })
})
