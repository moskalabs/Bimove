import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  uid, createVariant, unitAreaM2,
  wallAreaM2, sumFloorArea, sumWallArea, sumTotalArea,
  calcSheetQty, calcRollQty,
  paintVolumeL, sumPaintVolume, calcPaintContainers,
  loadFinishingData, saveFinishingData, resetFinishingData,
  type FinishingItem, type MaterialVariant, type ZoneRow, type FinishingTablesData,
 specOf, boxAreaM2From, rollAreaM2From, defaultPiecesPerBox} from '../../lib/finishingData'

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
  it('타일 variants 가 표의 다섯 종류다', () => {
    const data = resetFinishingData()
    const tile = data.categories.flatMap(c => c.items).find(i => i.id === 'f-tile')!
    expect(tile).toBeDefined()
    expect(tile.variants).toHaveLength(5)
    expect(tile.variants.map(v => v.label)).toEqual(
      ['포세린타일', '자기질타일', '도기질타일', '모자이크타일', '기타 타일'])
    // 면적은 적어둔 값이 아니라 가로 × 세로 × 장수에서 나온다
    expect(tile.variants.map(v => unitAreaM2(tile, v)))
      .toEqual([1.44, 1.44, 1.44, 0.99, 1.44])
    expect(tile.variants.map(v => v.piecesPerBox)).toEqual([4, 16, 8, 11, 2])
  })

  it('도배 variants 가 표의 네 종류다', () => {
    const data = resetFinishingData()
    const wp = data.categories.flatMap(c => c.items).find(i => i.id === 'f-wallpaper')!
    expect(wp).toBeDefined()
    expect(wp.variants).toHaveLength(4)
    expect(wp.variants.map(v => v.label)).toEqual(['실크벽지', '합지벽지(광폭)', '수입벽지', '기타 벽지'])
    // 폭 × 길이 그대로다: 1.06×15.6, 0.93×17.75, 0.53×10.05, 1.0×2.4
    expect(wp.variants.map(v => unitAreaM2(wp, v)))
      .toEqual([16.536, 16.5075, 5.3265, 2.4])
  })

  it('마루는 floorOnly', () => {
    const data = resetFinishingData()
    const wood = data.categories.flatMap(c => c.items).find(i => i.id === 'f-wood')!
    expect(wood.label).toBe('마루')
    expect(wood.floorOnly).toBe(true)
    expect(wood.boxAreaM2).toBe(3.23)
  })

  it('도배 국산/수입', () => {
    const data = resetFinishingData()
    const wp = data.categories.flatMap(c => c.items).find(i => i.id === 'f-wallpaper')!
    expect(wp.label).toBe('도배')
  })

  it('석고보드 항목 존재', () => {
    const data = resetFinishingData()
    const g = data.categories.flatMap(c => c.items).find(i => i.id === 'f-gypsum')!
    expect(g).toBeDefined()
    expect(g.label).toBe('석고보드')
    expect(g.calcType).toBe('sheet')
  })

  it('추가 항목 (텍스, 루버, 판넬, 데코타일, 장판, 천정몰딩, 걸레받이, 마감몰딩)', () => {
    const data = resetFinishingData()
    const items = data.categories.flatMap(c => c.items)
    for (const id of ['f-tex', 'f-louver', 'f-panel', 'f-decotile', 'f-jangpan', 'f-ceil-mold', 'f-baseboard', 'f-finish-mold']) {
      expect(items.find(i => i.id === id)).toBeDefined()
    }
  })

  it('필름 항목 존재', () => {
    const data = resetFinishingData()
    const film = data.categories.flatMap(c => c.items).find(i => i.id === 'f-film')!
    expect(film).toBeDefined()
    expect(film.label).toBe('필름')
    expect(film.calcType).toBe('roll')
  })

  it('도장 기본 도포율은 수성 페인트 10 m²/L', () => {
    const data = resetFinishingData()
    const paint = data.categories.flatMap(c => c.items).find(i => i.id === 'f-paint')!
    expect(paint.coverageM2PerL).toBe(10)
    expect(paint.containerSizes).toEqual([1, 4, 18])
    // 종류마다 도포율이 다르다 (에폭시·외부수성 8, 에나멜·우레탄 12)
    expect(paint.variants.map(v => v.coverageM2PerL)).toEqual([10, 8, 10, 12, 8, 12, 10])
    expect(paint.variants[0].label).toBe('내부 수성페인트')
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
    expect(tile.specLabel).toBe('포세린타일 600 × 600 기준 1.44 m²/box (4장/box)')
    // zone 데이터가 비어있었으므로 variants도 새 defaults로 교체
    expect(tile.variants).toHaveLength(5)
    expect(tile.variants.map(v => v.label)).toEqual(
      ['포세린타일', '자기질타일', '도기질타일', '모자이크타일', '기타 타일'])
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
        // 도장, 도배, 마루, 필름이 없음
      }],
      // lighting, furniture, appliance 카테고리 없음
      updatedAt: Date.now(),
      schemaVersion: 1,
    }
    store.set('bimova_finishing_tables_v1_proj-5', JSON.stringify(oldData))

    const loaded = loadFinishingData('proj-5')
    const finishing = loaded.categories.find(c => c.key === 'finishing')!

    // 빠진 아이템들 추가됨
    expect(finishing.items.find(i => i.id === 'f-paint')).toBeDefined()
    expect(finishing.items.find(i => i.id === 'f-wallpaper')).toBeDefined()
    expect(finishing.items.find(i => i.id === 'f-wood')).toBeDefined()
    expect(finishing.items.find(i => i.id === 'f-film')).toBeDefined()

    // 빠진 카테고리들 추가됨
    expect(loaded.categories.find(c => c.key === 'lighting')).toBeDefined()
    expect(loaded.categories.find(c => c.key === 'furniture')).toBeDefined()
    expect(loaded.categories.find(c => c.key === 'appliance')).toBeDefined()
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

