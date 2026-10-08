/**
 * Test: HATCH 패턴 축척(gc 41) / 각도(gc 52) / 정의선(gc 78, 53, 45, 46) 파싱.
 *
 * 이 코드들은 DXF 에서 boundary path **뒤에** 온다. 예전 파서는 gc 91 앞의
 * 헤더 구간에서만 41/52 를 찾았으므로 모든 해치가 축척 1 / 각도 0 으로
 * 들어갔고, 정의선은 통째로 스킵됐다 — 실제 도면에서 축척 60 짜리
 * _USER 교차 해치가 45도 사선 하나로 렌더되는 원인이었다.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { parseRawHatches } from '../../lib/dxf'

/** 실제 도면(out.dxf)의 십자형 _USER 해치와 같은 코드 배치. */
function crossHatchDxf(): string {
  const pairs: Array<[string, string]> = [
    ['0', 'SECTION'], ['2', 'ENTITIES'],
    ['0', 'HATCH'],
    ['5', '30FA8'], ['330', '1F'],
    ['100', 'AcDbEntity'], ['8', '0'], ['62', '8'], ['48', '30.0'],
    ['100', 'AcDbHatch'],
    ['10', '0.0'], ['20', '0.0'], ['30', '0.0'],
    ['210', '0.0'], ['220', '0.0'], ['230', '1.0'],
    ['2', '_USER'], ['70', '0'], ['71', '0'],
    ['91', '1'],
    // boundary path: 폴리라인 아닌 edge 타입(72=1, 직선) 4개로 사각형
    ['92', '0'], ['93', '4'],
    ['72', '1'], ['10', '0'], ['20', '0'], ['11', '100'], ['21', '0'],
    ['72', '1'], ['10', '100'], ['20', '0'], ['11', '100'], ['21', '100'],
    ['72', '1'], ['10', '100'], ['20', '100'], ['11', '0'], ['21', '100'],
    ['72', '1'], ['10', '0'], ['20', '100'], ['11', '0'], ['21', '0'],
    ['97', '0'],
    // --- 여기부터 패턴 정의 데이터 (헤더가 아니라 boundary 뒤) ---
    ['75', '1'], ['76', '0'],
    ['52', '0.0'], ['41', '60.0'], ['77', '1'],
    ['78', '2'],
    ['53', '0.0'], ['43', '0.0'], ['44', '0.0'], ['45', '0.0'], ['46', '60.0'], ['79', '0'],
    ['53', '90.0'], ['43', '0.0'], ['44', '0.0'], ['45', '-60.0'], ['46', '0.0'], ['79', '0'],
    ['47', '1.0'],
    ['98', '1'], ['10', '50.0'], ['20', '50.0'],
    ['0', 'ENDSEC'], ['0', 'EOF'],
  ]
  return pairs.map(([c, v]) => `${c}\n${v}`).join('\n') + '\n'
}

describe('HATCH 패턴 정의 데이터', () => {
  const hatches = parseRawHatches(crossHatchDxf(), {})

  it('해치를 1개 읽는다', () => {
    expect(hatches).toHaveLength(1)
  })

  it('boundary path 뒤의 gc 41 축척을 읽는다', () => {
    expect(hatches[0].patternScale).toBe(60)
  })

  it('gc 52 각도를 읽는다', () => {
    expect(hatches[0].patternAngle).toBe(0)
  })

  it('gc 78 정의선 수를 읽는다 (2 = 교차 해치)', () => {
    expect(hatches[0].patternDefLines).toBe(2)
  })

  it('정의선 offset(gc 45/46) 에서 실제 간격을 계산한다', () => {
    expect(hatches[0].patternSpacing).toBeCloseTo(60, 6)
  })

  it('첫 정의선의 각도(gc 53)를 쓴다 — 45도 기본값이 아니다', () => {
    expect(hatches[0].patternDefAngle).toBe(0)
  })

  it('패턴명과 단색 플래그(gc 70=0)를 유지한다', () => {
    expect(hatches[0].patternName).toBe('_USER')
    expect(hatches[0].solidFill).toBe(false)
  })

  it('seed point(gc 98 뒤의 10/20)를 boundary 로 잘못 먹지 않는다', () => {
    // 사각형 네 변 = 8점. seed (50,50) 이 섞이면 centroid 가 틀어진다.
    expect(hatches[0].cx).toBeCloseTo(50, 6)
    expect(hatches[0].cy).toBeCloseTo(50, 6)
  })
})
