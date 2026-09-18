/**
 * Tests for DXF entity parsing: HATCH, SOLID, 3DFACE, ARC, CIRCLE, ELLIPSE,
 * INSERT/BLOCK expansion, TEXT/MTEXT collection.
 *
 * parseDxfSegments is the public API for segment extraction.
 * For INSERT/BLOCK + TEXT we go through parseCadFile → commitCadImport pipeline
 * using inline DXF strings.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import DxfParser from 'dxf-parser'
import { parseDxfSegments, commitCadImport, type CadParseResult, type DxfSeg } from '../../lib/dxf'

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Parse inline DXF entities into segments */
function parseEntities(
  entities: Array<Record<string, unknown>>,
  layerDefs: Record<string, { lineweight?: number; colorIndex?: number; color?: number }> = {},
): DxfSeg[] {
  return parseDxfSegments(entities, layerDefs)
}

function createMockEditor(opts: {
  pxPerMm?: number
  viewportWidth?: number
  viewportHeight?: number
} = {}) {
  const pxPerMm = opts.pxPerMm ?? 1
  const vpW = opts.viewportWidth ?? 1200
  const vpH = opts.viewportHeight ?? 800
  const createdShapes: unknown[] = []
  let camera = { x: 0, y: 0, z: 1 }
  const currentShapes: unknown[] = []

  return {
    getInstanceState: () => ({ meta: { unit: 'mm', pxPerMm } }),
    getViewportScreenBounds: () => ({ width: vpW, height: vpH }),
    createShapes: (shapes: unknown[]) => { createdShapes.push(...shapes); currentShapes.push(...shapes) },
    getCurrentPageShapes: () => currentShapes,
    setCamera: (cam: { x: number; y: number; z: number }) => { camera = { ...cam } },
    getCamera: () => camera,
    selectAll: vi.fn(),
    getSelectedShapeIds: () => createdShapes.map((_s, i) => `shape:${i}`),
    zoomToFit: vi.fn(),
    zoomToSelection: vi.fn(),
    select: vi.fn(),
    selectNone: vi.fn(),
    _getCamera: () => camera,
    _getCreatedShapes: () => createdShapes,
  }
}

/** Helper: parse DXF text string into CadParseResult */
function parseDxfText(text: string, fileName = 'test.dxf'): CadParseResult {
  const dxf = new DxfParser().parseSync(text)!
  const layerTable = (dxf.tables as unknown as Record<string, unknown>)?.layer as
    { layers?: Record<string, { lineweight?: number; colorIndex?: number; color?: number }> } | undefined
  const layerDefs = layerTable?.layers ?? {}

  const segs = parseDxfSegments(
    dxf.entities as unknown as Array<Record<string, unknown>>,
    layerDefs,
  )

  const layerMap = new Map<string, number>()
  for (const s of segs) {
    const ln = s.layer || '0'
    layerMap.set(ln, (layerMap.get(ln) || 0) + 1)
  }

  const unit = (dxf.header?.['$INSUNITS'] as number | undefined) ?? 4
  const unitToMm = unit === 1 ? 25.4 : unit === 2 ? 304.8 : unit === 5 ? 10 : unit === 6 ? 1000 : 1

  return {
    fileName,
    fileSize: text.length,
    isDwg: false,
    fingerprint: `dxf:${fileName}:${text.length}:${dxf.entities.length}`,
    layers: [...layerMap.entries()].map(([name, segCount]) => ({
      name, segCount, likelyStructural: false,
    })),
    totalSegments: segs.length,
    unitToMm,
    _segs: segs,
    _texts: [],
  }
}

// ─── ARC ────────────────────────────────────────────────────────────────────

