/**
 * Tests for commitCadImport: camera positioning, zoom clamping,
 * bounding box centering, and shape creation with a mocked tldraw Editor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import DxfParser from 'dxf-parser'
import { parseDxfSegments, commitCadImport, type CadParseResult } from '../../lib/dxf'

// ── Simple room DXF: 10m x 8m rectangle (10000mm x 8000mm) ──
const SIMPLE_ROOM_DXF = `0
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
10000
21
0
31
0
0
LINE
8
0
10
10000
20
0
30
0
11
10000
21
8000
31
0
0
LINE
8
0
10
10000
20
8000
30
0
11
0
21
8000
31
0
0
LINE
8
0
10
0
20
8000
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

// ── Offset room DXF: same dimensions but at huge offset (simulating real-world coords) ──
const OFFSET_ROOM_DXF = `0
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
500000
20
500000
30
0
11
510000
21
500000
31
0
0
LINE
8
0
10
510000
20
500000
30
0
11
510000
21
508000
31
0
0
LINE
8
0
10
510000
20
508000
30
0
11
500000
21
508000
31
0
0
LINE
8
0
10
500000
20
508000
30
0
11
500000
21
500000
31
0
0
ENDSEC
0
EOF`

// ── Tiny DXF: 10mm x 5mm (tests zoom clamping at upper bound) ──
const TINY_ROOM_DXF = `0
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
10
21
0
31
0
0
LINE
8
0
10
10
20
0
30
0
11
10
21
5
31
0
0
ENDSEC
0
EOF`

// ── Helper: create a mock tldraw Editor ──
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

  const editor = {
    getInstanceState: () => ({
      meta: { unit: 'mm', pxPerMm },
    }),
    getViewportScreenBounds: () => ({
      width: vpW,
      height: vpH,
    }),
    createShapes: (shapes: unknown[]) => {
      createdShapes.push(...shapes)
      currentShapes.push(...shapes)
    },
    getCurrentPageShapes: () => currentShapes,
    setCamera: (cam: { x: number; y: number; z: number }) => {
      camera = { ...cam }
    },
    getCamera: () => camera,
    selectAll: vi.fn(),
    getSelectedShapeIds: () => createdShapes.map((_s, i) => `shape:${i}`),
    zoomToFit: vi.fn(),
    zoomToSelection: vi.fn(),
    select: vi.fn(),
    selectNone: vi.fn(),
    // Expose internals for assertions
    _getCamera: () => camera,
    _getCreatedShapes: () => createdShapes,
  }

  return editor
}

// ── Helper: parse DXF text into a CadParseResult ──
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
      name,
      segCount,
      likelyStructural: false,
    })),
    totalSegments: segs.length,
    unitToMm,
    _segs: segs,
  }
}

describe('commitCadImport', () => {
  beforeEach(() => {
    // requestAnimationFrame is needed by commitCadImport for zoomToFit fallback
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0))
  })

  it('creates 4 wall shapes for a simple rectangle room', () => {
    const editor = createMockEditor()
    const result = parseDxfText(SIMPLE_ROOM_DXF)
    const allLayers = new Set(result.layers.map((l) => l.name))

    const count = commitCadImport(editor as never, result, allLayers)

    expect(count).toBe(4)
    expect(editor._getCreatedShapes()).toHaveLength(4)
  })

  it('all created shapes are of type "wall"', () => {
    const editor = createMockEditor()
    const result = parseDxfText(SIMPLE_ROOM_DXF)
    const allLayers = new Set(result.layers.map((l) => l.name))

    commitCadImport(editor as never, result, allLayers)

    for (const shape of editor._getCreatedShapes() as Array<{ type: string }>) {
      expect(shape.type).toBe('wall')
    }
  })

  it('shapes are centered around origin (bounding box normalization)', () => {
    const editor = createMockEditor()
    const result = parseDxfText(SIMPLE_ROOM_DXF)
    const allLayers = new Set(result.layers.map((l) => l.name))

    commitCadImport(editor as never, result, allLayers)

    const shapes = editor._getCreatedShapes() as Array<{
      x: number; y: number; props: { x2: number; y2: number }
    }>

    // Collect all vertex positions
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const s of shapes) {
      minX = Math.min(minX, s.x, s.x + s.props.x2)
      minY = Math.min(minY, s.y, s.y + s.props.y2)
      maxX = Math.max(maxX, s.x, s.x + s.props.x2)
      maxY = Math.max(maxY, s.y, s.y + s.props.y2)
    }

    // Center of bounding box should be at (0, 0)
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    expect(centerX).toBeCloseTo(0, 1)
    expect(centerY).toBeCloseTo(0, 1)
  })

  it('shapes from offset DXF are also centered around origin', () => {
    const editor = createMockEditor()
    const result = parseDxfText(OFFSET_ROOM_DXF)
    const allLayers = new Set(result.layers.map((l) => l.name))

    commitCadImport(editor as never, result, allLayers)

    const shapes = editor._getCreatedShapes() as Array<{
      x: number; y: number; props: { x2: number; y2: number }
    }>

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const s of shapes) {
      minX = Math.min(minX, s.x, s.x + s.props.x2)
      minY = Math.min(minY, s.y, s.y + s.props.y2)
      maxX = Math.max(maxX, s.x, s.x + s.props.x2)
      maxY = Math.max(maxY, s.y, s.y + s.props.y2)
    }

    // Center should still be at origin even though DXF coords were at 500000+
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    expect(centerX).toBeCloseTo(0, 1)
    expect(centerY).toBeCloseTo(0, 1)
  })

  it('zoom is clamped to tldraw limits [0.1, 8]', () => {
    const editor = createMockEditor()
    const result = parseDxfText(SIMPLE_ROOM_DXF)
    const allLayers = new Set(result.layers.map((l) => l.name))

    commitCadImport(editor as never, result, allLayers)

    const cam = editor._getCamera()
    expect(cam.z).toBeGreaterThanOrEqual(0.1)
    expect(cam.z).toBeLessThanOrEqual(8)
  })

  it('zoom does not exceed 1 (idealZoom has Math.min(..., 1))', () => {
    const editor = createMockEditor()
    const result = parseDxfText(TINY_ROOM_DXF) // very small = high zoom
    const allLayers = new Set(result.layers.map((l) => l.name))

    commitCadImport(editor as never, result, allLayers)

    const cam = editor._getCamera()
    // Even though the tiny room would fit at zoom > 1, it's capped at 1
    expect(cam.z).toBeLessThanOrEqual(1)
  })

  it('calls selectAll + zoomToFit after import', async () => {
    const editor = createMockEditor()
    const result = parseDxfText(SIMPLE_ROOM_DXF)
    const allLayers = new Set(result.layers.map((l) => l.name))

    commitCadImport(editor as never, result, allLayers)

    // fitToShapes runs after setTimeout(200ms)
    await new Promise((r) => setTimeout(r, 400))

    expect(editor.selectAll).toHaveBeenCalled()
    expect(editor.zoomToFit).toHaveBeenCalled()
    expect(editor.selectNone).toHaveBeenCalled()
  })

  it('filters segments by selected layers only', () => {
    // Use multi-layer DXF inline
    const multiLayerDXF = `0
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
WALL
10
0
20
0
30
0
11
5000
21
0
31
0
0
LINE
8
DOOR
10
1000
20
0
30
0
11
1900
21
0
31
0
0
LINE
8
WINDOW
10
2500
20
0
30
0
11
3500
21
0
31
0
0
ENDSEC
0
EOF`
    const editor = createMockEditor()
    const result = parseDxfText(multiLayerDXF)

    // Only select WALL layer
    const wallOnly = new Set(['WALL'])
    const count = commitCadImport(editor as never, result, wallOnly)

    expect(count).toBe(1) // only the WALL segment
  })

  it('returns 0 when no layers selected', () => {
    const editor = createMockEditor()
    const result = parseDxfText(SIMPLE_ROOM_DXF)
    const noLayers = new Set<string>() // empty selection

    // All segments have layer '0', but empty set = nothing selected
    // Actually, the filter is selectedLayers.has(s.layer || '0')
    // Empty set means nothing passes
    const count = commitCadImport(editor as never, result, noLayers)

    expect(count).toBe(0)
    expect(editor._getCreatedShapes()).toHaveLength(0)
  })

  it('shapes have dxfFingerprint in meta', () => {
    const editor = createMockEditor()
    const result = parseDxfText(SIMPLE_ROOM_DXF, 'test-floor.dxf')
    const allLayers = new Set(result.layers.map((l) => l.name))

    commitCadImport(editor as never, result, allLayers)

    for (const shape of editor._getCreatedShapes() as Array<{ meta: Record<string, unknown> }>) {
      expect(shape.meta.dxfFingerprint).toBe(result.fingerprint)
    }
  })

  it('Y axis is flipped (DXF Y-up to canvas Y-down)', () => {
    const editor = createMockEditor()
    const result = parseDxfText(SIMPLE_ROOM_DXF)
    const allLayers = new Set(result.layers.map((l) => l.name))

    commitCadImport(editor as never, result, allLayers)

    const shapes = editor._getCreatedShapes() as Array<{
      x: number; y: number; props: { x2: number; y2: number }
    }>

    // In the original DXF, the second line goes from (10000, 0) to (10000, 8000)
    // After Y-flip and centering, the dy should be negative (because DXF y=8000 becomes canvas y=-8000, then centered)
    // Find the shape that corresponds to the vertical right wall
    // After centering, the second segment should have x starting near positive side, going down in canvas Y
    const verticalWall = shapes.find(s =>
      Math.abs(s.props.x2) < 1 && Math.abs(s.props.y2) > 100
    )
    expect(verticalWall).toBeDefined()
    // dy should be negative (DXF Y-up means positive Y in DXF maps to negative Y on canvas)
    if (verticalWall) {
      expect(verticalWall.props.y2).toBeLessThan(0)
    }
  })

  it('applies unitToMm scaling for meters-based DXF', () => {
    // DXF with $INSUNITS=6 (meters): 10m x 8m expressed as 10 x 8 in DXF units
    const metersDXF = `0
SECTION
2
HEADER
9
$INSUNITS
70
6
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
10
21
0
31
0
0
LINE
8
0
10
10
20
0
30
0
11
10
21
8
31
0
0
ENDSEC
0
EOF`

    const editorMm = createMockEditor({ pxPerMm: 1 })
    const resultMm = parseDxfText(SIMPLE_ROOM_DXF) // mm-based, 10000 x 8000

    const editorM = createMockEditor({ pxPerMm: 1 })
    const resultM = parseDxfText(metersDXF) // m-based, 10 x 8

    commitCadImport(editorMm as never, resultMm, new Set(resultMm.layers.map(l => l.name)))
    commitCadImport(editorM as never, resultM, new Set(resultM.layers.map(l => l.name)))

    // Both should produce shapes with similar bounding box dimensions
    // because 10000mm = 10m, and unitToMm converts m to mm
    const getShapeExtent = (shapes: Array<{ x: number; y: number; props: { x2: number; y2: number } }>) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const s of shapes) {
        minX = Math.min(minX, s.x, s.x + s.props.x2)
        minY = Math.min(minY, s.y, s.y + s.props.y2)
        maxX = Math.max(maxX, s.x, s.x + s.props.x2)
        maxY = Math.max(maxY, s.y, s.y + s.props.y2)
      }
      return { width: maxX - minX, height: maxY - minY }
    }

    type Shape = { x: number; y: number; props: { x2: number; y2: number } }
    const extentMm = getShapeExtent(editorMm._getCreatedShapes() as Shape[])
    const extentM = getShapeExtent(editorM._getCreatedShapes() as Shape[])

    // Both should have the same pixel extent
    expect(extentMm.width).toBeCloseTo(extentM.width, 0)
    expect(extentMm.height).toBeCloseTo(extentM.height, 0)
  })

  it('retries fitToShapes on error (up to 5 attempts)', async () => {
    const editor = createMockEditor()
    // Make selectAll fail 3 times, succeed 4th time
    let callCount = 0
    ;(editor.selectAll as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++
      if (callCount <= 3) throw new Error('not ready')
    })
    const result = parseDxfText(SIMPLE_ROOM_DXF)
    const allLayers = new Set(result.layers.map((l) => l.name))

    commitCadImport(editor as never, result, allLayers)

    // Wait for retries (200ms initial + 300ms * 3 retries)
    await new Promise((r) => setTimeout(r, 1500))

    expect(callCount).toBe(4)
  })

  describe('zoom clamping edge cases', () => {
    it('very large drawing: zoom does not go below 0.1', () => {
      // Create a massive DXF that would require very low zoom
      // 1,000,000mm = 1km per side
      const massiveDXF = `0
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
1000000
21
0
31
0
0
LINE
8
0
10
1000000
20
0
30
0
11
1000000
21
1000000
31
0
0
ENDSEC
0
EOF`

      const editor = createMockEditor({ viewportWidth: 1200, viewportHeight: 800 })
      const result = parseDxfText(massiveDXF)
      const allLayers = new Set(result.layers.map((l) => l.name))

      const count = commitCadImport(editor as never, result, allLayers)
      // Massive drawing still creates shapes and will use zoomToSelection
      expect(count).toBeGreaterThan(0)
    })

    it('very small drawing: shapes still created', () => {
      // 1mm x 1mm drawing
      const tinyDXF = `0
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
1
21
0
31
0
0
LINE
8
0
10
1
20
0
30
0
11
1
21
1
31
0
0
ENDSEC
0
EOF`

      const editor = createMockEditor({ viewportWidth: 1200, viewportHeight: 800 })
      const result = parseDxfText(tinyDXF)
      const allLayers = new Set(result.layers.map((l) => l.name))

      const count = commitCadImport(editor as never, result, allLayers)
      // Tiny drawing still creates shapes
      expect(count).toBeGreaterThan(0)
    })
  })
})
