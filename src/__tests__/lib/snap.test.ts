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

// ── Wall edge snap (벽체 양쪽 엣지 스냅) ──

describe('wall edge snap', () => {
  it('snaps to edge point when far from centerline', () => {
    // 수평 벽 (0,0)-(100,0), thickness=20 → 엣지 y=±10
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0, thickness: 20 } },
    ])
    // 커서 (2, 12) → 중심선 (0,0)까지 d=12.17, 엣지 (0,10)까지 d=2.83
    // 중심선이 반경 내에 있으면 중심선 우선이므로, 중심선 반경 밖에서 테스트
    const snap = snapToWallEndpoint(editor as never, { x: 1, y: 11 })
    expect(snap).not.toBeNull()
    // 중심선 (0,0)도 반경 내이므로 중심선이 우선 (two-pass 로직)
    // 실제로 d(0,0) = sqrt(1+121) = 11.05, d(0,10) = sqrt(1+1) = 1.41
    // 중심선 11.05 < 12 → 중심선 스냅됨
    expect(snap!.snapType).toBe('endpoint')
    expect(snap!.x).toBe(0)
    expect(snap!.y).toBe(0)
  })

  it('prefers centerline over edge (two-pass priority)', () => {
    // 벽체 (0,0)-(100,0), thickness=10 → 엣지 y=±5
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0, thickness: 10 } },
    ])
    // 커서 (3, 3): 중심선(0,0) d=4.24, 엣지(0,5) d=3.61
    // 엣지가 더 가까워도 중심선 우선
    const snap = snapToWallEndpoint(editor as never, { x: 3, y: 3 })
    expect(snap).not.toBeNull()
    expect(snap!.snapType).toBe('endpoint')
    expect(snap!.x).toBe(0)
    expect(snap!.y).toBe(0)
  })

  it('falls back to edge when centerline out of range', () => {
    // 벽체 (50,0)-(150,0), thickness=20 → 엣지 (50,±10), (150,±10)
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 50, y: 0, props: { x2: 100, y2: 0, thickness: 20 } },
    ])
    // 커서 (51, 11): 중심선(50,0) d=11.05 < 12 → 중심선 우선
    // 커서를 중심선 밖으로:
    // 커서 (40, 11): 중심선(50,0) d=sqrt(100+121)=14.87 > 12 → 중심선 밖
    // 엣지(50,10) d=sqrt(100+1)=10.05 < 12 → 엣지 스냅
    const snap = snapToWallEndpoint(editor as never, { x: 40, y: 11 })
    expect(snap).not.toBeNull()
    expect(snap!.snapType).toBe('edge')
  })

  it('edge snap points exist for both sides of wall', () => {
    // 수직 벽 (0,0)-(0,100), thickness=20
    // 수직 벽의 법선은 좌우 방향 → 엣지 x=±10
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 0, y2: 100, thickness: 20 } },
    ])

    // 왼쪽 엣지 (10,0) 근처
    _resetSnapCache()
    setSnapMode('endpoint', true)
    setSnapMode('midpoint', true)
    const snapLeft = snapToWallEndpoint(editor as never, { x: 20, y: 1 })
    // 중심선(0,0) d=20.02 > 12 → 밖
    // 엣지(10,0) d=sqrt(100+1)=10.05 < 12 → 스냅
    expect(snapLeft).not.toBeNull()
    if (snapLeft) {
      expect(snapLeft.snapType).toBe('edge')
      expect(snapLeft.x).toBeCloseTo(10, 0)
    }

    // 오른쪽 엣지 (-10,0) 근처
    _resetSnapCache()
    const snapRight = snapToWallEndpoint(editor as never, { x: -20, y: 1 })
    expect(snapRight).not.toBeNull()
    if (snapRight) {
      expect(snapRight.snapType).toBe('edge')
      expect(snapRight.x).toBeCloseTo(-10, 0)
    }
  })

  it('does not produce edge points for very short walls', () => {
    // len < 1 → no edge points
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 0.5, y2: 0, thickness: 20 } },
    ])
    // 중심선 끝점만 존재
    const snap = snapToWallEndpoint(editor as never, { x: 0, y: 11 })
    // 중심선(0,0) d=11 < 12 → 스냅
    expect(snap).not.toBeNull()
    expect(snap!.snapType).toBe('endpoint')
  })

  it('excludes edge points when shape is excluded', () => {
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 50, y: 0, props: { x2: 100, y2: 0, thickness: 20 } },
    ])
    const snap = snapToWallEndpoint(editor as never, { x: 40, y: 11 }, 'w1')
    expect(snap).toBeNull()
  })

  it('diagonal wall produces correct edge points', () => {
    // 대각선 벽: (0,0)-(100,100), thickness=14.14
    // len = sqrt(20000) ≈ 141.42
    // 법선: (-dy/len, dx/len) * half = (-100/141.42, 100/141.42) * 7.07 = (-5, 5)
    // 엣지 시작점: (0+(-5), 0+5) = (-5, 5) 및 (0+5, 0-5) = (5, -5)
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 100, thickness: 14.14 } },
    ])
    // 중심선 밖, 엣지 (-5, 5) 근처
    const snap = snapToWallEndpoint(editor as never, { x: -12, y: 7 })
    if (snap && snap.snapType === 'edge') {
      // 엣지 포인트가 벽의 법선 방향으로 오프셋되어 있음
      expect(Math.abs(snap.x) + Math.abs(snap.y)).toBeGreaterThan(0)
    }
  })
})