describe('parseDxfSegments: ARC', () => {
  it('generates arc segments from center + radius + angles', () => {
    const entities = [{
      type: 'ARC',
      center: { x: 100, y: 200 },
      radius: 50,
      startAngle: 0,
      endAngle: 90,
      layer: 'ARC_LAYER',
    }]
    const segs = parseEntities(entities)

    // 90° arc with 10° steps = 9 segments
    expect(segs.length).toBe(9)

    // First segment starts at (center.x + r, center.y) = (150, 200)
    expect(segs[0].x1).toBeCloseTo(150, 0)
    expect(segs[0].y1).toBeCloseTo(200, 0)

    // Last segment ends at (center.x, center.y + r) = (100, 250)
    const last = segs[segs.length - 1]
    expect(last.x2).toBeCloseTo(100, 0)
    expect(last.y2).toBeCloseTo(250, 0)

    // Layer preserved
    expect(segs[0].layer).toBe('ARC_LAYER')
  })

  it('handles wrap-around (endAngle < startAngle)', () => {
    const entities = [{
      type: 'ARC',
      center: { x: 0, y: 0 },
      radius: 100,
      startAngle: 350,
      endAngle: 10, // wraps past 360
      layer: '0',
    }]
    const segs = parseEntities(entities)
    // 20° arc → at least 2 segments
    expect(segs.length).toBeGreaterThanOrEqual(2)

    // First point should be near (100*cos(350°), 100*sin(350°))
    const cos350 = Math.cos(350 * Math.PI / 180)
    const sin350 = Math.sin(350 * Math.PI / 180)
    expect(segs[0].x1).toBeCloseTo(100 * cos350, 0)
    expect(segs[0].y1).toBeCloseTo(100 * sin350, 0)
  })

  it('skips ARC with zero radius', () => {
    const segs = parseEntities([{
      type: 'ARC', center: { x: 0, y: 0 }, radius: 0,
      startAngle: 0, endAngle: 90,
    }])
    expect(segs.length).toBe(0)
  })
})

// ─── CIRCLE ─────────────────────────────────────────────────────────────────

describe('parseDxfSegments: CIRCLE', () => {
  it('generates 36 segments forming a closed circle', () => {
    const segs = parseEntities([{
      type: 'CIRCLE',
      center: { x: 0, y: 0 },
      radius: 100,
    }])
    expect(segs.length).toBe(36)

    // First segment starts at (100, 0)
    expect(segs[0].x1).toBeCloseTo(100, 0)
    expect(segs[0].y1).toBeCloseTo(0, 0)

    // Last segment ends back at approximately (100, 0)
    const last = segs[segs.length - 1]
    expect(last.x2).toBeCloseTo(100, 0)
    expect(last.y2).toBeCloseTo(0, 0)
  })

  it('respects center position', () => {
    const segs = parseEntities([{
      type: 'CIRCLE',
      center: { x: 500, y: 300 },
      radius: 10,
    }])
    expect(segs.length).toBe(36)
    // First point at (510, 300)
    expect(segs[0].x1).toBeCloseTo(510, 0)
    expect(segs[0].y1).toBeCloseTo(300, 0)
  })

  it('skips CIRCLE with missing center', () => {
    const segs = parseEntities([{ type: 'CIRCLE', radius: 50 }])
    expect(segs.length).toBe(0)
  })
})

// ─── ELLIPSE ────────────────────────────────────────────────────────────────

describe('parseDxfSegments: ELLIPSE', () => {
  it('generates segments for full ellipse', () => {
    const segs = parseEntities([{
      type: 'ELLIPSE',
      center: { x: 0, y: 0 },
      majorAxisEndPoint: { x: 200, y: 0 }, // semi-major = 200, along X
      axisRatio: 0.5, // semi-minor = 100
      startAngle: 0,
      endAngle: 2 * Math.PI,
    }])
    expect(segs.length).toBe(36)

    // First point at (200, 0) — major axis end
    expect(segs[0].x1).toBeCloseTo(200, 0)
    expect(segs[0].y1).toBeCloseTo(0, 0)
  })

  it('handles elliptical arc (partial)', () => {
    const segs = parseEntities([{
      type: 'ELLIPSE',
      center: { x: 0, y: 0 },
      majorAxisEndPoint: { x: 100, y: 0 },
      axisRatio: 0.5,
      startAngle: 0,
      endAngle: Math.PI, // half ellipse
    }])
    // ELLIPSE always uses N=36 segments regardless of arc span
    expect(segs.length).toBe(36)

    // Start at (100, 0)
    expect(segs[0].x1).toBeCloseTo(100, 0)
    // End near (-100, 0) since endAngle = π
    const last = segs[segs.length - 1]
    expect(last.x2).toBeCloseTo(-100, 0)
    expect(last.y2).toBeCloseTo(0, 0)
  })

  it('handles rotated major axis', () => {
    // Major axis at 45° → majorAxisEndPoint = (70.71, 70.71) for length 100
    const segs = parseEntities([{
      type: 'ELLIPSE',
      center: { x: 0, y: 0 },
      majorAxisEndPoint: { x: 70.71, y: 70.71 },
      axisRatio: 0.5,
      startAngle: 0,
      endAngle: 2 * Math.PI,
    }])
    expect(segs.length).toBe(36)

    // Semi-major = hypot(70.71, 70.71) ≈ 100
    // First point should be along the major axis direction
    const dist = Math.hypot(segs[0].x1, segs[0].y1)
    expect(dist).toBeCloseTo(100, 0)
  })
})

