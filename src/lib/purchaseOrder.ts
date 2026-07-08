// 발주서 데이터 모델 + CRUD + 계산 함수
// localStorage 기반 프로젝트별 저장

export type BOQTemplateId = 'wallpaper' | 'tile' | 'paint' | 'flooring' | 'film'

export type Exclusion = {
  id: string
  type: 'door' | 'window' | 'custom'
  label: string
  shapeId?: string
  widthMm: number
  heightMm: number
}

export type BOQItem = {
  id: string
  name: string
  material: string
  widthMm: number
  heightMm: number
  exclusions: Exclusion[]
  itemWidthMm: number
  itemLengthMm: number
  lossRate: number
  unitPrice: number
  unit: string
}

export type BOQTable = {
  id: string
  templateId: BOQTemplateId
  label: string
  items: BOQItem[]
  createdAt: number
}

export type PurchaseOrder = {
  projectId: string
  tables: BOQTable[]
  updatedAt: number
}

// ── 계산 함수 ──

/** 총면적 (m²) */
export function grossArea(item: BOQItem): number {
  return (item.widthMm * item.heightMm) / 1_000_000
}

/** 제외면적 합 (m²) */
export function exclusionArea(item: BOQItem): number {
  return item.exclusions.reduce(
    (sum, ex) => sum + (ex.widthMm * ex.heightMm) / 1_000_000,
    0,
  )
}

/** 순면적 (m²) */
export function netArea(item: BOQItem): number {
  return Math.max(0, grossArea(item) - exclusionArea(item))
}

/** 수량 산출 */
export function calcQuantity(item: BOQItem): number {
  const net = netArea(item)
  if (net <= 0) return 0
  // m² 단위: 면적 그대로
  if (item.unit === 'm²') {
    return +(net * (1 + item.lossRate)).toFixed(2)
  }
  // 롤/장: 마감재 단위 면적으로 나눔
  const itemAreaM2 = (item.itemWidthMm * item.itemLengthMm) / 1_000_000
  if (itemAreaM2 <= 0) return 0
  return Math.ceil((net / itemAreaM2) * (1 + item.lossRate))
}

/** 금액 */
export function calcAmount(item: BOQItem): number {
  return calcQuantity(item) * item.unitPrice
}

/** 테이블 합계 */
export function tableTotal(table: BOQTable): number {
  return table.items.reduce((sum, item) => sum + calcAmount(item), 0)
}

/** 발주서 총 합계 */
export function poGrandTotal(po: PurchaseOrder): number {
  return po.tables.reduce((sum, t) => sum + tableTotal(t), 0)
}

// ── UUID ──

export function uid(): string {
  return crypto.randomUUID()
}

// ── localStorage CRUD ──

const PO_KEY = (projectId: string) => `bimove_po_${projectId}`

export function loadPurchaseOrder(projectId: string): PurchaseOrder {
  try {
    const raw = localStorage.getItem(PO_KEY(projectId))
    if (raw) return JSON.parse(raw) as PurchaseOrder
  } catch { /* ignore */ }
  return { projectId, tables: [], updatedAt: Date.now() }
}

export function savePurchaseOrder(po: PurchaseOrder): void {
  po.updatedAt = Date.now()
  try {
    localStorage.setItem(PO_KEY(po.projectId), JSON.stringify(po))
  } catch { /* storage full */ }
}

// ── 헬퍼 ──

export function addTable(po: PurchaseOrder, table: BOQTable): PurchaseOrder {
  return { ...po, tables: [...po.tables, table] }
}

export function removeTable(po: PurchaseOrder, tableId: string): PurchaseOrder {
  return { ...po, tables: po.tables.filter(t => t.id !== tableId) }
}

export function updateTableItems(
  po: PurchaseOrder,
  tableId: string,
  items: BOQItem[],
): PurchaseOrder {
  return {
    ...po,
    tables: po.tables.map(t => (t.id === tableId ? { ...t, items } : t)),
  }
}

export function duplicateItem(item: BOQItem): BOQItem {
  return {
    ...item,
    id: uid(),
    name: item.name + ' (복사)',
    exclusions: item.exclusions.map(ex => ({ ...ex, id: uid() })),
  }
}

/** 포맷: 원화 */
export function fmtKRW(amount: number): string {
  if (amount === 0) return '₩0'
  return '₩' + Math.round(amount).toLocaleString('ko-KR')
}

/** 포맷: 면적 */
export function fmtArea(m2: number): string {
  if (m2 <= 0) return '-'
  return m2.toFixed(2) + ' m²'
}
