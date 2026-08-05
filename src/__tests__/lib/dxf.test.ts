import { describe, it, expect } from 'vitest'
import DxfParser from 'dxf-parser'
import { dxfFingerprint, parseDxfSegments, type CadLayerInfo } from '../../lib/dxf'

// ── untitled.dxf 원본 내용 (Downloads에서 복사) ──
const UNTITLED_DXF = `0
SECTION
2
HEADER
9
$ACADVER
1
AC1009
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
257.492
20
-73.980
30
0.0
11
1125.012
21
-63.332
31
0.0
0
LINE
8
WALL
10
1125.012
20
-63.332
30
0.0
11
1124.855
21
-98.273
31
0.0
0
LINE
8
WALL
10
1124.855
20
-98.273
30
0.0
11
1115.152
21
-633.160
31
0.0
0
LINE
8
WALL
10
1115.152
20
-633.160
30
0.0
11
238.078
21
-631.711
31
0.0
0
LINE
8
WALL
10
238.078
20
-631.711
30
0.0
11
237.016
21
-92.723
31
0.0
0
LINE
8
WALL
10
237.016
20
-92.723
30
0.0
11
286.977
21
-116.324
31
0.0
0
LINE
8
WALL
10
286.977
20
-116.324
30
0.0
11
2.363
21
-47.910
31
0.0
0
ENDSEC
0
EOF`

// ── 멀티 레이어 DXF (WALL + DOOR + WINDOW) ──
const MULTI_LAYER_DXF = `0
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
0.0
20
0.0
30
0.0
11
5000.0
21
0.0
31
0.0
0
LINE
8
WALL
10
5000.0
20
0.0
30
0.0
11
5000.0
21
3000.0
31
0.0
0
LINE
8
DOOR
10
1000.0
20
0.0
30
0.0
11
1900.0
21
0.0
31
0.0
0
LINE
8
WINDOW
10
2500.0
20
0.0
30
0.0
11
3500.0
21
0.0
31
0.0
0
LINE
8
DIMENSION
10
0.0
20
-200.0
30
0.0
11
5000.0
21
-200.0
31
0.0
0
ENDSEC
0
EOF`

// ── LWPOLYLINE 포함 DXF ──
const POLYLINE_DXF = `0
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
LWPOLYLINE
8
OUTLINE
70
0
90
3
10
0.0
20
0.0
10
10.0
20
0.0
10
10.0
20
5.0
0
ENDSEC
0
EOF`

describe('dxfFingerprint', () => {
  it('returns consistent fingerprint', () => {
    expect(dxfFingerprint('test.dxf', 1234, 7)).toBe('dxf:test.dxf:1234:7')
  })

  it('different inputs produce different fingerprints', () => {
    const a = dxfFingerprint('a.dxf', 100, 5)
    const b = dxfFingerprint('b.dxf', 100, 5)
    expect(a).not.toBe(b)
  })
})