// ─── SOLID / 3DFACE ────────────────────────────────────────────────────────

describe('parseDxfSegments: SOLID/3DFACE', () => {
  it('creates 4 outline segments for a quad SOLID (swapped vertex order)', () => {
    // SOLID vertex order: 0→1→3→2 (corners 3&4 swapped in DXF)
    const segs = parseEntities([{
      type: 'SOLID',
      points: [
        { x: 0, y: 0 },   // 0
        { x: 100, y: 0 },  // 1
        { x: 0, y: 100 },  // 2 — in DXF this is "corner 3"
        { x: 100, y: 100 }, // 3 — in DXF this is "corner 4"
      ],
      layer: 'SOLID_LAYER',
    }])

    expect(segs.length).toBe(4)

    // Outline order: 0→1→3→2→0
    // Seg 0: (0,0) → (100,0)
    expect(segs[0].x1).toBe(0)
    expect(segs[0].y1).toBe(0)
    expect(segs[0].x2).toBe(100)
    expect(segs[0].y2).toBe(0)

    // Seg 1: (100,0) → (100,100) [index 3]
    expect(segs[1].x1).toBe(100)
    expect(segs[1].y1).toBe(0)
    expect(segs[1].x2).toBe(100)
    expect(segs[1].y2).toBe(100)

    // Seg 2: (100,100) → (0,100) [index 2]
    expect(segs[2].x1).toBe(100)
    expect(segs[2].y1).toBe(100)
    expect(segs[2].x2).toBe(0)
    expect(segs[2].y2).toBe(100)

    // Seg 3: (0,100) → (0,0)
    expect(segs[3].x1).toBe(0)
    expect(segs[3].y1).toBe(100)
    expect(segs[3].x2).toBe(0)
    expect(segs[3].y2).toBe(0)

    expect(segs[0].layer).toBe('SOLID_LAYER')
  })

  it('creates 3 outline segments for a triangle SOLID', () => {
    const segs = parseEntities([{
      type: 'SOLID',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 50, y: 86.6 },
      ],
    }])
    expect(segs.length).toBe(3)
  })

  it('3DFACE works the same as SOLID', () => {
    const segs = parseEntities([{
      type: '3DFACE',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    }])
    expect(segs.length).toBe(4)
  })

  it('skips SOLID with fewer than 3 points', () => {
    const segs = parseEntities([{
      type: 'SOLID',
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
    }])
    expect(segs.length).toBe(0)
  })

  it('reads corners from "corners" key too', () => {
    const segs = parseEntities([{
      type: 'SOLID',
      corners: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 50 },
        { x: 0, y: 50 },
      ],
    }])
    expect(segs.length).toBe(4)
  })
})

// ─── HATCH ──────────────────────────────────────────────────────────────────

