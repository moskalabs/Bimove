import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  uid, createVariant, unitAreaM2,
  wallAreaM2, sumFloorArea, sumWallArea, sumTotalArea,
  calcSheetQty, calcRollQty,
  paintVolumeL, sumPaintVolume, calcPaintContainers,
  loadFinishingData, saveFinishingData, resetFinishingData,
  type FinishingItem, type MaterialVariant, type ZoneRow, type FinishingTablesData,
} from '../../lib/finishingData'

// ── mock scopedStorage ──
const store = new Map<string, string>()
vi.mock('../../lib/scopedStorage', () => ({
  scopedGet: (key: string) => store.get(key) ?? null,
  scopedSet: (key: string, val: string) => { store.set(key, val) },
}))

// ── 헬퍼 ──
function zone(label: string, floor: number, wallLen = 0, wallH = 2.4, coats?: number): ZoneRow {
  return { id: uid(), label, floorAreaM2: floor, wallLengthM: wallLen, wallHeightM: wallH, coatCount: coats }
}

function variant(label: string, zones: ZoneRow[]): MaterialVariant {
  return { id: uid(), label, zones }
}

function makeItem(overrides: Partial<FinishingItem> = {}): FinishingItem {
  return {
    id: 'test-item',
    label: '테스트',
    calcType: 'sheet',
    lossRate: 0.10,
    unit: '장',
    variants: [createVariant('기본')],
    ...overrides,
  }
}

// ── 계산 함수 테스트 ──

describe('wallAreaM2', () => {
  it('벽 길이 × 높이 = 벽면적', () => {
    const z = zone('거실', 0, 10, 2.4)
    expect(wallAreaM2(z)).toBe(24)
  })

  it('벽 길이 0이면 0', () => {
    expect(wallAreaM2(zone('', 20, 0, 2.4))).toBe(0)
  })
})

describe('sumFloorArea / sumWallArea / sumTotalArea', () => {
  const v = variant('A', [
    zone('거실', 25, 12, 2.4),
    zone('안방', 15, 10, 2.4),
  ])

  it('sumFloorArea = 25 + 15 = 40', () => {
    expect(sumFloorArea(v)).toBe(40)
  })

  it('sumWallArea = 12*2.4 + 10*2.4 = 52.8', () => {
    expect(sumWallArea(v)).toBeCloseTo(52.8, 2)
  })

  it('sumTotalArea = floor + wall', () => {
    expect(sumTotalArea(v)).toBeCloseTo(92.8, 2)
  })
})

describe('unitAreaM2', () => {
  it('boxAreaM2 우선', () => {
    const item = makeItem({ boxAreaM2: 3.23, itemWidthMm: 900, itemLengthMm: 1800 })
    expect(unitAreaM2(item)).toBe(3.23)
  })

  it('rollAreaM2 차순위', () => {
    const item = makeItem({ rollAreaM2: 16 })
    expect(unitAreaM2(item)).toBe(16)
  })

  it('itemWidth × Length fallback', () => {
    const item = makeItem({ itemWidthMm: 900, itemLengthMm: 1800 })
    expect(unitAreaM2(item)).toBeCloseTo(1.62, 2)
  })

  it('아무것도 없으면 0', () => {
    expect(unitAreaM2(makeItem())).toBe(0)
  })
})

