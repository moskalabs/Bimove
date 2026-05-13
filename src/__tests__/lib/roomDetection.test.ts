import { describe, it, expect } from 'vitest'
import { detectRooms } from '../../lib/roomDetection'

// Helpers to build wall data
const wall = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2 })

// A 100×100 square
const square = [
  wall(0,   0,   100, 0),
  wall(100, 0,   100, 100),
  wall(100, 100, 0,   100),
  wall(0,   100, 0,   0),
]

describe('detectRooms', () => {
  it('returns empty for fewer than 3 walls', () => {
    expect(detectRooms([])).toEqual([])
    expect(detectRooms([wall(0,0,100,0)])).toEqual([])
    expect(detectRooms([wall(0,0,100,0), wall(100,0,100,100)])).toEqual([])
  })

  it('returns empty for 3 non-closing walls (open path)', () => {
    // L-shape, no closed face
    const open = [
      wall(0, 0, 100, 0),
      wall(100, 0, 100, 100),
      wall(200, 0, 200, 100), // disconnected
    ]
    expect(detectRooms(open)).toEqual([])
  })

  it('detects a simple square room', () => {
    const rooms = detectRooms(square)
    expect(rooms).toHaveLength(1)
    expect(rooms[0].area).toBeCloseTo(10000, 0)
  })

  it('room has correct centroid for a square', () => {
    const rooms = detectRooms(square)
    expect(rooms[0].centroid.x).toBeCloseTo(50, 0)
    expect(rooms[0].centroid.y).toBeCloseTo(50, 0)
  })

  it('room has 4 vertices for a square', () => {
    const rooms = detectRooms(square)
    expect(rooms[0].vertices).toHaveLength(4)
  })

  it('detects a triangle room', () => {
    const triangle = [
      wall(0, 0, 100, 0),
      wall(100, 0, 50, 100),
      wall(50, 100, 0, 0),
    ]
    const rooms = detectRooms(triangle)
    expect(rooms).toHaveLength(1)
    expect(rooms[0].area).toBeGreaterThan(50)
  })

  it('merges endpoints within MERGE_TOL (8px)', () => {
    // Square with slightly off corners (within tolerance)
    const sloppySquare = [
      wall(0, 0, 100, 2),     // end 2px off
      wall(99, 0, 99, 100),   // start 1px off
      wall(100, 100, 0, 100),
      wall(0, 100, 0, 0),
    ]
    const rooms = detectRooms(sloppySquare)
    expect(rooms).toHaveLength(1)
  })

  it('ignores degenerate zero-length walls', () => {
    const withDegenerate = [
      ...square,
      wall(50, 50, 50, 50), // zero length
    ]
    const rooms = detectRooms(withDegenerate)
    expect(rooms).toHaveLength(1)
  })

  it('detects two separate rooms (adjacent squares)', () => {
    // Two 100×100 squares sharing a wall at x=100
    const twoRooms = [
      // left square
      wall(0,   0,   100, 0),
      wall(100, 0,   100, 100),
      wall(100, 100, 0,   100),
      wall(0,   100, 0,   0),
      // right square
      wall(100, 0,   200, 0),
      wall(200, 0,   200, 100),
      wall(200, 100, 100, 100),
    ]
    const rooms = detectRooms(twoRooms)
    expect(rooms).toHaveLength(2)
    expect(rooms.every(r => r.area > 50)).toBe(true)
  })

  it('drops slivers (area < MIN_AREA=50)', () => {
    // Very thin rectangle: 1000×0.04 px ≈ 40 px² area
    const sliver = [
      wall(0, 0, 1000, 0),
      wall(1000, 0, 1000, 0.04),
      wall(1000, 0.04, 0, 0.04),
      wall(0, 0.04, 0, 0),
    ]
    const rooms = detectRooms(sliver)
    expect(rooms).toHaveLength(0)
  })

  it('returns area as positive number', () => {
    const rooms = detectRooms(square)
    expect(rooms[0].area).toBeGreaterThan(0)
  })
})
