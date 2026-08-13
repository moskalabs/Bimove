// 마감재 Tables 데이터 모델
// 카테고리(마감재/조명/이동집기/주방집기) → 자재 아이템 → 변형(서브탭) → 구역별 물량표
import { scopedGet, scopedSet } from './scopedStorage'

// ── 구역별 행 ──

export type ZoneRow = {
  id: string
  label: string       // 구역/공간 이름 (거실, 안방 등)
  floorAreaM2: number  // 평면 면적
  wallLengthM: number  // 벽 길이 (m)
  wallHeightM: number  // 적용 높이 (m, 기본 2.4)
  /** 도장 전용: 도포 횟수 */
  coatCount?: number
}

// ── 자재 변형 (서브탭: 석고보드/방수석고, 도장A/도장B 등) ──

export type MaterialVariant = {
  id: string
  label: string       // 탭 이름
  zones: ZoneRow[]
}

// ── 자재 아이템 ──

export type FinishingItem = {
  id: string
  label: string            // 석고보드, 도장, 타일 등
  calcType: CalcType       // 계산 유형
  /** 장/box 계산용: 자재 규격 */
  itemWidthMm?: number
  itemLengthMm?: number
  /** 도장 계산용: 도포율 (m²/L) */
  coverageM2PerL?: number
  /** 발주 용량 옵션 (L) — 도장용 */
  containerSizes?: number[]
  /** 기본 로스율 (0.05 = 5%) */
  lossRate: number
  /** 기본 단위 */
  unit: string
  /** 서브 변형 탭들 */
  variants: MaterialVariant[]
}

export type CalcType = 'sheet' | 'paint' | 'roll' | 'area' | 'length'

// ── 카테고리 ──

export type FinishingCategory = {
  key: string
  label: string
  expanded: boolean
  items: FinishingItem[]
}

// ── 전체 데이터 ──

export type FinishingTablesData = {
  categories: FinishingCategory[]
  updatedAt: number
}

// ── UUID ──
export function uid(): string { return crypto.randomUUID() }

// ── 기본 데이터 ──

function defaultZoneRow(): ZoneRow {
  return { id: uid(), label: '', floorAreaM2: 0, wallLengthM: 0, wallHeightM: 2.4 }
}

export function createVariant(label: string): MaterialVariant {
  return { id: uid(), label, zones: [defaultZoneRow()] }
}

const DEFAULT_CATEGORIES: FinishingCategory[] = [
  {
    key: 'finishing', label: '마감재', expanded: true,
    items: [
      {
        id: 'f-gypsum', label: '석고보드', calcType: 'sheet',
        itemWidthMm: 900, itemLengthMm: 1800, lossRate: 0.10, unit: '장',
        variants: [createVariant('석고보드')],
      },
      {
        id: 'f-paint', label: '도장', calcType: 'paint',
        coverageM2PerL: 8, containerSizes: [1, 4, 18], lossRate: 0.05, unit: 'L',
        variants: [createVariant('도장 A')],
      },
      {
        id: 'f-tile', label: '타일', calcType: 'sheet',
        itemWidthMm: 300, itemLengthMm: 600, lossRate: 0.08, unit: '장',
        variants: [createVariant('타일')],
      },
      {
        id: 'f-wallpaper', label: '도배', calcType: 'roll',
        itemWidthMm: 530, itemLengthMm: 15600, lossRate: 0.10, unit: '롤',
        variants: [createVariant('도배')],
      },
      {
        id: 'f-wood', label: '마루', calcType: 'sheet',
        itemWidthMm: 1200, itemLengthMm: 190, lossRate: 0.08, unit: '장',
        variants: [createVariant('마루')],
      },
    ],
  },
  { key: 'lighting', label: '조명', expanded: false, items: [] },
  { key: 'furniture', label: '이동 집기', expanded: false, items: [] },
  { key: 'kitchen', label: '주방 집기', expanded: false, items: [] },
]

// ── 계산 함수 ──

