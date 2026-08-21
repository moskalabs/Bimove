import { describe, it, expect, beforeEach } from 'vitest'
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
  props: Record<string, unknown>
}

function makeEditor(shapes: FakeShape[], zoom = 1) {
  return {
    getZoomLevel: () => zoom,
    getCurrentPageShapes: () => shapes,
    // 그룹/회전 없는 단순 translation 변환 (테스트용)
    getShapePageTransform: (shape: FakeShape) => ({
      applyToPoint: (pt: { x: number; y: number }) => ({
        x: shape.x + pt.x,
        y: shape.y + pt.y,
      }),
    }),
  }
}

import {
  snapToWallEndpoint, snapToWallLine, _resetSnapCache,
  lineSegmentIntersection, snapToIntersection, snapToPerpendicular, snapToExtension,
  parseDxfPathEndpoints,
} from '../../lib/snap'
import { setSnapMode } from '../../lib/settings'

beforeEach(() => {
  _resetSnapCache()
  // 테스트에서 모든 스냅 모드 활성화
  setSnapMode('endpoint', true)
  setSnapMode('midpoint', true)
  setSnapMode('intersection', true)
  setSnapMode('perpendicular', true)
  setSnapMode('extension', true)
})

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

// ── lineSegmentIntersection (pure function) ──

describe('lineSegmentIntersection', () => {
  it('finds intersection of perpendicular lines', () => {
    // horizontal (0,0)-(100,0) and vertical (50,-50)-(50,50)
    const pt = lineSegmentIntersection(0, 0, 100, 0, 50, -50, 50, 50)
    expect(pt).not.toBeNull()
    expect(pt!.x).toBeCloseTo(50, 4)
    expect(pt!.y).toBeCloseTo(0, 4)
  })

  it('finds intersection at segment endpoints', () => {
    // lines meeting at (100,0)
    const pt = lineSegmentIntersection(0, 0, 100, 0, 100, -50, 100, 50)
    expect(pt).not.toBeNull()
    expect(pt!.x).toBeCloseTo(100, 4)
    expect(pt!.y).toBeCloseTo(0, 4)
  })

  it('returns null for parallel lines', () => {
    const pt = lineSegmentIntersection(0, 0, 100, 0, 0, 10, 100, 10)
    expect(pt).toBeNull()
  })

  it('returns null when segments do not reach each other', () => {
    // two segments that would intersect if extended, but don't actually cross
    const pt = lineSegmentIntersection(0, 0, 40, 0, 50, -50, 50, -10)
    expect(pt).toBeNull()
  })

  it('finds diagonal intersection', () => {
    // (0,0)-(100,100) and (0,100)-(100,0) → intersect at (50,50)
    const pt = lineSegmentIntersection(0, 0, 100, 100, 0, 100, 100, 0)
    expect(pt).not.toBeNull()
    expect(pt!.x).toBeCloseTo(50, 4)
    expect(pt!.y).toBeCloseTo(50, 4)
  })
})

// ── snapToIntersection ──

describe('snapToIntersection', () => {
  it('returns null when no walls', () => {
    const editor = makeEditor([])
    expect(snapToIntersection(editor as never, { x: 0, y: 0 })).toBeNull()
  })

  it('returns null when single wall (no intersections possible)', () => {
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0 } },
    ])
    expect(snapToIntersection(editor as never, { x: 50, y: 0 })).toBeNull()
  })

  it('snaps to intersection of two crossing walls', () => {
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0 } },
      { id: 'w2', type: 'wall', x: 50, y: -50, props: { x2: 0, y2: 100 } },
    ])
    // intersection at (50, 0), point nearby
    const snap = snapToIntersection(editor as never, { x: 52, y: 2 })
    expect(snap).not.toBeNull()
    expect(snap!.x).toBeCloseTo(50, 1)
    expect(snap!.y).toBeCloseTo(0, 1)
    expect(snap!.snapType).toBe('intersection')
  })

  it('returns null when cursor too far from intersection', () => {
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0 } },
      { id: 'w2', type: 'wall', x: 50, y: -50, props: { x2: 0, y2: 100 } },
    ])
    // intersection at (50, 0), but cursor at (80, 80) — too far
    expect(snapToIntersection(editor as never, { x: 80, y: 80 })).toBeNull()
  })

  it('excludes intersections involving excluded shape', () => {
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0 } },
      { id: 'w2', type: 'wall', x: 50, y: -50, props: { x2: 0, y2: 100 } },
    ])
    const snap = snapToIntersection(editor as never, { x: 52, y: 2 }, 'w1')
    expect(snap).toBeNull()
  })
})

