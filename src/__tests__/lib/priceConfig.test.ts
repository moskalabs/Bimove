import { describe, it, expect } from 'vitest'
import {
  loadPriceConfig, savePriceConfig, resetPriceConfig,
  computeQuote, fmtKRW,
} from '../../lib/priceConfig'

describe('loadPriceConfig', () => {
  it('returns defaults when nothing saved', () => {
    const config = loadPriceConfig()
    expect(config.wallPerM).toBe(50000)
    expect(config.doorPerEa).toBe(300000)
    expect(config.windowPerEa).toBe(200000)
    expect(config.floorPerM2).toBe(80000)
    expect(config.ceilingPerM2).toBe(60000)
    expect(config.blocks.desk).toBe(200000)
  })

  it('merges partial saved with defaults', () => {
    localStorage.setItem('bimova_price_config_v1', JSON.stringify({ wallPerM: 99999 }))
    const config = loadPriceConfig()
    expect(config.wallPerM).toBe(99999) // overridden
    expect(config.doorPerEa).toBe(300000) // default
    expect(config.blocks.desk).toBe(200000) // default block
  })

  it('merges block overrides with defaults', () => {
    localStorage.setItem('bimova_price_config_v1', JSON.stringify({
      blocks: { desk: 999999, custom_item: 50000 },
    }))
    const config = loadPriceConfig()
    expect(config.blocks.desk).toBe(999999)
    expect(config.blocks.custom_item).toBe(50000)
    expect(config.blocks.chair).toBe(100000) // default preserved
  })

  it('handles corrupted localStorage', () => {
    localStorage.setItem('bimova_price_config_v1', 'NOT_JSON')
    const config = loadPriceConfig()
    expect(config.wallPerM).toBe(50000) // defaults
  })
})

describe('savePriceConfig', () => {
  it('persists to localStorage', () => {
    const config = loadPriceConfig()
    config.wallPerM = 12345
    savePriceConfig(config)
    const loaded = loadPriceConfig()
    expect(loaded.wallPerM).toBe(12345)
  })
})

describe('resetPriceConfig', () => {
  it('clears custom and returns defaults', () => {
    savePriceConfig({ ...loadPriceConfig(), wallPerM: 99999 })
    const result = resetPriceConfig()
    expect(result.wallPerM).toBe(50000)
    expect(loadPriceConfig().wallPerM).toBe(50000) // localStorage cleared
  })
})

describe('computeQuote', () => {
  const config = loadPriceConfig()

  it('computes wall cost', () => {
    const { lines, total } = computeQuote({
      wallTotalLenMm: 10000, // 10m
      doorCount: 0, windowCount: 0, rooms: [], blockCounts: [],
    }, config)
    const wallLine = lines.find(l => l.name === '벽체')!
    expect(wallLine.qty).toBeCloseTo(10)
    expect(wallLine.amount).toBe(10 * config.wallPerM) // 500,000
    expect(total).toBe(wallLine.amount)
  })

  it('computes door + window cost', () => {
    const { lines } = computeQuote({
      wallTotalLenMm: 0, doorCount: 2, windowCount: 3,
      rooms: [], blockCounts: [],
    }, config)
    const doorLine = lines.find(l => l.name === '문')!
    const windowLine = lines.find(l => l.name === '창문')!
    expect(doorLine.amount).toBe(2 * config.doorPerEa)
    expect(windowLine.amount).toBe(3 * config.windowPerEa)
  })

  it('computes floor + ceiling cost from rooms', () => {
    const { lines } = computeQuote({
      wallTotalLenMm: 0, doorCount: 0, windowCount: 0,
      rooms: [{ area: 20, unit: 'm²' }, { area: 10, unit: 'm²' }],
      blockCounts: [],
    }, config)
    const floor = lines.find(l => l.name === '바닥 마감')!
    const ceiling = lines.find(l => l.name === '천장 마감')!
    expect(floor.qty).toBeCloseTo(30)
    expect(floor.amount).toBe(30 * config.floorPerM2)
    expect(ceiling.amount).toBe(30 * config.ceilingPerM2)
  })

  it('computes block costs', () => {
    const { lines } = computeQuote({
      wallTotalLenMm: 0, doorCount: 0, windowCount: 0,
      rooms: [], blockCounts: [{ name: '책상', count: 3, blockId: 'desk' }],
    }, config)
    const deskLine = lines.find(l => l.name === '책상')!
    expect(deskLine.amount).toBe(3 * config.blocks.desk)
  })

  it('uses material-specific wall prices when provided', () => {
    const { lines } = computeQuote({
      wallTotalLenMm: 0, doorCount: 0, windowCount: 0,
      rooms: [], blockCounts: [],
      wallsByMaterial: [
        { materialId: 'brick', materialLabel: '벽돌', lenMm: 5000, pricePerM: 80000 },
        { materialId: 'glass', materialLabel: '유리', lenMm: 3000, pricePerM: 120000 },
      ],
    }, config)
    expect(lines.length).toBe(2)
    expect(lines[0].amount).toBe(5 * 80000) // 5m * 80k
    expect(lines[1].amount).toBe(3 * 120000) // 3m * 120k
  })

  it('returns 0 total for empty BOQ', () => {
    const { lines, total } = computeQuote({
      wallTotalLenMm: 0, doorCount: 0, windowCount: 0,
      rooms: [], blockCounts: [],
    }, config)
    expect(lines.length).toBe(0)
    expect(total).toBe(0)
  })

  it('computes correct total across all categories', () => {
    const { total } = computeQuote({
      wallTotalLenMm: 5000, // 5m
      doorCount: 1,
      windowCount: 1,
      rooms: [{ area: 15, unit: 'm²' }],
      blockCounts: [{ name: '의자', count: 4, blockId: 'chair' }],
    }, config)
    const expected =
      5 * config.wallPerM +
      1 * config.doorPerEa +
      1 * config.windowPerEa +
      15 * config.floorPerM2 +
      15 * config.ceilingPerM2 +
      4 * config.blocks.chair
    expect(total).toBe(expected)
  })
})

describe('fmtKRW', () => {
  it('formats zero', () => expect(fmtKRW(0)).toBe('₩0'))
  it('formats positive', () => expect(fmtKRW(300000)).toContain('300,000'))
})
