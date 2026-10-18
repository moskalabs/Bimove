// 발주서 데이터 모델 + CRUD + 계산 함수
// localStorage 기반 프로젝트별 저장

export type BOQTemplateId =
  | 'wallpaper' | 'tile' | 'paint' | 'flooring' | 'film'
  // 천정
  | 'ceil-gypsum' | 'ceil-paint' | 'ceil-tex'
  // 벽
  | 'wall-wallpaper' | 'wall-paint' | 'wall-film' | 'wall-tile' | 'wall-louver' | 'wall-panel'
  // 바닥
  | 'floor-wood' | 'floor-tile' | 'floor-deco' | 'floor-vinyl' | 'floor-paint'
  // 몰딩
  | 'mold-ceiling' | 'mold-baseboard' | 'mold-finish'

/** 산출방식: 면적(m²), 길이(m), 수량(EA) */
export type CalcMethod = 'area' | 'length' | 'quantity'

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
  /** 산출방식 (기본: area) */
  calcMethod?: CalcMethod
  widthMm: number
  heightMm: number
  /** 길이 산출용 (m 단위) */
  lengthM?: number
  /** 수량 산출용 (EA) */
  manualQty?: number
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
  /**
   * 서버가 들고 있던 `purchase_orders.updated_at` **그대로**.
   *
   * 발주서 값이 아니라 **optimistic lock 의 기준값**이다. 이게 없으면 서버
   * 쓰기가 조건 없는 덮어쓰기가 되고, 그 길에는 `pruneRows` 가 붙어 있어서
   * 다른 기기가 방금 만든 품목이 **지워진다.** 스냅샷과 달리 발주서에는
   * 버전 백업이 없어서 되돌릴 방법이 없다.
   *
   * 숫자(`updatedAt`)로 바꾸지 않는다 — ms 로 깎으면 서버의 마이크로초와
   * 어긋나서 `.eq('updated_at', …)` 가 영원히 안 맞는다. 받은 문자열을
   * 그대로 되돌려줘야 한다.
   *
   * localStorage 에도 같이 실린다. 새로고침 뒤 서버 읽기가 실패해도 기준값
   * 없이 쓰는 일이 없게 하려는 것이다.
   */
  serverUpdatedAt?: string
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

/** 수량 산출 (산출방식별 분기) */
export function calcQuantity(item: BOQItem): number {
  const method = item.calcMethod ?? 'area'

  if (method === 'length') {
    // 길이 산출: lengthM * (1 + 로스율)
    const lenM = item.lengthM ?? 0
    if (lenM <= 0) return 0
    return +(lenM * (1 + item.lossRate)).toFixed(2)
  }

  if (method === 'quantity') {
    // 수량 산출: 직접 입력 EA
    return item.manualQty ?? 0
  }

  // 면적 산출 (기본)
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

import { scopedGet, scopedSet, scopedRemove } from './scopedStorage'

const PO_KEY = (projectId: string) => `bimova_po_${projectId}`

/** 이 기기에 저장된 발주서가 있는지. 없으면 서버를 그대로 받아야 한다. */
export function hasStoredPurchaseOrder(projectId: string): boolean {
  return scopedGet(PO_KEY(projectId)) !== null
}

/**
 * 이 기기의 발주서. 저장된 게 없으면 **updatedAt 0** 인 빈 발주서다.
 *
 * 여기서 Date.now() 를 쓰면 안 된다. 처음 들어온 기기는 로컬이 없는데 시각이
 * "지금" 으로 찍혀서, 서버 발주서가 낡아 보인다 → 서버를 거부하고 → 빈 발주서를
 * 서버로 올려 **남의 발주서를 지운다.** 저장한 적이 없으면 0 이 맞다.
 */
export function loadPurchaseOrder(projectId: string): PurchaseOrder {
  try {
    const raw = scopedGet(PO_KEY(projectId))
    if (raw) return JSON.parse(raw) as PurchaseOrder
  } catch { /* ignore */ }
  return { projectId, tables: [], updatedAt: 0 }
}

/**
 * 이 기기에 저장하고, 저장된 모습(새 updatedAt)을 돌려준다.
 *
 * 건네받은 객체를 **고치지 않는다.** 호출부가 넘기는 건 React state 라,
 * 제자리에서 바꾸면 리렌더 없이 값만 달라져 화면과 어긋난다.
 */
export function savePurchaseOrder(po: PurchaseOrder): PurchaseOrder {
  const saved: PurchaseOrder = { ...po, updatedAt: Date.now() }
  try {
    scopedSet(PO_KEY(saved.projectId), JSON.stringify(saved))
  } catch { /* storage full */ }
  return saved
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

/**
 * 서버 시계와 이 기기 시계의 차이를 봐주는 여유.
 *
 * 로컬은 Date.now(), 서버는 now() 로 찍는다. 디바운스(2초) 보다 넉넉히 잡아야
 * **아직 올라가지 않은 로컬 수정**이 서버에 지지 않는다.
 */
export const PO_CLOCK_SKEW_MS = 2000

/**
 * 서버 발주서를 가져다 쓸지.
 *
 * 예전엔 `remote.tables.length > 0` 으로 갈랐다. 두 가지가 어긋난다 —
 *
 *   1. 서버에서 **다 지운** 상태(tables 0개)가 무시된다. 그러면 로컬에 남아
 *      있던 삭제 전 데이터가 다음 동기화 때 서버로 다시 올라간다.
 *   2. 시각을 안 보므로, 아직 못 올린 로컬 수정이 **낡은 서버 데이터에 덮인다.**
 *
 * 애매하면 로컬을 남긴다 — 덮어쓰기는 되돌릴 수 없고, 남겨두면 다음 동기화에서
 * 어차피 서버로 올라간다.
 */
export function shouldTakeRemotePO(
  remote: { updatedAt: number },
  local: { updatedAt: number },
): boolean {
  return remote.updatedAt > local.updatedAt + PO_CLOCK_SKEW_MS
}

/** 이 프로젝트의 발주서를 이 기기에서 지운다 (프로젝트 삭제 때). */
export function deletePurchaseOrder(projectId: string): void {
  scopedRemove(PO_KEY(projectId))
}