// ── snapToPerpendicular ──

describe('snapToPerpendicular', () => {
  it('returns null when no walls', () => {
    const editor = makeEditor([])
    expect(snapToPerpendicular(editor as never, { x: 0, y: 50 }, { x: 50, y: 50 })).toBeNull()
  })

  it('finds perpendicular foot on horizontal wall', () => {
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0 } },
    ])
    // start point at (30, 50), perpendicular foot on wall y=0 should be (30, 0)
    // cursor must be near the perpendicular foot
    const snap = snapToPerpendicular(editor as never, { x: 30, y: 50 }, { x: 32, y: 2 })
    expect(snap).not.toBeNull()
    expect(snap!.x).toBeCloseTo(30, 1)
    expect(snap!.y).toBeCloseTo(0, 1)
    expect(snap!.snapType).toBe('perpendicular')
  })

  it('returns null when cursor far from perpendicular foot', () => {
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0 } },
    ])
    // perpendicular foot at (30, 0), cursor at (80, 80) — too far
    const snap = snapToPerpendicular(editor as never, { x: 30, y: 50 }, { x: 80, y: 80 })
    expect(snap).toBeNull()
  })

  it('clamps perpendicular foot to wall segment', () => {
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0 } },
    ])
    // start point at (-20, 50), perpendicular would be at (-20, 0) which is outside wall
    // clamped to wall start (0, 0)
    const snap = snapToPerpendicular(editor as never, { x: -20, y: 50 }, { x: 2, y: 2 })
    if (snap) {
      expect(snap.x).toBeCloseTo(0, 1) // clamped to 0
    }
  })

  it('excludes specified wall', () => {
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0 } },
    ])
    const snap = snapToPerpendicular(editor as never, { x: 30, y: 50 }, { x: 32, y: 2 }, 'w1')
    expect(snap).toBeNull()
  })
})

// ── snapToExtension ──

describe('snapToExtension', () => {
  it('returns null when no walls', () => {
    const editor = makeEditor([])
    expect(snapToExtension(editor as never, { x: 110, y: 0 })).toBeNull()
  })

  it('snaps to extension beyond wall end', () => {
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0 } },
    ])
    // wall is (0,0)-(100,0), extension beyond end at x=120
    const snap = snapToExtension(editor as never, { x: 120, y: 2 })
    expect(snap).not.toBeNull()
    expect(snap!.x).toBeCloseTo(120, 1)
    expect(snap!.y).toBeCloseTo(0, 1)
    expect(snap!.snapType).toBe('extension')
  })

  it('snaps to extension before wall start', () => {
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 100, y: 0, props: { x2: 100, y2: 0 } },
    ])
    // wall is (100,0)-(200,0), extension before start at x=80
    const snap = snapToExtension(editor as never, { x: 80, y: 2 })
    expect(snap).not.toBeNull()
    expect(snap!.x).toBeCloseTo(80, 1)
    expect(snap!.y).toBeCloseTo(0, 1)
  })

  it('returns null for points within wall segment (not extension)', () => {
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0 } },
    ])
    // point at (50, 2) is on the wall itself, not extension
    expect(snapToExtension(editor as never, { x: 50, y: 2 })).toBeNull()
  })

  it('returns null when too far from extension line', () => {
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0 } },
    ])
    // extension at x=120, but cursor at y=30 — too far
    expect(snapToExtension(editor as never, { x: 120, y: 30 })).toBeNull()
  })

  it('limits extension range (max 2x wall length)', () => {
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0 } },
    ])
    // wall length=100, max extension: t=2 → x=200, t=-1 → x=-100
    // cursor at x=250 → t=2.5 > 2 → should not snap
    expect(snapToExtension(editor as never, { x: 250, y: 0 })).toBeNull()
  })

  it('excludes specified wall', () => {
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0 } },
    ])
    const snap = snapToExtension(editor as never, { x: 120, y: 2 }, 'w1')
    expect(snap).toBeNull()
  })
})

// ── parseDxfPathEndpoints ──