describe('calcSheetQty', () => {
  it('마루: 41.4m² + 10% 로스 / 3.23 m²/box = 15', () => {
    const item = makeItem({ boxAreaM2: 3.23, lossRate: 0.10, floorOnly: true })
    const v = variant('마루', [zone('거실', 25.8), zone('안방', 15.6)])
    expect(calcSheetQty(item, v)).toBe(15)
  })

  it('타일: 평면+벽면 합산', () => {
    const item = makeItem({ boxAreaM2: 1.44, lossRate: 0.10 })
    const v = variant('타일A', [
      zone('거실욕실', 12.3, 12.3, 2.3),
      zone('안방욕실', 8.6, 10.1, 2.3),
    ])
    // 평면 = 12.3+8.6 = 20.9, 벽면 = 12.3*2.3+10.1*2.3 = 28.29+23.23 = 51.52
    // 총 72.42, 로스 10% = 79.662, /1.44 = 55.32 → 56
    expect(calcSheetQty(item, v)).toBe(56)
  })

  it('면적 0이면 0', () => {
    expect(calcSheetQty(makeItem({ boxAreaM2: 1 }), variant('x', [zone('', 0)]))).toBe(0)
  })

  it('unitArea 0이면 0', () => {
    expect(calcSheetQty(makeItem(), variant('x', [zone('', 10)]))).toBe(0)
  })
})

describe('calcRollQty', () => {
  it('도배: 16m²/롤 기준', () => {
    const item = makeItem({ rollAreaM2: 16, lossRate: 0.10, calcType: 'roll' })
    const v = variant('국산', [zone('거실', 30, 15, 2.4)])
    // floor=30, wall=36, total=66, 로스10% = 72.6, /16 = 4.5375 → 5
    expect(calcRollQty(item, v)).toBe(5)
  })
})

describe('paintVolumeL', () => {
  it('면적 × 도포횟수 / 도포율', () => {
    const z = zone('거실', 20, 10, 2.4, 2)
    // floor: 20 * 2 / 8 = 5
    expect(paintVolumeL(z, 8, 'floor')).toBe(5)
    // wall: 24 * 2 / 8 = 6
    expect(paintVolumeL(z, 8, 'wall')).toBe(6)
  })

  it('면적 0이면 0', () => {
    expect(paintVolumeL(zone('', 0, 0), 8, 'floor')).toBe(0)
  })
})

describe('sumPaintVolume', () => {
  it('전체 구역 합산', () => {
    const v = variant('도장A', [
      zone('거실', 20, 10, 2.4, 2),
      zone('안방', 15, 8, 2.4, 2),
    ])
    // 거실: floor 5 + wall 6 = 11
    // 안방: floor 15*2/8=3.75 + wall 19.2*2/8=4.8 = 8.55
    expect(sumPaintVolume(v, 8)).toBeCloseTo(19.55, 2)
  })
})

describe('calcPaintContainers', () => {
  it('올림 계산', () => {
    expect(calcPaintContainers(19.55, 4)).toBe(5)   // 19.55/4 = 4.89 → 5
    expect(calcPaintContainers(19.55, 18)).toBe(2)   // 19.55/18 = 1.09 → 2
    expect(calcPaintContainers(18, 18)).toBe(1)
  })

  it('0이면 0', () => {
    expect(calcPaintContainers(0, 18)).toBe(0)
    expect(calcPaintContainers(10, 0)).toBe(0)
  })
})

// ── defaults 테스트 ──

describe('defaults', () => {
  it('resetFinishingData에 타일 A/B/C variants가 있다', () => {
    const data = resetFinishingData()
    const tile = data.categories.flatMap(c => c.items).find(i => i.id === 'f-tile')!
    expect(tile).toBeDefined()
    expect(tile.variants).toHaveLength(3)
    expect(tile.variants.map(v => v.label)).toEqual(['타일 A', '타일 B', '타일 C'])
  })

  it('도배 국산/수입 variants', () => {
    const data = resetFinishingData()
    const wp = data.categories.flatMap(c => c.items).find(i => i.id === 'f-wallpaper')!
    expect(wp).toBeDefined()
    expect(wp.variants).toHaveLength(2)
    expect(wp.variants.map(v => v.label)).toEqual(['국산', '수입'])
  })

  it('마루는 floorOnly', () => {
    const data = resetFinishingData()
    const wood = data.categories.flatMap(c => c.items).find(i => i.id === 'f-wood')!
    expect(wood.floorOnly).toBe(true)
    expect(wood.boxAreaM2).toBe(3.23)
  })

  it('석고보드 규격 900×1800', () => {
    const data = resetFinishingData()
    const gyp = data.categories.flatMap(c => c.items).find(i => i.id === 'f-gypsum')!
    expect(gyp.itemWidthMm).toBe(900)
    expect(gyp.itemLengthMm).toBe(1800)
    expect(unitAreaM2(gyp)).toBeCloseTo(1.62, 2)
  })

  it('도장 coverageM2PerL = 8', () => {
    const data = resetFinishingData()
    const paint = data.categories.flatMap(c => c.items).find(i => i.id === 'f-paint')!
    expect(paint.coverageM2PerL).toBe(8)
    expect(paint.containerSizes).toEqual([1, 4, 18])
  })
})