describe('parseDxfSegments', () => {
  it('parses untitled.dxf: 7 LINE segments on WALL layer', () => {
    const dxf = new DxfParser().parseSync(UNTITLED_DXF)
    expect(dxf).not.toBeNull()
    const entities = dxf!.entities as unknown as Array<Record<string, unknown>>
    const segs = parseDxfSegments(entities, {})

    expect(segs).toHaveLength(7)
    // 모든 세그먼트가 WALL 레이어
    for (const seg of segs) {
      expect(seg.layer).toBe('WALL')
    }
  })

  it('first segment coordinates match', () => {
    const dxf = new DxfParser().parseSync(UNTITLED_DXF)!
    const segs = parseDxfSegments(dxf.entities as unknown as Array<Record<string, unknown>>, {})

    expect(segs[0].x1).toBeCloseTo(257.492, 2)
    expect(segs[0].y1).toBeCloseTo(-73.98, 2)
    expect(segs[0].x2).toBeCloseTo(1125.012, 2)
    expect(segs[0].y2).toBeCloseTo(-63.332, 2)
  })

  it('parses multi-layer DXF: 5 segments across 4 layers', () => {
    const dxf = new DxfParser().parseSync(MULTI_LAYER_DXF)!
    const segs = parseDxfSegments(dxf.entities as unknown as Array<Record<string, unknown>>, {})

    expect(segs).toHaveLength(5)

    const layers = new Set(segs.map(s => s.layer))
    expect(layers).toContain('WALL')
    expect(layers).toContain('DOOR')
    expect(layers).toContain('WINDOW')
    expect(layers).toContain('DIMENSION')

    // WALL 2개, 나머지 각 1개
    const wallSegs = segs.filter(s => s.layer === 'WALL')
    expect(wallSegs).toHaveLength(2)
    expect(segs.filter(s => s.layer === 'DOOR')).toHaveLength(1)
    expect(segs.filter(s => s.layer === 'WINDOW')).toHaveLength(1)
    expect(segs.filter(s => s.layer === 'DIMENSION')).toHaveLength(1)
  })

  it('applies layer color from layerDefs', () => {
    const dxf = new DxfParser().parseSync(MULTI_LAYER_DXF)!
    const layerDefs = {
      WALL: { colorIndex: 7 },   // white
      DOOR: { colorIndex: 3 },   // green
      WINDOW: { colorIndex: 4 }, // cyan
    }
    const segs = parseDxfSegments(
      dxf.entities as unknown as Array<Record<string, unknown>>,
      layerDefs,
    )

    const wallSeg = segs.find(s => s.layer === 'WALL')
    const doorSeg = segs.find(s => s.layer === 'DOOR')
    const windowSeg = segs.find(s => s.layer === 'WINDOW')

    // ACI 7 = #ffffff, 3 = #00ff00, 4 = #00ffff
    expect(wallSeg?.color).toBe('#ffffff')
    expect(doorSeg?.color).toBe('#00ff00')
    expect(windowSeg?.color).toBe('#00ffff')
  })

  it('applies layer lineweight from layerDefs', () => {
    const dxf = new DxfParser().parseSync(MULTI_LAYER_DXF)!
    const layerDefs = {
      WALL: { lineweight: 50 }, // 0.50mm
    }
    const segs = parseDxfSegments(
      dxf.entities as unknown as Array<Record<string, unknown>>,
      layerDefs,
    )

    const wallSegs = segs.filter(s => s.layer === 'WALL')
    for (const seg of wallSegs) {
      expect(seg.lineweight).toBe(50)
    }
    // DOOR/WINDOW have no lineweight defined
    expect(segs.find(s => s.layer === 'DOOR')?.lineweight).toBeUndefined()
  })

  it('parses LWPOLYLINE into multiple segments', () => {
    const dxf = new DxfParser().parseSync(POLYLINE_DXF)!
    const segs = parseDxfSegments(dxf.entities as unknown as Array<Record<string, unknown>>, {})

    // 3 vertices → 2 segments (not closed)
    expect(segs).toHaveLength(2)
    expect(segs[0].layer).toBe('OUTLINE')
    expect(segs[0].x1).toBeCloseTo(0)
    expect(segs[0].x2).toBeCloseTo(10)
    expect(segs[1].x1).toBeCloseTo(10)
    expect(segs[1].y2).toBeCloseTo(5)
  })

  it('respects maxSegments limit', () => {
    const dxf = new DxfParser().parseSync(UNTITLED_DXF)!
    const segs = parseDxfSegments(
      dxf.entities as unknown as Array<Record<string, unknown>>,
      {},
      3, // max 3
    )

    expect(segs).toHaveLength(3)
  })

  it('handles empty entity list', () => {
    const segs = parseDxfSegments([], {})
    expect(segs).toHaveLength(0)
  })

  it('skips unsupported entity types', () => {
    const entities = [
      { type: 'CIRCLE', layer: 'MISC', vertices: [{ x: 0, y: 0 }] },
      { type: 'ARC', layer: 'MISC' },
    ] as unknown as Array<Record<string, unknown>>
    const segs = parseDxfSegments(entities, {})
    expect(segs).toHaveLength(0)
  })
})

describe('DxfParser compatibility', () => {
  it('parses $INSUNITS=4 (mm)', () => {
    const dxf = new DxfParser().parseSync(UNTITLED_DXF)!
    expect(dxf.header?.['$INSUNITS']).toBe(4)
  })

  it('parses $INSUNITS=6 (m)', () => {
    const dxf = new DxfParser().parseSync(POLYLINE_DXF)!
    expect(dxf.header?.['$INSUNITS']).toBe(6)
  })

  it('entities have correct type and layer', () => {
    const dxf = new DxfParser().parseSync(MULTI_LAYER_DXF)!
    expect(dxf.entities).toHaveLength(5)
    expect(dxf.entities[0].type).toBe('LINE')
    expect((dxf.entities[0] as unknown as Record<string, unknown>).layer).toBe('WALL')
    expect((dxf.entities[2] as unknown as Record<string, unknown>).layer).toBe('DOOR')
    expect((dxf.entities[3] as unknown as Record<string, unknown>).layer).toBe('WINDOW')
  })

  it('LINE entities have vertices array with 2 points', () => {
    const dxf = new DxfParser().parseSync(UNTITLED_DXF)!
    for (const e of dxf.entities) {
      const ent = e as unknown as { vertices: Array<{ x: number; y: number }> }
      expect(ent.vertices).toHaveLength(2)
      expect(typeof ent.vertices[0].x).toBe('number')
      expect(typeof ent.vertices[0].y).toBe('number')
    }
  })
})

