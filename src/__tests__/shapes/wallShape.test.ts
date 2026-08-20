import { describe, it, expect } from 'vitest'
import { isNearWhite, miterExtension } from '../../shapes/WallShape'

// getCorners requires tldraw Vec constructor — tested via miterExtension (pure math)

describe('isNearWhite', () => {
  it('detects pure white', () => {
    expect(isNearWhite('#ffffff')).toBe(true)
    expect(isNearWhite('#FFFFFF')).toBe(true)
  })

  it('detects near-white (high luminance)', () => {
    expect(isNearWhite('#f0f0f0')).toBe(true)
    expect(isNearWhite('#eeeeee')).toBe(true)
  })

  it('rejects dark colors', () => {
    expect(isNearWhite('#000000')).toBe(false)
    expect(isNearWhite('#333333')).toBe(false)
    expect(isNearWhite('#555555')).toBe(false)
  })

  it('rejects mid-range colors', () => {
    expect(isNearWhite('#888888')).toBe(false)
    expect(isNearWhite('#1a73e8')).toBe(false) // blue
    expect(isNearWhite('#ea4335')).toBe(false) // red
  })

  it('rejects saturated light colors', () => {
    expect(isNearWhite('#ff0000')).toBe(false) // pure red
    expect(isNearWhite('#00ff00')).toBe(false) // pure green
  })

  it('handles without hash prefix', () => {
    expect(isNearWhite('ffffff')).toBe(true)
    expect(isNearWhite('000000')).toBe(false)
  })

  it('returns false for invalid hex', () => {
    expect(isNearWhite('xyz')).toBe(false)
    expect(isNearWhite('')).toBe(false)
    expect(isNearWhite('#gg0000')).toBe(false)
  })
})

describe('miterExtension', () => {
  it('returns 0 for parallel walls (same direction)', () => {
    // two walls in the same direction: sin(angle) ≈ 0
    expect(miterExtension(1, 0, 1, 0, 10)).toBe(0)
  })

  it('returns 0 for nearly parallel walls', () => {
    // small angle < 0.05 radians (~2.9°)
    const ext = miterExtension(1, 0, 0.999, 0.01, 10)
    expect(ext).toBe(0)
  })

  it('computes extension for 90° corner', () => {
    // wall-1 going right (1,0), wall-2 going up (0,1), half-thickness=10
    // At 90°: tan(45°) = 1, so extension = h2 / tan(45°) = 10
    const ext = miterExtension(1, 0, 0, 1, 10)
    expect(ext).toBeCloseTo(10, 1)
  })

  it('computes extension for 90° corner (opposite direction)', () => {
    // wall-1 going right (1,0), wall-2 going down (0,-1)
    const ext = miterExtension(1, 0, 0, -1, 10)
    expect(ext).toBeCloseTo(10, 1)
  })

  it('extension increases for acute angles', () => {
    // 45° angle: larger extension needed
    const ext45 = miterExtension(1, 0, Math.cos(Math.PI / 4), Math.sin(Math.PI / 4), 10)
    // 90° angle
    const ext90 = miterExtension(1, 0, 0, 1, 10)
    // 135° angle: smaller extension
    const ext135 = miterExtension(1, 0, Math.cos(3 * Math.PI / 4), Math.sin(3 * Math.PI / 4), 10)
    expect(ext135).toBeLessThan(ext90)
    expect(ext90).toBeLessThan(ext45)
  })

  it('caps extreme angles (very acute)', () => {
    // Almost antiparallel: huge miter would result, capped at h2*8
    const ext = miterExtension(1, 0, -0.95, 0.3, 10)
    expect(ext).toBeLessThanOrEqual(80) // h2 * 8
  })

  it('scales with half-thickness', () => {
    const ext5 = miterExtension(1, 0, 0, 1, 5)
    const ext20 = miterExtension(1, 0, 0, 1, 20)
    expect(ext20 / ext5).toBeCloseTo(4, 1) // linear scaling
  })
})
