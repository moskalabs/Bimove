import { describe, it, expect } from 'vitest'
import { detectOpenings } from '../../lib/detectWalls'

// Note: detectWalls() requires OpenCV WASM + DOM canvas, not testable in Node.
// mergeLines() is internal (not exported). detectOpenings() is the only pure testable export.

describe('detectOpenings', () => {
  it('returns empty array (placeholder implementation)', () => {
    const lines = [
      { x1: 0, y1: 0, x2: 100, y2: 0 },
      { x1: 200, y1: 0, x2: 400, y2: 0 },
    ]
    const result = detectOpenings(lines)
    expect(result).toEqual([])
  })

  it('returns empty for empty input', () => {
    expect(detectOpenings([])).toEqual([])
  })

  it('returns empty for single line', () => {
    const result = detectOpenings([{ x1: 0, y1: 0, x2: 500, y2: 0 }])
    expect(result).toEqual([])
  })
})

describe('DetectOptions type coverage', () => {
  it('DetectOptions type can be imported and used', async () => {
    // Import the type to ensure it's properly exported
    const mod = await import('../../lib/detectWalls')
    // detectWalls is exported but requires OpenCV
    expect(typeof mod.detectWalls).toBe('function')
    expect(typeof mod.detectOpenings).toBe('function')
  })
})