describe('STRUCTURAL_KEYWORDS matching', () => {
  // 내부 정규식 테스트를 위해 동일 패턴 사용
  const STRUCTURAL_KEYWORDS = /wall|window|win(?!ter)|door|stair|column|beam|slab|elev|건축|벽|창문|문/i

  it('matches wall-related layers', () => {
    expect(STRUCTURAL_KEYWORDS.test('E-WALL-1')).toBe(true)
    expect(STRUCTURAL_KEYWORDS.test('CO-WALL')).toBe(true)
    expect(STRUCTURAL_KEYWORDS.test('F_WALL')).toBe(true)
    expect(STRUCTURAL_KEYWORDS.test('WALL')).toBe(true)
  })

  it('matches window layers', () => {
    expect(STRUCTURAL_KEYWORDS.test('E-WIN')).toBe(true)
    expect(STRUCTURAL_KEYWORDS.test('CO-WIN')).toBe(true)
    expect(STRUCTURAL_KEYWORDS.test('WINDOW')).toBe(true)
  })

  it('matches door layers', () => {
    expect(STRUCTURAL_KEYWORDS.test('C-DOOR')).toBe(true)
    expect(STRUCTURAL_KEYWORDS.test('E-DOOR')).toBe(true)
    expect(STRUCTURAL_KEYWORDS.test('F-DOOR')).toBe(true)
  })

  it('does NOT match furniture/text/dimension layers', () => {
    expect(STRUCTURAL_KEYWORDS.test('E-FUR-k')).toBe(false)
    expect(STRUCTURAL_KEYWORDS.test('E-FUR-1')).toBe(false)
    expect(STRUCTURAL_KEYWORDS.test('F-TEXT')).toBe(false)
    expect(STRUCTURAL_KEYWORDS.test('C-DIM')).toBe(false)
    expect(STRUCTURAL_KEYWORDS.test('DEFPOINTS')).toBe(false)
    expect(STRUCTURAL_KEYWORDS.test('TB-FORM')).toBe(false)
    expect(STRUCTURAL_KEYWORDS.test('E-HAT')).toBe(false)
    expect(STRUCTURAL_KEYWORDS.test('F-SYM')).toBe(false)
    expect(STRUCTURAL_KEYWORDS.test('C-LIGHT')).toBe(false)
  })

  it('does NOT match D-STONE, D-STEEL (was matching via "str")', () => {
    expect(STRUCTURAL_KEYWORDS.test('D-STONE')).toBe(false)
    expect(STRUCTURAL_KEYWORDS.test('D-STEEL')).toBe(false)
  })

  it('matches stair/column/beam/slab layers', () => {
    expect(STRUCTURAL_KEYWORDS.test('F-STAIR')).toBe(true)
    expect(STRUCTURAL_KEYWORDS.test('S-COLUMN')).toBe(true)
    expect(STRUCTURAL_KEYWORDS.test('S-BEAM')).toBe(true)
    expect(STRUCTURAL_KEYWORDS.test('F-SLAB')).toBe(true)
  })

  it('matches Korean structural keywords', () => {
    expect(STRUCTURAL_KEYWORDS.test('건축-벽')).toBe(true)
    expect(STRUCTURAL_KEYWORDS.test('창문레이어')).toBe(true)
    expect(STRUCTURAL_KEYWORDS.test('문-1')).toBe(true)
  })
})

describe('parseDxfSegments layer filtering', () => {
  it('segments without layer get layer=undefined', () => {
    const entities = [
      { type: 'LINE', vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    ] as unknown as Array<Record<string, unknown>>
    const segs = parseDxfSegments(entities, {})
    expect(segs).toHaveLength(1)
    expect(segs[0].layer).toBeUndefined()
  })

  it('can filter segments by layer set', () => {
    const dxf = new DxfParser().parseSync(MULTI_LAYER_DXF)!
    const segs = parseDxfSegments(dxf.entities as unknown as Array<Record<string, unknown>>, {})

    const wallOnly = segs.filter((s) => s.layer === 'WALL')
    expect(wallOnly).toHaveLength(2)

    const selected = new Set(['WALL', 'DOOR'])
    const filtered = segs.filter((s) => selected.has(s.layer || '0'))
    expect(filtered).toHaveLength(3) // 2 WALL + 1 DOOR
  })

  it('unitToMm correctly computed for different $INSUNITS', () => {
    // mm
    const dxfMm = new DxfParser().parseSync(UNTITLED_DXF)!
    const unitMm = (dxfMm.header?.['$INSUNITS'] as number | undefined) ?? 4
    const toMmMm = unitMm === 1 ? 25.4 : unitMm === 2 ? 304.8 : unitMm === 5 ? 10 : unitMm === 6 ? 1000 : 1
    expect(toMmMm).toBe(1) // mm → 1

    // m
    const dxfM = new DxfParser().parseSync(POLYLINE_DXF)!
    const unitM = (dxfM.header?.['$INSUNITS'] as number | undefined) ?? 4
    const toMmM = unitM === 1 ? 25.4 : unitM === 2 ? 304.8 : unitM === 5 ? 10 : unitM === 6 ? 1000 : 1
    expect(toMmM).toBe(1000) // m → 1000
  })
})