// ── localStorage CRUD + 스키마 마이그레이션 ──

describe('loadFinishingData / saveFinishingData', () => {
  beforeEach(() => store.clear())

  it('저장 없으면 defaults 반환', () => {
    const data = loadFinishingData('proj-1')
    expect(data.categories.length).toBeGreaterThan(0)
    expect(data.schemaVersion).toBeGreaterThanOrEqual(2)
  })

  it('save → load 왕복', () => {
    const data = loadFinishingData('proj-2')
    // 타일 A zone에 데이터 입력
    const tile = data.categories[0].items.find(i => i.id === 'f-tile')!
    tile.variants[0].zones[0].label = '욕실'
    tile.variants[0].zones[0].floorAreaM2 = 12
    saveFinishingData('proj-2', data)

    const loaded = loadFinishingData('proj-2')
    const t2 = loaded.categories[0].items.find(i => i.id === 'f-tile')!
    expect(t2.variants[0].zones[0].label).toBe('욕실')
    expect(t2.variants[0].zones[0].floorAreaM2).toBe(12)
  })

  it('schemaVersion 낮으면 mergeDefaults 실행', () => {
    // 구버전 데이터 (타일에 variant 1개만)
    const oldData: FinishingTablesData = {
      categories: [{
        key: 'finishing', label: '마감재', expanded: true,
        items: [{
          id: 'f-tile', label: '타일', calcType: 'sheet',
          boxAreaM2: 1.0, lossRate: 0.05, unit: 'box',
          variants: [{ id: 'old-v', label: '타일 구버전', zones: [{ id: 'z1', label: '', floorAreaM2: 0, wallLengthM: 0, wallHeightM: 2.4 }] }],
        }],
      }],
      updatedAt: Date.now(),
      schemaVersion: 1,
    }
    store.set('bimova_finishing_tables_v1_proj-3', JSON.stringify(oldData))

    const loaded = loadFinishingData('proj-3')
    const tile = loaded.categories[0].items.find(i => i.id === 'f-tile')!

    // 메타 값이 새 defaults로 업데이트됨
    expect(tile.boxAreaM2).toBe(1.44)
    expect(tile.lossRate).toBe(0.10)
    expect(tile.specLabel).toBe('박스당 면적 1.44 m²/box')
    // zone 데이터가 비어있었으므로 variants도 새 defaults로 교체
    expect(tile.variants).toHaveLength(3)
    expect(tile.variants.map(v => v.label)).toEqual(['타일 A', '타일 B', '타일 C'])
  })

  it('사용자 데이터 있으면 variants 유지', () => {
    const oldData: FinishingTablesData = {
      categories: [{
        key: 'finishing', label: '마감재', expanded: true,
        items: [{
          id: 'f-tile', label: '타일', calcType: 'sheet',
          boxAreaM2: 1.0, lossRate: 0.05, unit: 'box',
          variants: [{ id: 'v1', label: '내 타일', zones: [{ id: 'z1', label: '욕실', floorAreaM2: 15, wallLengthM: 10, wallHeightM: 2.3 }] }],
        }],
      }],
      updatedAt: Date.now(),
      schemaVersion: 1,
    }
    store.set('bimova_finishing_tables_v1_proj-4', JSON.stringify(oldData))

    const loaded = loadFinishingData('proj-4')
    const tile = loaded.categories[0].items.find(i => i.id === 'f-tile')!

    // 메타는 업데이트
    expect(tile.boxAreaM2).toBe(1.44)
    // 사용자 데이터 있으므로 variants 유지
    expect(tile.variants).toHaveLength(1)
    expect(tile.variants[0].label).toBe('내 타일')
    expect(tile.variants[0].zones[0].label).toBe('욕실')
    expect(tile.variants[0].zones[0].floorAreaM2).toBe(15)
  })

  it('새 카테고리/아이템이 자동 추가됨', () => {
    const oldData: FinishingTablesData = {
      categories: [{
        key: 'finishing', label: '마감재', expanded: true,
        items: [{
          id: 'f-tile', label: '타일', calcType: 'sheet',
          boxAreaM2: 1, lossRate: 0.05, unit: 'box',
          variants: [createVariant('타일')],
        }],
        // 석고보드, 도장, 도배, 마루가 없음
      }],
      // lighting, furniture, kitchen 카테고리 없음
      updatedAt: Date.now(),
      schemaVersion: 1,
    }
    store.set('bimova_finishing_tables_v1_proj-5', JSON.stringify(oldData))

    const loaded = loadFinishingData('proj-5')
    const finishing = loaded.categories.find(c => c.key === 'finishing')!

    // 빠진 아이템들 추가됨
    expect(finishing.items.find(i => i.id === 'f-gypsum')).toBeDefined()
    expect(finishing.items.find(i => i.id === 'f-paint')).toBeDefined()
    expect(finishing.items.find(i => i.id === 'f-wallpaper')).toBeDefined()
    expect(finishing.items.find(i => i.id === 'f-wood')).toBeDefined()

    // 빠진 카테고리들 추가됨
    expect(loaded.categories.find(c => c.key === 'lighting')).toBeDefined()
    expect(loaded.categories.find(c => c.key === 'furniture')).toBeDefined()
    expect(loaded.categories.find(c => c.key === 'kitchen')).toBeDefined()
  })
})

