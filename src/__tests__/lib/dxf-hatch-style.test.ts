/**
 * Test: HATCH 섬(홀) 처리 — gc 75 해치 스타일.
 *
 * 해치 하나의 테두리는 루프 여러 개로 온다 (바깥 하나 + 섬 여러 개). 파서는
 * 그걸 전부 이어 붙인 SVG path 하나로 내고, 렌더는 그 path 를 채운다. 그런데
 * SVG 기본 채움 규칙은 nonzero 라서, 섬이 바깥과 **같은 방향으로 감겨 있으면**
 * 홀이 메워진다 — 도넛이 통짜 원반이 된다. 감는 방향은 DXF 를 쓴 프로그램이
 * 정하니, 같은 증상이 파일마다 나기도 하고 안 나기도 했다.
 *
 * AutoCAD 기본 스타일(gc 75 = 0, Normal) 은 홀짝(odd parity) 이므로 evenodd 가
 * 맞고, gc 75 = 2 (Ignore) 만 "홀을 무시하고 다 채워라" 라서 nonzero 가 맞다.
 * 여기서는 파서가 gc 75 를 제대로 실어 보내는지, 그리고 루프가 서브패스로
 * 분리돼 나오는지(=채움 규칙이 먹을 수 있는 모양인지) 를 본다.
 */
import { describe, it, expect } from 'vitest'
import { parseRawHatches } from '../../lib/dxf'
import { parseHatchEntity } from '../../lib/dxf-fast-worker'

type Pair = [string, string]

/** 사각 폴리라인 루프 하나. flag: 1=external, 2=polyline, 16=outermost */
function loop(flag: string, size: number): Pair[] {
  const s = String(size)
  return [
    ['92', flag],
    ['72', '0'],   // bulge 없음
    ['73', '1'],   // 닫힘
    ['93', '4'],
    ['10', '0.0'], ['20', '0.0'],
    ['10', s], ['20', '0.0'],
    ['10', s], ['20', s],
    ['10', '0.0'], ['20', s],
    ['97', '0'],
  ]
}

/** 바깥 사각 + 안쪽 사각(섬) 짜리 단색 해치. */
function ringHatch(style: string): Pair[] {
  return [
    ['100', 'AcDbEntity'], ['8', 'F-1'], ['62', '8'],
    ['100', 'AcDbHatch'],
    ['10', '0.0'], ['20', '0.0'], ['30', '0.0'],
    ['2', 'SOLID'], ['70', '1'], ['71', '0'],
    ['91', '2'],
    ...loop('3', 100),    // external + polyline
    ...loop('2', 50),     // polyline (섬)
    ['75', style],
    ['76', '0'],
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

describe('HATCH gc 75 해치 스타일', () => {
  it('두 파서가 gc 75 를 그대로 싣는다', () => {
    for (const style of ['0', '1', '2']) {
      const pairs = ringHatch(style)
      const worker = parseHatchEntity(asChunk(pairs), 'F-1')
      const legacy = parseRawHatches(asDxf(pairs), {})
      expect(worker?.hatchStyle).toBe(Number(style))
      expect(legacy[0]?.hatchStyle).toBe(Number(style))
    }
  })

  it('gc 75 가 없으면 Normal(0) 로 본다', () => {
    const pairs = ringHatch('0').filter(([c, v]) => !(c === '75' && v === '0'))
    const worker = parseHatchEntity(asChunk(pairs), 'F-1')
    expect(worker?.hatchStyle).toBe(0)
    expect(parseRawHatches(asDxf(pairs), {})[0]?.hatchStyle).toBe(0)
  })

  // 루프가 하나로 뭉쳐 나오면 채움 규칙으로 홀을 뚫을 수가 없다.
  it('바깥 루프와 섬이 서브패스 두 개로 분리돼 나온다', () => {
    const pairs = ringHatch('0')
    for (const d of [
      parseHatchEntity(asChunk(pairs), 'F-1')!.pathData,
      parseRawHatches(asDxf(pairs), {})[0].pathData,
    ]) {
      expect(d.match(/M/g)).toHaveLength(2)
      expect(d.match(/Z/g)).toHaveLength(2)
      // 두 루프가 같은 방향(CCW) 으로 감겨 있다 — nonzero 로 채우면 홀이 메워진다.
      expect(signedArea(d.split('M').filter(Boolean)[0])).toBeGreaterThan(0)
      expect(signedArea(d.split('M').filter(Boolean)[1])).toBeGreaterThan(0)
    }
  })
})

/** 서브패스 하나의 부호 있는 면적 (양수 = CCW). */
function signedArea(sub: string): number {
  const pts: Array<[number, number]> = []
  const re = /([\d.eE+-]+),([\d.eE+-]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(sub)) !== null) pts.push([parseFloat(m[1]), parseFloat(m[2])])
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}