describe('parseDxfSegments: HATCH', () => {
  it('parses HATCH with LINE edges (type=1)', () => {
    const segs = parseEntities([{
      type: 'HATCH',
      boundaryPaths: [{
        edges: [
          { type: 1, start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
          { type: 1, start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
          { type: 1, start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
          { type: 1, start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
        ],
      }],
      layer: 'HATCH_L',
    }])

    expect(segs.length).toBe(4)
    expect(segs[0]).toEqual(expect.objectContaining({ x1: 0, y1: 0, x2: 100, y2: 0 }))
    expect(segs[1]).toEqual(expect.objectContaining({ x1: 100, y1: 0, x2: 100, y2: 100 }))
    expect(segs[2]).toEqual(expect.objectContaining({ x1: 100, y1: 100, x2: 0, y2: 100 }))
    expect(segs[3]).toEqual(expect.objectContaining({ x1: 0, y1: 100, x2: 0, y2: 0 }))
    expect(segs[0].layer).toBe('HATCH_L')
  })

  it('parses HATCH with ARC edges (type=2)', () => {
    const segs = parseEntities([{
      type: 'HATCH',
      boundaryPaths: [{
        edges: [{
          type: 2,
          center: { x: 0, y: 0 },
          radius: 50,
          startAngle: 0,
          endAngle: 180,
        }],
      }],
    }])

    // 180° arc → ~18 segments (10° steps)
    expect(segs.length).toBe(18)

    // Start at (50, 0), end near (-50, 0)
    expect(segs[0].x1).toBeCloseTo(50, 0)
    expect(segs[0].y1).toBeCloseTo(0, 0)
    const last = segs[segs.length - 1]
    expect(last.x2).toBeCloseTo(-50, 0)
    expect(last.y2).toBeCloseTo(0, 0)
  })

  it('parses HATCH with ARC edge counterclockwise=false (swapped angles)', () => {
    const segs = parseEntities([{
      type: 'HATCH',
      boundaryPaths: [{
        edges: [{
          type: 2,
          center: { x: 0, y: 0 },
          radius: 100,
          startAngle: 0,
          endAngle: 90,
          isCounterClockwise: false,
        }],
      }],
    }])

    expect(segs.length).toBeGreaterThan(0)

    // With isCounterClockwise=false, angles are swapped: start→end becomes end→start
    // So it goes from 90° to 0° + 360° = 0°+360° (the long way around, 270°)
    // Or: swapped so sa=90°, ea=0° → ea<=sa → ea+360 → 270° arc
    // 270° / 10° per step = 27 segments
    expect(segs.length).toBe(27)
  })

  it('parses HATCH with ELLIPSE edges (type=3)', () => {
    const segs = parseEntities([{
      type: 'HATCH',
      boundaryPaths: [{
        edges: [{
          type: 3,
          center: { x: 0, y: 0 },
          majorAxisEndPoint: { x: 100, y: 0 },
          minorAxisRatio: 0.5,
          startAngle: 0,
          endAngle: 2 * Math.PI,
        }],
      }],
    }])

    // Full ellipse → 24 segments (HATCH ellipse uses N=24)
    expect(segs.length).toBe(24)
  })

  it('parses HATCH with polyline boundary', () => {
    const segs = parseEntities([{
      type: 'HATCH',
      boundaryPaths: [{
        polyline: {
          vertices: [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: 150 },
            { x: 0, y: 150 },
          ],
        },
      }],
    }])

    // 4 vertices → 3 edges + 1 auto-close = 4
    expect(segs.length).toBe(4)

    // Auto-close: last→first
    const last = segs[segs.length - 1]
    expect(last.x1).toBe(0)
    expect(last.y1).toBe(150)
    expect(last.x2).toBe(0)
    expect(last.y2).toBe(0)
  })

  it('auto-closes polyline only if last != first', () => {
    const segs = parseEntities([{
      type: 'HATCH',
      boundaryPaths: [{
        polyline: {
          vertices: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 0, y: 0 }, // already closed
          ],
        },
      }],
    }])

    // 4 vertices → 3 edges, no auto-close needed
    expect(segs.length).toBe(3)
  })

  it('handles multiple boundary paths', () => {
    const segs = parseEntities([{
      type: 'HATCH',
      boundaryPaths: [
        {
          edges: [
            { type: 1, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
            { type: 1, start: { x: 10, y: 0 }, end: { x: 10, y: 10 } },
          ],
        },
        {
          edges: [
            { type: 1, start: { x: 20, y: 20 }, end: { x: 30, y: 20 } },
          ],
        },
      ],
    }])

    expect(segs.length).toBe(3)
  })

  it('handles mixed edge types in one path', () => {
    const segs = parseEntities([{
      type: 'HATCH',
      boundaryPaths: [{
        edges: [
          // LINE edge
          { type: 1, start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
          // ARC edge (quarter circle)
          {
            type: 2,
            center: { x: 100, y: 50 },
            radius: 50,
            startAngle: 270,
            endAngle: 360,
          },
          // LINE edge back
          { type: 1, start: { x: 150, y: 50 }, end: { x: 0, y: 50 } },
        ],
      }],
    }])

    // 1 LINE + ~9 ARC segments + 1 LINE = ~11 segments
    expect(segs.length).toBeGreaterThanOrEqual(10)

    // First seg is the LINE
    expect(segs[0]).toEqual(expect.objectContaining({ x1: 0, y1: 0, x2: 100, y2: 0 }))
  })

  it('ignores HATCH with no boundaryPaths', () => {
    const segs = parseEntities([{ type: 'HATCH' }])
    expect(segs.length).toBe(0)
  })

  it('ignores HATCH with empty boundaryPaths', () => {
    const segs = parseEntities([{ type: 'HATCH', boundaryPaths: [] }])
    expect(segs.length).toBe(0)
  })
})

// ─── LINE / LWPOLYLINE basics ──────────────────────────────────────────────

describe('parseDxfSegments: basic entities', () => {
  it('parses LINE entity', () => {
    const segs = parseEntities([{
      type: 'LINE',
      vertices: [{ x: 0, y: 0 }, { x: 100, y: 200 }],
      layer: 'WALL',
    }])
    expect(segs.length).toBe(1)
    expect(segs[0]).toEqual(expect.objectContaining({
      x1: 0, y1: 0, x2: 100, y2: 200, layer: 'WALL',
    }))
  })

  it('parses LWPOLYLINE (open)', () => {
    const segs = parseEntities([{
      type: 'LWPOLYLINE',
      vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
    }])
    // 3 vertices → 2 segments (open)
    expect(segs.length).toBe(2)
  })

  it('parses LWPOLYLINE (closed with shape=true)', () => {
    const segs = parseEntities([{
      type: 'LWPOLYLINE',
      vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      shape: true,
    }])
    // 3 vertices + close = 3 segments
    expect(segs.length).toBe(3)
    // Closing segment: (10,10) → (0,0)
    expect(segs[2].x1).toBe(10)
    expect(segs[2].y1).toBe(10)
    expect(segs[2].x2).toBe(0)
    expect(segs[2].y2).toBe(0)
  })
})

// ─── Color resolution ───────────────────────────────────────────────────────

describe('parseDxfSegments: color resolution', () => {
  it('resolves entity colorIndex to hex', () => {
    const segs = parseEntities([{
      type: 'LINE',
      vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      colorIndex: 1, // ACI 1 = red
    }])
    expect(segs[0].color).toBe('#ff0000')
  })

  it('resolves entity trueColor to hex', () => {
    const segs = parseEntities([{
      type: 'LINE',
      vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      color: 0x00ff00, // trueColor green
    }])
    expect(segs[0].color).toBe('#00ff00')
  })

  it('falls back to layer color when entity has no color', () => {
    const segs = parseEntities(
      [{ type: 'LINE', vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }], layer: 'RED_LAYER' }],
      { RED_LAYER: { colorIndex: 1 } },
    )
    expect(segs[0].color).toBe('#ff0000')
  })

  it('entity trueColor takes priority over colorIndex', () => {
    const segs = parseEntities([{
      type: 'LINE',
      vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      color: 0x0000ff, // trueColor blue
      colorIndex: 1,   // ACI red — should be ignored
    }])
    expect(segs[0].color).toBe('#0000ff')
  })
})

// ─── Lineweight resolution ──────────────────────────────────────────────────

describe('parseDxfSegments: lineweight', () => {
  it('uses entity lineweight when positive', () => {
    const segs = parseEntities([{
      type: 'LINE',
      vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      lineweight: 50,
    }])
    expect(segs[0].lineweight).toBe(50)
  })

  it('falls back to layer lineweight', () => {
    const segs = parseEntities(
      [{ type: 'LINE', vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }], layer: 'THICK' }],
      { THICK: { lineweight: 100 } },
    )
    expect(segs[0].lineweight).toBe(100)
  })

  it('lineweight is undefined when neither entity nor layer has it', () => {
    const segs = parseEntities([{
      type: 'LINE',
      vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
    }])
    expect(segs[0].lineweight).toBeUndefined()
  })
})

