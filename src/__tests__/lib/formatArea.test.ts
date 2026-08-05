import { describe, it, expect } from 'vitest'
import { formatArea } from '../../lib/formatArea'

describe('formatArea', () => {
  it('formats in mm² when unit is "mm"', () => {
    expect(formatArea(123456, 'mm')).toBe('123,456 mm²')
  })

  it('rounds mm² values', () => {
    expect(formatArea(123456.789, 'mm')).toBe('123,457 mm²')
  })

  it('formats in cm² when unit is "cm"', () => {
    expect(formatArea(15000, 'cm')).toBe('150.0 cm²')
  })

  it('cm² uses 1 decimal place', () => {
    expect(formatArea(12345, 'cm')).toBe('123.5 cm²')
  })

  it('formats in m² by default (any other unit)', () => {
    expect(formatArea(5_000_000, 'm')).toBe('5.00 m²')
  })

  it('m² uses 2 decimal places', () => {
    expect(formatArea(1_234_567, 'm')).toBe('1.23 m²')
  })

  it('handles zero', () => {
    expect(formatArea(0, 'mm')).toBe('0 mm²')
    expect(formatArea(0, 'cm')).toBe('0.0 cm²')
    expect(formatArea(0, 'm')).toBe('0.00 m²')
  })

  it('treats unknown unit as m²', () => {
    expect(formatArea(1_000_000, 'ft')).toBe('1.00 m²')
    expect(formatArea(1_000_000, '')).toBe('1.00 m²')
  })
})
