// 마감재 물량표 → 도면에 얹을 산출표 한 장.
//
// 패널의 물량표는 자재 하나를 골라 들여다보는 화면이다. 도면에 올릴 표는
// 그 반대 — **값이 들어 있는 것만** 한 줄씩 모아 놓은 집계표다. 빈 항목을
// 같이 실으면 도면 위에서 표만 커지고 읽을 게 없다.

import {
  sumFloorArea, sumWallArea, sumTotalArea,
  calcSheetQty, calcRollQty, sumPaintVolume, specOf,
  type FinishingTablesData, type FinishingItem, type MaterialVariant,
} from './finishingData'

export type BoqRow = {
  /** 구분 — 카테고리 (벽체 마감 등) */
  category: string
  /** 품명 — 자재 (석고보드 등) */
  item: string
  /** 규격 — 변형 이름. 규격 설명이 따로 있으면 괄호로 덧붙인다. */
  spec: string
  /** 면적 (m²). 길이로 세는 자재는 0. */
  areaM2: number
  /** 수량 */
  qty: number
  /** 수량의 단위 */
  unit: string
}

export type BoqSummary = {
  rows: BoqRow[]
  /** 바닥·벽 면적 합 (m²) — 표 맨 아래 줄 */
  totalAreaM2: number
}

/** 소수 둘째 자리까지. 표에서 자릿수가 들쭉날쭉하면 읽기 어렵다. */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * 이 변형의 수량과 단위.
 *
 * 도장은 **통 수가 아니라 리터**로 적는다. 통 크기는 화면에서 고르는 값이라
 * 저장돼 있지 않다 — 표에 통 수를 적으면 무슨 통인지 알 수 없는 숫자가 된다.
 */
function quantityOf(item: FinishingItem, v: MaterialVariant): { qty: number; unit: string } {
  switch (item.calcType) {
    case 'paint': {
      const coverage = specOf(item, v).coverageM2PerL ?? 10
      return { qty: round2(sumPaintVolume(v, coverage)), unit: 'L' }
    }
    case 'roll':
      return { qty: calcRollQty(item, v), unit: item.unit }
    case 'length': {
      // 몰딩·루버는 면적이 아니라 둘레 길이로 센다.
      const m = v.zones.reduce((s, z) => s + (z.wallLengthM || 0), 0)
      return { qty: round2(m), unit: item.unit || 'm' }
    }
    case 'area':
      return { qty: round2(sumTotalArea(v)), unit: item.unit || 'm²' }
    default:
      return { qty: calcSheetQty(item, v), unit: item.unit }
  }
}

/** 변형에 적어 넣을 게 있는지 — 면적도 길이도 0 이면 뺀다. */
function hasContent(item: FinishingItem, v: MaterialVariant): boolean {
  if (sumTotalArea(v) > 0) return true
  if (item.calcType === 'length') {
    return v.zones.some(z => (z.wallLengthM || 0) > 0)
  }
  return false
}

/** 규격 칸에 적을 글자. 변형 이름 + (자재 규격). */
function specLabelOf(item: FinishingItem, v: MaterialVariant): string {
  const note = v.specLabel ?? item.specLabel
  return note ? `${v.label} (${note})` : v.label
}

/**
 * 저장된 마감재 데이터에서 산출표를 만든다.
 *
 * 카테고리 → 자재 → 변형 순서를 그대로 둔다. 패널에서 보던 차례와 같아야
 * 도면의 표와 화면을 번갈아 봐도 헷갈리지 않는다.
 */
export function buildBoqSummary(data: FinishingTablesData): BoqSummary {
  const rows: BoqRow[] = []
  let totalAreaM2 = 0

  for (const cat of data.categories) {
    for (const item of cat.items) {
      for (const v of item.variants) {
        if (!hasContent(item, v)) continue
        const floor = sumFloorArea(v)
        const wall = item.floorOnly ? 0 : sumWallArea(v)
        const area = round2(floor + wall)
        const { qty, unit } = quantityOf(item, v)
        rows.push({
          category: cat.label,
          item: item.label,
          spec: specLabelOf(item, v),
          areaM2: area,
          qty,
          unit,
        })
        totalAreaM2 += area
      }
    }
  }

  return { rows, totalAreaM2: round2(totalAreaM2) }
}