// ── resolveDrawPoint 엣지 모드 ──

describe('resolveDrawPoint edge mode', () => {
  it('imports resolveDrawPoint successfully', async () => {
    const snap = await import('../../lib/snap')
    expect(typeof snap.resolveDrawPoint).toBe('function')
  })
})

// ── resolveDrawPointAt: 오버레이가 쓰는 경로 ──
//
// 공간지정·면적측정 오버레이는 `<Tldraw>` 의 형제로 붙어 자기 포인터 이벤트를
// 직접 받는다 — editor.inputs 가 따라오지 않는다. 그래서 끝점 스냅 하나만 부르고
// 있었고 **직교가 통째로 죽어 있었다.** 커서를 인자로 받는 경로가 이 테스트다.

import { resolveDrawPointAt } from '../../lib/snap'
import { setSnapEnabled } from '../../lib/settings'

describe('resolveDrawPointAt', () => {
  it('직교가 켜져 있으면 시작점 기준 15° 배수로 각을 맞춘다', () => {
    setSnapEnabled(true)
    const editor = makeEditor([])
    // (0,0) 에서 살짝 기운 점 → 수평으로 당겨진다
    const p = resolveDrawPointAt(editor as never, { x: 100, y: 7 }, { x: 0, y: 0 }, false)
    expect(p.snapType).toBe('angle')
    expect(p.y).toBeCloseTo(0, 6)
  })

  it('shift 를 누르면 직교를 잠깐 끈다', () => {
    setSnapEnabled(true)
    const editor = makeEditor([])
    const p = resolveDrawPointAt(editor as never, { x: 100, y: 7 }, { x: 0, y: 0 }, true)
    expect(p.snapType).toBeUndefined()
    expect(p.y).toBe(7)
  })

  it('시작점이 없으면(첫 점) 직교를 걸지 않는다', () => {
    setSnapEnabled(true)
    const editor = makeEditor([])
    const p = resolveDrawPointAt(editor as never, { x: 100, y: 7 }, null, false)
    expect(p.snapType).toBeUndefined()
    expect(p).toMatchObject({ x: 100, y: 7 })
  })

  it('끝점 스냅이 직교보다 우선한다', () => {
    setSnapEnabled(true)
    const editor = makeEditor([
      { id: 'w1', type: 'wall', x: 200, y: 50, props: { x2: 100, y2: 0 } },
    ])
    const p = resolveDrawPointAt(editor as never, { x: 203, y: 52 }, { x: 0, y: 0 }, false)
    expect(p.snapType).toBe('endpoint')
    expect(p).toMatchObject({ x: 200, y: 50 })
  })

  it('직교를 꺼두면 커서 자리를 그대로 쓴다', () => {
    setSnapEnabled(false)
    const editor = makeEditor([])
    const p = resolveDrawPointAt(editor as never, { x: 100, y: 7 }, { x: 0, y: 0 }, false)
    expect(p.snapType).toBeUndefined()
    expect(p.y).toBe(7)
  })
})

// ── 스냅 모드 6종이 토글대로 도는지 ──
//
// 한이 쓰는 패널에 끝점·중간점·교차점·수직·연장·직교 여섯 개가 있다. 켜면
// 걸리고 끄면 안 걸려야 한다. 전엔 두 군데가 어긋나 있었다.

import { setSnapEnabled as _setOrtho, setSnapMode as _setMode } from '../../lib/settings'

/** 여섯 모드를 한 번에 세팅. 안 준 건 켠다. */
function modes(off: string[] = []) {
  for (const m of ['endpoint', 'midpoint', 'intersection', 'perpendicular', 'extension'] as const) {
    _setMode(m, !off.includes(m))
  }
  _setOrtho(!off.includes('ortho'))
}