// ── DXF path 파싱 테스트 (Viewer3D 내부 함수 로직 검증) ──

describe('DXF pathData 파싱 로직', () => {
  // parseDxfPath는 Viewer3D.tsx에서 export 안 되므로 같은 regex 로직으로 검증
  function parseDxfPath(d: string) {
    const segs: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
    const re = /M([\d.eE+-]+),([\d.eE+-]+)L([\d.eE+-]+),([\d.eE+-]+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(d)) !== null) {
      segs.push({ x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] })
    }
    return segs
  }

  it('단일 세그먼트 파싱', () => {
    const segs = parseDxfPath('M0.0,0.0L100.5,200.3')
    expect(segs).toHaveLength(1)
    expect(segs[0]).toEqual({ x1: 0, y1: 0, x2: 100.5, y2: 200.3 })
  })

  it('복수 세그먼트 파싱', () => {
    const segs = parseDxfPath('M0,0L100,0M0,50L100,50M50,0L50,100')
    expect(segs).toHaveLength(3)
    expect(segs[2]).toEqual({ x1: 50, y1: 0, x2: 50, y2: 100 })
  })

  it('빈 문자열 → 빈 배열', () => {
    expect(parseDxfPath('')).toHaveLength(0)
  })

  it('음수 좌표 처리', () => {
    const segs = parseDxfPath('M-10.5,-20.3L30.0,-5.0')
    expect(segs).toHaveLength(1)
    expect(segs[0].x1).toBe(-10.5)
    expect(segs[0].y1).toBe(-20.3)
  })

  it('과학적 표기법 (1e2 등)', () => {
    const segs = parseDxfPath('M1e2,2e1L3e2,4e1')
    expect(segs).toHaveLength(1)
    expect(segs[0]).toEqual({ x1: 100, y1: 20, x2: 300, y2: 40 })
  })
})