// ───────── 변형별 규격 ─────────
//
// 예전엔 규격이 자재(FinishingItem) 하나에만 있어서, 같은 "타일" 안의 종류가
// 전부 같은 박스 면적을 썼다. 포세린 600각은 4장/box(1.44 m²)인데 모자이크는
// 11장/box(1.03 m²)다 — 같은 면적을 시공해도 발주 수량이 달라야 한다.

describe('변형별 규격', () => {
  const zonesOf = (floorM2: number) => [{
    id: 'z1', label: '거실', floorAreaM2: floorM2, wallLengthM: 0, wallHeightM: 2.4,
  }]

  it('같은 면적이라도 변형의 박스 면적에 따라 수량이 갈린다', () => {
    const data = resetFinishingData()
    const tile = data.categories.flatMap(c => c.items).find(i => i.id === 'f-tile')!
    const porcelain = { ...tile.variants[0], zones: zonesOf(100) }   // 1.44 m²/box
    const mosaic = { ...tile.variants[3], zones: zonesOf(100) }      // 0.99 m²/box

    // 100 m² × 로스 10% = 110 m²
    expect(calcSheetQty(tile, porcelain)).toBe(Math.ceil(110 / 1.44))   // 77
    expect(calcSheetQty(tile, mosaic)).toBe(Math.ceil(110 / 0.99))      // 112
    expect(calcSheetQty(tile, mosaic)).toBeGreaterThan(calcSheetQty(tile, porcelain))
  })

  it('도배도 롤 면적이 변형마다 다르게 먹힌다', () => {
    const data = resetFinishingData()
    const wp = data.categories.flatMap(c => c.items).find(i => i.id === 'f-wallpaper')!
    const silk = { ...wp.variants[0], zones: zonesOf(100) }      // 16.536 m²/롤
    const imported = { ...wp.variants[2], zones: zonesOf(100) }  // 5.3265 m²/롤

    expect(calcRollQty(wp, silk)).toBe(Math.ceil(110 / 16.536))        // 7
    expect(calcRollQty(wp, imported)).toBe(Math.ceil(110 / 5.3265))    // 21
  })

  it('도장은 변형 도포율로 용량이 계산된다', () => {
    const data = resetFinishingData()
    const paint = data.categories.flatMap(c => c.items).find(i => i.id === 'f-paint')!
    const zones = [{ id: 'z1', label: '', floorAreaM2: 0, wallLengthM: 10, wallHeightM: 2.4, coatCount: 2 }]
    const enamel = { ...paint.variants[3], zones }    // 12 m²/L
    const epoxy = { ...paint.variants[4], zones }     // 8 m²/L

    // 벽면 24 m² × 2회 = 48 m²
    expect(sumPaintVolume(enamel, specOf(paint, enamel).coverageM2PerL!)).toBeCloseTo(4, 2)
    expect(sumPaintVolume(epoxy, specOf(paint, epoxy).coverageM2PerL!)).toBeCloseTo(6, 2)
  })

  it('변형에 규격이 없으면 자재 값으로 떨어진다 (옛 데이터 호환)', () => {
    const data = resetFinishingData()
    const tile = data.categories.flatMap(c => c.items).find(i => i.id === 'f-tile')!
    // schemaVersion 5 이전에 저장된 변형에는 boxAreaM2 가 아예 없다
    const legacy = { id: 'v-old', label: '타일 A', zones: zonesOf(100) }

    expect(specOf(tile, legacy).piecesPerBox).toBe(tile.piecesPerBox)
    expect(calcSheetQty(tile, legacy)).toBe(Math.ceil(110 / 1.44))
  })

  it('변형 로스율도 오버라이드된다', () => {
    const data = resetFinishingData()
    const tile = data.categories.flatMap(c => c.items).find(i => i.id === 'f-tile')!
    const strict = { ...tile.variants[0], lossRate: 0, zones: zonesOf(100) }

    expect(specOf(tile, strict).lossRate).toBe(0)
    expect(calcSheetQty(tile, strict)).toBe(Math.ceil(100 / 1.44))   // 로스 없음
  })

  it('마루는 바닥 전용이라 벽면을 더하지 않는다', () => {
    const data = resetFinishingData()
    const wood = data.categories.flatMap(c => c.items).find(i => i.id === 'f-wood')!
    const zones = [{ id: 'z1', label: '', floorAreaM2: 50, wallLengthM: 20, wallHeightM: 2.4 }]
    const solid = { ...wood.variants[3], zones }   // 원목마루 2.16 m²/box

    // 벽면 48 m² 는 무시하고 바닥 50 m² 만: 55 ÷ 2.16
    expect(calcSheetQty(wood, solid)).toBe(Math.ceil(55 / 2.16))
  })
})