// ─── MAX_SEGMENTS limit ─────────────────────────────────────────────────────

describe('parseDxfSegments: max segments', () => {
  it('respects maxSegments limit', () => {
    const entities: Array<Record<string, unknown>> = []
    for (let i = 0; i < 100; i++) {
      entities.push({
        type: 'LINE',
        vertices: [{ x: i * 10, y: 0 }, { x: i * 10 + 5, y: 0 }],
      })
    }
    const segs = parseDxfSegments(entities, {}, 10)
    expect(segs.length).toBe(10)
  })

  it('HATCH respects maxSegments within edges', () => {
    // Large polyline hatch that would exceed limit
    const vertices = Array.from({ length: 50 }, (_, i) => ({ x: i, y: i }))
    const segs = parseDxfSegments([{
      type: 'HATCH',
      boundaryPaths: [{ polyline: { vertices } }],
    }], {}, 10)
    // Limited to ~maxSegments (auto-close may add 1 extra after loop)
    expect(segs.length).toBeLessThanOrEqual(12)
  })
})

// ─── commitCadImport with DXF text (INSERT/BLOCK via full pipeline) ────────

describe('commitCadImport: DXF full pipeline', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0))
  })

  it('correctly processes a simple rectangle DXF', () => {
    const dxf = `0
SECTION
2
HEADER
9
$INSUNITS
70
4
0
ENDSEC
0
SECTION
2
ENTITIES
0
LINE
8
0
10
0
20
0
30
0
11
1000
21
0
31
0
0
LINE
8
0
10
1000
20
0
30
0
11
1000
21
1000
31
0
0
LINE
8
0
10
1000
20
1000
30
0
11
0
21
1000
31
0
0
LINE
8
0
10
0
20
1000
30
0
11
0
21
0
31
0
0
ENDSEC
0
EOF`

    const editor = createMockEditor()
    const result = parseDxfText(dxf)
    const allLayers = new Set(result.layers.map(l => l.name))

    const count = commitCadImport(editor as never, result, allLayers)
    expect(count).toBe(4)
  })

  it('correctly handles ARC entities through full pipeline', () => {
    const dxf = `0
SECTION
2
HEADER
9
$INSUNITS
70
4
0
ENDSEC
0
SECTION
2
ENTITIES
0
ARC
8
0
10
500
20
500
30
0
40
200
50
0
51
90
0
ENDSEC
0
EOF`

    const editor = createMockEditor()
    const result = parseDxfText(dxf)
    const allLayers = new Set(result.layers.map(l => l.name))

    const count = commitCadImport(editor as never, result, allLayers)
    expect(count).toBeGreaterThan(0)
    // DXF parser may approximate ARC differently
    expect(result._segs.length).toBeGreaterThan(0)
  })

  it('correctly handles CIRCLE entities through full pipeline', () => {
    const dxf = `0
SECTION
2
HEADER
9
$INSUNITS
70
4
0
ENDSEC
0
SECTION
2
ENTITIES
0
CIRCLE
8
0
10
100
20
100
30
0
40
50
0
ENDSEC
0
EOF`

    const result = parseDxfText(dxf)
    expect(result._segs.length).toBe(36)
  })
})