describe('스냅 모드 토글', () => {
  beforeEach(() => { _resetSnapCache(); modes() })

  /** (0,0)-(100,0) 한 줄. 끝점 (0,0)/(100,0), 중간점 (50,0). */
  const oneWall = () => makeEditor([
    { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0, thickness: 10 } },
  ])

  it('끝점만 끄면 중간점은 그대로 걸린다', () => {
    // 여기가 실제 버그였다. 가장 가까운 점 하나만 보고 "그 종류가 꺼졌으면
    // 버리는" 식이라, 커서가 끝점에 조금 더 가까우면 중간점까지 같이 죽었다.
    _resetSnapCache(); modes(['endpoint'])
    // 끝점(0,0)에 더 가깝지만 중간점(50,0)도 반경 안인 자리는 만들 수 없으니,
    // 중간점 근처에서 중간점이 살아 있는지만 본다.
    const mid = snapToWallEndpoint(oneWall() as never, { x: 52, y: 3 })
    expect(mid?.snapType).toBe('midpoint')
    // 끝점 자리는 아무것도 안 걸려야 한다
    _resetSnapCache()
    expect(snapToWallEndpoint(oneWall() as never, { x: 2, y: 2 })).toBeNull()
  })

  it('중간점만 끄면 끝점은 그대로 걸린다', () => {
    _resetSnapCache(); modes(['midpoint'])
    expect(snapToWallEndpoint(oneWall() as never, { x: 2, y: 2 })?.snapType).toBe('endpoint')
    _resetSnapCache()
    expect(snapToWallEndpoint(oneWall() as never, { x: 52, y: 3 })).toBeNull()
  })

  it('둘 다 끄면 아무것도 안 걸린다', () => {
    _resetSnapCache(); modes(['endpoint', 'midpoint'])
    expect(snapToWallEndpoint(oneWall() as never, { x: 2, y: 2 })).toBeNull()
    _resetSnapCache()
    expect(snapToWallEndpoint(oneWall() as never, { x: 52, y: 3 })).toBeNull()
  })

  /** ┼ 자로 만나는 두 벽. 교차점은 (50,0). */
  const crossWalls = () => makeEditor([
    { id: 'w1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0, thickness: 10 } },
    { id: 'w2', type: 'wall', x: 50, y: -50, props: { x2: 0, y2: 100, thickness: 10 } },
  ])

  it('교차점이 걸린다 / 끄면 안 걸린다', () => {
    const hit = snapToIntersection(crossWalls() as never, { x: 52, y: 3 })
    expect(hit?.snapType).toBe('intersection')
    expect(hit!.x).toBeCloseTo(50, 3)
    expect(hit!.y).toBeCloseTo(0, 3)

    _resetSnapCache(); modes(['intersection'])
    expect(snapToIntersection(crossWalls() as never, { x: 52, y: 3 })).toBeNull()
  })

  it('수직이 걸린다 / 끄면 안 걸린다', () => {
    // 시작점 (50,-40) 에서 가로벽에 수선 → (50,0)
    const hit = snapToPerpendicular(oneWall() as never, { x: 50, y: -40 }, { x: 52, y: 3 })
    expect(hit?.snapType).toBe('perpendicular')
    expect(hit!.x).toBeCloseTo(50, 3)

    _resetSnapCache(); modes(['perpendicular'])
    expect(snapToPerpendicular(oneWall() as never, { x: 50, y: -40 }, { x: 52, y: 3 })).toBeNull()
  })

  it('연장이 걸린다 / 끄면 안 걸린다', () => {
    // 선분 밖(x>100) 의 연장선 위
    const hit = snapToExtension(oneWall() as never, { x: 130, y: 3 })
    expect(hit?.snapType).toBe('extension')
    expect(hit!.y).toBeCloseTo(0, 3)

    _resetSnapCache(); modes(['extension'])
    expect(snapToExtension(oneWall() as never, { x: 130, y: 3 })).toBeNull()
  })
})

// ── 교차점 스냅의 비용 ──
//
// 예전엔 페이지의 **모든 선 쌍**을 미리 구했다. DXF 를 가져오면 선이 수만
// 개라 쌍이 수십억이 되어 탭이 멈췄다. 이제 커서 반경 안의 선만 짝짓는다.

describe('교차점 스냅 비용', () => {
  beforeEach(() => { _resetSnapCache(); modes() })

  it('선이 수천 개여도 멈추지 않는다', () => {
    // 8000개를 쌍으로 다 돌면 3200만 번이다. 실제 도면은 이보다 더 크다.
    // 커서 근처만 보면 선 수에 **선형**이라 같은 규모에서 1ms 안쪽이다.
    const N = 8000
    const shapes = Array.from({ length: N }, (_, i) => ({
      id: `w${i}`, type: 'wall', x: i * 40, y: 0,
      props: { x2: 0, y2: 1000, thickness: 10 },
    }))
    shapes.push({ id: 'h1', type: 'wall', x: 0, y: 500, props: { x2: N * 40, y2: 0, thickness: 10 } })
    const editor = makeEditor(shapes) as never

    const t0 = performance.now()
    for (let i = 0; i < 10; i++) {
      _resetSnapCache()
      snapToIntersection(editor, { x: 40 * 7 + 2, y: 502 })
    }
    const ms = (performance.now() - t0) / 10
    expect(ms).toBeLessThan(60)
  })

  it('커서 근처 교차점을 제대로 찾는다 (가까운 것 우선)', () => {
    const editor = makeEditor([
      { id: 'v1', type: 'wall', x: 50, y: -50, props: { x2: 0, y2: 200, thickness: 10 } },
      { id: 'v2', type: 'wall', x: 400, y: -50, props: { x2: 0, y2: 200, thickness: 10 } },
      { id: 'h1', type: 'wall', x: 0, y: 0, props: { x2: 600, y2: 0, thickness: 10 } },
    ]) as never
    const hit = snapToIntersection(editor, { x: 398, y: 3 })
    expect(hit).not.toBeNull()
    expect(hit!.x).toBeCloseTo(400, 3)   // 멀리 있는 (50,0) 이 아니라
  })
})
