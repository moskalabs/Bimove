// 마감재 Tables 데이터 모델
// 카테고리(마감재/조명/이동집기/주방집기) → 자재 아이템 → 변형(서브탭) → 구역별 물량표
import { scopedGet, scopedSet, scopedRemove } from './scopedStorage'

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

// ── 자재 변형 (서브탭: 일반석고/방수석고, 포세린타일/자기질타일 등) ──

/**
 * 규격 오버라이드. 같은 자재라도 종류마다 박스 면적·도포율이 다르다
 * (포세린 600각은 4장/box, 자기질 300각은 16장/box — 둘 다 1.44 m² 지만
 * 모자이크는 1.03 m² 다).
 *
 * 비워두면 상위 FinishingItem 값을 쓴다. 예전 데이터에는 이 필드가 아예
 * 없으므로, 비었을 때 상위로 떨어지는 동작이 곧 하위 호환이다.
 */
export type MaterialSpec = {
  /**
   * box/장 단위 면적 (m²).
   *
   * 가로·세로·장수가 있으면 **그쪽이 이긴다** — 이 값은 거기서 계산해 함께
   * 저장해둔 사본이거나(화면이 매번 다시 곱하지 않아도 되게), 마루처럼 장수를
   * 모르는 자재가 직접 쓰는 값이다.
   */
  boxAreaM2?: number
  /** 롤당 면적 (m²) — rollWidthMm × rollLengthM 에서 나온다 */
  rollAreaM2?: number
  /** 도포율 (m²/L) */
  coverageM2PerL?: number
  /** 한 장의 가로 (mm) */
  itemWidthMm?: number
  /** 한 장의 세로 (mm) */
  itemLengthMm?: number
  /** BOX 당 장수. 제조사마다 다르므로 사용자가 고칠 수 있다. */
  piecesPerBox?: number
  /**
   * 두께 (mm). 계산에는 안 쓰고 규격 표시용이다 — 방화석고 12.5T 와
   * 일반석고 9.5T 는 면적이 같아도 다른 자재다.
   */
  thicknessMm?: number
  /** 롤 폭 (mm) */
  rollWidthMm?: number
  /** 롤 길이 (m) */
  rollLengthM?: number
  /** 로스율 (0.05 = 5%) */
  lossRate?: number
  /** 화면에 보여줄 규격 설명 */
  specLabel?: string
}

/**
 * 타일 규격별 BOX 당 기본 장수.
 *
 * 가로·세로를 바꾸면 여기서 장수를 끌어온다. **없는 규격은 추정하지 않는다** —
 * 포장 수량은 제조사가 정하는 값이라 비슷한 크기로 넘겨짚으면 발주 수량이
 * 조용히 틀어진다. 모르면 사용자가 직접 넣게 둔다 (defaultPiecesPerBox → null).
 */
export const BOX_PIECES_BY_SIZE: Record<string, number> = {
  '300x300': 16,
  '300x600': 8,
  '600x600': 4,
  '600x1200': 2,
  '1200x2400': 1,
}

/** 가로·세로(mm)에 등록된 BOX 당 장수. 없으면 null — 임의로 추정하지 않는다. */
export function defaultPiecesPerBox(widthMm: number, lengthMm: number): number | null {
  if (!(widthMm > 0) || !(lengthMm > 0)) return null
  // 600x300 과 300x600 은 같은 타일이다. 짧은 변을 앞에 두고 찾는다.
  const a = Math.min(widthMm, lengthMm)
  const b = Math.max(widthMm, lengthMm)
  return BOX_PIECES_BY_SIZE[`${a}x${b}`] ?? null
}

/**
 * BOX 당 면적 (m²) = 가로(mm) × 세로(mm) ÷ 1,000,000 × 장수.
 *
 * 예: 300 × 600 × 8장 = 1.44, 600 × 600 × 4장 = 1.44.
 * 소수점 넷째 자리에서 끊는다 — 1,060 × 15.6 같은 값이 부동소수 찌꺼기를
 * 달고 다니면 화면과 저장본이 미묘하게 달라 보인다.
 */
export function boxAreaM2From(widthMm: number, lengthMm: number, piecesPerBox: number): number {
  if (!(widthMm > 0) || !(lengthMm > 0) || !(piecesPerBox > 0)) return 0
  return round4((widthMm * lengthMm / 1_000_000) * piecesPerBox)
}

