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
  /** 바닥 전용 (마루 등) — true이면 벽면 물량표 숨김 */
  floorOnly?: boolean
  /** 장/box 계산용: 자재 규격 */
  itemWidthMm?: number
  itemLengthMm?: number
  /** box 계산용: 박스당 면적 (m²/box) — itemWidth/Length 대신 사용 */
  boxAreaM2?: number
  /** roll 계산용: 롤당 면적 (m²/롤) */
  rollAreaM2?: number
  /** 도장 계산용: 도포율 (m²/L) */
  coverageM2PerL?: number
  /** 발주 용량 옵션 (L) — 도장용 */
  containerSizes?: number[]
  /** 기본 로스율 (0.05 = 5%) */
  lossRate: number
  /** 기본 단위 */
  unit: string
  /** 규격 설명 (예: "강마루 94 x 800 x 7.5T 기준 3.23 m²/box") */
  specLabel?: string
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
  /** 기본 데이터 버전 — 올리면 사용자 커스텀 없는 항목은 새 defaults로 갱신 */
  schemaVersion?: number
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
        id: 'f-wood', label: '목재', calcType: 'sheet',
        floorOnly: true, boxAreaM2: 3.23, lossRate: 0.10, unit: 'box',
        specLabel: '강마루 94 x 800 x 7.5T 기준 3.23 m²/box',
        variants: [createVariant('목재')],
      },
      {
        id: 'f-tile', label: '타일', calcType: 'sheet',
        boxAreaM2: 1.44, lossRate: 0.10, unit: 'box',
        specLabel: '박스당 면적 1.44 m²/box',
        variants: [createVariant('타일 A'), createVariant('타일 B'), createVariant('타일 C')],
      },
      {
        id: 'f-paint', label: '도장', calcType: 'paint',
        coverageM2PerL: 8, containerSizes: [1, 4, 18], lossRate: 0.05, unit: 'L',
        specLabel: '수성 페인트 기준 8m²/L (면적 x 도포횟수 / 도포율)',
        variants: [createVariant('도장 A')],
      },
      {
        id: 'f-wallpaper', label: '벽지', calcType: 'roll',
        rollAreaM2: 16, lossRate: 0.10, unit: '롤',
        specLabel: '실크벽지 기준 16 m²/롤',
        variants: [createVariant('국산'), createVariant('수입')],
      },
      {
        id: 'f-film', label: '필름', calcType: 'roll',
        rollAreaM2: 2.4, lossRate: 0.10, unit: '롤',
        specLabel: '인테리어 필름 1220mm x 50m 기준 2.4 m²/롤',
        variants: [createVariant('필름')],
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

/** 자재의 단위 면적 (m²) — boxAreaM2 > rollAreaM2 > itemWidth*Length 우선순위 */
export function unitAreaM2(item: FinishingItem): number {
  if (item.boxAreaM2 && item.boxAreaM2 > 0) return item.boxAreaM2
  if (item.rollAreaM2 && item.rollAreaM2 > 0) return item.rollAreaM2
  return ((item.itemWidthMm ?? 0) * (item.itemLengthMm ?? 0)) / 1_000_000
}

/** 바닥전용 자재의 총 면적 (벽면 제외) */
function effectiveTotalArea(item: FinishingItem, variant: MaterialVariant): number {
  return item.floorOnly ? sumFloorArea(variant) : sumTotalArea(variant)
}

/** sheet/box 타입 발주 수량 계산 */
export function calcSheetQty(item: FinishingItem, variant: MaterialVariant): number {
  const total = effectiveTotalArea(item, variant)
  if (total <= 0) return 0
  const ua = unitAreaM2(item)
  if (ua <= 0) return 0
  return Math.ceil((total * (1 + item.lossRate)) / ua)
}

/** roll 타입 발주 수량 계산 (도배 등) */
export function calcRollQty(item: FinishingItem, variant: MaterialVariant): number {
  const total = effectiveTotalArea(item, variant)
  if (total <= 0) return 0
  const ua = unitAreaM2(item)
  if (ua <= 0) return 0
  return Math.ceil((total * (1 + item.lossRate)) / ua)
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

// ── 발주서 연동: 마감재 → 발주서 매핑 ──

/** 발주서 templateId → 마감재 finishingItemId 매핑 */
const PO_TO_FINISHING: Record<string, string> = {
  'wall-wallpaper': 'f-wallpaper',
  'wall-paint': 'f-paint',
  'wall-tile': 'f-tile',
  'wall-film': 'f-film',
  'floor-tile': 'f-tile',
  'floor-wood': 'f-wood',
  'flooring': 'f-wood',
  'film': 'f-film',
}

/** 마감재 Tables에서 특정 아이템의 총 시공면적(m²)을 가져온다 */
export function getFinishingAreaForPO(
  projectId: string,
  poTemplateId: string,
): { totalAreaM2: number; floorAreaM2: number; wallAreaM2: number; qty: number; unit: string; lossRate: number; itemWidthMm?: number; itemLengthMm?: number } | null {
  const finishingId = PO_TO_FINISHING[poTemplateId]
  if (!finishingId) return null

  const data = loadFinishingData(projectId)
  const item = data.categories.flatMap(c => c.items).find(i => i.id === finishingId)
  if (!item || item.variants.length === 0) return null

  // 전체 variants 합산
  let totalFloor = 0, totalWall = 0, totalQty = 0
  for (const v of item.variants) {
    totalFloor += sumFloorArea(v)
    totalWall += item.floorOnly ? 0 : sumWallArea(v)
    if (item.calcType === 'roll') totalQty += calcRollQty(item, v)
    else totalQty += calcSheetQty(item, v)
  }

  const totalArea = totalFloor + totalWall
  if (totalArea <= 0) return null

  return {
    totalAreaM2: totalArea,
    floorAreaM2: totalFloor,
    wallAreaM2: totalWall,
    qty: totalQty,
    unit: item.unit,
    lossRate: item.lossRate,
    itemWidthMm: item.itemWidthMm,
    itemLengthMm: item.itemLengthMm,
  }
}

// ── localStorage CRUD ──

const STORAGE_KEY = 'bimova_finishing_tables_v1'
/** 이 숫자를 올리면 저장된 데이터에 새 defaults가 병합됨 */
const SCHEMA_VERSION = 3

/** 저장된 데이터에 새 defaults를 병합 (사용자 입력값은 유지) */
function mergeDefaults(saved: FinishingTablesData): FinishingTablesData {
  const defaults = structuredClone(DEFAULT_CATEGORIES)
  for (const defCat of defaults) {
    const savedCat = saved.categories.find(c => c.key === defCat.key)
    if (!savedCat) {
      // 새 카테고리 추가
      saved.categories.push(defCat)
      continue
    }
    for (const defItem of defCat.items) {
      const savedItem = savedCat.items.find(i => i.id === defItem.id)
      if (!savedItem) {
        // 새 아이템 추가
        savedCat.items.push(defItem)
      } else {
        // 기존 아이템: defaults의 메타 업데이트 (variants는 defaults로 교체 - 사용자 zone 데이터가 비어있을 때만)
        savedItem.calcType = defItem.calcType
        savedItem.floorOnly = defItem.floorOnly
        savedItem.boxAreaM2 = defItem.boxAreaM2
        savedItem.rollAreaM2 = defItem.rollAreaM2
        savedItem.coverageM2PerL = defItem.coverageM2PerL
        savedItem.containerSizes = defItem.containerSizes
        savedItem.lossRate = defItem.lossRate
        savedItem.unit = defItem.unit
        savedItem.specLabel = defItem.specLabel
        savedItem.itemWidthMm = defItem.itemWidthMm
        savedItem.itemLengthMm = defItem.itemLengthMm
        // variants: 사용자가 zone 데이터를 입력하지 않았으면 defaults로 교체
        const hasUserData = savedItem.variants.some(v =>
          v.zones.some(z => z.floorAreaM2 > 0 || z.wallLengthM > 0 || z.label !== '')
        )
        if (!hasUserData) {
          savedItem.variants = defItem.variants
        }
      }
    }
  }
  saved.schemaVersion = SCHEMA_VERSION
  return saved
}

export function loadFinishingData(projectId: string): FinishingTablesData {
  try {
    const raw = scopedGet(`${STORAGE_KEY}_${projectId}`)
    if (raw) {
      const saved = JSON.parse(raw) as FinishingTablesData
      // 버전이 낮으면 새 defaults 병합
      if ((saved.schemaVersion ?? 0) < SCHEMA_VERSION) {
        const merged = mergeDefaults(saved)
        saveFinishingData(projectId, merged)
        return merged
      }
      return saved
    }
  } catch { /* ignore */ }
  return { categories: structuredClone(DEFAULT_CATEGORIES), updatedAt: Date.now(), schemaVersion: SCHEMA_VERSION }
}

export function saveFinishingData(projectId: string, data: FinishingTablesData): void {
  data.updatedAt = Date.now()
  data.schemaVersion = SCHEMA_VERSION
  try { scopedSet(`${STORAGE_KEY}_${projectId}`, JSON.stringify(data)) } catch { /* full */ }
}

export function resetFinishingData(): FinishingTablesData {
  return { categories: structuredClone(DEFAULT_CATEGORIES), updatedAt: Date.now(), schemaVersion: SCHEMA_VERSION }
}
