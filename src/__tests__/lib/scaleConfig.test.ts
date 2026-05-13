import { describe, it, expect } from 'vitest'
import {
  formatLength, DEFAULT_SCALE, SCALE_PRESETS,
  type ScaleConfig,
} from '../../lib/scaleConfig'

describe('formatLength', () => {
  const mmScale: ScaleConfig = { unit: 'mm', pxPerMm: 1 }
  const cmScale: ScaleConfig = { unit: 'cm', pxPerMm: 0.1 }
  const mScale: ScaleConfig  = { unit: 'm',  pxPerMm: 0.01 }

  it('formats mm at 1:1 scale', () => {
    expect(formatLength(100, mmScale)).toBe('100mm')
  })

  it('rounds mm to nearest integer', () => {
    expect(formatLength(100.6, mmScale)).toBe('101mm')
    expect(formatLength(100.4, mmScale)).toBe('100mm')
  })

  it('formats cm with 1 decimal place', () => {
    // 1px = 1cm at pxPerMm=0.1 → 100px = 100cm
    expect(formatLength(100, cmScale)).toBe('100.0cm')
  })

  it('formats cm fractional value', () => {
    // 15px at pxPerMm=0.1 → 15/0.1 = 150mm = 15.0cm
    expect(formatLength(15, cmScale)).toBe('15.0cm')
  })

  it('formats m with 2 decimal places', () => {
    // 1000px at pxPerMm=0.01 → 1000/0.01 = 100000mm = 100m
    expect(formatLength(1000, mScale)).toBe('100.00m')
  })

  it('formats sub-meter length in m', () => {
    // 10px at pxPerMm=0.01 → 10/0.01 = 1000mm = 1m
    expect(formatLength(10, mScale)).toBe('1.00m')
  })

  it('handles 0 length', () => {
    expect(formatLength(0, mmScale)).toBe('0mm')
    expect(formatLength(0, cmScale)).toBe('0.0cm')
    expect(formatLength(0, mScale)).toBe('0.00m')
  })

  it('handles 1:50 preset (pxPerMm=0.02)', () => {
    const scale: ScaleConfig = { unit: 'mm', pxPerMm: 0.02 }
    // 100px → 100/0.02 = 5000mm
    expect(formatLength(100, scale)).toBe('5000mm')
  })

  it('converts correctly at 1:100 preset', () => {
    const scale: ScaleConfig = { unit: 'm', pxPerMm: 0.01 }
    // 200px → 200/0.01 = 20000mm = 20m
    expect(formatLength(200, scale)).toBe('20.00m')
  })
})

describe('DEFAULT_SCALE', () => {
  it('is 1:1 mm scale', () => {
    expect(DEFAULT_SCALE).toEqual({ unit: 'mm', pxPerMm: 1 })
  })
})

describe('SCALE_PRESETS', () => {
  it('has 5 presets', () => {
    expect(SCALE_PRESETS).toHaveLength(5)
  })

  it('each preset has label and pxPerMm', () => {
    for (const p of SCALE_PRESETS) {
      expect(typeof p.label).toBe('string')
      expect(typeof p.pxPerMm).toBe('number')
      expect(p.pxPerMm).toBeGreaterThan(0)
    }
  })

  it('presets are in descending pxPerMm order (largest scale first)', () => {
    for (let i = 0; i < SCALE_PRESETS.length - 1; i++) {
      expect(SCALE_PRESETS[i].pxPerMm).toBeGreaterThan(SCALE_PRESETS[i + 1].pxPerMm)
    }
  })
})