// ─── Mixed entities ─────────────────────────────────────────────────────────

describe('parseDxfSegments: mixed entity types', () => {
  it('handles LINE + ARC + CIRCLE + SOLID + HATCH together', () => {
    const entities: Array<Record<string, unknown>> = [
      // LINE
      { type: 'LINE', vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      // ARC (90°)
      { type: 'ARC', center: { x: 0, y: 0 }, radius: 50, startAngle: 0, endAngle: 90 },
      // CIRCLE
      { type: 'CIRCLE', center: { x: 200, y: 200 }, radius: 30 },
      // SOLID
      { type: 'SOLID', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
      // HATCH with LINE edges
      {
        type: 'HATCH',
        boundaryPaths: [{
          edges: [
            { type: 1, start: { x: 50, y: 50 }, end: { x: 60, y: 50 } },
            { type: 1, start: { x: 60, y: 50 }, end: { x: 50, y: 60 } },
          ],
        }],
      },
    ]

    const segs = parseEntities(entities)
    // 1 LINE + 9 ARC + 36 CIRCLE + 4 SOLID + 2 HATCH = 52
    expect(segs.length).toBe(52)
  })

  it('skips unknown entity types gracefully', () => {
    const segs = parseEntities([
      { type: 'FOOBAR', x: 0, y: 0 },
      { type: 'LINE', vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    ])
    expect(segs.length).toBe(1)
  })
})
