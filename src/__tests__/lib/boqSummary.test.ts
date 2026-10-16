/**
 * 도면에 얹는 산출표의 내용 테스트.
 *
 * 패널 물량표는 자재 하나를 들여다보는 화면이고, 이건 **값이 들어 있는 것만**
 * 모은 집계표다. 빈 항목이 섞이면 도면 위에서 표만 커지고 읽을 게 없다.
 */
import { describe, it, expect } from 'vitest'
import { buildBoqSummary } from '../../lib/boqSummary'
import { createVariant, uid } from '../../lib/finishingData'
import type {
  FinishingTablesData, FinishingCategory, FinishingItem, MaterialVariant, ZoneRow,
} from '../../lib/finishingData'

const zone = (floor: number, wallLen = 0, wallH = 2.4): ZoneRow => ({
  id: uid(), label: '거실', floorAreaM2: floor, wallLengthM: wallLen, wallHeightM: wallH,
})

function variantWith(label: string, zones: ZoneRow[]): MaterialVariant {
  return { ...createVariant(label), zones }
}

function data(items: FinishingItem[]): FinishingTablesData {
  const cat: FinishingCategory = { key: 'c1', label: '벽체 마감', expanded: true, items }
  return { categories: [cat], updatedAt: 0 }
}

const sheetItem = (variants: MaterialVariant[]): FinishingItem => ({
  id: 'gypsum', label: '석고보드', calcType: 'sheet',
  itemWidthMm: 900, itemLengthMm: 1800, lossRate: 0.05, unit: '장',
  variants,
})

describe('buildBoqSummary', () => {
  it('값이 없는 변형은 싣지 않는다', () => {
    const got = buildBoqSummary(data([sheetItem([variantWith('A', [])])]))
    expect(got.rows).toHaveLength(0)
    expect(got.totalAreaM2).toBe(0)
  })

  it('면적이 있는 변형만 한 줄씩 싣는다', () => {
    const got = buildBoqSummary(data([sheetItem([
      variantWith('A', [zone(20)]),
      variantWith('B', []),            // 비어 있음 → 빠진다
      variantWith('C', [zone(10)]),
    ])]))
    expect(got.rows.map(r => r.spec)).toEqual(['A', 'C'])
    expect(got.rows[0].category).toBe('벽체 마감')
    expect(got.rows[0].item).toBe('석고보드')
  })

  it('바닥 + 벽 면적을 합쳐 싣고, 합계도 그 합이다', () => {
    // 벽 면적 = 길이 5m × 높이 2.4m = 12
    const got = buildBoqSummary(data([sheetItem([variantWith('A', [zone(20, 5, 2.4)])])]))
    expect(got.rows[0].areaM2).toBeCloseTo(32, 2)
    expect(got.totalAreaM2).toBeCloseTo(32, 2)
  })

  it('바닥 전용 자재는 벽 면적을 더하지 않는다', () => {
    const floorOnly: FinishingItem = {
      ...sheetItem([variantWith('강마루', [zone(20, 5, 2.4)])]),
      id: 'floor', label: '마루', floorOnly: true,
    }
    const got = buildBoqSummary(data([floorOnly]))
    expect(got.rows[0].areaM2).toBeCloseTo(20, 2)
  })

  it('도장은 통 수가 아니라 리터로 적는다', () => {
    // 통 크기는 화면에서 고르는 값이라 저장돼 있지 않다 — 통 수를 적으면
    // 무슨 통인지 알 수 없는 숫자가 된다.
    const paint: FinishingItem = {
      id: 'paint', label: '도장', calcType: 'paint',
      coverageM2PerL: 10, lossRate: 0, unit: 'L', containerSizes: [1, 4, 18],
      variants: [variantWith('A', [zone(50)])],
    }
    const got = buildBoqSummary(data([paint]))
    expect(got.rows[0].unit).toBe('L')
    expect(got.rows[0].qty).toBeGreaterThan(0)
  })

  it('길이로 세는 자재는 둘레 길이를 수량으로 쓴다', () => {
    const molding: FinishingItem = {
      id: 'molding', label: '걸레받이', calcType: 'length',
      lossRate: 0, unit: 'm',
      variants: [variantWith('A', [zone(0, 12.5, 2.4)])],
    }
    const got = buildBoqSummary(data([molding]))
    expect(got.rows).toHaveLength(1)   // 바닥 면적 0 이어도 실린다
    expect(got.rows[0].qty).toBeCloseTo(12.5, 2)
    expect(got.rows[0].unit).toBe('m')
  })

  it('규격 설명이 있으면 변형 이름 뒤에 괄호로 붙인다', () => {
    const item = sheetItem([{ ...variantWith('강마루', [zone(10)]), specLabel: '94 x 800' }])
    const got = buildBoqSummary(data([item]))
    expect(got.rows[0].spec).toBe('강마루 (94 x 800)')
  })

  it('카테고리 → 자재 → 변형 차례를 그대로 둔다', () => {
    // 패널에서 보던 순서와 같아야 도면과 화면을 번갈아 봐도 안 헷갈린다.
    const a = { ...sheetItem([variantWith('a1', [zone(1)]), variantWith('a2', [zone(2)])]), id: 'a', label: 'A자재' }
    const b = { ...sheetItem([variantWith('b1', [zone(3)])]), id: 'b', label: 'B자재' }
    const got = buildBoqSummary(data([a, b]))
    expect(got.rows.map(r => `${r.item}/${r.spec}`)).toEqual(['A자재/a1', 'A자재/a2', 'B자재/b1'])
  })
})