// ───────── 규격 → 면적 자동 계산 ─────────
//
// 면적은 적어두는 값이 아니라 규격에서 나오는 값이다. 사람이 직접 적게 두면
// 규격과 어긋난 면적이 남고, 그 어긋남은 발주 수량에서야 드러난다.

describe('boxAreaM2From', () => {
  it('가로 × 세로 ÷ 1,000,000 × 장수', () => {
    expect(boxAreaM2From(300, 600, 8)).toBe(1.44)
    expect(boxAreaM2From(600, 600, 4)).toBe(1.44)
    expect(boxAreaM2From(300, 300, 16)).toBe(1.44)
    expect(boxAreaM2From(600, 1200, 2)).toBe(1.44)
    expect(boxAreaM2From(1200, 2400, 1)).toBe(2.88)
  })

  it('모자이크 300각 11장은 0.99 다 (1.03 이 아니다)', () => {
    expect(boxAreaM2From(300, 300, 11)).toBe(0.99)
  })

  it('값이 비면 0 — 0으로 나누는 자리로 흘러가지 않게', () => {
    expect(boxAreaM2From(0, 600, 8)).toBe(0)
    expect(boxAreaM2From(600, 600, 0)).toBe(0)
  })
})

describe('rollAreaM2From', () => {
  it('폭(mm) ÷ 1,000 × 길이(m)', () => {
    expect(rollAreaM2From(1060, 15.6)).toBe(16.536)
    expect(rollAreaM2From(930, 17.75)).toBe(16.5075)
    expect(rollAreaM2From(530, 10.05)).toBe(5.3265)
  })

  it('부동소수 찌꺼기를 달고 다니지 않는다', () => {
    // 0.53 * 10.05 는 그냥 곱하면 5.326500000000001 이 된다
    expect(rollAreaM2From(530, 10.05).toString()).toBe('5.3265')
  })
})

describe('defaultPiecesPerBox', () => {
  it('등록된 규격의 장수를 돌려준다', () => {
    expect(defaultPiecesPerBox(300, 300)).toBe(16)
    expect(defaultPiecesPerBox(300, 600)).toBe(8)
    expect(defaultPiecesPerBox(600, 600)).toBe(4)
    expect(defaultPiecesPerBox(600, 1200)).toBe(2)
    expect(defaultPiecesPerBox(1200, 2400)).toBe(1)
  })

  it('가로·세로를 바꿔 넣어도 같은 타일이다', () => {
    expect(defaultPiecesPerBox(600, 300)).toBe(8)
    expect(defaultPiecesPerBox(1200, 600)).toBe(2)
  })

  it('등록 안 된 규격은 추정하지 않고 null — 사용자가 직접 넣어야 한다', () => {
    // 포장 수량은 제조사가 정한다. 450각을 600각 옆이라고 4장으로 넘겨짚으면
    // 발주 수량이 조용히 틀어진다.
    expect(defaultPiecesPerBox(450, 450)).toBeNull()
    expect(defaultPiecesPerBox(200, 1000)).toBeNull()
    expect(defaultPiecesPerBox(0, 600)).toBeNull()
  })
})

