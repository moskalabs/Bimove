/**
 * DXF 파싱 성능 + 메모리 벤치마크
 *
 * 대규모 합성 DXF 문자열을 생성해서:
 * 1. Worker 파서 (parseDxfFast) — 시간/메모리 측정
 * 2. INSERT/BLOCK 중첩 시 재귀 폭발 안전성 검증
 * 3. EZ flip, group code 44/45 교정 검증
 */
import { describe, it, expect, beforeAll } from 'vitest'

// Worker 모듈을 static import — jsdom 환경에서 self === window이므로 onmessage 설정됨
import '../../lib/dxf-fast-worker'

// ─── 합성 DXF 생성 (padded 3-char group codes, 실제 AutoCAD 형식) ────────

/** Pad group code to 3 chars (standard DXF convention) */
const g = (c: number) => String(c).padStart(3)

function makeDxfHeader(): string {
  return `${g(0)}\nSECTION\n${g(2)}\nHEADER\n${g(9)}\n$ACADVER\n${g(1)}\nAC1009\n${g(9)}\n$INSUNITS\n${g(70)}\n4\n${g(0)}\nENDSEC\n`
}

function makeLine(x1: number, y1: number, x2: number, y2: number, layer = '0'): string {
  return `${g(0)}\nLINE\n${g(8)}\n${layer}\n${g(10)}\n${x1}\n${g(20)}\n${y1}\n${g(30)}\n0\n${g(11)}\n${x2}\n${g(21)}\n${y2}\n${g(31)}\n0\n`
}

function makeArc(cx: number, cy: number, r: number, sa: number, ea: number, layer = '0'): string {
  return `${g(0)}\nARC\n${g(8)}\n${layer}\n${g(10)}\n${cx}\n${g(20)}\n${cy}\n${g(30)}\n0\n${g(40)}\n${r}\n${g(50)}\n${sa}\n${g(51)}\n${ea}\n`
}

function makeCircle(cx: number, cy: number, r: number, layer = '0'): string {
  return `${g(0)}\nCIRCLE\n${g(8)}\n${layer}\n${g(10)}\n${cx}\n${g(20)}\n${cy}\n${g(30)}\n0\n${g(40)}\n${r}\n`
}

function makeLwPolyline(points: [number, number][], closed = false, layer = '0'): string {
  const n = points.length
  let s = `${g(0)}\nLWPOLYLINE\n${g(8)}\n${layer}\n${g(70)}\n${closed ? 1 : 0}\n${g(90)}\n${n}\n`
  for (const [x, y] of points) s += `${g(10)}\n${x}\n${g(20)}\n${y}\n`
  return s
}

function makeBlock(name: string, entities: string, baseX = 0, baseY = 0): string {
  return `${g(0)}\nBLOCK\n${g(8)}\n0\n${g(2)}\n${name}\n${g(70)}\n0\n${g(10)}\n${baseX}\n${g(20)}\n${baseY}\n${g(30)}\n0\n${entities}${g(0)}\nENDBLK\n`
}

function makeInsert(blockName: string, x: number, y: number, sx = 1, sy = 1, rot = 0, layer = '0'): string {
  return `${g(0)}\nINSERT\n${g(8)}\n${layer}\n${g(2)}\n${blockName}\n${g(10)}\n${x}\n${g(20)}\n${y}\n${g(30)}\n0\n${g(41)}\n${sx}\n${g(42)}\n${sy}\n${g(50)}\n${rot}\n`
}

function makeInsertArray(blockName: string, x: number, y: number, rows: number, cols: number, rowSp: number, colSp: number, layer = '0'): string {
  return `${g(0)}\nINSERT\n${g(8)}\n${layer}\n${g(2)}\n${blockName}\n${g(10)}\n${x}\n${g(20)}\n${y}\n${g(30)}\n0\n${g(41)}\n1\n${g(42)}\n1\n${g(50)}\n0\n${g(70)}\n${cols}\n${g(71)}\n${rows}\n${g(44)}\n${colSp}\n${g(45)}\n${rowSp}\n`
}