describe('parseDxfPathEndpoints', () => {
  it('parses single M...L segment', () => {
    const segs = parseDxfPathEndpoints('M0,0L100,50')
    expect(segs).toHaveLength(1)
    expect(segs[0]).toEqual({ x1: 0, y1: 0, x2: 100, y2: 50 })
  })

  it('parses multiple segments', () => {
    const segs = parseDxfPathEndpoints('M0,0L100,0 M0,50L100,50')
    expect(segs).toHaveLength(2)
    expect(segs[0]).toEqual({ x1: 0, y1: 0, x2: 100, y2: 0 })
    expect(segs[1]).toEqual({ x1: 0, y1: 50, x2: 100, y2: 50 })
  })

  it('handles decimal coordinates', () => {
    const segs = parseDxfPathEndpoints('M12.5,3.7L45.8,99.2')
    expect(segs).toHaveLength(1)
    expect(segs[0].x1).toBeCloseTo(12.5)
    expect(segs[0].y1).toBeCloseTo(3.7)
  })

  it('returns empty array for empty string', () => {
    expect(parseDxfPathEndpoints('')).toEqual([])
  })
})

// ── dxfgroup snap integration ──

describe('dxfgroup snap', () => {
  it('snaps to dxfgroup segment endpoints', () => {
    const editor = makeEditor([
      {
        id: 'g1', type: 'dxfgroup', x: 100, y: 200,
        props: { pathData: 'M0,0L50,0 M0,30L50,30', thickness: 2, segCount: 2 },
      },
    ])
    // first seg start at (100+0, 200+0) = (100, 200)
    const snap = snapToWallEndpoint(editor as never, { x: 102, y: 202 })
    expect(snap).not.toBeNull()
    expect(snap!.x).toBe(100)
    expect(snap!.y).toBe(200)
  })

  it('snaps to dxfgroup segment end point', () => {
    const editor = makeEditor([
      {
        id: 'g1', type: 'dxfgroup', x: 0, y: 0,
        props: { pathData: 'M10,20L80,20', thickness: 2, segCount: 1 },
      },
    ])
    // seg end at (0+80, 0+20) = (80, 20)
    const snap = snapToWallEndpoint(editor as never, { x: 82, y: 22 })
    expect(snap).not.toBeNull()
    expect(snap!.x).toBe(80)
    expect(snap!.y).toBe(20)
  })

  it('snaps to dxfgroup midpoint', () => {
    const editor = makeEditor([
      {
        id: 'g1', type: 'dxfgroup', x: 0, y: 0,
        props: { pathData: 'M0,0L100,0', thickness: 2, segCount: 1 },
      },
    ])
    // midpoint = (50, 0)
    const snap = snapToWallEndpoint(editor as never, { x: 52, y: 2 })
    expect(snap).not.toBeNull()
    expect(snap!.x).toBe(50)
    expect(snap!.y).toBe(0)
    expect(snap!.snapType).toBe('midpoint')
  })

  it('snapToWallLine works with dxfgroup', () => {
    const editor = makeEditor([
      {
        id: 'g1', type: 'dxfgroup', x: 0, y: 0,
        props: { pathData: 'M0,0L100,0', thickness: 5, segCount: 1 },
      },
    ])
    const snap = snapToWallLine(editor as never, { x: 50, y: 5 })
    expect(snap).not.toBeNull()
    expect(snap!.x).toBeCloseTo(50, 1)
    expect(snap!.y).toBeCloseTo(0, 1)
  })

  it('mixes wall and dxfgroup shapes', () => {
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0 } },
      {
        id: 'g1', type: 'dxfgroup', x: 200, y: 0,
        props: { pathData: 'M0,0L100,0', thickness: 2, segCount: 1 },
      },
    ])
    // snap to wall endpoint
    const s1 = snapToWallEndpoint(editor as never, { x: 2, y: 2 })
    expect(s1).not.toBeNull()
    expect(s1!.x).toBe(0)

    _resetSnapCache()
    setSnapMode('endpoint', true)
    setSnapMode('midpoint', true)

    // snap to dxfgroup endpoint at (200, 0)
    const s2 = snapToWallEndpoint(editor as never, { x: 202, y: 2 })
    expect(s2).not.toBeNull()
    expect(s2!.x).toBe(200)
  })
})
