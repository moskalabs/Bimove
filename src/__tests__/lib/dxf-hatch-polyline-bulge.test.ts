/**
 * Test: HATCH 폴리라인 테두리의 bulge 호 — 중심이 어느 쪽에 놓이는가.
 *
 * bulge = tan(θ/4) 이라 |bulge| > 1 이면 호가 반원을 넘는다(θ > 180°). 그때
 * 호의 중심은 현을 넘어 **부푼 쪽**으로 넘어온다. 그런데 해치 테두리 코드는
 * bulge 의 **부호만** 보고 중심을 늘 한쪽에 놓았다. 그러면 큰 호가 거울처럼
 * 반대로 그려지고, 반지름도 다른 값이 돼서 작은 호 하나가 엉뚱한 방향으로
 * 부푼 덩어리가 된다 — 단색 해치면 그대로 회색 덩어리로 보인다.
 *
 * 같은 블록이 dxf-fast-worker.ts(V2 워커) 와 dxf.ts(parseRawHatches) 에
 * 복붙돼 있어서 양쪽을 다 검증한다. LWPOLYLINE 쪽 bulgeArc 는 원래부터
 * theta 로 판정하고 있었다 — 그 기준에 맞춘 것이다.
 */
import { describe, it, expect } from 'vitest'
import { parseRawHatches } from '../../lib/dxf'
import { parseHatchEntity } from '../../lib/dxf-fast-worker'

type Pair = [string, string]

/**
 * 폴리라인 테두리 하나짜리 단색 HATCH.
 * 꼭짓점 (0,0) → (100,0) 한 변에 bulge 를 준 열린 폴리라인.
 */
function polylineBulge(bulge: string): Pair[] {
  return [
    ['100', 'AcDbEntity'], ['8', 'F-1'], ['62', '8'],
    ['100', 'AcDbHatch'],
    ['10', '0.0'], ['20', '0.0'], ['30', '0.0'],
    ['2', 'SOLID'], ['70', '1'], ['71', '0'],
    ['91', '1'],
    ['92', '3'],            // bit 1 = external, bit 2 = polyline
    ['72', '1'],            // bulge 있음
    ['73', '0'],            // 열린 폴리라인 → 변 하나만
    ['93', '2'],
    ['10', '0.0'], ['20', '0.0'], ['42', bulge],
    ['10', '100.0'], ['20', '0.0'], ['42', '0.0'],
    ['97', '0'],
    ['75', '1'], ['76', '0'],
    ['47', '1.0'],
    ['98', '1'], ['10', '0.0'], ['20', '0.0'],
  ]
}

const asDxf = (pairs: Pair[]): string =>
  ['0', 'SECTION', '2', 'ENTITIES', '0', 'HATCH']
    .concat(pairs.flat(), ['0', 'ENDSEC', '0', 'EOF'])
    .join('\n') + '\n'

const asChunk = (pairs: Pair[]): string =>
  'HATCH\n' + pairs.map(([c, v]) => `${c}\n${v}`).join('\n') + '\n'

function points(pathData: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const re = /[ML]([\d.eE+-]+),([\d.eE+-]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(pathData)) !== null) out.push([parseFloat(m[1]), parseFloat(m[2])])
  return out
}

/** 두 파서를 같은 입력으로 돌려서 패스를 꺼낸다. */
function bothPaths(pairs: Pair[]): string[] {
  const worker = parseHatchEntity(asChunk(pairs), 'F-1')
  const legacy = parseRawHatches(asDxf(pairs), {})
  expect(worker).not.toBeNull()
  expect(legacy).toHaveLength(1)
  return [worker!.pathData, legacy[0].pathData]
}

function bbox(pathData: string) {
  const pts = points(pathData)
  expect(pts.length).toBeGreaterThanOrEqual(4)
  return {
    minX: Math.min(...pts.map(p => p[0])),
    maxX: Math.max(...pts.map(p => p[0])),
    minY: Math.min(...pts.map(p => p[1])),
    maxY: Math.max(...pts.map(p => p[1])),
    pts,
  }
}

describe('HATCH 폴리라인 테두리 bulge — 반원을 넘으면 중심이 넘어온다', () => {
  // (0,0)→(100,0) 에 양수 bulge 는 아래(-y)로 부푼다. LWPOLYLINE 과 같은 규약.
  it('|bulge| < 1 (작은 호) 는 그대로 — 아래로 sagitta 만큼만', () => {
    // bulge 0.5 → θ = 4·atan(0.5) ≈ 106°, sagitta = 0.5 · 100/2 = 25
    for (const path of bothPaths(polylineBulge('0.5'))) {
      const b = bbox(path)
      expect(b.minY).toBeCloseTo(-25, 3)
      expect(b.maxY).toBeCloseTo(0, 6)
      // 현 밖으로 안 나간다
      expect(b.minX).toBeGreaterThan(-1e-6)
      expect(b.maxX).toBeLessThan(100 + 1e-6)
    }
  })

  it('|bulge| > 1 (반원을 넘는 호) 도 부푼 방향이 같다 — 아래로 sagitta 만큼', () => {
    // bulge 2 → θ = 4·atan(2) ≈ 253.7°, sagitta = 2 · 100/2 = 100, r = 62.5
    // 중심을 안 뒤집으면 호가 위(+y)로 뒤집히고 반지름도 틀린다.
    for (const path of bothPaths(polylineBulge('2.0'))) {
      const b = bbox(path)
      expect(b.minY).toBeCloseTo(-100, 2)
      expect(b.maxY).toBeCloseTo(0, 6)
      // 반원을 넘으니 현 좌우로도 (62.5 - 50) = 12.5 만큼 삐져나간다
      expect(b.minX).toBeCloseTo(-12.5, 2)
      expect(b.maxX).toBeCloseTo(112.5, 2)
      // 전부 중심 (50, -37.5) 에서 반지름 62.5 위에 있다
      for (const [x, y] of b.pts) expect(Math.hypot(x - 50, y + 37.5)).toBeCloseTo(62.5, 3)
    }
  })

  it('음수 bulge 는 위로 부푼다 — |bulge| > 1 에서도 거울이 안 깨진다', () => {
    for (const path of bothPaths(polylineBulge('-2.0'))) {
      const b = bbox(path)
      expect(b.maxY).toBeCloseTo(100, 2)
      expect(b.minY).toBeCloseTo(0, 6)
      for (const [x, y] of b.pts) expect(Math.hypot(x - 50, y - 37.5)).toBeCloseTo(62.5, 3)
    }
  })

  it('bulge = 1 (딱 반원) 은 경계값 — 중심이 현 위에 있다', () => {
    for (const path of bothPaths(polylineBulge('1.0'))) {
      const b = bbox(path)
      expect(b.minY).toBeCloseTo(-50, 3)
      expect(b.maxY).toBeCloseTo(0, 6)
      for (const [x, y] of b.pts) expect(Math.hypot(x - 50, y)).toBeCloseTo(50, 3)
    }
  })
})