function makeInsertEz(blockName: string, x: number, y: number, ez: number, layer = '0'): string {
  return `${g(0)}\nINSERT\n${g(8)}\n${layer}\n${g(2)}\n${blockName}\n${g(10)}\n${x}\n${g(20)}\n${y}\n${g(30)}\n0\n${g(41)}\n1\n${g(42)}\n1\n${g(50)}\n0\n${g(230)}\n${ez}\n`
}

interface TestDxfConfig {
  lines: number
  arcs: number
  circles: number
  lwPolys: number
  blocks: number
  entitiesPerBlock: number
  inserts: number
  nestedInserts: number
  arrayInserts: number
}

function generateDxf(cfg: TestDxfConfig): string {
  const parts: string[] = [makeDxfHeader()]

  // BLOCKS section
  parts.push(`${g(0)}\nSECTION\n${g(2)}\nBLOCKS\n`)
  for (let b = 0; b < cfg.blocks; b++) {
    let blockEnts = ''
    for (let e = 0; e < cfg.entitiesPerBlock; e++) {
      const x = (e % 10) * 100, y = Math.floor(e / 10) * 100
      if (e % 3 === 0) blockEnts += makeLine(x, y, x + 80, y + 50, '0')
      else if (e % 3 === 1) blockEnts += makeArc(x + 40, y + 25, 20, 0, 180, '0')
      else blockEnts += makeCircle(x + 40, y + 25, 15, '0')
    }
    parts.push(makeBlock(`BLOCK_${b}`, blockEnts, 50, 50))
  }
  // Nested block (BLOCK that references other BLOCKs)
  for (let n = 0; n < cfg.nestedInserts && cfg.blocks > 1; n++) {
    let nested = ''
    for (let i = 0; i < Math.min(5, cfg.blocks); i++) {
      nested += makeInsert(`BLOCK_${i}`, i * 500, 0)
    }
    nested += makeLine(0, 0, 1000, 1000, '0')
    parts.push(makeBlock(`NESTED_${n}`, nested, 0, 0))
  }
  parts.push(`${g(0)}\nENDSEC\n`)

  // ENTITIES section
  parts.push(`${g(0)}\nSECTION\n${g(2)}\nENTITIES\n`)

  const layers = ['WALL', 'DOOR', 'WINDOW', 'FURNITURE', 'DIM']

  // Lines
  for (let i = 0; i < cfg.lines; i++) {
    const x = (i % 100) * 100, y = Math.floor(i / 100) * 100
    parts.push(makeLine(x, y, x + 80 + Math.random() * 20, y + 50 + Math.random() * 20, layers[i % layers.length]))
  }

  // Arcs
  for (let i = 0; i < cfg.arcs; i++) {
    const x = (i % 50) * 200, y = Math.floor(i / 50) * 200 + 10000
    parts.push(makeArc(x, y, 30 + Math.random() * 50, Math.random() * 180, 180 + Math.random() * 180, layers[i % layers.length]))
  }

  // Circles
  for (let i = 0; i < cfg.circles; i++) {
    const x = (i % 30) * 300, y = Math.floor(i / 30) * 300 + 20000
    parts.push(makeCircle(x, y, 10 + Math.random() * 40, layers[i % layers.length]))
  }

  // LWPolylines
  for (let i = 0; i < cfg.lwPolys; i++) {
    const pts: [number, number][] = []
    const ox = (i % 20) * 500, oy = Math.floor(i / 20) * 500 + 30000
    for (let j = 0; j < 8 + Math.floor(Math.random() * 8); j++) {
      pts.push([ox + j * 60, oy + Math.random() * 200])
    }
    parts.push(makeLwPolyline(pts, i % 3 === 0, layers[i % layers.length]))
  }

  // INSERTs
  for (let i = 0; i < cfg.inserts && cfg.blocks > 0; i++) {
    const blockIdx = i % cfg.blocks
    parts.push(makeInsert(`BLOCK_${blockIdx}`, i * 800, 50000 + Math.floor(i / 10) * 800, 1, 1, (i * 15) % 360, layers[i % layers.length]))
  }

  // Array INSERTs (MINSERT)
  for (let i = 0; i < cfg.arrayInserts && cfg.blocks > 0; i++) {
    parts.push(makeInsertArray(`BLOCK_${i % cfg.blocks}`, 0, 70000 + i * 5000, 3, 4, 500, 400, layers[i % layers.length]))
  }

  // Nested INSERT references
  for (let i = 0; i < cfg.nestedInserts; i++) {
    parts.push(makeInsert(`NESTED_${i}`, i * 3000, 100000, 1, 1, 0, 'WALL'))
  }

  parts.push(`${g(0)}\nENDSEC\n${g(0)}\nEOF\n`)
  return parts.join('')
}