/** 1롤 면적 (m²) = 폭(mm) ÷ 1,000 × 길이(m). */
export function rollAreaM2From(widthMm: number, lengthM: number): number {
  if (!(widthMm > 0) || !(lengthM > 0)) return 0
  return round4((widthMm / 1000) * lengthM)
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000
}

export type MaterialVariant = MaterialSpec & {
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
  /** BOX 당 장수 (변형에 없을 때의 기본값) */
  piecesPerBox?: number
  /** 두께 mm (변형에 없을 때의 기본값) */
  thicknessMm?: number
  /**
   * 치수 칸 이름. 타일은 가로·세로지만 마루는 폭·길이다 — 길쭉한 자재를
   * "가로 95 / 세로 800" 이라고 적으면 읽는 사람이 한 번 멈칫한다.
   */
  dimLabels?: { width: string; length: string }
  /** 롤 폭 (mm) / 길이 (m) — 변형에 없을 때의 기본값 */
  rollWidthMm?: number
  rollLengthM?: number
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

export function createVariant(label: string, spec?: MaterialSpec): MaterialVariant {
  return { id: uid(), label, zones: [defaultZoneRow()], ...spec }
}

const DEFAULT_CATEGORIES: FinishingCategory[] = [
  {
    key: 'finishing', label: '마감재', expanded: true,
    items: [
      // ── 기본 항목 ──
      //
      // 각 자재의 첫 변형이 "기본 규격", 나머지가 "선택 가능한 규격" 이다.
      // 규격은 변형마다 다르므로(포세린 600각 4장/box vs 모자이크 11장/box)
      // 변형에 직접 달아둔다 — 상위 항목 값은 변형에 규격이 없는 옛 데이터를
      // 위한 폴백으로 남는다.
      //
      // 면적은 적어두지 않고 **가로·세로·장수에서 계산한다**
      // (boxAreaM2From / rollAreaM2From). 규격만 고치고 면적 갱신을 빠뜨리는
      // 사고를 구조적으로 막는다.
      {
        id: 'f-gypsum', label: '석고보드', calcType: 'sheet',
        itemWidthMm: 900, itemLengthMm: 1800, piecesPerBox: 1, thicknessMm: 9.5,
        boxAreaM2: 1.62, lossRate: 0.05, unit: '장',
        specLabel: '일반 석고보드 900 × 1800 × 9.5T (1.62 m²/장)',
        variants: [
          createVariant('일반 석고보드', { itemWidthMm: 900, itemLengthMm: 1800, piecesPerBox: 1, thicknessMm: 9.5, specLabel: '일반 석고보드 900 × 1800 × 9.5T (1.62 m²/장)' }),
          createVariant('방수 석고보드', { itemWidthMm: 900, itemLengthMm: 1800, piecesPerBox: 1, thicknessMm: 9.5, specLabel: '방수 석고보드 900 × 1800 × 9.5T (1.62 m²/장)' }),
          createVariant('방화 석고보드', { itemWidthMm: 900, itemLengthMm: 1800, piecesPerBox: 1, thicknessMm: 12.5, specLabel: '방화 석고보드 900 × 1800 × 12.5T (1.62 m²/장)' }),
          createVariant('차음 석고보드', { itemWidthMm: 900, itemLengthMm: 1800, piecesPerBox: 1, thicknessMm: 12.5, specLabel: '차음 석고보드 900 × 1800 × 12.5T (1.62 m²/장)' }),
          createVariant('유공 석고보드', { itemWidthMm: 900, itemLengthMm: 1800, piecesPerBox: 1, thicknessMm: 12.5, specLabel: '유공 석고보드 900 × 1800 × 12.5T (1.62 m²/장)' }),
        ],
      },
      {
        id: 'f-paint', label: '도장', calcType: 'paint',
        coverageM2PerL: 10, containerSizes: [1, 4, 18], lossRate: 0.05, unit: 'L',
        specLabel: '내부 수성페인트 기준 10 m²/L (면적 × 도포횟수 ÷ 도포율)',
        variants: [
          createVariant('내부 수성페인트', { coverageM2PerL: 10, specLabel: '내부 수성페인트 기준 10 m²/L (면적 × 도포횟수 ÷ 도포율)' }),
          createVariant('외부 수성페인트', { coverageM2PerL: 8, specLabel: '외부 수성페인트 기준 8 m²/L (면적 × 도포횟수 ÷ 도포율)' }),
          createVariant('락카페인트', { coverageM2PerL: 10, specLabel: '락카페인트 기준 10 m²/L (면적 × 도포횟수 ÷ 도포율)' }),
          createVariant('에나멜페인트', { coverageM2PerL: 12, specLabel: '에나멜페인트 기준 12 m²/L (면적 × 도포횟수 ÷ 도포율)' }),
          createVariant('에폭시페인트', { coverageM2PerL: 8, specLabel: '에폭시페인트 기준 8 m²/L (면적 × 도포횟수 ÷ 도포율)' }),
          createVariant('우레탄페인트', { coverageM2PerL: 12, specLabel: '우레탄페인트 기준 12 m²/L (면적 × 도포횟수 ÷ 도포율)' }),
          createVariant('프라이머', { coverageM2PerL: 10, specLabel: '프라이머 기준 10 m²/L (면적 × 도포횟수 ÷ 도포율)' }),
        ],
      },
      {
        id: 'f-tile', label: '타일', calcType: 'sheet',
        itemWidthMm: 600, itemLengthMm: 600, piecesPerBox: 4,
        boxAreaM2: 1.44, lossRate: 0.10, unit: 'box',
        specLabel: '포세린타일 600 × 600 기준 1.44 m²/box (4장/box)',
        variants: [
          createVariant('포세린타일', { itemWidthMm: 600, itemLengthMm: 600, piecesPerBox: 4, specLabel: '포세린타일 600 × 600 기준 1.44 m²/box (4장/box)' }),
          createVariant('자기질타일', { itemWidthMm: 300, itemLengthMm: 300, piecesPerBox: 16, specLabel: '자기질타일 300 × 300 기준 1.44 m²/box (16장/box)' }),
          createVariant('도기질타일', { itemWidthMm: 300, itemLengthMm: 600, piecesPerBox: 8, specLabel: '도기질타일 300 × 600 기준 1.44 m²/box (8장/box)' }),
          // 300각 11장 = 0.99 m². 표에 1.03 으로 적혀 있었지만 면적은 규격에서
          // 계산하므로(가로 × 세로 × 장수) 여기서는 0.99 가 된다.
          createVariant('모자이크타일', { itemWidthMm: 300, itemLengthMm: 300, piecesPerBox: 11, specLabel: '모자이크타일 300 × 300 기준 0.99 m²/box (11장/box)' }),
          createVariant('기타 타일', { itemWidthMm: 600, itemLengthMm: 1200, piecesPerBox: 2, specLabel: '기타 타일 600 × 1200 기준 1.44 m²/box (2장/box)' }),
        ],
      },
      {
        id: 'f-wallpaper', label: '도배', calcType: 'roll',
        rollWidthMm: 1060, rollLengthM: 15.6,
        rollAreaM2: 16.536, lossRate: 0.10, unit: '롤',
        specLabel: '실크벽지 1,060mm × 15.6m 기준 16.54 m²/롤',
        variants: [
          createVariant('실크벽지', { rollWidthMm: 1060, rollLengthM: 15.6, specLabel: '실크벽지 1,060mm × 15.6m 기준 16.54 m²/롤' }),
          createVariant('합지벽지(광폭)', { rollWidthMm: 930, rollLengthM: 17.75, specLabel: '합지벽지 930mm × 17.75m 기준 16.51 m²/롤' }),
          createVariant('수입벽지', { rollWidthMm: 530, rollLengthM: 10.05, specLabel: '수입벽지 530mm × 10.05m 기준 5.33 m²/롤' }),
          createVariant('기타 벽지', { rollWidthMm: 1000, rollLengthM: 2.4, specLabel: '기타 벽지 1,000mm × 2.4m 기준 2.4 m²/롤' }),
        ],
      },
      {
        // 마루는 BOX 당 장수가 제품마다 제각각이라(강마루 94 × 800 이 43장쯤)
        // 표에도 장수가 없다. 장수를 임의로 지어내지 않고 면적을 직접 쓴다.
        // 마루는 길쭉해서 "가로/세로" 가 아니라 "폭/길이" 로 읽는다.
        id: 'f-wood', label: '마루', calcType: 'sheet',
        floorOnly: true,
        dimLabels: { width: '폭', length: '길이' },
        itemWidthMm: 94, itemLengthMm: 800, thicknessMm: 7.5, piecesPerBox: 43,
        boxAreaM2: 3.23, lossRate: 0.10, unit: 'box',
        specLabel: '강마루 94 × 800 × 7.5T 기준 3.23 m²/box',
        variants: [
          createVariant('강마루', { itemWidthMm: 94, itemLengthMm: 800, thicknessMm: 7.5, piecesPerBox: 43, specLabel: '강마루 94 × 800 × 7.5T 기준 3.23 m²/box' }),
          createVariant('광폭 강마루', { itemWidthMm: 165, itemLengthMm: 1200, thicknessMm: 7.5, piecesPerBox: 16, specLabel: '광폭 강마루 165 × 1200 × 7.5T 기준 3.17 m²/box' }),
          createVariant('강화마루', { itemWidthMm: 190, itemLengthMm: 1200, thicknessMm: 8, piecesPerBox: 8, specLabel: '강화마루 190 × 1200 × 8T 기준 1.82 m²/box' }),
          createVariant('원목마루', { itemWidthMm: 150, itemLengthMm: 1200, thicknessMm: 12, piecesPerBox: 12, specLabel: '원목마루 150 × 1200 × 12T 기준 2.16 m²/box' }),
        ],
      },
      // ── 추가 선택 항목 ──
      {
        id: 'f-tex', label: '텍스', calcType: 'sheet',
        boxAreaM2: 0.59, lossRate: 0.05, unit: '매',
        specLabel: '텍스 600x600 기준',
        variants: [createVariant('텍스')],
      },
      {
        id: 'f-film', label: '필름', calcType: 'roll',
        rollAreaM2: 2.4, lossRate: 0.10, unit: '롤',
        specLabel: '인테리어 필름 1220mm x 50m 기준',
        variants: [createVariant('필름')],
      },
      {
        id: 'f-louver', label: '루버', calcType: 'length',
        lossRate: 0.05, unit: 'M',
        specLabel: '루버 M당 산출',
        variants: [createVariant('루버')],
      },
      {
        id: 'f-panel', label: '판넬', calcType: 'sheet',
        boxAreaM2: 2.88, lossRate: 0.05, unit: '매',
        specLabel: '판넬 1200x2400 기준',
        variants: [createVariant('판넬')],
      },
      {
        id: 'f-decotile', label: '데코타일', calcType: 'sheet',
        boxAreaM2: 3.34, lossRate: 0.10, unit: 'box',
        specLabel: '데코타일 박스당 3.34 m²/box',
        floorOnly: true,
        variants: [createVariant('데코타일')],
      },
      {
        id: 'f-jangpan', label: '장판', calcType: 'roll',
        rollAreaM2: 3.6, lossRate: 0.05, unit: '롤',
        specLabel: '장판 1800mm 롤 기준',
        floorOnly: true,
        variants: [createVariant('장판')],
      },
      {
        id: 'f-ceil-mold', label: '천정몰딩', calcType: 'length',
        lossRate: 0.05, unit: 'M',
        specLabel: '천정몰딩 M당 산출',
        variants: [createVariant('천정몰딩')],
      },
      {
        id: 'f-baseboard', label: '걸레받이', calcType: 'length',
        lossRate: 0.05, unit: 'M',
        specLabel: '걸레받이 M당 산출',
        variants: [createVariant('걸레받이')],
      },
      {
        id: 'f-finish-mold', label: '마감몰딩', calcType: 'length',
        lossRate: 0.05, unit: 'M',
        specLabel: '마감몰딩 M당 산출',
        variants: [createVariant('마감몰딩')],
      },
    ],
  },
  { key: 'lighting', label: '조명', expanded: false, items: [] },
  { key: 'furniture', label: '이동 집기', expanded: false, items: [] },
  { key: 'appliance', label: '가전', expanded: false, items: [] },
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

/**
 * 실제로 쓸 규격 — 변형에 값이 있으면 그걸, 없으면 상위 자재 값을 쓴다.
 *
 * 변형마다 규격이 다른 게 기본이다 (포세린 600각 1.44 m²/box vs 모자이크
 * 1.03 m²/box). 예전 데이터에는 변형 규격이 아예 없으므로, 비었을 때 상위로
 * 떨어지는 이 동작이 곧 하위 호환이다.
 */
export function specOf(item: FinishingItem, variant?: MaterialVariant): MaterialSpec & { lossRate: number } {
  return {
    boxAreaM2: variant?.boxAreaM2 ?? item.boxAreaM2,
    rollAreaM2: variant?.rollAreaM2 ?? item.rollAreaM2,
    coverageM2PerL: variant?.coverageM2PerL ?? item.coverageM2PerL,
    itemWidthMm: variant?.itemWidthMm ?? item.itemWidthMm,
    itemLengthMm: variant?.itemLengthMm ?? item.itemLengthMm,
    piecesPerBox: variant?.piecesPerBox ?? item.piecesPerBox,
    thicknessMm: variant?.thicknessMm ?? item.thicknessMm,
    rollWidthMm: variant?.rollWidthMm ?? item.rollWidthMm,
    rollLengthM: variant?.rollLengthM ?? item.rollLengthM,
    lossRate: variant?.lossRate ?? item.lossRate,
    specLabel: variant?.specLabel ?? item.specLabel,
  }
}

/**
 * 자재의 단위 면적 (m²).
 *
 * 가로·세로·장수(또는 롤 폭·길이)가 있으면 **매번 거기서 계산한다**. 저장된
 * boxAreaM2 를 믿지 않는 이유는, 규격만 고치고 면적 갱신을 빠뜨린 데이터가
 * 들어와도 수량이 맞아야 하기 때문이다. 둘 다 없으면 저장값으로 떨어진다
 * (마루처럼 장수를 모르는 자재가 여기 해당한다).
 */
export function unitAreaM2(item: FinishingItem, variant?: MaterialVariant): number {
  const spec = specOf(item, variant)
  const fromPieces = boxAreaM2From(
    spec.itemWidthMm ?? 0, spec.itemLengthMm ?? 0, spec.piecesPerBox ?? 0)
  if (fromPieces > 0) return fromPieces

  const fromRoll = rollAreaM2From(spec.rollWidthMm ?? 0, spec.rollLengthM ?? 0)
  if (fromRoll > 0) return fromRoll

  if (spec.boxAreaM2 && spec.boxAreaM2 > 0) return spec.boxAreaM2
  if (spec.rollAreaM2 && spec.rollAreaM2 > 0) return spec.rollAreaM2
  return ((spec.itemWidthMm ?? 0) * (spec.itemLengthMm ?? 0)) / 1_000_000
}

/** 바닥전용 자재의 총 면적 (벽면 제외) */
function effectiveTotalArea(item: FinishingItem, variant: MaterialVariant): number {
  return item.floorOnly ? sumFloorArea(variant) : sumTotalArea(variant)
}

/** sheet/box 타입 발주 수량 계산 */
export function calcSheetQty(item: FinishingItem, variant: MaterialVariant): number {
  const total = effectiveTotalArea(item, variant)
  if (total <= 0) return 0
  const ua = unitAreaM2(item, variant)
  if (ua <= 0) return 0
  return Math.ceil((total * (1 + specOf(item, variant).lossRate)) / ua)
}

/** roll 타입 발주 수량 계산 (도배 등) */
export function calcRollQty(item: FinishingItem, variant: MaterialVariant): number {
  const total = effectiveTotalArea(item, variant)
  if (total <= 0) return 0
  const ua = unitAreaM2(item, variant)
  if (ua <= 0) return 0
  return Math.ceil((total * (1 + specOf(item, variant).lossRate)) / ua)
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
  'ceil-gypsum': 'f-gypsum',
  'floor-decotile': 'f-decotile',
  'floor-jangpan': 'f-jangpan',
  'ceil-mold': 'f-ceil-mold',
  'baseboard': 'f-baseboard',
  'finish-mold': 'f-finish-mold',
  'louver': 'f-louver',
  'panel': 'f-panel',
  'tex': 'f-tex',
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
const SCHEMA_VERSION = 9

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
        savedItem.piecesPerBox = defItem.piecesPerBox
        savedItem.thicknessMm = defItem.thicknessMm
        savedItem.dimLabels = defItem.dimLabels
        savedItem.rollAreaM2 = defItem.rollAreaM2
        savedItem.rollWidthMm = defItem.rollWidthMm
        savedItem.rollLengthM = defItem.rollLengthM
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

/** 이 프로젝트의 마감재 물량을 이 기기에서 지운다 (프로젝트 삭제 때). */
export function deleteFinishingData(projectId: string): void {
  scopedRemove(`${STORAGE_KEY}_${projectId}`)
}