describe('unitAreaM2 우선순위', () => {
  const tileItem = {
    id: 'x', label: '타일', calcType: 'sheet' as const,
    lossRate: 0.1, unit: 'box', variants: [],
  }

  it('규격이 있으면 저장된 면적을 무시하고 다시 계산한다', () => {
    // 규격만 고치고 면적 갱신을 빠뜨린 데이터가 들어와도 수량이 맞아야 한다
    const stale = {
      id: 'v', label: '타일', zones: [],
      itemWidthMm: 300, itemLengthMm: 600, piecesPerBox: 8,
      boxAreaM2: 999,
    }
    expect(unitAreaM2(tileItem, stale)).toBe(1.44)
  })

  it('장수를 모르면 저장된 면적으로 떨어진다 (마루)', () => {
    const wood = { id: 'v', label: '강마루', zones: [], boxAreaM2: 3.23 }
    expect(unitAreaM2(tileItem, wood)).toBe(3.23)
  })

  it('롤 규격도 같은 방식이다', () => {
    const rollItem = { ...tileItem, calcType: 'roll' as const, unit: '롤' }
    const silk = { id: 'v', label: '실크', zones: [], rollWidthMm: 1060, rollLengthM: 15.6, rollAreaM2: 1 }
    expect(unitAreaM2(rollItem, silk)).toBe(16.536)
  })
})

// ───────── 낱장으로 사는 자재 (석고보드) ─────────

describe('석고보드', () => {
  const gypsum = () => resetFinishingData().categories
    .flatMap(c => c.items).find(i => i.id === 'f-gypsum')!

  it('다섯 종류가 들어 있다', () => {
    expect(gypsum().variants.map(v => v.label)).toEqual(
      ['일반 석고보드', '방수 석고보드', '방화 석고보드', '차음 석고보드', '유공 석고보드'])
  })

  it('두께로 종류가 갈린다 — 면적이 같아도 다른 물건이다', () => {
    expect(gypsum().variants.map(v => v.thicknessMm)).toEqual([9.5, 9.5, 12.5, 12.5, 12.5])
  })

  it('장수가 1이라 1장당 면적은 가로 × 세로다', () => {
    const g = gypsum()
    expect(g.variants.every(v => v.piecesPerBox === 1)).toBe(true)
    expect(g.variants.map(v => unitAreaM2(g, v))).toEqual([1.62, 1.62, 1.62, 1.62, 1.62])
  })

  it('두께를 바꿔도 면적은 그대로다 (계산에 안 쓴다)', () => {
    const g = gypsum()
    const thick = { ...g.variants[0], thicknessMm: 25 }
    expect(unitAreaM2(g, thick)).toBe(1.62)
  })
})

// ───────── 마루 ─────────

describe('마루', () => {
  const wood = () => resetFinishingData().categories
    .flatMap(c => c.items).find(i => i.id === 'f-wood')!

  it('표의 네 종류가 규격·두께와 함께 들어 있다', () => {
    const w = wood()
    expect(w.variants.map(v => [v.itemWidthMm, v.itemLengthMm, v.thicknessMm])).toEqual([
      [94, 800, 7.5],      // 강마루
      [165, 1200, 7.5],    // 광폭 강마루
      [190, 1200, 8],      // 강화마루
      [150, 1200, 12],     // 원목마루
    ])
  })

  it('BOX당 장수를 지어내지 않는다 — 면적은 표 값 그대로다', () => {
    // 3.17 ÷ (0.165 × 1.2) = 16.01장. 역산해서 16을 박아넣으면 3.168 이 되어
    // 표와 어긋난다. 표에 장수가 없으므로 비워두고 면적을 그대로 쓴다.
    const w = wood()
    expect(w.variants.every(v => v.piecesPerBox === undefined)).toBe(true)
    expect(w.variants.map(v => unitAreaM2(w, v))).toEqual([3.23, 3.17, 1.82, 2.16])
  })

  it('사용자가 장수를 넣으면 그때부터 규격에서 계산한다', () => {
    const w = wood()
    const withPieces = { ...w.variants[3], piecesPerBox: 12 }   // 원목 150 × 1200
    expect(unitAreaM2(w, withPieces)).toBe(2.16)
  })
})