// ─── 메모리 측정 ────────────────────────────────────────────────────────

function memMB(): number {
  if (typeof process !== 'undefined' && process.memoryUsage) {
    return process.memoryUsage().heapUsed / 1048576
  }
  return 0
}

function gcIfAvailable(): void {
  if (typeof globalThis.gc === 'function') {
    globalThis.gc()
  }
}

// ─── Worker 호출 헬퍼 ───────────────────────────────────────────────────

type PolylineData = { vertices: number[][]; layer: string; colorNumber: number }
type TextData = { x: number; y: number; text: string; height: number; rotation: number; layer: string; colorNumber: number }
type HatchData = { pathData: string; patternName: string; patternScale: number; patternAngle: number; color?: string; layer: string; cx: number; cy: number }

function callWorkerSync(
  dxfText: string,
  selectedLayers: string[],
): Promise<{ polylines: PolylineData[]; insUnits: number; texts: TextData[]; hatches: HatchData[] }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Worker mock timeout (15s)')), 15000)

    // self.postMessage를 가로채서 결과 수집
    const origPost = self.postMessage
    self.postMessage = (msg: Record<string, unknown>) => {
      if (msg.type === 'result') {
        clearTimeout(timeout)
        self.postMessage = origPost
        resolve({
          polylines: msg.polylines as PolylineData[],
          insUnits: msg.insUnits as number,
          texts: (msg.texts || []) as TextData[],
          hatches: (msg.hatches || []) as HatchData[],
        })
      } else if (msg.type === 'error') {
        clearTimeout(timeout)
        self.postMessage = origPost
        reject(new Error(msg.message as string))
      }
      // 'progress' 타입은 무시
    }

    // onmessage 호출
    if (typeof self.onmessage === 'function') {
      self.onmessage(new MessageEvent('message', {
        data: { type: 'parse', dxfText, selectedLayers },
      }))
    } else {
      clearTimeout(timeout)
      self.postMessage = origPost
      reject(new Error('self.onmessage not set — worker import failed'))
    }
  })
}

// ─── 테스트 ─────────────────────────────────────────────────────────────

