/**
 * Test: HATCH 타원 호 테두리(boundary edge type 3) 의 각도 단위.
 *
 * DXF 는 gc 50/51 을 **도(度)** 로 적는다 (바로 옆 호 edge 와 같다). 그런데
 * 두 파서가 이걸 라디안으로 썼다 — 기본값까지 `2 * Math.PI` 였다. 그러면
 * `51 = 360` 이 57 바퀴가 되고, 고정 18 점으로 샘플링한 다각형은 타원 위
 * 아무 데나 흩어진 점들을 이은 자기교차 도형이 된다. 단색 해치는 nonzero
 * 규칙으로 채워지므로 **타원 전체를 메운 반투명 회색 원반**이 보인다 —
 * 리닝 도면 F-1 레이어에 네 개 떠 있던 그 동그라미.
 *
 * 같은 블록이 dxf-fast-worker.ts(V2 워커) 와 dxf.ts(parseRawHatches) 에
 * 복붙돼 있어서 양쪽을 다 검증한다.
 */
import { describe, it, expect } from 'vitest'
import { parseRawHatches } from '../../lib/dxf'
import { parseHatchEntity } from '../../lib/dxf-fast-worker'

type Pair = [string, string]

/**
 * 타원 호 테두리 하나짜리 HATCH.
 * 중심 (0,0), 장축 끝점 (100,0), 단축비 1 → 반지름 100 짜리 원.
 */
function ellipseEdge(startDeg: string, endDeg: string, ccw?: string): Pair[] {
  const edge: Pair[] = [
    ['72', '3'],
    ['10', '0.0'], ['20', '0.0'],
    ['11', '100.0'], ['21', '0.0'],
    ['40', '1.0'],
    ['50', startDeg], ['51', endDeg],
  ]
  if (ccw !== undefined) edge.push(['73', ccw])
  return [
    ['100', 'AcDbEntity'], ['8', 'F-1'], ['62', '8'],
    ['100', 'AcDbHatch'],
    ['10', '0.0'], ['20', '0.0'], ['30', '0.0'],
    ['2', 'SOLID'], ['70', '1'], ['71', '0'],
    ['91', '1'],
    ['92', '0'], ['93', '1'],
    ...edge,
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

/** 패스에서 좌표쌍만 뽑는다. */
function points(pathData: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const re = /[ML]([\d.eE+-]+),([\d.eE+-]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(pathData)) !== null) out.push([parseFloat(m[1]), parseFloat(m[2])])
  return out
}

/** 두 파서를 같은 입력으로 돌려서 패스를 꺼낸다. */
function bothPaths(pairs: Pair[]): { worker: string; legacy: string } {
  const worker = parseHatchEntity(asChunk(pairs), 'F-1')
  const legacy = parseRawHatches(asDxf(pairs), {})
  expect(worker).not.toBeNull()
  expect(legacy).toHaveLength(1)
  return { worker: worker!.pathData, legacy: legacy[0].pathData }
}

describe('HATCH 타원 호 테두리 — gc 50/51 은 도(度)', () => {
  it('0~90도 모서리 호는 1사분면에만 머문다', () => {
    const { worker, legacy } = bothPaths(ellipseEdge('0.0', '90.0'))
    for (const path of [worker, legacy]) {
      const pts = points(path)
      expect(pts.length).toBeGreaterThanOrEqual(4)
      // 라디안으로 읽으면 90 rad = 14 바퀴라 점들이 타원 전체에 흩어진다.
      for (const [x, y] of pts) {
        expect(x).toBeGreaterThan(-1e-6)
        expect(y).toBeGreaterThan(-1e-6)
      }
      // 끝점은 (0,100) 근처여야 한다.
      const last = pts[pts.length - 1]
      expect(last[0]).toBeCloseTo(0, 6)
      expect(last[1]).toBeCloseTo(100, 6)
    }
  })

  it('0~360도는 한 바퀴만 돌고 제자리로 온다', () => {
    const { worker, legacy } = bothPaths(ellipseEdge('0.0', '360.0'))
    for (const path of [worker, legacy]) {
      const pts = points(path)
      expect(pts[0][0]).toBeCloseTo(100, 6)
      expect(pts[0][1]).toBeCloseTo(0, 6)
      const last = pts[pts.length - 1]
      expect(last[0]).toBeCloseTo(100, 6)
      expect(last[1]).toBeCloseTo(0, 6)
      // 전부 반지름 100 위에 있다 — 자기교차 별모양이 아니다.
      for (const [x, y] of pts) expect(Math.hypot(x, y)).toBeCloseTo(100, 6)
      // 각도가 단조증가한다 (한 바퀴를 넘지 않는다).
      const angles = pts.map(([x, y]) => Math.atan2(y, x))
      const wrapped = angles.filter((t, i) => i > 0 && t < angles[i - 1] - 1e-9)
      expect(wrapped).toHaveLength(1)   // 2π 를 지나며 한 번만 되감긴다
    }
  })

  it('각도를 안 주면 한 바퀴 전체 (기본값 360도)', () => {
    const pairs = ellipseEdge('0.0', '360.0').filter(
      ([c, v]) => !((c === '50' || c === '51') && (v === '0.0' || v === '360.0')),
    )
    const { worker, legacy } = bothPaths(pairs)
    for (const path of [worker, legacy]) {
      for (const [x, y] of points(path)) expect(Math.hypot(x, y)).toBeCloseTo(100, 6)
    }
  })

  // 호 edge 는 gc 73 을 보는데 타원 edge 는 무시하고 있었다.
  it('gc 73 = 0 (시계방향) 이면 각도 부호를 뒤집는다', () => {
    const { worker, legacy } = bothPaths(ellipseEdge('0.0', '90.0', '0'))
    for (const path of [worker, legacy]) {
      const pts = points(path)
      // 0도에서 시작해 -90도로 내려가므로 4사분만에만 있다.
      expect(pts[0][0]).toBeCloseTo(100, 6)
      expect(pts[0][1]).toBeCloseTo(0, 6)
      const last = pts[pts.length - 1]
      expect(last[0]).toBeCloseTo(0, 6)
      expect(last[1]).toBeCloseTo(-100, 6)
      for (const [x, y] of pts) {
        expect(x).toBeGreaterThan(-1e-6)
        expect(y).toBeLessThan(1e-6)
      }
    }
  })

  // 15도에 한 조각 — 호 edge 와 같은 기준. 90도면 6조각(7점), 360도면 24조각.
  it('호 길이에 맞춰 조각 수를 정한다', () => {
    expect(points(bothPaths(ellipseEdge('0.0', '90.0')).worker)).toHaveLength(7)
    expect(points(bothPaths(ellipseEdge('0.0', '360.0')).worker)).toHaveLength(25)
  })

  it('단축비(gc 40)와 장축 회전은 그대로 쓴다', () => {
    const pairs = ellipseEdge('0.0', '360.0').map(([c, v]): Pair =>
      c === '40' ? [c, '0.5'] : v === '100.0' && c === '11' ? [c, '0.0'] : [c, v],
    )
    // 장축 끝점을 (0,100) 으로 → 90도 회전, 단축 50.
    const fixed = pairs.map(([c, v]): Pair => (c === '21' && v === '0.0' ? [c, '100.0'] : [c, v]))
    const pts = points(bothPaths(fixed).worker)
    const rs = pts.map(([x, y]) => Math.hypot(x, y))
    expect(Math.max(...rs)).toBeCloseTo(100, 6)
    expect(Math.min(...rs)).toBeCloseTo(50, 6)
  })
})