/** 구역의 벽면 면적 (m²) */
export function wallAreaM2(z: ZoneRow): number {
  return z.wallLengthM * z.wallHeightM
}

/** 구역의 총 면적 (평면 + 벽면) */
export function totalAreaM2(z: ZoneRow): number {
  return z.floorAreaM2 + wallAreaM2(z)
}

/** 변형의 합계 평면 면적 */
export function sumFloorArea(v: MaterialVariant): number {
  return v.zones.reduce((s, z) => s + z.floorAreaM2, 0)
}

/** 변형의 합계 벽면 면적 */
export function sumWallArea(v: MaterialVariant): number {
  return v.zones.reduce((s, z) => s + wallAreaM2(z), 0)
}

/** 변형의 총 시공면적 */
export function sumTotalArea(v: MaterialVariant): number {
  return sumFloorArea(v) + sumWallArea(v)
}

/** sheet 타입 발주 수량 계산 (석고보드, 타일, 마루 등) */
export function calcSheetQty(item: FinishingItem, variant: MaterialVariant): number {
  const total = sumTotalArea(variant)
  if (total <= 0) return 0
  const sheetM2 = ((item.itemWidthMm ?? 0) * (item.itemLengthMm ?? 0)) / 1_000_000
  if (sheetM2 <= 0) return 0
  return Math.ceil((total / sheetM2) * (1 + item.lossRate))
}

/** roll 타입 발주 수량 계산 (도배 등) */
export function calcRollQty(item: FinishingItem, variant: MaterialVariant): number {
  const total = sumTotalArea(variant)
  if (total <= 0) return 0
  const rollM2 = ((item.itemWidthMm ?? 0) * (item.itemLengthMm ?? 0)) / 1_000_000
  if (rollM2 <= 0) return 0
  return Math.ceil((total / rollM2) * (1 + item.lossRate))
}

/** 도장: 구역별 필요 용량(L) */
export function paintVolumeL(z: ZoneRow, coverageM2PerL: number, surface: 'floor' | 'wall'): number {
  const coat = z.coatCount ?? 2
  const area = surface === 'floor' ? z.floorAreaM2 : wallAreaM2(z)
  if (area <= 0 || coverageM2PerL <= 0) return 0
  return +(area * coat / coverageM2PerL).toFixed(2)
}

/** 도장: 변형 전체 필요 용량(L) */
export function sumPaintVolume(variant: MaterialVariant, coverageM2PerL: number): number {
  return variant.zones.reduce((s, z) => {
    return s + paintVolumeL(z, coverageM2PerL, 'floor') + paintVolumeL(z, coverageM2PerL, 'wall')
  }, 0)
}

/** 도장: 발주 수량 (컨테이너 기준) */
export function calcPaintContainers(totalL: number, containerSizeL: number): number {
  if (totalL <= 0 || containerSizeL <= 0) return 0
  return Math.ceil(totalL / containerSizeL)
}

/** sheet/roll 단위 면적 (m²) */
export function sheetAreaM2(item: FinishingItem): number {
  return ((item.itemWidthMm ?? 0) * (item.itemLengthMm ?? 0)) / 1_000_000
}

// ── localStorage CRUD ──

const STORAGE_KEY = 'bimova_finishing_tables_v1'

export function loadFinishingData(projectId: string): FinishingTablesData {
  try {
    const raw = scopedGet(`${STORAGE_KEY}_${projectId}`)
    if (raw) return JSON.parse(raw) as FinishingTablesData
  } catch { /* ignore */ }
  return { categories: structuredClone(DEFAULT_CATEGORIES), updatedAt: Date.now() }
}

export function saveFinishingData(projectId: string, data: FinishingTablesData): void {
  data.updatedAt = Date.now()
  try { scopedSet(`${STORAGE_KEY}_${projectId}`, JSON.stringify(data)) } catch { /* full */ }
}

export function resetFinishingData(): FinishingTablesData {
  return { categories: structuredClone(DEFAULT_CATEGORIES), updatedAt: Date.now() }
}
