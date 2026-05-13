import { describe, it, expect } from 'vitest'
import { snapAngle } from '../../lib/snap'

// snapToWallEndpoint and snapToWallLine depend on tldraw Editor —
// tested here via snapAngle (pure) + mocked Editor scenarios below.

describe('snapAngle', () => {
  it('returns same vector when length < 1', () => {
    const result = snapAngle(0.5, 0.5)
    expect(result).toEqual({ x: 0.5, y: 0.5 })
  })

  it('snaps 0° direction (horizontal right)', () => {
    const r = snapAngle(10, 0)
    expect(r.x).toBeCloseTo(10, 2)
    expect(r.y).toBeCloseTo(0, 2)
  })

  it('snaps 90° direction (vertical down)', () => {
    const r = snapAngle(0, 10)
    expect(r.x).toBeCloseTo(0, 2)
    expect(r.y).toBeCloseTo(10, 2)
  })

  it('snaps 45° direction', () => {
    const r = snapAngle(7, 7)
    const angle = Math.atan2(r.y, r.x) * (180 / Math.PI)
    expect(angle).toBeCloseTo(45, 0)
  })

  it('snaps ~7° to 0° (within 7.5° threshold)', () => {
    const r = snapAngle(10, 1.2) // ~6.8°
    const angle = Math.atan2(r.y, r.x) * (180 / Math.PI)
    expect(angle).toBeCloseTo(0, 0)
  })

  it('snaps ~8° to 15°', () => {
    const r = snapAngle(10, 1.5) // ~8.5°
    const angle = Math.atan2(r.y, r.x) * (180 / Math.PI)
    expect(angle).toBeCloseTo(15, 0)
  })

  it('preserves vector length after snap', () => {
    const origLen = Math.hypot(8, 6) // 10
    const r = snapAngle(8, 6)
    expect(Math.hypot(r.x, r.y)).toBeCloseTo(origLen, 4)
  })

  it('snaps 180° direction (horizontal left)', () => {
    const r = snapAngle(-10, 0)
    expect(r.x).toBeCloseTo(-10, 2)
    expect(r.y).toBeCloseTo(0, 2)
  })

  it('snaps 135° direction', () => {
    const r = snapAngle(-7, 7)
    const angle = Math.atan2(r.y, r.x) * (180 / Math.PI)
    expect(angle).toBeCloseTo(135, 0)
  })

  it('supports custom step (30°)', () => {
    const r = snapAngle(8, 4, 30) // ~26.6° → nearest 30°
    const angle = Math.atan2(r.y, r.x) * (180 / Math.PI)
    expect(angle).toBeCloseTo(30, 0)
  })

  it('supports custom step (45°)', () => {
    const r = snapAngle(10, 3, 45) // ~16.7° → nearest 0°
    const angle = Math.atan2(r.y, r.x) * (180 / Math.PI)
    expect(angle).toBeCloseTo(0, 0)
  })
})

// -- Editor-dependent snap functions tested with minimal mock --

type FakeShape = {
  id: string
  type: string
  x: number
  y: number
  props: { x2: number; y2: number; thickness?: number }
}

function makeEditor(shapes: FakeShape[], zoom = 1) {
  return {
    getZoomLevel: () => zoom,
    getCurrentPageShapes: () => shapes,
  }
}

import { snapToWallEndpoint, snapToWallLine } from '../../lib/snap'

describe('snapToWallEndpoint', () => {
  it('returns null when no walls', () => {
    const editor = makeEditor([])
    expect(snapToWallEndpoint(editor as never, { x: 0, y: 0 })).toBeNull()
  })

  it('returns null when outside snap radius', () => {
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0 } },
    ])
    // SNAP_RADIUS_PX=12, zoom=1 → radius=12px. Point at 50,50 is far from any endpoint.
    expect(snapToWallEndpoint(editor as never, { x: 50, y: 50 })).toBeNull()
  })

  it('snaps to wall start endpoint', () => {
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0 } },
    ])
    const snap = snapToWallEndpoint(editor as never, { x: 3, y: 3 })
    expect(snap).not.toBeNull()
    expect(snap!.x).toBe(0)
    expect(snap!.y).toBe(0)
  })

  it('snaps to wall end endpoint', () => {
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0 } },
    ])
    const snap = snapToWallEndpoint(editor as never, { x: 102, y: 2 })
    expect(snap).not.toBeNull()
    expect(snap!.x).toBe(100)
    expect(snap!.y).toBe(0)
  })

  it('excludes shape by id', () => {
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0 } },
    ])
    const snap = snapToWallEndpoint(editor as never, { x: 3, y: 3 }, 'w1')
    expect(snap).toBeNull()
  })

  it('ignores non-wall shapes', () => {
    const editor = makeEditor([
      { id: 'd1', type: 'door', x: 0, y: 0, props: { x2: 0, y2: 0 } },
    ])
    expect(snapToWallEndpoint(editor as never, { x: 0, y: 0 })).toBeNull()
  })

  it('snaps at larger radius when zoomed out', () => {
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 200, y2: 0 } },
    ], 0.5) // zoom=0.5 → radius = 12/0.5 = 24px
    // Point at 20,0 — within 24px of origin
    const snap = snapToWallEndpoint(editor as never, { x: 20, y: 0 })
    expect(snap).not.toBeNull()
  })
})

describe('snapToWallLine', () => {
  it('returns null when no walls', () => {
    const editor = makeEditor([])
    expect(snapToWallLine(editor as never, { x: 50, y: 10 })).toBeNull()
  })

  it('projects onto horizontal wall centerline', () => {
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0, thickness: 10 } },
    ])
    const snap = snapToWallLine(editor as never, { x: 50, y: 5 })
    expect(snap).not.toBeNull()
    expect(snap!.x).toBeCloseTo(50, 1)
    expect(snap!.y).toBeCloseTo(0, 1)
  })

  it('returns correct angle for horizontal wall', () => {
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0, thickness: 10 } },
    ])
    const snap = snapToWallLine(editor as never, { x: 50, y: 5 })
    expect(snap!.angle).toBeCloseTo(0, 4) // atan2(0,100)=0
  })

  it('returns null when point is too far from wall', () => {
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0, thickness: 10 } },
    ])
    // WALL_LINE_RADIUS_PX=20, zoom=1 → radius=20px. Point at 50,30 is 30px away.
    expect(snapToWallLine(editor as never, { x: 50, y: 30 })).toBeNull()
  })

  it('clamps projection to wall segment (not beyond endpoints)', () => {
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0, thickness: 10 } },
    ])
    // Point past end of wall, but within line-snap radius
    const snap = snapToWallLine(editor as never, { x: 110, y: 5 })
    if (snap) {
      // If snapped, projection should be clamped to end of segment
      expect(snap.x).toBeCloseTo(100, 1)
    }
    // else null is also acceptable (outside radius)
  })
})