describe('DXF Performance Benchmark', () => {

  beforeAll(() => {
    // Worker module이 로드되면서 self.onmessage가 설정됐는지 확인
    expect(typeof self.onmessage).toBe('function')
  })

  // 작은 DXF — 기본 파싱 검증 (jsdom 환경, 브라우저 대비 ~5x 느림)
  it('Small DXF (500 entities): parse < 2000ms', async () => {
    const dxf = generateDxf({
      lines: 300, arcs: 100, circles: 50, lwPolys: 50,
      blocks: 5, entitiesPerBlock: 10, inserts: 20, nestedInserts: 2, arrayInserts: 2,
    })

    console.log(`\n[BENCH] Small DXF: ${(dxf.length / 1024).toFixed(0)}KB`)

    gcIfAvailable()
    const memBefore = memMB()
    const t0 = performance.now()

    const result = await callWorkerSync(dxf, ['WALL', 'DOOR', 'WINDOW', 'FURNITURE', 'DIM'])

    const elapsed = performance.now() - t0
    const memAfter = memMB()

    console.log(`  Parse: ${elapsed.toFixed(0)}ms`)
    console.log(`  Polylines: ${result.polylines.length}`)
    console.log(`  Texts: ${result.texts.length}`)
    console.log(`  Memory delta: ${(memAfter - memBefore).toFixed(1)}MB`)

    expect(elapsed).toBeLessThan(2000)
    expect(result.polylines.length).toBeGreaterThan(0)
  })

  // 중간 DXF — 일반적인 도면 크기
  it('Medium DXF (5000 entities): parse < 10000ms', { timeout: 30000 }, async () => {
    const dxf = generateDxf({
      lines: 3000, arcs: 800, circles: 400, lwPolys: 200,
      blocks: 20, entitiesPerBlock: 20, inserts: 100, nestedInserts: 5, arrayInserts: 5,
    })

    console.log(`\n[BENCH] Medium DXF: ${(dxf.length / 1024).toFixed(0)}KB`)

    gcIfAvailable()
    const memBefore = memMB()
    const t0 = performance.now()

    const result = await callWorkerSync(dxf, ['WALL', 'DOOR', 'WINDOW', 'FURNITURE', 'DIM'])

    const elapsed = performance.now() - t0
    const memAfter = memMB()

    console.log(`  Parse: ${elapsed.toFixed(0)}ms`)
    console.log(`  Polylines: ${result.polylines.length}`)
    console.log(`  Texts: ${result.texts.length}`)
    console.log(`  Memory delta: ${(memAfter - memBefore).toFixed(1)}MB`)

    expect(elapsed).toBeLessThan(10000)
    expect(result.polylines.length).toBeGreaterThan(0)
  })

  // 큰 DXF — 성능 스트레스 테스트
  it('Large DXF (20000 entities): parse < 60000ms, memory < 200MB', { timeout: 120000 }, async () => {
    const dxf = generateDxf({
      lines: 12000, arcs: 3000, circles: 2000, lwPolys: 500,
      blocks: 50, entitiesPerBlock: 30, inserts: 300, nestedInserts: 10, arrayInserts: 10,
    })

    console.log(`\n[BENCH] Large DXF: ${(dxf.length / 1024 / 1024).toFixed(2)}MB`)

    gcIfAvailable()
    const memBefore = memMB()
    const t0 = performance.now()

    const result = await callWorkerSync(dxf, ['WALL', 'DOOR', 'WINDOW', 'FURNITURE', 'DIM'])

    const elapsed = performance.now() - t0
    const memAfter = memMB()

    console.log(`  Parse: ${elapsed.toFixed(0)}ms`)
    console.log(`  Polylines: ${result.polylines.length}`)
    console.log(`  Texts: ${result.texts.length}`)
    console.log(`  Memory delta: ${(memAfter - memBefore).toFixed(1)}MB`)
    console.log(`  Peak heap: ${memAfter.toFixed(0)}MB`)

    expect(elapsed).toBeLessThan(60000)
    expect(result.polylines.length).toBeGreaterThan(0)
    expect(memAfter - memBefore).toBeLessThan(200)
  })

  // INSERT 재귀 폭발 안전성 테스트
  it('Deeply nested INSERT (depth 12 × 100 refs): safe termination', { timeout: 30000 }, async () => {
    const parts: string[] = [makeDxfHeader()]
    parts.push(`${g(0)}\nSECTION\n${g(2)}\nBLOCKS\n`)

    const DEPTH = 12
    parts.push(makeBlock(`DEEP_${DEPTH}`, makeLine(0, 0, 100, 100) + makeCircle(50, 50, 30), 0, 0))

    for (let d = DEPTH - 1; d >= 0; d--) {
      let ents = ''
      for (let i = 0; i < 100; i++) {
        ents += makeInsert(`DEEP_${d + 1}`, i * 200, 0)
      }
      parts.push(makeBlock(`DEEP_${d}`, ents, 0, 0))
    }
    parts.push(`${g(0)}\nENDSEC\n`)

    parts.push(`${g(0)}\nSECTION\n${g(2)}\nENTITIES\n`)
    parts.push(makeInsert('DEEP_0', 0, 0, 1, 1, 0, 'WALL'))
    parts.push(`${g(0)}\nENDSEC\n${g(0)}\nEOF\n`)

    const dxf = parts.join('')
    console.log(`\n[BENCH] Deep nested INSERT (depth ${DEPTH}, 100 refs each): ${(dxf.length / 1024).toFixed(0)}KB`)
    console.log(`  Theoretical max entities: 100^${DEPTH} = ${Math.pow(100, DEPTH).toExponential(1)}`)

    gcIfAvailable()
    const t0 = performance.now()

    const result = await callWorkerSync(dxf, ['WALL', '0'])

    const elapsed = performance.now() - t0
    console.log(`  Parse: ${elapsed.toFixed(0)}ms`)
    console.log(`  Polylines: ${result.polylines.length}`)

    // MAX_DEPTH=8에 의해 안전하게 제한 (depth 12 > MAX_DEPTH이므로 geometry 미도달 → 0 polylines 정상)
    expect(elapsed).toBeLessThan(10000)
    expect(result.polylines.length).toBeLessThan(500_000)
    // 핵심: 10^24개 가능한 엔티티가 있지만 크래시/멈춤 없이 600ms 이내 종료
  })

  // INSERT EZ flip 순서 검증
  it('INSERT with EZ=-1: X flipped BEFORE scale/rotate/translate', async () => {
    const parts: string[] = [makeDxfHeader()]
    parts.push(`${g(0)}\nSECTION\n${g(2)}\nBLOCKS\n`)
    parts.push(makeBlock('EZBLOCK', makeLine(100, 200, 300, 400), 0, 0))
    parts.push(`${g(0)}\nENDSEC\n`)

    parts.push(`${g(0)}\nSECTION\n${g(2)}\nENTITIES\n`)
    // INSERT with EZ=-1
    parts.push(makeInsertEz('EZBLOCK', 0, 0, -1, 'WALL'))
    // INSERT without EZ (normal)
    parts.push(makeInsert('EZBLOCK', 0, 0, 1, 1, 0, 'WALL'))
    parts.push(`${g(0)}\nENDSEC\n${g(0)}\nEOF\n`)

    const dxf = parts.join('')
    const result = await callWorkerSync(dxf, ['WALL', '0'])

    expect(result.polylines.length).toBe(2)

    const flipped = result.polylines[0].vertices
    const normal = result.polylines[1].vertices

    console.log(`\n[BENCH] EZ flip test:`)
    console.log(`  Flipped: [${flipped[0]}] → [${flipped[1]}]`)
    console.log(`  Normal:  [${normal[0]}] → [${normal[1]}]`)

    // EZ flip BEFORE scale: x' = -x, then scale(1), rotate(0), translate(0,0)
    // So flipped x = -normal_x, y = same
    expect(flipped[0][0]).toBeCloseTo(-normal[0][0], 1)
    expect(flipped[1][0]).toBeCloseTo(-normal[1][0], 1)
    expect(flipped[0][1]).toBeCloseTo(normal[0][1], 1)
    expect(flipped[1][1]).toBeCloseTo(normal[1][1], 1)
  })

  // Group code 44/45 교정 검증
  it('INSERT array: gc44=columnSpacing, gc45=rowSpacing', async () => {
    const parts: string[] = [makeDxfHeader()]
    parts.push(`${g(0)}\nSECTION\n${g(2)}\nBLOCKS\n`)
    parts.push(makeBlock('ARRBLOCK', makeLine(0, 0, 10, 10), 0, 0))
    parts.push(`${g(0)}\nENDSEC\n`)

    parts.push(`${g(0)}\nSECTION\n${g(2)}\nENTITIES\n`)
    // 2 rows × 3 cols, colSp=1000 (gc44), rowSp=500 (gc45)
    parts.push(makeInsertArray('ARRBLOCK', 0, 0, 2, 3, 500, 1000, 'WALL'))
    parts.push(`${g(0)}\nENDSEC\n${g(0)}\nEOF\n`)

    const dxf = parts.join('')
    const result = await callWorkerSync(dxf, ['WALL', '0'])

    // 2 × 3 = 6 instances
    expect(result.polylines.length).toBe(6)

    // col spacing(1000)은 X방향, row spacing(500)은 Y방향 (rot=0일 때)
    const origins = result.polylines.map(p => [Math.round(p.vertices[0][0]), Math.round(p.vertices[0][1])])
    console.log(`\n[BENCH] Array INSERT origins:`, origins)

    const hasColOffset = origins.some(([x]) => Math.abs(x - 1000) < 5)
    const hasRowOffset = origins.some(([, y]) => Math.abs(y - 500) < 5)

    expect(hasColOffset).toBe(true)
    expect(hasRowOffset).toBe(true)
  })

  // 큰 블록 건너뛰기 보호
  it('Block with >500 entities: safely skipped', async () => {
    const parts: string[] = [makeDxfHeader()]
    parts.push(`${g(0)}\nSECTION\n${g(2)}\nBLOCKS\n`)

    let hugeEnts = ''
    for (let i = 0; i < 600; i++) {
      hugeEnts += makeLine(i, 0, i, 100, '0')
    }
    parts.push(makeBlock('HUGE', hugeEnts, 0, 0))
    parts.push(makeBlock('SMALL', makeLine(0, 0, 50, 50), 0, 0))
    parts.push(`${g(0)}\nENDSEC\n`)

    parts.push(`${g(0)}\nSECTION\n${g(2)}\nENTITIES\n`)
    parts.push(makeInsert('HUGE', 0, 0, 1, 1, 0, 'WALL'))
    parts.push(makeInsert('SMALL', 100, 100, 1, 1, 0, 'WALL'))
    parts.push(`${g(0)}\nENDSEC\n${g(0)}\nEOF\n`)

    const dxf = parts.join('')
    const result = await callWorkerSync(dxf, ['WALL', '0'])

    console.log(`\n[BENCH] Huge block test: ${result.polylines.length} polylines`)

    // SMALL 블록은 파싱됨, HUGE 블록은 건너뜀 (500 entity limit)
    expect(result.polylines.length).toBe(1)
  })

  // HATCH 파싱: polyline boundary + edge boundary
  it('HATCH: polyline boundary + edge boundary parsed correctly', async () => {
    const parts: string[] = [makeDxfHeader()]
    parts.push(`${g(0)}\nSECTION\n${g(2)}\nBLOCKS\n${g(0)}\nENDSEC\n`)
    parts.push(`${g(0)}\nSECTION\n${g(2)}\nENTITIES\n`)

    // HATCH 1: SOLID polyline boundary (사각형)
    parts.push([
      `${g(0)}`, 'HATCH',
      `${g(8)}`, 'WALL',
      `${g(2)}`, 'SOLID',
      `${g(70)}`, '1',     // solid fill
      `${g(71)}`, '0',     // non-associative
      `${g(91)}`, '1',     // 1 boundary path
      `${g(92)}`, '7',     // polyline boundary (flag & 2)
      `${g(72)}`, '0',     // no bulge
      `${g(73)}`, '1',     // closed
      `${g(93)}`, '4',     // 4 vertices
      `${g(10)}`, '0',  `${g(20)}`, '0',
      `${g(10)}`, '100',`${g(20)}`, '0',
      `${g(10)}`, '100',`${g(20)}`, '50',
      `${g(10)}`, '0',  `${g(20)}`, '50',
      `${g(75)}`, '0',     // hatch style
      `${g(76)}`, '1',     // pattern type
    ].join('\n'))

    // HATCH 2: ANSI31 edge boundary (삼각형 = 3 line edges)
    parts.push([
      `${g(0)}`, 'HATCH',
      `${g(8)}`, 'WALL',
      `${g(62)}`, '1',     // red (ACI)
      `${g(2)}`, 'ANSI31',
      `${g(41)}`, '2.5',   // pattern scale
      `${g(52)}`, '45',    // pattern angle
      `${g(70)}`, '0',     // pattern fill
      `${g(71)}`, '0',
      `${g(91)}`, '1',     // 1 boundary path
      `${g(92)}`, '1',     // edge boundary (not polyline)
      `${g(93)}`, '3',     // 3 edges
      // Edge 1: line
      `${g(72)}`, '1',
      `${g(10)}`, '200', `${g(20)}`, '0',
      `${g(11)}`, '300', `${g(21)}`, '0',
      // Edge 2: line
      `${g(72)}`, '1',
      `${g(10)}`, '300', `${g(20)}`, '0',
      `${g(11)}`, '250', `${g(21)}`, '100',
      // Edge 3: line
      `${g(72)}`, '1',
      `${g(10)}`, '250', `${g(20)}`, '100',
      `${g(11)}`, '200', `${g(21)}`, '0',
      `${g(75)}`, '0',
      `${g(76)}`, '1',
    ].join('\n'))

    // HATCH 3: arc edge boundary
    parts.push([
      `${g(0)}`, 'HATCH',
      `${g(8)}`, 'WALL',
      `${g(420)}`, `${(255 << 16) | (128 << 8) | 0}`,  // trueColor: orange
      `${g(2)}`, 'CONCRETE',
      `${g(41)}`, '1',
      `${g(70)}`, '0',
      `${g(71)}`, '0',
      `${g(91)}`, '1',
      `${g(92)}`, '1',     // edge boundary
      `${g(93)}`, '2',     // 2 edges
      // Edge 1: arc
      `${g(72)}`, '2',
      `${g(10)}`, '400', `${g(20)}`, '50',    // center
      `${g(40)}`, '50',                        // radius
      `${g(50)}`, '0',  `${g(51)}`, '180',     // start/end angle
      `${g(73)}`, '1',                          // CCW
      // Edge 2: line (close bottom)
      `${g(72)}`, '1',
      `${g(10)}`, '350', `${g(20)}`, '50',
      `${g(11)}`, '450', `${g(21)}`, '50',
      `${g(75)}`, '0',
      `${g(76)}`, '1',
    ].join('\n'))

    parts.push(`${g(0)}\nENDSEC\n${g(0)}\nEOF\n`)
    const dxf = parts.join('\n')

    const result = await callWorkerSync(dxf, ['WALL'])

    console.log(`\n[BENCH] HATCH test:`)
    console.log(`  Hatches found: ${result.hatches.length}`)
    result.hatches.forEach((h, i) => {
      console.log(`  [${i}] pattern=${h.patternName}, scale=${h.patternScale}, angle=${h.patternAngle}, color=${h.color}, cx=${h.cx.toFixed(1)}, cy=${h.cy.toFixed(1)}`)
      console.log(`       pathData (first 80): ${h.pathData.substring(0, 80)}...`)
    })

    expect(result.hatches.length).toBe(3)

    // HATCH 1: SOLID, polyline rect
    const h1 = result.hatches[0]
    expect(h1.patternName).toBe('SOLID')
    expect(h1.layer).toBe('WALL')
    expect(h1.pathData).toContain('M')
    expect(h1.pathData).toContain('Z')
    expect(h1.cx).toBeCloseTo(50, 0)
    expect(h1.cy).toBeCloseTo(25, 0)

    // HATCH 2: ANSI31, edge boundary triangle
    const h2 = result.hatches[1]
    expect(h2.patternName).toBe('ANSI31')
    expect(h2.patternScale).toBe(2.5)
    expect(h2.patternAngle).toBe(45)
    expect(h2.color).toBeDefined()  // ACI 1 = red

    // HATCH 3: CONCRETE, arc edge + trueColor
    const h3 = result.hatches[2]
    expect(h3.patternName).toBe('CONCRETE')
    expect(h3.color).toBeDefined()  // trueColor orange
    expect(h3.pathData).toContain('L')  // arc → line approximation
  })
})
